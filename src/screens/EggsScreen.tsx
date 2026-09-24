import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Egg, Plus, FileText, Pencil, Trash2, HandCoins } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, EmptyState, StatStrip, StatCell, Stat, GroupList, Badge } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { BatchClosedNotice } from '@/components/ui/BatchClosedNotice';
import { BarsMini, CHART } from '@/components/ui/Charts';
import { fmtIN, fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { latestFirst } from '@/lib/order';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import { eggStockByGrade, eggStockTrays, gradeTotal, summarizeWastage } from '@/lib/calc';
import {
  EGGS_PER_TRAY, EGG_GRADES, EGG_GRADE_LABELS, EGG_WASTAGE_REASONS,
  type EggCollection, type EggGrade, type EggWastage,
} from '@/types';

/** The four grade tray fields, in form order. */
const GRADE_FIELDS: { grade: EggGrade; key: 'good' | 'broken' | 'double' | 'small'; field: 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays' }[] = [
  { grade: 'GOOD', key: 'good', field: 'goodTrays' },
  { grade: 'BROKEN', key: 'broken', field: 'brokenTrays' },
  { grade: 'DOUBLE', key: 'double', field: 'doubleTrays' },
  { grade: 'SMALL', key: 'small', field: 'smallTrays' },
];

type GradeForm = { date: string; remarks: string } & Record<'good' | 'broken' | 'double' | 'small', string>;

const emptyForm = (date = todayISO()): GradeForm => ({ date, good: '', broken: '', double: '', small: '', remarks: '' });

/** Why the trays went out, and how many of each grade. Money is never part of this. */
type WasteForm = GradeForm & { reason: string };

const emptyWaste = (date = todayISO()): WasteForm => ({ ...emptyForm(date), reason: EGG_WASTAGE_REASONS[0] });

export function EggsScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { batches, eggs, saleEntries, eggWastages } = data;
  const addEggCollection = useApp(s => s.addEggCollection);
  const updateEggCollection = useApp(s => s.updateEggCollection);
  const addEggWastage = useApp(s => s.addEggWastage);
  const updateEggWastage = useApp(s => s.updateEggWastage);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('createDailyOps');
  const canUpdate = useCan('update');
  const canReport = useCan('exportReports');
  /** Only accounts may turn a damaged grade into a billed load. */
  const canEntry = useCan('createSaleEntries');
  const m = useBatchMetrics(batchId);
  const batch = batches.find(b => b.id === batchId);

  const [tab, setTab] = useState<'collection' | 'stock' | 'wastage' | 'quality'>('collection');
  const [openAdd, setOpenAdd] = useState(false);
  const [editing, setEditing] = useState<EggCollection | null>(null);
  const [form, setForm] = useState<GradeForm>(emptyForm());
  /** The wastage sheet: open on a new record, or holding the record being corrected. */
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wasteEditing, setWasteEditing] = useState<EggWastage | null>(null);
  const [waste, setWaste] = useState<WasteForm>(emptyWaste());
  const [wasteError, setWasteError] = useState<string | null>(null);

  const batchEggs = useMemo(() => latestFirst(eggs.filter(e => e.batchId === batchId)), [eggs, batchId]);

  if (!batch || !m) return <Page><Header title="Eggs" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  if (batch.birdType !== 'LAYER') {
    return <Page><Header title="Eggs" /><div className="px-4 sm:px-0"><EmptyState icon={<Egg size={22} />} title="Not a layer batch" description="Egg tracking is available for layer batches only." /></div></Page>;
  }

  const q = m.todaysEggs;
  const stock = eggStockTrays(batch.shedId, eggs, saleEntries, eggWastages);
  const stockByGrade = eggStockByGrade(batch.shedId, eggs, saleEntries, eggWastages);
  const shedWastages = latestFirst(eggWastages.filter(w => w.shedId === batch.shedId));
  /** Priced off this shed's own settled rates, so the figure means "what we gave up". */
  const wasteTotals = summarizeWastage(shedWastages, saleEntries.filter(e => e.lines.some(l => l.shedId === batch.shedId)));
  const traysOf = (e: EggCollection) => e.goodTrays + e.brokenTrays + e.doubleTrays + e.smallTrays;

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

  function wasteFrom(w: EggWastage): WasteForm {
    return {
      date: w.date, remarks: w.remarks ?? '', reason: w.reason,
      good: String(w.byGrade.GOOD || ''), broken: String(w.byGrade.BROKEN || ''),
      double: String(w.byGrade.DOUBLE || ''), small: String(w.byGrade.SMALL || ''),
    };
  }

  function wastePayload() {
    return {
      batchId: batch!.id, shedId: batch!.shedId, date: waste.date,
      reason: waste.reason.trim(),
      byGrade: Object.fromEntries(GRADE_FIELDS.map(g => [g.grade, parseInt(waste[g.key], 10) || 0])) as
        Record<EggGrade, number>,
      remarks: waste.remarks.trim() || undefined,
    };
  }

  /** Saved straight from the batch: the store still owns the stock checks. */
  function submitWaste() {
    setWasteError(null);
    const draft = wastePayload();
    if (gradeTotal(draft.byGrade) <= 0) { setWasteError('Enter at least one tray that went to waste'); return; }
    const r = wasteEditing ? updateEggWastage(wasteEditing.id, draft) : addEggWastage(draft);
    if (!r.ok) { setWasteError(r.error ?? 'Could not save'); return; }
    pushToast('success', wasteEditing ? 'Wastage updated' : 'Wastage recorded');
    setWasteEditing(null);
    setWasteOpen(false);
    setWaste(emptyWaste());
  }

  function openWaste(w?: EggWastage) {
    setWasteError(null);
    setWasteEditing(w ?? null);
    setWaste(w ? wasteFrom(w) : emptyWaste());
    setWasteOpen(true);
  }

  /** The four tray boxes, shared by collection and wastage so both read the same way. */
  const gradeInputs = (f: GradeForm, set: (patch: Partial<GradeForm>) => void, compact: boolean) => (
    <div className={compact ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
      {GRADE_FIELDS.map(g => (
        <Field key={g.grade} label={`${EGG_GRADE_LABELS[g.grade]} trays`} type="number" inputMode="numeric"
          value={f[g.key]} onChange={e => set({ [g.key]: e.target.value } as Partial<GradeForm>)}
          placeholder="0" className="font-mono" />
      ))}
    </div>
  );

  return (
    <Page withNav>
      <Header title="Eggs" subtitle={`${batch.code} · ${m.age.dayLabel}`}
        action={canReport && <Button size="sm" variant="outline" icon={<FileText size={14} />} onClick={() => nav(`/batches/${batch.id}/daily-report`)}>Report</Button>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <SegmentedTabs value={tab} onChange={setTab} scroll options={[
          { value: 'collection', label: 'Collection', icon: <Egg size={13} /> },
          { value: 'stock', label: 'Stock', icon: <FileText size={13} /> },
          { value: 'wastage', label: 'Wastage', icon: <Trash2 size={13} /> },
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
                          {!e.synced && <Badge tone="accent">Pending</Badge>}
                        </div>
                      </div>
                      {canUpdate && (
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
                <StatCell><Stat label="Wasted" value={fmtIN(stock.wasted)} sub="written off" tone="danger" size="md" /></StatCell>
                <StatCell><Stat label="In stock" value={fmtIN(stock.balance)} sub="trays" tone="accent" size="md" /></StatCell>
              </StatStrip>
            </Card>

            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3">Stock by grade (trays)</p>
              <div className="space-y-1">
                {EGG_GRADES.map(g => (
                  <Row key={g} label={EGG_GRADE_LABELS[g]}
                    value={`${fmtIN(stockByGrade[g].collected)} in · ${fmtIN(stockByGrade[g].dispatched)} sold · ${fmtIN(stockByGrade[g].wasted)} wasted · ${fmtIN(stockByGrade[g].balance)} left`} />
                ))}
              </div>
            </Card>

            <div className="rounded-[22px] bg-brand-soft p-4">
              <p className="text-sm text-brand-ink leading-relaxed">
                <strong>Stock is derived, never edited.</strong> Each grade keeps its own pool: collection adds trays, a <strong>sale entry</strong> and a <strong>wastage record</strong> take them away, each from the shed they belong to. A dispatch log only records what a van carried away &mdash; it never reduces stock, and confirming one changes no quantity either.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" icon={<FileText size={15} />} onClick={() => nav('/sales?tab=entries')}>Open sale entries</Button>
              <Button variant="outline" icon={<Trash2 size={15} />} onClick={() => setTab('wastage')}>Record wastage</Button>
            </div>
          </>
        )}

        {tab === 'wastage' && (
          <>
            <div className="rounded-[22px] bg-brand text-white p-5 shadow-card relative overflow-hidden">
              <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full bg-accent/20 blur-2xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Thrown away</p>
                  <p className="font-display text-[42px] leading-none font-semibold tnum mt-1.5">{fmtIN(wasteTotals.trays)}</p>
                  <p className="font-mono text-[11px] text-white/60 mt-2 tnum">trays · {fmtIN(wasteTotals.eggs)} eggs</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Sale value lost</p>
                  <p className="font-display text-[30px] leading-none font-semibold tnum text-accent-soft mt-1.5">
                    {wasteTotals.value ? fmtMoney(wasteTotals.value) : '—'}
                  </p>
                  <p className="font-mono text-[10px] text-white/55 mt-1">at the last rate each grade sold at</p>
                </div>
              </div>
              <div className="relative grid grid-flow-col auto-cols-fr divide-x divide-white/15 mt-4 -mx-1">
                {EGG_GRADES.map(g => <HeroMini key={g} label={EGG_GRADE_LABELS[g]} value={fmtIN(wasteTotals.byGrade[g])} />)}
              </div>
            </div>

            <div className="rounded-[16px] bg-sunk px-4 py-3.5">
              <p className="text-[13px] text-ink-2 leading-relaxed">
                <strong className="font-semibold">No money moves here.</strong> A wastage record takes trays out of the shed and books nothing &mdash; no trader, no finance row, no expense. The feed behind those eggs was already booked the day the shed drew it, so the only honest figure beside the count is the sale value the farm gave up.
              </p>
              {wasteTotals.unpriced.length > 0 && (
                <p className="text-[12px] text-muted mt-2 leading-relaxed">
                  {wasteTotals.unpriced.map(g => EGG_GRADE_LABELS[g]).join(', ')} {wasteTotals.unpriced.length === 1 ? 'has' : 'have'} no sale rate on record yet, so {wasteTotals.unpriced.length === 1 ? 'it is' : 'they are'} counted but not valued.
                </p>
              )}
            </div>

            {batch.status !== 'ACTIVE' && <BatchClosedNotice code={batch.code} />}

            <div className="grid gap-2 sm:grid-cols-2">
              {canCreate && batch.status === 'ACTIVE' && (
                <Button icon={<Plus size={16} />} onClick={() => openWaste()}>Record wastage</Button>
              )}
              {canEntry && stockByGrade.BROKEN.balance > 0 && (
                <Button variant="outline" icon={<HandCoins size={15} />}
                  onClick={() => nav(`/sales?sell=BROKEN&shed=${batch.shedId}`)}>
                  Sell {fmtIN(stockByGrade.BROKEN.balance)} broken trays
                </Button>
              )}
            </div>

            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2 px-0.5">Wastage records</p>
              {shedWastages.length === 0 ? (
                <EmptyState icon={<Trash2 size={22} />} title="Nothing written off yet"
                  description="Record cracked, rotten and rejected trays here — whatever the reason — so the farm knows how many eggs it actually throws away." />
              ) : (
                <GroupList>
                  {shedWastages.map(w => {
                    const trays = gradeTotal(w.byGrade);
                    return (
                      <div key={w.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="w-9 h-9 rounded-[11px] bg-danger-soft text-danger flex items-center justify-center shrink-0"><Trash2 size={15} /></span>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtDate(w.date)}</p>
                          <p className="text-[12px] text-muted truncate mt-0.5">{w.reason}</p>
                          <p className="text-[12px] text-ink-2 truncate mt-0.5 tnum">
                            {EGG_GRADES.filter(g => w.byGrade[g] > 0)
                              .map(g => `${EGG_GRADE_LABELS[g]} ${fmtIN(w.byGrade[g])}`).join(' · ')}
                          </p>
                          {w.remarks && <p className="text-[11px] text-muted-2 truncate mt-0.5">{w.remarks}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-display text-[18px] font-semibold text-ink tnum leading-none">{fmtIN(trays)}</p>
                          <div className="flex items-center justify-end gap-1 mt-1">
                            {!w.synced && <Badge tone="accent">Pending</Badge>}
                          </div>
                        </div>
                        {canUpdate && (
                          <button onClick={() => openWaste(w)} aria-label="Edit wastage"
                            className="w-8 h-8 rounded-[10px] bg-sunk text-muted flex items-center justify-center shrink-0 press">
                            <Pencil size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </GroupList>
              )}
            </div>
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
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          {gradeInputs(form, patch => setForm(f => ({ ...f, ...patch })), false)}
          <Field label="Remarks (optional)" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="e.g. Morning collection" />
        </div>
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit collection" subtitle={editing ? fmtDate(editing.date) : undefined}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setEditing(null)}>Cancel</Button><Button block onClick={submitEdit}>Save changes</Button></div>}>
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">Edits are recorded in the audit log with the previous values.</p>
          {gradeInputs(form, patch => setForm(f => ({ ...f, ...patch })), true)}
          <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>

      <Dialog open={wasteOpen} onClose={() => setWasteOpen(false)}
        title={wasteEditing ? 'Edit wastage' : 'Record wastage'}
        subtitle={`${batch.code} · trays written off (1 tray = ${EGGS_PER_TRAY} eggs)`}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => setWasteOpen(false)}>Cancel</Button>
          <Button variant="danger" block onClick={submitWaste}>{wasteEditing ? 'Save changes' : 'Write off'}</Button>
        </div>}>
        <div className="space-y-3">
          <Field label="Date" type="date" value={waste.date} onChange={e => setWaste(f => ({ ...f, date: e.target.value }))} />
          {gradeInputs(waste, patch => setWaste(f => ({ ...f, ...patch })), false)}
          <SelectField label="Why" value={waste.reason}
            onChange={e => setWaste(f => ({ ...f, reason: e.target.value }))}
            options={EGG_WASTAGE_REASONS.map(r => ({ value: r, label: r }))}
            hint="Every tray left in this shed must have a reason — that is what makes the number readable later." />
          <Field label="Details (optional)" value={waste.remarks} onChange={e => setWaste(f => ({ ...f, remarks: e.target.value }))}
            placeholder="e.g. Cracked while unloading the van" />
          {wasteError && <p className="text-[12px] text-danger font-medium">{wasteError}</p>}
          <p className="text-[12px] text-muted leading-relaxed">
            These trays leave the shed stock and nothing else: no trader is charged, no money is booked.
          </p>
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
