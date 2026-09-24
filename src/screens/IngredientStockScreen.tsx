import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronRight, Info, Package, Plus, Receipt, TriangleAlert, Wheat } from 'lucide-react';
import clsx from 'clsx';
import { useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, IconTile, KPI, SectionTitle, type Tone } from '@/components/ui/Card';
import { Button, SegmentedTabs } from '@/components/ui/Form';
import { AreaTrend, BarsMini, CHART, ChartCard } from '@/components/ui/Charts';
import { AddStockDialog } from '@/components/godown/AddStockDialog';
import { LedgerDayHeader } from '@/components/godown/StockLedger';
import { MovementDetail } from '@/components/godown/MovementDetail';
import { KIND_META, ledgerKg } from '@/components/godown/movementMeta';
import { COVERAGE_META } from '@/components/godown/coverageMeta';
import {
  dayGroupLabel, godownMovements, ingredientEvents, ingredientFlow, MOVEMENT_LABEL,
  plainRemarks, MOVEMENT_KINDS, type Movement, type MovementKind, type MovementLine,
} from '@/lib/movements';
import { stockStatus, GODOWN_LOW_KG } from '@/lib/calc';
import { fmtDays, type IngredientCoverage } from '@/lib/coverage';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { useShortageAllocator } from '@/hooks/useShortageAllocator';
import { useFeedCoverage } from '@/hooks/useFeedCoverage';
import { fmtDate, fmtDateShort, fmtIN, fmtMoney, todayISO } from '@/lib/format';

/**
 * One ingredient's whole story: how the current KG on the shelf came about. Every figure
 * here is the ledger's own — quantities from its rows, money and running balances from the
 * weighted-average replay that prices the rest of the farm. Nothing is re-costed at
 * today's rates.
 */
type IngredientTab = 'overview' | 'history';

const FLOW_TONE: Record<MovementKind, Tone> = {
  OPENING: 'brand', FEED_IN: 'success', CONSUMPTION: 'accent',
  ADJUSTMENT: 'neutral', SHORTAGE: 'danger', FEED_OUT: 'warn',
};

export function IngredientStockScreen() {
  const { ingredient: slug } = useParams();
  const ingredient = decodeURIComponent(slug ?? '');
  const data = useCompanyData();
  const canFinance = useCan('viewFinance');
  const canCreate = useCan('create');
  const { valuation } = useGodownPrices();
  const { coverage } = useFeedCoverage();
  const allocate = useShortageAllocator();
  const today = todayISO();
  const [tab, setTab] = useState<IngredientTab>('overview');
  const [open, setOpen] = useState<Movement | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const movements = useMemo(
    () => godownMovements(data.feedStock, valuation, { sheds: data.sheds, batches: data.batches, feed: data.feed, users: data.users }),
    [data.feedStock, valuation, data.sheds, data.batches, data.feed, data.users],
  );
  const events = useMemo(() => ingredientEvents(movements, ingredient), [movements, ingredient]);
  const flow = useMemo(() => ingredientFlow(events), [events]);
  const pos = valuation.now(ingredient);
  /** What the live batches are expected to draw of this ingredient, and for how many days. */
  const cover = coverage(ingredient);

  /** The shelf after each movement, oldest first — the two trend lines read this. */
  const points = useMemo(() => [...events].reverse().map(e => ({
    date: e.movement.date,
    kg: e.line.place?.after.kg ?? null,
    value: e.line.place?.after.value ?? null,
    avg: e.line.place?.after.avg ?? null,
  })), [events]);
  const stockSeries = points.filter(p => p.kg !== null) as { date: string; kg: number; value: number | null; avg: number | null }[];
  const priceSeries = points.filter(p => p.avg !== null && p.avg > 0) as { date: string; kg: number; value: number | null; avg: number }[];
  const priceMoves = new Set(priceSeries.map(p => p.avg)).size >= 2;

  const byShed = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      if (e.movement.kind !== 'CONSUMPTION') continue;
      const shed = e.movement.shedName ?? 'Shed';
      m.set(shed, (m.get(shed) ?? 0) + e.line.qtyKg);
    }
    return Array.from(m, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [events]);

  const receipts = events.filter(e => e.movement.kind === 'FEED_IN' || e.movement.kind === 'OPENING');
  const corrections = events.filter(e => e.movement.kind === 'SHORTAGE' || e.movement.kind === 'ADJUSTMENT');
  const steps = MOVEMENT_KINDS.filter(k => flow[k].count > 0);

  const formulaPathOf = (m: Movement) =>
    m.formulaId && data.feedFormulas.some(f => f.id === m.formulaId) ? `/feed/formulas/${m.formulaId}` : null;

  /* The Godown's own booking sheet, opened with this ingredient already in hand. */
  const addStockButton = canCreate && (
    <Button size="sm" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add stock</Button>
  );
  const addStockDialog = (
    <AddStockDialog open={addOpen} onClose={() => setAddOpen(false)} presetIngredient={ingredient} />
  );

  if (!events.length) {
    return (
      <Page withNav>
        <Header title={ingredient || 'Ingredient'} subtitle="Stock history" backTo="/feed" action={addStockButton} />
        <div className="px-4 sm:px-0 mt-3 space-y-4">
          {cover.dailyKg > 0 && <ForecastCard cover={cover} />}
          <EmptyState icon={<Package size={22} />} title="No movements for this ingredient"
            description="The godown ledger holds nothing under this name yet, so there is no history to trace."
            action={canCreate && (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                Book the first {ingredient} entry
              </Button>
            )} />
        </div>
        {addStockDialog}
      </Page>
    );
  }

  const low = stockStatus(pos.kg);
  const groups: { date: string; rows: typeof events }[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.movement.date) last.rows.push(e);
    else groups.push({ date: e.movement.date, rows: [e] });
  }

  return (
    <Page withNav>
      <Header title={ingredient}
        subtitle={canFinance ? 'Stock history and valuation · central godown' : 'Stock history · central godown'}
        backTo="/feed" action={addStockButton} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        {/* §4 · where this ingredient stands, all of it read off the ledger */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <KPI label="Current stock" value={ledgerKg(pos.kg)} tone="brand"
            sub={low === 'NORMAL' ? `Above the ${fmtIN(GODOWN_LOW_KG)} kg rule` : `Below the ${fmtIN(GODOWN_LOW_KG)} kg rule`} />
          {canFinance && (
            <KPI label="Average cost" tone="neutral"
              value={pos.avg === null ? 'No rate' : `${fmtMoney(pos.avg, 2)}/kg`}
              sub="Weighted from its receipts" />
          )}
          {canFinance && (
            <KPI label="Current value" tone="accent" value={fmtMoney(pos.value)}
              sub={`${fmtIN(pos.valuedKg)} kg priced${pos.unpricedKg > 0 ? ` · ${fmtIN(pos.unpricedKg)} kg unpriced` : ''}`} />
          )}
          <KPI label="Opening stock" tone="neutral" value={ledgerKg(Math.abs(flow.OPENING.kg))}
            sub={flow.OPENING.count ? `${flow.OPENING.count} opening entr${flow.OPENING.count === 1 ? 'y' : 'ies'}` : 'Never opened as stock'} />
          <KPI label="Total received" tone="success" value={ledgerKg(flow.FEED_IN.kg)}
            sub={flow.FEED_IN.count
              ? `${flow.FEED_IN.count} receipt${flow.FEED_IN.count === 1 ? '' : 's'}${canFinance && flow.FEED_IN.value > 0 ? ` · ${fmtMoney(flow.FEED_IN.value)}` : ''}`
              : 'No receipts yet'} />
          <KPI label="Total consumed" tone="neutral"
            value={ledgerKg(Math.abs(flow.CONSUMPTION.kg))}
            sub={flow.CONSUMPTION.count
              ? `${flow.CONSUMPTION.count} shed feeding${flow.CONSUMPTION.count === 1 ? '' : 's'}${canFinance ? ` · ${fmtMoney(flow.CONSUMPTION.value)}` : ''}`
              : 'Never drawn by a shed'} />
        </div>

        <ForecastCard cover={cover} />

        <SegmentedTabs<IngredientTab> value={tab} onChange={setTab} options={[
          { value: 'overview', label: 'Overview', icon: <Package size={13} /> },
          { value: 'history', label: 'Stock History', icon: <Receipt size={13} /> },
        ]} />

        {tab === 'overview' && (<>
          {/* §5 · the ledger stated as one flow: opening + in − out = current */}
          <Card>
            <SectionTitle>Stock movement</SectionTitle>
            <ol className="relative space-y-3.5 pl-5">
              <span className="absolute left-[5px] top-2 bottom-6 w-px bg-line" aria-hidden />
              {steps.map(k => {
                const f = flow[k];
                const signed = f.kg;
                return (
                  <li key={k} className="relative">
                    <span className={clsx(
                      'absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full ring-[2.5px] ring-card',
                      dotClass[FLOW_TONE[k]],
                    )} aria-hidden />
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[13px] font-semibold text-ink">{MOVEMENT_LABEL[k]}</p>
                      <p className={clsx('font-mono text-[13px] font-semibold tnum shrink-0', signed >= 0 ? 'text-success' : 'text-danger')}>
                        {signed >= 0 ? '+' : '−'}{ledgerKg(Math.abs(signed))}
                      </p>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-faint tnum">
                      {f.count} movement{f.count === 1 ? '' : 's'}
                      {canFinance && f.value > 0 && <> · {signed >= 0 ? '+' : '−'}{fmtMoney(f.value)}</>}
                    </p>
                  </li>
                );
              })}
              <li className="relative">
                <span className="absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full bg-brand ring-[2.5px] ring-card" aria-hidden />
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[14px] font-semibold text-brand-ink">Current stock</p>
                  <p className="font-display text-[16px] font-semibold text-brand-ink tnum shrink-0">{ledgerKg(pos.kg)}</p>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-faint tnum">
                  {canFinance
                    ? (pos.avg === null ? 'No average on record' : `${fmtMoney(pos.avg, 2)}/kg · ${fmtMoney(pos.value)} on the shelf`)
                    : `${events.length} movements traced`}
                </p>
              </li>
            </ol>
          </Card>

          {/* §16 §17 · the two lines the ledger can actually draw */}
          <div className={clsx('grid gap-3', canFinance && 'sm:grid-cols-2')}>
            {/* A price history is valuation, so it stays with the money permission. */}
            {canFinance && (
              <ChartCard title={`${ingredient} average cost`}>
                {priceMoves ? (
                  <AreaTrend
                    data={priceSeries.map(p => p.avg)}
                    labels={priceSeries.map(p => fmtDateShort(p.date))}
                    color={CHART.accent}
                    height={110}
                    format={v => `${fmtMoney(v, 2)}/kg`}
                  />
                ) : (
                  <Note icon={<Info size={14} />}>
                    One rate has ever priced this ingredient, so there is no price line to draw yet.
                    A receipt at a different rate is what starts it.
                  </Note>
                )}
              </ChartCard>
            )}
            <ChartCard title="Stock quantity trend">
              {stockSeries.length >= 2 ? (
                <AreaTrend
                  data={stockSeries.map(p => p.kg)}
                  labels={stockSeries.map(p => fmtDateShort(p.date))}
                  color={CHART.brand}
                  height={110}
                  format={v => ledgerKg(v)}
                />
              ) : (
                <Note icon={<Info size={14} />}>A single movement so far — the quantity line appears once the ledger has another.</Note>
              )}
            </ChartCard>
          </div>

          {/* §18 · where the ingredient actually went */}
          <Card>
            <SectionTitle>{ingredient} consumption by shed</SectionTitle>
            {byShed.length ? (
              <BarsMini color={CHART.teal} items={byShed.map(s => ({ label: s.label, value: s.value, display: ledgerKg(s.value) }))} />
            ) : (
              <Note icon={<Info size={14} />}>No shed has drawn this ingredient — every KG that left went out another way.</Note>
            )}
          </Card>

          {/* §19 · every receipt, and the average it produced */}
          <div>
            <SectionTitle>Purchase / receipt history</SectionTitle>
            <div className="bg-card border border-line rounded-[18px] shadow-card divide-y divide-line-2 overflow-hidden">
              {receipts.length ? receipts.map(({ movement, line }) => (
                <button key={movement.key} type="button" onClick={() => setOpen(movement)}
                  className="w-full text-left px-4 py-3 press hover:bg-sunk/60 focus-visible:bg-sunk/60 ring-focus cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink truncate">
                        {fmtDate(movement.date)} · {MOVEMENT_LABEL[movement.kind]}
                      </p>
                      <p className="mt-0.5 text-[11px] text-faint truncate">
                        {plainRemarks(line.remarks) ?? (movement.kind === 'OPENING' ? 'Opening balance on the shelf' : 'No supplier note on this entry')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[12.5px] font-semibold text-success tnum">+{ledgerKg(line.qtyKg)}</p>
                      {canFinance && (
                        <>
                          <p className="mt-0.5 font-mono text-[10.5px] text-muted tnum">
                            {line.ratePerKg ? `${fmtMoney(line.ratePerKg, 2)}/kg` : 'no rate'}
                            {line.cost !== null && ` · ${fmtMoney(line.cost)}`}
                          </p>
                          <p className="mt-0.5 font-mono text-[10.5px] text-accent-ink tnum">
                            Avg → {line.place?.after.avg == null ? 'not priced' : `${fmtMoney(line.place.after.avg, 2)}/kg`}
                          </p>
                        </>
                      )}
                    </div>
                    <ChevronRight size={15} className="text-faint mt-1 shrink-0" />
                  </div>
                </button>
              )) : (
                <div className="px-4 py-6 text-center text-[12.5px] text-muted">
                  This ingredient reached the shelf through an adjustment or a return rather than a receipt.
                </div>
              )}
            </div>
          </div>

          {/* §20 · leakage and corrections, kept out of the consumption story */}
          <div>
            <SectionTitle>Shortages &amp; adjustments</SectionTitle>
            <div className="bg-card border border-line rounded-[18px] shadow-card divide-y divide-line-2 overflow-hidden">
              {corrections.length ? corrections.map(({ movement, line }) => {
                const alloc = canFinance && movement.kind === 'SHORTAGE' ? allocate(movement) : null;
                return (
                  <button key={movement.key} type="button" onClick={() => setOpen(movement)}
                    className="w-full text-left px-4 py-3 press hover:bg-sunk/60 focus-visible:bg-sunk/60 ring-focus cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-ink truncate">
                          {fmtDate(movement.date)} · {MOVEMENT_LABEL[movement.kind]}
                        </p>
                        <p className="mt-0.5 text-[11px] text-faint truncate">
                          {plainRemarks(movement.remarks) ?? (movement.kind === 'SHORTAGE' ? 'Counted short, no reason recorded' : 'No reason recorded')}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted truncate">
                          {movement.incoming ? 'Stock returned' : 'Stock written off'}
                          {line.place && <> · {ledgerKg(line.place.before.kg)} → {ledgerKg(line.place.after.kg)}</>}
                          {alloc?.basis === 'feed' && <> · spread over {alloc.shares.length} shed{alloc.shares.length === 1 ? '' : 's'}</>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={clsx('font-mono text-[12.5px] font-semibold tnum', movement.incoming ? 'text-success' : 'text-danger')}>
                          {movement.incoming ? '+' : '−'}{ledgerKg(line.qtyKg)}
                        </p>
                        {canFinance && (
                          <p className="mt-0.5 font-mono text-[10.5px] text-muted tnum">
                            {line.cost === null ? 'no rate on record' : `${fmtMoney(line.cost)} impact`}
                          </p>
                        )}
                      </div>
                      <ChevronRight size={15} className="text-faint mt-1 shrink-0" />
                    </div>
                  </button>
                );
              }) : (
                <div className="px-4 py-6 text-center text-[12.5px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <TriangleAlert size={14} className="text-faint" /> Never corrected — the shelf has only moved through receipts and feedings.
                  </span>
                </div>
              )}
            </div>
          </div>
        </>)}

        {tab === 'history' && (<>
          <p className="text-[12.5px] text-muted leading-relaxed px-1">
            Every movement of {ingredient} in date order, each with the stock balance it left behind
            {canFinance && ' and the value it was booked at'}. Tap a row for the complete transaction.
          </p>
          <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
            {groups.map(g => (
              <div key={g.date}>
                <LedgerDayHeader date={g.date} today={today} count={g.rows.length} />
                <div className="divide-y divide-line-2">
                  {g.rows.map(({ movement, line }) => (
                    <IngredientRow key={movement.key} movement={movement} line={line}
                      canFinance={canFinance} today={today} onOpen={() => setOpen(movement)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>)}
      </div>

      {addStockDialog}

      <MovementDetail movement={open} onClose={() => setOpen(null)} canFinance={canFinance}
        allocate={allocate} formulaPath={open ? formulaPathOf(open) : null} />
    </Page>
  );
}

const dotClass: Record<Tone, string> = {
  brand: 'bg-brand', accent: 'bg-accent', success: 'bg-success',
  danger: 'bg-danger', warn: 'bg-warn', neutral: 'bg-line',
};

/** One movement of a single ingredient, with the balance and value that followed it. */
function IngredientRow({ movement, line, canFinance, today, onOpen }: {
  movement: Movement;
  line: MovementLine;
  canFinance: boolean;
  today: string;
  onOpen: () => void;
}) {
  const { tone, Icon } = KIND_META[movement.kind];
  const after = line.place?.after;
  const rel = dayGroupLabel(movement.date, today);
  const where = [
    movement.kind === 'CONSUMPTION' ? `Shed ${movement.shedName ?? '—'}` : null,
    movement.batchCode,
    movement.formulaName ? `${movement.formulaName}${movement.formulaVersion ? ` V${movement.formulaVersion}` : ''}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${MOVEMENT_LABEL[movement.kind]} on ${fmtDate(movement.date)} — open details`}
      className="group flex items-start gap-3 px-4 py-3.5 text-left cursor-pointer transition-colors hover:bg-sunk/60 focus-visible:bg-sunk/60 ring-focus">
      <IconTile tone={tone} size={36}><Icon size={17} strokeWidth={1.9} /></IconTile>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-ink truncate">
          {MOVEMENT_LABEL[movement.kind]}
          {movement.shedName ? ` · ${movement.shedName}` : ''}
        </p>
        <p className="mt-0.5 text-[11.5px] text-muted tnum truncate">
          {fmtDate(movement.date)}{rel ? ` · ${rel}` : ''}
        </p>
        <p className="mt-0.5 text-[11px] text-faint truncate">{where || plainRemarks(line.remarks) || plainRemarks(movement.remarks) || '—'}</p>
        <p className="mt-1 font-mono text-[10.5px] text-muted tnum">
          Balance {ledgerKg(after?.kg ?? 0)}
          {canFinance && after && <> · {fmtMoney(after.value)}</>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        <div className="text-right">
          <p className={clsx('font-mono text-[12.5px] font-bold tnum', movement.incoming ? 'text-success' : 'text-danger')}>
            {movement.incoming ? '+' : '−'}{ledgerKg(line.qtyKg)}
          </p>
          {canFinance && (
            <p className="mt-0.5 font-mono text-[10px] tnum text-muted">
              {line.cost === null ? 'no rate' : fmtMoney(line.cost)}
              {line.avg !== null && ` · ${fmtMoney(line.avg, 2)}/kg`}
            </p>
          )}
        </div>
        <ChevronRight size={16} className="text-faint transition-colors group-hover:text-brand" />
      </div>
    </div>
  );
}

function Note({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[14px] bg-sunk px-3.5 py-3">
      <span className="text-muted mt-0.5 shrink-0">{icon}</span>
      <p className="text-[11.5px] text-muted leading-relaxed">{children}</p>
    </div>
  );
}

/**
 * Why the godown says what it says about days left: every live batch expected to eat this
 * ingredient, the mix version behind each figure, and what they add up to. Planning only —
 * the consumption ledger remains the record of what was actually fed.
 */
function ForecastCard({ cover }: { cover: IngredientCoverage }) {
  const meta = COVERAGE_META[cover.status];
  return (
    <Card>
      <SectionTitle right={
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Estimate · not consumption</span>
      }>
        Stock coverage
      </SectionTitle>

      {cover.dailyKg === 0 ? (
        <Note icon={<Wheat size={14} />}>
          No live batch is expected to eat {cover.ingredient}, so there is no days-left estimate for it.
          An approximate feed intake on a batch is what brings one in.
        </Note>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[12.5px] text-muted min-w-0 truncate">
              <span className="font-mono font-semibold text-ink tnum">{fmtIN(cover.dailyKg)} kg/day</span> expected
            </p>
            <p className={clsx('font-display text-[19px] font-semibold tnum shrink-0', meta.text)}>{fmtDays(cover.days)}</p>
          </div>

          <div className="mt-1 divide-y divide-line-2">
            {cover.contributors.map(c => (
              <div key={c.batchId} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink truncate">{c.shedName} / {c.batchCode}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted tnum truncate">
                    {c.tonnesPerDay.toFixed(2)} t/day × {fmtIN(c.kgPerTonne)} kg/tonne · {c.formulaName} V{c.formulaVersion}
                  </p>
                </div>
                <p className="font-mono text-[12.5px] font-semibold text-ink tnum shrink-0 pt-0.5">{fmtIN(c.dailyKg)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-line pt-2 mt-0.5">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                Total · {cover.contributors.length} batch{cover.contributors.length === 1 ? '' : 'es'}
              </p>
              <p className="font-mono text-[13px] font-semibold text-brand-ink tnum">{fmtIN(cover.dailyKg)} kg/day</p>
            </div>
          </div>

          <p className="mt-2 font-mono text-[10px] text-faint tnum">
            {`${fmtIN(cover.stockKg)} kg on the shelf ÷ ${fmtIN(cover.dailyKg)} kg a day · ${meta.label}`}
          </p>
        </>
      )}
    </Card>
  );
}
