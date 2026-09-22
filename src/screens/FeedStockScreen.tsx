import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, FlaskConical, AlertTriangle, TrendingDown } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, IconTile, GroupList, ListRow, Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, SearchField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtIN, fmtMoney, fmtDate, todayISO } from '@/lib/format';
import type { FeedIngredient } from '@/types';

const INGREDIENTS: FeedIngredient[] = ['Maize', 'Soya DOC', 'DDGS', 'Groundnut DOC', 'DORB', 'Stone', 'MCP', 'DLM', 'Lysine', 'Mixiblend', 'Salt', 'DCP'];

export function FeedStockScreen() {
  const nav = useNavigate();
  const stock = useApp(s => s.feedStock);
  const addStock = useApp(s => s.addFeedStock);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('create');
  const canFinance = useCan('viewFinance');

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    ingredient: 'Maize' as string, date: todayISO(),
    kind: 'PURCHASE' as 'PURCHASE' | 'CONSUMPTION' | 'ADJUSTMENT' | 'OPENING',
    qtyKg: '', ratePerKg: '', remarks: '',
  });

  const balances = useMemo(() => {
    const map = new Map<string, { opening: number; purchase: number; consumption: number; adjust: number; value: number }>();
    for (const ing of INGREDIENTS) map.set(ing, { opening: 0, purchase: 0, consumption: 0, adjust: 0, value: 0 });
    for (const e of stock) {
      const cur = map.get(e.ingredient) ?? { opening: 0, purchase: 0, consumption: 0, adjust: 0, value: 0 };
      if (e.kind === 'OPENING') cur.opening += e.qtyKg;
      else if (e.kind === 'PURCHASE') cur.purchase += e.qtyKg;
      else if (e.kind === 'CONSUMPTION') cur.consumption += e.qtyKg;
      else cur.adjust += e.qtyKg;
      cur.value += e.qtyKg * e.ratePerKg * (e.kind === 'CONSUMPTION' ? -1 : 1);
      map.set(e.ingredient, cur);
    }
    return map;
  }, [stock]);

  const filtered = useMemo(() => {
    const list = Array.from(balances.entries()).map(([ing, b]) => ({
      ingredient: ing,
      closing: b.opening + b.purchase - b.consumption + b.adjust,
      ...b,
    }));
    if (!q.trim()) return list;
    return list.filter(x => x.ingredient.toLowerCase().includes(q.toLowerCase()));
  }, [balances, q]);

  const totalValue = filtered.reduce((s, x) => s + Math.max(0, x.closing) * (x.value / Math.max(1, x.opening + x.purchase)), 0);
  const lowCount = filtered.filter(x => x.closing > 0 && x.closing < 1000).length;

  function submit() {
    const qty = parseFloat(form.qtyKg);
    const rate = parseFloat(form.ratePerKg) || 0;
    if (!qty || qty <= 0) return pushToast('error', 'Enter valid quantity');
    const r = addStock({
      ingredient: form.ingredient, date: form.date, kind: form.kind,
      qtyKg: qty, ratePerKg: rate, unit: 'KG',
      remarks: form.remarks || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Stock entry saved');
    setOpen(false);
    setForm({ ingredient: 'Maize', date: todayISO(), kind: 'PURCHASE', qtyKg: '', ratePerKg: '', remarks: '' });
  }

  const recent = [...stock].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  return (
    <Page withNav>
      <Header title="Feed Stock" subtitle="Central godown"
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
            <strong>Central inventory.</strong> Stock is managed at godown level. Shed and batch screens record consumption against this shared pool.
          </p>
        </div>

        <SearchField value={q} onChange={setQ} placeholder="Search ingredient" />

        {canCreate && <Button block icon={<Plus size={15} />} onClick={() => setOpen(true)}>Add stock entry</Button>}

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
                  subtitle={<span className="font-mono">Open {fmtIN(x.opening)} · In {fmtIN(x.purchase)} · Out {fmtIN(x.consumption)}</span>}
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
          <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">Recent movements</p>
          {recent.length === 0 ? (
            <EmptyState title="No movements yet" description="Stock entries will appear here." />
          ) : (
            <GroupList>
              {recent.map(e => {
                const out = e.kind === 'CONSUMPTION';
                return (
                  <ListRow key={e.id}
                    leading={<IconTile tone={out ? 'danger' : 'success'} size={34}>{out ? <TrendingDown size={15} /> : <Plus size={15} />}</IconTile>}
                    title={e.ingredient}
                    subtitle={<span className="font-mono">{fmtDate(e.date)} · {e.kind}</span>}
                    trailing={
                      <div className="text-right flex-shrink-0">
                        <p className={`font-mono tnum font-bold text-xs ${out ? 'text-danger' : 'text-success'}`}>{out ? '−' : '+'}{fmtIN(e.qtyKg)} kg</p>
                        {canFinance && e.ratePerKg > 0 && <p className="text-[10px] text-muted font-mono tnum">{fmtMoney(e.qtyKg * e.ratePerKg)}</p>}
                      </div>
                    } />
                );
              })}
            </GroupList>
          )}
        </div>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add Stock Entry" subtitle="Central godown movement"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Ingredient" value={form.ingredient} onChange={e => setForm(f => ({ ...f, ingredient: e.target.value }))}
            options={INGREDIENTS.map(i => ({ value: i, label: i }))} />
          <SelectField label="Transaction type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as typeof form.kind }))}
            options={[
              { value: 'PURCHASE', label: 'Purchase (In)' },
              { value: 'CONSUMPTION', label: 'Consumption (Out)' },
              { value: 'ADJUSTMENT', label: 'Adjustment' },
              { value: 'OPENING', label: 'Opening Stock' },
            ]} />
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Field label="Quantity (kg)" type="number" inputMode="decimal" value={form.qtyKg} onChange={e => setForm(f => ({ ...f, qtyKg: e.target.value }))} placeholder="e.g. 5000" className="font-mono" />
          {form.kind !== 'CONSUMPTION' && (
            <Field label="Rate per kg (₹)" type="number" inputMode="decimal" step="0.01" value={form.ratePerKg} onChange={e => setForm(f => ({ ...f, ratePerKg: e.target.value }))} placeholder="e.g. 25.50" className="font-mono" />
          )}
          <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Supplier, vehicle no..." />
        </div>
      </Dialog>
    </Page>
  );
}
