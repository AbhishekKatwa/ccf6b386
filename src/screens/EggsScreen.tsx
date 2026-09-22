import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Egg, Plus, Truck, FileText, Trash2 } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, EmptyState, StatStrip, StatCell, Stat, GroupList, StatusBadge } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs } from '@/components/ui/Form';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { BarsMini, CHART } from '@/components/ui/Charts';
import { fmtIN, fmtMoney, fmtPct, fmtDate, todayISO } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import { saleTotals } from '@/lib/calc';

export function EggsScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const batches = useApp(s => s.batches);
  const eggs = useApp(s => s.eggs);
  const eggSales = useApp(s => s.eggSales);
  const addEggCollection = useApp(s => s.addEggCollection);
  const deleteEggSale = useApp(s => s.deleteEggSale);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('create');
  const canDelete = useCan('delete');
  const canFinance = useCan('viewFinance');
  const m = useBatchMetrics(batchId);
  const batch = batches.find(b => b.id === batchId);

  const [tab, setTab] = useState<'collection' | 'sales' | 'quality'>('collection');
  const [openAdd, setOpenAdd] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [form, setForm] = useState({ date: todayISO(), good: '', damaged: '', cracked: '', remarks: '' });

  const batchSales = useMemo(() => eggSales.filter(s => s.batchId === batchId).sort((a, b) => b.date.localeCompare(a.date)), [eggSales, batchId]);
  const totals = saleTotals(batchSales);
  const batchEggs = useMemo(() => eggs.filter(e => e.batchId === batchId).sort((a, b) => b.date.localeCompare(a.date)), [eggs, batchId]);

  if (!batch || !m) return <Page><Header title="Eggs" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  if (batch.birdType !== 'LAYER') {
    return <Page><Header title="Eggs" /><div className="px-4 sm:px-0"><EmptyState icon={<Egg size={22} />} title="Not a layer batch" description="Egg tracking is available for layer batches only." /></div></Page>;
  }

  const q = m.todaysEggs;
  const pctOf = (n: number) => q.total ? (n / q.total) * 100 : 0;

  function submitCollection() {
    const g = parseInt(form.good, 10), d = parseInt(form.damaged, 10) || 0, c = parseInt(form.cracked, 10) || 0;
    if (!form.date) return pushToast('error', 'Date is required');
    if (!g || g < 0) return pushToast('error', 'Enter good eggs count');
    const r = addEggCollection({ batchId: batch!.id, date: form.date, good: g, damaged: d, cracked: c, remarks: form.remarks || undefined });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Egg collection saved');
    setOpenAdd(false);
    setForm({ date: todayISO(), good: '', damaged: '', cracked: '', remarks: '' });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const r = deleteEggSale(toDelete);
    if (r.ok) pushToast('success', 'Sale deleted');
    else pushToast('error', r.error ?? 'Failed');
    setToDelete(null);
  }

  return (
    <Page withNav>
      <Header title="Eggs" subtitle={`${batch.code} · ${m.age.label} · ${m.age.dayLabel}`}
        action={<Button size="sm" variant="outline" icon={<FileText size={14} />} onClick={() => nav(`/batches/${batch.id}/daily-report`)}>Report</Button>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <SegmentedTabs value={tab} onChange={setTab} options={[
          { value: 'collection', label: 'Collection', icon: <Egg size={13} /> },
          { value: 'sales', label: 'Sales', icon: <Truck size={13} /> },
          { value: 'quality', label: 'Quality' },
        ]} />

        {tab === 'collection' && (
          <>
            <div className="rounded-[22px] bg-brand text-white p-5 shadow-card relative overflow-hidden">
              <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full bg-accent/20 blur-2xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Today's collection</p>
                  <p className="font-display text-[42px] leading-none font-semibold tnum mt-1.5">{fmtIN(q.total)}</p>
                  <p className="font-mono text-[11px] text-white/60 mt-2 tnum">{fmtDate(m.today)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Production</p>
                  <p className="font-display text-[30px] leading-none font-semibold tnum text-accent-soft mt-1.5">{fmtPct(m.prodPct, 1)}</p>
                </div>
              </div>
              <div className="relative h-1.5 bg-white/20 rounded-full mt-4 overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.min(100, m.prodPct)}%` }} />
              </div>
              <div className="relative grid grid-flow-col auto-cols-fr divide-x divide-white/15 mt-4 -mx-1">
                <HeroMini label="Good" value={fmtIN(q.good)} />
                <HeroMini label="Damaged" value={fmtIN(q.damaged)} />
                <HeroMini label="Cracked" value={fmtIN(q.cracked)} />
              </div>
            </div>

            <Card padded={false} className="overflow-hidden">
              <StatStrip>
                <StatCell><Stat label="Live birds" value={fmtIN(m.live)} tone="brand" size="md" /></StatCell>
                <StatCell><Stat label="Cum. mortality" value={fmtIN(m.cumMort)} sub={fmtPct(m.mortPct, 2)} tone="danger" size="md" /></StatCell>
              </StatStrip>
            </Card>

            {canCreate && (
              <Button block size="lg" variant="accent" icon={<Plus size={16} />} onClick={() => setOpenAdd(true)}>Add egg collection</Button>
            )}

            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2 px-0.5">Recent collections</p>
              {batchEggs.length === 0 ? (
                <EmptyState icon={<Egg size={22} />} title="No egg collection recorded" description="Start recording daily egg collection to see trends." />
              ) : (
                <GroupList>
                  {batchEggs.slice(0, 12).map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-9 h-9 rounded-[11px] bg-accent-soft text-accent-ink flex items-center justify-center shrink-0"><Egg size={16} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtDate(e.date)}</p>
                        <p className="text-[12px] text-muted truncate mt-0.5 tnum">Good {fmtIN(e.good)} · Dmg {fmtIN(e.damaged)} · Crk {fmtIN(e.cracked)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display text-[18px] font-semibold text-ink tnum leading-none">{fmtIN(e.good + e.damaged + e.cracked)}</p>
                        {!e.synced && <span className="font-mono text-[9px] uppercase tracking-wide text-accent-ink">Pending</span>}
                      </div>
                    </div>
                  ))}
                </GroupList>
              )}
            </div>
          </>
        )}

        {tab === 'sales' && (
          <>
            <Card padded={false} className="overflow-hidden">
              <StatStrip>
                <StatCell><Stat label="Total eggs" value={fmtIN(totals.eggs)} tone="brand" size="md" /></StatCell>
                <StatCell><Stat label="Trays" value={fmtIN(totals.trays)} tone="neutral" size="md" /></StatCell>
                <StatCell><Stat label="Revenue" value={canFinance ? fmtMoney(totals.amount) : '₹•••••'} tone="accent" size="md" /></StatCell>
              </StatStrip>
            </Card>

            {canFinance && totals.eggs > 0 && (
              <Card>
                <Row label="Average egg price" value={fmtMoney(totals.avgRate, 2)} />
                <Row label="Tray formula" value="Trays × Rate × 30" mono={false} />
              </Card>
            )}

            {canCreate && (
              <Button block size="lg" variant="accent" icon={<Plus size={16} />} onClick={() => nav(`/batches/${batch.id}/eggs/new-sale`)}>Add egg sale</Button>
            )}

            {batchSales.length === 0 ? (
              <EmptyState icon={<Truck size={22} />} title="No sales yet" description="Record your first egg sale to track revenue and trader outstanding." />
            ) : (
              <div className="space-y-2">
                {batchSales.map(s => (
                  <Card key={s.id}>
                    <div className="flex justify-between items-start gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="font-display text-[15px] font-semibold text-ink truncate">{s.buyerName}</p>
                        <p className="font-mono text-[11px] text-muted mt-0.5 tnum">{fmtDate(s.date)}</p>
                      </div>
                      <StatusBadge status={s.paymentStatus} />
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <SaleStat label="Trays" value={fmtIN(s.trays)} />
                      <SaleStat label="Eggs" value={fmtIN(s.trays * s.eggsPerTray)} />
                      {canFinance && <SaleStat label="Rate" value={fmtMoney(s.ratePerEgg, 2)} />}
                      <div className="ml-auto text-right">
                        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Amount</p>
                        <p className="font-display text-[17px] font-semibold text-accent-ink tnum">{canFinance ? fmtMoney(s.trays * s.eggsPerTray * s.ratePerEgg) : '₹•••••'}</p>
                      </div>
                    </div>
                    {canDelete && (
                      <button onClick={() => setToDelete(s.id)} className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-wide text-danger flex items-center gap-1 press">
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'quality' && (
          <>
            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3">Egg quality · today</p>
              <BarsMini color={CHART.brand} items={[
                { label: 'Good', value: q.good, display: `${fmtIN(q.good)} · ${fmtPct(pctOf(q.good), 1)}` },
                { label: 'Damaged', value: q.damaged, display: `${fmtIN(q.damaged)} · ${fmtPct(pctOf(q.damaged), 1)}` },
                { label: 'Cracked', value: q.cracked, display: `${fmtIN(q.cracked)} · ${fmtPct(pctOf(q.cracked), 1)}` },
              ]} />
              <div className="mt-3 pt-3 border-t border-line-2"><Row label="Total collected" value={fmtIN(q.total)} /></div>
            </Card>
            <div className="rounded-[16px] bg-accent-soft px-4 py-3.5">
              <p className="text-[13px] text-accent-ink leading-relaxed">
                <strong className="font-semibold">Quality target:</strong> ≥ 99% good eggs. Damaged + cracked above 1% points to handling or nutrition issues — review the feed formula and collection timing.
              </p>
            </div>
          </>
        )}
      </div>

      <Dialog open={openAdd} onClose={() => setOpenAdd(false)} title="Add egg collection" subtitle={batch.code}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpenAdd(false)}>Cancel</Button><Button block onClick={submitCollection}>Save</Button></div>}>
        <div className="space-y-3">
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Field label="Good eggs" type="number" inputMode="numeric" value={form.good} onChange={e => setForm(f => ({ ...f, good: e.target.value }))} placeholder="e.g. 30000" className="font-mono" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Damaged" type="number" inputMode="numeric" value={form.damaged} onChange={e => setForm(f => ({ ...f, damaged: e.target.value }))} placeholder="0" className="font-mono" />
            <Field label="Cracked" type="number" inputMode="numeric" value={form.cracked} onChange={e => setForm(f => ({ ...f, cracked: e.target.value }))} placeholder="0" className="font-mono" />
          </div>
          <Field label="Remarks (optional)" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="e.g. Morning collection" />
        </div>
      </Dialog>

      <ConfirmDialog open={!!toDelete} title="Delete sale?" danger
        message="This will remove the sale entry and its linked finance transaction. This action is audited."
        confirmLabel="Delete" onCancel={() => setToDelete(null)} onConfirm={confirmDelete} />
    </Page>
  );
}

function HeroMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 first:pl-1">
      <p className="font-display text-[17px] font-semibold tnum leading-none">{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/55 mt-1.5">{label}</p>
    </div>
  );
}

function SaleStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className="font-display text-[15px] font-semibold text-ink tnum mt-0.5">{value}</p>
    </div>
  );
}
