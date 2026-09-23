import { cumulativeMortality } from '@/lib/calc';
import { godownPosition, traderOutstanding } from '@/lib/analytics';
import { fmtIN, fmtMoney, fmtPct } from '@/lib/format';
import { vaccinationPositions, vaccinationReminders } from '@/lib/vaccination';
import type {
  Batch, EggCollection, FarmTask, FeedConsumption, FeedStockEntry, MortalityEntry,
  Shed, Trader, TraderTxn, VaccinationItem,
} from '@/types';

export type AlertTone = 'danger' | 'warn' | 'accent' | 'brand';

export type AlertKind = 'log' | 'mortality' | 'stock-negative' | 'stock-low' | 'money' | 'tasks' | 'vaccination';

export interface FarmAlert {
  id: string;
  tone: AlertTone;
  kind: AlertKind;
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
}

/**
 * Only alerts the farm's own records justify: a batch that has not been logged,
 * stock under the godown's reorder rule, mortality past the 5% review line,
 * money owed and work still open. Nothing here is invented to fill space.
 * Shared by the dashboard's Attention layer and the Alerts page so both always
 * read from the same rules.
 */
export function buildFarmAlerts(input: {
  batches: Batch[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  eggs: EggCollection[];
  tasks: FarmTask[];
  feedStock: FeedStockEntry[];
  traders: Trader[];
  traderTxns: TraderTxn[];
  sheds: Shed[];
  vaccinations: VaccinationItem[];
  today: string;
  canReport: boolean;
  canViewFinance: boolean;
  canViewVaccination: boolean;
}): FarmAlert[] {
  const {
    batches, mortality, feed, eggs, tasks, feedStock, traders, traderTxns,
    sheds, vaccinations, today, canReport, canViewFinance, canViewVaccination,
  } = input;
  const out: FarmAlert[] = [];

  // A dose the flock is owed outranks everything else on the day it is missed (§14).
  if (canViewVaccination) {
    for (const r of vaccinationReminders(vaccinationPositions(vaccinations, batches, sheds, today))) {
      out.push({ ...r, kind: 'vaccination' });
    }
  }

  for (const b of batches.filter(x => x.status === 'ACTIVE')) {
    const miss = [
      !mortality.some(m => m.batchId === b.id && m.date === today) && 'mortality',
      !feed.some(f => f.batchId === b.id && f.date === today) && 'feed',
      (b.birdType !== 'LAYER' || eggs.some(e => e.shedId === b.shedId && e.date === today)) ? null : 'eggs',
    ].filter(Boolean).join(', ');
    if (miss) out.push({
      id: `log-${b.id}`, tone: 'accent', kind: 'log',
      title: `${b.code} — not logged today`, detail: `Missing ${miss}`,
      actionLabel: 'Log', to: canReport ? `/batches/${b.id}/daily-report` : `/batches/${b.id}`,
    });
    const cum = cumulativeMortality(b.id, mortality, today);
    const pct = b.initialBirds > 0 ? (cum / b.initialBirds) * 100 : 0;
    if (pct > 5) out.push({
      id: `mort-${b.id}`, tone: 'danger', kind: 'mortality',
      title: `High mortality — ${b.code}`, detail: `${fmtIN(cum)} deaths · ${fmtPct(pct, 2)} of birds placed`,
      actionLabel: 'Review', to: `/batches/${b.id}/mortality`,
    });
  }

  for (const r of godownPosition(feedStock).rows) {
    if (r.negative) out.push({
      id: `neg-${r.ingredient}`, tone: 'danger', kind: 'stock-negative',
      title: `${r.ingredient} shows negative stock`, detail: `${fmtIN(r.stockKg)} kg — an adjustment entry is needed`,
      actionLabel: 'Correct', to: `/feed?q=${encodeURIComponent(r.ingredient)}`,
    });
    else if (r.status !== 'NORMAL') out.push({
      id: `low-${r.ingredient}`, tone: r.status === 'CRITICAL' ? 'danger' : 'warn', kind: 'stock-low',
      title: `${r.ingredient} stock ${r.status === 'CRITICAL' ? 'critical' : 'low'}`,
      detail: `${fmtIN(r.stockKg)} kg${r.daysLeft !== null ? ` · ≈ ${fmtIN(r.daysLeft)} days left at ${fmtIN(r.avg7Kg ?? 0)} kg/day` : ''}`,
      actionLabel: 'Godown', to: `/feed?q=${encodeURIComponent(r.ingredient)}`,
    });
  }

  if (canViewFinance) {
    const owed = traderOutstanding(traders, traderTxns).filter(t => t.balance > 0);
    if (owed.length) out.push({
      id: 'traders', tone: 'warn', kind: 'money',
      title: 'Outstanding payment',
      detail: `${fmtMoney(owed.reduce((s, t) => s + t.balance, 0))} due from ${owed.length} ${owed.length === 1 ? 'trader' : 'traders'}`,
      actionLabel: 'Collect', to: '/traders',
    });
  }

  const pending = tasks.filter(t => t.date === today && (t.status === 'PENDING' || t.status === 'IN_PROGRESS'));
  if (pending.length) out.push({
    id: 'tasks', tone: 'brand', kind: 'tasks',
    title: `${pending.length} ${pending.length === 1 ? 'task' : 'tasks'} open today`, detail: 'Daily work awaiting action',
    actionLabel: 'Open', to: '/tasks',
  });

  const rank: Record<AlertTone, number> = { danger: 0, warn: 1, accent: 2, brand: 3 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
