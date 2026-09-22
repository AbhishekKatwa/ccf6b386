import { useMemo, useState } from 'react';
import { FlaskConical, Plus } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, EmptyState, StatStrip, StatCell, Stat, Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtIN, fmtMoney } from '@/lib/format';

export function FeedFormulaScreen() {
  const formulas = useApp(s => s.feedFormulas);
  const addFormula = useApp(s => s.addFeedFormula);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('create');
  const canFinance = useCan('viewFinance');
  const [selected, setSelected] = useState(formulas[0]?.id ?? '');
  const [open, setOpen] = useState(false);

  const formula = formulas.find(f => f.id === selected) ?? formulas[0];

  const stats = useMemo(() => {
    if (!formula) return null;
    const totalWeight = formula.items.reduce((s, i) => s + i.qtyKg, 0);
    const totalCost = formula.items.reduce((s, i) => s + i.qtyKg * i.costPerKg, 0);
    const costPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;
    const costPerBag50 = costPerKg * 50;
    return { totalWeight, totalCost, costPerKg, costPerBag50 };
  }, [formula]);

  function submit() {
    pushToast('info', 'Formula builder coming in next release — use existing formulas as reference');
    setOpen(false);
  }

  return (
    <Page withNav>
      <Header title="Feed Formula" subtitle="Age-specific mixes"
        action={canCreate ? <Button size="sm" variant="accent" icon={<Plus size={14} />} onClick={() => setOpen(true)}>New</Button> : undefined} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        {formulas.length > 0 && (
          <SegmentedTabs value={formula?.id ?? ''} onChange={setSelected} scroll
            options={formulas.map(f => ({ value: f.id, label: f.name }))} />
        )}

        {!formula || !stats ? (
          <EmptyState icon={<FlaskConical size={22} />} title="No formulas" description="Create an age-specific feed formula." />
        ) : (
          <>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-ink">{formula.name}</p>
                  <p className="text-xs text-muted mt-0.5 font-mono">{formula.birdType} · Day {formula.ageFromDays}–{formula.ageToDays}</p>
                </div>
                <Badge tone="brand">{formula.items.length} items</Badge>
              </div>
            </Card>

            <Card padded={false}>
              <StatStrip>
                <StatCell><Stat label="Total weight" value={`${fmtIN(stats.totalWeight)}`} sub="kg" tone="neutral" size="sm" /></StatCell>
                <StatCell><Stat label="Cost / kg" value={canFinance ? fmtMoney(stats.costPerKg, 2) : '₹•••'} tone="brand" size="sm" /></StatCell>
                <StatCell><Stat label="Cost / 50kg" value={canFinance ? fmtMoney(stats.costPerBag50, 2) : '₹•••'} tone="accent" size="sm" /></StatCell>
              </StatStrip>
            </Card>

            <div>
              <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">Ingredients</p>
              <Card padded={false} className="overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-faint font-semibold bg-sunk/60">
                  <span>Item</span><span className="text-right">Qty</span><span className="text-right">₹/kg</span><span className="text-right">Total</span>
                </div>
                <div className="divide-y divide-line-2">
                  {formula.items.map(it => (
                    <div key={it.ingredient} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-2.5 items-center text-xs">
                      <span className="font-semibold text-ink">{it.ingredient}</span>
                      <span className="font-mono tnum text-muted text-right">{fmtIN(it.qtyKg)}</span>
                      <span className="font-mono tnum text-muted text-right">{canFinance ? fmtMoney(it.costPerKg, 2) : '••'}</span>
                      <span className="font-mono tnum font-bold text-brand text-right">{canFinance ? fmtMoney(it.qtyKg * it.costPerKg, 0) : '•••'}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {canFinance && (
              <Card>
                <p className="font-display font-bold text-ink text-sm mb-2">Cost summary</p>
                <Row label="Total formula weight" value={`${fmtIN(stats.totalWeight)} kg`} />
                <Row label="Total formula cost" value={fmtMoney(stats.totalCost, 2)} />
                <Row label="Cost per kg" value={fmtMoney(stats.costPerKg, 2)} />
                <Row label="Cost per 50kg bag" value={fmtMoney(stats.costPerBag50, 2)} />
              </Card>
            )}
          </>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="New Feed Formula" subtitle="Define an age-specific mix"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Create</Button></div>}>
        <div className="space-y-3">
          <Field label="Formula name" placeholder="e.g. Layer — Late Lay (W46+)" />
          <SelectField label="Bird type" value="LAYER" options={[{ value: 'LAYER', label: 'Layer' }, { value: 'BROILER', label: 'Broiler' }]} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age from (days)" type="number" placeholder="316" className="font-mono" />
            <Field label="Age to (days)" type="number" placeholder="500" className="font-mono" />
          </div>
          <p className="text-xs text-muted">Ingredients can be added after creation.</p>
        </div>
      </Dialog>
    </Page>
  );
}
