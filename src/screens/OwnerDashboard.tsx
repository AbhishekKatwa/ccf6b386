import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Syringe } from 'lucide-react';
import { useCompanyData, useCurrentUser, useCan, useVisibleSheds } from '@/store/app';
import { fmtDateTime, fmtDateShort, fmtIN, fmtMoney, fmtPct, greeting, shiftDate, todayISO } from '@/lib/format';
import { useVaccinations } from '@/hooks/useVaccinations';
import { usePurchasePositions } from '@/hooks/usePaymentPositions';
import { countsSummaryLine } from '@/lib/vaccination';
import {
  cumulativeMortality, eggGradeTotals, eggStockByGrade, entryTrays, godownBalances,
  gradeTotal, liveBirdsOn, saleBilled, saleOutstanding, salePaid,
} from '@/lib/calc';
import {
  eggDamageTrend, eggProductionTrend, eggSalesTrend, feedConsumptionTrend,
  godownIngredients, godownPosition, mortalityTrend, rangeOf, traderOutstanding,
  type Point, type RangeKey,
} from '@/lib/analytics';
import {
  COVERAGE_CRITICAL_DAYS, coverageRows, feedForecast,
  type CoverageStatus, type IngredientCoverage,
} from '@/lib/coverage';
import { cashFlowOf, inWindow } from '@/lib/cashflow';
import { payableTotals, payablesBySupplier, UNSUPPLIED } from '@/lib/purchasing';
import { ChartLegend, HBarList, TrendChart, type HRow, type VSeries } from '@/components/charts/DataViz';
import { GraphCard, GraphRange } from '@/components/charts/GraphCard';
import { AlertRow } from '@/components/ui/AlertRow';
import { AttentionButtons } from '@/components/ui/AttentionButtons';
import { buildFarmAlerts, type FarmAlert } from '@/lib/alerts';
import { CHART } from '@/components/ui/Charts';
import { Page, ScreenTitle } from '@/components/ui/Header';
import {
  AllClear, Badge, EmptyState, GroupList, ListRow, Row, SectionTitle, Stat, Surface,
} from '@/components/ui/Card';
import { SyncPill } from '@/components/layout/AppShell';
import { EGG_GRADES, EGG_GRADE_LABELS, EMPTY_GRADE_COUNTS, ROLE_LABELS } from '@/types';
import type { EggGradeCounts, Shed } from '@/types';

/**
 * The owner's command centre, read in ten seconds: TODAY, then what needs ATTENTION,
 * then the flock, the eggs, the shelf and the money — and only then the trends.
 *
 * Nothing here stores a number. Each figure comes from the same selector the module
 * screen uses, filtered to this company and to the signed-in role, so the dashboard
 * cannot disagree with the ledger behind it. Detailed history deliberately does not
 * live here; it stays on the screen that owns it.
 */

type Data = ReturnType<typeof useCompanyData>;

const TREND_RANGES = [
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
] as const;

/** A series with nothing in it is an empty graph, not a flat line at zero. */
function blank(points: Point[]): boolean {
  return points.length === 0 || points.every(p => p.value === null);
}

const tonnes = (v: number) => `${fmtIN(Number(v.toFixed(2)))} t`;

/** Money the dashboard must not show to a role without finance access. */
function useMoney() {
  const canView = useCan('viewFinance');
  return {
    canView,
    m: (v: number | null): string => v === null ? 'Unavailable' : canView ? fmtMoney(v) : '₹ •••••',
  };
}

/** The first paint draws skeletons rather than a card full of nothing. */
function useSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(true); }, []);
  return settled;
}

/** A quiet link in a section header — every section is a preview of a real screen. */
function Drill({ label, to }: { label: string; to: string }) {
  const nav = useNavigate();
  return (
    <button type="button" onClick={() => nav(to)}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-brand font-semibold press hover:underline">
      {label} <ChevronRight size={12} />
    </button>
  );
}

/* ============================= SHARED READS ============================= */

/** The day's collection by grade, and whether any shed has reported at all. */
function useTodayEggs(data: Data, today: string) {
  return useMemo(() => {
    const rows = data.eggs.filter(e => e.date === today);
    return { recorded: rows.length > 0, byGrade: eggGradeTotals(rows) };
  }, [data.eggs, today]);
}

/** Egg stock in trays, per grade, across the sheds this role may see. */
function useGradeStock(data: Data, sheds: Shed[], today: string): EggGradeCounts {
  return useMemo(() => {
    const out = { ...EMPTY_GRADE_COUNTS } as EggGradeCounts;
    for (const s of sheds) {
      const byGrade = eggStockByGrade(s.id, data.eggs, data.saleEntries, data.eggWastages, today);
      for (const g of EGG_GRADES) out[g] += byGrade[g].balance;
    }
    return out;
  }, [data.eggs, data.saleEntries, data.eggWastages, sheds, today]);
}

/** Birds standing on the live batches, and how many batches that is. */
function useFlock(data: Data, today: string) {
  return useMemo(() => {
    const live = data.batches.filter(b => b.status === 'ACTIVE');
    return {
      batches: live,
      birds: live.reduce((s, b) => s + liveBirdsOn(b, today, data.mortality), 0),
      placed: live.reduce((s, b) => s + (b.initialBirds || 0), 0),
    };
  }, [data.batches, data.mortality, today]);
}

/** What the loads billed today were worth, against the money that arrived on them. */
function useTodaySales(data: Data, today: string) {
  return useMemo(() => {
    const entries = data.saleEntries.filter(e => e.date === today);
    return {
      entries,
      trays: entries.reduce((s, e) => s + entryTrays(e), 0),
      billed: entries.reduce((s, e) => s + saleBilled(e), 0),
      received: entries.reduce((s, e) => s + salePaid(e, data.traderTxns), 0),
      owed: entries.reduce((s, e) => s + Math.max(0, saleOutstanding(e, data.traderTxns)), 0),
    };
  }, [data.saleEntries, data.traderTxns, today]);
}

/** Dues read back off the signed trader ledger — never a typed balance. */
function useReceivables(data: Data) {
  return useMemo(() => {
    const owed = traderOutstanding(data.traders, data.traderTxns)
      .filter(t => t.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    return { owed, total: owed.reduce((s, t) => s + t.balance, 0) };
  }, [data.traders, data.traderTxns]);
}

/* ============================= 1 · TODAY ============================= */

// /** The six P0 answers in one strip — prominent figures, no card per metric. */
// function TodayStrip({ data, sheds }: { data: Data; sheds: Shed[] }) {
//   const money = useMoney();
//   const today = todayISO();
//   const eggsToday = useTodayEggs(data, today);
//   const stock = useGradeStock(data, sheds, today);
//   const flock = useFlock(data, today);
//   const sales = useTodaySales(data, today);
//   const due = useReceivables(data);
//   const received = useMemo(() => revenueTrend(data.finance, rangeOf('7D', today)).today, [data.finance, today]);

//   return (
//     <Surface className="px-4 py-3.5">
//       <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
//         <Stat label="Live birds" value={fmtIN(flock.birds)}
//           sub={`${flock.batches.length} ${flock.batches.length === 1 ? 'batch' : 'batches'} standing`} />
//         <Stat label="Eggs today" value={eggsToday.recorded ? fmtIN(eggsToday.byGrade.GOOD) : 'No record'}
//           sub={eggsToday.recorded ? 'trays · normal grade' : 'no shed has collected yet'} />
//         <Stat label="Normal egg stock" value={fmtIN(stock.GOOD)}
//           sub={`trays · ${fmtIN(gradeTotal(stock))} all grades`} />
//         <Stat label="Egg sales" value={sales.entries.length ? fmtIN(sales.trays) : 'No sale'}
//           sub={sales.entries.length ? `trays · ${money.m(sales.billed)} billed` : 'nothing billed today'} />
//         <Stat label="Money received" value={money.m(received)}
//           sub={received === null ? 'no finance row today' : 'into the ledger today'} />
//         <Stat label="Trader outstanding" value={money.m(due.total)} tone={due.owed.length ? 'danger' : 'success'}
//           sub={due.owed.length ? `due from ${due.owed.length} ${due.owed.length === 1 ? 'trader' : 'traders'}` : 'every trader settled'} />
//       </div>
//     </Surface>
//   );
// }

// /* ============================= 2 · NEEDS ATTENTION ============================= */

// /**
//  * The dashboard preview of the shared rule engine in lib/alerts — the same rules that
//  * fill the Alerts page, capped at the five that matter most. No alert starts here.
//  */
// function NeedsAttention({ alerts }: { alerts: FarmAlert[] }) {
//   const nav = useNavigate();
//   const canVaccinate = useCan('completeVaccination');
//   const vac = useVaccinations();
//   const shown = alerts.slice(0, 5);

//   return (
//     <div>
//       <SectionTitle right={alerts.length ? <Drill label="View all" to="/alerts" /> : undefined}>
//         Needs attention
//       </SectionTitle>
//       {/* §15: the vaccination tally reads on its own line, next to the rows it summarises.
//           It opens the alerts it came from — a dose is recorded on the flock that owes it. */}
//       {canVaccinate && (
//         <button type="button" onClick={() => nav('/alerts')}
//           className="mb-2 w-full flex items-center gap-2 rounded-card border border-line bg-sunk px-3 py-2 text-left press hover:bg-card">
//           <Syringe size={14} className={vac.counts.overdue ? 'text-danger shrink-0' : 'text-brand shrink-0'} />
//           <span className="flex-1 min-w-0">
//             <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Vaccination</span>
//             <span className={`block text-[12.5px] tnum truncate ${vac.counts.overdue ? 'text-danger font-semibold' : 'text-ink-2'}`}>
//               {countsSummaryLine(vac.counts)}
//             </span>
//           </span>
//           <ChevronRight size={14} className="text-muted shrink-0" />
//         </button>
//       )}
//       {alerts.length === 0 ? (
//         <AllClear title="Everything looks up to date" description="Every live batch is logged today, no dose is due, godown stock is above the reorder level, no trader is owed money and today's tasks are clear." />
//       ) : (
//         <GroupList>
//           {shown.map(a => <AlertRow key={a.id} alert={a} />)}
//         </GroupList>
//       )}
//     </div>
//   );
// }

/* ============================= 3 · FLOCK ============================= */

/** Are the birds and the lay all right — compact lines rather than six tiles. */
function FlockPanel({ data }: { data: Data }) {
  const today = todayISO();
  const eggsToday = useTodayEggs(data, today);
  const flock = useFlock(data, today);
  const prod = useMemo(() => eggProductionTrend(data.eggs, rangeOf('7D', today)), [data.eggs, today]);
  const damage = useMemo(() => eggDamageTrend(data.eggs, rangeOf('7D', today)), [data.eggs, today]);

  const deathsToday = data.mortality.filter(m => m.date === today);
  const dead = deathsToday.reduce((s, m) => s + (m.count || 0), 0);
  const cum = flock.batches.reduce((s, b) => s + cumulativeMortality(b.id, data.mortality, today), 0);
  const cumPct = flock.placed > 0 ? (cum / flock.placed) * 100 : null;

  return (
    <Surface className="p-4 min-w-0">
      <SectionTitle right={<Drill label="Open batches" to="/farms" />}>Flock</SectionTitle>
      <Row label="Eggs today" value={eggsToday.recorded ? `${fmtIN(eggsToday.byGrade.GOOD)} trays` : 'No record'} />
      <Row label="7-day average" value={prod.avg7 === null ? 'Unavailable' : `${fmtIN(Math.round(prod.avg7))} trays/day`} />
      <Row label="Mortality today" value={deathsToday.length ? `${fmtIN(dead)} birds` : 'No record'} danger={dead > 0} />
      <Row label="Cumulative mortality" value={flock.batches.length ? `${fmtIN(cum)} birds` : 'Unavailable'}
        danger={cumPct !== null && cumPct > 5} />
      
      <Row label="Live birds" value={`${fmtIN(flock.birds)} birds`} />
      <Row label="Egg damage today" value={!eggsToday.recorded ? 'No record'
        : damage.todayPct === null ? 'Unavailable' : `${fmtPct(damage.todayPct, 2)} · ${fmtIN(damage.todayTrays ?? 0)} broken`} />
      {cumPct !== null && (
        <p className="mt-2 text-[11px] text-muted">
          {fmtPct(cumPct, 2)} of the {fmtIN(flock.placed)} birds placed on the live batches have died; a batch past 5% is already on the attention list.
        </p>
      )}
    </Surface>
  );
}

/* ============================= 4 · EGGS ============================= */

/**
 * The shelf in hand and the day's load off it. Sales value and money received stay on
 * separate lines on purpose: a voucher bills a load, a payment settles it.
 */
function EggsPanel({ data, sheds }: { data: Data; sheds: Shed[] }) {
  const money = useMoney();
  const today = todayISO();
  const eggsToday = useTodayEggs(data, today);
  const stock = useGradeStock(data, sheds, today);
  const sales = useTodaySales(data, today);
  const others = EGG_GRADES.filter(g => g !== 'GOOD');

  return (
    <Surface className="p-4 min-w-0">
      <SectionTitle right={<Drill label="Egg stock by shed" to="/farms" />}>Eggs</SectionTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 pb-1">
        <Stat size="lg" label="Normal stock" value={fmtIN(stock.GOOD)} sub="trays in hand" />
        <Stat size="lg" label="Sold today" value={sales.entries.length ? fmtIN(sales.trays) : 'No sale'}
          sub={sales.entries.length ? `${sales.entries.length} ${sales.entries.length === 1 ? 'load' : 'loads'} billed` : 'nothing billed today'} />
      </div>
      <Row label="Collected today" value={eggsToday.recorded ? `${fmtIN(eggsToday.byGrade.GOOD)} trays` : 'No record'} />
      <Row label="Sales value today" value={sales.entries.length ? money.m(sales.billed) : 'No record'} />
      <Row label="Received on these loads" value={sales.entries.length ? money.m(sales.received) : 'No record'} />
      <Row label="Still outstanding on them" value={sales.entries.length ? money.m(sales.owed) : 'No record'} danger={sales.owed > 0} />
      <p className="mt-2 text-[11px] text-muted tnum">
        Other grades in hand: {others.map(g => `${EGG_GRADE_LABELS[g]} ${fmtIN(stock[g])}`).join(' · ')} trays. Sales value is the
        eggs plus the loading labour recovered on them — it is not the money received.
      </p>
    </Surface>
  );
}

/* ============================= 5 · GODOWN ============================= */

const coverageTone: Record<CoverageStatus, NonNullable<HRow['tone']>> = {
  CRITICAL: 'danger', LOW: 'warn', HEALTHY: 'normal', IDLE: 'muted',
};

/** One ingredient's shelf as the owner reads it, and which rule produced its days. */
type Shelf = {
  ingredient: string; stockKg: number; dailyKg: number;
  days: number | null; basis: 'expected' | 'used' | null; tone: NonNullable<HRow['tone']>;
};

/**
 * "What am I going to run out of?" — one row per ingredient, tightest shelf first. Days
 * come from the batches' expected intake against the formula in force (lib/coverage);
 * where the farm has not set an intake, the godown's own 7-day actual draw answers
 * instead (godownPosition) and says so on the line, because a forecast the owner never
 * entered is not a fact about the shelf. The kg reorder level stays a separate warning.
 */
function GodownPanel({ data, sheds }: { data: Data; sheds: Shed[] }) {
  const nav = useNavigate();
  const today = todayISO();
  const forecast = useMemo(() => feedForecast(
    data.batches, data.feedFormulas, today,
    id => sheds.find(s => s.id === id)?.name ?? 'Shed',
  ), [data.batches, data.feedFormulas, sheds, today]);

  const position = useMemo(() => godownPosition(data.feedStock, today), [data.feedStock, today]);

  const shelves = useMemo<Shelf[]>(() => {
    const balances = godownBalances(data.feedStock, today);
    const actual = new Map(position.rows.map(r => [r.ingredient, r]));
    return coverageRows(forecast, godownIngredients(data.feedStock), ing => balances[ing] ?? 0)
      .map((r: IngredientCoverage): Shelf => {
        const a = actual.get(r.ingredient);
        return r.days !== null ? {
          ingredient: r.ingredient, stockKg: r.stockKg, dailyKg: r.dailyKg, days: r.days,
          basis: 'expected', tone: coverageTone[r.status],
        } : {
          ingredient: r.ingredient, stockKg: r.stockKg, dailyKg: a?.avg7Kg ?? r.dailyKg,
          days: a?.daysLeft ?? null, basis: a?.daysLeft != null ? 'used' : null,
          tone: a && a.status !== 'NORMAL' ? (a.status === 'CRITICAL' ? 'danger' : 'warn') : 'muted',
        };
      })
      .sort((x, y) => (x.days === null ? (y.days === null ? 0 : 1)
        : y.days === null ? -1 : x.days - y.days) || x.ingredient.localeCompare(y.ingredient));
  }, [data.feedStock, forecast, position, today]);

  const tightest = shelves.filter(s => s.days !== null);
  const expectedKg = forecast.counted > 0
    ? forecast.totalDailyKg
    : Number(shelves.reduce((s, r) => s + r.dailyKg, 0).toFixed(2));
  const belowReorder = position.rows.filter(r => r.status !== 'NORMAL');
  const negative = position.rows.filter(r => r.negative);

  const bars: HRow[] = shelves.map(s => ({
    id: s.ingredient,
    label: s.ingredient,
    value: s.stockKg,
    display: `${fmtIN(s.stockKg)} kg`,
    sub: s.days === null
      ? s.dailyKg > 0 ? `out today · ${fmtIN(s.dailyKg)} kg/day used` : 'nothing drawn or expected'
      : `~ ${fmtIN(s.days)} days left · ${fmtIN(s.dailyKg)} kg/day ${s.basis === 'expected' ? 'expected' : 'used, last 7 days'}`,
    tone: s.tone,
  }));

  const warnings = [
    ...negative.map(r => `${r.ingredient} shows ${fmtIN(r.stockKg)} kg — negative stock needs an adjustment entry.`),
    ...(belowReorder.length
      ? [`${belowReorder.length} ${belowReorder.length === 1 ? 'ingredient is' : 'ingredients are'} below the godown's reorder level.`]
      : []),
    ...(forecast.blockers.length
      ? [`${forecast.blockers.length} ${forecast.blockers.length === 1 ? 'batch has' : 'batches have'} no intake or no formula in force, so those lines fall back to the last 7 days of actual draw.`]
      : []),
  ];

  return (
    <Surface className="p-4 min-w-0">
      <SectionTitle right={<Drill label="Open godown" to="/feed" />}>Godown</SectionTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 mb-3">
        <Stat size="sm" label={forecast.counted > 0 ? 'Expected use' : 'Recent use'} value={`${fmtIN(expectedKg)} kg`}
          sub={forecast.counted > 0
            ? `every day, across ${forecast.counted} ${forecast.counted === 1 ? 'batch' : 'batches'}`
            : 'a day, from the last 7 days of draw'} />
        <Stat size="sm" label={`Under ${COVERAGE_CRITICAL_DAYS} days`} value={`${tightest.filter(s => (s.days ?? 0) < COVERAGE_CRITICAL_DAYS).length}`}
          tone={tightest.some(s => (s.days ?? 0) < COVERAGE_CRITICAL_DAYS) ? 'danger' : 'success'}
          sub={tightest.length ? 'of the shelves being eaten' : 'no shelf measured yet'} />
        <Stat size="sm" label="Tightest shelf" value={tightest.length ? tightest[0].ingredient : 'Unavailable'}
          sub={tightest.length ? `${fmtIN(tightest[0].days ?? 0)} days left` : 'set an intake on a batch'} />
      </div>
      {warnings.length > 0 && (
        <ul className="mb-2 space-y-1">
          {warnings.map(w => <li key={w} className="text-[11.5px] text-warn">• {w}</li>)}
        </ul>
      )}
      {bars.length === 0 ? (
        <EmptyState title="The godown ledger is empty"
          description="No opening stock or receipt has been recorded for this company, so there is no shelf to measure." />
      ) : (
        <HBarList rows={bars} onPick={id => nav(`/feed?q=${encodeURIComponent(id)}`)}
          caption="Tightest shelf first. A bar is the KG on the shelf; the days say whether they come from the expected intake or from what was actually used." />
      )}
    </Surface>
  );
}

/* ============================= 6 · FINANCE ============================= */

type MoneyRow = { label: string; value: string; danger?: boolean; success?: boolean };

/** One column of the money trio — what moved, what we owe, what owes us; never merged. */
function MoneyColumn({ title, hint, rows }: { title: string; hint: string; rows: MoneyRow[] }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2">{title}</p>
      <p className="text-[11px] text-muted mb-1">{hint}</p>
      <div className="border-t border-line-2 pt-0.5">
        {rows.map((r, i) => <Row key={`${r.label}:${i}`} label={r.label} value={r.value} danger={r.danger} success={r.success} />)}
      </div>
    </div>
  );
}

/** What the owner asks of money on this screen: what moved, and what is still owed. */
const MONEY_RANGES = [
  { value: '1D', label: 'Today' },
  { value: '3D', label: '3 days' },
  { value: '7D', label: '7 days' },
] as const;

type MoneyRange = typeof MONEY_RANGES[number]['value'];

const MONEY_DAYS: Record<MoneyRange, number> = { '1D': 1, '3D': 3, '7D': 7 };

function FinancePanel({ data }: { data: Data }) {
  const money = useMoney();
  const today = todayISO();
  const [span, setSpan] = useState<MoneyRange>('1D');
  const due = useReceivables(data);
  const positions = usePurchasePositions();

  const win = useMemo(() => ({ from: shiftDate(today, -(MONEY_DAYS[span] - 1)), to: today }), [today, span]);
  /** The payment ledger itself — money that arrived and left, never accrual income or cost. */
  const flow = useMemo(() => cashFlowOf(data.finance, win), [data.finance, win]);
  const booked = useMemo(() => inWindow(data.finance, win).length > 0, [data.finance, win]);

  const payables = useMemo(() => payableTotals(positions), [positions]);
  const owedToSuppliers = useMemo(
    () => payablesBySupplier(positions).filter(g => (g.outstanding ?? 0) > 0).slice(0, 2),
    [positions],
  );

  const v = (n: number) => booked ? money.m(n) : 'No record';
  const net = flow.in.total - flow.out.total;
  const days = span === '1D' ? 'today' : `the last ${MONEY_DAYS[span]} days`;

  return (
    <Surface className="p-4 min-w-0">
      <SectionTitle right={(
        <div className="flex items-center gap-3">
          <GraphRange value={span} onChange={setSpan} options={MONEY_RANGES} label="Money period" />
          <Drill label="Open ledger" to="/finance" />
        </div>
      )}>Finance</SectionTitle>
      <p className="text-[11px] text-muted mb-3">
        {fmtDateShort(win.from)}{win.from === win.to ? '' : ` – ${fmtDateShort(win.to)}`} · what actually
        moved in {days}, beside what is still unpaid on either side.
      </p>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <MoneyColumn title="Money movement" hint="payment ledger, cash in and out" rows={[
          { label: 'Money received', value: v(flow.in.total), success: booked && net > 0 },
          { label: 'Money paid', value: v(flow.out.total) },
          { label: 'Net', value: v(net), danger: booked && net < 0, success: booked && net > 0 },
        ]} />
        <MoneyColumn title="Pending payments" hint="stock taken on credit, still owed" rows={[
          { label: 'Owed to suppliers', value: money.m(payables.outstanding), danger: payables.outstanding > 0, success: payables.outstanding === 0 },
          { label: 'Receipts unpaid', value: `${payables.unpaidPurchases}` },
          ...owedToSuppliers.map(g => ({ label: g.supplier ?? UNSUPPLIED, value: money.m(g.outstanding ?? 0), danger: true })),
        ]} />
        <MoneyColumn title="Pending receivables" hint="trader ledger, all time" rows={[
          { label: 'Trader outstanding', value: money.m(due.total), danger: due.total > 0, success: due.total === 0 },
          { label: 'Traders with dues', value: `${due.owed.length}` },
          ...due.owed.slice(0, 2).map(t => ({ label: t.name, value: money.m(t.balance), danger: true })),
        ]} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted">
          {!booked
            ? `No payment row falls in ${days}, so nothing here is being shown as zero.`
            : payables.unpriced > 0
              ? `${payables.unpriced} receipt${payables.unpriced === 1 ? '' : 's'} carry no rate, so their value is counted in KG but kept out of the money owed.`
              : 'The pending columns are all-time positions from the receipts and the trader ledger — they are not a period total.'}
        </p>
        <Drill label="View all traders" to="/traders" />
      </div>
    </Surface>
  );
}

/* ============================= 7 · TRENDS ============================= */

/** Four small charts that back up the numbers above, all on one shared period. */
function TrendsPanel({ data }: { data: Data }) {
  const settled = useSettled();
  const today = todayISO();
  const [key, setKey] = useState<Extract<RangeKey, '7D' | '30D'>>('30D');
  const range = useMemo(() => rangeOf(key, today), [key, today]);

  const prod = useMemo(() => eggProductionTrend(data.eggs, range), [data.eggs, range]);
  const sales = useMemo(() => eggSalesTrend(data.saleEntries, range, 'TRAYS'), [data.saleEntries, range]);
  const feedUse = useMemo(() => feedConsumptionTrend(data.feed, range), [data.feed, range]);
  const mort = useMemo(() => mortalityTrend(data.mortality, data.batches, range), [data.mortality, data.batches, range]);

  const cards: {
    title: string; series: VSeries[]; format: (v: number) => string; foot: string;
    emptyTitle: string; emptyText: string; warnings?: string[];
  }[] = [
    {
      title: 'Egg production',
      series: [{ id: 'all', label: 'All trays', color: CHART.brand, points: prod.points, area: true }],
      format: v => `${fmtIN(v)} trays`,
      foot: prod.total === null ? 'Nothing collected in this period.' : `${fmtIN(prod.total)} trays over ${range.days} days.`,
      emptyTitle: 'No collection in this period',
      emptyText: 'Records exist on other days — widen the period or check the shed that has not logged.',
      warnings: prod.warnings,
    },
    {
      title: 'Egg sales',
      series: [{ id: 'sales', label: 'Trays billed', color: CHART.accent, points: sales.points, area: true }],
      format: v => `${fmtIN(v)} trays`,
      foot: `${sales.entries} ${sales.entries === 1 ? 'load' : 'loads'} billed in this period.`,
      emptyTitle: 'No sale billed in this period',
      emptyText: 'A load appears here once accounts records a sale entry against a trader.',
      warnings: sales.warnings,
    },
    {
      title: 'Feed consumption',
      series: [{ id: 'feed', label: 'Tonnes', color: CHART.brand, points: feedUse.points, area: true }],
      format: tonnes,
      foot: feedUse.total === null ? 'Nothing offered in this period.' : `${tonnes(feedUse.total)} offered over ${range.days} days.`,
      emptyTitle: 'No feed recorded in this period',
      emptyText: 'Supervisors log tonnes per shed daily; nothing landed in this window.',
      warnings: feedUse.warnings,
    },
    {
      title: 'Mortality',
      series: [{ id: 'mort', label: 'Birds', color: CHART.danger, points: mort.points, area: true }],
      format: v => `${fmtIN(v)} birds`,
      foot: mort.total === null ? 'No deaths recorded in this period.' : `${fmtIN(mort.total)} birds over ${range.days} days.`,
      emptyTitle: 'No mortality in this period',
      emptyText: 'Either nothing was logged, or the entries carry an invalid count, date or shed link.',
      warnings: mort.warnings,
    },
  ];

  return (
    <div>
      <SectionTitle right={<GraphRange value={key} onChange={setKey} options={TREND_RANGES} label="Trend period" />}>
        Trends
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-2">
        {cards.map(c => (
          <GraphCard key={c.title} title={c.title}
            subtitle={`${fmtDateShort(range.from)} – ${fmtDateShort(range.to)}`}
            height={150} loading={!settled} warnings={c.warnings}
            empty={blank(c.series[0].points) ? { title: c.emptyTitle, description: c.emptyText } : undefined}>
            <TrendChart series={c.series} height={120} format={c.format} />
            <ChartLegend items={c.series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
            <p className="mt-1 text-[11px] text-muted">{c.foot}</p>
          </GraphCard>
        ))}
      </div>
    </div>
  );
}

/* ============================= 8 · RECENT ACTIVITY ============================= */

/** The records the farm recognises, straight off the audit trail it already writes. */
const ACTIVITY_LABELS: Record<string, string> = {
  EggCollection: 'Egg collection recorded',
  EggWastage: 'Egg wastage recorded',
  SaleEntry: 'Egg sale recorded',
  EggSaleBooking: 'Sale booking updated',
  SaleLog: 'Shed dispatch logged',
  TraderTxn: 'Trader payment recorded',
  Finance: 'Finance entry recorded',
  CashHandover: 'Cash handed over',
  CashCount: 'Cash counted',
  FeedConsumption: 'Feed recorded',
  FeedStock: 'Godown stock entry',
  FeedFormula: 'Feed formula updated',
  Mortality: 'Mortality recorded',
  MedicineStock: 'Medicine usage recorded',
  MedicineItem: 'Medicine item updated',
  Vaccination: 'Vaccination updated',
  Task: 'Task updated',
  Batch: 'Batch updated',
  Shed: 'Shed updated',
  Trader: 'Trader updated',
};

/** A money row the role may not read stays off the list entirely, rather than masked. */
const MONEY_ENTITIES = new Set(['Finance', 'TraderTxn', 'SaleEntry', 'CashHandover', 'CashCount', 'Trader']);

function RecentActivity({ data }: { data: Data }) {
  const canViewFinance = useCan('viewFinance');
  const rows = useMemo(() => data.audit
    .filter(a => a.entity !== 'Session' && (canViewFinance || !MONEY_ENTITIES.has(a.entity)))
    .slice(0, 6), [data.audit, canViewFinance]);

  if (!rows.length) {
    return (
      <div>
        <SectionTitle>Recent activity</SectionTitle>
        <p className="text-[12px] text-muted px-0.5">Nothing has been recorded on this company yet.</p>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Recent activity</SectionTitle>
      <GroupList className="mt-2">
        {rows.map(a => (
          <ListRow key={a.id}
            title={ACTIVITY_LABELS[a.entity] ?? `${a.entity} ${a.action === 'CREATE' ? 'recorded' : a.action === 'UPDATE' ? 'updated' : 'removed'}`}
            subtitle={`${data.users.find(u => u.id === a.byUserId)?.name ?? 'Someone'} · ${fmtDateTime(a.at)}`} />
        ))}
      </GroupList>
    </div>
  );
}

/* ============================= SCREEN ============================= */

export function OwnerDashboard() {
  const data = useCompanyData();
  const user = useCurrentUser();
  const sheds = useVisibleSheds();
  const canFinance = useCan('viewFinance');
  const canReport = useCan('exportReports');
  const canVaccinate = useCan('completeVaccination');
  const today = todayISO();
  const scoped = useMemo(() => ({ ...data, sheds }), [data, sheds]);

  /** One pass of the shared alert rules feeds both the bell-style count and the preview. */
  const alerts = useMemo(() => buildFarmAlerts({
    batches: scoped.batches, mortality: scoped.mortality, feed: scoped.feed, eggs: scoped.eggs,
    tasks: scoped.tasks, feedStock: scoped.feedStock, traders: scoped.traders, traderTxns: scoped.traderTxns,
    sheds: scoped.sheds, vaccinations: scoped.vaccinations,
    today, canReport, canViewFinance: canFinance, canViewVaccination: canVaccinate,
  }), [scoped, today, canReport, canFinance, canVaccinate]);

  const tasksOpen = data.tasks.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length;

  if (!data.companyId) {
    return (
      <Page withNav>
        <div className="px-4 sm:px-0 pt-10">
          <EmptyState
            icon={<AlertTriangle size={22} />}
            title="No company selected"
            description="Pick a company to see its farm data. Nothing on this screen mixes two farms."
          />
        </div>
      </Page>
    );
  }

  const company = data.companies.find(c => c.id === data.companyId);

  return (
    <Page withNav>
      <ScreenTitle
        eyebrow={`${greeting()} · ${fmtDateShort(today)}`}
        title="Farm control centre"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate">{company?.name ?? 'Company'}</span>
            <Badge tone="neutral">{user ? ROLE_LABELS[user.role] : ''}</Badge>
            <span className="text-muted-2 tnum">{scoped.batches.filter(b => b.status === 'ACTIVE').length} live batches · {sheds.length} sheds</span>
          </span>
        }
        action={<SyncPill compact />}
      />

      <div className="px-4 sm:px-0">
        <AttentionButtons alerts={alerts.length} tasks={tasksOpen} />
      </div>

      <div className="px-4 sm:px-0 mt-5 space-y-6">
        {/* <div>
          <SectionTitle>Today</SectionTitle>
          <TodayStrip data={scoped} sheds={sheds} />
        </div> */}

        {/* <NeedsAttention alerts={alerts} /> */}

        <div className="grid gap-4 lg:grid-cols-2">
          <FlockPanel data={scoped} />
          <EggsPanel data={scoped} sheds={sheds} />
        </div>

        

            {canFinance && <FinancePanel data={scoped} />}

        <TrendsPanel data={scoped} />

        {/* <RecentActivity data={scoped} /> */}
        <GodownPanel data={scoped} sheds={sheds} />
        <p className="text-[11px] text-faint leading-relaxed pb-2">
          Every figure on this page is the same reading the module screen gives, filtered to {company?.name ?? 'this company'} and to the role you are signed in as. A gap means no record; a figure marked unavailable means the data to derive it is not there. Detailed history stays on the screen that owns it.
        </p>
      </div>
    </Page>
  );
}
