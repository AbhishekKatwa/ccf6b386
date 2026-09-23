import { useMemo, useState } from 'react';
import { Check, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { EmptyState, GroupList } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, SegmentedTabs } from '@/components/ui/Form';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { fmtDate, todayISO } from '@/lib/format';
import type { FarmTask, TaskPriority } from '@/types';

const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const isOpen = (t: FarmTask) => t.status === 'PENDING' || t.status === 'IN_PROGRESS';
const stamp = (t: FarmTask) => t.date + (t.time ?? '');

export function TasksScreen() {
  const { tasks, users, batches, farms, sheds } = useCompanyData();
  const addTask = useApp(s => s.addTask);
  const updateTask = useApp(s => s.updateTask);
  const deleteTask = useApp(s => s.deleteTask);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('createDailyOps');
  const canDelete = useCan('delete');

  const [filter, setFilter] = useState<'today' | 'open' | 'completed' | 'all'>('today');
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', date: todayISO(), time: '', assignedUserId: '',
    farmId: '', shedId: '', batchId: '', priority: 'MEDIUM' as TaskPriority, remarks: '',
  });

  const today = todayISO();

  const list = useMemo(() => {
    let l = [...tasks];
    if (filter === 'today') l = l.filter(t => t.date === today);
    else if (filter === 'open') l = l.filter(isOpen);
    else if (filter === 'completed') l = l.filter(t => t.status === 'COMPLETED');
    // Open first, then soonest-due first; completed sink to the bottom.
    return l.sort((a, b) => (isOpen(a) === isOpen(b) ? stamp(a).localeCompare(stamp(b)) : isOpen(a) ? -1 : 1));
  }, [tasks, filter, today]);

  const summary = useMemo(() => {
    const todays = tasks.filter(t => t.date === today);
    return {
      open: tasks.filter(isOpen).length,
      overdue: tasks.filter(t => isOpen(t) && t.date < today).length,
      doneToday: todays.filter(t => t.status === 'COMPLETED').length,
      totalToday: todays.length,
    };
  }, [tasks, today]);

  function toggleDone(t: FarmTask) {
    updateTask(t.id, { status: t.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED' });
  }

  function submit() {
    if (!form.title.trim()) return pushToast('error', 'Task title required');
    addTask({
      title: form.title.trim(), date: form.date, time: form.time || undefined,
      assignedUserId: form.assignedUserId || undefined,
      farmId: form.farmId || undefined, shedId: form.shedId || undefined,
      batchId: form.batchId || undefined, priority: form.priority,
      status: 'PENDING', remarks: form.remarks || undefined,
    });
    pushToast('success', 'Task created');
    setOpen(false);
    setForm({ title: '', date: todayISO(), time: '', assignedUserId: '', farmId: '', shedId: '', batchId: '', priority: 'MEDIUM', remarks: '' });
  }

  const pct = summary.totalToday > 0 ? Math.round((summary.doneToday / summary.totalToday) * 100) : 0;

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Operations" title="Task manager"
        subtitle={`${summary.open} open${summary.overdue ? ` · ${summary.overdue} overdue` : ''} · today ${summary.doneToday}/${summary.totalToday} done`}
        action={canCreate ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>New</Button> : undefined} />

      <div className="px-4 sm:px-0 mt-2 space-y-4">
        <div aria-hidden className="h-1.5 rounded-full bg-sunk overflow-hidden">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>

        <SegmentedTabs value={filter} onChange={v => setFilter(v as typeof filter)} scroll
          options={[{ value: 'today', label: 'Today' }, { value: 'open', label: 'Open' }, { value: 'completed', label: 'Done' }, { value: 'all', label: 'All' }]} />

        {list.length === 0 ? (
          <EmptyState icon={<ClipboardList size={22} />} title="No tasks here"
            description={filter === 'today' ? 'Nothing scheduled for today.' : filter === 'open' ? 'Everything tracked is complete.' : 'Add a task to start tracking it to completion.'}
            action={canCreate ? <Button onClick={() => setOpen(true)} icon={<Plus size={14} />}>New task</Button> : undefined} />
        ) : (
          <GroupList>
            {list.map(t => {
              const user = users.find(u => u.id === t.assignedUserId);
              const batch = batches.find(b => b.id === t.batchId);
              const shed = sheds.find(s => s.id === t.shedId);
              const farm = farms.find(f => f.id === t.farmId);
              const done = t.status === 'COMPLETED';
              const overdue = isOpen(t) && t.date < today;
              const meta = [
                user?.name,
                batch?.code ?? shed?.name ?? farm?.name,
                filter === 'all' || filter === 'open' ? fmtDate(t.date) : null,
              ].filter(Boolean).join(' · ');
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 group">
                  <button onClick={() => toggleDone(t)} aria-label={done ? 'Mark open' : 'Mark done'}
                    className={clsx(
                      'w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors press',
                      done ? 'bg-success border-success text-white' : 'border-line text-transparent hover:border-brand',
                    )}>
                    <Check size={13} strokeWidth={3} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-[13.5px] font-medium truncate flex items-center gap-1.5', done ? 'text-muted line-through' : 'text-ink')}>
                      {t.priority === 'URGENT' && !done && <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" aria-label="Urgent" />}
                      {t.title}
                    </p>
                    {(meta || t.time) && (
                      <p className={clsx('text-[11px] truncate mt-0.5 font-mono tnum', overdue ? 'text-danger' : 'text-muted')}>
                        {[t.time, meta].filter(Boolean).join(' · ')}{overdue ? ' · overdue' : ''}
                      </p>
                    )}
                  </div>
                  {canDelete && !done && (
                    <button onClick={() => setToDelete(t.id)} aria-label="Delete task"
                      className="press shrink-0 text-muted-2 hover:text-danger p-1 opacity-60 hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </GroupList>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="New task" subtitle="Add work to track to completion"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Create</Button></div>}>
        <div className="space-y-3">
          <Field label="Task title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Dispose dead birds — Gld1" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <Field label="Time" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
          </div>
          <SelectField label="Assign to" value={form.assignedUserId} onChange={e => setForm(f => ({ ...f, assignedUserId: e.target.value }))}
            options={[{ value: '', label: '— Unassigned —' }, ...users.map(u => ({ value: u.id, label: `${u.name} (${u.role.replace('_', ' ')})` }))]} />
          <SelectField label="Farm" value={form.farmId} onChange={e => setForm(f => ({ ...f, farmId: e.target.value, shedId: '', batchId: '' }))}
            options={[{ value: '', label: '— None —' }, ...farms.map(f => ({ value: f.id, label: f.name }))]} />
          {form.farmId && (
            <SelectField label="Shed" value={form.shedId} onChange={e => setForm(f => ({ ...f, shedId: e.target.value }))}
              options={[{ value: '', label: '— None —' }, ...sheds.filter(s => s.farmId === form.farmId).map(s => ({ value: s.id, label: s.name }))]} />
          )}
          <SelectField label="Batch" value={form.batchId} onChange={e => setForm(f => ({ ...f, batchId: e.target.value }))}
            options={[{ value: '', label: '— None —' }, ...batches.filter(b => b.status === 'ACTIVE').map(b => ({ value: b.id, label: b.code }))]} />
          <SelectField label="Priority" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
            options={PRIORITIES.map(p => ({ value: p, label: p }))} />
          <TextArea label="Remarks" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>

      <ConfirmDialog open={!!toDelete} title="Delete task?" danger
        message="This task will be permanently removed."
        confirmLabel="Delete" onCancel={() => setToDelete(null)}
        onConfirm={() => { if (toDelete) { deleteTask(toDelete); pushToast('success', 'Task deleted'); } setToDelete(null); }} />
    </Page>
  );
}
