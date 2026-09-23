import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ChevronRight, ClipboardList, Egg, Handshake, Skull, Syringe, Wheat,
} from 'lucide-react';
import { useCompanyData, useCurrentUser, useCan, useVisibleSheds } from '@/store/app';
import { fmtDateShort, fmtIN, fmtMoney, fmtPct, greeting, shiftDate, todayISO } from '@/lib/format';
import { useVaccinations } from '@/hooks/useVaccinations';
import { countsSummaryLine } from '@/lib/vaccination';
import { GODOWN_CRITICAL_KG, GODOWN_LOW_KG, cumulativeMortality, entryTrays, liveBirdsOn, loadBilled } from '@/lib/calc';
import {
  damageByShed, eggDamageTrend, eggProductionTrend, eggSalesTrend, eggStockMovement,
  feedByShed, feedConsumptionTrend, feedCostTrend, fin, godownIngredients, godownPosition,
  ingredientStockTrend, mortalityTrend, pnlTrend, productionByShed, rangeOf, revenueBreakdown,
  revenueTrend, salesByTrader, sumPoints, traderCollections, traderOutstanding,
  type PnlMode, type Point, type RangeKey, type SalesMode,
} from '@/lib/analytics';
import { axisNum, BarSeries, ChartLegend, DonutChart, HBarList, PairedBars, SERIES_COLORS, TrendChart, type HRow, type VBar, type VSeries } from '@/components/charts/DataViz';
import { GraphCard, GraphRange, type GraphStat } from '@/components/charts/GraphCard';
import { AlertRow } from '@/components/ui/AlertRow';
import { AttentionButtons } from '@/components/ui/AttentionButtons';
import { buildFarmAlerts, type FarmAlert } from '@/lib/alerts';
import { CHART } from '@/components/ui/Charts';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { AllClear, Badge, EmptyState, GroupList, KpiCard, SectionTitle } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/Form';
import { SyncPill } from '@/components/layout/AppShell';
import { ROLE_LABELS } from '@/types';

/**
 * The owner's control centre: one graph per question the farm actually asks, each
 * reading only this company's rows through `lib/analytics`. Nothing here stores a
 * number — every figure is derived from the records on screen when you open them.
 */

type Data = ReturnType<typeof useCompanyData>;

const RANGES = [
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
] as const;

function useWindow(initial: RangeKey = '30D') {
  const [key, setKey] = useState<RangeKey>(initial);
  const today = todayISO();
  const range = useMemo(() => rangeOf(key, today), [key, today]);
  return {
    key,
    range,
    control: <GraphRange value={key} onChange={setKey} options={RANGES} label="Period" />,
  };
}

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
    /** A per-egg price is paise-level detail — never rounded to the rupee. */
    r: (v: number | null): string => v === null ? 'Unavailable' : canView ? fmtMoney(v, 2) : '₹ •••••',
    mA: (v: number): string => canView ? `₹${axisNum(v)}` : '₹ •••••',
  };
}

/** The first paint draws skeletons rather than a card full of nothing. */
function useSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(true); }, []);
  return settled;
}

/* ============================= 0 · EXECUTIVE KPI LAYER ============================= */

/** The six questions the owner asks, answered before any chart is read. */
function KpiLayer({ data }: { data: Data }) {
  const { eggs, saleEntries, feedStock, traders, traderTxns, batches, mortality } = data;
  const money = useMoney();
  const today = todayISO();
  const week = useMemo(() => rangeOf('7D', today), [today]);

  const prod = useMemo(() => eggProductionTrend(eggs, week), [eggs, week]);
  const stock = useMemo(() => eggStockMovement(eggs, saleEntries, week), [eggs, saleEntries, week]);
  const godown = useMemo(() => godownPosition(feedStock), [feedStock]);
  const due = useMemo(() => traderOutstanding(traders, traderTxns), [traders, traderTxns]);

  const billedOn = (date: string) => saleEntries.filter(e => e.date === date)
    .reduce((s, e) => s + (fin(loadBilled(e.amount, e.laborCharge)) ?? 0), 0);
  const salesToday = billedOn(today);
  const salesYesterday = billedOn(shiftDate(today, -1));
  const hadSalesToday = saleEntries.some(e => e.date === today);
  const hadSalesYesterday = saleEntries.some(e => e.date === shiftDate(today, -1));

  const liveBirds = useMemo(() => batches
    .filter(b => b.status === 'ACTIVE')
    .reduce((s, b) => s + liveBirdsOn(b, today, mortality), 0), [batches, mortality, today]);
  const liveCount = batches.filter(b => b.status === 'ACTIVE').length;

  const totalKg = godown.rows.reduce((s, r) => s + r.stockKg, 0);
  const belowReorder = godown.rows.filter(r => r.status !== 'NORMAL').length;
  const owed = due.filter(t => t.balance > 0);
  const owedTotal = owed.reduce((s, t) => s + t.balance, 0);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
      <KpiCard label="Egg production" value={prod.today === null ? 'No record' : fmtIN(prod.today)} unit="trays"
        foot={prod.today === null ? 'nothing collected today'
          : prod.changePct === null ? 'no collection last week to compare'
          : `${prod.changePct > 0 ? '↑' : prod.changePct < 0 ? '↓' : '→'} ${fmtPct(Math.abs(prod.changePct), 1)} vs previous 7 days`}
        footTone={prod.changePct === null ? 'muted' : prod.changePct >= 0 ? 'success' : 'danger'} />
      <KpiCard label="Egg stock" value={fmtIN(stock.closingNow)} unit="trays"
        foot={`${stock.change >= 0 ? '+' : ''}${fmtIN(stock.change)} vs 7 days ago`}
        footTone={stock.closingNow < 0 ? 'danger' : stock.change >= 0 ? 'success' : 'muted'} />
      <KpiCard label="Feed stock" value={tonnes(totalKg / 1000).replace(' t', '')} unit="MT"
        foot={belowReorder ? `${belowReorder} ${belowReorder === 1 ? 'ingredient' : 'ingredients'} below reorder level` : `${godown.rows.length} ingredients on record`}
        footTone={belowReorder ? 'warn' : 'muted'} />
      <KpiCard label="Today's sales" value={!money.canView ? '₹ •••••' : hadSalesToday ? fmtMoney(salesToday) : 'No sale billed'} unit={money.canView && hadSalesToday ? 'billed' : ''}
        foot={money.canView && hadSalesToday && hadSalesYesterday
          ? `${salesToday - salesYesterday >= 0 ? '+' : '−'}${fmtMoney(Math.abs(salesToday - salesYesterday))} vs yesterday`
          : money.canView && hadSalesToday ? 'nothing billed yesterday to compare' : ''}
        footTone={money.canView && hadSalesToday && hadSalesYesterday && salesToday < salesYesterday ? 'danger' : 'muted'} />
      <KpiCard label="Trader outstanding" value={money.m(owedTotal)}
        foot={owed.length ? `due from ${owed.length} ${owed.length === 1 ? 'trader' : 'traders'}` : 'every trader settled'}
        footTone={owed.length ? 'danger' : 'success'} />
      <KpiCard label="Active birds" value={fmtIN(liveBirds)} unit="live"
        foot={`across ${liveCount} ${liveCount === 1 ? 'batch' : 'batches'}`} />
    </div>
  );
}

/* ============================= 9 · ATTENTION REQUIRED ============================= */

/**
 * Dashboard preview of the shared rule engine in lib/alerts — the full list
 * lives on its own Alerts page, and the open count now reads on the merged
 * Alerts/Tasks buttons at the top of the screen.
 */
function AttentionLayer({ alerts }: { alerts: FarmAlert[] }) {
  const nav = useNavigate();
  const canVaccinate = useCan('completeVaccination');
  const vac = useVaccinations();

  const shown = alerts.slice(0, 4);

  return (
    <div>
      <SectionTitle right={alerts.length ? (
        <button onClick={() => nav('/alerts')}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-brand font-semibold press hover:underline">
          View all <ChevronRight size={12} />
        </button>
      ) : undefined}>
        Attention required
      </SectionTitle>
      {/* §15: the vaccination tally reads on its own line, next to the rows it summarises.
          It opens the alerts it came from — a dose is recorded on the flock that owes it. */}
      {canVaccinate && (
        <button onClick={() => nav('/alerts')}
          className="mt-2 w-full flex items-center gap-2 rounded-card border border-line bg-sunk px-3 py-2 text-left press hover:bg-card">
          <Syringe size={14} className={vac.counts.overdue ? 'text-danger shrink-0' : 'text-brand shrink-0'} />
          <span className="flex-1 min-w-0">
            <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Vaccination</span>
            <span className={`block text-[12.5px] tnum truncate ${vac.counts.overdue ? 'text-danger font-semibold' : 'text-ink-2'}`}>
              {countsSummaryLine(vac.counts)}
            </span>
          </span>
          <ChevronRight size={14} className="text-muted shrink-0" />
        </button>
      )}
      {alerts.length === 0 ? (
        <AllClear title="No attention required" description="Every live batch is logged today, no dose is due, godown stock is above the reorder level, no trader is owed money and today's tasks are clear." />
      ) : (
        <GroupList>
          {shown.map(a => <AlertRow key={a.id} alert={a} />)}
        </GroupList>
      )}
    </div>
  );
}

/* ============================= 1 · EGG PRODUCTION ============================= */

function EggProductionSection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const { eggs, sheds } = data;
  const win = useWindow('30D');

  const trend = useMemo(() => eggProductionTrend(eggs, win.range), [eggs, win.range]);
  const byShed = useMemo(() => productionByShed(eggs, sheds), [eggs, sheds]);

  const series: VSeries[] = [
    { id: 'all', label: 'All trays', color: CHART.brand, points: trend.points, area: true },
    { id: 'good', label: 'Good trays', color: CHART.accent, points: trend.goodPoints, dashed: true },
  ];

  const stats: GraphStat[] = [
    { label: 'Today', value: trend.today === null ? 'No record' : fmtIN(trend.today), sub: 'trays', tone: trend.today === null ? 'muted' : 'ink' },
    { label: '7-day avg', value: trend.avg7 === null ? 'Unavailable' : fmtIN(Math.round(trend.avg7)), sub: 'trays/day' },
    ...(win.key !== '7D'
      ? [{ label: '30-day avg', value: trend.avg30 === null ? 'Unavailable' : fmtIN(Math.round(trend.avg30)), sub: 'trays/day' } as GraphStat]
      : []),
    { label: 'Highest', value: trend.best ? fmtIN(trend.best.value) : 'Unavailable', sub: trend.best?.date ? fmtDateShort(trend.best.date) : undefined },
    { label: 'Lowest', value: trend.worst ? fmtIN(trend.worst.value) : 'Unavailable', sub: trend.worst?.date ? fmtDateShort(trend.worst.date) : undefined },
    {
      label: `vs previous ${win.key}`,
      value: trend.changePct === null ? 'Unavailable' : `${trend.changePct > 0 ? '+' : ''}${fmtPct(trend.changePct, 1)}`,
      tone: trend.changePct === null ? 'muted' : trend.changePct >= 0 ? 'success' : 'danger',
    },
  ];

  const bars: VBar[] = byShed.map(s => ({
    id: s.shedId,
    label: s.shedName,
    value: s.recorded ? s.trays : null,
    hint: s.recorded
      ? `Good ${s.byGrade.GOOD} · Broken ${s.byGrade.BROKEN} · Double ${s.byGrade.DOUBLE} · Small ${s.byGrade.SMALL}`
      : 'Nothing collected here today',
  }));
  const anyShedToday = byShed.some(s => s.recorded && s.trays > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-8" title="Egg production" height={260}
        subtitle={`${win.range && fmtDateShort(win.range.from)} – ${fmtDateShort(win.range.to)} · trays collected`}
        loading={!settled}
        actions={win.control}
        stats={stats}
        warnings={trend.warnings}
        empty={blank(trend.points) ? {
          title: 'No egg collection in this period',
          description: eggs.length
            ? 'Collections exist on other days — widen the period or check the shed that has not been logged.'
            : 'No shed has reported a collection for this company yet.',
        } : undefined}
      >
        <TrendChart series={series} height={230} format={v => `${fmtIN(v)} trays`} />
        <ChartLegend items={series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
        <p className="mt-1.5 text-[11px] text-muted">
          Total {trend.total === null ? 'unavailable' : `${fmtIN(trend.total)} trays`} over {win.range.days} days. A gap is a day nothing was collected — not a zero.
        </p>
      </GraphCard>

      <GraphCard
        className="lg:col-span-4" title="Today by shed" height={220}
        subtitle={`${fmtDateShort(todayISO())} · tap a bar for the shed`}
        loading={!settled}
        empty={!anyShedToday ? {
          title: 'No shed has reported today',
          description: 'Once a shed logs its collection it appears here with its grade split.',
        } : undefined}
      >
        <BarSeries bars={bars} height={190} format={v => `${fmtIN(v)} tr`} onPick={id => nav(`/sheds/${id}`)} color={CHART.brand} />
        <p className="mt-2 text-[11px] text-muted">Bars are separate sheds, never lines sharing one graph. A dashed bar has no record today.</p>
      </GraphCard>
    </div>
  );
}

/* ============================= 2 · GODOWN ============================= */

function GodownSection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const { feedStock } = data;
  const win = useWindow('30D');

  const position = useMemo(() => godownPosition(feedStock), [feedStock]);
  const ingredients = useMemo(() => godownIngredients(feedStock), [feedStock]);  const [picked, setPicked] = useState<string | null>(null);
  const ingredient = picked && ingredients.includes(picked) ? picked : ingredients[0] ?? null;
  const ingTrend = useMemo(
    () => (ingredient ? ingredientStockTrend(feedStock, ingredient, win.range) : null),
    [feedStock, ingredient, win.range],
  );

  const toneFor = (s: GodownRow['status']): HRow['tone'] =>
    s === 'CRITICAL' ? 'danger' : s === 'LOW' ? 'warn' : 'success';

  const rows: HRow[] = position.rows.map(p => ({
    id: p.ingredient,
    label: p.ingredient,
    value: p.stockKg,
    display: `${fmtIN(p.stockKg)} kg`,
    sub: p.daysLeft === null
      ? p.avg7Kg ? `${fmtIN(p.avg7Kg)} kg/day · runway unknown` : 'No draw in 7 days'
      : `≈ ${fmtIN(p.daysLeft)} days left at ${fmtIN(p.avg7Kg ?? 0)} kg/day`,
    tone: toneFor(p.status),
  }));

  const low = position.rows.filter(p => p.status !== 'NORMAL');
  const negative = position.rows.filter(p => p.negative);

  const ingSeries: VSeries[] = ingTrend ? [
    { id: 'closing', label: 'Closing stock', color: CHART.brand, points: ingTrend.closing, area: true },
    { id: 'out', label: 'Given to birds', color: CHART.danger, points: ingTrend.consumption, dashed: true },
    { id: 'in', label: 'Received', color: CHART.teal, points: ingTrend.feedIn, dashed: true },
  ] : [];

  const ingStats: GraphStat[] = ingTrend ? [
    { label: 'Current stock', value: `${fmtIN(ingTrend.current)} kg`, tone: ingTrend.current < 0 ? 'danger' : 'ink' },
    { label: 'Avg daily use', value: ingTrend.avgDailyUse === null ? 'Unavailable' : `${fmtIN(ingTrend.avgDailyUse)} kg` },
    { label: 'Days left', value: ingTrend.daysLeft === null ? 'Unavailable' : fmtIN(ingTrend.daysLeft) },
    { label: 'Heaviest day', value: ingTrend.heaviest ? `${fmtIN(ingTrend.heaviest.value)} kg` : 'Unavailable', sub: ingTrend.heaviest?.date ? fmtDateShort(ingTrend.heaviest.date) : undefined },
    { label: 'Consumed', value: `${fmtIN(ingTrend.totalConsumed)} kg`, sub: 'in period' },
    { label: 'Received', value: `${fmtIN(ingTrend.totalReceived)} kg`, sub: 'in period' },
  ] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-6" title="Godown stock position" height={300}
        subtitle="Closing KG from the movement ledger · tap an ingredient for its history"
        loading={!settled}
        warnings={[
          ...position.warnings,
          ...negative.map(p => `${p.ingredient} shows ${fmtIN(p.stockKg)} kg — negative stock requires an adjustment entry.`),
          ...(low.length ? [`${low.length} ingredient${low.length === 1 ? '' : 's'} below the godown's reorder level (${fmtIN(GODOWN_LOW_KG)} kg), critical under ${fmtIN(GODOWN_CRITICAL_KG)} kg.`] : []),
        ]}
        empty={!rows.length ? {
          title: 'The godown ledger is empty',
          description: 'No opening stock or receipts have been recorded for this company, so there is no position to show.',
        } : undefined}
      >
        <HBarList rows={rows} onPick={id => nav(`/feed?q=${encodeURIComponent(id)}`)} />
      </GraphCard>

      <GraphCard
        className="lg:col-span-6" title="Ingredient stock trend" height={260}
        subtitle={ingredient ? `${fmtDateShort(win.range.from)} – ${fmtDateShort(win.range.to)} · derived from ledger rows only` : undefined}
        loading={!settled}
        warnings={ingTrend?.warnings}
        actions={win.control}
        stats={ingStats}
        empty={!ingredient ? {
          title: 'No ingredients on record',
          description: 'Add an opening or receipt entry in the godown to start tracking stock.',
        } : undefined}
      >
        {ingredients.length > 0 && (
          <ChipGroup
            className="mb-3"
            value={ingredient ?? ''}
            onChange={setPicked}
            options={ingredients.slice(0, 8).map(i => ({ value: i, label: i }))}
          />
        )}
        {ingTrend && (
          <>
            <TrendChart series={ingSeries} height={210} format={v => `${fmtIN(v)} kg`} />
            <ChartLegend items={ingSeries.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
            <p className="mt-1.5 text-[11px] text-muted">
              Opening {fmtIN(ingTrend.opening)} kg on {fmtDateShort(win.range.from)}; adjustments and issues out to traders are in the same ledger.
            </p>
          </>
        )}
      </GraphCard>
    </div>
  );
}

type GodownRow = ReturnType<typeof godownPosition>['rows'][number];

/* ============================= 3 · EGG STOCK AND SALES ============================= */

function EggStockSalesSection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const money = useMoney();
  const { eggs, saleEntries, traderTxns, traders } = data;
  const stockWin = useWindow('30D');
  const salesWin = useWindow('30D');
  const traderWin = useWindow('30D');
  const [mode, setMode] = useState<SalesMode>('TRAYS');
  const sales = useMemo(() => eggSalesTrend(saleEntries, salesWin.range, mode), [saleEntries, salesWin.range, mode]);
  const stock = useMemo(() => eggStockMovement(eggs, saleEntries, stockWin.range), [eggs, saleEntries, stockWin.range]);
  const byTrader = useMemo(() => salesByTrader(traderTxns, traders, traderWin.range), [traderTxns, traders, traderWin.range]);

  const saleOf = (date: string) => saleEntries.filter(e => e.date === date);

  const stockSeries: VSeries[] = [
    { id: 'closing', label: 'Eggs in hand', color: CHART.brand, points: stock.closing, area: true },
    { id: 'coll', label: 'Collected', color: CHART.accent, points: stock.collection, dashed: true },
    { id: 'sold', label: 'Sold', color: CHART.danger, points: stock.sales, dashed: true },
  ];

  const salesSeries: VSeries[] = [{
    id: 'sales',
    label: mode === 'TRAYS' ? 'Trays sold' : mode === 'VALUE' ? 'Billed value' : 'Rate per egg',
    color: mode === 'RATE' ? CHART.brand : CHART.accent,
    points: sales.points,
    area: true,
  }];

  const salesFmt = (v: number) => mode === 'TRAYS' ? `${fmtIN(v)} trays`
    : mode === 'VALUE' ? `${money.m(v)} billed`
    : `${money.r(v)} / egg`;

  const traderRows: HRow[] = byTrader.map(t => ({
    id: t.traderId,
    label: t.name,
    value: t.value,
    display: money.canView ? fmtMoney(t.value) : '₹ •••••',
    sub: `${fmtIN(t.trays)} trays billed${t.active ? '' : ' · trader inactive'}`,
    tone: t.active ? 'normal' : 'muted',
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-6" title="Egg stock movement" height={250}
        subtitle={`${fmtDateShort(stockWin.range.from)} – ${fmtDateShort(stockWin.range.to)} · trays in the egg room`}
        loading={!settled}
        actions={stockWin.control}
        warnings={stock.warnings}
        stats={[
          { label: 'Opening', value: fmtIN(stock.opening), sub: 'trays' },
          { label: 'Collected today', value: stock.todayCollection === null ? 'No record' : fmtIN(stock.todayCollection), sub: 'trays', tone: stock.todayCollection === null ? 'muted' : 'success' },
          { label: 'Sold today', value: stock.todaySales === null ? 'No record' : fmtIN(stock.todaySales), sub: 'trays', tone: stock.todaySales === null ? 'muted' : 'danger' },
          { label: 'Broken today', value: stock.todayDamage === null ? 'No record' : fmtIN(stock.todayDamage), sub: 'trays', tone: stock.todayDamage === null ? 'muted' : 'warn' },
          { label: 'Closing now', value: fmtIN(stock.closingNow), sub: `${stock.change >= 0 ? '+' : ''}${fmtIN(stock.change)} vs opening`, tone: stock.closingNow < 0 ? 'danger' : 'ink' },
        ]}
        empty={blank(stock.collection) && blank(stock.sales) ? {
          title: 'No egg movement in this period',
          description: 'Nothing was collected and no load was billed, so there is no stock trail to draw.',
        } : undefined}
      >
        <TrendChart series={stockSeries} height={200} format={v => `${fmtIN(v)} trays`} />
        <ChartLegend items={stockSeries.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
        <p className="mt-1.5 text-[11px] text-muted">
          Closing = opening + collected − sold. Only a final sale entry takes trays out; a shed dispatch note on its own moves nothing, so a load can never be deducted twice.
        </p>
      </GraphCard>

      <GraphCard
        className="lg:col-span-6" title="Egg sales" height={250}
        subtitle={`${sales.entries} sale ${sales.entries === 1 ? 'entry' : 'entries'} billed in this period`}
        loading={!settled}
        warnings={sales.warnings}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <GraphRange value={mode} onChange={setMode} label="Sales measure" options={[
              { value: 'TRAYS', label: 'Trays' }, { value: 'VALUE', label: 'Value' }, { value: 'RATE', label: 'Rate' },
            ]} />
            {salesWin.control}
          </div>
        }
        stats={[
          { label: 'Today', value: sales.today === null ? 'No sale' : mode === 'TRAYS' ? fmtIN(sales.today) : mode === 'VALUE' ? money.m(sales.today) : money.r(sales.today), tone: sales.today === null ? 'muted' : 'ink' },
          { label: `Period ${mode === 'TRAYS' ? 'trays' : mode === 'VALUE' ? 'billed' : 'avg rate'}`, value: sales.periodTotal === null ? 'Unavailable' : mode === 'TRAYS' ? fmtIN(sales.periodTotal) : mode === 'VALUE' ? money.m(sales.periodTotal) : money.r(sales.periodTotal) },
          { label: 'Avg rate / egg', value: money.r(sales.avgRate) },
        ]}
        empty={blank(sales.points) ? {
          title: 'No egg sale billed in this period',
          description: 'Sales appear here once accounts records a sale entry against a trader.',
        } : undefined}
      >
        <TrendChart
          series={salesSeries} height={200} format={salesFmt}
          zeroBase={mode !== 'RATE'}
          onPick={date => {
            const same = saleOf(date);
            nav(same.length === 1 ? `/sales/entry/${same[0].id}` : '/sales');
          }}
          pickLabel={date => {
            const same = saleOf(date);
            return same.length === 1 ? 'Open this sale' : same.length ? `Open the ${same.length} sales on ${fmtDateShort(date)}` : 'Open the sales ledger';
          }}
        />
        <p className="mt-2 text-[11px] text-muted">
          {mode === 'RATE'
            ? 'Rate is a load’s egg money divided by the eggs on it — loading labour is never inside a price — so a day with no eggs shows no point.'
            : 'Billed value is the eggs plus the loading labour recovered on the load.'}
        </p>
      </GraphCard>

      <GraphCard
        className="lg:col-span-12" title="Sales by trader" height={200}
        subtitle={`${fmtDateShort(traderWin.range.from)} – ${fmtDateShort(traderWin.range.to)} · from the trader ledger, never a typed balance`}
        loading={!settled}
        actions={traderWin.control}
        empty={!byTrader.length ? {
          title: 'No trader has bought eggs in this period',
          description: 'A sale entry against a trader puts them on this chart.',
        } : undefined}
      >
        <HBarList rows={traderRows} onPick={id => nav(`/traders/${id}`)} caption={money.canView ? 'Tap a trader to open their ledger.' : 'Values are hidden for your role.'} />
      </GraphCard>
    </div>
  );
}

/* ============================= 4 · FEED ============================= */

function FeedSection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const money = useMoney();
  const { feed, feedStock, feedFormulas, sheds } = data;
  const useWin = useWindow('30D');
  const costWin = useWindow('30D');

  const use = useMemo(() => feedConsumptionTrend(feed, useWin.range), [feed, useWin.range]);
  const perShed = useMemo(() => feedByShed(feed, sheds, feedFormulas, useWin.range), [feed, sheds, feedFormulas, useWin.range]);
  const cost = useMemo(() => feedCostTrend(feed, feedStock, feedFormulas, costWin.range), [feed, feedStock, feedFormulas, costWin.range]);

  const bars: VBar[] = perShed.map(s => ({
    id: s.shedId,
    label: s.shedName,
    value: s.tonnes > 0 ? s.tonnes : null,
    hint: s.missingFormula
      ? 'Formula version unavailable for part of this period'
      : `${s.formulaName ?? 'No formula'}${s.formulaVersion ? ` v${s.formulaVersion}` : ''} · ${s.days} days`,
  }));

  const costFmt = (v: number) => `${money.m(v)} cost`;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-7" title="Feed consumption" height={240}
        subtitle={`${fmtDateShort(useWin.range.from)} – ${fmtDateShort(useWin.range.to)} · tonnes offered to the birds`}
        loading={!settled}
        actions={useWin.control}
        warnings={use.warnings}
        stats={[
          { label: 'Today', value: use.today === null ? 'No record' : tonnes(use.today), tone: use.today === null ? 'muted' : 'ink' },
          { label: '7-day avg', value: use.avg7 === null ? 'Unavailable' : tonnes(use.avg7) },
          { label: 'Period total', value: use.total === null ? 'Unavailable' : tonnes(use.total) },
          { label: 'Heaviest day', value: use.heaviest ? tonnes(use.heaviest.value) : 'Unavailable', sub: use.heaviest?.date ? fmtDateShort(use.heaviest.date) : undefined },
        ]}
        empty={blank(use.points) ? {
          title: 'No feed recorded in this period',
          description: 'Supervisors log tonnes per shed daily; nothing has landed in this window.',
        } : undefined}
      >
        <TrendChart
          series={[{ id: 'feed', label: 'Tonnes', color: CHART.brand, points: use.points, area: true }]}
          height={200} format={v => `${fmtIN(Number(v.toFixed(2)))} tonnes`}
        />
      </GraphCard>

      <GraphCard
        className="lg:col-span-5" title="Feed by shed" height={240}
        subtitle="Tonnes in the period · the formula version that fed them"
        loading={!settled}
        empty={!perShed.length ? {
          title: 'No shed was fed in this period',
          description: 'Feed entries are recorded per shed, so an un-fed shed simply does not appear.',
        } : undefined}
        warnings={perShed.some(s => s.missingFormula)
          ? ['Formula version unavailable for some days — those days still show their tonnes, only the mix is unknown.']
          : undefined}
      >
        <BarSeries bars={bars} height={190} format={tonnes} onPick={id => nav(`/sheds/${id}`)} color={CHART.brand} />
        <p className="mt-2 text-[11px] text-muted">Tap a bar for the shed. Consumption is priced against the formula in force on that date, never today's version.</p>
      </GraphCard>

      <GraphCard
        className="lg:col-span-12" title="Feed cost" height={230}
        subtitle="Actual quantities used, valued at the godown average in force that day"
        loading={!settled}
        actions={costWin.control}
        warnings={cost.warnings}
        stats={[
          { label: 'Today', value: cost.today === null ? 'Unavailable' : money.m(cost.today), tone: cost.today === null ? 'muted' : 'ink' },
          { label: '7-day avg', value: cost.avg7 === null ? 'Unavailable' : money.m(cost.avg7) },
          { label: 'Cost / tonne', value: cost.perTonne === null ? 'Unavailable' : money.m(cost.perTonne) },
          { label: 'Period total', value: cost.total === null ? 'Unavailable' : money.m(cost.total), sub: cost.available ? `${fmtIN(cost.tonnes)} t fed` : undefined },
          { label: 'Quantity priced', value: cost.unpricedKg > 0 ? 'Incomplete' : 'Complete', sub: `${fmtIN(cost.pricedKg)} kg priced · ${fmtIN(cost.unpricedKg)} kg without a rate`, tone: cost.unpricedKg > 0 ? 'warn' : 'success' },
        ]}
        empty={!cost.available ? {
          title: 'Rate data unavailable',
          description: cost.tonnes > 0
            ? `${fmtIN(cost.tonnes)} tonnes were fed, but the godown has never priced the ingredients they drew. Nothing is being shown as zero.`
            : 'No feed was consumed in this period.',
        } : undefined}
      >
        <TrendChart
          series={[{ id: 'cost', label: 'Feed cost', color: CHART.accent, points: cost.points, area: true }]}
          height={200} format={costFmt}
        />
        <p className="mt-2 text-[11px] text-muted">
          This is what the mix cost, shown beside the money ledger rather than inside it — the P&amp;L below reads recorded finance rows only.
        </p>
      </GraphCard>
    </div>
  );
}

/* ============================= 5 · PROFIT AND LOSS ============================= */

const PNL_MODES = [
  { value: 'WEEK', label: 'Weekly' },
  { value: 'MONTH', label: 'Monthly' },
  { value: 'QUARTER', label: '3 Months' },
] as const;

function MoneySection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const money = useMoney();
  const { finance } = data;
  const [pnlMode, setPnlMode] = useState<PnlMode>('MONTH');
  const revWin = useWindow('30D');

  const pnl = useMemo(() => pnlTrend(finance, pnlMode), [finance, pnlMode]);
  const revenue = useMemo(() => revenueTrend(finance, revWin.range), [finance, revWin.range]);
  const breakdown = useMemo(() => revenueBreakdown(finance, revWin.range), [finance, revWin.range]);

  const netPoints: Point[] = pnl.buckets.map(b => ({ date: b.to, value: b.net }));
  const slices = breakdown.rows.map((r, i) => ({ label: r.label, value: r.value, color: SERIES_COLORS[i % SERIES_COLORS.length] }));

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-7" title="Farm profit and loss" height={250}
        subtitle="Money in against money out, from the finance ledger"
        loading={!settled}
        warnings={pnl.warnings}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <GraphRange value={pnlMode} onChange={setPnlMode} options={PNL_MODES} label="P&L grouping" />
            <button type="button" onClick={() => nav('/finance')} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-brand press">
              Open ledger <ChevronRight size={12} />
            </button>
          </div>
        }
        empty={!pnl.available ? {
          title: 'Not enough financial data to calculate P&L',
          description: 'A period needs both money in and money out recorded before a net figure is honest. Nothing is being assumed.',
        } : undefined}
      >
        <PairedBars buckets={pnl.buckets} format={v => money.m(v)} height={180} />
        <div className="mt-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted mb-1.5">Net result trend</p>
          <TrendChart
            series={[{ id: 'net', label: 'Net', color: CHART.brand, points: netPoints, area: true }]}
            height={150} zeroBase={false} format={v => `${money.m(v)} net`}
            footnote="A negative bucket is a loss the farm actually recorded, not a shortfall we filled in."
          />
        </div>
      </GraphCard>

      <div className="lg:col-span-5 grid gap-4 min-w-0">
        <GraphCard
          title="Revenue" height={190}
          subtitle={`${fmtDateShort(revWin.range.from)} – ${fmtDateShort(revWin.range.to)} · money received`}
          loading={!settled}
          actions={revWin.control}
          warnings={revenue.warnings}
          stats={[
            { label: 'Today', value: revenue.today === null ? 'No record' : money.m(revenue.today), tone: revenue.today === null ? 'muted' : 'success' },
            { label: '7-day avg', value: revenue.avg7 === null ? 'Unavailable' : money.m(revenue.avg7) },
            { label: 'Period total', value: revenue.total === null ? 'Unavailable' : money.m(revenue.total) },
          ]}
          empty={blank(revenue.points) ? {
            title: 'No income recorded in this period',
            description: 'Revenue here is money the finance ledger received, so an unrecorded payment shows as a gap.',
          } : undefined}
        >
          <TrendChart
            series={[{ id: 'rev', label: 'Money in', color: CHART.success, points: revenue.points, area: true }]}
            height={160} format={v => `${money.mA(v)} in`}
          />
        </GraphCard>

        <GraphCard
          title="Revenue mix" height={170}
          subtitle="Categories that actually have finance rows in the period"
          loading={!settled}
          empty={!breakdown.rows.length ? {
            title: 'No income categories to split',
            description: 'This chart only draws categories with recorded income, so it stays empty until there are some.',
          } : undefined}
        >
          {breakdown.donut
            ? <DonutChart slices={slices} format={v => money.mA(v)} centerLabel="in period" />
            : <HBarList rows={breakdown.rows.map((r, i) => ({
              id: r.label, label: r.label, value: r.value,
              display: money.m(r.value),
              sub: r.share === null ? undefined : `${fmtPct(r.share * 100, 0)} of income`,
              tone: (i === 0 ? 'success' : 'normal') as HRow['tone'],
            }))} caption={`${breakdown.rows.length} income categories — a bar list reads better than a donut at this many.`} />}
        </GraphCard>
      </div>
    </div>
  );
}

/* ============================= 6 · TRADERS ============================= */

function TraderSection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const money = useMoney();
  const { traders, traderTxns } = data;
  const win = useWindow('30D');

  const outstanding = useMemo(() => traderOutstanding(traders, traderTxns), [traders, traderTxns]);
  const collections = useMemo(() => traderCollections(traders, traderTxns, win.range), [traders, traderTxns, win.range]);

  const rows: HRow[] = outstanding
    .filter(t => t.balance !== 0 || t.txns > 0)
    .map(t => ({
      id: t.traderId,
      label: t.name,
      value: t.balance,
      display: money.m(t.balance),
      sub: t.balance > 0
        ? `${fmtIN(t.txns)} ledger ${t.txns === 1 ? 'row' : 'rows'} · due to collect`
        : t.balance < 0 ? 'Money held for the trader' : 'Settled',
      tone: t.balance > 0 ? 'danger' : t.balance < 0 ? 'warn' : 'success',
    }));

  const series: VSeries[] = [
    { id: 'billed', label: 'Billed', color: CHART.accent, points: collections.billed, area: true },
    { id: 'paid', label: 'Received', color: CHART.success, points: collections.received, dashed: true },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-5" title="Trader outstanding" height={230}
        subtitle="Opening balance + billed − received, read back off the signed ledger"
        loading={!settled}
        empty={!rows.length ? {
          title: 'No trader carries a balance',
          description: 'Every trader is either settled or has no transactions yet.',
        } : undefined}
      >
        <HBarList rows={rows} onPick={id => nav(`/traders/${id}`)} caption="Tap a trader for their ledger and the sale behind each row." />
      </GraphCard>

      <GraphCard
        className="lg:col-span-7" title="Trader collections" height={230}
        subtitle={`${fmtDateShort(win.range.from)} – ${fmtDateShort(win.range.to)} · billed against what actually arrived`}
        loading={!settled}
        actions={win.control}
        warnings={collections.warnings}
        stats={[
          { label: 'Billed', value: collections.totalBilled === null ? 'Unavailable' : money.m(collections.totalBilled) },
          { label: 'Received', value: collections.totalReceived === null ? 'Unavailable' : money.m(collections.totalReceived), tone: 'success' },
          { label: 'Total outstanding', value: money.m(collections.outstanding), tone: collections.outstanding > 0 ? 'danger' : 'success' },
        ]}
        empty={blank(collections.billed) && blank(collections.received) ? {
          title: 'No trader activity in this period',
          description: 'Nothing was billed or paid, so there is no movement to plot.',
        } : undefined}
      >
        <TrendChart series={series} height={190} format={v => `${money.mA(v)}`} />
        <ChartLegend items={series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
        <p className="mt-1.5 text-[11px] text-muted">
          Outstanding movement is what the day added to or cleared off the dues — a gap is a day with no transaction, not a settled account.
        </p>
      </GraphCard>
    </div>
  );
}

/* ============================= 7 · EGG DAMAGE ============================= */

function DamageSection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const { eggs, sheds } = data;
  const win = useWindow('30D');
  const shedWin = useWindow('30D');

  const trend = useMemo(() => eggDamageTrend(eggs, win.range), [eggs, win.range]);
  const byShed = useMemo(() => damageByShed(eggs, sheds, shedWin.range), [eggs, sheds, shedWin.range]);

  const bars: VBar[] = byShed.map(s => ({
    id: s.shedId,
    label: s.shedName,
    value: s.trays,
    hint: s.pct === null ? 'No production total to divide by' : `${fmtPct(s.pct, 2)} of its trays`,
  }));

  const series: VSeries[] = [
    { id: 'pct', label: 'Damage %', color: CHART.danger, points: trend.points, area: true },
    { id: 'trays', label: 'Broken trays', color: CHART.muted, points: trend.trayPoints, dashed: true },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-7" title="Egg damage" height={240}
        subtitle="Broken trays as a share of the day's collection"
        loading={!settled}
        actions={win.control}
        warnings={trend.warnings}
        stats={[
          { label: 'Today', value: trend.todayPct === null ? 'Unavailable' : fmtPct(trend.todayPct, 2), sub: trend.todayTrays === null ? 'no broken record' : `${fmtIN(trend.todayTrays)} trays`, tone: trend.todayPct !== null && trend.todayPct > 2 ? 'danger' : 'ink' },
          { label: '7-day avg', value: trend.avg7Pct === null ? 'Unavailable' : fmtPct(trend.avg7Pct, 2) },
          { label: 'Worst day', value: trend.worst ? fmtPct(trend.worst.value, 2) : 'Unavailable', sub: trend.worst?.date ? fmtDateShort(trend.worst.date) : undefined, tone: 'danger' },
          { label: 'Broken in period', value: sumPoints(trend.trayPoints) === null ? 'Unavailable' : `${fmtIN(sumPoints(trend.trayPoints)!)} tr`, tone: 'warn' },
        ]}
        empty={!trend.available ? {
          title: 'Damage percentage unavailable',
          description: 'No day in this period has both a collection record and trays to divide by, so a percentage would be invented.',
        } : undefined}
      >
        <TrendChart series={series} height={200} format={(v, s) => s.id === 'pct' ? `${fmtPct(v, 2)} damaged` : `${fmtIN(v)} trays`} />
        <ChartLegend items={series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
        <p className="mt-1.5 text-[11px] text-muted">The chart says how much broke; the farm's own records say where. No cause is implied.</p>
      </GraphCard>

      <GraphCard
        className="lg:col-span-5" title="Damage by shed" height={240}
        subtitle={`${fmtDateShort(shedWin.range.from)} – ${fmtDateShort(shedWin.range.to)} · broken trays`}
        loading={!settled}
        actions={shedWin.control}
        empty={!byShed.some(s => s.trays > 0) ? {
          title: 'No broken trays recorded',
          description: 'Either nothing broke in this period, or no shed has reported yet.',
        } : undefined}
      >
        <BarSeries bars={bars} height={190} format={v => `${fmtIN(v)} tr`} onPick={id => nav(`/sheds/${id}`)} color={CHART.danger} />
        <p className="mt-2 text-[11px] text-muted">Tap a bar for the shed's own record.</p>
      </GraphCard>
    </div>
  );
}

/* ============================= 8 · MORTALITY ============================= */

type Scope = { kind: 'ALL' } | { kind: 'SHED'; id: string } | { kind: 'BATCH'; id: string };

const ALL = 'ALL';

function MortalitySection({ data }: { data: Data }) {
  const nav = useNavigate();
  const settled = useSettled();
  const { mortality, batches, sheds } = data;
  const win = useWindow('30D');
  const cumWin = useWindow('30D');
  const [scope, setScope] = useState<string>(ALL);

  const picked: Scope = useMemo(() => {
    if (scope.startsWith('shed:')) return { kind: 'SHED', id: scope.slice(5) };
    if (scope.startsWith('batch:')) return { kind: 'BATCH', id: scope.slice(6) };
    return { kind: 'ALL' };
  }, [scope]);

  const filter = useMemo(() => (picked.kind === 'SHED' ? { shedId: picked.id }
    : picked.kind === 'BATCH' ? { batchId: picked.id } : {}), [picked]);

  const trend = useMemo(() => mortalityTrend(mortality, batches, win.range, filter), [mortality, batches, win.range, filter]);
  const cum = useMemo(() => mortalityTrend(mortality, batches, cumWin.range, filter), [mortality, batches, cumWin.range, filter]);

  const options = useMemo(() => [
    { value: ALL, label: 'All sheds' },
    ...sheds.map(s => ({ value: `shed:${s.id}`, label: s.name })),
    ...batches.map(b => ({ value: `batch:${b.id}`, label: b.code })),
  ], [sheds, batches]);

  const scoped = useMemo(() => {
    if (picked.kind === 'BATCH') return batches.find(b => b.id === picked.id) ?? null;
    if (picked.kind === 'SHED') return batches.find(b => b.shedId === picked.id && b.status === 'ACTIVE') ?? null;
    return null;
  }, [picked, batches]);

  /** The batch mortality log is where a day's deaths are actually kept. */
  const drill = () => {
    const target = scoped ?? batches.find(b => b.status === 'ACTIVE') ?? batches[0];
    nav(target ? `/batches/${target.id}/mortality` : '/batches');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <GraphCard
        className="lg:col-span-7" title="Mortality" height={240}
        subtitle={`${fmtDateShort(win.range.from)} – ${fmtDateShort(win.range.to)} · birds recorded dead that day`}
        loading={!settled}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            {win.control}
            <ChipGroup value={scope} onChange={setScope} options={options} />
          </div>
        }
        warnings={trend.warnings}
        stats={[
          { label: 'Today', value: trend.today === null ? 'No record' : fmtIN(trend.today), tone: trend.today === null ? 'muted' : 'ink' },
          { label: '7-day avg', value: trend.avg7 === null ? 'Unavailable' : fmtIN(Number(trend.avg7.toFixed(1))) },
          { label: 'In period', value: trend.total === null ? 'Unavailable' : fmtIN(trend.total) },
          { label: 'Birds standing', value: trend.liveBirds === null ? 'Unavailable' : fmtIN(trend.liveBirds), sub: 'on the last day' },
          { label: 'Worst day', value: trend.worst ? fmtIN(trend.worst.value) : 'Unavailable', sub: trend.worst?.date ? fmtDateShort(trend.worst.date) : undefined, tone: 'danger' },
        ]}
        empty={blank(trend.points) ? {
          title: 'No mortality recorded in this period',
          description: 'Either nothing was logged, or the entries that exist carry an invalid count, date or shed link.',
        } : undefined}
      >
        <TrendChart
          series={[{ id: 'mort', label: 'Birds', color: CHART.danger, points: trend.points, area: true }]}
          height={200} format={v => `${fmtIN(v)} birds`}
          onPick={drill} pickLabel={() => `Open the ${fmtDateShort(win.range.to)} mortality log`}
        />
      </GraphCard>

      <GraphCard
        className="lg:col-span-5" title="Cumulative mortality" height={240}
        subtitle="Running total of deaths against the birds placed"
        loading={!settled}
        actions={cumWin.control}
        stats={[
          { label: 'Cumulative', value: cum.cumulative.at(-1)?.value === undefined ? 'Unavailable' : fmtIN(cum.cumulative.at(-1)!.value ?? 0), sub: 'deaths to the last day' },
          { label: 'Birds standing', value: cum.liveBirds === null ? 'Unavailable' : fmtIN(cum.liveBirds) },
        ]}
        empty={blank(cum.points) ? {
          title: 'No deaths recorded in this period',
          description: 'A flat start appears once the first entry is logged.',
        } : undefined}
      >
        <TrendChart
          series={[{ id: 'cum', label: 'Cumulative', color: CHART.brand, points: cum.cumulative }]}
          height={200} format={v => `${fmtIN(v)} birds`}
        />
        <p className="mt-2 text-[11px] text-muted">Counted only from entries whose batch, date and quantity read correctly.</p>
      </GraphCard>
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
        eyebrow={`${greeting()} · ${fmtDateShort(todayISO())}`}
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
        <KpiLayer data={scoped} />

        <div>
          <SectionTitle>Egg production</SectionTitle>
          <EggProductionSection data={scoped} />
        </div>

        <div>
          <SectionTitle>Godown stock</SectionTitle>
          <GodownSection data={scoped} />
        </div>

        <div>
          <SectionTitle>Egg stock and sales</SectionTitle>
          <EggStockSalesSection data={scoped} />
        </div>

        <div>
          <SectionTitle>Feed</SectionTitle>
          <FeedSection data={scoped} />
        </div>

        {canFinance && (
          <div>
            <SectionTitle>Profit and loss</SectionTitle>
            <MoneySection data={scoped} />
          </div>
        )}

        {canFinance && (
          <div>
            <SectionTitle>Traders</SectionTitle>
            <TraderSection data={scoped} />
          </div>
        )}

        <div>
          <SectionTitle>Egg damage</SectionTitle>
          <DamageSection data={scoped} />
        </div>

        <div>
          <SectionTitle>Mortality</SectionTitle>
          <MortalitySection data={scoped} />
        </div>

        {/* <AttentionLayer alerts={alerts} /> */}

        <p className="text-[11px] text-faint leading-relaxed pb-2">
          Every graph on this page reads the same records the module screens do, filtered to {company?.name ?? 'this company'} and to the role you are signed in as. A gap means no record; a figure marked unavailable means the data to derive it is not there.
        </p>
      </div>
    </Page>
  );
}
