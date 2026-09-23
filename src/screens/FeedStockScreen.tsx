import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Plus, FlaskConical, AlertTriangle, Wheat, ScrollText, ChevronRight, ChevronDown, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, IconTile, GroupList, ListRow, Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, SearchField, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { StockLedger } from '@/components/godown/StockLedger';
import { COVERAGE_META } from '@/components/godown/coverageMeta';
import { fmtIN, fmtMoney, todayISO } from '@/lib/format';
import { formulaDeduction, formulaForDate, GODOWN_LOW_KG, stockStatus } from '@/lib/calc';
import { blendPrice } from '@/lib/valuation';
import { COVERAGE_CRITICAL_DAYS, COVERAGE_LOW_DAYS, compareCoverage, coverageBands, coverageRows, fmtDays } from '@/lib/coverage';
import { godownMovements, ledgerTotals, type Movement } from '@/lib/movements';
import { useShortageAllocator } from '@/hooks/useShortageAllocator';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { useFeedCoverage } from '@/hooks/useFeedCoverage';
import type { FeedStockKind } from '@/types';

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
  const addStock = useApp(s => s.addFeedStock);
  const addFeedConsumption = useApp(s => s.addFeedConsumption);
  const catalog = useApp(s => s.ingredientCatalog);
  const addIngredientType = useApp(s => s.addIngredientType);
  const pushToast = useApp(s => s.pushToast);
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
  const [form, setForm] = useState({
    ingredient: 'Maize' as string, date: todayISO(),
    kind: 'FEED_IN' as FeedStockKind,
    supplier: '', qtyKg: '', ratePerKg: '', remarks: '',
  });
  const [newName, setNewName] = useState('');

  /** The ingredient master: the global catalogue plus anything already in the ledger. */
  const knownIngredients = useMemo(() => {
    const set = new Set<string>(catalog);
    for (const e of stock) set.add(e.ingredient);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalog, stock]);

  /* A new ingredient is a deliberate act: it is registered here, never as a side effect of a stock entry. */
  const trimmedNew = newName.trim();
  const nameTaken = knownIngredients.some(i => i.toLowerCase() === trimmedNew.toLowerCase());
  const nameMatches = trimmedNew
    ? knownIngredients.filter(i => i.toLowerCase().includes(trimmedNew.toLowerCase())).slice(0, 6)
    : [];

  function registerIngredient() {
    const r = addIngredientType(trimmedNew);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    setForm(f => ({ ...f, ingredient: trimmedNew }));
    setNewName('');
    pushToast('success', `“${trimmedNew}” added to the ingredient list and selected`);
  }

  /** Shed-side entry: tonnes given today, auto-deducted through the shed formula. */
  const activeBatches = data.batches.filter(b => b.status === 'ACTIVE');
  const [feedOpen, setFeedOpen] = useState(false);
  const [feedForm, setFeedForm] = useState({ batchId: activeBatches[0]?.id ?? '', tonnes: '', date: todayISO() });
  const feedBatch = activeBatches.find(b => b.id === feedForm.batchId);
  const formula = formulaForDate(feedBatch?.shedId ?? '', feedForm.date, data.feedFormulas);
  const feedTonnes = parseFloat(feedForm.tonnes) || 0;
  const deduction = formula && feedTonnes > 0 ? formulaDeduction(formula, feedTonnes) : [];

  function submitFeed() {
    if (!feedBatch) return pushToast('error', 'Select a live batch');
    if (!(feedTonnes > 0)) return pushToast('error', 'Enter tonnes above 0');
    const r = addFeedConsumption({
      batchId: feedBatch.id, shedId: feedBatch.shedId,
      date: feedForm.date, tonnes: feedTonnes,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', `${feedTonnes} t fed · godown deducted`);
    setFeedOpen(false);
    setFeedForm({ batchId: feedForm.batchId, tonnes: '', date: todayISO() });
  }

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

  /* ---------------- add stock entry: derived state for the live valuation preview ---------------- */

  const isOutgoing = form.kind === 'FEED_OUT' || form.kind === 'CONSUMPTION' || form.kind === 'SHORTAGE';
  const needsRate = form.kind === 'FEED_IN' || form.kind === 'OPENING';
  /** A purchase is a payable: it names a supplier, and its value is quantity × rate — never typed. */
  const isPurchase = form.kind === 'FEED_IN';
  const qtyEntered = parseFloat(form.qtyKg);
  const rateEntered = parseFloat(form.ratePerKg);
  const hasQty = Number.isFinite(qtyEntered) && qtyEntered !== 0;
  const hasRate = Number.isFinite(rateEntered) && rateEntered > 0;
  const receiving = !isOutgoing && qtyEntered > 0;
  const purchaseValue = isPurchase && qtyEntered > 0 && hasRate ? qtyEntered * rateEntered : null;

  const position = valuation.now(form.ingredient);
  const preview = receiving && hasQty && hasRate ? {
    stockKg: position.kg,
    stockAvg: position.avg,
    afterKg: position.kg + qtyEntered,
    afterValue: position.value + qtyEntered * rateEntered,
    newAvg: blendPrice(position.valuedKg, position.avg, qtyEntered, rateEntered),
    unpricedKg: Math.max(0, position.kg - position.valuedKg),
  } : null;
  const rateError = form.ratePerKg.trim() !== '' && !hasRate ? 'Enter a rate above ₹0, or leave it empty'
    : needsRate && hasQty && !hasRate ? 'Receipt rate needed — the godown average is built from it'
      : undefined;

  function submit() {
    const ingredient = form.ingredient.trim();
    if (!ingredient) return pushToast('error', 'Select an ingredient');
    if (!knownIngredients.some(i => i.toLowerCase() === ingredient.toLowerCase())) {
      return pushToast('error', 'This ingredient is not in the list yet — add it as a new ingredient first');
    }
    const qty = parseFloat(form.qtyKg);
    if (!Number.isFinite(qty) || qty === 0) return pushToast('error', 'Enter valid quantity');
    if (form.kind !== 'ADJUSTMENT' && form.kind !== 'SHORTAGE' && qty <= 0) return pushToast('error', 'Quantity must be greater than 0');
    const rate = parseFloat(form.ratePerKg);
    const rated = Number.isFinite(rate) && rate > 0;
    if (!isOutgoing && form.ratePerKg.trim() !== '' && !rated) return pushToast('error', 'Enter a rate above ₹0, or leave it empty');
    if (needsRate && !rated) return pushToast('error', 'Enter the receipt rate per kg — it is what prices this stock');
    if (isPurchase && !form.supplier.trim()) return pushToast('error', 'Record the supplier this stock was bought from');
    const r = addStock({
      ingredient, date: form.date, kind: form.kind,
      qtyKg: qty, ratePerKg: !isOutgoing && rated ? rate : undefined,
      supplier: isPurchase ? form.supplier.trim() : undefined,
      remarks: form.remarks || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', isPurchase && purchaseValue !== null
      ? `Purchase booked · ${fmtMoney(purchaseValue)} payable to ${form.supplier.trim()} — no money has left yet`
      : preview
        ? `Saved · ${ingredient} average is now ${fmtMoney(preview.newAvg, 2)}/kg`
        : form.kind === 'SHORTAGE'
          ? `Shortage booked · ${ingredient} deducted from the godown`
          : 'Stock entry saved');
    setOpen(false);
    setForm(f => ({ ...f, qtyKg: '', ratePerKg: '', remarks: '', supplier: '' }));
  }

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

      <Dialog open={open} onClose={() => setOpen(false)} title="Add Stock Entry" subtitle="Central godown movement (KG)"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Ingredient" value={form.ingredient} onChange={e => setForm(f => ({ ...f, ingredient: e.target.value }))}
            options={knownIngredients.map(i => ({ value: i, label: i }))} />
          <p className="text-[12px] text-muted leading-relaxed">
            Chosen from the ingredient master, so the godown, the formulas and the sheds’ feed cost all speak the same name.
          </p>

          <div className="rounded-[14px] border border-line bg-sunk/50 px-3 py-2.5">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted mb-2">Need an ingredient that isn&rsquo;t listed?</p>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <SearchField value={newName} onChange={setNewName} placeholder="New ingredient name" />
              </div>
              <Button variant={trimmedNew && !nameTaken ? 'primary' : 'outline'} className="mt-0.5 shrink-0"
                onClick={registerIngredient} disabled={!trimmedNew || nameTaken}>
                <Plus size={14} /> Add
              </Button>
            </div>
            {nameMatches.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {nameMatches.map(i => (
                  <button key={i} type="button" onClick={() => { setForm(f => ({ ...f, ingredient: i })); setNewName(''); }}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold press bg-card border border-line text-ink-2 hover:border-brand hover:text-brand">
                    {i} — already listed
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-faint mt-2 leading-relaxed">
              Adding here puts the name on the master list for every farm. A stock entry never creates one on its own.
            </p>
          </div>

          <SelectField label="Transaction type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as FeedStockKind }))}
            options={[
              { value: 'FEED_IN', label: 'Feed in (purchase)' },
              { value: 'FEED_OUT', label: 'Feed out (issue)' },
              { value: 'CONSUMPTION', label: 'Consumption (out)' },
              { value: 'SHORTAGE', label: 'Shortage (stock found short)' },
              { value: 'ADJUSTMENT', label: 'Adjustment (signed)' },
              { value: 'OPENING', label: 'Opening stock' },
            ]} />
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          {isPurchase && (
            <>
              <Field label="Supplier" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                placeholder="Who the stock was bought from"
                hint="The payable is tracked against this name — a purchase on credit is owed to somebody" />
              <p className="text-[12px] text-muted leading-relaxed rounded-[12px] bg-sunk px-3 py-2.5">
                Booking this stock does not pay for it. No cash or bank money leaves until Finance records a payment
                against this purchase, and the amount is never re-typed on the stock entry.
              </p>
            </>
          )}
          <Field label={form.kind === 'SHORTAGE' ? 'Quantity found short (kg)'
            : form.kind === 'ADJUSTMENT' ? 'Quantity (kg, use − for shortage)' : 'Quantity (kg)'} type="number" inputMode="decimal" step="0.01" value={form.qtyKg} onChange={e => setForm(f => ({ ...f, qtyKg: e.target.value }))} placeholder="e.g. 5000" className="font-mono" error={hasQty || form.qtyKg === '' ? undefined : 'Enter a quantity in KG'} />
          {form.kind === 'SHORTAGE' && (
            <p className="text-[12px] text-muted leading-relaxed rounded-[12px] bg-sunk px-3 py-2.5">
              Booked as a godown shortage, not as any shed&rsquo;s feed. It leaves at the average in force and is
              shared out by the allocation rule the Finance screen reports under.
            </p>
          )}
          {!isOutgoing && (
            <Field label={needsRate ? 'Receipt rate (₹ per kg)' : 'Rate (₹ per kg, optional)'} type="number" inputMode="decimal" step="0.01" value={form.ratePerKg} onChange={e => setForm(f => ({ ...f, ratePerKg: e.target.value }))} placeholder="e.g. 25.50" className="font-mono"
              error={rateError}
              hint={needsRate ? 'Blends into this ingredient’s godown average' : 'Optional — without it the stock returns at the average in force'} />
          )}
          {isPurchase && (
            <Field label="Purchase value" readOnly value={purchaseValue === null ? '' : fmtMoney(purchaseValue, 2)}
              placeholder="Quantity × receipt rate" className="font-mono"
              hint="Calculated from the quantity and the receipt rate — this is what the supplier is owed, and it is not typed in" />
          )}
          {isOutgoing && (
            <p className="text-[12px] text-muted leading-relaxed rounded-[12px] bg-sunk px-3 py-2.5">
              {position.avg === null
                ? <>The godown has never priced {form.ingredient}, so this outflow is counted in KG without a value.</>
                : <>This leaves at the average in force — <span className="font-mono tnum">{fmtMoney(position.avg, 2)}/kg</span> — and the average itself does not move.</>}
            </p>
          )}

          {preview && (
            <div className="rounded-[14px] border border-brand/25 bg-brand-soft/60 px-3 py-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-brand-ink mb-2">Effect on the godown average</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {[
                  { label: 'Current stock', value: `${fmtIN(preview.stockKg, 2)} kg` },
                  { label: 'Current avg', value: preview.stockAvg === null ? '— not priced yet' : `${fmtMoney(preview.stockAvg, 2)}/kg` },
                  { label: 'After receipt', value: `${fmtIN(preview.afterKg, 2)} kg` },
                  { label: 'New avg', value: `${fmtMoney(preview.newAvg, 2)}/kg`, lead: true },
                ].map(c => (
                  <div key={c.label}>
                    <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">{c.label}</p>
                    <p className={clsx('font-mono tnum text-[13.5px] font-semibold mt-0.5', c.lead ? 'text-brand-ink' : 'text-ink')}>{c.value}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-2 leading-relaxed">
                Stock value goes to {fmtMoney(preview.afterValue)}
                {preview.stockKg === 0 ? ' — with empty shelves, this receipt sets the average.' : ' — the old stock keeps its cost and the new rate blends in.'}
                {preview.unpricedKg > 0 && <> {fmtIN(preview.unpricedKg)} kg on the shelf carry no price and stay outside the average.</>}
              </p>
            </div>
          )}

          <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Supplier, vehicle no, bags..." />
        </div>
      </Dialog>

      <Dialog open={feedOpen} onClose={() => setFeedOpen(false)} title="Feed given in shed" subtitle="Tonnes drawn from the godown through the shed formula"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setFeedOpen(false)}>Cancel</Button><Button block onClick={submitFeed}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Batch / shed" value={feedForm.batchId} onChange={e => setFeedForm(f => ({ ...f, batchId: e.target.value }))}
            options={activeBatches.map(b => ({ value: b.id, label: `${b.code} · ${data.sheds.find(s => s.id === b.shedId)?.name ?? ''}` }))} />
          <Field label="Tonnes given" type="number" inputMode="decimal" step="0.01" value={feedForm.tonnes}
            onChange={e => setFeedForm(f => ({ ...f, tonnes: e.target.value }))} placeholder="e.g. 1.25" className="font-mono" />
          <Field label="Date" type="date" value={feedForm.date} onChange={e => setFeedForm(f => ({ ...f, date: e.target.value }))} />
          {feedBatch && !formula && (
            <p className="text-[12px] text-warn bg-warn-soft rounded-[10px] px-3 py-2">
              This shed has no active formula, so only the consumption entry is recorded — godown stock stays unchanged.
            </p>
          )}
          {deduction.length > 0 && (
            <div className="rounded-[12px] bg-sunk px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">Godown deduction</p>
              <ul className="space-y-1">
                {deduction.map(d => (
                  <li key={d.ingredient} className="flex justify-between text-[13px]">
                    <span className="text-ink-2">{d.ingredient}</span>
                    <span className="font-mono tnum text-ink">{fmtIN(d.kg)} kg</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
    </Page>
  );
}
