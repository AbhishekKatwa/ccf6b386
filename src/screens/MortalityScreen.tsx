import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Skull, Plus, Lock, Pencil } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, GroupList, Badge } from '@/components/ui/Card';
import { Button, Field, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { DayLockPanel } from '@/components/ui/DayLockPanel';
import { BatchClosedNotice } from '@/components/ui/BatchClosedNotice';
import { BarChart, CHART } from '@/components/ui/Charts';
import { fmtIN, fmtPct, fmtDate, fmtDateShort, todayISO } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import type { MortalityEntry } from '@/types';

export function MortalityScreen() {
  const { batchId } = useParams();
  const data = useCompanyData();
  const { batches, mortality, dayLocks } = data;
  const addMortality = useApp(s => s.addMortality);
  const updateMortality = useApp(s => s.updateMortality);
  const lockDay = useApp(s => s.lockDay);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('createDailyOps');
  const canUpdate = useCan('update');
  const canLock = useCan('lockDay');
  const m = useBatchMetrics(batchId);
  const batch = batches.find(b => b.id === batchId);

  const [open, setOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [editing, setEditing] = useState<MortalityEntry | null>(null);
  const [form, setForm] = useState({ date: todayISO(), count: '', remarks: '' });
  const [lockForm, setLockForm] = useState({ date: todayISO(), reason: '' });
  const [editForm, setEditForm] = useState({ count: '', remarks: '' });

  const list = useMemo(
    () => mortality.filter(x => x.batchId === batchId).sort((a, b) => b.date.localeCompare(a.date)),
    [mortality, batchId],
  );

  const chart = useMemo(() => {
    const labels: string[] = [], data: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      labels.push(fmtDateShort(date));
      data.push(mortality.filter(x => x.batchId === batchId && x.date === date).reduce((s, x) => s + x.count, 0));
    }
    return { labels, data };
  }, [mortality, batchId]);

  if (!batch || !m) return <Page><Header title="Mortality" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;

  const isLocked = (d: string) => dayLocks.some(l => l.shedId === batch.shedId && l.date === d);
  const isActive = batch.status === 'ACTIVE';
  const canEdit = (e: MortalityEntry) => canUpdate && isActive && !isLocked(e.date);

  function submit() {
    const c = parseInt(form.count, 10);
    if (!form.date) return pushToast('error', 'Date required');
    if (!c || c <= 0) return pushToast('error', 'Count must be > 0');
    const r = addMortality({ batchId: batch!.id, shedId: batch!.shedId, date: form.date, count: c, remarks: form.remarks || undefined });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Mortality recorded');
    setOpen(false); setForm({ date: todayISO(), count: '', remarks: '' });
  }

  function submitLock() {
    const r = lockDay(batch!.id, batch!.shedId, lockForm.date, lockForm.reason || undefined);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', `Day ${lockForm.date} locked`);
    setLockOpen(false);
  }

  function openEdit(e: MortalityEntry) {
    setEditing(e);
    setEditForm({ count: String(e.count), remarks: e.remarks ?? '' });
  }

  function submitEdit() {
    if (!editing) return;
    const c = parseInt(editForm.count, 10);
    if (!c || c <= 0) return pushToast('error', 'Count must be > 0');
    const r = updateMortality(editing.id, { count: c, remarks: editForm.remarks || undefined });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Entry updated');
    setEditing(null);
  }

  return (
    <Page withNav>
      <Header title="Mortality" subtitle={`${batch.code} · ${m.age.label} · ${m.age.dayLabel}`} />
      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Cumulative" value={fmtIN(m.cumMort)} tone="danger" size="md" /></StatCell>
            <StatCell><Stat label="Mortality %" value={fmtPct(m.mortPct, 2)} sub="of placed" tone="danger" size="md" /></StatCell>
            <StatCell><Stat label="Live birds" value={fmtIN(m.live)} sub={`of ${fmtIN(batch.initialBirds)}`} tone="brand" size="md" /></StatCell>
          </StatStrip>
        </Card>

        <Card>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3">Last 14 days</p>
          <BarChart data={chart.data} labels={chart.labels.filter((_, i) => i % 3 === 0)} color={CHART.danger} height={76} />
        </Card>

        {!isActive && <BatchClosedNotice code={batch.code} />}
        {isActive && <DayLockPanel batchId={batch.id} shedId={batch.shedId} />}

        <div className="flex gap-2">
          {canCreate && isActive && <Button block variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Add entry</Button>}
          {canLock && isActive && <Button block variant="outline" icon={<Lock size={15} />} onClick={() => setLockOpen(true)}>Lock day</Button>}
        </div>

        {list.length === 0 ? (
          <EmptyState icon={<Skull size={22} />} title="No mortality recorded" description="Daily mortality entries will appear here." />
        ) : (
          <GroupList>
            {list.slice(0, 40).map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-10 h-10 rounded-[12px] bg-danger-soft text-danger flex items-center justify-center shrink-0"><Skull size={16} /></span>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtDate(e.date)}</p>
                  <p className="text-[12px] text-muted truncate mt-0.5">{e.remarks ?? 'No remarks'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-[18px] font-semibold text-danger tnum leading-none">{fmtIN(e.count)}</p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    {isLocked(e.date) && <Badge tone="warn"><Lock size={9} /> Locked</Badge>}
                    {!e.synced && <Badge tone="accent">Pending</Badge>}
                  </div>
                </div>
                {canEdit(e) && (
                  <button onClick={() => openEdit(e)} aria-label="Edit entry"
                    className="w-8 h-8 rounded-[10px] bg-sunk text-muted flex items-center justify-center shrink-0 press">
                    <Pencil size={13} />
                  </button>
                )}
              </div>
            ))}
          </GroupList>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add mortality entry" subtitle={batch.code}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" block onClick={submit}>Save entry</Button></div>}>
        <div className="space-y-3">
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            error={isLocked(form.date) ? 'This day is locked' : undefined} />
          <Field label="Number of birds" type="number" inputMode="numeric" value={form.count} onChange={e => setForm(f => ({ ...f, count: e.target.value }))} placeholder="e.g. 6" className="font-mono" />
          <TextArea label="Remarks (optional)" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Cause, symptoms…" />
        </div>
      </Dialog>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit mortality entry" subtitle={editing ? fmtDate(editing.date) : undefined}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setEditing(null)}>Cancel</Button><Button block onClick={submitEdit}>Save changes</Button></div>}>
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">Edits are recorded in the audit log with the previous value.</p>
          <Field label="Number of birds" type="number" inputMode="numeric" value={editForm.count} onChange={e => setEditForm(f => ({ ...f, count: e.target.value }))} className="font-mono" />
          <TextArea label="Remarks" rows={2} value={editForm.remarks} onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>

      <Dialog open={lockOpen} onClose={() => setLockOpen(false)} title="Lock farm day"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setLockOpen(false)}>Cancel</Button><Button block onClick={submitLock}>Lock day</Button></div>}>
        <div className="space-y-3">
          <p className="text-[13px] text-muted leading-relaxed">Once locked, historical entries for this date cannot be edited by normal users. Only the OWNER can unlock a day.</p>
          <Field label="Date" type="date" value={lockForm.date} onChange={e => setLockForm(f => ({ ...f, date: e.target.value }))} />
          <TextArea label="Reason (optional)" rows={2} value={lockForm.reason} onChange={e => setLockForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Month-end close" />
        </div>
      </Dialog>
    </Page>
  );
}
