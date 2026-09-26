import { useMemo } from 'react';
import { useCan, useCompanyData, useCurrentUser, useVisibleSheds } from '@/store/app';
import {
  COMMERCE_ROLES, GODOWN_ROLES, MEDICINE_ROLES, VACCINATION_ROLES,
} from '@/lib/permissions';
import { buildTimeline, type TimelineAccess, type TimelineEvent } from '@/lib/timeline';

/**
 * Which modules of the timeline this reader may open — the same gates that guard the screens
 * the lines link to, so a timeline never shows a fact the reader could not go and check.
 */
export function useTimelineAccess(): TimelineAccess {
  const user = useCurrentUser();
  const canFinance = useCan('viewFinance');
  return useMemo<TimelineAccess>(() => {
    const role = user?.role;
    const inList = (roles: typeof COMMERCE_ROLES) => !!role && roles.includes(role);
    return {
      money: inList(COMMERCE_ROLES) && canFinance,
      godown: inList(GODOWN_ROLES),
      medicine: inList(MEDICINE_ROLES),
      vaccination: inList(VACCINATION_ROLES),
    };
  }, [user?.role, canFinance]);
}

/**
 * The company's timeline, read from the records already on this device.
 *
 * Nothing is fetched and nothing is stored: the same company-scoped selectors every screen
 * uses feed the derivation, and the day window keeps a long history from being turned into
 * lines nobody asked for. A shed the reader is not assigned to never appears, so a Farm
 * Manager's timeline is their own sheds plus the company-level record of their role.
 */
export function useTimeline(range: { from?: string; to?: string }): TimelineEvent[] {
  const { from, to } = range;
  const data = useCompanyData();
  const sheds = useVisibleSheds();
  const access = useTimelineAccess();

  const events = useMemo(() => buildTimeline({
    eggs: data.eggs,
    eggWastages: data.eggWastages,
    mortality: data.mortality,
    feed: data.feed,
    feedRounds: data.feedRounds,
    feedStock: data.feedStock,
    medicineStock: data.medicineStock,
    medicineItems: data.medicineItems,
    saleLogs: data.saleLogs,
    saleEntries: data.saleEntries,
    finance: data.finance,
    cashHandovers: data.cashHandovers,
    batches: data.batches,
    vaccinations: data.vaccinations,
    audit: data.audit,
    sheds: data.sheds,
    users: data.users,
    traders: data.traders,
    access,
    range: { from, to },
  }), [
    data.eggs, data.eggWastages, data.mortality, data.feed, data.feedRounds, data.feedStock,
    data.medicineStock, data.medicineItems, data.saleLogs, data.saleEntries, data.finance,
    data.cashHandovers, data.batches, data.vaccinations, data.audit, data.sheds, data.users,
    data.traders, access, from, to,
  ]);

  return useMemo(() => {
    const visible = new Set(sheds.map(s => s.id));
    return events.filter(e => !e.shedId || visible.has(e.shedId));
  }, [events, sheds]);
}
