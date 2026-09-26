/**
 * Reports: read-only statements over the ledgers the farm already keeps.
 *
 * Nothing here owns a number. Every figure comes from the same selectors Finance,
 * Godown, Traders and the dashboards already read — `computeFarmPnl` for the accounts,
 * `valueGodown` for stock pricing, `traderLedger` for a buyer's account — so a report
 * can never disagree with the screen it was drawn from, and there is no second
 * accounting engine to keep in step.
 *
 * Two rules hold throughout:
 *  - A quantity or amount that was never recorded reads as an em dash, never as zero.
 *  - A column the data model does not carry (GST, transport, a discount ledger type) is
 *    stated as missing in the report's own notes rather than filled with an invention.
 *
 * Every transactional table is sorted newest day first, then newest booking.
 */
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import {
  Wallet, Layers, CalendarRange, Banknote, Boxes, Users, ScrollText, Receipt, Store,
  BadgeIndianRupee, History, Percent, LineChart, ShoppingCart, Package, Egg,
  Wheat, Archive, AlertTriangle, SlidersHorizontal, Skull, ClipboardList, FlaskConical,
  ShieldCheck, BookOpen, Scale, LayoutGrid, HandCoins, GitCompareArrows,
  Printer, Contact, TrendingUp, TrendingDown, Gauge, ArrowLeftRight, Landmark,
  ClipboardCheck, CircleDollarSign, type LucideIcon,
} from 'lucide-react';
import { PAYMENT_METHOD_LABEL, type CashCount, type CashHandover, type PaymentMethod, type PaymentSplit } from '@/types';
import type {
  AuditEntry, Batch, EggCollection, FeedConsumption, FeedFormula,
  FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry, MortalityEntry, SaleEntry, SaleLog,
  Shed, Trader, TraderTxn, User,
} from '@/types';
import {
  dayKeys, div, eggProductionTrend, expenseBreakdown, feedCostByShed, feedCostTrend,
  feedExpenseTraces, fin, godownIngredients, inRange, ingredientStockTrend, isISODate, mean,
  mortalityTrend, pnlTrend, rangeOf, salesByTrader, traderOutstanding,
  type GodownRow, type Point, type Range,
} from './analytics';
import {
  allocateShortage, computeFarmPnl, godownLedger, isInventoryPurchase, isInflow,
  scopeOf, shortageRows,
} from './accounting';
import { valueGodown, type GodownValuation } from './valuation';
import { usageExpenseOf, valueMedicines } from './medicines';
import {
  batchAgeDays, batchOfShedOn, cumulativeMortality, entryTrays, formulaCostPerTonne,
  formulaUsage as feedingsOfFormula, gradeTotal, liveBirdsOn, loadBilled, ratePerEgg, salePositions,
  stockDelta, TRADER_TXN_LABEL, traderLedger,
} from './calc';
import { fmtDate, fmtDateTime, fmtIN, fmtKg, fmtMoney, fmtPct, todayISO } from './format';
import { latestFirst } from './order';
import { godownMovements, ingredientEvents, MOVEMENT_LABEL, plainRemarks } from './movements';
import {
  COVERAGE_CRITICAL_DAYS, COVERAGE_LOW_DAYS, compareCoverage, coverageBands, coverageRows,
  feedForecast, fmtDays, type IngredientCoverage,
} from './coverage';
import {
  CHANNEL_FULL_LABEL, CHANNEL_KEYS, cashPositionOf, custodyOf, isClassified, methodSummary, splitOf,
  type ChannelKey,
} from './cashflow';

/* ============================= RESULT SHAPE ============================= */

const DASH = '—';

export type ReportColumn = { label: string; right?: boolean };
export type ReportRow = {
  id: string;
  /** Positional to `columns`; null renders as an em dash, never as a zero. */
  cells: (string | null | undefined)[];
  href?: string;
  tone?: 'success' | 'danger' | 'muted';
};
export type ReportTable = {
  title?: string;
  /** What the rows actually are, so a reader knows what a line means before reading it. */
  caption?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  emptyText: string;
};
export type ReportMetric = {
  label: string; value: string; foot?: string;
  tone?: 'ink' | 'success' | 'danger' | 'warn' | 'muted';
};

/** Colour names, not hex: the chart kit owns the palette. */
export type SeriesColor = 'brand' | 'accent' | 'teal' | 'danger' | 'success' | 'muted';
export type ReportFormat = 'money' | 'num' | 'kg' | 'trays' | 'pct' | 'tonnes' | 'birds';

export type ReportChart =
  | {
    kind: 'trend'; id: string; title: string; subtitle?: string; format: ReportFormat;
    series: { id: string; label: string; color: SeriesColor; points: Point[]; dashed?: boolean; area?: boolean }[];
    warnings?: string[];
  }
  | {
    kind: 'bars'; id: string; title: string; subtitle?: string; format: ReportFormat;
    rows: { id: string; label: string; value: number; display?: string; sub?: string; tone?: 'normal' | 'success' | 'warn' | 'danger' | 'muted' }[];
    caption?: string;
  }
  | {
    kind: 'paired'; id: string; title: string; subtitle?: string; format: ReportFormat;
    buckets: { label: string; revenue: number | null; expense: number | null; net: number | null }[];
    caption?: string; warnings?: string[];
  };

export type ReportResult = {
  summary: ReportMetric[];
  charts: ReportChart[];
  tables: ReportTable[];
  /** How a figure was arrived at — the accounting rules stated where they apply. */
  notes: string[];
  warnings: string[];
  /** Where the underlying records live, so a report is never a dead end. */
  links: { label: string; href: string }[];
};

/* ============================= PARAMETERS ============================= */

export type ReportParam = 'shed' | 'batch' | 'trader' | 'ingredient';

export type DatePreset = 'TODAY' | '7D' | '30D' | '90D' | 'MONTH' | 'LAST_MONTH' | 'CUSTOM';

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: '7D', label: '7 days' },
  { value: '30D', label: '30 days' },
  { value: '90D', label: '90 days' },
  { value: 'MONTH', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'CUSTOM', label: 'Custom' },
];

export type ReportParams = {
  preset: DatePreset;
  from: string;
  to: string;
  shedId?: string;
  batchId?: string;
  traderId?: string;
  ingredient?: string;
};

export function defaultParams(today = todayISO()): ReportParams {
  return { preset: '30D', from: rangeOf('30D', today).from, to: today };
}

/** The window a report reads. A custom range is honoured whichever way it was typed. */
export function reportRange(p: ReportParams, today = todayISO()): Range {
  const span = (from: string, to: string): Range => {
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    const days = Math.max(1, dayKeys(lo, hi).length);
    return { key: days === 7 ? '7D' : days === 90 ? '90D' : '30D', days, from: lo, to: hi };
  };
  const day = (iso: string) => new Date(`${iso}T00:00:00`);
  switch (p.preset) {
    case 'TODAY': return span(today, today);
    case '7D': return rangeOf('7D', today);
    case '30D': return rangeOf('30D', today);
    case '90D': return rangeOf('90D', today);
    case 'MONTH': return span(fmtISO(startOfMonth(day(today))), today);
    case 'LAST_MONTH': {
      const s = startOfMonth(subMonths(day(today), 1));
      return span(fmtISO(s), fmtISO(endOfMonth(s)));
    }
    default: return span(p.from, p.to);
  }
}

function fmtISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ============================= SOURCE & CONTEXT ============================= */

/** The company-isolated slices `useCompanyData()` already hands every screen. */
export type ReportSource = {
  sheds: Shed[];
  batches: Batch[];
  eggs: EggCollection[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  feedStock: FeedStockEntry[];
  medicineItems: MedicineItem[];
  medicineStock: MedicineStockEntry[];
  feedFormulas: FeedFormula[];
  finance: FinanceTxn[];
  saleEntries: SaleEntry[];
  saleLogs: SaleLog[];
  traders: Trader[];
  traderTxns: TraderTxn[];
  audit: AuditEntry[];
  users: User[];
  cashHandovers: CashHandover[];
  cashCounts: CashCount[];
};

export type ReportCtx = {
  src: ReportSource;
  p: ReportParams;
  range: Range;
  canFinance: boolean;
  /** The one price chain the godown uses, built once per report run. */
  val: () => GodownValuation;
  money: (n: number | null | undefined, decimals?: number) => string;
  num: (n: number | null | undefined, decimals?: number) => string;
  kg: (n: number | null | undefined) => string;
  pct: (n: number | null | undefined) => string;
  trays: (n: number | null | undefined) => string;
  date: (iso: string | null | undefined) => string;
  shedName: (id?: string | null) => string;
  batchCode: (id?: string | null) => string;
  traderName: (id?: string | null) => string;
  userName: (id?: string | null) => string;
  /** The sheds a load left, and the batch that was in each of them that day. */
  shedsOf: (entry: SaleEntry) => string;
  batchesOf: (entry: SaleEntry) => string;
};

export function makeCtx(src: ReportSource, p: ReportParams, range: Range, canFinance: boolean): ReportCtx {
  const shedName = new Map(src.sheds.map(s => [s.id, s.name]));
  const batchCode = new Map(src.batches.map(b => [b.id, b.code]));
  const traderName = new Map(src.traders.map(t => [t.id, t.name]));
  const userName = new Map(src.users.map(u => [u.id, u.name]));
  const name = (map: Map<string, string>, id?: string | null, fallback = DASH) =>
    (id && map.get(id)) || (id ? fallback : DASH);

  let valuation: GodownValuation | null = null;

  return {
    src, p, range, canFinance,
    val: () => (valuation ??= valueGodown(src.feedStock)),
    money: (n, d = 0) => {
      const v = fin(n);
      if (v === null) return DASH;
      if (!canFinance) return '₹ •••••';
      return v < 0 ? `−${fmtMoney(Math.abs(v), d)}` : fmtMoney(v, d);
    },
    num: (n, d = 0) => { const v = fin(n); return v === null ? DASH : fmtIN(v, d); },
    kg: n => { const v = fin(n); return v === null ? DASH : fmtKg(v, Number.isInteger(v) ? 0 : 1); },
    pct: n => { const v = fin(n); return v === null ? DASH : fmtPct(v, 1); },
    trays: n => { const v = fin(n); return v === null ? DASH : `${fmtIN(v)} tr`; },
    date: iso => (isISODate(iso) ? fmtDate(iso) : DASH),
    shedName: id => name(shedName, id, 'Removed shed'),
    batchCode: id => name(batchCode, id, 'Removed batch'),
    traderName: id => name(traderName, id, 'Removed buyer'),
    userName: id => (id === 'system' ? 'System' : name(userName, id, 'Unknown')),
    shedsOf: entry => {
      const ids = entry.lines.map(l => shedName.get(l.shedId) ?? null).filter(Boolean) as string[];
      return ids.length ? ids.join(' + ') : DASH;
    },
    batchesOf: entry => {
      const codes = Array.from(new Set(entry.lines
        .map(l => batchOfShedOn(src.batches, l.shedId, entry.date)?.code)
        .filter(Boolean) as string[]));
      return codes.length ? codes.join(' + ') : DASH;
    },
  };
}

/* ============================= BUILD HELPERS ============================= */

const col = (label: string): ReportColumn => ({ label });
const rcol = (label: string): ReportColumn => ({ label, right: true });

const row = (id: string, cells: (string | null | undefined)[], href?: string, tone?: ReportRow['tone']): ReportRow =>
  ({ id, cells, href, tone });

const metric = (label: string, value: string, foot?: string, tone?: ReportMetric['tone']): ReportMetric =>
  ({ label, value, foot, tone });

/**
 * An expense line of a statement: the minus belongs to the figure itself, so a cost
 * that was never recorded stays a dash rather than becoming a minus in front of one.
 */
const spend = (ctx: ReportCtx, v: number | null | undefined) => {
  const n = fin(v);
  return n === null ? DASH : ctx.money(-Math.abs(n));
};

/** One line is a fact, not a trend: a series needs two recorded slots before it is plotted. */
export function plottable(points: Point[]): boolean {
  return points.filter(p => p.value !== null).length >= 2;
}

/** A chart earns its place: enough real history, and money hidden from roles that must not see it. */
function charts(ctx: ReportCtx, ...items: (ReportChart | false | null | undefined)[]): ReportChart[] {
  return items.filter((c): c is ReportChart => Boolean(c)).filter(c => {
    if (!ctx.canFinance && c.format === 'money') return false;
    if (c.kind === 'trend') return c.series.some(s => plottable(s.points));
    if (c.kind === 'bars') return c.rows.length > 0;
    return c.buckets.some(b => b.revenue !== null || b.expense !== null);
  });
}

const result = (over: Partial<ReportResult>): ReportResult => ({
  summary: [], charts: [], tables: [], notes: [], warnings: [], links: [], ...over,
});

const noData = (over: Partial<ReportResult>, text: string): ReportResult =>
  result({ ...over, warnings: [text, ...(over.warnings ?? [])] });

/** Sum of the readable values; nothing readable yields null rather than zero. */
function total(values: (number | null | undefined)[]): number | null {
  const nums = values.map(fin).filter((v): v is number => v !== null);
  return nums.length ? Number(nums.reduce((s, v) => s + v, 0).toFixed(2)) : null;
}

function count<T>(rows: T[], pick: (r: T) => boolean): number {
  return rows.reduce((s, r) => s + (pick(r) ? 1 : 0), 0);
}

/** A counted footnote that reads as English: one bill, not 1 bills. */
const pluralOf = (shown: string, n: number, one: string, many = `${one}s`) => `${shown} ${n === 1 ? one : many}`;
const plural = (n: number, one: string, many?: string) => pluralOf(String(n), n, one, many);

/** Money for the eggs alone, labour on the load, and trays — per trading day. */
function billedByDay(entries: SaleEntry[]): Map<string, { trays: number; eggs: number; billed: number; loads: number }> {
  const map = new Map<string, { trays: number; eggs: number; billed: number; loads: number }>();
  for (const e of entries) {
    if (!isISODate(e.date)) continue;
    const trays = fin(entryTrays(e));
    const eggs = fin(e.amount);
    const billed = fin(loadBilled(e.amount, e.laborCharge));
    if (trays === null || eggs === null || billed === null) continue;
    const cur = map.get(e.date) ?? { trays: 0, eggs: 0, billed: 0, loads: 0 };
    map.set(e.date, { trays: cur.trays + trays, eggs: cur.eggs + eggs, billed: cur.billed + billed, loads: cur.loads + 1 });
  }
  return map;
}

/** ₹/egg of a load: the egg money over the eggs it carried. Labour recovered on the load is not a price. */
const eggRate = (e: SaleEntry) => ratePerEgg(fin(e.amount), fin(entryTrays(e)));

/** Loads in the window that the shed / batch / buyer filters leave standing. */
function loadRows(ctx: ReportCtx): SaleEntry[] {
  const rows = ctx.src.saleEntries.filter(e => inRange(e.date, ctx.range));
  const byShed = ctx.p.shedId ? rows.filter(e => e.lines.some(l => l.shedId === ctx.p.shedId)) : rows;
  const byTrader = ctx.p.traderId ? byShed.filter(e => e.traderId === ctx.p.traderId) : byShed;
  const byBatch = ctx.p.batchId
    ? byTrader.filter(e => e.lines.some(l => batchOfShedOn(ctx.src.batches, l.shedId, e.date)?.id === ctx.p.batchId))
    : byTrader;
  return latestFirst(byBatch);
}

function dailyPoints(ctx: ReportCtx, entries: SaleEntry[], pick: 'rate' | 'billed' | 'trays'): Point[] {
  const days = billedByDay(entries);
  return dayKeys(ctx.range.from, ctx.range.to).map(date => {
    const d = days.get(date);
    const value = d === undefined ? null : pick === 'rate' ? ratePerEgg(d.eggs, d.trays)
      : pick === 'billed' ? d.billed : d.trays;
    return { date, value: value === null ? null : Number(value.toFixed(2)) };
  });
}

const pnlOf = (ctx: ReportCtx) => computeFarmPnl({
  finance: ctx.src.finance, batches: ctx.src.batches, sheds: ctx.src.sheds,
  feed: ctx.src.feed, feedStock: ctx.src.feedStock, medicineStock: ctx.src.medicineStock,
  feedFormulas: ctx.src.feedFormulas, range: ctx.range,
});

const NO_SUPPLIER_COLUMNS = 'The godown ledger records a receipt as ingredient, quantity and the rate paid. Supplier, GST and freight are not fields the ledger carries — only free text in a remark — so those columns are stated rather than invented.';

const PRINT_HREF = '/batches';

/* ============================= 1. P&L & FINANCIAL STATEMENTS ============================= */

function monthlyChart(ctx: ReportCtx, mode: 'WEEK' | 'MONTH' | 'QUARTER'): ReportChart {
  const p = pnlTrend(ctx.src.finance, mode, ctx.range.to);
  return {
    kind: 'paired', id: `pnl_${mode}`, format: 'money',
    title: `Money in against money out by ${mode === 'WEEK' ? 'week' : mode === 'QUARTER' ? 'quarter' : 'month'}`,
    subtitle: mode === 'MONTH' ? 'Cash view of the ledger over the last six months' : undefined,
    buckets: p.buckets.map(b => ({ label: b.label, revenue: b.revenue, expense: b.expense, net: b.net })),
    warnings: p.warnings,
  };
}

const farmPnl: ReportDef['build'] = ctx => {
  const p = pnlOf(ctx);
  const inflowRows = count(p.periodTxns, t => isInflow(t.kind));
  const outflowRows = count(p.periodTxns, t => !isInflow(t.kind) && !isInventoryPurchase(t));
  return result({
    summary: [
      metric('Income', ctx.money(p.income), `${inflowRows} ${inflowRows === 1 ? 'receipt' : 'receipts'} booked`),
      metric('Total expense', ctx.money(p.totalExpense), 'Operating + feed consumed + shortage'),
      metric('Net result', ctx.money(p.net), p.net >= 0 ? 'Surplus for the period' : 'Deficit for the period',
        p.net >= 0 ? 'success' : 'danger'),
      metric('Cash movement', ctx.money(p.cashNet), `${ctx.money(p.moneyIn)} in · ${ctx.money(p.moneyOut)} out`),
    ],
    charts: charts(ctx, monthlyChart(ctx, 'MONTH')),
    tables: [{
      title: 'Statement of profit & loss',
      caption: 'Accrual view: income earned and expense incurred in the period, whatever the cash date.',
      columns: [col('Line'), rcol('Amount'), col('Basis')],
      emptyText: 'No accounting rows in this period.',
      rows: [
        row('in', ['Income', ctx.money(p.income), 'Every inflow in the finance ledger']),
        row('op', ['Operating expense', spend(ctx, p.operatingExpense), `${plural(outflowRows, 'outflow')}, feed and inventory excluded`]),
        row('feed', ['Feed consumed', spend(ctx, p.feedExpense), 'Priced at the godown average of the day it left']),
        row('med', ['Medicine drawn', spend(ctx, p.medicineExpense), 'Priced at the medicine store average of the day it left']),
        row('short', ['Godown shortage', spend(ctx, p.shortageExpense), 'Recognised once, shared to sheds']),
        row('total', ['Total expense', ctx.money(p.totalExpense), `Operating + feed + medicine + shortage${p.chickExpense > 0 ? `, including ${ctx.money(p.chickExpense)} paid for chicks` : ''}`], undefined, 'muted'),
        row('net', ['Net result', ctx.money(p.net), 'Income less total expense'], undefined,
          p.net >= 0 ? 'success' : 'danger'),
        row('inv', ['Memo · feed & medicine purchases', ctx.money(p.inventoryPurchase), 'Inventory acquired, not an expense'], undefined, 'muted'),
        row('unalloc', ['Memo · unallocated money', ctx.money(p.unallocatedExpense + p.unallocatedIncome), `${plural(p.unallocatedCount, 'row')} not yet mapped`], undefined, 'muted'),
      ],
    }],
    notes: [
      'Godown purchases appear in the memo line only. Charging a purchase as expense and the same feed again when a shed eats it would count it twice.',
      'A shortage is recognised once and shared across the sheds that consumed feed; the Shed-wise P&L shows each share.',
      'Money received against a billed load settles that bill, so it is never counted as income a second time.',
    ],
    warnings: p.warnings,
    links: [{ label: 'Open Finance', href: '/finance' }, { label: 'Shed-wise P&L', href: '/reports/shed_pnl' }],
  });
};

const shedPnl: ReportDef['build'] = ctx => {
  const p = pnlOf(ctx);
  const rows = p.sheds.filter(s => !ctx.p.shedId || s.shedId === ctx.p.shedId);
  const income = total(rows.map(r => r.income));
  const expense = total(rows.map(r => r.totalExpense));
  const profit = total(rows.map(r => r.profit));
  return result({
    summary: [
      metric('Sheds reporting', ctx.num(rows.length), plural(ctx.range.days, 'day') + ' read'),
      metric('Income', ctx.money(income)),
      metric('Expense', ctx.money(expense), 'Feed and shortage share included'),
      metric('Result', ctx.money(profit), undefined, (profit ?? 0) >= 0 ? 'success' : 'danger'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'shed_profit', title: 'Result by shed', format: 'money',
      subtitle: 'Income less that shed\'s own feed, direct expense and shortage share',
      rows: rows.map(r => ({
        id: r.shedId, label: r.shedName, value: r.profit, display: ctx.money(r.profit),
        sub: `${ctx.money(r.income)} in · ${ctx.money(r.totalExpense)} out`,
        tone: r.profit >= 0 ? 'success' as const : 'danger' as const,
      })),
    }),
    tables: [{
      title: 'Shed P&L',
      caption: 'A shed\'s feed expense is the cost of what its birds ate, valued as it left the godown. Medicine is the same idea from the medicine store.',
      columns: [col('Shed'), rcol('Income'), rcol('Direct'), rcol('Feed'), rcol('Medicine'), rcol('Shortage'), rcol('Total'), rcol('Result')],
      emptyText: 'No shed has a recorded income or expense in this period.',
      rows: rows.map(r => row(r.shedId, [
        r.shedName, ctx.money(r.income), ctx.money(r.directExpense), ctx.money(r.feedExpense),
        ctx.money(r.medicineExpense), ctx.money(r.sharedExpense), ctx.money(r.totalExpense), ctx.money(r.profit),
      ], `/sheds/${r.shedId}`, r.profit >= 0 ? 'success' : 'danger')),
    }],
    notes: [
      'A shortage is shared across sheds in proportion to the feed each shed consumed, and the shares add back to the source to the cent.',
      'Unpriced feed is counted in kg and left out of the money, so a shed\'s expense is never a guess.',
    ],
    warnings: [
      ...rows.filter(r => r.unpricedFeedKg > 0)
        .map(r => `${r.shedName} consumed ${ctx.kg(r.unpricedFeedKg)} of feed the godown never priced.`),
      ...p.warnings,
    ],
    links: [{ label: 'Open Godown ledger', href: '/feed' }, { label: 'Shared godown expense', href: '/reports/godown_shared' }],
  });
};

const batchPnl: ReportDef['build'] = ctx => {
  const traces = feedExpenseTraces(ctx.src.feed, ctx.src.feedStock, ctx.src.feedFormulas, ctx.range);
  const medVal = valueMedicines(ctx.src.medicineStock);
  const rows = ctx.src.batches
    .filter(b => !ctx.p.shedId || b.shedId === ctx.p.shedId)
    .filter(b => !ctx.p.batchId || b.id === ctx.p.batchId)
    .map(b => {
      const txns = ctx.src.finance.filter(t => t.batchId === b.id && inRange(t.date, ctx.range));
      const own = traces.filter(t => t.batchId === b.id);
      const uses = ctx.src.medicineStock.filter(e => e.kind === 'USAGE' && e.batchId === b.id && inRange(e.date, ctx.range));
      const costs = uses.map(e => usageExpenseOf(e, medVal));
      const direct = total(txns.filter(t => !isInflow(t.kind) && !isInventoryPurchase(t)).map(t => t.amount)) ?? 0;
      const directVaccine = total(txns.filter(t => t.kind === 'EXPENSE' && t.category === 'Vaccine').map(t => t.amount)) ?? 0;
      const vaccineLabour = total(txns.filter(t => t.kind === 'EXPENSE' && t.category === 'Vaccine Labour').map(t => t.amount)) ?? 0;
      const vaccinator = total(txns.filter(t => t.kind === 'EXPENSE' && t.category === 'Vaccinator').map(t => t.amount)) ?? 0;
      return {
        b,
        income: total(txns.filter(t => isInflow(t.kind)).map(t => t.amount)) ?? 0,
        direct: direct - directVaccine - vaccineLabour - vaccinator,
        feed: total(own.filter(t => !t.missingFormula).map(t => t.cost)) ?? 0,
        medicine: (total(costs) ?? 0) + directVaccine + vaccineLabour + vaccinator,
        unpriced: total(own.map(t => t.unpricedKg)) ?? 0,
        unpricedMedicine: costs.filter(c => c === null).length,
        live: liveBirdsOn(b, ctx.range.to, ctx.src.mortality),
      };
    })
    .sort((a, b) => (b.income - b.direct - b.feed - b.medicine) - (a.income - a.direct - a.feed - a.medicine));
  const reporting = rows.filter(r => r.income || r.direct || r.feed || r.medicine);
  const net = total(reporting.map(r => r.income - r.direct - r.feed - r.medicine));
  return result({
    summary: [
      metric('Batches reporting', ctx.num(reporting.length), `${rows.length} in scope`),
      metric('Income', ctx.money(total(reporting.map(r => r.income)))),
      metric('Expense', ctx.money(total(reporting.map(r => r.direct + r.feed + r.medicine)))),
      metric('Result', ctx.money(net), 'Before the farm-level shortage share',
        (net ?? 0) >= 0 ? 'success' : 'danger'),
    ],
    tables: [{
      title: 'Batch P&L',
      caption: 'Medicine is what the store gave this flock in the period, at the rate frozen on each issue — its purchase is not an expense here.',
      columns: [col('Batch'), col('Shed'), rcol('Income'), rcol('Direct'), rcol('Feed'), rcol('Medicine'), rcol('Total'), rcol('Result'), rcol('Live birds')],
      emptyText: 'No batch carries a recorded income or expense in this period.',
      rows: rows.map(({ b, income, direct, feed, medicine, live }) => row(b.id, [
        `${b.code} · ${b.birdType}`, ctx.shedName(b.shedId), ctx.money(income), ctx.money(direct),
        ctx.money(feed), ctx.money(medicine), ctx.money(direct + feed + medicine),
        ctx.money(income - direct - feed - medicine), ctx.num(live),
      ], `/batches/${b.id}`, income - direct - feed - medicine >= 0 ? 'success' : 'danger')),
    }],
    notes: [
      'Godown shortage is shared across sheds, not across batches, so it is held out of the batch result rather than spread by a rule that was never defined.',
      'Feed and medicine purchases are inventory movements and never charged to a batch; chicks are expensed on the day they are paid for.',
      'Medicine drawn is derived from the stock ledger, not from a Finance row, so the same rupee is never counted twice.',
    ],
    warnings: [
      ...(rows.some(r => r.unpriced > 0)
        ? ['Some consumed feed has no rate on record, so it is counted but not costed.'] : []),
      ...(rows.some(r => r.unpricedMedicine > 0)
        ? ['Some medicine usage carries no rate on the shelf, so it is counted but not costed.'] : []),
    ],
    links: [{ label: 'Open Batches', href: '/batches' }, { label: 'Shed-wise P&L', href: '/reports/shed_pnl' }],
  });
};

const monthlyPnl: ReportDef['build'] = ctx => {
  const p = pnlTrend(ctx.src.finance, 'MONTH', ctx.range.to);
  const usable = p.buckets.filter(b => b.net !== null);
  const best = usable.length ? usable.reduce((a, b) => (b.net! > a.net! ? b : a)) : null;
  const worst = usable.length ? usable.reduce((a, b) => (b.net! < a.net! ? b : a)) : null;
  return result({
    summary: [
      metric('Months read', ctx.num(usable.length), plural(p.buckets.length, 'bucket') + ' shown'),
      metric('Best month', best ? ctx.money(best.net) : DASH, best?.label),
      metric('Weakest month', worst ? ctx.money(worst.net) : DASH, worst?.label,
        (worst?.net ?? 0) < 0 ? 'danger' : 'ink'),
      metric('Net across them', ctx.money(total(usable.map(b => b.net)))),
    ],
    charts: charts(ctx, monthlyChart(ctx, 'MONTH'), monthlyChart(ctx, 'WEEK')),
    tables: [{
      title: 'Money in against money out, by month',
      caption: 'Cash view of the ledger. A month with no expense row shows a dash, not a zero net.',
      columns: [col('Month'), rcol('Income'), rcol('Expense'), rcol('Net'), rcol('Rows')],
      emptyText: 'No finance rows to bucket.',
      rows: p.buckets.map(b => row(b.label, [
        b.label, ctx.money(b.revenue), ctx.money(b.expense), ctx.money(b.net),
        ctx.num(b.revenueRows + b.expenseRows),
      ], undefined, b.net === null ? 'muted' : b.net >= 0 ? 'success' : 'danger')),
    }],
    notes: ['This is the cash ledger by calendar month; the Farm P&L reads income earned and expense incurred, which is not the same thing.'],
    warnings: p.warnings,
    links: [{ label: 'Open Finance', href: '/finance' }, { label: 'Cash flow statement', href: '/reports/cash_flow' }],
  });
};

function incomePoints(ctx: ReportCtx): Point[] {
  const map = new Map<string, number>();
  const add = (date: string | undefined, v: number | null) => {
    if (!isISODate(date) || v === null) return;
    map.set(date, (map.get(date) ?? 0) + v);
  };
  for (const t of ctx.src.traderTxns) {
    if ((t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT') && inRange(t.date, ctx.range)) add(t.date, fin(t.amount));
  }
  for (const f of ctx.src.finance) {
    if (isInflow(f.kind) && f.kind !== 'PAYMENT_IN' && inRange(f.date, ctx.range)) add(f.date, fin(f.amount));
  }
  return dayKeys(ctx.range.from, ctx.range.to).map(date => ({ date, value: map.get(date) ?? null }));
}

const incomeStatement: ReportDef['build'] = ctx => {
  const billed = ctx.src.traderTxns.filter(t =>
    (t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT') && inRange(t.date, ctx.range));
  const billedTotal = total(billed.map(t => t.amount));
  const other = ctx.src.finance.filter(t => isInflow(t.kind) && t.kind !== 'PAYMENT_IN' && inRange(t.date, ctx.range));
  const otherTotal = total(other.map(t => t.amount));
  const byCat = new Map<string, { amount: number; rows: number }>();
  for (const t of other) {
    const key = t.category || 'Uncategorised';
    const cur = byCat.get(key) ?? { amount: 0, rows: 0 };
    byCat.set(key, { amount: cur.amount + (fin(t.amount) ?? 0), rows: cur.rows + 1 });
  }
  const all = (billedTotal ?? 0) + (otherTotal ?? 0);
  return result({
    summary: [
      metric('Billed to buyers', ctx.money(billedTotal), plural(billed.length, 'bill')),
      metric('Other income', ctx.money(otherTotal), `${other.length} ledger row${other.length === 1 ? '' : 's'}`),
      metric('Income for the period', ctx.money(all), 'Eggs billed once, plus recorded income'),
      metric('Eggs share', billedTotal === null ? DASH : ctx.pct(all ? (billedTotal / all) * 100 : null), 'of everything earned'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'income', title: 'Income earned', format: 'money',
      subtitle: 'Billed sales and other recorded income, by day',
      series: [{ id: 'income', label: 'Income', color: 'brand', points: incomePoints(ctx), area: true }],
    }),
    tables: [{
      title: 'Income lines',
      columns: [col('Line'), rcol('Amount'), col('Basis')],
      emptyText: 'No income recorded in this period.',
      rows: [
        row('billed', ['Eggs billed to buyers', ctx.money(billedTotal), `${plural(billed.length, 'bill')} in the buyers' ledgers`]),
        ...Array.from(byCat.entries())
          .sort((a, b) => b[1].amount - a[1].amount)
          .map(([cat, v]) => row(cat, [cat, ctx.money(v.amount), `${v.rows} finance row${v.rows === 1 ? '' : 's'}`])),
        row('total', ['Total income', ctx.money(all), ''], undefined, 'muted'),
      ],
    }],
    notes: [
      'Eggs are recognised when accounts bills the load into the buyer\'s ledger. A payment received later settles that bill and is not income a second time.',
      'Batch sale and other proceeds are recorded in the finance ledger and appear as their own category lines above.',
    ],
    warnings: billedTotal === null && otherTotal === null ? ['No income of any kind was recorded in this period.'] : [],
    links: [{ label: 'Buyer-wise sales', href: '/reports/buyer_wise_sales' }, { label: 'Open Finance', href: '/finance' }],
  });
};

const expenseStatement: ReportDef['build'] = ctx => {
  const p = pnlOf(ctx);
  const cats = expenseBreakdown(ctx.src.finance, ctx.range)
    .filter(r => !/feed purchase|medicine purchase/i.test(r.label));
  return result({
    summary: [
      metric('Operating expense', ctx.money(p.operatingExpense), 'Excludes feed consumed and inventory'),
      metric('Feed consumed', ctx.money(p.feedExpense), 'Valued at the godown average'),
      metric('Medicine drawn', ctx.money(p.medicineExpense), 'Valued at the store average when it left'),
      metric('Godown shortage', ctx.money(p.shortageExpense),
        p.shortageUnpricedKg ? `${ctx.kg(p.shortageUnpricedKg)} counted unpriced` : undefined),
      metric('Total expense', ctx.money(p.totalExpense)),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'expense_cats', title: 'Where the money went', format: 'money',
      subtitle: 'Operating expense categories recorded in the ledger',
      rows: cats.map(c => ({
        id: c.label, label: c.label, value: c.value, display: ctx.money(c.value),
        sub: c.share === null ? undefined : ctx.pct(c.share * 100),
      })),
    }),
    tables: [{
      title: 'Expense lines',
      caption: 'Feed and medicine purchases are excluded below: they are inventory, and their cost is realised as a shed eats the feed or draws the stock. Chicks are not excluded — a flock is expensed the day it is paid for.',
      columns: [col('Line'), rcol('Amount'), rcol('Share')],
      emptyText: 'No expense recorded in this period.',
      rows: [
        ...cats.map(c => row(c.label, [c.label, ctx.money(c.value), c.share === null ? null : ctx.pct(c.share * 100)])),
        row('feed', ['Feed consumed (derived)', ctx.money(p.feedExpense), null]),
        row('med', ['Medicine drawn (derived)', ctx.money(p.medicineExpense), null]),
        row('short', ['Godown shortage', ctx.money(p.shortageExpense), null]),
        row('total', ['Total expense', ctx.money(p.totalExpense), null], undefined, 'muted'),
        row('inv', ['Memo · feed & medicine purchases', ctx.money(p.inventoryPurchase), 'Inventory, not expense'], undefined, 'muted'),
      ],
    }],
    notes: ['Shares are of the operating expense ledger only, so feed, medicine and shortage — which are derived, not paid out — stay unshared.'],
    warnings: p.warnings,
    links: [{ label: 'Purchase & cost history', href: '/reports/purchase_history' }, { label: 'Feed consumption history', href: '/reports/feed_consumption_history' }],
  });
};

function cashPoints(ctx: ReportCtx): Point[] {
  const map = new Map<string, number>();
  for (const t of ctx.src.finance) {
    if (!inRange(t.date, ctx.range) || fin(t.amount) === null) continue;
    map.set(t.date, (map.get(t.date) ?? 0) + (isInflow(t.kind) ? t.amount : -t.amount));
  }
  return dayKeys(ctx.range.from, ctx.range.to).map(date => ({
    date, value: map.has(date) ? Number(map.get(date)!.toFixed(2)) : null,
  }));
}

const cashFlow: ReportDef['build'] = ctx => {
  const rows = ctx.src.finance.filter(t => inRange(t.date, ctx.range) && fin(t.amount) !== null);
  const groups: { label: string; kind: FinanceTxn['kind']; inflow: boolean }[] = [
    { label: 'Buyer payments received', kind: 'PAYMENT_IN', inflow: true },
    { label: 'Sales taken in cash', kind: 'SALE', inflow: true },
    { label: 'Other income', kind: 'INCOME', inflow: true },
    { label: 'Operating expenses paid', kind: 'EXPENSE', inflow: false },
    { label: 'Feed & stock purchases', kind: 'PURCHASE', inflow: false },
    { label: 'Payments made out', kind: 'PAYMENT_OUT', inflow: false },
  ];
  const moneyIn = total(rows.filter(t => isInflow(t.kind)).map(t => t.amount));
  const moneyOut = total(rows.filter(t => !isInflow(t.kind)).map(t => t.amount));
  return result({
    summary: [
      metric('Cash in', ctx.money(moneyIn), plural(count(rows, t => isInflow(t.kind)), 'receipt')),
      metric('Cash out', ctx.money(moneyOut), plural(count(rows, t => !isInflow(t.kind)), 'payment')),
      metric('Net movement', ctx.money((moneyIn ?? 0) - (moneyOut ?? 0)),
        undefined, (moneyIn ?? 0) - (moneyOut ?? 0) >= 0 ? 'success' : 'danger'),
      metric('Inventory bought', ctx.money(total(rows.filter(isInventoryPurchase).map(t => t.amount))), 'Cash out, not an expense'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'cash', title: 'Cash movement by day', format: 'money',
      subtitle: 'Receipts less payments on each day money moved',
      series: [{ id: 'cash', label: 'Net cash', color: 'brand', points: cashPoints(ctx), area: true }],
    }),
    tables: [{
      title: 'Cash in and out',
      columns: [col('Line'), rcol('In'), rcol('Out'), rcol('Rows')],
      emptyText: 'No money moved in this period.',
      rows: [
        ...groups.map(g => {
          const gr = rows.filter(t => t.kind === g.kind);
          const v = total(gr.map(t => t.amount));
          return row(g.kind + g.label, [g.label, g.inflow ? ctx.money(v) : null, g.inflow ? null : ctx.money(v), ctx.num(gr.length)]);
        }),
        row('net', ['Net movement', ctx.money(moneyIn), ctx.money(moneyOut), ctx.num(rows.length)], undefined, 'muted'),
      ],
    }],
    notes: [
      'The ledger records money as it arrives and leaves. The model carries no opening bank balance, so this states a movement, not a closing cash position.',
      'Feed purchases are cash out but not an expense; the shed is charged when its birds are fed from that stock.',
    ],
    warnings: rows.length ? [] : ['No finance row in this period.'],
    links: [{ label: 'Open Finance', href: '/finance' }, { label: 'Monthly P&L', href: '/reports/monthly_pnl' }],
  });
};

const godownValuation: ReportDef['build'] = ctx => {
  const g = godownLedger(ctx.src.feedStock, ctx.range);
  return result({
    summary: [
      metric('Stock value', ctx.money(g.asOfValue), `as on ${ctx.date(ctx.range.to)}`),
      metric('Stock held', ctx.kg(g.asOfKg), `${g.inStock} ${g.inStock === 1 ? 'ingredient' : 'ingredients'} in stock`),
      metric('Received in period', ctx.kg(g.totals.receivedKg), ctx.money(g.totals.receivedValue)),
      metric('Consumed in period', ctx.kg(g.totals.consumedKg), ctx.money(g.totals.consumedValue)),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'valuation', title: 'What the godown is worth', format: 'money',
      subtitle: 'Closing value by ingredient, at the weighted average in force',
      rows: g.perIngredient.map(r => ({
        id: r.ingredient, label: r.ingredient, value: r.closingValue, display: ctx.money(r.closingValue),
        sub: `${ctx.kg(r.closingKg)} · ${r.avg === null ? 'never priced' : `${ctx.money(r.avg, 2)}/kg`}`,
        tone: r.closingKg < 0 ? 'danger' as const : 'normal' as const,
      })),
    }),
    tables: [{
      title: 'Inventory valuation',
      caption: 'Opening + received − consumed − issued out − short always equals closing; that identity is the ledger\'s own replay.',
      columns: [col('Ingredient'), rcol('Opening'), rcol('In'), rcol('Consumed'), rcol('Out'), rcol('Short'), rcol('Closing'), rcol('Avg ₹/kg'), rcol('Value')],
      emptyText: 'The godown ledger has no entries to value.',
      rows: g.perIngredient.map(r => row(r.ingredient, [
        r.ingredient, ctx.kg(r.openingKg), ctx.kg(r.receivedKg), ctx.kg(r.consumedKg), ctx.kg(r.feedOutKg),
        ctx.kg(r.shortageKg), ctx.kg(r.closingKg), r.avg === null ? null : ctx.money(r.avg, 2), ctx.money(r.closingValue),
      ], `/feed/ingredient/${encodeURIComponent(r.ingredient)}`, r.closingKg < 0 ? 'danger' : undefined)),
    }],
    notes: [
      'This is a balance-sheet figure, not a period expense, so it never adds to the P&L total — which charges only the feed a shed actually ate.',
      'An ingredient the godown has never priced is counted in kg and left out of the value column.',
    ],
    warnings: g.unpricedKg ? [`${ctx.kg(g.unpricedKg)} of stock carries no cost basis and is excluded from the value total.`] : [],
    links: [{ label: 'Open Godown', href: '/feed' }, { label: 'Godown stock history', href: '/reports/godown_stock_history' }],
  });
};

const godownShared: ReportDef['build'] = ctx => {
  const p = pnlOf(ctx);
  const feedCost = feedCostByShed(ctx.src.feed, ctx.src.feedStock, ctx.src.feedFormulas, ctx.range);
  const shares = allocateShortage(p.shortageExpense, feedCost.rows, new Map(ctx.src.sheds.map(s => [s.id, s.name])));
  const godownTxns = latestFirst(ctx.src.finance.filter(t => !t.batchId && t.godown && inRange(t.date, ctx.range)));
  return result({
    summary: [
      metric('Godown operating spend', ctx.money(p.godownOperatingExpense), `${plural(godownTxns.length, 'row')} held at the godown`),
      metric('Shortage recognised', ctx.money(p.shortageExpense),
        p.shortageUnpricedKg ? `${ctx.kg(p.shortageUnpricedKg)} counted unpriced` : undefined),
      metric('Shared to sheds', ctx.money(p.allocatedShortage),
        !p.shortageExpense ? undefined
          : shares.basis === 'feed' ? 'By feed each shed consumed' : 'No priced feed to carry it'),
      metric('Held at farm level', ctx.money(p.unallocatedShortage),
        p.unallocatedShortage ? 'Shortage with no feed to carry it' : undefined),
    ],
    tables: [
      {
        title: 'Shared expense allocated to sheds',
        caption: 'One shortage, recognised once, split by the feed cost each shed drew. The last shed absorbs the rounding, so the shares add back to the shortage to the paisa.',
        columns: [col('Shed'), rcol('Feed consumed'), rcol('Weight'), rcol('Shortage share')],
        emptyText: 'Nothing was allocated: either no shortage was booked, or no shed consumed priced feed.',
        rows: shares.shares.map(s => row(s.shedId, [
          s.shedName, ctx.money(p.sheds.find(x => x.shedId === s.shedId)?.feedExpense ?? 0),
          ctx.pct(s.weight * 100), ctx.money(s.amount, 2),
        ], `/sheds/${s.shedId}`)),
      },
      {
        title: 'Money the godown itself spent',
        columns: [col('Date'), col('Category'), col('Counterparty'), rcol('Amount'), col('Remarks')],
        emptyText: 'No godown-scoped finance row in this period.',
        rows: godownTxns.map(t => row(t.id, [
          ctx.date(t.date), t.category || DASH, t.counterparty ?? DASH, ctx.money(t.amount),
          plainRemarks(t.remarks) ?? DASH,
        ])),
      },
    ],
    notes: [
      'A shortage is never charged as a shed\'s feed consumption and again as a shared cost. It appears once, here, and its shares appear in the Shed-wise P&L.',
      p.unallocatedCount
        ? `${p.unallocatedCount} money row${p.unallocatedCount === 1 ? '' : 's'} could not be mapped to a shed or the godown and stands in Unallocated.`
        : 'Every money row in the period maps to a shed or to the godown.',
    ],
    warnings: p.warnings,
    links: [{ label: 'Shortage history', href: '/reports/shortage_history' }, { label: 'Unmapped money', href: '/reports/unmapped_money' }],
  });
};

/* ============================= 2. SALES & BUYER HISTORY ============================= */

const buyerHistory: ReportDef['build'] = ctx => {
  const rows = loadRows(ctx);
  /** Each voucher next to the money that arrived against it — the load itself is never restated. */
  const loads = salePositions(rows, ctx.src.traderTxns);
  const trays = total(rows.map(e => fin(entryTrays(e))));
  const billed = total(loads.map(l => fin(l.billed)));
  const paid = total(loads.map(l => fin(l.paid)));
  const credit = total(loads.map(l => fin(Math.max(0, l.outstanding))));
  return result({
    summary: [
      metric('Loads billed', ctx.num(rows.length)),
      metric('Trays sold', ctx.trays(trays)),
      metric('Billed', ctx.money(billed), `${ctx.money(total(rows.map(e => fin(e.laborCharge))))} of it labour recovered`),
      metric('Settled', ctx.money(paid), `${ctx.money(credit)} left on the buyer`),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'billed', title: 'Billed value', format: 'money',
      subtitle: 'What each trading day left on buyers\' accounts',
      series: [{ id: 'billed', label: 'Billed', color: 'brand', points: dailyPoints(ctx, rows, 'billed'), area: true }],
    }),
    tables: [{
      title: 'Sales',
      caption: 'Each row is the voucher accounts saved: the load, the money and how it was settled.',
      columns: [col('Date'), col('Buyer'), col('Shed'), col('Batch'), rcol('Trays'), rcol('₹/egg'), rcol('Billed'), rcol('Settled'), rcol('Due'), col('Payment')],
      emptyText: 'No sale entry in this period for these filters.',
      rows: loads.map(({ entry: e, billed: posBilled, paid: posPaid, outstanding, status }) => row(e.id, [
        ctx.date(e.date), ctx.traderName(e.traderId), ctx.shedsOf(e), ctx.batchesOf(e),
        ctx.num(entryTrays(e)), ctx.money(eggRate(e), 2), ctx.money(posBilled), ctx.money(posPaid),
        ctx.money(Math.max(0, outstanding)), status,
      ], `/sales/entry/${e.id}`)),
    }],
    notes: [
      '₹/egg is the egg money of the load over the eggs it carried, so an agreed-figure load still shows the rate it settled at. Labour recovered on the same load sits inside Billed, not inside the rate.',
      'Billed is what the load added to the buyer\'s dues; Settled is the money on the voucher plus every receipt Finance later recorded against that same load.',
      'A receipt settles a load without re-billing it: Billed never moves because money arrived, and one payment is never counted twice.',
    ],
    warnings: [],
    links: [{ label: 'Open Sales', href: '/sales' }, { label: 'Buyer statements', href: '/reports/buyer_statement' }],
  });
};

function balancePoints(ledger: { txn: TraderTxn; running: number }[]): Point[] {
  const byDate = new Map<string, number>();
  for (const l of [...ledger].reverse()) byDate.set(l.txn.date, l.running);
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

const buyerStatement: ReportDef['build'] = ctx => {
  const trader = ctx.src.traders.find(t => t.id === ctx.p.traderId);
  if (!trader) return noData(result({}), 'Choose a buyer to open their statement.');
  const ledger = traderLedger(trader.openingBalance, ctx.src.traderTxns.filter(t => t.traderId === trader.id));
  const rows = ctx.src.traderTxns.filter(t => t.traderId === trader.id);
  const billed = total(rows.filter(t => t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT').map(t => t.amount));
  const received = total(rows.filter(t => t.kind === 'PAYMENT_IN').map(t => t.amount));
  const balance = ledger[0]?.running ?? trader.openingBalance;
  return result({
    summary: [
      metric('Opening balance', ctx.money(trader.openingBalance), 'What the account started at'),
      metric('Billed', ctx.money(billed), plural(count(rows, t => t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT'), 'bill')),
      metric('Received', ctx.money(received), plural(count(rows, t => t.kind === 'PAYMENT_IN'), 'payment')),
      metric('Current balance', ctx.money(balance),
        balance > 0 ? 'Owed to the farm' : balance < 0 ? 'Advance held for the buyer' : 'Settled',
        balance > 0 ? 'danger' : balance < 0 ? 'success' : 'muted'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'balance', title: 'Balance over time', format: 'money',
      subtitle: 'The running balance at the end of each trading day',
      series: [{ id: 'balance', label: 'Balance', color: 'brand', points: balancePoints(ledger), area: true }],
    }),
    tables: [{
      title: `${trader.name} — statement of account`,
      caption: 'Newest day first, and within a day the newest booking leads: a payment can only clear a bill that was already booked.',
      columns: [col('Date'), col('Entry'), col('Paid how'), col('Cash taken by'), col('Reference'), rcol('Effect'), rcol('Running balance')],
      emptyText: 'This account has no ledger rows yet.',
      rows: ledger.map(l => row(l.txn.id, [
        ctx.date(l.txn.date),
        `${TRADER_TXN_LABEL[l.txn.kind]}${l.txn.trays ? ` · ${pluralOf(ctx.num(l.txn.trays), l.txn.trays, 'tray')}` : ''}`,
        l.txn.kind === 'PAYMENT_IN' || l.txn.kind === 'PAYMENT_OUT' ? methodCell(l.txn) : DASH,
        l.txn.kind === 'PAYMENT_IN' && splitOf(l.txn).cash ? ctx.userName(l.txn.handledById) : DASH,
        l.txn.reference ?? (l.txn.refId ? `Sale ${shortId(l.txn.refId)}` : DASH),
        l.txn.kind === 'OPENING' ? 'base' : l.effect === 0 ? DASH
          : l.effect > 0 ? `+${ctx.money(l.effect)}` : `−${ctx.money(Math.abs(l.effect))}`,
        ctx.money(l.running),
      ], l.txn.refId ? `/sales/entry/${l.txn.refId}` : `/traders/${trader.id}`,
      l.running < 0 ? 'success' : undefined)),
    }],
    notes: [
      'A discount or a rebate is not a ledger type in this model, and an advance is typed against the load it settles — so both appear as money in, never as an invented line.',
      'The last row of the running column is the balance every screen in the app reads. There is no second balance source.',
      'A statement is the whole account by nature, so the date filter does not narrow it.',
      '"Paid how" and "Cash taken by" are the payment method and the person who physically held the cash, as booked on the payment itself. A dash means nobody recorded it.',
    ],
    warnings: [],
    links: [{ label: `Open ${trader.name}'s account`, href: `/traders/${trader.id}` }],
  });
};

const buyerWiseSales: ReportDef['build'] = ctx => {
  const byTrader = salesByTrader(ctx.src.traderTxns, ctx.src.traders, ctx.range);
  const received = new Map<string, number>();
  const bills = new Map<string, number>();
  for (const t of ctx.src.traderTxns) {
    if (!inRange(t.date, ctx.range)) continue;
    if (t.kind === 'PAYMENT_IN') received.set(t.traderId, (received.get(t.traderId) ?? 0) + (fin(t.amount) ?? 0));
    if (t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT') bills.set(t.traderId, (bills.get(t.traderId) ?? 0) + 1);
  }
  const dues = new Map(traderOutstanding(ctx.src.traders, ctx.src.traderTxns).map(t => [t.traderId, t.balance]));
  const rows = (ctx.p.traderId ? byTrader.filter(t => t.traderId === ctx.p.traderId) : byTrader)
    .map(s => ({ ...s, received: received.get(s.traderId) ?? 0, balance: dues.get(s.traderId) ?? 0 }));
  const outstanding = total(rows.map(r => Math.max(0, r.balance)));
  return result({
    summary: [
      metric('Buyers trading', ctx.num(rows.length), 'in this period'),
      metric('Billed', ctx.money(total(rows.map(r => r.value)))),
      metric('Received', ctx.money(total(rows.map(r => r.received)))),
      metric('Outstanding', ctx.money(outstanding), 'Across every period', outstanding && outstanding > 0 ? 'danger' : 'success'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'buyer_sales', title: 'Billed by buyer', format: 'money',
      subtitle: 'What each buyer was billed in this period',
      rows: rows.map(r => ({
        id: r.traderId, label: r.name, value: r.value, display: ctx.money(r.value),
        sub: `${ctx.trays(r.trays)} · ${ctx.money(r.balance)} due`,
        tone: r.active ? 'normal' as const : 'muted' as const,
      })),
    }),
    tables: [{
      title: 'Buyer-wise sales',
      columns: [col('Buyer'), col('Status'), rcol('Bills'), rcol('Trays'), rcol('Billed'), rcol('Received'), rcol('Balance')],
      emptyText: 'No buyer was billed in this period.',
      rows: rows.map(r => row(r.traderId, [
        r.name, r.active ? 'Active' : 'Inactive', ctx.num(bills.get(r.traderId) ?? 0), ctx.trays(r.trays),
        ctx.money(r.value), ctx.money(r.received), ctx.money(r.balance),
      ], `/traders/${r.traderId}`, r.balance > 0 ? 'danger' : 'success')),
    }],
    notes: ['Balance is the whole account, not just this period — the same figure the buyer\'s own ledger screen shows.'],
    warnings: [],
    links: [{ label: 'Open Traders', href: '/traders' }, { label: 'Buyer statement', href: '/reports/buyer_statement' }],
  });
};

const salesHistory: ReportDef['build'] = ctx => {
  const rows = latestFirst(ctx.src.traderTxns.filter(t =>
    (t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT')
    && inRange(t.date, ctx.range) && (!ctx.p.traderId || t.traderId === ctx.p.traderId)));
  return result({
    summary: [
      metric('Bills', ctx.num(rows.length)),
      metric('Trays billed', ctx.trays(total(rows.map(t => fin(t.trays))))),
      metric('Value billed', ctx.money(total(rows.map(t => fin(t.amount))))),
      metric('Buyers billed', ctx.num(new Set(rows.map(t => t.traderId)).size)),
    ],
    tables: [{
      title: 'Every bill in the buyers\' ledgers',
      caption: 'These are the rows accounts booked, read from the ledger itself — each one opens the voucher that wrote it.',
      columns: [col('Date'), col('Buyer'), rcol('Trays'), rcol('₹/egg'), rcol('Billed'), col('Written by')],
      emptyText: 'Nothing was billed in this period for this buyer.',
      rows: rows.map(t => row(t.id, [
        ctx.date(t.date), ctx.traderName(t.traderId), ctx.num(t.trays),
        ctx.money(div(fin(t.amount), fin(t.trays)), 2), ctx.money(t.amount),
        t.refId ? 'Sale voucher' : 'Typed on the ledger',
      ], t.refId ? `/sales/entry/${t.refId}` : `/traders/${t.traderId}`)),
    }],
    notes: ['An extra bill raised against a buyer adds to what they owe, so it stands alongside egg sales here.'],
    warnings: [],
    links: [{ label: 'Buyer statements', href: '/reports/buyer_statement' }, { label: 'Sales history of loads', href: '/reports/buyer_history' }],
  });
};

/* ============================= 3. PRICE HISTORY ============================= */

const eggPriceHistory: ReportDef['build'] = ctx => {
  const rows = loadRows(ctx).filter(e => (fin(entryTrays(e)) ?? 0) > 0);
  const rates = rows.map(eggRate).filter((v): v is number => v !== null);
  const billed = total(rows.map(e => fin(e.amount)));
  const trays = total(rows.map(e => fin(entryTrays(e))));
  const skipped = loadRows(ctx).length - rows.length;
  return result({
    summary: [
      metric('Average ₹/egg', ctx.money(ratePerEgg(billed, trays), 2), 'Egg money ÷ eggs'),
      metric('Highest', rates.length ? ctx.money(Math.max(...rates), 2) : DASH, 'on a single load'),
      metric('Lowest', rates.length ? ctx.money(Math.min(...rates), 2) : DASH, 'on a single load'),
      metric('Loads priced', ctx.num(rates.length), skipped ? `${plural(skipped, 'load')} carried no rate` : 'every load priced'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'rate', title: 'Egg selling rate', format: 'money',
      subtitle: '₹ per egg, weighted by the eggs actually billed that day',
      series: [{ id: 'rate', label: '₹/egg', color: 'brand', points: dailyPoints(ctx, rows, 'rate') }],
    }),
    tables: [{
      title: 'Rate history',
      columns: [col('Date'), col('Buyer'), rcol('Trays'), rcol('₹/egg'), rcol('Egg money'), col('Pricing')],
      emptyText: 'No priced load in this period for these filters.',
      rows: rows.map(e => row(e.id, [
        ctx.date(e.date), ctx.traderName(e.traderId), ctx.num(entryTrays(e)),
        ctx.money(eggRate(e), 2), ctx.money(e.amount),
        e.pricing === 'RATE' ? 'Quoted rate' : 'Agreed figure',
      ], `/sales/entry/${e.id}`)),
    }],
    notes: [
      'Average, highest and lowest come from the loads themselves. A load priced by an agreed figure still has a real ₹/egg — its egg money over its eggs.',
      'A load with no trays has no rate, so it is counted out of the price columns rather than read as ₹0.',
    ],
    warnings: rates.length ? [] : ['No load in this period carried both trays and egg money, so no rate can be stated.'],
    links: [{ label: 'Daily average rate', href: '/reports/daily_avg_rate' }, { label: 'Buyer price history', href: '/reports/buyer_price_history' }],
  });
};

const buyerPriceHistory: ReportDef['build'] = ctx => {
  const byBuyer = new Map<string, SaleEntry[]>();
  for (const e of loadRows(ctx)) {
    const own = byBuyer.get(e.traderId) ?? [];
    own.push(e); byBuyer.set(e.traderId, own);
  }
  const rows = Array.from(byBuyer.entries()).map(([traderId, list]) => {
    const withRate = list.map(eggRate).filter((v): v is number => v !== null);
    return {
      traderId, list,
      trays: total(list.map(e => fin(entryTrays(e)))),
      eggs: total(list.map(e => fin(e.amount))),
      low: withRate.length ? Math.min(...withRate) : null,
      high: withRate.length ? Math.max(...withRate) : null,
    };
  }).sort((a, b) => (b.eggs ?? 0) - (a.eggs ?? 0));
  const lows = rows.map(r => r.low).filter((v): v is number => v !== null);
  const highs = rows.map(r => r.high).filter((v): v is number => v !== null);
  return result({
    summary: [
      metric('Buyers priced', ctx.num(rows.length), 'in this period'),
      metric('Trays priced', ctx.trays(total(rows.map(r => r.trays)))),
      metric('Egg money', ctx.money(total(rows.map(r => r.eggs)))),
      metric('Spread', lows.length && highs.length
        ? `${ctx.money(Math.min(...lows), 2)} – ${ctx.money(Math.max(...highs), 2)}` : DASH, 'lowest to highest ₹/egg'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'buyer_rate', title: 'Average ₹/egg by buyer', format: 'money',
      subtitle: 'Each buyer\'s egg money divided by the eggs they took',
      rows: rows.filter(r => ratePerEgg(r.eggs, r.trays) !== null).map(r => ({
        id: r.traderId, label: ctx.traderName(r.traderId), value: Number(ratePerEgg(r.eggs, r.trays)!.toFixed(2)),
        display: ctx.money(ratePerEgg(r.eggs, r.trays), 2),
        sub: `${ctx.trays(r.trays)} · ${ctx.money(r.eggs)}`,
      })),
    }),
    tables: [{
      title: 'Buyer-wise pricing',
      columns: [col('Buyer'), rcol('Loads'), rcol('Trays'), rcol('Egg money'), rcol('Avg ₹/egg'), rcol('Lowest'), rcol('Highest')],
      emptyText: 'No buyer took a priced load in this period.',
      rows: rows.map(r => row(r.traderId, [
        ctx.traderName(r.traderId), ctx.num(r.list.length), ctx.trays(r.trays), ctx.money(r.eggs),
        ctx.money(ratePerEgg(r.eggs, r.trays), 2), ctx.money(r.low, 2), ctx.money(r.high, 2),
      ], `/traders/${r.traderId}`)),
    }],
    notes: ['Lowest and highest are the extremes of individual loads, so one unusual load stays visible instead of hiding inside an average.'],
    warnings: [],
    links: [{ label: 'Rate revisions', href: '/reports/rate_difference_history' }, { label: 'Buyer statement', href: '/reports/buyer_statement' }],
  });
};

const dailyAvgRate: ReportDef['build'] = ctx => {
  const days = billedByDay(loadRows(ctx));
  const points = dayKeys(ctx.range.from, ctx.range.to)
    .map(date => ({ date, value: ratePerEgg(days.get(date)?.eggs ?? null, days.get(date)?.trays ?? null) }));
  const recorded = points.filter(p => p.value !== null);
  const eggs = total(Array.from(days.values()).map(d => d.eggs));
  const trays = total(Array.from(days.values()).map(d => d.trays));
  return result({
    summary: [
      metric('Period average', ctx.money(ratePerEgg(eggs, trays), 2), 'Every egg billed in the window'),
      metric('Highest day', recorded.length ? ctx.money(Math.max(...recorded.map(p => p.value!)), 2) : DASH),
      metric('Lowest day', recorded.length ? ctx.money(Math.min(...recorded.map(p => p.value!)), 2) : DASH),
      metric('Days priced', ctx.num(recorded.length), `${ctx.range.days - recorded.length} sold nothing`),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'daily_rate', title: 'Daily average selling rate', format: 'money',
      subtitle: 'A day with no sale shows a gap, never a rate of zero',
      series: [{ id: 'daily_rate', label: '₹/egg', color: 'brand', points }],
    }),
    tables: [{
      title: 'Rate by day',
      columns: [col('Date'), rcol('Loads'), rcol('Trays'), rcol('Egg money'), rcol('₹/egg')],
      emptyText: 'No egg sale in this period for these filters.',
      rows: Array.from(days.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([date, d]) => row(date, [
        ctx.date(date), ctx.num(d.loads), ctx.num(d.trays), ctx.money(d.eggs),
        ctx.money(ratePerEgg(d.eggs, d.trays), 2),
      ])),
    }],
    notes: ['A day\'s rate is its total egg money over its total eggs — weighted, so a small load cannot swing it. Loading labour is recovered on the same voucher but never enters a rate.'],
    warnings: recorded.length ? [] : ['Nothing was sold in this window, so no daily rate exists to report.'],
    links: [{ label: 'Egg price history', href: '/reports/egg_price_history' }, { label: 'Buyer price history', href: '/reports/buyer_price_history' }],
  });
};

const rateDifferenceHistory: ReportDef['build'] = ctx => {
  const rows = latestFirst(ctx.src.traderTxns.filter(t => t.kind === 'RATE_UPDATE'
    && inRange(t.date, ctx.range) && (!ctx.p.traderId || t.traderId === ctx.p.traderId)));
  const billedWithRate = ctx.src.traderTxns.filter(t => t.kind === 'EGG_SALE'
    && t.rate !== undefined && inRange(t.date, ctx.range));
  return result({
    summary: [
      metric('Revisions', ctx.num(rows.length), 'recorded in buyers\' ledgers'),
      metric('Buyers revised', ctx.num(new Set(rows.map(t => t.traderId)).size)),
      metric('Latest revision', rows.length ? ctx.money(rows[0].rate ?? null, 2) : DASH,
        rows.length ? `${ctx.traderName(rows[0].traderId)} · ${ctx.date(rows[0].date)}` : undefined),
      metric('Bills carrying a rate', ctx.num(billedWithRate.length), 'quoted on the load itself'),
    ],
    tables: [{
      title: 'Rate revisions',
      caption: 'A revision is the ₹/egg a buyer\'s account carries forward; it never re-opens a load that was already billed.',
      columns: [col('Date'), col('Buyer'), rcol('New ₹/egg'), col('Remarks'), col('Booked by')],
      emptyText: 'No rate revision was recorded in this period.',
      rows: rows.map(t => row(t.id, [
        ctx.date(t.date), ctx.traderName(t.traderId), ctx.money(t.rate ?? null, 2),
        plainRemarks(t.remarks) ?? DASH, ctx.userName(t.createdBy),
      ], `/traders/${t.traderId}`)),
    }],
    notes: [
      'A revision carries no amount: it changes the rate the next load is billed at, not the balance already on the account.',
      'There is no discount ledger type in the model, so a difference settled on a load lives inside that load\'s billed figure, not as its own revision row.',
    ],
    warnings: [],
    links: [{ label: 'Egg price history', href: '/reports/egg_price_history' }, { label: 'Buyer statement', href: '/reports/buyer_statement' }],
  });
};

/* ============================= 4. PURCHASE & COST HISTORY ============================= */

const receipts = (ctx: ReportCtx) => latestFirst(ctx.src.feedStock.filter(e =>
  (e.kind === 'FEED_IN' || e.kind === 'OPENING') && inRange(e.date, ctx.range)
  && (!ctx.p.ingredient || e.ingredient === ctx.p.ingredient)));

const receiptValue = (e: FeedStockEntry) => {
  const rate = fin(e.ratePerKg);
  return rate === null ? null : rate * Math.abs(fin(e.qtyKg) ?? 0);
};

/** The godown ledger has no supplier field; a receipt note is the closest thing to one. */
function supplierOf(e: FeedStockEntry): string | null {
  const r = plainRemarks(e.remarks);
  if (!r) return null;
  const m = /^Purchase\s*[—–-]\s*(.+?)(?:\s*\(|$)/.exec(r);
  return m ? m[1].trim() : r;
}

const purchaseHistory: ReportDef['build'] = ctx => {
  const rows = receipts(ctx);
  const kg = total(rows.map(e => Math.abs(fin(e.qtyKg) ?? 0)));
  const paid = total(rows.map(receiptValue));
  const unpricedKg = rows.reduce((s, e) => s + (fin(e.ratePerKg) === null ? Math.abs(fin(e.qtyKg) ?? 0) : 0), 0);
  const byIng = new Map<string, number>();
  for (const e of rows) byIng.set(e.ingredient, (byIng.get(e.ingredient) ?? 0) + Math.abs(fin(e.qtyKg) ?? 0));
  return result({
    summary: [
      metric('Receipts', ctx.num(rows.length), 'feed in, plus opening stock rows'),
      metric('Quantity in', ctx.kg(kg)),
      metric('Paid', ctx.money(paid), unpricedKg ? `${ctx.kg(unpricedKg)} received with no rate` : 'every kg carried a rate'),
      metric('Ingredients', ctx.num(byIng.size)),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'purchased', title: 'What was bought in', format: 'kg',
      subtitle: 'KG received per ingredient in this period',
      rows: Array.from(byIng.entries()).sort((a, b) => b[1] - a[1])
        .map(([ing, v]) => ({ id: ing, label: ing, value: Number(v.toFixed(1)), display: ctx.kg(v) })),
    }),
    tables: [{
      title: 'Purchase history',
      columns: [col('Date'), col('Ingredient'), rcol('Quantity'), rcol('Rate ₹/kg'), rcol('Value'), col('Source note'), col('Entered by')],
      emptyText: 'No receipt into the godown in this period.',
      rows: rows.map(e => row(e.id, [
        ctx.date(e.date), e.ingredient, ctx.kg(Math.abs(e.qtyKg)),
        ctx.money(fin(e.ratePerKg), 2), ctx.money(receiptValue(e)),
        supplierOf(e) ?? DASH, ctx.userName(e.createdBy),
      ], `/feed/ingredient/${encodeURIComponent(e.ingredient)}`)),
    }],
    notes: [
      NO_SUPPLIER_COLUMNS,
      'A receipt is inventory: it enters the godown value here and becomes a shed expense only when that shed is fed from it.',
    ],
    warnings: [],
    links: [{ label: 'Open Godown', href: '/feed' }, { label: 'Purchase price history', href: '/reports/purchase_price_history' }],
  });
};

/** ₹/kg as booked on each receipt that carried one; a day with no receipt is a gap. */
function rateHistoryPoints(ctx: ReportCtx, ingredient: string): Point[] {
  const byDay = new Map<string, number>();
  for (const e of ctx.src.feedStock) {
    if (e.ingredient !== ingredient) continue;
    if (e.kind !== 'FEED_IN' && e.kind !== 'OPENING') continue;
    const rate = fin(e.ratePerKg);
    if (rate !== null) byDay.set(e.date, rate);
  }
  return dayKeys(ctx.range.from, ctx.range.to)
    .map(date => ({ date, value: byDay.get(date) ?? null }));
}

/** The godown average in force on each day, so a paid rate can be read against it. */
function avgAtPoints(ctx: ReportCtx, ingredient: string): Point[] {
  const v = ctx.val();
  return dayKeys(ctx.range.from, ctx.range.to).map(date => ({ date, value: v.avgAt(ingredient, date) }));
}

const ingredientPurchaseHistory: ReportDef['build'] = ctx => {
  const ing = ctx.p.ingredient;
  if (!ing) return pickIngredient(ctx);
  const all = latestFirst(ctx.src.feedStock.filter(e =>
    e.ingredient === ing && (e.kind === 'FEED_IN' || e.kind === 'OPENING')));
  const rows = all.filter(e => inRange(e.date, ctx.range));
  const rates = rows.map(e => fin(e.ratePerKg)).filter((v): v is number => v !== null);
  return result({
    summary: [
      metric('Receipts', ctx.num(rows.length), ing),
      metric('Quantity', ctx.kg(total(rows.map(e => Math.abs(fin(e.qtyKg) ?? 0))))),
      metric('Paid', ctx.money(total(rows.map(receiptValue)))),
      metric('Average rate paid', rates.length ? ctx.money(mean(rates), 2) : DASH, 'of the receipts that carried a rate'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: `price_${ing}`, title: `${ing} — rate paid`, format: 'money',
      subtitle: '₹/kg as booked on each receipt. The current godown average never overwrites history.',
      series: [
        { id: 'paid', label: 'Rate paid', color: 'brand', points: rateHistoryPoints(ctx, ing) },
        { id: 'avg', label: 'Godown average', color: 'teal', points: avgAtPoints(ctx, ing), dashed: true },
      ],
    }),
    tables: [{
      title: `${ing} receipts`,
      columns: [col('Date'), col('Type'), rcol('Quantity'), rcol('Rate ₹/kg'), rcol('Value'), col('Source note'), col('Entered by')],
      emptyText: 'This ingredient was not received in this period.',
      rows: rows.map(e => row(e.id, [
        ctx.date(e.date), e.kind === 'OPENING' ? 'Opening stock' : 'Feed in', ctx.kg(Math.abs(e.qtyKg)),
        ctx.money(fin(e.ratePerKg), 2), ctx.money(receiptValue(e)),
        supplierOf(e) ?? DASH, ctx.userName(e.createdBy),
      ])),
    }],
    notes: [
      NO_SUPPLIER_COLUMNS,
      rows.some(e => fin(e.ratePerKg) === null)
        ? 'A receipt booked without a rate shows a dash: its kg are counted, its cost is not guessed.'
        : 'Every receipt of this ingredient in the window carried a rate.',
    ],
    warnings: all.length && !rows.length ? ['This ingredient has receipts, but none inside the chosen dates.'] : [],
    links: [{ label: `Full ${ing} ledger`, href: `/feed/ingredient/${encodeURIComponent(ing)}` }],
  });
};

const purchasePriceHistory: ReportDef['build'] = ctx => {
  const v = ctx.val();
  const rows = receipts(ctx);
  const priced = rows.filter(e => fin(e.ratePerKg) !== null);
  const rates = priced.map(e => fin(e.ratePerKg)!);
  const ingredients = Array.from(new Set(rows.map(r => r.ingredient)));
  return result({
    summary: [
      metric('Priced receipts', ctx.num(priced.length), `${rows.length - priced.length} without a rate`),
      metric('Ingredients bought', ctx.num(ingredients.length)),
      metric('Highest ₹/kg', rates.length ? ctx.money(Math.max(...rates), 2) : DASH, 'as paid'),
      metric('Lowest ₹/kg', rates.length ? ctx.money(Math.min(...rates), 2) : DASH, 'as paid'),
    ],
    charts: ctx.p.ingredient ? charts(ctx, {
      kind: 'trend', id: `landed_${ctx.p.ingredient}`, title: `${ctx.p.ingredient} — landed rate`, format: 'money',
      subtitle: '₹/kg paid on each receipt against the godown average it produced',
      series: [
        { id: 'paid', label: 'Rate paid', color: 'brand', points: rateHistoryPoints(ctx, ctx.p.ingredient) },
        { id: 'avg', label: 'Godown average', color: 'teal', points: avgAtPoints(ctx, ctx.p.ingredient), dashed: true },
      ],
    }) : [],
    tables: [{
      title: 'Purchase price history',
      caption: 'The rate paid on the voucher, and the weighted average that receipt left behind in the godown.',
      columns: [col('Date'), col('Ingredient'), rcol('Quantity'), rcol('Rate paid'), rcol('Avg after'), rcol('Movement value')],
      emptyText: 'No receipt in this period to price.',
      rows: rows.map(e => {
        const b = v.basis(e.id);
        return row(e.id, [
          ctx.date(e.date), e.ingredient, ctx.kg(Math.abs(e.qtyKg)),
          ctx.money(fin(e.ratePerKg), 2), ctx.money(b.avg, 2), ctx.money(b.value),
        ], `/feed/ingredient/${encodeURIComponent(e.ingredient)}`);
      }),
    }],
    notes: [
      'A historical rate is kept exactly as it was booked. The godown\'s current weighted average is shown beside it as its own column, never in place of it.',
      NO_SUPPLIER_COLUMNS,
    ],
    warnings: [],
    links: [{ label: 'Purchase history', href: '/reports/purchase_history' }, { label: 'Godown stock history', href: '/reports/godown_stock_history' }],
  });
};

/** Reports that cannot stand without a pick: the screen asks instead of showing nothing. */
function pickIngredient(ctx: ReportCtx): ReportResult {
  const v = ctx.val();
  return noData({
    tables: [{
      title: 'Ingredients in the godown',
      caption: 'Choose one to read its history.',
      columns: [col('Ingredient'), rcol('Stock now')],
      emptyText: 'The godown ledger holds no ingredients yet.',
      rows: godownIngredients(ctx.src.feedStock).map(i => row(i, [i, ctx.kg(v.now(i).kg)], `/reports/ingredient_stock_history?ingredient=${encodeURIComponent(i)}`)),
    }],
  }, 'Choose an ingredient for this report.');
}

/* ============================= 5. OPERATIONS & STOCK HISTORY ============================= */

const eggCollectionHistory: ReportDef['build'] = ctx => {
  const filtered = ctx.src.eggs.filter(e => inRange(e.date, ctx.range)
    && (!ctx.p.shedId || e.shedId === ctx.p.shedId) && (!ctx.p.batchId || e.batchId === ctx.p.batchId));
  const rows = latestFirst(filtered);
  const p = eggProductionTrend(ctx.src.eggs.filter(e => !ctx.p.shedId || e.shedId === ctx.p.shedId), ctx.range);
  const g = filtered.reduce((a, e) => ({
    GOOD: a.GOOD + (fin(e.goodTrays) ?? 0), BROKEN: a.BROKEN + (fin(e.brokenTrays) ?? 0),
    DOUBLE: a.DOUBLE + (fin(e.doubleTrays) ?? 0), SMALL: a.SMALL + (fin(e.smallTrays) ?? 0),
  }), { GOOD: 0, BROKEN: 0, DOUBLE: 0, SMALL: 0 });
  const all = gradeTotal(g);
  return result({
    summary: [
      metric('Collection records', ctx.num(rows.length)),
      metric('Trays collected', ctx.num(all)),
      metric('Good trays', ctx.num(g.GOOD), all ? ctx.pct((g.GOOD / all) * 100) : DASH),
      metric('Broken', ctx.num(g.BROKEN), all ? ctx.pct((g.BROKEN / all) * 100) : DASH, g.BROKEN ? 'warn' : 'ink'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'collection', title: 'Trays collected', format: 'trays',
      subtitle: ctx.p.shedId ? 'This shed only' : 'Every shed; a day with no record is a gap',
      series: [
        { id: 'all', label: 'All trays', color: 'brand', points: p.points, area: true },
        { id: 'good', label: 'Good trays', color: 'teal', points: p.goodPoints, dashed: true },
      ],
      warnings: p.warnings,
    }),
    tables: [{
      title: 'Egg collection',
      columns: [col('Date'), col('Shed'), col('Batch'), rcol('Good'), rcol('Broken'), rcol('Double'), rcol('Small'), rcol('Total'), col('Recorded by')],
      emptyText: 'No collection recorded in this period for these filters.',
      rows: rows.map(e => row(e.id, [
        ctx.date(e.date), ctx.shedName(e.shedId), ctx.batchCode(e.batchId),
        ctx.num(e.goodTrays), ctx.num(e.brokenTrays), ctx.num(e.doubleTrays), ctx.num(e.smallTrays),
        ctx.num(gradeTotal({
          GOOD: fin(e.goodTrays) ?? 0, BROKEN: fin(e.brokenTrays) ?? 0,
          DOUBLE: fin(e.doubleTrays) ?? 0, SMALL: fin(e.smallTrays) ?? 0,
        })),
        e.workerName ?? ctx.userName(e.createdBy),
      ], e.batchId ? `/batches/${e.batchId}/eggs` : undefined)),
    }],
    notes: ['The four grades are separate sellable pools; the total is their sum, never a re-grade of anything.'],
    warnings: p.warnings,
    links: [{ label: 'Egg price history', href: '/reports/egg_price_history' }],
  });
};

const feedConsumptionHistory: ReportDef['build'] = ctx => {
  const traces = feedExpenseTraces(ctx.src.feed, ctx.src.feedStock, ctx.src.feedFormulas, ctx.range)
    .filter(t => (!ctx.p.shedId || t.shedId === ctx.p.shedId) && (!ctx.p.batchId || t.batchId === ctx.p.batchId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.consumptionId.localeCompare(a.consumptionId));
  const cost = feedCostTrend(ctx.src.feed, ctx.src.feedStock, ctx.src.feedFormulas, ctx.range);
  return result({
    summary: [
      metric('Feedings', ctx.num(traces.length)),
      metric('Tonnes offered', ctx.num(total(traces.map(t => t.tonnes)), 1), 'tonnes'),
      metric('Cost', ctx.money(total(traces.filter(t => !t.missingFormula).map(t => t.cost))), 'Priced at the godown average of the day'),
      metric('Unpriced feed', ctx.kg(total(traces.map(t => t.unpricedKg))), 'counted, never valued at zero'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'feed_cost', title: 'Feed cost by day', format: 'money',
      subtitle: 'What the day\'s feed actually cost the sheds',
      series: [{ id: 'feed_cost', label: 'Feed cost', color: 'brand', points: cost.points, area: true }],
      warnings: cost.warnings,
    }),
    tables: [{
      title: 'Feed consumption',
      caption: 'Each feeding carries the formula version it was booked against, so history cannot be re-priced by a later revision.',
      columns: [col('Date'), col('Shed'), col('Batch'), col('Formula'), rcol('Tonnes'), rcol('Ingredients'), rcol('Cost'), col('Basis')],
      emptyText: 'No feed was recorded for these dates and filters.',
      rows: traces.map(t => row(t.consumptionId, [
        ctx.date(t.date), ctx.shedName(t.shedId), ctx.batchCode(t.batchId),
        t.formulaName ? `${t.formulaName}${t.formulaVersion ? ` V${t.formulaVersion}` : ''}` : 'No formula pinned',
        ctx.num(t.tonnes, 2), ctx.num(t.lines.length),
        t.missingFormula ? null : ctx.money(t.cost),
        t.missingFormula ? 'formula unavailable — not costed'
          : t.unpricedKg > 0 ? `${ctx.kg(t.unpricedKg)} had no average` : 'godown average',
      ], `/sheds/${t.shedId}`)),
    }],
    notes: [
      'Cost is each ingredient drawn × the godown weighted average in force the moment it left the shelf — the same number that stands as the shed\'s feed expense in the P&L.',
      'A feeding whose formula version is gone is listed with its tonnes and left uncosted rather than costed at a guess.',
    ],
    warnings: cost.warnings,
    links: [{ label: 'Open Godown ledger', href: '/feed' }, { label: 'Formula usage', href: '/reports/formula_usage' }],
  });
};

const godownStockHistory: ReportDef['build'] = ctx => {
  const v = ctx.val();
  const movements = godownMovements(ctx.src.feedStock, v, ctx.src)
    .filter(m => inRange(m.date, ctx.range) && (!ctx.p.ingredient || m.lines.some(l => l.ingredient === ctx.p.ingredient)));
  const kinds = new Map<string, { count: number; kg: number }>();
  for (const m of movements) {
    const cur = kinds.get(m.kind) ?? { count: 0, kg: 0 };
    kinds.set(m.kind, { count: cur.count + 1, kg: cur.kg + m.totalKg * (m.incoming ? 1 : -1) });
  }
  const overall = v.totals(ctx.range.to);
  const shortage = kinds.get('SHORTAGE');
  return result({
    summary: [
      metric('Movements', ctx.num(movements.length), 'grouped as the godown thinks of them'),
      metric('Ingredients touched', ctx.num(new Set(movements.flatMap(m => m.lines.map(l => l.ingredient))).size)),
      metric('Stock as on report', ctx.kg(overall.kg), ctx.money(overall.value)),
      metric('Shortage booked', ctx.kg(shortage ? Math.abs(shortage.kg) : 0), plural(shortage?.count ?? 0, 'event')),
    ],
    tables: [{
      title: 'Godown stock ledger',
      caption: 'One row per event. Running stock is every ingredient in the godown at the close of that day; per-ingredient running stock is in Ingredient stock history.',
      columns: [col('Date'), col('Event'), col('Detail'), rcol('Movement'), rcol('Value'), rcol('Running stock')],
      emptyText: 'No godown movement in this period.',
      rows: movements.map(m => row(m.key, [
        ctx.date(m.date), MOVEMENT_LABEL[m.kind],
        m.kind === 'CONSUMPTION' ? m.context : (m.ingredient ?? m.context),
        `${m.incoming ? '+' : '−'}${fmtKg(m.totalKg, Number.isInteger(m.totalKg) ? 0 : 1)}`,
        m.value === null ? (m.unpricedKg ? `${ctx.kg(m.unpricedKg)} unpriced` : DASH) : ctx.money(m.value),
        ctx.kg(v.totals(m.date).kg),
      ], m.kind === 'CONSUMPTION' ? `/sheds/${m.entries[0]?.shedId ?? ''}`
        : m.ingredient ? `/feed/ingredient/${encodeURIComponent(m.ingredient)}` : undefined,
      m.kind === 'SHORTAGE' ? 'danger' : undefined)),
    }],
    notes: [
      'A shortage is its own event type and its own money line. It is never folded into feed consumption, because no shed ate it.',
      'A movement the godown cannot price is counted in kg and shown as unpriced, never as ₹0.',
    ],
    warnings: [],
    links: [{ label: 'Open Godown', href: '/feed' }, { label: 'Shortage history', href: '/reports/shortage_history' }],
  });
};

const ingredientStockHistory: ReportDef['build'] = ctx => {
  const ing = ctx.p.ingredient;
  if (!ing) return pickIngredient(ctx);
  const v = ctx.val();
  const movements = godownMovements(ctx.src.feedStock, v, ctx.src);
  const events = ingredientEvents(movements, ing).filter(e => inRange(e.movement.date, ctx.range));
  const t = ingredientStockTrend(ctx.src.feedStock, ing, ctx.range);
  return result({
    summary: [
      metric('Closing stock', ctx.kg(t.current), `as on ${ctx.date(ctx.range.to)}`),
      metric('Received', ctx.kg(t.totalReceived)),
      metric('Consumed', ctx.kg(t.totalConsumed)),
      metric('Average use', t.avgDailyUse === null ? DASH : ctx.kg(t.avgDailyUse), 'per day across the window'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: `stock_${ing}`, title: `${ing} — stock on hand`, format: 'kg',
      subtitle: 'Closing position each day, from the ledger\'s own replay',
      series: [{ id: 'stock', label: 'Stock', color: 'brand', points: t.closing, area: true }],
      warnings: t.warnings,
    }),
    tables: [{
      title: `${ing} movement history`,
      caption: 'Stock after is this ingredient\'s own position, read off the ledger row exactly as the replay computed it.',
      columns: [col('Date'), col('Event'), col('Through'), rcol('In'), rcol('Out'), rcol('₹/kg applied'), rcol('Value'), rcol('Stock after')],
      emptyText: 'This ingredient did not move in this period.',
      rows: events.map(({ movement, line }) => row(movement.key + line.entryId, [
        ctx.date(movement.date), MOVEMENT_LABEL[movement.kind], movement.title,
        movement.incoming ? ctx.kg(line.qtyKg) : null,
        movement.incoming ? null : ctx.kg(line.qtyKg),
        ctx.money(line.avg, 2), line.cost === null ? 'unpriced' : ctx.money(line.cost),
        ctx.kg(line.place?.after.kg ?? null),
      ])),
    }],
    notes: ['Where a movement left a line unpriced, the kg are counted and the money column says so instead of showing zero.'],
    warnings: t.warnings,
    links: [{ label: `Full ${ing} ledger`, href: `/feed/ingredient/${encodeURIComponent(ing)}` }],
  });
};

const shortageHistory: ReportDef['build'] = ctx => {
  const rows = shortageRows(ctx.src.feedStock, ctx.range)
    .filter(r => !ctx.p.ingredient || r.ingredient === ctx.p.ingredient);
  const entries = new Map(ctx.src.feedStock.map(e => [e.id, e]));
  const p = pnlOf(ctx);
  return result({
    summary: [
      metric('Shortage events', ctx.num(rows.length)),
      metric('Quantity lost', ctx.kg(total(rows.map(r => r.kg)))),
      metric('Value lost', ctx.money(p.shortageExpense),
        p.shortageUnpricedKg ? `${ctx.kg(p.shortageUnpricedKg)} counted unpriced` : undefined, 'danger'),
      metric('Shared to sheds', ctx.money(p.allocatedShortage),
        !p.shortageExpense ? undefined
          : p.unallocatedShortage ? `${ctx.money(p.unallocatedShortage)} held at farm level`
            : 'Fully allocated'),
    ],
    tables: [{
      title: 'Stock shortage history',
      columns: [col('Date'), col('Ingredient'), rcol('Quantity'), rcol('₹/kg'), rcol('Value'), col('Reason'), col('Counted by'), col('Allocation')],
      emptyText: 'Nothing was booked short in this period.',
      rows: rows.map(r => {
        const e = entries.get(r.id);
        return row(r.id, [
          ctx.date(r.date), r.ingredient, ctx.kg(r.kg), ctx.money(r.avg, 2), ctx.money(r.value),
          plainRemarks(e?.remarks) ?? 'No reason noted', ctx.userName(e?.createdBy),
          p.allocatedShortage ? 'Shared by feed consumed' : 'Held at farm level',
        ], `/feed/ingredient/${encodeURIComponent(r.ingredient)}`, 'danger');
      }),
    }],
    notes: [
      'A shortage is valued at the godown average in force the moment the loss was booked, and recognised once: it is a shared godown expense, never a shed\'s feed.',
      'A shortage with no cost basis is counted in kg and left out of the money total.',
    ],
    warnings: p.warnings.filter(w => /shortage/i.test(w)),
    links: [{ label: 'Shared godown expense statement', href: '/reports/godown_shared' }],
  });
};

const adjustmentHistory: ReportDef['build'] = ctx => {
  const rows = latestFirst(ctx.src.feedStock.filter(e => e.kind === 'ADJUSTMENT' && inRange(e.date, ctx.range)
    && (!ctx.p.ingredient || e.ingredient === ctx.p.ingredient)));
  const v = ctx.val();
  const positive = rows.filter(e => stockDelta(e) > 0);
  const negative = rows.filter(e => stockDelta(e) < 0);
  return result({
    summary: [
      metric('Adjustments', ctx.num(rows.length)),
      metric('Stock added back', ctx.kg(total(positive.map(e => Math.abs(fin(e.qtyKg) ?? 0))))),
      metric('Stock written off', ctx.kg(total(negative.map(e => Math.abs(fin(e.qtyKg) ?? 0)))), 'these read as shortages'),
      metric('Ingredients touched', ctx.num(new Set(rows.map(r => r.ingredient)).size)),
    ],
    tables: [{
      title: 'Stock adjustment history',
      columns: [col('Date'), col('Ingredient'), rcol('Quantity'), rcol('₹/kg'), rcol('Value'), col('Reason'), col('Booked by')],
      emptyText: 'No adjustment was booked in this period.',
      rows: rows.map(e => {
        const b = v.basis(e.id);
        return row(e.id, [
          ctx.date(e.date), e.ingredient,
          `${stockDelta(e) > 0 ? '+' : '−'}${ctx.kg(Math.abs(e.qtyKg))}`,
          ctx.money(b.avg, 2), ctx.money(b.value),
          plainRemarks(e.remarks) ?? 'No reason noted', ctx.userName(e.createdBy),
        ], `/feed/ingredient/${encodeURIComponent(e.ingredient)}`, stockDelta(e) < 0 ? 'danger' : 'success');
      }),
    }],
    notes: ['A negative adjustment is a shortage: stock that left the godown without a shed taking feed. Shortage history reports those on their own terms.'],
    warnings: [],
    links: [{ label: 'Shortage history', href: '/reports/shortage_history' }],
  });
};

const mortalityHistory: ReportDef['build'] = ctx => {
  const rows = latestFirst(ctx.src.mortality.filter(m => inRange(m.date, ctx.range)
    && (!ctx.p.shedId || m.shedId === ctx.p.shedId) && (!ctx.p.batchId || m.batchId === ctx.p.batchId)));
  const t = mortalityTrend(ctx.src.mortality, ctx.src.batches, ctx.range,
    { shedId: ctx.p.shedId, batchId: ctx.p.batchId });
  return result({
    summary: [
      metric('Deaths', ctx.num(t.total), 'recorded in this period'),
      metric('Daily average', t.avg7 === null ? DASH : ctx.num(t.avg7, 1)),
      metric('Birds live', ctx.num(t.liveBirds), 'on the report date'),
      metric('Worst day', t.worst ? ctx.num(t.worst.value) : DASH, t.worst ? ctx.date(t.worst.date) : undefined,
        t.worst ? 'danger' : 'ink'),
    ],
    charts: charts(ctx, {
      kind: 'trend', id: 'mortality', title: 'Mortality', format: 'birds',
      subtitle: 'Deaths recorded each day, and the running total behind them',
      series: [
        { id: 'mortality', label: 'Deaths', color: 'danger', points: t.points },
        { id: 'cumulative', label: 'Cumulative', color: 'muted', points: t.cumulative, dashed: true },
      ],
      warnings: t.warnings,
    }),
    tables: [
      {
        title: 'Mortality history',
        columns: [col('Date'), col('Shed'), col('Batch'), rcol('Deaths'), col('Found by'), col('Remarks')],
        emptyText: 'No mortality recorded in this period for these filters.',
        rows: rows.map(m => row(m.id, [
          ctx.date(m.date), ctx.shedName(m.shedId), ctx.batchCode(m.batchId), ctx.num(m.count),
          m.workerName ?? ctx.userName(m.createdBy), plainRemarks(m.remarks) ?? DASH,
        ], m.batchId ? `/batches/${m.batchId}/mortality` : undefined)),
      },
    ],
    notes: ['The cumulative line counts records before the window too, so the running total starts at the true figure.'],
    warnings: t.warnings,
    links: [{ label: 'Open Batches', href: '/batches' }],
  });
};

const batchHistory: ReportDef['build'] = ctx => {
  const rows = ctx.src.batches
    .filter(b => !ctx.p.shedId || b.shedId === ctx.p.shedId)
    .slice()
    .sort((a, b) => (b.placementDate || b.startDate).localeCompare(a.placementDate || a.startDate));
  return result({
    summary: [
      metric('Batches', ctx.num(rows.length), 'across every status'),
      metric('Birds placed', ctx.num(total(rows.map(r => fin(r.initialBirds))))),
      metric('Live today', ctx.num(total(rows.filter(r => r.status === 'ACTIVE').map(r => liveBirdsOn(r, todayISO(), ctx.src.mortality))))),
      metric('Closed', ctx.num(count(rows, r => r.status === 'CLOSED'))),
    ],
    tables: [{
      title: 'Batch history',
      caption: 'Whole-life figures, so the date filter does not narrow this report.',
      columns: [col('Batch'), col('Shed'), col('Type'), col('Placed'), rcol('Birds in'), rcol('Age (days)'), rcol('Live'), rcol('Mortality'), col('Status')],
      emptyText: 'No batch has been placed in this company.',
      rows: rows.map(b => {
        const mort = cumulativeMortality(b.id, ctx.src.mortality);
        return row(b.id, [
          b.code, ctx.shedName(b.shedId), b.birdType, ctx.date(b.placementDate || b.startDate),
          ctx.num(b.initialBirds), ctx.num(batchAgeDays(b)), ctx.num(liveBirdsOn(b, todayISO(), ctx.src.mortality)),
          ctx.pct(div(mort, fin(b.initialBirds)) === null ? null : (mort / b.initialBirds) * 100),
          b.status === 'CLOSED' ? `Closed ${ctx.date(b.closing?.date ?? '')}` : b.status === 'PLANNED' ? 'Planned' : 'Active',
        ], `/batches/${b.id}`, b.status === 'CLOSED' ? 'muted' : undefined);
      }),
    }],
    notes: ['Age and live birds are computed from placement and the mortality ledger — the same rule the batch screen uses.'],
    warnings: [],
    links: [{ label: 'Open Batches', href: '/batches' }, { label: 'Printable daily report', href: PRINT_HREF }],
  });
};

const shedActivityHistory: ReportDef['build'] = ctx => {
  type Day = { collected: number; sold: number; feedT: number; deaths: number; notes: number };
  const map = new Map<string, Day>();
  const at = (date: string, shedId: string): Day => {
    const key = `${date}|${shedId}`;
    let cur = map.get(key);
    if (!cur) { cur = { collected: 0, sold: 0, feedT: 0, deaths: 0, notes: 0 }; map.set(key, cur); }
    return cur;
  };
  const shed = (id?: string) => !ctx.p.shedId || id === ctx.p.shedId;
  for (const e of ctx.src.eggs) {
    if (!inRange(e.date, ctx.range) || !shed(e.shedId)) continue;
    if (ctx.p.batchId && e.batchId !== ctx.p.batchId) continue;
    at(e.date, e.shedId).collected += gradeTotal({
      GOOD: fin(e.goodTrays) ?? 0, BROKEN: fin(e.brokenTrays) ?? 0,
      DOUBLE: fin(e.doubleTrays) ?? 0, SMALL: fin(e.smallTrays) ?? 0,
    });
  }
  for (const e of ctx.src.saleEntries) {
    if (!inRange(e.date, ctx.range)) continue;
    for (const l of e.lines) if (shed(l.shedId)) at(e.date, l.shedId).sold += gradeTotal(l.byGrade);
  }
  for (const f of ctx.src.feed) {
    if (!inRange(f.date, ctx.range) || !shed(f.shedId)) continue;
    if (ctx.p.batchId && f.batchId !== ctx.p.batchId) continue;
    at(f.date, f.shedId).feedT += fin(f.tonnes) ?? 0;
  }
  for (const m of ctx.src.mortality) {
    if (!inRange(m.date, ctx.range) || !shed(m.shedId)) continue;
    if (ctx.p.batchId && m.batchId !== ctx.p.batchId) continue;
    at(m.date, m.shedId).deaths += fin(m.count) ?? 0;
  }
  for (const s of ctx.src.saleLogs) {
    if (!inRange(s.date, ctx.range) || !shed(s.shedId)) continue;
    at(s.date, s.shedId).notes += 1;
  }
  const rows = Array.from(map.entries())
    .filter(([, d]) => d.collected || d.sold || d.feedT || d.deaths || d.notes)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, d]) => ({ key, date: key.slice(0, 10), shedId: key.slice(11), ...d }));
  return result({
    summary: [
      metric('Shed-days logged', ctx.num(rows.length), 'with any activity'),
      metric('Trays collected', ctx.num(total(rows.map(r => r.collected)))),
      metric('Trays sold', ctx.num(total(rows.map(r => r.sold)))),
      metric('Feed offered', ctx.num(total(rows.map(r => r.feedT)), 1), 'tonnes'),
    ],
    tables: [{
      title: 'Shed activity',
      caption: 'One row per shed per day: what it laid, what left it, what its birds ate and what died.',
      columns: [col('Date'), col('Shed'), col('Batch'), rcol('Collected'), rcol('Sold'), rcol('Feed t'), rcol('Deaths'), rcol('Dispatch notes')],
      emptyText: 'No shed recorded any activity in this period.',
      rows: rows.map(r => row(r.key, [
        ctx.date(r.date), ctx.shedName(r.shedId),
        ctx.batchCode(batchOfShedOn(ctx.src.batches, r.shedId, r.date)?.id),
        ctx.num(r.collected), ctx.num(r.sold), ctx.num(r.feedT, 2), ctx.num(r.deaths), ctx.num(r.notes),
      ], `/sheds/${r.shedId}`)),
    }],
    notes: ['Dispatch notes are shed movements accounts has not yet billed. They do not reduce stock, so they are counted here as activity only.'],
    warnings: [],
    links: [{ label: 'Egg collection history', href: '/reports/egg_collection_history' }],
  });
};

const formulaUsage: ReportDef['build'] = ctx => {
  const v = ctx.val();
  const rows = ctx.src.feedFormulas
    .filter(f => !ctx.p.shedId || f.shedId === ctx.p.shedId)
    .map(f => {
      const used = feedingsOfFormula(f, ctx.src.feed, ctx.src.feedFormulas).filter(c => inRange(c.date, ctx.range));
      return {
        f, used: used.length,
        tonnes: total(used.map(c => fin(c.tonnes))),
        costNow: formulaCostPerTonne(f, i => v.avgAt(i, ctx.range.to)),
      };
    })
    .sort((a, b) => (b.tonnes ?? 0) - (a.tonnes ?? 0) || b.f.version - a.f.version);
  return result({
    summary: [
      metric('Formula versions', ctx.num(rows.length)),
      metric('Used in period', ctx.num(count(rows, r => r.used > 0))),
      metric('Tonnes fed', ctx.num(total(rows.map(r => r.tonnes)), 1), 'tonnes'),
      metric('Never used', ctx.num(count(rows, r => r.used === 0)), 'nothing was fed against them'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'formula_usage', title: 'Tonnes fed by formula', format: 'tonnes',
      subtitle: 'Which mix version actually drove the feed bills',
      rows: rows.filter(r => (r.tonnes ?? 0) > 0).map(r => ({
        id: r.f.id, label: `${r.f.name} V${r.f.version}`, value: Number(r.tonnes!.toFixed(2)),
        display: `${ctx.num(r.tonnes, 2)} t`, sub: `${plural(r.used, 'feeding')} · ${ctx.shedName(r.f.shedId)}`,
        tone: r.f.status === 'ACTIVE' ? 'normal' as const : 'muted' as const,
      })),
    }),
    tables: [{
      title: 'Feed formula usage',
      caption: '₹/tonne now applies the godown average at the report date to the mix — what the same tonne would cost today, not what history charged.',
      columns: [col('Formula'), col('Shed'), rcol('Version'), col('Effective from'), rcol('Feedings'), rcol('Tonnes'), rcol('₹/tonne now'), col('Status')],
      emptyText: 'No formula is defined for this shed.',
      rows: rows.map(({ f, used, tonnes, costNow }) => row(f.id, [
        f.name, ctx.shedName(f.shedId), `V${f.version}`, ctx.date(f.effectiveFrom),
        ctx.num(used), ctx.num(tonnes, 2), ctx.money(costNow || null),
        f.status === 'ACTIVE' ? 'Active' : 'Superseded',
      ], `/feed/formulas/${f.id}`, f.status === 'ACTIVE' ? undefined : 'muted')),
    }],
    notes: ['A feeding keeps the version it was booked against, so a later revision of the same formula cannot re-write what a shed was charged.'],
    warnings: [],
    links: [{ label: 'Open Formulas', href: '/feed/formulas' }, { label: 'Feed consumption history', href: '/reports/feed_consumption_history' }],
  });
};

const BLOCKER_LABEL: Record<'NO_INTAKE' | 'NO_FORMULA', string> = {
  NO_INTAKE: 'Intake not set',
  NO_FORMULA: 'Formula not assigned',
};

/**
 * Feed stock coverage: today's shelf against what the live batches are expected to eat.
 * A forecast read off the batches' approximate intake and the formula version each shed
 * is on today — it books no consumption, no ledger movement and no expense.
 */
const feedStockCoverage: ReportDef['build'] = ctx => {
  const asOf = ctx.range.to;
  const forecast = feedForecast(ctx.src.batches, ctx.src.feedFormulas, asOf, id => ctx.shedName(id));
  const v = ctx.val();
  const every = coverageRows(forecast, new Set(ctx.src.feedStock.map(e => e.ingredient)), ing => v.now(ing).kg);
  const rows = every.filter(r => !ctx.p.ingredient || r.ingredient === ctx.p.ingredient).sort(compareCoverage);
  const bands = coverageBands(every);
  const toneOf = (r: IngredientCoverage) =>
    r.status === 'CRITICAL' ? 'danger' as const : r.status === 'LOW' ? 'warn' as const
      : r.status === 'IDLE' ? 'muted' as const : 'normal' as const;
  return result({
    summary: [
      metric('Expected every day', ctx.kg(bands.expectedDailyKg),
        `${plural(forecast.counted, 'live batch', 'live batches')} in the forecast`),
      metric(`Under ${COVERAGE_CRITICAL_DAYS} days`, ctx.num(bands.under3), bands.under3 ? 'ingredients about to run out' : 'nothing on the shelf is that tight',
        bands.under3 ? 'danger' : 'success'),
      metric(`Under ${COVERAGE_LOW_DAYS} days`, ctx.num(bands.under7), 'ingredients to order against'),
      metric('Tightest shelf', bands.lowest ? fmtDays(bands.lowest.days) : DASH,
        bands.lowest ? `${bands.lowest.ingredient} · ${ctx.kg(bands.lowest.dailyKg)} a day expected` : 'No live batch is expected to eat stock'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'coverage', title: 'What the godown holds against what it will eat', format: 'kg',
      subtitle: 'Current stock by ingredient, ordered by the days it would last',
      rows: rows.map(r => ({
        id: r.ingredient, label: r.ingredient, value: r.stockKg, display: ctx.kg(r.stockKg),
        sub: `${ctx.kg(r.dailyKg)}/day · ${fmtDays(r.days)}`, tone: toneOf(r),
      })),
    }),
    tables: [
      {
        title: 'Feed stock coverage',
        caption: `Days left = current stock ÷ the KG every live batch is expected to eat that day. Stock and value are as on ${ctx.date(asOf)}.`,
        columns: [col('Ingredient'), rcol('Current stock'), rcol('Expected/day'), rcol('Days left'), rcol('Avg ₹/kg'), rcol('Stock value'), col('Contributing batches')],
        emptyText: 'The godown holds no ingredient to forecast against.',
        rows: rows.map(r => {
          const pos = v.now(r.ingredient);
          return row(r.ingredient, [
            r.ingredient, ctx.kg(r.stockKg), r.dailyKg ? ctx.kg(r.dailyKg) : DASH,
            fmtDays(r.days), ctx.money(v.avgAt(r.ingredient, asOf), 2),
            pos.valuedKg > 0 ? ctx.money(pos.value) : DASH,
            r.contributors.length
              ? r.contributors.map(c => `${c.batchCode} ${ctx.num(c.tonnesPerDay, 2)} t/day`).join(' + ')
              : 'Nothing in the forecast',
          ], `/feed/ingredient/${encodeURIComponent(r.ingredient)}`,
            r.status === 'CRITICAL' ? 'danger' : r.status === 'IDLE' ? 'muted' : undefined);
        }),
      },
      {
        title: 'Live batches left out of the forecast',
        caption: 'A batch is only in the forecast when its owner has set an approximate intake and its shed has a formula in force today.',
        columns: [col('Batch'), col('Shed'), col('Left out because')],
        emptyText: 'Every live batch is in the forecast.',
        rows: forecast.blockers.map(b => row(b.batchId, [
          b.batchCode, b.shedName, BLOCKER_LABEL[b.reason],
        ], `/batches/${b.batchId}`, 'muted')),
      },
    ],
    notes: [
      'This is a plan, not a record. Actual feed stays in the consumption ledger and the godown ledger; nothing here books a movement, an expense or a P&L row.',
      'Each batch is deducted through its own shed\'s formula version in force today, so a mix revision changes future planning only and never re-writes history.',
      'A shelf nothing is expected to eat reads as a dash rather than as infinite days, and stock with no intake set is never guessed at.',
    ],
    warnings: forecast.counted === 0
      ? ['No live batch has an approximate feed intake set, so every days-left figure is a dash until one does.']
      : [],
    links: [{ label: 'Open Godown', href: '/feed' }, { label: 'Godown stock history', href: '/reports/godown_stock_history' }],
  });
};

/* ============================= 6. AUDIT & CONTROL ============================= */

const KIND_LABEL: Record<FinanceTxn['kind'], string> = {
  INCOME: 'Income', EXPENSE: 'Expense', PURCHASE: 'Purchase',
  SALE: 'Sale', PAYMENT_IN: 'Payment in', PAYMENT_OUT: 'Payment out',
};

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted',
  BACKUP_CREATED: 'Backup exported', RESTORE_STARTED: 'Restore started',
  RESTORE_COMPLETED: 'Restore completed', RESTORE_FAILED: 'Restore failed',
};

const shortId = (id: string) => (id && id.length > 12 ? `${id.slice(0, 7)}…${id.slice(-3)}` : id || DASH);

function showValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return fmtIN(v, Number.isInteger(v) ? 0 : 2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') return 'a full record';
  return String(v).slice(0, 60);
}

/** Audit fields whose value is a user id rather than a figure. */
const PERSON_FIELD = new Set(['handledById', 'authorizedById', 'createdBy', 'closedById', 'byUserId']);

const scopeOfTxn = (ctx: ReportCtx, t: FinanceTxn) => {
  const batchShed = new Map(ctx.src.batches.map(b => [b.id, b.shedId]));
  const s = scopeOf(t, batchShed);
  return s.kind === 'shed' ? ctx.shedName(s.shedId) : s.kind === 'godown' ? 'Godown' : 'Unmapped';
};

const financeLedger: ReportDef['build'] = ctx => {
  const rows = latestFirst(ctx.src.finance.filter(t => inRange(t.date, ctx.range)
    && fin(t.amount) !== null && (!ctx.p.batchId || t.batchId === ctx.p.batchId)));
  const batchShed = new Map(ctx.src.batches.map(b => [b.id, b.shedId]));
  return result({
    summary: [
      metric('Rows', ctx.num(rows.length)),
      metric('Money in', ctx.money(total(rows.filter(t => isInflow(t.kind)).map(t => t.amount)))),
      metric('Money out', ctx.money(total(rows.filter(t => !isInflow(t.kind)).map(t => t.amount)))),
      metric('Unmapped', ctx.num(count(rows, t => scopeOf(t, batchShed).kind === 'unallocated')), 'rows with no shed or godown'),
    ],
    tables: [{
      title: 'Finance ledger',
      columns: [col('Date'), col('Type'), col('Category'), col('Counterparty'), col('Method'), rcol('Amount'), col('Mapped to'), col('Recorded by')],
      emptyText: 'No finance row in this period.',
      rows: rows.map(t => row(t.id, [
        ctx.date(t.date), KIND_LABEL[t.kind], t.category || DASH, t.counterparty ?? DASH,
        methodCell(t),
        isInflow(t.kind) ? ctx.money(t.amount) : `−${ctx.money(Math.abs(t.amount))}`,
        scopeOfTxn(ctx, t), ctx.userName(t.createdBy),
      ], t.refId ? `/sales/entry/${t.refId}` : undefined, isInflow(t.kind) ? 'success' : undefined)),
    }],
    notes: ['A row written by a sale voucher links straight to that voucher, so the ledger and the sale can never drift apart.',
      'The Method column reads the payment method the row was booked with, or the channels it split over. Money nobody classified reads as a dash rather than an assumption.'],
    warnings: [],
    links: [{ label: 'Open Finance', href: '/finance' }, { label: 'Unmapped money', href: '/reports/unmapped_money' }],
  });
};

const unmappedMoney: ReportDef['build'] = ctx => {
  const batchShed = new Map(ctx.src.batches.map(b => [b.id, b.shedId]));
  const all = ctx.src.finance.filter(t => inRange(t.date, ctx.range) && fin(t.amount) !== null);
  const rows = latestFirst(all.filter(t => scopeOf(t, batchShed).kind === 'unallocated'));
  const inflow = total(rows.filter(t => isInflow(t.kind)).map(t => t.amount));
  const outflow = total(rows.filter(t => !isInflow(t.kind)).map(t => t.amount));
  const allMoney = total(all.map(t => fin(t.amount)));
  return result({
    summary: [
      metric('Unmapped rows', ctx.num(rows.length), `of ${all.length} in the period`),
      metric('In not mapped', ctx.money(inflow)),
      metric('Out not mapped', ctx.money(outflow)),
      metric('Share of money', div(total([inflow, outflow]), allMoney) === null ? DASH
        : ctx.pct((total([inflow, outflow])! / allMoney!) * 100), 'of everything booked this period'),
    ],
    tables: [{
      title: 'Money with no shed or godown yet',
      caption: 'These rows are inside the farm totals but not inside any shed\'s, so they are reported here rather than guessed away.',
      columns: [col('Date'), col('Type'), col('Category'), rcol('Amount'), col('Counterparty'), col('Remarks'), col('Booked by')],
      emptyText: 'Every money row in this period maps to a shed or the godown.',
      rows: rows.map(t => row(t.id, [
        ctx.date(t.date), KIND_LABEL[t.kind], t.category || DASH, ctx.money(t.amount),
        t.counterparty ?? DASH, plainRemarks(t.remarks) ?? DASH, ctx.userName(t.createdBy),
      ], t.refId ? `/sales/entry/${t.refId}` : undefined)),
    }],
    notes: ['A row is unmapped when it carries no batch and is not marked as godown money, or when it names a batch that no longer exists.'],
    warnings: rows.length ? ['Unmapped money is real money: it stands in the Unallocated line and is never dropped.'] : [],
    links: [{ label: 'Open Finance', href: '/finance' }, { label: 'Farm P&L', href: '/reports/farm_pnl' }],
  });
};

const auditLog: ReportDef['build'] = ctx => {
  const rows = ctx.src.audit
    .filter(a => inRange(a.at?.slice(0, 10) ?? '', ctx.range))
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  /** A custody field stores a person, and a dispute is read in names rather than ids. */
  const shown = (field: string | undefined, v: unknown) =>
    field && PERSON_FIELD.has(field) && typeof v === 'string' ? ctx.userName(v) : showValue(v);
  const why = (reason?: string) => {
    const text = plainRemarks(reason);
    if (!text) return DASH;
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  };
  const byAction = new Map<string, number>();
  for (const a of rows) byAction.set(a.action, (byAction.get(a.action) ?? 0) + 1);
  return result({
    summary: [
      metric('Entries', ctx.num(rows.length)),
      metric('People', ctx.num(new Set(rows.map(r => r.byUserId)).size)),
      metric('Records touched', ctx.num(new Set(rows.map(r => r.entity)).size)),
      metric('Deletions', ctx.num(byAction.get('DELETE') ?? 0),
        byAction.get('DELETE') ? 'worth a look' : 'none in this period',
        byAction.get('DELETE') ? 'danger' : 'ink'),
    ],
    tables: [{
      title: 'Audit trail',
      caption: 'Every recorded change, newest first, with who made it and the reason they gave.',
      columns: [col('When'), col('Record'), col('Action'), col('Field'), col('Was'), col('Now'), col('By'), col('Why')],
      emptyText: 'Nothing was changed in this period.',
      rows: rows.map(a => row(a.id, [
        fmtDateTime(a.at), `${a.entity} · ${shortId(a.entityId)}`, ACTION_LABEL[a.action],
        a.field ?? DASH, shown(a.field, a.oldValue), shown(a.field, a.newValue),
        ctx.userName(a.byUserId), why(a.reason),
      ])),
    }, {
      title: 'Who changed what',
      columns: [col('Person'), rcol('Entries'), rcol('Creates'), rcol('Updates'), rcol('Deletes')],
      emptyText: 'No change was recorded in this period.',
      rows: Array.from(new Set(rows.map(r => r.byUserId))).map(by => {
        const own = rows.filter(r => r.byUserId === by);
        return row(by, [
          ctx.userName(by), ctx.num(own.length),
          ctx.num(count(own, a => a.action === 'CREATE')),
          ctx.num(count(own, a => a.action === 'UPDATE')),
          ctx.num(count(own, a => a.action === 'DELETE')),
        ]);
      }).sort((a, b) => Number(b.cells[1]) - Number(a.cells[1])),
    }],
    notes: [
      'The trail records changes and is never edited. A report only reads it.',
      'A correction to an amount, a counterparty or the way money moved carries the reason it was given; a blank under Why is a change nobody explained.',
    ],
    warnings: [],
    links: [],
  });
};

/* ============================= 7. CASH & PAYMENT ACCOUNTABILITY ============================= */

/**
 * These four statements re-read the same finance ledger every other money report reads,
 * split only by how the money physically moved (`./cashflow`). No row is added, so the
 * cash and online figures add back to the P&L's money in and out — one economic event
 * stays one accounting event.
 */
function moneyRows(ctx: ReportCtx): FinanceTxn[] {
  return latestFirst(ctx.src.finance.filter(t => inRange(t.date, ctx.range) && fin(t.amount) !== null));
}

const cashOf = (t: FinanceTxn) => splitOf(t).cash;
const channelOfRow = (t: FinanceTxn, k: ChannelKey) => splitOf(t)[k];

/** The method as recorded, or the channels a split load arrived over — never a guess. */
function methodCell(t: { amount: number; paymentMethod?: PaymentMethod; split?: PaymentSplit }): string {
  if (t.paymentMethod) return PAYMENT_METHOD_LABEL[t.paymentMethod];
  const parts = splitOf(t);
  const named = CHANNEL_KEYS.filter((k: ChannelKey) => k !== 'advance' && parts[k] !== 0)
    .map(k => CHANNEL_FULL_LABEL[k]);
  return named.length ? named.join(' + ') : DASH;
}

/**
 * A payment taken straight onto a buyer's ledger settles their dues but writes no
 * finance row — only a sale voucher books money. Those rows are reported apart so the
 * cash statement stays equal to the accounts, and never by folding them in twice.
 */
function ledgerOnlyPayments(ctx: ReportCtx): TraderTxn[] {
  return latestFirst(ctx.src.traderTxns.filter(t => !t.refId
    && (t.kind === 'PAYMENT_IN' || t.kind === 'PAYMENT_OUT')
    && inRange(t.date, ctx.range) && fin(t.amount) !== null));
}

const CASH_COLUMNS = [
  col('Date'), col('Entry'), col('Counterparty'), rcol('Cash in'), rcol('Cash out'),
  col('Cash held by'), col('Handed across by'), col('Authorised by'), col('Recorded by'), col('Receipt / voucher no.'),
];

const cashMovement: ReportDef['build'] = ctx => {
  const rows = moneyRows(ctx).filter(t => cashOf(t) !== 0);
  const inflow = rows.filter(t => isInflow(t.kind));
  const outflow = rows.filter(t => !isInflow(t.kind));
  const inCash = total(inflow.map(cashOf)) ?? 0;
  const outCash = total(outflow.map(cashOf)) ?? 0;
  const noCustodian = count(rows, t => !t.handledById);
  const unlinked = ledgerOnlyPayments(ctx);
  const handovers = latestFirst(ctx.src.cashHandovers.filter(h => inRange(h.date, ctx.range)));
  return result({
    summary: [
      metric('Cash received', ctx.money(inCash), plural(inflow.length, 'receipt')),
      metric('Cash paid out', ctx.money(outCash), plural(outflow.length, 'payment')),
      metric('Net cash movement', ctx.money(inCash - outCash),
        inCash - outCash >= 0 ? 'More cash came in than went out' : 'More cash went out than came in',
        inCash - outCash >= 0 ? 'success' : 'danger'),
      metric('Without a custodian', ctx.num(noCustodian), 'cash whose hands are not on record',
        noCustodian ? 'warn' : 'ink'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'cash_by_day', title: 'Cash received each day', format: 'money',
      caption: 'Only days on which cash actually came in are shown.',
      rows: dayKeys(ctx.range.from, ctx.range.to).slice().reverse().map(date => ({
        id: date, label: fmtDate(date),
        value: total(rows.filter(t => isInflow(t.kind) && t.date === date).map(cashOf)) ?? 0,
      })).filter(r => r.value > 0).slice(0, 12),
    }),
    tables: [{
      title: 'Cash movements',
      caption: 'Only money that physically changed hands is here, and only its cash part: a load taken partly in cash and partly on PhonePe shows its cash half.',
      columns: CASH_COLUMNS,
      emptyText: 'No cash moved in this period.',
      rows: rows.map(t => {
        const c = Math.abs(cashOf(t));
        const recd = isInflow(t.kind);
        return row(t.id, [
          ctx.date(t.date), `${KIND_LABEL[t.kind]}${t.category ? ` · ${t.category}` : ''}`,
          t.counterparty ?? DASH,
          recd ? ctx.money(c) : null, recd ? null : ctx.money(c),
          ctx.userName(t.handledById), t.handedTo ?? DASH, ctx.userName(t.authorizedById),
          ctx.userName(t.createdBy), t.reference ?? DASH,
        ], t.refId ? `/sales/entry/${t.refId}` : '/finance', recd ? 'success' : undefined);
      }),
    }, {
      title: 'Cash handed between our own people',
      caption: 'Custody only. A handover moves the drawer from one person to another, so it is never added to the totals above.',
      columns: [col('Date'), col('Time'), col('Given by'), col('Taken by'), rcol('Amount'), col('Reason'), col('Reference'), col('Recorded by')],
      emptyText: 'No cash changed hands inside the company in this period.',
      rows: handovers.map(h => row(h.id, [
        ctx.date(h.date), h.time || DASH, ctx.userName(h.fromUserId), ctx.userName(h.toUserId),
        ctx.money(h.amount), h.reason ?? DASH, h.reference ?? DASH, ctx.userName(h.createdBy),
      ])),
    }, ...(unlinked.length ? [{
      title: 'Memo · settled on a buyer\'s ledger, not in the cash book',
      caption: 'A payment typed straight onto a buyer\'s account clears their dues without a sale voucher, so it is not a finance row and is not counted as cash above. It is listed here so no receipt goes unaccounted for in a dispute.',
      columns: [col('Date'), col('Buyer'), col('Direction'), rcol('Amount'), col('Method'), col('Remarks'), col('Booked by')],
      emptyText: '',
      rows: unlinked.map(t => row(t.id, [
        ctx.date(t.date), ctx.traderName(t.traderId),
        t.kind === 'PAYMENT_IN' ? 'Received' : 'Paid out', ctx.money(t.amount),
        t.paymentMethod ? PAYMENT_METHOD_LABEL[t.paymentMethod] : DASH,
        plainRemarks(t.remarks) ?? DASH, ctx.userName(t.createdBy),
      ], `/traders/${t.traderId}`, t.kind === 'PAYMENT_IN' ? 'success' : undefined)),
    }] : [])],
    notes: [
      'Receipt numbers are numbered per company and per day, so two farms collecting cash on the same morning never hold the same slip.',
      'A blank name under "Cash held by" means nobody recorded whose hands the money went through. It is left blank rather than filled with whoever typed the entry.',
      'Cash, online, cheque and advance parts of a row always add back to that row\'s amount, so this statement and the accounts cannot disagree.',
    ],
    warnings: noCustodian
      ? [`${plural(noCustodian, 'cash row').replace(/^./, c => c.toUpperCase())} in this period ${noCustodian === 1 ? 'has' : 'have'} no custodian on record — the money is real but the answer to "who took it" is not.`]
      : [],
    links: [
      { label: 'Open Finance', href: '/finance' },
      { label: 'Online payments', href: '/reports/online_payments' },
      { label: 'Daily cash reconciliation', href: '/reports/cash_reconciliation' },
    ],
  });
};

const ONLINE_COLUMNS = [
  col('Date'), col('Entry'), col('Counterparty'), col('Method'),
  rcol('Online in'), rcol('Online out'), col('UTR / reference'), col('Authorised by'), col('Recorded by'),
];

const onlinePayments: ReportDef['build'] = ctx => {
  const rows = moneyRows(ctx).filter(t => channelOfRow(t, 'online') !== 0);
  const inOnline = total(rows.filter(t => isInflow(t.kind)).map(t => channelOfRow(t, 'online'))) ?? 0;
  const outOnline = total(rows.filter(t => !isInflow(t.kind)).map(t => channelOfRow(t, 'online'))) ?? 0;
  const noRef = count(rows.filter(t => isInflow(t.kind)), t => !t.reference);
  const byMethod = methodSummary(ctx.src.finance, ctx.range).filter(r => r.channel === 'online');
  return result({
    summary: [
      metric('Online received', ctx.money(inOnline), plural(rows.filter(t => isInflow(t.kind)).length, 'credit')),
      metric('Online paid', ctx.money(outOnline), plural(rows.filter(t => !isInflow(t.kind)).length, 'debit')),
      metric('Net online', ctx.money(inOnline - outOnline), undefined, inOnline - outOnline >= 0 ? 'success' : 'danger'),
      metric('Without a reference', ctx.num(noRef), 'money in with no UTR or slip', noRef ? 'warn' : 'ink'),
    ],
    charts: byMethod.length > 1 ? charts(ctx, {
      kind: 'bars', id: 'online_methods', title: 'Online money by method', format: 'money',
      caption: 'Received plus paid, per method that moved money online in this period.',
      rows: byMethod.map(r => ({
        id: r.method ?? r.channel, label: r.label, value: r.received + r.paid,
        sub: `${ctx.money(r.received)} in · ${ctx.money(r.paid)} out`,
      })),
    }) : [],
    tables: [{
      title: 'Online & bank movements',
      caption: 'UPI, PhonePe, NEFT, RTGS and bank transfers. No cash custody applies to these: the reference and who authorised the payment carry the proof.',
      columns: ONLINE_COLUMNS,
      emptyText: 'Nothing was paid online in this period.',
      rows: rows.map(t => {
        const v = Math.abs(channelOfRow(t, 'online'));
        const recd = isInflow(t.kind);
        return row(t.id, [
          ctx.date(t.date), `${KIND_LABEL[t.kind]}${t.category ? ` · ${t.category}` : ''}`,
          t.counterparty ?? DASH, methodCell(t),
          recd ? ctx.money(v) : null, recd ? null : ctx.money(v),
          t.reference ?? DASH, ctx.userName(t.authorizedById), ctx.userName(t.createdBy),
        ], t.refId ? `/sales/entry/${t.refId}` : '/finance', recd ? 'success' : undefined);
      }),
    }],
    notes: [
      'A cheque or an unusual method is its own channel, so it is not folded into this statement — the Payment Method Summary lists every channel side by side.',
      'An advance adjusted against a load is not money that arrived today; it already came in earlier and is reported under its own heading there.',
    ],
    warnings: noRef
      ? [`${noRef} ${noRef === 1 ? 'credit shows no' : 'credits show no'} UTR or reference. The bank statement is the only proof of those until someone records it.`]
      : [],
    links: [
      { label: 'Open Finance', href: '/finance' },
      { label: 'Payment method summary', href: '/reports/payment_method_summary' },
      { label: 'Cash movements', href: '/reports/cash_movement' },
    ],
  });
};

const paymentMethodSummary: ReportDef['build'] = ctx => {
  const rows = moneyRows(ctx);
  const summary = methodSummary(ctx.src.finance, ctx.range);
  const unrecorded = rows.filter(t => !isClassified(t));
  const unrecordedMoney = total(unrecorded.map(t => t.amount)) ?? 0;
  const biggest = summary[0];
  return result({
    summary: [
      metric('Money received', ctx.money(total(rows.filter(t => isInflow(t.kind)).map(t => t.amount))),
        plural(count(rows, t => isInflow(t.kind)), 'receipt')),
      metric('Money paid', ctx.money(total(rows.filter(t => !isInflow(t.kind)).map(t => t.amount))),
        plural(count(rows, t => !isInflow(t.kind)), 'payment')),
      metric('Channels used', ctx.num(summary.length), biggest ? `Biggest: ${biggest.label}` : undefined),
      metric('No method on record', ctx.money(unrecordedMoney), plural(unrecorded.length, 'row'),
        unrecordedMoney ? 'warn' : 'ink'),
    ],
    charts: charts(ctx, {
      kind: 'bars', id: 'methods', title: 'Money moved by payment method', format: 'money',
      caption: 'Received plus paid per method or channel. Money nobody classified appears as "Not recorded".',
      rows: summary.map(r => ({
        id: r.method ?? r.channel, label: r.label, value: r.received + r.paid,
        sub: `${ctx.money(r.received)} in · ${ctx.money(r.paid)} out`,
        tone: r.channel === 'unrecorded' ? 'warn' as const : undefined,
      })),
    }),
    tables: [{
      title: 'Payment method summary',
      caption: 'Every rupee in the period under the one way it moved. A split load contributes to each channel it used, so the column totals add back to money received and paid.',
      columns: [col('Method or channel'), rcol('Received'), rcol('Paid'), rcol('Net'), rcol('Rows')],
      emptyText: 'No money moved in this period.',
      rows: [
        ...summary.map(r => row(r.method ?? r.channel, [
          r.label, r.received ? ctx.money(r.received) : DASH, r.paid ? ctx.money(r.paid) : DASH,
          ctx.money(r.net), ctx.num(r.count),
        ], undefined, r.net > 0 ? 'success' : r.net < 0 ? 'danger' : undefined)),
        row('total', [
          'Total — the ledger\'s own money in and out',
          ctx.money(total(rows.filter(t => isInflow(t.kind)).map(t => t.amount))),
          ctx.money(total(rows.filter(t => !isInflow(t.kind)).map(t => t.amount))),
          ctx.money((total(rows.filter(t => isInflow(t.kind)).map(t => t.amount)) ?? 0)
            - (total(rows.filter(t => !isInflow(t.kind)).map(t => t.amount)) ?? 0)),
          ctx.num(rows.length),
        ], undefined, 'muted'),
      ],
    }],
    notes: [
      'Nothing is read out of remarks or guessed from a transaction category: a row with no method on record is counted as "Not recorded" until someone states it.',
      'Where a row named only its channel (a load paid in cash and on PhonePe), its parts are reported under those channels rather than under one invented method.',
    ],
    warnings: unrecorded.length
      ? [`${plural(unrecorded.length, 'row').replace(/^./, c => c.toUpperCase())} worth ${ctx.money(unrecordedMoney)} carry no payment method. They are shown, not assumed.`]
      : [],
    links: [
      { label: 'Open Finance', href: '/finance' },
      { label: 'Cash movements', href: '/reports/cash_movement' },
      { label: 'Online payments', href: '/reports/online_payments' },
    ],
  });
};

const cashReconciliation: ReportDef['build'] = ctx => {
  const rows = ctx.src.finance.filter(t => fin(t.amount) !== null && isISODate(t.date));
  /** Cash the records held before the window opened, so day one has a real opening. */
  const carried = cashPositionOf(rows.filter(t => t.date < ctx.range.from), ctx.range.from);
  const daily = new Map<string, { in: number; out: number }>();
  for (const t of rows) {
    if (t.date < ctx.range.from || t.date > ctx.range.to) continue;
    const c = splitOf(t).cash;
    if (!c) continue;
    const d = daily.get(t.date) ?? { in: 0, out: 0 };
    if (isInflow(t.kind)) d.in += c; else d.out += c;
    daily.set(t.date, d);
  }
  const counts = new Map(ctx.src.cashCounts.filter(c => inRange(c.date, ctx.range)).map(c => [c.date, c]));
  // Days with movement or a count; the position stands through a quiet day, so none is invented.
  const dates = Array.from(new Set([...daily.keys(), ...counts.keys()])).sort();
  const custody = custodyOf(ctx.src.finance, ctx.src.cashHandovers, ctx.src.users);
  let pos = carried;
  const table = dates.map(date => {
    const d = daily.get(date) ?? { in: 0, out: 0 };
    const opening = pos;
    pos = Number((pos + d.in - d.out).toFixed(2));
    const c = counts.get(date);
    return { date, opening, in: d.in, out: d.out, expected: pos, count: c ?? null };
  });
  const diffs = table.filter(t => t.count && t.count.difference !== 0);
  const unrecordedCash = total(rows.filter(t => !isClassified(t) && inRange(t.date, ctx.range)).map(t => t.amount)) ?? 0;
  return result({
    summary: [
      metric('Cash in hand now', ctx.money(custody.total), 'Derived from the ledger, never typed'),
      metric('With our people', ctx.money(custody.byCustodian.reduce((s, c) => s + c.inHand, 0)),
        plural(custody.byCustodian.length, 'custodian')),
      metric('Expected at period end', ctx.money(table.length ? table[table.length - 1].expected : carried),
        'Opening + cash in − cash out'),
      metric('Counts that differ', ctx.num(diffs.length), diffs.length ? 'to explain' : 'all agreed',
        diffs.length ? 'warn' : 'ink'),
    ],
    charts: [],
    tables: [{
      title: 'Daily cash closing',
      caption: 'One line per day cash moved or was counted: what the drawer should hold, what someone actually counted, and the difference between them.',
      columns: [col('Date'), rcol('Opening'), rcol('Cash in'), rcol('Cash out'), rcol('Expected'), rcol('Counted'), rcol('Difference'), col('Counted by')],
      emptyText: 'No cash moved and no day was counted in this period.',
      rows: [...table].reverse().map(t => row(t.date, [
        ctx.date(t.date), ctx.money(t.opening), ctx.money(t.in), ctx.money(t.out), ctx.money(t.expected),
        t.count ? ctx.money(t.count.physicalCash) : null,
        t.count ? ctx.money(t.count.difference) : null,
        t.count ? ctx.userName(t.count.closedById) : DASH,
      ], undefined, t.count && t.count.difference !== 0 ? 'danger' : undefined)),
    }, {
      title: 'Who is holding the cash',
      caption: 'Cash each person took in, paid out and passed on. A negative figure means cash left their hands that was never handed to them — a missing handover record, not a smoothed-out number.',
      columns: [col('Person'), rcol('Cash taken in'), rcol('Cash paid out'), rcol('Handed on'), rcol('Took over'), rcol('In hand')],
      emptyText: 'No cash movement in the records names a custodian.',
      rows: [
        ...custody.byCustodian.map(c => row(c.userId, [
          c.name, ctx.money(c.received), ctx.money(c.paidOut), ctx.money(c.handedAway),
          ctx.money(c.handedIn), ctx.money(c.inHand),
        ])),
        row('unassigned', ['No custodian recorded', ctx.money(custody.unassignedReceived), ctx.money(custody.unassignedPaid),
          DASH, DASH, ctx.money(custody.unassigned)], undefined, 'muted'),
        row('total', ['Cash the ledger says the company holds', DASH, DASH, DASH, DASH, ctx.money(custody.total)],
          undefined, 'muted'),
      ],
    }],
    notes: [
      'A difference is left standing on the record. The cash balance is never adjusted to match a count, because the count and the ledger cannot both be right until someone books what explains the gap.',
      'Re-counting an already counted day writes its own audit entry.',
      'Custody is read from the same rows as the totals, so the custodian column always adds back to the cash in hand.',
    ],
    warnings: [
      ...diffs.map(t => `${ctx.date(t.date)}: counted ${ctx.money(t.count!.physicalCash)} against ${ctx.money(t.expected)} expected — ${ctx.money(t.count!.difference)} to explain.`),
      ...(unrecordedCash ? [`Expected cash is a floor, not the whole drawer: ${ctx.money(unrecordedCash)} of money in this period has no channel on record.`] : []),
    ],
    links: [
      { label: 'Open Finance', href: '/finance' },
      { label: 'Cash movements', href: '/reports/cash_movement' },
      { label: 'Audit Trail', href: '/reports/audit_log' },
    ],
  });
};

/* ============================= THE CATALOGUE ============================= */

export const REPORT_SECTIONS = [
  { id: 'financial', label: 'Financial', blurb: 'Where the money went, read the way the accounts read it.' },
  { id: 'sales', label: 'Sales', blurb: 'Every load, every bill, every rate and every rupee a buyer owes.' },
  { id: 'purchases', label: 'Purchases', blurb: 'What went into the godown, at the price it was paid.' },
  { id: 'operations', label: 'Farm', blurb: 'Collection, feed, mortality, batches and the day-wise sheet.' },
  { id: 'inventory', label: 'Inventory', blurb: 'Godown stock, its valuation, shortage and corrections.' },
  { id: 'control', label: 'Audit & Control', blurb: 'Who changed what, and what is still unmapped.' },
] as const;

export type ReportSectionId = typeof REPORT_SECTIONS[number]['id'];

export type ReportDef = {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  section: ReportSectionId;
  /** Money this report carries cannot be read without the finance view. */
  financeOnly?: boolean;
  /** Filters this report understands. Nothing irrelevant is ever shown. */
  params: ReportParam[];
  /** Filter values the report cannot stand without. */
  needs?: ReportParam[];
  /** A statement of account is lifetime by nature; a date window would misstate it. */
  allTime?: boolean;
  /** A card that hands off to a screen that already does this job. */
  href?: string;
  build?: (ctx: ReportCtx) => ReportResult;
};

export const REPORTS: ReportDef[] = [
  /* ---------- P&L & financial statements ---------- */
  { id: 'farm_pnl', title: 'Farm P&L', desc: 'Income, expense and the net result for the whole farm', icon: Wallet, section: 'financial', financeOnly: true, params: [], build: farmPnl },
  { id: 'shed_pnl', title: 'Shed-wise P&L', desc: 'Each shed carrying its own feed and shortage share', icon: Layers, section: 'financial', financeOnly: true, params: ['shed'], build: shedPnl },
  { id: 'batch_pnl', title: 'Batch-wise P&L', desc: 'Result per batch before the farm-level shortage share', icon: LayoutGrid, section: 'financial', financeOnly: true, params: ['shed', 'batch'], build: batchPnl },
  { id: 'monthly_pnl', title: 'Monthly P&L', desc: 'Money in against money out, month by month', icon: CalendarRange, section: 'financial', financeOnly: true, params: [], build: monthlyPnl },
  { id: 'income_statement', title: 'Income Statement', desc: 'Income recognised once, where it was earned', icon: TrendingUp, section: 'financial', financeOnly: true, params: [], build: incomeStatement },
  { id: 'expense_statement', title: 'Expense Statement', desc: 'Operating spend, feed consumed and inventory kept apart', icon: TrendingDown, section: 'financial', financeOnly: true, params: [], build: expenseStatement },
  { id: 'cash_flow', title: 'Cash Flow Statement', desc: 'Every rupee that arrived and left in the window', icon: Banknote, section: 'financial', financeOnly: true, params: [], build: cashFlow },
  { id: 'cash_movement', title: 'Cash Movement Statement', desc: 'Each cash receipt and payment, with whose hands it went through', icon: ArrowLeftRight, section: 'financial', financeOnly: true, params: [], build: cashMovement },
  { id: 'online_payments', title: 'Online Payment Statement', desc: 'UPI, PhonePe, NEFT, RTGS and bank money with its references', icon: Landmark, section: 'financial', financeOnly: true, params: [], build: onlinePayments },
  { id: 'payment_method_summary', title: 'Payment Method Summary', desc: 'Money grouped by how it actually arrived, including what nobody recorded', icon: CircleDollarSign, section: 'financial', financeOnly: true, params: [], build: paymentMethodSummary },
  { id: 'godown_valuation', title: 'Godown Inventory Valuation', desc: 'Stock on hand and what it is worth today', icon: Boxes, section: 'inventory', financeOnly: true, params: [], build: godownValuation },
  { id: 'godown_shared', title: 'Shared Godown Expense', desc: 'Godown spend and how shortage is shared to sheds', icon: Scale, section: 'financial', financeOnly: true, params: [], build: godownShared },

  /* ---------- sales & buyer history ---------- */
  { id: 'buyer_history', title: 'Buyer / Trader History', desc: 'Every load billed, with its payment status', icon: Users, section: 'sales', params: ['trader', 'shed', 'batch'], build: buyerHistory },
  { id: 'buyer_statement', title: 'Buyer Statement', desc: 'Opening, bills, payments and the running balance', icon: ScrollText, section: 'sales', params: ['trader'], needs: ['trader'], allTime: true, build: buyerStatement },
  { id: 'buyer_wise_sales', title: 'Buyer-wise Sales', desc: 'Who took what, and what they still owe', icon: Store, section: 'sales', params: ['trader'], build: buyerWiseSales },
  { id: 'sales_history', title: 'Sales History', desc: 'Every bill as it stands in the buyers\' ledgers', icon: Receipt, section: 'sales', params: ['trader'], build: salesHistory },

  /* ---------- selling price history (Sales) ---------- */
  { id: 'egg_price_history', title: 'Egg Selling Price History', desc: '₹/egg per load, with average, highest and lowest', icon: BadgeIndianRupee, section: 'sales', params: ['trader', 'shed', 'batch'], build: eggPriceHistory },
  { id: 'buyer_price_history', title: 'Buyer-wise Price History', desc: 'The rate each buyer actually settled at', icon: Contact, section: 'sales', params: ['trader'], build: buyerPriceHistory },
  { id: 'daily_avg_rate', title: 'Daily Average Selling Rate', desc: 'One weighted rate per trading day', icon: LineChart, section: 'sales', params: ['trader', 'shed'], build: dailyAvgRate },
  { id: 'rate_difference_history', title: 'Rate Difference History', desc: 'Every rate revision recorded against a buyer', icon: Percent, section: 'sales', params: ['trader'], build: rateDifferenceHistory },

  /* ---------- purchase & cost history ---------- */
  { id: 'purchase_history', title: 'Purchase History', desc: 'Every receipt into the godown and what it cost', icon: ShoppingCart, section: 'purchases', params: ['ingredient'], build: purchaseHistory },
  { id: 'ingredient_purchase_history', title: 'Ingredient Purchase History', desc: 'One ingredient, every receipt that priced it', icon: Package, section: 'purchases', params: ['ingredient'], needs: ['ingredient'], build: ingredientPurchaseHistory },
  { id: 'purchase_price_history', title: 'Purchase Price History', desc: 'Landed rate as booked, never re-written by today\'s average', icon: History, section: 'purchases', params: ['ingredient'], build: purchasePriceHistory },

  /* ---------- operations & stock history ---------- */
  { id: 'egg_collection_history', title: 'Egg Collection History', desc: 'The four grades, day by day, shed by shed', icon: Egg, section: 'operations', params: ['shed', 'batch'], build: eggCollectionHistory },
  { id: 'feed_consumption_history', title: 'Feed Consumption History', desc: 'Formula version, tonnes and the cost the godown charged', icon: Wheat, section: 'operations', params: ['shed', 'batch'], build: feedConsumptionHistory },
  { id: 'godown_stock_history', title: 'Godown Stock History', desc: 'Every movement with the stock it left behind', icon: Archive, section: 'inventory', params: ['ingredient'], build: godownStockHistory },
  { id: 'ingredient_stock_history', title: 'Ingredient Stock History', desc: 'One ingredient traced through the ledger', icon: SlidersHorizontal, section: 'inventory', params: ['ingredient'], needs: ['ingredient'], build: ingredientStockHistory },
  { id: 'shortage_history', title: 'Stock Shortage History', desc: 'Stock lost without a shed taking feed, and how it was shared', icon: AlertTriangle, section: 'inventory', params: ['ingredient'], build: shortageHistory },
  { id: 'adjustment_history', title: 'Stock Adjustment History', desc: 'Corrections both ways, with who booked them', icon: GitCompareArrows, section: 'inventory', params: ['ingredient'], build: adjustmentHistory },
  { id: 'mortality_history', title: 'Mortality History', desc: 'Deaths recorded, day by day, shed by shed', icon: Skull, section: 'operations', params: ['shed', 'batch'], build: mortalityHistory },
  { id: 'batch_history', title: 'Batch History', desc: 'Placement, age, live birds and closure per batch', icon: ClipboardList, section: 'operations', params: ['shed'], allTime: true, build: batchHistory },
  { id: 'shed_activity_history', title: 'Shed Activity History', desc: 'One row per shed per day of activity', icon: ClipboardList, section: 'operations', params: ['shed', 'batch'], build: shedActivityHistory },
  { id: 'formula_usage', title: 'Feed Formula Usage', desc: 'Which mix version actually fed the birds', icon: FlaskConical, section: 'operations', params: ['shed'], build: formulaUsage },
  { id: 'feed_stock_coverage', title: 'Feed Stock Coverage', desc: 'How many days each shelf lasts against the live batches', icon: Gauge, section: 'inventory', params: ['ingredient'], allTime: true, build: feedStockCoverage },
  { id: 'batch_daily_print', title: 'Batch Daily Report', desc: 'The printable day-wise sheet a batch already has', icon: Printer, section: 'operations', params: [], href: PRINT_HREF },

  /* ---------- audit & control ---------- */
  { id: 'finance_ledger', title: 'Finance Ledger', desc: 'Every money row, mapped to a shed, the godown or neither', icon: BookOpen, section: 'control', financeOnly: true, params: ['batch'], build: financeLedger },
  { id: 'cash_reconciliation', title: 'Daily Cash Reconciliation', desc: 'Expected cash, counted cash and who is holding it', icon: ClipboardCheck, section: 'control', financeOnly: true, params: [], build: cashReconciliation },
  { id: 'unmapped_money', title: 'Unmapped Money', desc: 'Cash the ledger has not placed yet', icon: HandCoins, section: 'control', financeOnly: true, params: [], build: unmappedMoney },
  { id: 'audit_log', title: 'Audit Trail', desc: 'What changed, from what to what, and who did it', icon: ShieldCheck, section: 'control', params: [], build: auditLog },
];

export const REPORT_BY_ID = new Map(REPORTS.map(r => [r.id, r]));

const PARAM_KEY: Record<ReportParam, keyof ReportParams> = {
  shed: 'shedId', batch: 'batchId', trader: 'traderId', ingredient: 'ingredient',
};

/**
 * The bar in the address: a report keeps only the filters it can act on, so a link
 * can never carry a scope the statement silently ignored.
 */
export function searchFromParams(def: ReportDef, p: ReportParams): string {
  const q = new URLSearchParams();
  q.set('preset', p.preset);
  if (p.preset === 'CUSTOM') { q.set('from', p.from); q.set('to', p.to); }
  for (const param of def.params) {
    const value = p[PARAM_KEY[param]] as string | undefined;
    if (value) q.set(param, value);
  }
  return q.toString();
}

/** Where a report card leads: its own result view, or the screen that already does it. */
export function reportHref(def: ReportDef, p?: ReportParams): string {
  return def.href ?? `/reports/${def.id}${p ? `?${searchFromParams(def, p)}` : ''}`;
}

/** Filters this report understands, in its own order — nothing else is ever offered. */
export const paramsFor = (def: ReportDef) => def.params;

/** Read a filter bar back out of the address, falling back to the default window. */
export function paramsFromSearch(search: string, today = todayISO()): ReportParams {
  const q = new URLSearchParams(search);
  const preset = DATE_PRESETS.find(d => d.value === q.get('preset'))?.value ?? '30D';
  const d = defaultParams(today);
  const iso = (v: string | null) => (isISODate(v ?? '') ? (v as string) : undefined);
  return {
    preset,
    from: iso(q.get('from')) ?? d.from,
    to: iso(q.get('to')) ?? d.to,
    shedId: q.get('shed') || undefined,
    batchId: q.get('batch') || undefined,
    traderId: q.get('trader') || undefined,
    ingredient: q.get('ingredient') || undefined,
  };
}

/** A report opened by link drops any scope it does not read, so none is half-applied. */
export function scopeParams(def: ReportDef, p: ReportParams): ReportParams {
  const out: ReportParams = { ...p };
  for (const param of ['shed', 'batch', 'trader', 'ingredient'] as ReportParam[]) {
    if (!def.params.includes(param)) delete out[PARAM_KEY[param]];
  }
  return out;
}

/** Reports a role may open: money statements stay behind the finance view. */
export const visibleReports = (canFinance: boolean) =>
  REPORTS.filter(r => !r.financeOnly || canFinance);

/** Reports a role may open, inside one section. */
export const reportsInSection = (id: ReportSectionId, canFinance: boolean) =>
  visibleReports(canFinance).filter(r => r.section === id);

/** What the window on screen is, in words a reader checks before trusting a figure. */
export function rangeLabel(range: Range): string {
  if (range.days === 1) return fmtDate(range.to);
  return `${fmtDate(range.from)} → ${fmtDate(range.to)} · ${range.days} ${range.days === 1 ? 'day' : 'days'}`;
}

/* ============================= EXPORT ============================= */

/**
 * A cell as a spreadsheet should read it. Text that a spreadsheet would execute is
 * neutralised; a dash stays a dash, because an empty figure is not a zero.
 */
function csvCell(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '""';
  const risky = /^[=+@]/.test(text);
  const safe = risky ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The exact rows on screen, in the exact order, as CSV — nothing recomputed. */
export function reportCsv(def: ReportDef, range: Range, result: ReportResult): string {
  const head = [
    csvCell(def.title),
    csvCell(`${range.from} to ${range.to}`),
    csvCell('AMRUT Poultry Farm Management'),
  ].join(',');
  const blocks = result.tables.map(t => [
    t.title ? csvCell(t.title) : '',
    [t.columns.map(c => csvCell(c.label)).join(',')],
    t.rows.length
      ? t.rows.map(r => r.cells.map(csvCell).join(','))
      : [csvCell(t.emptyText)],
  ].filter(Boolean).join('\r\n'));
  return [head, ...blocks].join('\r\n') + '\r\n';
}

/** File name a downloaded statement carries the window it was drawn for. */
export function reportFileName(def: ReportDef, range: Range): string {
  return `${def.id}_${range.from}_${range.to}.csv`;
}

export type { GodownRow };

