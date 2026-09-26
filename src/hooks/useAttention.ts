import { useMemo } from 'react';
import { useCan, useCompanyData, useCurrentUser, useVisibleSheds } from '@/store/app';
import {
  COMMERCE_ROLES, GODOWN_ROLES, MEDICINE_ROLES, OPS_ROLES, REPORT_ROLES, VACCINATION_ROLES,
} from '@/lib/permissions';
import {
  buildFarmAlerts, severityCounts,
  type AlertAccess, type FarmAlert, type SeverityCounts,
} from '@/lib/alerts';
import { usePurchasePositions } from '@/hooks/usePaymentPositions';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { todayISO } from '@/lib/format';

/**
 * The company's attention list, read once. The Alerts page, the dashboard band and the
 * bell-style counts all take it from here, so a row never exists on one of them and not
 * the others.
 *
 * Each signal family is gated by the same role list that guards the screen it points at —
 * a Farm Manager sees flock and feed alerts and no money, and an alert never sends a person
 * to a page the router would refuse them.
 */
export function useAttention(): { today: string; alerts: FarmAlert[]; counts: SeverityCounts } {
  const data = useCompanyData();
  const sheds = useVisibleSheds();
  const user = useCurrentUser();
  const canFinance = useCan('viewFinance');
  const positions = usePurchasePositions();
  const sync = useSyncStatus();
  const today = todayISO();

  const access = useMemo<AlertAccess>(() => {
    const role = user?.role;
    const inList = (roles: typeof OPS_ROLES) => !!role && roles.includes(role);
    return {
      ops: inList(OPS_ROLES),
      godown: inList(GODOWN_ROLES),
      medicine: inList(MEDICINE_ROLES),
      money: inList(COMMERCE_ROLES) && canFinance,
      vaccination: inList(VACCINATION_ROLES),
      report: inList(REPORT_ROLES),
    };
  }, [user?.role, canFinance]);

  const standing = useMemo(() => ({
    cloud: sync.cloud, online: sync.online, pending: sync.pending, errors: sync.errors, retry: sync.retry,
  }), [sync.cloud, sync.online, sync.pending, sync.errors, sync.retry]);

  const alerts = useMemo(() => buildFarmAlerts({
    batches: data.batches, sheds,
    mortality: data.mortality, feed: data.feed, eggs: data.eggs, tasks: data.tasks,
    feedStock: data.feedStock, feedFormulas: data.feedFormulas,
    medicineItems: data.medicineItems, medicineStock: data.medicineStock,
    saleEntries: data.saleEntries, eggWastages: data.eggWastages, eggSaleBookings: data.eggSaleBookings,
    traders: data.traders, traderTxns: data.traderTxns, finance: data.finance,
    purchasePositions: positions,
    vaccinations: data.vaccinations,
    today, access, sync: standing,
  }), [
    data.batches, data.mortality, data.feed, data.eggs, data.tasks, data.feedStock, data.feedFormulas,
    data.medicineItems, data.medicineStock, data.saleEntries, data.eggWastages, data.eggSaleBookings,
    data.traders, data.traderTxns, data.finance, data.vaccinations,
    sheds, positions, today, access, standing,
  ]);

  return { today, alerts, counts: severityCounts(alerts) };
}
