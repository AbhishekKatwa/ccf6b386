import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Egg, Plus, FileText, Pencil, Lock } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, EmptyState, StatStrip, StatCell, Stat, GroupList, Badge } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { DayLockPanel } from '@/components/ui/DayLockPanel';
import { BatchClosedNotice } from '@/components/ui/BatchClosedNotice';
import { BarsMini, CHART } from '@/components/ui/Charts';
import { fmtIN, fmtDate, todayISO } from '@/lib/format';
import { latestFirst } from '@/lib/order';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import { eggStockByGrade, eggStockTrays } from '@/lib/calc';
import { EGGS_PER_TRAY, EGG_GRADES, EGG_GRADE_LABELS, type EggCollection, type EggGrade } from '@/types';

/** The four grade tray fields, in form order. */
const GRADE_FIELDS: { grade: EggGrade; key: 'good' | 'broken' | 'double' | 'small'; field: 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays' }[] = [
  { grade: 'GOOD', key: 'good', field: 'goodTrays' },
  { grade: 'BROKEN', key: 'broken', field: 'brokenTrays' },
  { grade: 'DOUBLE', key: 'double', field: 'doubleTrays' },
  { grade: 'SMALL', key: 'small', field: 'smallTrays' },
];

type GradeForm = { date: string; remarks: string } & Record<'good' | 'broken' | 'double' | 'small', string>;

const emptyForm = (date = todayISO()): GradeForm => ({ date, good: '', broken: '', double: '', small: '', remarks: '' });

export function EggsScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { batches, eggs, saleEntries, dayLocks } = data;
  const addEggCollection = useApp(s => s.addEggCollection);
  const updateEggCollection = useApp(s => s.updateEggCollection);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('createDailyOps');
  const canUpdate = useCan('update');
  const canReport = useCan('exportReports');
  const m = useBatchMetrics(batchId);
  const batch = batches.find(b => b.id === batchId);

  const [tab, setTab] = useState<'collection' | 'stock' | 'quality'>('collection');
  const [openAdd, setOpenAdd] = useState(false);
  const [editing, setEditing] = useState<EggCollection | null>(null);
  const [form, setForm] = useState<GradeForm>(emptyForm());

  const batchEggs = useMemo(() => latestFirst(eggs.filter(e => e.batchId === batchId)), [eggs, batchId]);

  if (!batch || !m) return <Page><Header title="Eggs" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  if (batch.birdType !== 'LAYER') {
    return <Page><Header title="Eggs" /><div className="px-4 sm:px-0"><EmptyState icon={<Egg size={22} />} title="Not a layer batch" description="Egg tracking is available for layer batches only." /></div></Page>;
  }

  const q = m.todaysEggs;
  const stock = eggStockTrays(batch.shedId, eggs, saleEntries);
  const stockByGrade = eggStockByGrade(batch.shedId, eggs, saleEntries);
  const traysOf = (e: EggCollection) => e.goodTrays + e.brokenTrays + e.doubleTrays + e.smallTrays;
  const isLocked = (d: string) => dayLocks.some(l => l.shedId === batch.shedId && l.date === d);

  function formFrom(e: EggCollection): GradeForm {
    return {
      date: e.date, remarks: e.remarks ?? '',
      good: String(e.goodTrays), broken: String(e.brokenTrays), double: String(e.doubleTrays), small: String(e.smallTrays),
    };
  }

  function collectionPayload() {
    const counts = Object.fromEntries(GRADE_FIELDS.map(g => [g.field, parseInt(form[g.key], 10) || 0])) as
      Pick<EggCollection, 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays'>;
    return { ...counts, date: form.date, remarks: form.remarks || undefined };
  }

  function submitCollection() {
    if (!form.date) return pushToast('error', 'Date is required');
    const p = collectionPayload();
    if (p.goodTrays + p.brokenTrays + p.doubleTrays + p.smallTrays <= 0) return pushToast('error', 'Enter at least one tray count');
    const r = addEggCollection({ batchId: batch!.id, shedId: batch!.shedId, ...p });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Egg collection saved');
    setOpenAdd(false);
    setForm(emptyForm());
  }

  function submitEdit() {
    if (!editing) return;
    const p = collectionPayload();
    if (p.goodTrays + p.brokenTrays + p.doubleTrays + p.smallTrays <= 0) return pushToast('error', 'Enter at least one tray count');
    const r = updateEggCollection(editing.id, p);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Collection updated');
    setEditing(null);
  }

  const gradeInputs = (compact: boolean) => (
    <div className={compact ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
      {GRADE_FIELDS.map(g => (
        <Field key={g.grade} label={`${EGG_GRADE_LABELS[g.grade]} trays`} type="number" inputMode="numeric"
          value={form[g.key]} onChange={e => setForm(f => ({ ...f, [g.key]: e.target.value }))}
          placeholder="0" className="font-mono" />
      ))}
    </div>
  );

  return (
    <Page withNav>
      <Header title="Eggs" subtitle={`${batch.code} · ${m.age.label} · ${m.age.dayLabel}`}
        action={canReport && <Button size="sm" variant="outline" icon={<FileText size={14} />} onClick={() => nav(`/batches/${batch.id}/daily-report`)}>Report</Button>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <SegmentedTabs value={tab} onChange={setTab} options={[
          { value: 'collection', label: 'Collection', icon: <Egg size={13} /> },
          { value: 'stock', label: 'Stock', icon: <FileText size={13} /> },
          { value: 'quality', label: 'Quality' },
        ]} />

        {tab === 'collection' && (
          <>
            <div className="rounded-[22px] bg-brand text-white p-5 shadow-card relative overflow-hidden">
              <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full bg-accent/20 blur-2xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Today&apos;s collection</p>
                  <p className="font-display text-[42px] leading-none font-semibold tnum mt-1.5">{fmtIN(q.total)}</p>
                  <p className="font-mono text-[11px] text-white/60 mt-2 tnum">trays · {fmtDate(m.today)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Egg stock</p>
                  <p className="font-display text-[30px] leading-none font-semibold tnum text-accent-soft mt-1.5">{fmtIN(stock.balance)}</p>
                  <p className="font-mono text-[10px] text-white/55 mt-1">trays in shed</p>
                </div>
              </div>
              <div className="relative grid grid-flow-col auto-cols-fr divide-x divide-white/15 mt-4 -mx-1">
                {EGG_GRADES.map(g => <HeroMini key={g} label={EGG_GRADE_LABELS[g]} value={fmtIN(q.byGrade[g])} />)}
              </div>
            </div>

            <Card padded={false} className="overflow-hidden">
              <StatStrip>
                <StatCell><Stat label="Live birds" value={fmtIN(m.live)} tone="brand" size="md" /></StatCell>
                <StatCell><Stat label="Cum. mortality" value={fmtIN(m.cumMort)} sub={`${(m.mortPct).toFixed(2)}%`} tone="danger" size="md" /></StatCell>
              </StatStrip>
            </Card>

            {batch.status !== 'ACTIVE' && <BatchClosedNotice code={batch.code} />}

            {canCreate && batch.status === 'ACTIVE' && (
              <Button block size="lg" icon={<Plus size={16} />} onClick={() => { setForm(emptyForm()); setOpenAdd(true); }}>Add egg collection</Button>
            )}

            {batch.status === 'ACTIVE' && <DayLockPanel batchId={batch.id} shedId={batch.shedId} />}

            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2 px-0.5">Recent collections</p>
              {batchEggs.length === 0 ? (
                <EmptyState icon={<Egg size={22} />} title="No egg collection recorded" description="Start recording daily egg collection in trays to see trends." />
              ) : (
                <GroupList>
                  {batchEggs.slice(0, 14).map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-9 h-9 rounded-[11px] bg-accent-soft text-accent-ink flex items-center justify-center shrink-0"><Egg size={16} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtDate(e.date)}</p>
                        <p className="text-[12px] text-muted truncate mt-0.5 tnum">
                          {EGG_GRADES.map(g => ({ g, n: e[GRADE_FIELDS.find(x => x.grade === g)!.field] }))
                            .filter(({ n }) => n > 0)
                            .map(({ g, n }) => `${EGG_GRADE_LABELS[g]} ${fmtIN(n)}`).join(' · ') || 'No trays'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display text-[18px] font-semibold text-ink tnum leading-none">{fmtIN(traysOf(e))}</p>
                        <div className="flex items-center justify-end gap-1 mt-1">
                          {isLocked(e.date) && <Badge tone="warn"><Lock size={9} /> Locked</Badge>}
                          {!e.synced && <Badge tone="accent">Pending</Badge>}
                        </div>
                      </div>
                      {canUpdate && !isLocked(e.date) && (
                        <button onClick={() => { setEditing(e); setForm(formFrom(e)); }} aria-label="Edit collection"
                          className="w-8 h-8 rounded-[10px] bg-sunk text-muted flex items-center justify-center shrink-0 press">
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </GroupList>
              )}
            </div>
          </>
        )}

        {tab === 'stock' && (
          <>
            <Card padded={false} className="overflow-hidden">
              <StatStrip>
                <StatCell><Stat label="Collected" value={fmtIN(stock.collected)} sub="trays" tone="brand" size="md" /></StatCell>
                <StatCell><Stat label="Sold" value={fmtIN(stock.dispatched)} sub="via sale entries" tone="neutral" size="md" /></StatCell>
                <StatCell><Stat label="In stock" value={fmtIN(stock.balance)} sub="trays" tone="accent" size="md" /></StatCell>
              </StatStrip>
            </Card>

            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3">Stock by grade (trays)</p>
              <div className="space-y-1">
                {EGG_GRADES.map(g => (
                  <Row key={g} label={EGG_GRADE_LABELS[g]}
                    value={`${fmtIN(stockByGrade[g].collected)} in · ${fmtIN(stockByGrade[g].dispatched)} out · ${fmtIN(stockByGrade[g].balance)} left`} />
                ))}
              </div>
            </Card>

            <div className="rounded-[22px] bg-brand-soft p-4">
              <p className="text-sm text-brand-ink leading-relaxed">
                <strong>Stock is derived, never edited.</strong> Each grade keeps its own pool: collection adds trays, and a <strong>sale entry</strong> deducts them from the shed it took them from. A dispatch log only records what a van carried away &mdash; it never reduces stock, and confirming one changes no quantity either.
              </p>
            </div>

            <Button block variant="outline" icon={<FileText size={15} />} onClick={() => nav('/sales?tab=entries')}>Open sale entries</Button>
          </>
        )}

        {tab === 'quality' && (
          <>
            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3">Egg grades · today (trays)</p>
              <BarsMini color={CHART.brand} items={EGG_GRADES.map(g => ({
                label: EGG_GRADE_LABELS[g],
                value: q.byGrade[g],
                display: `${fmtIN(q.byGrade[g])} · ${(q.total ? (q.byGrade[g] / q.total) * 100 : 0).toFixed(1)}%`,
              }))} />
              <div className="mt-3 pt-3 border-t border-line-2"><Row label="Total collected" value={`${fmtIN(q.total)} trays`} /></div>
            </Card>
            <div className="rounded-[16px] bg-accent-soft px-4 py-3.5">
              <p className="text-[13px] text-accent-ink leading-relaxed">
                <strong className="font-semibold">Quality target:</strong> ≥ 99% good trays. Broken, double and small trays each sell at a separate rate, so keeping them apart protects both the trader ledger and the quality picture.
              </p>
            </div>
          </>
        )}
      </div>

      <Dialog open={openAdd} onClose={() => setOpenAdd(false)} title="Add egg collection" subtitle={`${batch.code} · trays (1 tray = ${EGGS_PER_TRAY} eggs)`}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpenAdd(false)}>Cancel</Button><Button block onClick={submitCollection}>Save</Button></div>}>
        <div className="space-y-3">
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            error={isLocked(form.date) ? 'This day is locked' : undefined} />
          {gradeInputs(false)}
          <Field label="Remarks (optional)" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="e.g. Morning collection" />
        </div>
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit collection" subtitle={editing ? fmtDate(editing.date) : undefined}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setEditing(null)}>Cancel</Button><Button block onClick={submitEdit}>Save changes</Button></div>}>
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">Edits are recorded in the audit log with the previous values.</p>
          {gradeInputs(true)}
          <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>
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
