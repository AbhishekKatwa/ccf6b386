import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, FlaskConical, AlertTriangle, TrendingDown, Wheat } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, IconTile, GroupList, ListRow, Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, SearchField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtIN, fmtMoney, fmtDate, todayISO } from '@/lib/format';
import { formulaDeduction, formulaForDate, godownBalances } from '@/lib/calc';
import type { FeedIngredient, FeedStockKind } from '@/types';

const INGREDIENTS: FeedIngredient[] = ['Maize', 'Soya DOC', 'DDGS', 'Groundnut DOC', 'DORB', 'Stone', 'MCP', 'DLM', 'Lysine', 'Mixiblend', 'Salt', 'DCP'];

export function FeedStockScreen() {
  const nav = useNavigate();
  const data = useCompanyData();
  const stock = data.feedStock;
  const addStock = useApp(s => s.addFeedStock);
  const addFeedConsumption = useApp(s => s.addFeedConsumption);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('create');
  const canDaily = useCan('createDailyOps');
  const canFinance = useCan('viewFinance');

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    ingredient: 'Maize' as string, date: todayISO(),
    kind: 'FEED_IN' as FeedStockKind,
    qtyKg: '', ratePerKg: '', remarks: '',
  });

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

  /** Derived current stock per ingredient (KG) from the ledger. */
  const current = useMemo(() => godownBalances(stock), [stock]);

  const movements = useMemo(() => {
    const map = new Map<string, { opening: number; feedIn: number; out: number; adjust: number; value: number }>();
    for (const ing of INGREDIENTS) map.set(ing, { opening: 0, feedIn: 0, out: 0, adjust: 0, value: 0 });
    for (const e of stock) {
      const cur = map.get(e.ingredient) ?? { opening: 0, feedIn: 0, out: 0, adjust: 0, value: 0 };
      if (e.kind === 'OPENING') cur.opening += e.qtyKg;
      else if (e.kind === 'FEED_IN') cur.feedIn += e.qtyKg;
      else if (e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION') cur.out += e.qtyKg;
      else cur.adjust += e.qtyKg; // signed
      const sign = e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION' ? -1 : 1;
      cur.value += e.qtyKg * (e.ratePerKg ?? 0) * sign;
      map.set(e.ingredient, cur);
    }
    return map;
  }, [stock]);

  const filtered = useMemo(() => {
    const list = Array.from(movements.entries()).map(([ing, b]) => ({
      ingredient: ing,
      closing: current[ing] ?? 0,
      ...b,
    }));
    if (!q.trim()) return list;
    return list.filter(x => x.ingredient.toLowerCase().includes(q.toLowerCase()));
  }, [movements, current, q]);

  const totalValue = filtered.reduce((s, x) => s + Math.max(0, x.closing) * (x.value / Math.max(1, x.opening + x.feedIn)), 0);
  const lowCount = filtered.filter(x => x.closing > 0 && x.closing < 1000).length;

  function submit() {
    const qty = parseFloat(form.qtyKg);
    const rate = parseFloat(form.ratePerKg) || 0;
    if (isNaN(qty) || qty === 0) return pushToast('error', 'Enter valid quantity');
    if (form.kind !== 'ADJUSTMENT' && qty <= 0) return pushToast('error', 'Quantity must be greater than 0');
    const outgoing = form.kind === 'FEED_OUT' || form.kind === 'CONSUMPTION';
    const r = addStock({
      ingredient: form.ingredient, date: form.date, kind: form.kind,
      qtyKg: qty, ratePerKg: !outgoing && rate > 0 ? rate : undefined,
      remarks: form.remarks || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Stock entry saved');
    setOpen(false);
    setForm({ ingredient: 'Maize', date: todayISO(), kind: 'FEED_IN', qtyKg: '', ratePerKg: '', remarks: '' });
  }

  const recent = [...stock].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  return (
    <Page withNav>
      <Header title="Feed Stock" subtitle="Central godown · KG ledger"
        action={<Button size="sm" variant="accent" icon={<FlaskConical size={14} />} onClick={() => nav('/feed/formulas')}>Formula</Button>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card padded={false}>
          <StatStrip>
            <StatCell><Stat label="In stock" value={String(filtered.filter(x => x.closing > 0).length)} sub={`${INGREDIENTS.length} tracked`} tone="brand" size="sm" /></StatCell>
            <StatCell><Stat label="Stock value" value={canFinance ? fmtMoney(totalValue) : '₹•••••'} sub="At cost" tone="accent" size="sm" /></StatCell>
            <StatCell><Stat label="Low stock" value={String(lowCount)} tone={lowCount > 0 ? 'danger' : 'neutral'} size="sm" /></StatCell>
          </StatStrip>
        </Card>

        <div className="rounded-[22px] bg-brand-soft p-4">
          <p className="text-sm text-brand-ink leading-relaxed">
            <strong>Central inventory.</strong> Stock is managed at godown level in KG. Shed feed consumption deducts ingredients from this shared ledger via per-shed formulas.
          </p>
        </div>

        <SearchField value={q} onChange={setQ} placeholder="Search ingredient" />

        {(canCreate || canDaily) && (
          <div className="grid grid-cols-2 gap-2">
            {canCreate && <Button block icon={<Plus size={15} />} className={canDaily ? '' : 'col-span-2'} onClick={() => setOpen(true)}>Add stock entry</Button>}
            {canDaily && <Button block variant="outline" icon={<Wheat size={15} />} className={canCreate ? '' : 'col-span-2'} onClick={() => setFeedOpen(true)}>Feed given (t)</Button>}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={<Package size={22} />} title="No ingredients found" description="Try a different search." />
        ) : (
          <GroupList>
            {filtered.map(x => {
              const low = x.closing < 1000;
              const critical = x.closing < 500;
              return (
                <ListRow key={x.ingredient}
                  leading={<IconTile tone={critical ? 'danger' : low ? 'accent' : 'brand'}><Package size={18} /></IconTile>}
                  title={x.ingredient}
                  subtitle={<span className="font-mono">Open {fmtIN(x.opening)} · In {fmtIN(x.feedIn)} · Out {fmtIN(x.out)}</span>}
                  trailing={
                    <div className="text-right flex-shrink-0">
                      <p className={`font-display font-bold text-base font-mono tnum ${critical ? 'text-danger' : 'text-ink'}`}>{fmtIN(x.closing)}</p>
                      {low && x.closing > 0
                        ? <Badge tone={critical ? 'danger' : 'accent'} className="mt-1">Low</Badge>
                        : <p className="text-[9px] text-faint uppercase tracking-wider mt-0.5">kg</p>}
                    </div>
                  } />
              );
            })}
          </GroupList>
        )}

        {lowCount > 0 && (
          <div className="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3">
            <AlertTriangle size={16} className="text-warn flex-shrink-0" />
            <p className="text-xs text-warn font-semibold">{lowCount} ingredient{lowCount > 1 ? 's' : ''} below reorder level.</p>
          </div>
        )}

        <div>
          <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">Stock ledger</p>
          {recent.length === 0 ? (
            <EmptyState title="No movements yet" description="Stock entries will appear here." />
          ) : (
            <GroupList>
              {recent.map(e => {
                const out = e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION' || (e.kind === 'ADJUSTMENT' && e.qtyKg < 0);
                return (
                  <ListRow key={e.id}
                    leading={<IconTile tone={out ? 'danger' : 'success'} size={34}>{out ? <TrendingDown size={15} /> : <Plus size={15} />}</IconTile>}
                    title={e.ingredient}
                    subtitle={<span className="font-mono">{fmtDate(e.date)} · {e.kind.replace(/_/g, ' ')}</span>}
                    trailing={
                      <div className="text-right flex-shrink-0">
                        <p className={`font-mono tnum font-bold text-xs ${out ? 'text-danger' : 'text-success'}`}>{out ? '−' : '+'}{fmtIN(Math.abs(e.qtyKg))} kg</p>
                        {canFinance && (e.ratePerKg ?? 0) > 0 && <p className="text-[10px] text-muted font-mono tnum">{fmtMoney(Math.abs(e.qtyKg) * (e.ratePerKg ?? 0))}</p>}
                      </div>
                    } />
                );
              })}
            </GroupList>
          )}
        </div>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add Stock Entry" subtitle="Central godown movement (KG)"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Ingredient" value={form.ingredient} onChange={e => setForm(f => ({ ...f, ingredient: e.target.value }))}
            options={INGREDIENTS.map(i => ({ value: i, label: i }))} />
          <SelectField label="Transaction type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as FeedStockKind }))}
            options={[
              { value: 'FEED_IN', label: 'Feed in (purchase)' },
              { value: 'FEED_OUT', label: 'Feed out (issue)' },
              { value: 'CONSUMPTION', label: 'Consumption (out)' },
              { value: 'ADJUSTMENT', label: 'Adjustment (signed)' },
              { value: 'OPENING', label: 'Opening stock' },
            ]} />
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Field label={form.kind === 'ADJUSTMENT' ? 'Quantity (kg, use − for shortage)' : 'Quantity (kg)'} type="number" inputMode="decimal" step="0.01" value={form.qtyKg} onChange={e => setForm(f => ({ ...f, qtyKg: e.target.value }))} placeholder="e.g. 5000" className="font-mono" />
          {(form.kind === 'OPENING' || form.kind === 'FEED_IN' || form.kind === 'ADJUSTMENT') && (
            <Field label="Rate per kg (₹, optional)" type="number" inputMode="decimal" step="0.01" value={form.ratePerKg} onChange={e => setForm(f => ({ ...f, ratePerKg: e.target.value }))} placeholder="e.g. 25.50" className="font-mono" />
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
