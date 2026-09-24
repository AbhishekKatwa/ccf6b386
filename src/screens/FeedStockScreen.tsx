import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Plus, FlaskConical, AlertTriangle, Wheat, ScrollText, ChevronRight, ChevronDown, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, IconTile, GroupList, ListRow, Badge } from '@/components/ui/Card';
import { Button, SearchField, SegmentedTabs } from '@/components/ui/Form';
import { StockLedger } from '@/components/godown/StockLedger';
import { AddStockDialog } from '@/components/godown/AddStockDialog';
import { FeedGivenDialog } from '@/components/godown/FeedGivenDialog';
import { COVERAGE_META } from '@/components/godown/coverageMeta';
import { fmtIN, fmtMoney, todayISO } from '@/lib/format';
import { GODOWN_LOW_KG, stockStatus } from '@/lib/calc';
import { COVERAGE_CRITICAL_DAYS, COVERAGE_LOW_DAYS, compareCoverage, coverageBands, coverageRows, fmtDays } from '@/lib/coverage';
import { godownMovements, ledgerTotals, type Movement } from '@/lib/movements';
import { useShortageAllocator } from '@/hooks/useShortageAllocator';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { useFeedCoverage } from '@/hooks/useFeedCoverage';

/**
 * The godown screen is the valuation's front page: every KG, average cost and stock
 * value here is read from the same replayed ledger that prices the formulas and the
 * sheds' feed expense. Nothing on this screen holds a price of its own.
 *
 * Two sub-tabs: Current Stock is where the inventory stands, Stock Ledger is every
 * movement that produced it.
 */
type GodownTab = 'stock' | 'ledger';

export function FeedStockScreen() {
  const nav = useNavigate();
  // The owner dashboard's stock graph lands here with the ingredient in hand.
  const [params] = useSearchParams();
  const data = useCompanyData();
  const stock = data.feedStock;
  const catalog = useApp(s => s.ingredientCatalog);
  const canCreate = useCan('create');
  const canDaily = useCan('createDailyOps');
  const canFinance = useCan('viewFinance');
  const { valuation } = useGodownPrices();
  const { forecast, coverage } = useFeedCoverage();

  const today = todayISO();
  const [q, setQ] = useState(params.get('q') ?? '');
  /** A payable in Finance opens the ledger on the receipt behind it. */
  const [tab, setTab] = useState<GodownTab>(params.get('tab') === 'ledger' ? 'ledger' : 'stock');
  const focusEntryId = params.get('movement');
  const [sortByCoverage, setSortByCoverage] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [open, setOpen] = useState(false);

  /** Shed-side entry: tonnes given today, auto-deducted through the shed formula. */
  const [feedOpen, setFeedOpen] = useState(false);

  /** Movement buckets per ingredient — the physical KG story behind each row. */
  const movements = useMemo(() => {
    const map = new Map<string, { opening: number; feedIn: number; out: number; adjust: number }>();
    for (const ing of catalog) map.set(ing, { opening: 0, feedIn: 0, out: 0, adjust: 0 });
    for (const e of stock) {
      const cur = map.get(e.ingredient) ?? { opening: 0, feedIn: 0, out: 0, adjust: 0 };
      if (e.kind === 'OPENING') cur.opening += e.qtyKg;
      else if (e.kind === 'FEED_IN') cur.feedIn += e.qtyKg;
      else if (e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION') cur.out += e.qtyKg;
      else cur.adjust += e.qtyKg; // signed
      map.set(e.ingredient, cur);
    }
    return map;
  }, [catalog, stock]);

  /** Stock, average cost and value per ingredient, straight from the replayed ledger. */
  const rows = useMemo(() => {
    const list = Array.from(movements.entries()).map(([ing, b]) => {
      const pos = valuation.now(ing);
      return {
        ingredient: ing, ...b,
        closing: pos.kg, avg: pos.avg,
        value: pos.kg > 0 ? pos.value : 0,
        unpricedKg: pos.kg > 0 ? Math.max(0, pos.kg - pos.valuedKg) : 0,
        cover: coverage(ing),
      };
    });
    const shown = q.trim()
      ? list.filter(x => x.ingredient.toLowerCase().includes(q.toLowerCase()))
      : list;
    // The forecast reads worst-first; the inventory itself keeps its own order.
    return sortByCoverage ? shown.slice().sort((a, b) => compareCoverage(a.cover, b.cover)) : shown;
  }, [movements, valuation, q, coverage, sortByCoverage]);

  const totals = useMemo(() => valuation.totals(today), [valuation, today]);
  /** Coverage is a farm fact, so neither the search box nor the sort changes what it reports. */
  const bands = useMemo(() => coverageBands(
    coverageRows(forecast, movements.keys(), ing => valuation.now(ing).kg),
  ), [forecast, movements, valuation]);
  const noIntake = forecast.blockers.filter(b => b.reason === 'NO_INTAKE').length;
  const noFormula = forecast.blockers.filter(b => b.reason === 'NO_FORMULA').length;
  /** The reorder watch is company-wide, so a search never changes what the metric reports. */
  const lowCount = useMemo(() => Array.from(movements.keys()).filter(ing => {
    const kg = valuation.now(ing).kg;
    return kg > 0 && stockStatus(kg) !== 'NORMAL';
  }).length, [movements, valuation]);

  /* ---------------- Stock Ledger tab ---------------- */

  /**
   * The whole ledger as movements: shed feedings collapse back into the one event they
   * were, everything else stands alone. Grouping only — the rows and their prices are
   * the ledger's own, read through the valuation.
   */
  const ledgerMovements = useMemo(
    () => godownMovements(stock, valuation, { sheds: data.sheds, batches: data.batches, feed: data.feed, users: data.users }),
    [stock, valuation, data.sheds, data.batches, data.feed, data.users],
  );
  const ledgerSummary = useMemo(() => ledgerTotals(ledgerMovements), [ledgerMovements]);
  /** A shortage is shared by the existing rule: over the feed each shed ate that month. */
  const allocate = useShortageAllocator();

  const ledgerActions = (canCreate || canDaily) && (
    <>
      {canCreate && <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add stock entry</Button>}
      {canDaily && <Button size="sm" variant="outline" icon={<Wheat size={14} />} onClick={() => setFeedOpen(true)}>Feed given</Button>}
    </>
  );

  const tabs = (
    <SegmentedTabs<GodownTab> value={tab} onChange={setTab} options={[
      { value: 'stock', label: 'Current Stock', icon: <Package size={13} /> },
      { value: 'ledger', label: 'Stock Ledger', icon: <ScrollText size={13} /> },
    ]} />
  );

  return (
    <Page withNav>
      <Header title="Godown" subtitle="Central inventory · stock in KG"
        action={<Button size="sm" icon={<FlaskConical size={14} />} onClick={() => nav('/feed/formulas')}>Formula</Button>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        {tabs}

        {tab === 'ledger' && (
          <StockLedger
            movements={ledgerMovements}
            totals={ledgerSummary}
            godownValue={totals.value}
            canFinance={canFinance}
            actions={ledgerActions}
            allocate={allocate}
            focusEntryId={focusEntryId}
          />
        )}

        {tab === 'stock' && (<>
        <Card padded={false}>
          <StatStrip>
            <StatCell><Stat label="Total inventory" value={`${fmtIN(Number((totals.kg / 1000).toFixed(1)))} MT`} sub={`${totals.inStock} of ${movements.size} ingredients in stock`} tone="brand" size="sm" /></StatCell>
            <StatCell>
              <Stat
                label="Stock value"
                value={canFinance ? (totals.value > 0 ? fmtMoney(totals.value) : 'No prices on record') : '₹•••••'}
                sub={canFinance
                  ? `Weighted average cost · ${fmtIN(totals.pricedKg)} kg priced${totals.unpricedKg > 0 ? `, ${fmtIN(totals.unpricedKg)} kg without a rate` : ''}`
                  : 'Derived from the receipts, not typed in'}
                tone="accent" size="sm"
              />
            </StatCell>
            <StatCell><Stat label="Below reorder level" value={String(lowCount)} sub={`${fmtIN(GODOWN_LOW_KG)} kg rule`} tone={lowCount > 0 ? 'danger' : 'neutral'} size="sm" /></StatCell>
          </StatStrip>

          {/* Days of stock left: the same forecast the ingredient rows carry, read farm-wide. */}
          <StatStrip className="border-t border-line-2">
            <StatCell><Stat label={`Under ${COVERAGE_CRITICAL_DAYS} days`} value={String(bands.under3)} sub="coverage is critical" tone={bands.under3 ? 'danger' : 'neutral'} size="sm" /></StatCell>
            <StatCell><Stat label={`Under ${COVERAGE_LOW_DAYS} days`} value={String(bands.under7)} sub="plan the next receipt" tone={bands.under7 ? 'warn' : 'neutral'} size="sm" /></StatCell>
            <StatCell>
              <Stat label="Tightest shelf" value={bands.lowest ? fmtDays(bands.lowest.days) : '—'}
                sub={bands.lowest
                  ? `${bands.lowest.ingredient} · ${fmtIN(bands.lowest.dailyKg)} kg/day expected`
                  : 'No live batch is expected to eat stock'}
                tone="brand" size="sm" />
            </StatCell>
          </StatStrip>

          {forecast.blockers.length > 0 && (
            <p className="border-t border-line-2 px-4 py-2.5 text-[11.5px] text-muted leading-relaxed">
              {`${forecast.blockers.length} live batch${forecast.blockers.length === 1 ? '' : 'es'} left out of the forecast`}
              {` — ${[
                noIntake ? `${noIntake} with intake not set` : null,
                noFormula ? `${noFormula} with no formula in force` : null,
              ].filter(Boolean).join(' · ')}. Set the intake on the batch to include it.`}
            </p>
          )}
        </Card>

        <div className="rounded-[18px] bg-brand-soft px-4 py-3">
          <button type="button" onClick={() => setWhyOpen(v => !v)} aria-expanded={whyOpen}
            className="w-full flex items-center gap-2 rounded-[10px] text-left ring-focus press">
            <Info size={15} className="text-brand shrink-0" />
            <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-brand-ink">
              One weighted average price per ingredient
            </span>
            <ChevronDown size={16} className={clsx('text-brand shrink-0 transition-transform', whyOpen && 'rotate-180')} />
          </button>
          {whyOpen && (
            <p className="mt-2 text-[12.5px] text-brand-ink leading-relaxed">
              Stock is held at godown level in KG, and a receipt at a new rate re-weights the average. Stock
              leaving — a shed&rsquo;s feeding, an issue, a shortage — goes out at the average in force and never
              moves it. Shed consumption deducts ingredients from this shared ledger via per-shed formulas.
            </p>
          )}
        </div>

        <SearchField value={q} onChange={setQ} placeholder="Search ingredient" />

        {(canCreate || canDaily) && (
          <div className="grid grid-cols-2 gap-2">
            {canCreate && <Button size="sm" block icon={<Plus size={15} />} className={canDaily ? '' : 'col-span-2'} onClick={() => setOpen(true)}>Add stock entry</Button>}
            {canDaily && <Button size="sm" block variant="outline" icon={<Wheat size={15} />} className={canCreate ? '' : 'col-span-2'} onClick={() => setFeedOpen(true)}>Feed given (t)</Button>}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title="No ingredients found" description="Try a different search." />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 px-0.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint shrink-0">
                {`${rows.length} ingredient${rows.length === 1 ? '' : 's'}${canFinance ? ' · stock · avg · value' : ''}`}
              </p>
              <div className="flex items-center gap-1.5 shrink-0" role="group" aria-label="Sort ingredients">
                {[{ on: false, label: 'A–Z' }, { on: true, label: 'Lowest coverage' }].map(o => (
                  <button key={o.label} type="button" onClick={() => setSortByCoverage(o.on)} aria-pressed={sortByCoverage === o.on}
                    className={clsx('px-2.5 py-1 rounded-full font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] press',
                      sortByCoverage === o.on ? 'bg-brand text-white' : 'bg-sunk text-muted hover:bg-brand-soft hover:text-brand')}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <GroupList>
              {rows.map(x => {
                const status = stockStatus(x.closing);
                const low = status !== 'NORMAL';
                const critical = status === 'CRITICAL';
                return (
                  <ListRow key={x.ingredient}
                    onClick={() => nav(`/feed/ingredient/${encodeURIComponent(x.ingredient)}`)}
                    leading={<IconTile tone={critical ? 'danger' : low ? 'accent' : 'brand'}><Package size={18} /></IconTile>}
                    title={x.ingredient}
                    subtitle={x.cover.dailyKg > 0 ? (
                      <span className="font-mono inline-flex items-center gap-1.5 min-w-0">
                        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', COVERAGE_META[x.cover.status].dot)} aria-hidden />
                        <span className="truncate">
                          {`${fmtIN(x.cover.dailyKg)} kg/day expected · `}
                          <span className={COVERAGE_META[x.cover.status].text}>{fmtDays(x.cover.days)}</span>
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono">Open {fmtIN(x.opening)} · In {fmtIN(x.feedIn)} · Out {fmtIN(x.out)}</span>
                    )}
                    trailing={
                      <div className="flex items-start gap-1.5 shrink-0">
                      <div className="text-right">
                        <p className={clsx('font-display font-bold text-base font-mono tnum', critical ? 'text-danger' : 'text-ink')}>{fmtIN(x.closing)}</p>
                        {canFinance && x.avg !== null && (
                          <p className="text-[10px] text-muted font-mono tnum mt-0.5">{fmtMoney(x.avg, 2)}/kg avg</p>
                        )}
                        {canFinance && x.closing > 0 && x.avg !== null && (
                          <p className="text-[10px] text-ink-2 font-mono tnum">value {fmtMoney(x.value)}
                            {x.unpricedKg > 0 && <span className="text-faint"> · {fmtIN(x.unpricedKg)} kg unpriced</span>}
                          </p>
                        )}
                        {low && x.closing > 0 && <Badge tone={critical ? 'danger' : 'accent'} className="mt-1">Low</Badge>}
                        {!canFinance && <p className="text-[9px] text-faint uppercase tracking-wider mt-0.5">kg</p>}
                      </div>
                      <ChevronRight size={16} className="text-faint mt-1 transition-colors group-hover:text-brand" />
                      </div>
                    } />
                );
              })}
            </GroupList>
          </>
        )}

        {lowCount > 0 && (
          <div className="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3">
            <AlertTriangle size={16} className="text-warn flex-shrink-0" />
            <p className="text-xs text-warn font-semibold">{lowCount} ingredient{lowCount > 1 ? 's' : ''} below the {fmtIN(GODOWN_LOW_KG)} kg reorder level.</p>
          </div>
        )}

        </>)}
      </div>

      <AddStockDialog open={open} onClose={() => setOpen(false)} />

      {feedOpen && <FeedGivenDialog onClose={() => setFeedOpen(false)} />}
    </Page>
  );
}
