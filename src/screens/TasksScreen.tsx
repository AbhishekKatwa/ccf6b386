import { useMemo, useState } from 'react';
import { ClipboardList, Plus, CheckCircle2, Clock, XCircle, AlertCircle, Trash2 } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, StatusBadge, Badge, type Tone } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, SegmentedTabs } from '@/components/ui/Form';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { fmtDate, todayISO } from '@/lib/format';
import type { FarmTask, TaskPriority, TaskStatus } from '@/types';

const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const priorityTone: Record<TaskPriority, Tone> = {
  LOW: 'neutral', MEDIUM: 'brand', HIGH: 'accent', URGENT: 'danger',
};

export function TasksScreen() {
  const tasks = useApp(s => s.tasks);
  const users = useApp(s => s.users);
  const batches = useApp(s => s.batches);
  const farms = useApp(s => s.farms);
  const sheds = useApp(s => s.sheds);
  const addTask = useApp(s => s.addTask);
  const updateTask = useApp(s => s.updateTask);
  const deleteTask = useApp(s => s.deleteTask);
  const pushToast = useApp(s => s.pushToast);
  const canCreate = useCan('create');
  const canDelete = useCan('delete');

  const [filter, setFilter] = useState<'today' | 'pending' | 'all' | 'completed'>('today');
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', date: todayISO(), time: '', assignedUserId: '',
    farmId: '', shedId: '', batchId: '', priority: 'MEDIUM' as TaskPriority, remarks: '',
  });

  const list = useMemo(() => {
    const today = todayISO();
    let l = [...tasks];
    if (filter === 'today') l = l.filter(t => t.date === today);
    else if (filter === 'pending') l = l.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
    else if (filter === 'completed') l = l.filter(t => t.status === 'COMPLETED');
    return l.sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')));
  }, [tasks, filter]);

  const counts = useMemo(() => ({
    pending: tasks.filter(t => t.status === 'PENDING').length,
    inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
    completed: tasks.filter(t => t.status === 'COMPLETED').length,
    overdue: tasks.filter(t => t.date < todayISO() && (t.status === 'PENDING' || t.status === 'IN_PROGRESS')).length,
  }), [tasks]);

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

  function cycleStatus(t: FarmTask) {
    const order: TaskStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];
    const next = order[(order.indexOf(t.status) + 1) % order.length];
    updateTask(t.id, { status: next });
    pushToast('info', `Marked ${next.replace('_', ' ').toLowerCase()}`);
  }

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Operations" title="Daily Tasks" subtitle={`${list.length} shown`}
        action={canCreate ? <Button size="sm" variant="accent" icon={<Plus size={14} />} onClick={() => setOpen(true)}>New</Button> : undefined} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card padded={false}>
          <StatStrip>
            <StatCell><Stat label="Pending" value={String(counts.pending)} tone="brand" size="sm" /></StatCell>
            <StatCell><Stat label="Active" value={String(counts.inProgress)} tone="accent" size="sm" /></StatCell>
            <StatCell><Stat label="Done" value={String(counts.completed)} tone="success" size="sm" /></StatCell>
            <StatCell><Stat label="Overdue" value={String(counts.overdue)} tone={counts.overdue > 0 ? 'danger' : 'neutral'} size="sm" /></StatCell>
          </StatStrip>
        </Card>

        <SegmentedTabs value={filter} onChange={v => setFilter(v as typeof filter)} scroll
          options={[{ value: 'today', label: 'Today' }, { value: 'pending', label: 'Pending' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }]} />

        {list.length === 0 ? (
          <EmptyState icon={<ClipboardList size={22} />} title="No tasks"
            description={filter === 'today' ? 'Nothing scheduled for today.' : 'Create a task to get started.'}
            action={canCreate ? <Button onClick={() => setOpen(true)} icon={<Plus size={14} />}>New task</Button> : undefined} />
        ) : (
          <div className="space-y-2.5">
            {list.map(t => {
              const user = users.find(u => u.id === t.assignedUserId);
              const batch = batches.find(b => b.id === t.batchId);
              const farm = farms.find(f => f.id === t.farmId);
              const shed = sheds.find(s => s.id === t.shedId);
              const overdue = t.date < todayISO() && (t.status === 'PENDING' || t.status === 'IN_PROGRESS');
              const done = t.status === 'COMPLETED';
              return (
                <Card key={t.id} className={done ? 'opacity-70' : undefined}>
                  <div className="flex items-start gap-3">
                    <button onClick={() => cycleStatus(t)} aria-label="Cycle status"
                      className={`press w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        t.status === 'COMPLETED' ? 'bg-success-soft text-success' :
                        t.status === 'IN_PROGRESS' ? 'bg-accent-soft text-accent-ink' :
                        t.status === 'SKIPPED' ? 'bg-sunk text-muted' : 'bg-brand-soft text-brand'
                      }`}>
                      {t.status === 'COMPLETED' ? <CheckCircle2 size={20} /> :
                       t.status === 'IN_PROGRESS' ? <Clock size={20} /> :
                       t.status === 'SKIPPED' ? <XCircle size={20} /> : <AlertCircle size={20} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`font-display font-bold text-sm leading-tight ${done ? 'text-muted line-through' : 'text-ink'}`}>
                          {t.title}
                        </p>
                        <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
                      </div>
                      <p className="text-[11px] text-muted mt-1 font-mono">
                        {fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}
                        {overdue && <span className="text-danger font-bold ml-1">· OVERDUE</span>}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {user && <Badge tone="neutral">{user.name}</Badge>}
                        {batch && <Badge tone="brand">{batch.code}</Badge>}
                        {farm && <Badge tone="neutral">{farm.name}</Badge>}
                        {shed && <Badge tone="neutral">{shed.name}</Badge>}
                        {!t.synced && <Badge tone="accent">Pending sync</Badge>}
                      </div>
                      {t.remarks && <p className="text-xs text-muted mt-2 italic">“{t.remarks}”</p>}
                      <div className="flex items-center gap-3 mt-2.5">
                        <StatusBadge status={t.status} />
                        {canDelete && (
                          <button onClick={() => setToDelete(t.id)} aria-label="Delete task"
                            className="press ml-auto flex items-center gap-1 text-[11px] font-bold text-danger">
                            <Trash2 size={13} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="New Task" subtitle="Schedule farm work"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Create</Button></div>}>
        <div className="space-y-3">
          <Field label="Task title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Morning feed — Gld1" />
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
            options={[{ value: '', label: '— None —' }, ...batches.filter(b => b.status === 'LIVE').map(b => ({ value: b.id, label: b.code }))]} />
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
