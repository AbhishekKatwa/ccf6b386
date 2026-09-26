import { cumulativeMortality } from '@/lib/calc';
import { godownPosition, traderOutstanding } from '@/lib/analytics';
import { coverageOf, feedForecast, fmtDays } from '@/lib/coverage';
import { fmtDateShort, fmtIN, fmtMoney, fmtPct } from '@/lib/format';
import { medicineStockBoard } from '@/lib/medicines';
import { payableTotals, unlinkedPurchasePayments, type PurchasePosition } from '@/lib/purchasing';
import { PLANNER_DAYS, plannerWindow, shedDayPlans } from '@/lib/planner';
import { vaccinationPositions, vaccinationReminders } from '@/lib/vaccination';
import type {
  Batch, EggCollection, EggSaleBooking, EggWastage, FarmTask, FeedConsumption, FeedFormula,
  FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry, MortalityEntry, SaleEntry,
  Shed, Trader, TraderTxn, VaccinationItem,
} from '@/types';

/**
 * Operational prioritisation, nothing else.
 *
 * Every row here is a standing business rule re-read: the godown's reorder level and
 * 7-day draw, the coverage bands (lib/coverage), the medicine item's own low-stock
 * threshold and expiry window, the 5% cumulative mortality line, the planner's
 * day-by-day shortage, the payable and receivable balances Finance already states, and
 * the sync engine's own queue. No threshold is invented for this page, no score is
 * computed, and nothing appears that a record does not already justify.
 *
 * Severity carries only "can the farm keep running without this being handled":
 * Critical stops something now, Warning will stop it soon, Info is worth knowing today.
 * A family is only read by a role that can reach the screen that owns it, so an alert
 * never points at a page the user cannot open, and money alerts never surface for a
 * role without viewFinance.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';

export const SEVERITY_ORDER: AlertSeverity[] = ['critical', 'warning', 'info'];

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critical', warning: 'Warning', info: 'Info',
};

const RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** What each kind of row is about — the icon the shared row draws. */
export type AlertKind =
  | 'vaccination' | 'log' | 'mortality' | 'stock' | 'stock-issue' | 'medicine'
  | 'planner' | 'receivable' | 'payable' | 'sync' | 'tasks';

export interface FarmAlert {
  id: string;
  severity: AlertSeverity;
  kind: AlertKind;
  title: string;
  detail: string;
  actionLabel: string;
  /** The screen that owns the record behind the alert. */
  to?: string;
  /** When the action belongs here rather than on another page — the sync queue retries in place. */
  run?: () => void;
}

/** The route gates, resolved by the caller from the same role lists the router uses. */
export interface AlertAccess {
  /** The batch workspace, egg board and health tabs (OPS_ROLES). */
  ops: boolean;
  /** The godown (GODOWN_ROLES). */
  godown: boolean;
  /** The medicine & vaccine store (MEDICINE_ROLES). */
  medicine: boolean;
  /** Traders and Finance: the commerce routes AND the viewFinance permission. */
  money: boolean;
  /** The vaccination module (VACCINATION_ROLES). */
  vaccination: boolean;
  /** The daily-report tab, which the log alert offers instead of the batch page (REPORT_ROLES). */
  report: boolean;
}

/** The device's own sync standing, as the header badge sees it. */
export interface SyncStanding {
  cloud: boolean;
  online: boolean;
  pending: number;
  errors: string[];
  retry: () => void;
}

export interface AttentionInput {
  batches: Batch[];
  sheds: Shed[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  eggs: EggCollection[];
  tasks: FarmTask[];
  feedStock: FeedStockEntry[];
  feedFormulas: FeedFormula[];
  medicineItems: MedicineItem[];
  medicineStock: MedicineStockEntry[];
  saleEntries: SaleEntry[];
  eggWastages: EggWastage[];
  eggSaleBookings: EggSaleBooking[];
  traders: Trader[];
  traderTxns: TraderTxn[];
  finance: FinanceTxn[];
  /** Stock receipts with what has been paid against them — the Finance payables list. */
  purchasePositions: PurchasePosition[];
  vaccinations: VaccinationItem[];
  today: string;
  access: AlertAccess;
  sync: SyncStanding;
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmtIN(n)} ${n === 1 ? one : many}`;

const names = (list: string[]) => list.slice(0, 2).join(', ') + (list.length > 2 ? ` +${list.length - 2} more` : '');

export function buildFarmAlerts(input: AttentionInput): FarmAlert[] {
  const { access, sync, today } = input;
  const out: FarmAlert[] = [];

  /* ── 1 · a dose the flock is owed. The module's own urgency rule decides the severity:
     overdue stops the schedule, today is the day, soon is worth knowing. ── */
  if (access.vaccination) {
    for (const r of vaccinationReminders(vaccinationPositions(input.vaccinations, input.batches, input.sheds, today))) {
      out.push({
        id: r.id,
        severity: r.tone === 'danger' ? 'critical' : r.tone === 'warn' ? 'warning' : 'info',
        kind: 'vaccination',
        title: r.title, detail: r.detail, actionLabel: r.actionLabel, to: r.to,
      });
    }
  }

  /* ── 2 · the live flocks: the 5% mortality line and today's missing log ── */
  if (access.ops) {
    for (const b of input.batches.filter(x => x.status === 'ACTIVE')) {
      const cum = cumulativeMortality(b.id, input.mortality, today);
      const pct = b.initialBirds > 0 ? (cum / b.initialBirds) * 100 : 0;
      if (pct > 5) out.push({
        id: `mort-${b.id}`, severity: 'critical', kind: 'mortality',
        title: `High mortality — ${b.code}`,
        detail: `${fmtIN(cum)} deaths · ${fmtPct(pct, 2)} of birds placed`,
        actionLabel: 'Review', to: `/batches/${b.id}/mortality`,
      });

      const miss = [
        !input.mortality.some(m => m.batchId === b.id && m.date === today) && 'mortality',
        !input.feed.some(f => f.batchId === b.id && f.date === today) && 'feed',
        (b.birdType !== 'LAYER' || input.eggs.some(e => e.shedId === b.shedId && e.date === today)) ? null : 'eggs',
      ].filter(Boolean).join(', ');
      if (miss) out.push({
        id: `log-${b.id}`, severity: 'warning', kind: 'log',
        title: `${b.code} — not logged today`, detail: `Missing ${miss}`,
        actionLabel: 'Log', to: access.report ? `/batches/${b.id}/daily-report` : `/batches/${b.id}`,
      });
    }
  }

  /* ── 3 · the godown shelf. One row per ingredient: the reorder level and the days the
     shelf would last are two readings of the same stock, never two alerts. Days come from
     the batches' expected intake where it is set, else from the last 7 days of actual draw. ── */
  if (access.godown) {
    const position = godownPosition(input.feedStock, today);
    const forecast = feedForecast(input.batches, input.feedFormulas, today);
    for (const r of position.rows) {
      if (r.negative) {
        out.push({
          id: `neg-${r.ingredient}`, severity: 'critical', kind: 'stock-issue',
          title: `${r.ingredient} shows negative stock`,
          detail: `${fmtIN(r.stockKg)} kg — an adjustment entry is needed`,
          actionLabel: 'Correct', to: `/feed?q=${encodeURIComponent(r.ingredient)}`,
        });
        continue;
      }
      const cov = coverageOf(forecast, r.ingredient, r.stockKg);
      const expected = cov.days !== null;
      const days = expected ? cov.days : r.daysLeft;
      const dailyKg = expected ? cov.dailyKg : (r.avg7Kg ?? 0);
      const critical = cov.status === 'CRITICAL' || r.status === 'CRITICAL';
      const low = cov.status === 'LOW' || r.status === 'LOW';
      if (!critical && !low) continue;
      out.push({
        id: `low-${r.ingredient}`,
        severity: critical ? 'critical' : 'warning',
        kind: 'stock',
        title: `${r.ingredient} ${critical ? 'will run out' : 'is running low'}`,
        detail: `${fmtIN(r.stockKg)} kg · ${fmtDays(days)} at ${fmtIN(dailyKg)} kg/day ${expected ? 'expected' : 'used'}`,
        actionLabel: 'Godown', to: `/feed?q=${encodeURIComponent(r.ingredient)}`,
      });
    }

    // A shelf the forecast cannot measure is a gap in the plan, not a shortage.
    if (forecast.blockers.length) out.push({
      id: 'coverage-blockers', severity: 'info', kind: 'stock',
      title: `${plural(forecast.blockers.length, 'batch', 'batches')} cannot be forecast`,
      detail: `${names(forecast.blockers.map(b => b.batchCode))} — set a daily intake and a formula in force to measure the shelf`,
      actionLabel: 'Batches', to: '/batches',
    });
  }

  /* ── 4 · the medicine & vaccine shelf: the item's own threshold, expiry window and draw ── */
  if (access.medicine) {
    const board = medicineStockBoard(input.medicineItems, input.medicineStock, today);
    for (const r of board.rows.filter(x => x.qty < 0)) {
      out.push({
        id: `med-neg-${r.item.id}`, severity: 'critical', kind: 'stock-issue',
        title: `${r.item.name} shows negative stock`,
        detail: `${fmtIN(r.qty)} ${r.item.unit} — the ledger is drawn past what it holds`,
        actionLabel: 'Correct', to: `/medicines/item/${r.item.id}`,
      });
    }
    const low = board.rows.filter(r => r.qty >= 0 && r.low);
    if (low.length) out.push({
      id: 'medicine-low', severity: 'warning', kind: 'medicine',
      title: `${plural(low.length, 'medicine')} at or below its reorder level`,
      detail: names(low.map(r => `${r.item.name} · ${fmtIN(r.qty)} ${r.item.unit}`)),
      actionLabel: 'Store', to: '/medicines',
    });
    const expired = board.rows.filter(r => r.expiry.state === 'EXPIRED');
    if (expired.length) out.push({
      id: 'medicine-expired', severity: 'warning', kind: 'medicine',
      title: `${plural(expired.length, 'medicine lot')} past its expiry`,
      detail: names(expired.map(r => r.item.name)),
      actionLabel: 'Store', to: '/medicines',
    });
    const expiring = board.rows.filter(r => r.expiry.state === 'EXPIRING');
    if (expiring.length) out.push({
      id: 'medicine-expiring', severity: 'info', kind: 'medicine',
      title: `${plural(expiring.length, 'medicine')} expiring soon`,
      detail: names(expiring.map(r => `${r.item.name} · ${fmtDateShort(r.expiry.date ?? today)}`)),
      actionLabel: 'Store', to: '/medicines',
    });
  }

  /* ── 5 · the planner's own shortage: trays promised past what the board expects ── */
  if (access.ops && input.eggSaleBookings.length) {
    const window = plannerWindow(today, PLANNER_DAYS);
    for (const sh of input.sheds) {
      const short = shedDayPlans({
        shedId: sh.id, eggs: input.eggs, entries: input.saleEntries,
        wastages: input.eggWastages, bookings: input.eggSaleBookings, dates: window, today,
      }).filter(p => p.shortage > 0);
      if (!short.length) continue;
      const first = short[0];
      out.push({
        id: `plan-${sh.id}`, severity: 'warning', kind: 'planner',
        title: `${sh.name} is over-booked`,
        detail: `${plural(first.shortage, 'tray')} short on ${fmtDateShort(first.date)}`
          + (short.length > 1 ? ` · ${plural(short.length, 'day')} in the window` : ''),
        actionLabel: 'Planner', to: '/eggs?tab=planner',
      });
    }
  }

  /* ── 6 · money: what traders owe the farm, and what the farm owes its suppliers ── */
  if (access.money) {
    const owed = traderOutstanding(input.traders, input.traderTxns).filter(t => t.balance > 0);
    if (owed.length) {
      const top = owed.reduce((a, b) => (b.balance > a.balance ? b : a));
      out.push({
        id: 'receivable', severity: 'warning', kind: 'receivable',
        title: 'Outstanding payment',
        detail: `${fmtMoney(owed.reduce((s, t) => s + t.balance, 0))} due from ${plural(owed.length, 'trader')} · largest ${top.name} ${fmtMoney(top.balance)}`,
        actionLabel: 'Collect', to: '/traders',
      });
    }

    const payables = payableTotals(input.purchasePositions);
    if (payables.outstanding > 0) out.push({
      id: 'payable', severity: 'warning', kind: 'payable',
      title: 'Supplier payment outstanding',
      detail: `${fmtMoney(payables.outstanding)} owed across ${plural(payables.unpaidPurchases, 'receipt')}`,
      actionLabel: 'Pay', to: '/finance',
    });
    // A receipt with no rate has no value, so it settles against nothing: a gap, not a zero.
    if (payables.unpriced > 0) out.push({
      id: 'payable-unpriced', severity: 'info', kind: 'payable',
      title: `${plural(payables.unpriced, 'stock receipt')} with no rate`,
      detail: 'Counted as stock but worth no money until a rate is recorded',
      actionLabel: 'Finance', to: '/finance',
    });
    const strays = unlinkedPurchasePayments(input.finance, input.feedStock, input.medicineStock);
    if (strays.length) out.push({
      id: 'payable-strays', severity: 'info', kind: 'payable',
      title: `${plural(strays.length, 'payment')} not linked to a receipt`,
      detail: `Money out that no stock receipt answers to · latest ${fmtDateShort(strays[0].date)}`,
      actionLabel: 'Finance', to: '/finance',
    });
  }

  /* ── 7 · the device's own queue: the same standing the header badge carries ── */
  if (sync.cloud && sync.pending) {
    if (sync.errors.length) out.push({
      id: 'sync-refused', severity: 'critical', kind: 'sync',
      title: `${plural(sync.pending, 'change')} the database refused`,
      detail: sync.errors[0], actionLabel: 'Retry', run: sync.retry,
    });
    else if (!sync.online) out.push({
      id: 'sync-offline', severity: 'warning', kind: 'sync',
      title: `Offline · ${plural(sync.pending, 'change')} queued`,
      detail: 'Recorded safely on this device; they go out on their own when the network returns',
      actionLabel: '',
    });
    else out.push({
      id: 'sync-queued', severity: 'info', kind: 'sync',
      title: `${plural(sync.pending, 'change')} not yet in the database`,
      detail: 'Waiting on the next sync pass', actionLabel: 'Retry', run: sync.retry,
    });
  }

  /* ── 8 · today's open work ── */
  const pendingTasks = input.tasks.filter(t => t.date === today && (t.status === 'PENDING' || t.status === 'IN_PROGRESS'));
  if (pendingTasks.length) out.push({
    id: 'tasks', severity: 'info', kind: 'tasks',
    title: `${plural(pendingTasks.length, 'task')} open today`, detail: 'Daily work awaiting action',
    actionLabel: 'Open', to: '/tasks',
  });

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

export type SeverityCounts = Record<AlertSeverity, number>;

/** The tally the dashboard band and the Alerts headings read from the same list. */
export function severityCounts(alerts: FarmAlert[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) counts[a.severity]++;
  return counts;
}
