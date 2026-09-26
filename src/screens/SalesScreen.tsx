import { useMemo, useState, useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Receipt, Plus, CheckCheck, Handshake, Egg, PenLine, Truck, Trash2, CalendarRange,
  SlidersHorizontal, RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Button, Field, SearchField, SelectField, ChipGroup, Stepper, SegmentedTabs } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Badge, StatusBadge, EmptyState, GroupList, KpiCard, ListRow, SectionTitle, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { CHART } from '@/components/ui/Charts';
import { GraphCard, GraphRange } from '@/components/charts/GraphCard';
import { HBarList, TrendChart, type VPoint, type VSeries } from '@/components/charts/DataViz';
import { PageReveal, StaggerContainer, StaggerItem, ScrollReveal, ChartReveal } from '@/components/motion';
import { useApp, useCompanyData, useCan, type Result } from '@/store/app';
import { fmtDate, fmtIN, fmtMoney, fmtPct, shiftDate, todayISO } from '@/lib/format';
import { latestFirst } from '@/lib/order';
import { dayKeys } from '@/lib/analytics';
import {
  batchOfShedOn, eggStockByGrade, entryAmount, entryTrays, gradeTotal, isWalkInTrader, linesByGrade, loadBilled, loadPaid,
  ratePerEgg, salePositions, saleReceivableTotal, saleEntryTotals, type SalePosition,
} from '@/lib/calc';
import {
  EGG_GRADES, EGGS_PER_TRAY,
  type Batch, type EggCollection, type EggGrade, type EggGradeCounts, type EggSaleBooking, type GradeRates,
  type SaleEntry, type SaleEntryDraft, type SaleEntryLine, type SalePricing, type Trader, type TraderTxn,
} from '@/types';

/** One company's rows, exactly as the store hands them out. */
type CompanyData = ReturnType<typeof useCompanyData>;

/** What the one sales chart may be drawn in. */
type Trend = 'value' | 'trays';

const GRADE_WORD: Record<EggGrade, string> = {
  GOOD: 'Normal', BROKEN: 'Broken', DOUBLE: 'Double', SMALL: 'Small',
};

/** A row says whether the money has arrived — in three words, not a paragraph. */
const PAY_WORD: Record<SalePosition['status'], { label: string; tone: 'brand' | 'warn' | 'danger' }> = {
  PAID: { label: 'Paid', tone: 'brand' },
  PARTIAL: { label: 'Partial', tone: 'warn' },
  PENDING: { label: 'Unpaid', tone: 'danger' },
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Trays, per shed and grade, as the form holds them: text so the field can be blank. */
type TraysByShed = Record<string, Record<EggGrade, string>>;

interface EntryForm {
  traderId: string;
  date: string;
  pricing: SalePricing;
  trays: TraysByShed;
  rates: Record<EggGrade, string>;
  agreed: string;
  cash: string;
  phonepe: string;
  /** Who physically took the cash on this load, when cash is part of it. */
  cashBy: string;
  cashTime: string;
  cashNo: string;
  labour: string;
  remarks: string;
  /** Planner booking this voucher was raised from, if any. Cleared by choosing "not from the planner". */
  bookingId: string;
}

const emptyTrays = (): Record<EggGrade, string> => ({ GOOD: '', BROKEN: '', DOUBLE: '', SMALL: '' });
const emptyRates = (): Record<EggGrade, string> => ({ GOOD: '', BROKEN: '', DOUBLE: '', SMALL: '' });

/** A new voucher opens on the walk-in account: the gate sale that names nobody is still a sale. */
function formFromEntry(entry?: SaleEntry, walkInId = ''): EntryForm {
  const trays: TraysByShed = {};
  for (const line of entry?.lines ?? []) {
    trays[line.shedId] = {
      GOOD: line.byGrade.GOOD ? String(line.byGrade.GOOD) : '',
      BROKEN: line.byGrade.BROKEN ? String(line.byGrade.BROKEN) : '',
      DOUBLE: line.byGrade.DOUBLE ? String(line.byGrade.DOUBLE) : '',
      SMALL: line.byGrade.SMALL ? String(line.byGrade.SMALL) : '',
    };
  }
  return {
    traderId: entry?.traderId ?? walkInId,
    date: entry?.date ?? todayISO(),
    pricing: entry?.pricing ?? 'RATE',
    trays,
    rates: {
      GOOD: entry?.rates.GOOD ? String(entry.rates.GOOD) : '',
      BROKEN: entry?.rates.BROKEN ? String(entry.rates.BROKEN) : '',
      DOUBLE: entry?.rates.DOUBLE ? String(entry.rates.DOUBLE) : '',
      SMALL: entry?.rates.SMALL ? String(entry.rates.SMALL) : '',
    },
    agreed: entry?.pricing === 'AGREED' ? String(entry.amount) : '',
    cash: entry ? String(entry.cash) : '',
    phonepe: entry ? String(entry.phonepe) : '',
    cashBy: entry?.cashHandledById ?? '',
    cashTime: entry?.cashTime ?? '',
    cashNo: entry?.cashReference ?? '',
    labour: entry?.laborCharge ? String(entry.laborCharge) : '',
    remarks: entry?.remarks ?? '',
    bookingId: '',
  };
}

/**
 * What the planner promised, typed into the voucher: the trader, the day, and those
 * trays on that shed's grade cell. It only fills the form — the booking is still a
 * plan until this entry saves. It states the figure rather than adding to it, so
 * picking a second booking swaps in its trays instead of stacking on the first.
 */
function applyBooking(f: EntryForm, b: EggSaleBooking): EntryForm {
  const cur = f.trays[b.shedId] ?? emptyTrays();
  return {
    ...f,
    bookingId: b.id,
    traderId: b.traderId,
    date: b.date,
    trays: { ...f.trays, [b.shedId]: { ...emptyTrays(), ...cur, [b.grade]: String(b.plannedTrays) } },
  };
}

function formLines(form: EntryForm): SaleEntryLine[] {
  return Object.entries(form.trays).map(([shedId, g]) => ({
    shedId,
    byGrade: {
      GOOD: Math.floor(num(g.GOOD)), BROKEN: Math.floor(num(g.BROKEN)),
      DOUBLE: Math.floor(num(g.DOUBLE)), SMALL: Math.floor(num(g.SMALL)),
    },
  })).filter(l => EGG_GRADES.some(g => l.byGrade[g] > 0));
}

/** `120 normal · 6 broken · 4 double` — what a row says about its grades. */
function gradeSummary(byGrade: EggGradeCounts): string {
  const text = EGG_GRADES.filter(g => byGrade[g] > 0).map(g => `${fmtIN(byGrade[g])} ${GRADE_WORD[g].toLowerCase()}`).join(' · ');
  return text || '—';
}

/* ============================= the filter model ============================= */

/** The windows a sales question is actually asked in. */
type DatePreset = 'TODAY' | 'YESTERDAY' | '7D' | '30D' | 'CUSTOM';
type PaymentFilter = 'ALL' | 'PAID' | 'PARTIAL' | 'PENDING';
/** MIXED describes a load rather than a grade: that load sold more than one grade. */
type GradeFilter = 'ALL' | 'MIXED' | EggGrade;

interface Filters {
  date: DatePreset;
  /** Only used by CUSTOM; either end may be blank while the picker is being filled in. */
  from: string;
  to: string;
  shedId: string;
  batchId: string;
  traderId: string;
  payment: PaymentFilter;
  grade: GradeFilter;
  q: string;
}

/** The screen opens on a month: a trend needs a span, a single day does not have one. */
const CLEAR_FILTERS: Filters = {
  date: '30D', from: '', to: '', shedId: '', batchId: '', traderId: '', payment: 'ALL', grade: 'ALL', q: '',
};

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: '7D', label: '7 days' },
  { value: '30D', label: '30 days' },
  { value: 'CUSTOM', label: 'Custom' },
];

const PAYMENT_FILTERS: { value: PaymentFilter; label: string }[] = [
  { value: 'ALL', label: 'Any' },
  { value: 'PAID', label: 'Fully paid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PENDING', label: 'Outstanding' },
];

const GRADE_FILTERS: { value: GradeFilter; label: string }[] = [
  { value: 'ALL', label: 'All eggs' },
  ...EGG_GRADES.map(g => ({ value: g as GradeFilter, label: GRADE_WORD[g] })),
  { value: 'MIXED', label: 'Mixed loads' },
];

const COLLECT_KEY: Record<EggGrade, keyof EggCollection> = {
  GOOD: 'goodTrays', BROKEN: 'brokenTrays', DOUBLE: 'doubleTrays', SMALL: 'smallTrays',
};

const r2 = (n: number) => Number(n.toFixed(2));
const isGrade = (g: GradeFilter): g is EggGrade => g !== 'ALL' && g !== 'MIXED';
const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function dateRange(f: Filters): { from: string; to: string } {
  const t = todayISO();
  if (f.date === 'TODAY') return { from: t, to: t };
  if (f.date === 'YESTERDAY') { const y = shiftDate(t, -1); return { from: y, to: y }; }
  if (f.date === '7D') return { from: shiftDate(t, -6), to: t };
  if (f.date === '30D') return { from: shiftDate(t, -29), to: t };
  const a = isISO(f.from) ? f.from : shiftDate(t, -29);
  const b = isISO(f.to) ? f.to : t;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

function filterCount(f: Filters): number {
  let n = 0;
  if (f.date !== CLEAR_FILTERS.date) n++;
  if (f.shedId) n++;
  if (f.batchId) n++;
  if (f.traderId) n++;
  if (f.payment !== 'ALL') n++;
  if (f.grade !== 'ALL') n++;
  if (f.q.trim()) n++;
  return n;
}

/* ============================= what the filters leave standing ============================= */

/** One billed load as the current filters see it: which trays count, and what those trays carried. */
interface LoadView {
  pos: SalePosition;
  entry: SaleEntry;
  /** Trays the egg-type filter counts on this load. */
  trays: number;
  /** What those trays were billed for, or null when the voucher priced the load as one agreed figure. */
  value: number | null;
  /** Egg money alone for those trays — loading labour is recovered on the voucher but it is never a price. */
  eggs: number | null;
  byGrade: EggGradeCounts;
  shedIds: string[];
  batchIds: string[];
}

/** The rate the voucher itself quoted for a grade — no other number may stand in for it. */
function gradedValue(entry: SaleEntry, grade: EggGrade): number | null {
  if (entry.pricing !== 'RATE') return null;
  const rate = entry.rates[grade];
  if (!rate || rate <= 0) return null;
  return r2(linesByGrade(entry.lines)[grade] * EGGS_PER_TRAY * rate);
}

function viewOf(pos: SalePosition, grade: GradeFilter, batches: Batch[]): LoadView {
  const entry = pos.entry;
  const byGrade = linesByGrade(entry.lines);
  const shedIds = entry.lines.map(l => l.shedId);
  const batchIds = [...new Set(shedIds
    .map(sh => batchOfShedOn(batches, sh, entry.date)?.id)
    .filter((b): b is string => !!b))];
  if (!isGrade(grade)) {
    return { pos, entry, trays: gradeTotal(byGrade), value: pos.billed, eggs: r2(entry.amount), byGrade, shedIds, batchIds };
  }
  const graded = gradedValue(entry, grade);
  return { pos, entry, trays: byGrade[grade], value: graded, eggs: graded, byGrade, shedIds, batchIds };
}

interface TraderRow {
  id: string; name: string; trays: number; value: number; billed: number; due: number; rate: number | null;
}

interface Scope {
  from: string; to: string; days: string[];
  views: LoadView[];
  trays: number; value: number; billed: number; received: number; outstanding: number;
  eggsValue: number; avgRate: number | null;
  /** Trays on loads whose egg money is known — the denominator of every per-egg rate here. */
  pricedTrays: number;
  traderCount: number; loadsDue: number; todayTrays: number; avgPerDay: number;
  unsplitLoads: number; unsplitBilled: number;
  byGrade: EggGradeCounts;
  traySeries: VPoint[]; valueSeries: VPoint[]; rateSeries: VPoint[]; collectedSeries: VPoint[];
  collectedTotal: number;
  traderRows: TraderRow[];
  warnings: string[];
}

const emptyGradeCounts = (): EggGradeCounts => ({ GOOD: 0, BROKEN: 0, DOUBLE: 0, SMALL: 0 });

/**
 * Every KPI, chart and row on this screen comes out of this one pass, so a filter that
 * changes the list necessarily changes the numbers above it. Money follows the voucher's
 * own arithmetic: a load priced per grade splits by grade, a load agreed as one figure
 * never is — it is counted in full or left out and named.
 */
function buildScope(
  entries: SaleEntry[], txns: TraderTxn[], batches: Batch[], eggs: EggCollection[],
  shedNames: (id: string) => string, traderNames: (id: string) => string, f: Filters,
): Scope {
  const { from, to } = dateRange(f);
  const days = dayKeys(from, to);
  const grade = f.grade;
  const q = f.q.trim().toLowerCase();

  const inScope = entries.filter(e => {
    if (!isISO(e.date) || e.date < from || e.date > to) return false;
    const by = linesByGrade(e.lines);
    if (grade === 'MIXED') { if (EGG_GRADES.filter(g => by[g] > 0).length < 2) return false; }
    else if (isGrade(grade) && by[grade] <= 0) return false;
    const sheds = e.lines.map(l => l.shedId);
    if (f.shedId && !sheds.includes(f.shedId)) return false;
    if (f.batchId && !sheds.some(sh => batches.some(b => b.id === f.batchId && b.shedId === sh))) return false;
    if (f.traderId && e.traderId !== f.traderId) return false;
    if (q) {
      const hay = [
        traderNames(e.traderId), e.remarks ?? '', e.cashReference ?? '',
        ...sheds.map(shedNames), ...EGG_GRADES.filter(g => by[g] > 0).map(g => GRADE_WORD[g].toLowerCase()),
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const positions = salePositions(inScope, txns)
    .filter(p => f.payment === 'ALL' || p.status === f.payment);
  const views = positions.map(p => viewOf(p, grade, batches));

  const traysByDay = new Map<string, number>();
  const valueByDay = new Map<string, number>();
  const eggsByDay = new Map<string, number>();
  const pricedByDay = new Map<string, number>();
  const byGrade = emptyGradeCounts();
  let trays = 0, value = 0, billed = 0, received = 0, outstanding = 0;
  let eggsValue = 0;
  let pricedTrays = 0, unsplitLoads = 0, unsplitBilled = 0, loadsDue = 0, todayTrays = 0;
  const today = todayISO();
  const perTrader = new Map<string, TraderRow & { priced: number; eggs: number }>();

  for (const v of views) {
    const d = v.entry.date;
    trays += v.trays;
    if (d === today) todayTrays += v.trays;
    traysByDay.set(d, (traysByDay.get(d) ?? 0) + v.trays);
    billed += v.pos.billed;
    received += v.pos.paid;
    if (v.pos.outstanding > 0) { outstanding += v.pos.outstanding; loadsDue++; }
    for (const g of EGG_GRADES) byGrade[g] += v.byGrade[g];
    if (v.value === null) { unsplitLoads++; unsplitBilled += v.pos.billed; }
    else {
      value += v.value;
      pricedTrays += v.trays;
      valueByDay.set(d, (valueByDay.get(d) ?? 0) + v.value);
      pricedByDay.set(d, (pricedByDay.get(d) ?? 0) + v.trays);
    }
    if (v.eggs !== null) {
      eggsValue += v.eggs;
      eggsByDay.set(d, (eggsByDay.get(d) ?? 0) + v.eggs);
    }
    const t = perTrader.get(v.entry.traderId)
      ?? { id: v.entry.traderId, name: traderNames(v.entry.traderId), trays: 0, value: 0, billed: 0, due: 0, rate: null, priced: 0, eggs: 0 };
    t.trays += v.trays;
    t.billed += v.pos.billed;
    t.due += Math.max(0, v.pos.outstanding);
    if (v.value !== null) { t.value += v.value; t.priced += v.trays; }
    if (v.eggs !== null) t.eggs += v.eggs;
    perTrader.set(v.entry.traderId, t);
  }

  const collectedByDay = new Map<string, number>();
  for (const e of eggs) {
    if (!isISO(e.date) || e.date < from || e.date > to) continue;
    if (f.shedId && e.shedId !== f.shedId) continue;
    if (f.batchId && e.batchId !== f.batchId) continue;
    const n = isGrade(grade) ? (Number(e[COLLECT_KEY[grade]]) || 0)
      : EGG_GRADES.reduce((s, g) => s + (Number(e[COLLECT_KEY[g]]) || 0), 0);
    collectedByDay.set(e.date, (collectedByDay.get(e.date) ?? 0) + n);
  }

  const point = (m: Map<string, number>, d: string): VPoint => ({ date: d, value: m.has(d) ? r2(m.get(d)!) : null });
  const traderRows = [...perTrader.values()]
    .map(t => ({
      ...t, value: r2(t.value), billed: r2(t.billed), due: r2(t.due),
      rate: ratePerEgg(t.eggs, t.priced),
    }))
    .sort((a, b) => (isGrade(grade) || grade === 'ALL' ? b.value - a.value || b.billed - a.billed : 0) || b.trays - a.trays || a.name.localeCompare(b.name));

  const warnings: string[] = [];
  if (unsplitLoads) {
    warnings.push(`${unsplitLoads} ${unsplitLoads === 1 ? 'load was' : 'loads were'} priced as one agreed figure, so ${fmtMoney(unsplitBilled)} of billed value could not be split by grade and is left out of these figures.`);
  }
  if (!views.length) warnings.push(`No sale entry matched these filters between ${fmtDate(from)} and ${fmtDate(to)}.`);

  return {
    from, to, days, views,
    trays, value: r2(value), billed: r2(billed), received: r2(received), outstanding: r2(outstanding),
    eggsValue: r2(eggsValue), pricedTrays, avgRate: ratePerEgg(eggsValue, pricedTrays),
    traderCount: perTrader.size, loadsDue, todayTrays,
    avgPerDay: days.length ? r2(trays / days.length) : trays,
    unsplitLoads, unsplitBilled: r2(unsplitBilled), byGrade,
    traySeries: days.map(d => point(traysByDay, d)),
    valueSeries: days.map(d => point(valueByDay, d)),
    rateSeries: days.map(d => ({ date: d, value: ratePerEgg(eggsByDay.get(d) ?? null, pricedByDay.get(d) ?? null) })),
    collectedSeries: days.map(d => point(collectedByDay, d)),
    collectedTotal: r2([...collectedByDay.values()].reduce((s, v) => s + v, 0)),
    traderRows, warnings,
  };
}

function FilterLabel({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-2 mb-1.5">{children}</p>;
}

/** The same controls inline on a desk and inside a sheet on a phone — one state, one shape. */
function FilterControls({ flt, set, data, onClear }: {
  flt: Filters; set: (f: Filters) => void; data: CompanyData; onClear: () => void;
}) {
  const sheds = data.sheds;
  const batchOptions = (flt.shedId ? data.batches.filter(b => b.shedId === flt.shedId) : data.batches)
    .slice()
    .sort((a, b) => (a.status === b.status ? a.code.localeCompare(b.code) : a.status === 'ACTIVE' ? -1 : 1));
  return (
    <div className="space-y-3.5">
      <SearchField value={flt.q} onChange={q => set({ ...flt, q })}
        placeholder="Search trader, shed, remark or receipt no." />

      <div>
        <FilterLabel>Date</FilterLabel>
        <ChipGroup value={flt.date} onChange={date => set({ ...flt, date })} options={DATE_PRESETS} />
        {flt.date === 'CUSTOM' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Field label="From" type="date" value={flt.from} onChange={e => set({ ...flt, from: e.target.value })} />
            <Field label="To" type="date" value={flt.to} onChange={e => set({ ...flt, to: e.target.value })} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sheds.length > 1 && (
          <SelectField label="Shed" value={flt.shedId} onChange={e => set({ ...flt, shedId: e.target.value, batchId: '' })}
            options={[{ value: '', label: 'All sheds' }, ...sheds.map(s => ({ value: s.id, label: s.name }))]} />
        )}
        {batchOptions.length > 1 && (
          <SelectField label="Batch" value={flt.batchId} onChange={e => set({ ...flt, batchId: e.target.value })}
            options={[{ value: '', label: 'All batches' }, ...batchOptions.map(b => ({
              value: b.id, label: `${b.code} · ${b.status === 'ACTIVE' ? 'Live' : 'Closed'}`,
            }))]} />
        )}
        {data.traders.length > 1 && (
          <SelectField label="Trader" value={flt.traderId} onChange={e => set({ ...flt, traderId: e.target.value })}
            options={[{ value: '', label: 'All traders' }, ...data.traders.map(t => ({ value: t.id, label: t.name }))]} />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
        <div>
          <FilterLabel>Payment</FilterLabel>
          <ChipGroup value={flt.payment} onChange={payment => set({ ...flt, payment })} options={PAYMENT_FILTERS} />
        </div>
        <div>
          <FilterLabel>Egg type</FilterLabel>
          <ChipGroup value={flt.grade} onChange={grade => set({ ...flt, grade })} options={GRADE_FILTERS} />
        </div>
      </div>

      <div className="flex justify-end pt-0.5">
        <button type="button" onClick={onClear}
          className="press inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted hover:text-ink">
          <RotateCcw size={12} /> Clear filters
        </button>
      </div>
    </div>
  );
}

/** The only sheds a voucher may draw from: those with at least one tray still on hand. */
function shedsWithEggStock(data: ReturnType<typeof useCompanyData>) {
  return data.sheds.filter(sh =>
    EGG_GRADES.some(g => eggStockByGrade(sh.id, data.eggs, data.saleEntries, data.eggWastages)[g].balance > 0));
}

export function SalesScreen() {
  const data = useCompanyData();
  const canCreate = useCan('create');
  const canEntry = useCan('createSaleEntries');
  const canAck = useCan('acknowledgeSales');
  const canFinance = useCan('viewFinance');
  const addSaleLog = useApp(s => s.addSaleLog);
  const acknowledgeSaleLog = useApp(s => s.acknowledgeSaleLog);
  const addSaleEntry = useApp(s => s.addSaleEntry);
  const updateSaleEntry = useApp(s => s.updateSaleEntry);
  const deleteSaleEntry = useApp(s => s.deleteSaleEntry);
  const fulfillBooking = useApp(s => s.fulfillEggSalePlannerBooking);
  const canDelete = useCan('delete');
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();

  /** Every KPI, chart and row on this screen is a reading of this one filter object. */
  const [flt, setFlt] = useState<Filters>(CLEAR_FILTERS);
  const [filterSheet, setFilterSheet] = useState(false);
  const clearFilters = () => setFlt({ ...CLEAR_FILTERS });

  /** The page is the sales list; the shed's dispatch notes are a reveal, not a tab to choose first. */
  const [showLogs, setShowLogs] = useState(params.get('tab') === 'logs');
  const [trend, setTrend] = useState<Trend>('value');
  const [logDialog, setLogDialog] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shedsWithStock = shedsWithEggStock(data);

  const activeSheds = data.sheds.filter(sh => data.batches.some(b => b.shedId === sh.id && b.status === 'ACTIVE'));
  const [logForm, setLogForm] = useState({
    shedId: activeSheds[0]?.id ?? '', trays: 10, grade: 'GOOD' as EggGrade, date: todayISO(), remarks: '',
  });

  /** Every company carries one walk-in account, so a gate sale never has to invent a trader. */
  const walkInId = data.traders.find(isWalkInTrader)?.id ?? '';

  const [form, setForm] = useState<EntryForm>(() => formFromEntry(undefined, walkInId));

  /** A booking can name a shed whose trays are not laid yet, so the form keeps showing
   * whatever shed it already carries — the stock check at save time is the honest gate. */
  const entrySheds = useMemo(() => {
    const ids = new Set([...shedsWithStock.map(s => s.id), ...Object.keys(form.trays)]);
    return data.sheds.filter(s => ids.has(s.id));
  }, [shedsWithStock, form.trays, data.sheds]);

  const logs = useMemo(() => latestFirst(data.saleLogs), [data.saleLogs]);
  const entries = useMemo(() => latestFirst(data.saleEntries), [data.saleEntries]);

  const shedName = (id: string) => data.sheds.find(s => s.id === id)?.name ?? '—';
  const traderName = (id: string) => data.traders.find(t => t.id === id)?.name ?? '—';
  const batchCode = (id: string) => data.batches.find(b => b.id === id)?.code ?? '—';

  /**
   * One pass over the ledger feeds the KPIs, every chart and the list, so a filter can never
   * move one of them and leave the others telling the old story.
   */
  const scope = useMemo(
    () => buildScope(data.saleEntries, data.traderTxns, data.batches, data.eggs, shedName, traderName, flt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.saleEntries, data.traderTxns, data.batches, data.eggs, data.sheds, data.traders, flt],
  );
  /** The dispatch tab is kept in the same window, so the two tabs tell one story. */
  const scopedLogs = useMemo(() => logs.filter(l =>
    l.date >= scope.from && l.date <= scope.to
    && (!flt.shedId || l.shedId === flt.shedId)
    && (!flt.batchId || l.batchId === flt.batchId)
    && (!isGrade(flt.grade) || l.grade === flt.grade)),
  [logs, scope.from, scope.to, flt]);

  const activeLabels = useMemo(() => {
    const out: string[] = [];
    if (flt.date !== CLEAR_FILTERS.date) out.push(DATE_PRESETS.find(p => p.value === flt.date)?.label ?? '');
    const shed = data.sheds.find(s => s.id === flt.shedId); if (shed) out.push(shed.name);
    const batch = data.batches.find(b => b.id === flt.batchId); if (batch) out.push(batch.code);
    const trader = data.traders.find(t => t.id === flt.traderId); if (trader) out.push(trader.name);
    if (flt.payment !== 'ALL') out.push(PAYMENT_FILTERS.find(p => p.value === flt.payment)?.label ?? '');
    if (flt.grade !== 'ALL') out.push(GRADE_FILTERS.find(g => g.value === flt.grade)?.label ?? '');
    if (flt.q.trim()) out.push(`“${flt.q.trim()}”`);
    return out.filter(Boolean);
  }, [flt, data.sheds, data.batches, data.traders]);

  function openNewEntry() {
    setEditing(null);
    setForm(formFromEntry(undefined, walkInId));
    setError(null);
    setEntryOpen(true);
  }

  function openEntry(entry: SaleEntry) {
    setEditing(entry.id);
    setForm(formFromEntry(entry));
    setError(null);
    setEntryOpen(true);
  }

  function submitLog() {
    setError(null);
    const batch = data.batches.find(b => b.shedId === logForm.shedId && b.status === 'ACTIVE');
    if (!batch) { setError('This shed has no active batch'); return; }
    const r = addSaleLog({
      shedId: logForm.shedId, batchId: batch.id, date: logForm.date,
      trays: logForm.trays, grade: logForm.grade, remarks: logForm.remarks || undefined,
    });
    if (!r.ok) { setError(r.error ?? 'Failed'); return; }
    setLogDialog(false);
    setLogForm({ ...logForm, trays: 10, remarks: '' });
  }

  function submitEntry(draft: SaleEntryDraft) {
    setError(null);
    const r: Result & { id?: string } = editing ? updateSaleEntry(editing, draft) : addSaleEntry(draft);
    if (!r.ok) { setError(r.error ?? 'Failed to save the sale entry'); return; }
    // Only a voucher that exists may call a plan sold, so a failed form leaves the booking PLANNED.
    if (!editing && form.bookingId && r.id) fulfillBooking(form.bookingId, r.id);
    setEntryOpen(false);
  }

  /** Arriving from the planner with a booking in hand raises the voucher it sold. */
  useEffect(() => {
    const planned = params.get('planner');
    if (!planned) return;
    const b = data.eggSaleBookings.find(x => x.id === planned && x.status === 'PLANNED');
    if (b && canEntry) {
      setEditing(null);
      setForm(f => applyBooking(f, b));
      setError(null);
      setEntryOpen(true);
    }
    setParams({}, { replace: true });
  }, [params, setParams, data.eggSaleBookings, canEntry]);

  /** A sale's own page asks to be edited here rather than holding a second copy of the form. */
  useEffect(() => {
    const id = params.get('edit');
    if (!id) return;
    const target = data.saleEntries.find(x => x.id === id);
    if (target && canEntry) {
      setEditing(target.id);
      setForm(formFromEntry(target));
      setError(null);
      setEntryOpen(true);
    }
    setParams({}, { replace: true });
  }, [params, setParams, data.saleEntries, canEntry]);

  /**
   * Arriving from the egg screen with a grade in hand: that shed's tray grid is
   * already open, and a damaged or rejected grade opens priced as one agreed
   * figure — which is how such a load actually settles at the gate.
   */
  useEffect(() => {
    const grade = params.get('sell') as EggGrade | null;
    if (!grade) return;
    if (EGG_GRADES.includes(grade) && canEntry) {
      const shedId = params.get('shed') ?? '';
      const base = formFromEntry(undefined, walkInId);
      setEditing(null);
      setForm({
        ...base,
        pricing: grade === 'GOOD' ? base.pricing : 'AGREED',
        trays: shedId ? { [shedId]: emptyTrays() } : base.trays,
      });
      setError(null);
      setEntryOpen(true);
    }
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams, canEntry]);

  function removeEntry() {
    const id = deleteTarget;
    setDeleteTarget(null);
    if (!id) return;
    const r = deleteSaleEntry(id);
    if (!r.ok) { setError(r.error ?? 'Could not delete the sale entry'); return; }
    setEntryOpen(false);
  }

  const stockBalance = logForm.shedId
    ? eggStockByGrade(logForm.shedId, data.eggs, data.saleEntries, data.eggWastages)[logForm.grade].balance : 0;

  const hasLoads = scope.views.length > 0;
  const loadWord = scope.views.length === 1 ? 'load' : 'loads';
  const receivedFoot = scope.billed === 0 ? 'Nothing billed yet'
    : scope.value === scope.billed ? `${fmtPct((scope.received / scope.billed) * 100, 0)} of billed`
    : `of the whole ${fmtMoney(scope.billed)} billed`;
  /** One chart, drawn in whichever coin the question was asked. */
  const trendSeries: VSeries[] = trend === 'value'
    ? [{ id: 'value', label: 'Billed', color: CHART.accent, points: scope.valueSeries, area: true }]
    : [{ id: 'trays', label: 'Trays billed', color: CHART.brand, points: scope.traySeries, area: true }];
  /** A window of one day is today's sales; anything wider is honestly a range. */
  const singleDay = scope.from === scope.to;
  const listTitle = singleDay
    ? (scope.from === todayISO() ? 'Today’s sales' : `Sales · ${fmtDate(scope.from)}`)
    : 'Sales in view';
  const noData = {
    title: 'No sales match these filters',
    description: 'Widen the window, clear a filter, or raise a sale entry when the van leaves.',
  };

  return (
    <Page withNav>
      <PageReveal>
      <ScreenTitle
        eyebrow="Commerce" title="Egg Sales"
        subtitle={`Today · ${fmtDate(todayISO())}`}
        action={canEntry
          ? <Button size="sm" icon={<Plus size={15} />} onClick={openNewEntry}>Sale Entry</Button>
          : canCreate
            ? <Button size="sm" variant="outline" icon={<Plus size={15} />} onClick={() => { setError(null); setLogDialog(true); }}>Sale log</Button>
            : undefined}
      />

      <div className="px-4 sm:px-0 mt-1 flex flex-col gap-4">
        {/* The four questions, in the four largest numbers on the page. */}
        <ScrollReveal>
        <section className="space-y-2">
          <div className={clsx('grid gap-2.5', canFinance ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2')}>
            <KpiCard label="Trays sold" value={fmtIN(scope.trays)} unit="trays"
              foot={`${fmtIN(scope.avgPerDay)} a day`} />
            {canFinance && (
              <KpiCard label="Sales value" value={fmtMoney(scope.value)}
                foot={`${fmtIN(scope.views.length)} ${loadWord} billed`} />
            )}
            {canFinance && (
              <KpiCard label="Received" value={fmtMoney(scope.received)} valueTone="success"
                foot={receivedFoot} />
            )}
            {canFinance && (
              <KpiCard label="Outstanding" value={fmtMoney(scope.outstanding)} valueTone={scope.outstanding > 0 ? 'warn' : 'ink'}
                foot={scope.loadsDue === 0 ? 'Nothing outstanding'
                  : `${fmtIN(scope.loadsDue)} of ${fmtIN(scope.views.length)} ${loadWord} not settled`} />
            )}
          </div>

          {/* Who bought, and at what average — one line, so no chart competes with the numbers above. */}
          <p className="text-[12px] text-muted leading-snug px-0.5 tnum">
            {hasLoads ? (
              <>
                <span className="font-semibold text-ink-2">{fmtIN(scope.views.length)} {scope.views.length === 1 ? 'sale' : 'sales'}</span>
                {' '}· {fmtIN(scope.traderCount)} {scope.traderCount === 1 ? 'trader' : 'traders'}
                {canFinance && <> · Avg <span className="font-semibold text-ink-2">
                  {scope.avgRate === null ? 'no graded rate' : `${fmtMoney(scope.avgRate, 2)}/egg`}
                </span></>}
              </>
            ) : (
              <span className="font-semibold text-ink-2">
                {entries.length === 0 ? 'No sale billed yet' : 'No sale billed in this window'}
              </span>
            )}
          </p>

          {canFinance && (
            <p className="text-[11px] text-muted leading-snug px-0.5">
              Sales value is what these loads were billed for. Received is the money that actually arrived —
              cash, online payment, and receipts Finance booked later. Outstanding is what the trader still owes.
            </p>
          )}
        </section>
        </ScrollReveal>

        {/* ---------------- the sales themselves: this page's reason for existing ---------------- */}
        <section>
          <SectionTitle right={
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[10px] text-muted-2 tnum">{fmtIN(scope.views.length)} of {fmtIN(entries.length)} loads</span>
              <Button size="sm" variant="outline" icon={<SlidersHorizontal size={14} />} onClick={() => setFilterSheet(true)}>
                Filters{filterCount(flt) ? ` · ${filterCount(flt)}` : ''}
              </Button>
            </div>
          }>{listTitle}</SectionTitle>

          <div className="flex items-center gap-2 flex-wrap mb-2.5 px-0.5">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-2 tnum">
              <CalendarRange size={12} />{fmtDate(scope.from)} – {fmtDate(scope.to)}
            </span>
            {activeLabels.map(l => (
              <span key={l} className="rounded-full bg-brand-soft text-brand-ink px-2.5 py-1 font-mono text-[10px] font-semibold truncate max-w-full">{l}</span>
            ))}
            {filterCount(flt) > 0 && (
              <button type="button" onClick={clearFilters}
                className="press inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted hover:text-ink">
                <RotateCcw size={12} /> Clear
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <EmptyState icon={<Handshake size={20} />} title="No sales recorded yet"
              description="When the van leaves, accounts records what each shed sold, the rate and how the money came in." />
          ) : !hasLoads ? (
            <EmptyState icon={<SlidersHorizontal size={20} />} title="No sales in this window"
              description="No billed load carries every filter at once. Widen the dates or clear a filter."
              action={<Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>} />
          ) : (
            <StaggerContainer>
              {scope.views.map(v => {
                const entry = v.entry;
                return (
                  <StaggerItem key={entry.id} as="div">
                  <ListRow
                    onClick={() => nav(`/sales/entry/${entry.id}`)}
                    leading={<span className="w-9 h-9 rounded-[10px] bg-brand-soft text-brand-ink flex items-center justify-center shrink-0"><Truck size={16} /></span>}
                    title={<span className="flex items-center gap-2 min-w-0">{traderName(entry.traderId)}
                      {canFinance && <Badge tone={PAY_WORD[v.pos.status].tone}>{PAY_WORD[v.pos.status].label}</Badge>}
                    </span>}
                    subtitle={`${fmtDate(entry.date)} · ${fmtIN(v.trays)} trays · ${v.shedIds.map(shedName).join(', ')}${v.batchIds.length ? ` · ${v.batchIds.map(batchCode).join(', ')}` : ''}`}
                    trailing={
                      <div className="text-right shrink-0">
                        {canFinance ? (
                          <>
                            <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtMoney(v.value ?? v.pos.billed)}</p>
                            {v.pos.outstanding > 0 && (
                              <p className="font-mono text-[10px] tnum text-warn font-semibold">{fmtMoney(v.pos.outstanding)} due</p>
                            )}
                          </>
                        ) : <StatusBadge status={v.pos.status} />}
                        {canEntry
                          ? <span className="block mt-1" onClick={e => e.stopPropagation()}>
                            <button type="button" onClick={() => openEntry(entry)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand press"><PenLine size={11} /> Edit</button>
                          </span>
                          : null}
                      </div>
                    }
                  />
                  </StaggerItem>
                );
              })}
              </StaggerContainer>
          )}
        </section>

        {/* ---------------- one chart, in the coin the question was asked ---------------- */}
        <ChartReveal>
        <GraphCard
          title="Sales trend"
          subtitle={`${trend === 'value' ? 'What each day’s loads were billed for' : 'Trays billed each day'} · ${fmtDate(scope.from)} – ${fmtDate(scope.to)}`}
          actions={<GraphRange value={trend} onChange={setTrend} label="Trend measure" options={[
            { value: 'value', label: '₹ Value' },
            { value: 'trays', label: 'Trays' },
          ]} />}
          stats={trend === 'value'
            ? [
              { label: 'In view', value: fmtMoney(scope.value) },
              { label: 'Per day', value: fmtMoney(scope.days.length ? r2(scope.value / scope.days.length) : scope.value), tone: 'muted' },
            ]
            : [
              { label: 'In view', value: fmtIN(scope.trays), sub: 'trays' },
              { label: 'Per day', value: fmtIN(scope.avgPerDay), sub: 'trays', tone: 'muted' },
            ]}
          warnings={trend === 'value' ? scope.warnings.filter(w => w.includes('agreed')) : undefined}
          empty={hasLoads ? undefined : noData}
          height={200}
        >
          <TrendChart series={trendSeries} height={194}
            format={trend === 'value' ? v => fmtMoney(v) : v => `${fmtIN(v)} trays`} />
        </GraphCard>
        </ChartReveal>

        {/* ---------------- who bought the eggs ---------------- */}
        <ChartReveal>
        <GraphCard
          title="Sales by trader"
          subtitle={canFinance ? 'Who took the load, how many trays, and what they were billed.' : 'Who took the load, and how many trays they carried.'}
          empty={hasLoads ? undefined : noData}
          height={190}
        >
          <HBarList
            rows={scope.traderRows.slice(0, 6).map(t => ({
              id: t.id,
              label: t.name,
              value: canFinance ? (t.value > 0 ? t.value : t.billed) : t.trays,
              display: canFinance ? fmtMoney(t.value > 0 ? t.value : t.billed) : `${fmtIN(t.trays)} trays`,
              sub: canFinance
                ? `${fmtIN(t.trays)} trays · ${t.due > 0 ? `${fmtMoney(t.due)} outstanding` : 'settled'}`
                : `${fmtIN(t.trays)} trays`,
              tone: t.due > 0 ? 'warn' as const : 'normal' as const,
            }))}
            onPick={id => setFlt({ ...flt, traderId: id })}
            caption={scope.traderRows.length > 6
              ? `${scope.traderRows.length - 6} more ${scope.traderRows.length - 6 === 1 ? 'trader' : 'traders'} bought in this window — tap one to scope the whole screen to them.`
              : 'Tap a trader to scope every figure on this screen to them.'}
          />
        </GraphCard>
        </ChartReveal>

        {/* ---------------- the shed’s note of the van, quiet until asked for ---------------- */}
        <section className="space-y-2">
          <SectionTitle right={
            <button type="button" onClick={() => setShowLogs(v => !v)}
              className="press font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand">
              {showLogs ? 'Hide' : 'Show'} · {fmtIN(scopedLogs.length)}
            </button>
          }>Dispatch logs</SectionTitle>

          {showLogs && (
            <>
              <p className="text-[11.5px] text-muted leading-snug px-0.5">
                <span className="font-semibold text-ink-2">A dispatch log is the shed’s note of the van.</span>
                {' '}It moves no stock and no money — a load only leaves the shed when its sale entry is billed. Trader, payment and search filters do not apply here.
              </p>
              {logs.length === 0 ? (
                <EmptyState icon={<Receipt size={20} />} title="No dispatch logs yet"
                  description="The shed notes what left with the van. Accounts confirms it has seen it." />
              ) : scopedLogs.length === 0 ? (
                <EmptyState icon={<Receipt size={20} />} title="No dispatch note in this window"
                  description="Nothing was logged out of these sheds between these dates." />
              ) : (
                <GroupList>
                  {scopedLogs.map(l => (
                    <ListRow key={l.id}
                      leading={<span className="w-9 h-9 rounded-[10px] bg-sunk text-ink-2 flex items-center justify-center shrink-0"><Egg size={16} /></span>}
                      title={<span className="flex items-center gap-2">{fmtIN(l.trays)} trays · {shedName(l.shedId)}
                        <Badge tone={l.grade === 'GOOD' ? 'brand' : 'warn'}>{GRADE_WORD[l.grade]}</Badge>
                      </span>}
                      subtitle={`${fmtDate(l.date)} · ${fmtIN(l.trays * 30)} eggs${l.workerName ? ` · ${l.workerName}` : ''}`}
                      trailing={
                        l.status === 'ACKNOWLEDGED'
                          ? <Badge tone="brand">Seen</Badge>
                          : canAck
                            ? <Button size="sm" variant="outline" icon={<CheckCheck size={14} />}
                              onClick={() => acknowledgeSaleLog(l.id)}>Acknowledge</Button>
                            : <StatusBadge status="PENDING" />
                      }
                    />
                  ))}
                </GroupList>
              )}
            </>
          )}
        </section>
      </div>

      {/* Filters live behind this one button, so the page never spends its height on a bar. */}
      <Dialog open={filterSheet} onClose={() => setFilterSheet(false)} title="Filter sales"
        subtitle="Every figure, chart and row on this screen follows these filters."
        footer={<Button block onClick={() => setFilterSheet(false)}>Show {fmtIN(scope.views.length)} {loadWord}</Button>}>
        <FilterControls flt={flt} set={setFlt} data={data} onClear={clearFilters} />
      </Dialog>

      {/* Shed dispatch note */}
      <Dialog open={logDialog} onClose={() => setLogDialog(false)} title="New dispatch log"
        subtitle="What left the shed with the van. Stock is only reduced when accounts saves the sale entry."
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setLogDialog(false)}>Cancel</Button><Button block onClick={submitLog}>Save log</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Shed" value={logForm.shedId} onChange={e => setLogForm({ ...logForm, shedId: e.target.value })}
            options={activeSheds.map(s => ({ value: s.id, label: s.name }))} />
          {logForm.shedId && (
            <p className="text-[12px] text-muted bg-sunk rounded-[10px] px-3 py-2">
              {GRADE_WORD[logForm.grade]} trays in stock:{' '}
              <span className="font-mono font-semibold text-ink tnum">{fmtIN(stockBalance)}</span>
            </p>
          )}
          <div>
            <p className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Trays</p>
            <Stepper value={logForm.trays} onChange={v => setLogForm({ ...logForm, trays: v })} min={1} step={1} suffix="trays" />
          </div>
          <SegmentedTabs value={logForm.grade} scroll onChange={g => setLogForm({ ...logForm, grade: g as EggGrade })}
            options={EGG_GRADES.map(g => ({ value: g, label: GRADE_WORD[g] }))} />
          <Field label="Date" type="date" value={logForm.date} onChange={e => setLogForm({ ...logForm, date: e.target.value })} />
          <Field label="Remarks (optional)" value={logForm.remarks} onChange={e => setLogForm({ ...logForm, remarks: e.target.value })} placeholder="Buyer / vehicle / notes" />
          {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        </div>
      </Dialog>

      <SaleEntrySheet open={entryOpen} onClose={() => setEntryOpen(false)}
        form={form} setForm={setForm} error={error} setError={setError}
        editing={editing ? entries.find(e => e.id === editing) ?? null : null}
        sheds={entrySheds} eggs={data.eggs} entries={data.saleEntries}
        canFinance={canFinance} onSubmit={submitEntry}
        canDelete={canDelete} onDelete={() => setDeleteTarget(editing)}
      />

      <ConfirmDialog open={!!deleteTarget} title="Delete this sale entry?"
        message="Its trader and finance ledger rows are removed with it, and the trays go back to the shed stock."
        confirmLabel="Delete" danger onConfirm={removeEntry} onCancel={() => setDeleteTarget(null)} />
      </PageReveal>
    </Page>
  );
}

/* ============================= the entry form ============================= */

/** A numbered block, so a long form reads as steps rather than one field dump. */
function Section({ n, title, hint, children }: {
  n: number; title: string; hint?: string; children: ReactNode;
}) {
  return (
    <section className="rounded-[16px] border border-line bg-card p-3.5 space-y-3">
      <header className="flex items-center gap-2.5">
        <span className="w-6 h-6 shrink-0 rounded-full bg-sunk text-muted text-[11px] font-bold font-mono flex items-center justify-center">{n}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink leading-tight">{title}</p>
          {hint && <p className="text-[11px] text-muted leading-tight mt-0.5">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function MoneyLine({ label, value, tone = 'ink', strong, sign }: {
  label: string; value: number; tone?: 'ink' | 'muted' | 'danger' | 'success' | 'warn'; strong?: boolean; sign?: '+' | '−';
}) {
  const toneClass = { ink: 'text-ink', muted: 'text-muted', danger: 'text-danger', success: 'text-success', warn: 'text-warn' }[tone];
  return (
    <p className={clsx('flex items-baseline justify-between gap-3 text-[13px]', strong ? 'font-semibold text-ink' : 'text-muted')}>
      <span>{label}</span>
      <span className={clsx('font-mono tnum', toneClass)}>{sign}{fmtMoney(value)}</span>
    </p>
  );
}

/**
 * The same voucher raised where the work is: a batch or shed screen opens this instead of
 * sending the user to the sales list first. Only the shed it was opened from is loaded in;
 * every other part of the form, and every ledger row it writes, is the sales screen's own.
 */
export function SaleEntryDialog({ open, onClose, presetShedId }: {
  open: boolean; onClose: () => void; presetShedId?: string;
}) {
  const data = useCompanyData();
  const canFinance = useCan('viewFinance');
  const addSaleEntry = useApp(s => s.addSaleEntry);
  const walkInId = data.traders.find(isWalkInTrader)?.id ?? '';
  const [form, setForm] = useState<EntryForm>(() => formFromEntry(undefined, walkInId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const base = formFromEntry(undefined, walkInId);
    setForm({ ...base, trays: presetShedId ? { [presetShedId]: emptyTrays() } : base.trays });
    setError(null);
  }, [open, walkInId, presetShedId]);

  const sheds = useMemo(() => {
    const ids = new Set([...shedsWithEggStock(data).map(s => s.id), ...Object.keys(form.trays)]);
    return data.sheds.filter(s => ids.has(s.id));
  }, [data, form.trays]);

  function submit(draft: SaleEntryDraft) {
    setError(null);
    const r = addSaleEntry(draft);
    if (!r.ok) { setError(r.error ?? 'Failed to save the sale entry'); return; }
    onClose();
  }

  return (
    <SaleEntrySheet open={open} onClose={onClose} form={form} setForm={setForm}
      error={error} setError={setError} editing={null} sheds={sheds}
      eggs={data.eggs} entries={data.saleEntries} canFinance={canFinance}
      canDelete={false} onDelete={() => {}} onSubmit={submit} />
  );
}

function SaleEntrySheet({ open, onClose, form, setForm, error, setError, editing, sheds, eggs, entries, canFinance, canDelete, onDelete, onSubmit }: {
  open: boolean; onClose: () => void; form: EntryForm; setForm: Dispatch<SetStateAction<EntryForm>>;
  error: string | null; setError: (v: string | null) => void;
  editing: SaleEntry | null; sheds: { id: string; name: string }[];
  eggs: EggCollection[]; entries: SaleEntry[]; canFinance: boolean;
  canDelete: boolean; onDelete: () => void;
  onSubmit: (draft: SaleEntryDraft) => void;
}) {
  const data = useCompanyData();
  const cashPeople = useApp(s => s.cashPeople);
  const takeReceiptNo = useApp(s => s.takeReceiptNo);
  const addTrader = useApp(s => s.addTrader);
  const pushToast = useApp(s => s.pushToast);
  const canAddTrader = useCan('manageTraders');
  /** Only the people who may keep the trader book may extend it from a voucher. */
  const [traderOpen, setTraderOpen] = useState(false);
  const [tform, setTform] = useState({ name: '', mobile: '' });
  const [tErr, setTErr] = useState<string | null>(null);
  /** Only the company's own people may be named as the one who held the cash. */
  const people = useMemo(() => cashPeople(), [cashPeople, data.users]);
  const set = <K extends keyof EntryForm>(key: K, v: EntryForm[K]) => setForm(f => ({ ...f, [key]: v }));
  const r2 = (n: number) => Number(n.toFixed(2));

  /** Loads the planner promised that no voucher has sold yet. */
  const openBookings = useMemo(
    () => latestFirst(data.eggSaleBookings.filter(b => b.status === 'PLANNED')),
    [data.eggSaleBookings],
  );

  /** The walk-in account is a fallback, so it says so and is asked for last. */
  const traderOptions = useMemo(() => {
    const label = (t: Trader) => isWalkInTrader(t)
      ? `${t.name} · walk-in at the gate`
      : canFinance && t.outstandingAmount > 0 ? `${t.name} · ${fmtMoney(t.outstandingAmount)} due` : t.name;
    return [
      { value: '', label: 'Select trader' },
      ...data.traders.filter(t => !isWalkInTrader(t)).map(t => ({ value: t.id, label: label(t) })),
      ...data.traders.filter(isWalkInTrader).map(t => ({ value: t.id, label: label(t) })),
    ];
  }, [data.traders, canFinance]);

  const lines = formLines(form);
  const rates: GradeRates = {};
  for (const g of EGG_GRADES) if (num(form.rates[g]) > 0) rates[g] = num(form.rates[g]);
  const byGrade = linesByGrade(lines);
  const soldGrades = EGG_GRADES.filter(g => byGrade[g] > 0);

  const eggsValue = entryAmount(lines, rates, form.pricing, num(form.agreed));
  const labour = num(form.labour);
  const billed = loadBilled(eggsValue, labour);

  const cash = num(form.cash), phonepe = num(form.phonepe);
  /** Money taken ahead is already a transaction of its own, so a voucher never captures an
   *  advance. One saved before that rule keeps its figure — dropping it would re-open dues
   *  the trader had already settled. */
  const advance = editing?.advance ?? 0;
  const paid = loadPaid(cash, phonepe, advance);
  const loadBalance = r2(billed - paid);

  const trader = data.traders.find(t => t.id === form.traderId);
  const oldBalance = r2((trader?.outstandingAmount ?? 0) - (editing?.credit ?? 0));
  const newBalance = r2(oldBalance + loadBalance);

  const opened = sheds.filter(s => form.trays[s.id]);
  const rest = sheds.filter(s => !form.trays[s.id]);
  const stockOf = (shedId: string) => eggStockByGrade(shedId, eggs, entries.filter(e => e.id !== editing?.id), data.eggWastages);

  function save() {
    setError(null);
    if (!form.traderId) { setError('Select the trader'); return; }
    if (lines.length === 0) { setError('Enter the trays sold from at least one shed'); return; }
    if (eggsValue <= 0) {
      setError(form.pricing === 'AGREED' ? 'Enter the amount agreed for this load' : 'Set a per-egg rate for the grades you sold');
      return;
    }
    onSubmit({
      traderId: form.traderId, date: form.date, lines, rates, pricing: form.pricing,
      amount: form.pricing === 'AGREED' ? num(form.agreed) : undefined,
      cash, phonepe, advance, laborCharge: labour,
      remarks: form.remarks || undefined,
      // Cash names its custodian; a load with no cash in it carries no custody fields.
      cashHandledById: cash > 0 ? (form.cashBy || undefined) : undefined,
      cashTime: cash > 0 ? (form.cashTime || undefined) : undefined,
      cashReference: cash > 0 ? (form.cashNo.trim() || undefined) : undefined,
    });
  }

  /** A trader met at the gate is typed here rather than sent away to another screen. */
  function createTrader() {
    const name = tform.name.trim();
    const mobile = tform.mobile.replace(/\D/g, '');
    if (!name) { setTErr('Name the trader'); return; }
    if (mobile.length !== 10) { setTErr('Enter their 10-digit mobile number'); return; }
    const t = addTrader({ name, mobile, openingBalance: 0, outstandingAmount: 0, active: true });
    if (!t) { setTErr('You cannot add traders'); return; }
    set('traderId', t.id);
    setTErr(null);
    setTform({ name: '', mobile: '' });
    setTraderOpen(false);
    pushToast('success', `${name} added and set on this load`);
  }

  return (
    <Dialog open={open} onClose={onClose}
      title={editing ? 'Edit sale entry' : 'New sale entry'}
      subtitle="What left each shed, what it cost the trader, and how the money arrived."
      footer={
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">This load</p>
            <p className="font-display text-[17px] font-bold text-ink tnum leading-tight">{fmtMoney(billed)}</p>
          </div>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Trader" value={form.traderId} onChange={e => set('traderId', e.target.value)}
            hint={trader && isWalkInTrader(trader)
              ? 'Booked to the gate account. Name the buyer if they trade here regularly.' : undefined}
            options={traderOptions} />
          <Field label="Date" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        {canAddTrader && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} className="-mt-1"
            onClick={() => { setTErr(null); setTraderOpen(true); }}>
            Trader not in the list? Add one
          </Button>
        )}

        {!editing && openBookings.length > 0 && (
          <SelectField label="Use planner booking" value={form.bookingId}
            hint={form.bookingId
              ? 'The trays are filled in. This entry is what sells them — the booking is only marked sold once it saves.'
              : 'A planned load fills the trader, the day and the trays.'}
            onChange={e => {
              const b = openBookings.find(x => x.id === e.target.value);
              setForm(f => (b ? applyBooking(f, b) : { ...f, bookingId: '' }));
            }}
            options={[
              { value: '', label: 'Not from the planner' },
              ...openBookings.map(b => ({
                value: b.id,
                label: `${fmtDate(b.date)} · ${data.sheds.find(s => s.id === b.shedId)?.name ?? '—'} · ${data.traders.find(t => t.id === b.traderId)?.name ?? '—'} · ${fmtIN(b.plannedTrays)} ${GRADE_WORD[b.grade]}`,
              })),
            ]} />
        )}

        <Section n={1} title="What left the sheds" hint="Trays per grade, straight from the count">
          {sheds.length === 0 && (
            <p className="text-[12px] text-muted bg-sunk rounded-[10px] px-3 py-2">No shed has egg stock left to sell.</p>
          )}
          <div className="space-y-2">
            {opened.map(shed => {
              const stock = stockOf(shed.id);
              const value = form.trays[shed.id] ?? emptyTrays();
              return (
                <div key={shed.id} className="rounded-[14px] border border-brand bg-brand-soft/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] font-semibold text-ink">{shed.name}</p>
                    <button type="button" className="text-[11px] font-semibold text-muted press"
                      onClick={() => setForm(f => { const t = { ...f.trays }; delete t[shed.id]; return { ...f, trays: t }; })}>
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {EGG_GRADES.map(g => (
                      <Field key={g} label={GRADE_WORD[g]} type="text" inputMode="numeric"
                        value={value[g]} suffix="trays" hint={`${fmtIN(stock[g].balance)} left`}
                        onChange={e => setForm(f => ({
                          ...f,
                          trays: { ...f.trays, [shed.id]: { ...emptyTrays(), ...f.trays[shed.id], [g]: e.target.value.replace(/[^0-9]/g, '') } },
                        }))}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {rest.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {rest.map(shed => {
                const stock = stockOf(shed.id);
                const left = EGG_GRADES.reduce((s, g) => s + stock[g].balance, 0);
                return (
                  <button key={shed.id} type="button"
                    onClick={() => setForm(f => ({ ...f, trays: { ...f.trays, [shed.id]: emptyTrays() } }))}
                    className="px-2.5 py-1.5 rounded-full bg-sunk text-[12px] font-semibold text-ink press hover:bg-brand-soft hover:text-brand">
                    + {shed.name} <span className="font-mono tnum text-muted">{fmtIN(left)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {lines.length > 0 && (
            <p className="text-[12px] font-semibold text-brand-ink bg-brand-soft rounded-[10px] px-3 py-2">
              {gradeSummary(byGrade)} · {fmtIN(lines.reduce((s, l) => s + EGG_GRADES.reduce((a, g) => a + l.byGrade[g], 0), 0))} trays total
            </p>
          )}
        </Section>

        <Section n={2} title="What it was sold for" hint="Per-egg rates, or the single figure you agreed">
          <SegmentedTabs value={form.pricing} onChange={p => set('pricing', p as SalePricing)}
            options={[{ value: 'RATE', label: 'Rate per egg' }, { value: 'AGREED', label: 'Final amount' }]} />
          {form.pricing === 'RATE' ? (
            soldGrades.length === 0 ? (
              <p className="text-[12px] text-muted">Enter the trays sold above — only the grades that left need a rate.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {soldGrades.map(g => (
                  <Field key={g} label={`${GRADE_WORD[g]} ₹/egg`} type="text" inputMode="decimal" prefix="₹"
                    suffix={`per egg · ${fmtIN(byGrade[g])} trays`} value={form.rates[g]}
                    onChange={e => setForm(f => ({ ...f, rates: { ...f.rates, [g]: e.target.value.replace(/[^0-9.]/g, '') } }))}
                  />
                ))}
              </div>
            )
          ) : (
            <Field label="Amount agreed for the eggs" type="text" inputMode="numeric" prefix="₹"
              hint="The figure settled with the owner or trader" value={form.agreed}
              onChange={e => setForm(f => ({ ...f, agreed: e.target.value.replace(/[^0-9]/g, '') }))}
            />
          )}
          <div className="rounded-[12px] bg-sunk px-3 py-2.5 space-y-1">
            <MoneyLine label="Eggs" value={eggsValue} tone="ink" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-muted">Loading labour</span>
              <span className="flex items-center gap-1">
                <span className="text-[11px] text-faint font-mono">₹</span>
                <input type="text" inputMode="numeric" value={form.labour} placeholder="0"
                  aria-label="Loading labour for this load"
                  onChange={e => set('labour', e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-20 rounded-[8px] border border-line bg-card px-2 py-1 text-right font-mono text-[13px] tnum text-ink" />
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-2">
              Collected with the load, so it comes in as this shed's income. The wage itself is the expense, entered in Finance on the day it is paid.
            </p>
            <div className="pt-1 mt-1 border-t border-line-2">
              <MoneyLine label={`Eggs + labour billed to ${trader?.name ?? 'the trader'}`} value={billed} tone="ink" strong />
            </div>
          </div>
        </Section>

        <Section n={3} title="Money in" hint="Cash and online payment received against this load">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cash received" type="text" inputMode="numeric" prefix="₹" value={form.cash}
              onChange={e => set('cash', e.target.value.replace(/[^0-9]/g, ''))} />
            <Field label="Online payment" type="text" inputMode="numeric" prefix="₹" value={form.phonepe}
              onChange={e => set('phonepe', e.target.value.replace(/[^0-9]/g, ''))} />
          </div>
          {advance > 0 && (
            <p className="text-[11px] text-muted leading-relaxed">
              {fmtMoney(advance)} of advance this entry carried earlier is still counted as received —
              an advance taken from now on is booked as its own transaction.
            </p>
          )}
          {paid > 0 && paid !== billed && (
            <button type="button" className="text-[12px] font-semibold text-brand press"
              onClick={() => setForm(f => ({ ...f, cash: String(Math.max(0, r2(billed - num(f.phonepe) - advance))), phonepe: f.phonepe }))}>
              Balance {fmtMoney(Math.abs(billed - paid))} in cash
            </button>
          )}

          {/* Cash is the one channel that changes hands in person, so it names whose hands. */}
          {cash > 0 && (
            <div className="rounded-[12px] border border-line bg-sunk/50 px-3 py-2.5 space-y-2.5">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-2">
                Cash custody · {fmtMoney(cash)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <SelectField label="Cash received by" value={form.cashBy} onChange={e => set('cashBy', e.target.value)}
                  options={[{ value: '', label: '— Select the person —' }, ...people.map(p => ({ value: p.id, label: p.name }))]}
                  hint="Whoever physically took this cash — the voucher may be typed by someone else" />
                <Field label="Time" type="time" value={form.cashTime} onChange={e => set('cashTime', e.target.value)} />
              </div>
              <Field label="Receipt number" value={form.cashNo} placeholder="CR-2026-09-23-001"
                onChange={e => set('cashNo', e.target.value)} className="font-mono text-[13px]"
                hint="Numbered inside this company, one series per day"
                suffix={<button type="button" onClick={() => { void takeReceiptNo('CR', form.date).then(no => { if (no) set('cashNo', no); }); }}
                  className="text-[11px] font-semibold text-brand press whitespace-nowrap">Next no.</button>} />
            </div>
          )}
        </Section>

        {canFinance && (
          <Section n={4} title="Trader balance" hint="Old dues, this load, and what remains">
            <div className="rounded-[12px] bg-sunk px-3 py-2.5 space-y-1">
              <MoneyLine label="Dues before this load" value={oldBalance} tone="ink" />
              <MoneyLine label="This load billed" value={billed} tone="ink" sign="+" />
              <MoneyLine label={advance > 0 ? 'Cash + online + old advance' : 'Cash + online'} value={paid} tone="danger" sign="−" />
              <div className="pt-1.5 mt-1.5 border-t border-line-2 space-y-1">
                <MoneyLine label={loadBalance >= 0 ? 'Left on this load' : 'Overpaid on this load'} value={Math.abs(loadBalance)} tone={loadBalance > 0 ? 'warn' : 'success'} />
                <div className="flex items-baseline justify-between gap-3 pt-1">
                  <span className="text-[13px] font-semibold text-ink">Balance with {trader?.name ?? 'trader'}</span>
                  <span className={clsx('font-display text-[16px] font-bold tnum',
                    newBalance > 0 ? 'text-danger' : newBalance < 0 ? 'text-brand' : 'text-success')}>
                    {newBalance < 0 ? `${fmtMoney(Math.abs(newBalance))} with us` : fmtMoney(newBalance)}
                  </span>
                </div>
                {newBalance < 0 && (
                  <p className="text-[11px] text-muted leading-relaxed">
                    The trader has paid ahead of this load — take that money as a payment from them and
                    it settles against their balance, not against this voucher.
                  </p>
                )}
              </div>
            </div>
          </Section>
        )}

        <Field label="Remarks (optional)" value={form.remarks}
          onChange={e => set('remarks', e.target.value)} placeholder="Vehicle / weighing / notes" />

        {error && <p className="text-[12px] text-danger font-medium">{error}</p>}

        {editing && canDelete && (
          <button type="button" onClick={onDelete}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-danger press pt-1">
            <Trash2 size={14} /> Delete this entry
          </button>
        )}

        <Dialog open={traderOpen} onClose={() => setTraderOpen(false)} title="Add trader"
          subtitle="Who took the load and how to reach them. GSTIN and address can wait for the trader's own page.">
          <div className="space-y-3">
            <Field label="Trader name" value={tform.name} onChange={e => setTform(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rajesh Traders" />
            <Field label="Mobile number" type="tel" inputMode="numeric" maxLength={10} value={tform.mobile}
              onChange={e => setTform(f => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))}
              prefix="+91" placeholder="10-digit" className="font-mono" />
            {tErr && <p className="text-[12px] text-danger font-medium">{tErr}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" block onClick={() => setTraderOpen(false)}>Cancel</Button>
              <Button block onClick={createTrader}>Add trader</Button>
            </div>
          </div>
        </Dialog>
      </div>
    </Dialog>
  );
}
