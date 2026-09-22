import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, Check, ChevronRight, UserPlus } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Avatar, Row, EmptyState, GroupList, ListRow, Badge } from '@/components/ui/Card';
import { Button, Field, SearchField, TextArea, Toggle } from '@/components/ui/Form';
import { ROLE_LABELS, type User } from '@/types';

export function AssignBatchScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { batches, users, assignments } = data;
  const assignUser = useApp(s => s.assignUser);
  const pushToast = useApp(s => s.pushToast);
  const canManage = useCan('manageUsers');

  const [step, setStep] = useState<1 | 2>(1);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<User | null>(null);
  const [perms, setPerms] = useState({ create: true, update: false, delete: false });
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const batch = batches.find(b => b.id === batchId);
  const assignedIds = useMemo(
    () => new Set(assignments.filter(a => a.batchId === batchId).map(a => a.userId)),
    [assignments, batchId],
  );

  const candidates = useMemo(() => {
    const list = users.filter(u => u.active && u.role !== 'MASTER_ADMIN' && !assignedIds.has(u.id));
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter(u => u.name.toLowerCase().includes(s) || u.mobile.includes(s));
  }, [users, assignedIds, q]);

  if (!canManage) {
    return (
      <Page withNav>
        <Header title="Assign batch" />
        <div className="px-4 sm:px-0 mt-4">
          <Card className="bg-danger-soft border-danger/20">
            <p className="font-display text-[15px] font-semibold text-danger">Permission denied</p>
            <p className="text-[13px] text-danger/80 mt-1">Only the OWNER can grant batch access.</p>
          </Card>
        </div>
      </Page>
    );
  }

  if (!batch) {
    return <Page withNav><Header title="Assign batch" /><div className="px-4 sm:px-0 mt-4"><EmptyState title="Batch not found" /></div></Page>;
  }

  function submit() {
    if (!found) return;
    setSubmitting(true);
    setTimeout(() => {
      const r = assignUser({ batchId: batch!.id, userId: found.id, role: found.role, perms, comments: comments.trim() || undefined });
      setSubmitting(false);
      if (!r.ok) { pushToast('error', r.error ?? 'Failed'); return; }
      pushToast('success', `Access granted to ${found.name}`);
      nav(`/batches/${batch!.id}/users`, { replace: true });
    }, 400);
  }

  return (
    <Page withNav>
      <Header title="Assign batch" subtitle={batch.code} />

      {/* stepper */}
      <div className="flex items-center px-4 sm:px-0 mt-4 mb-5">
        {['Select user', 'Confirm access'].map((s, i) => {
          const done = step > i + 1, active = step === i + 1;
          return (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold transition-all border',
                  done ? 'bg-success text-white border-success' : active ? 'bg-brand text-white border-brand' : 'bg-card text-muted-2 border-line',
                )}>
                  {done ? <Check size={15} /> : i + 1}
                </div>
                <p className={clsx('font-mono text-[9px] font-semibold uppercase tracking-wide', active ? 'text-brand' : 'text-muted-2')}>{s}</p>
              </div>
              {i === 0 && <div className={clsx('flex-1 h-0.5 mb-5 mx-2 rounded-full transition-colors', done ? 'bg-success' : 'bg-line')} />}
            </div>
          );
        })}
      </div>

      <div className="px-4 sm:px-0 space-y-4">
        {step === 1 && (
          <>
            <SearchField placeholder="Search by name or mobile" value={q} onChange={setQ} />

            {candidates.length === 0 ? (
              <EmptyState icon={<UserPlus size={22} />} title="No users available"
                description={q ? 'Try a different search.' : 'Every active company user is already assigned to this batch. Create users first.'} />
            ) : (
              <GroupList>
                {candidates.map(u => (
                  <ListRow key={u.id} onClick={() => { setFound(u); setStep(2); }}
                    leading={<Avatar name={u.name} size={38} tone="brand" />}
                    title={u.name}
                    subtitle={<span className="font-mono">+91 {u.mobile}</span>}
                    trailing={
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone="neutral">{ROLE_LABELS[u.role]}</Badge>
                        <ChevronRight size={16} className="text-muted-2" />
                      </div>
                    } />
                ))}
              </GroupList>
            )}
          </>
        )}

        {step === 2 && found && (
          <>
            <Card>
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={found.name} size={44} tone="success" />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[15px] font-semibold text-ink truncate">{found.name}</p>
                  <p className="font-mono text-[12px] text-muted tnum mt-0.5">+91 {found.mobile}</p>
                  <p className="font-mono text-[10px] text-muted mt-0.5 uppercase tracking-wide">{ROLE_LABELS[found.role]}</p>
                </div>
              </div>
              <Row label="Batch" value={batch.code} mono={false} />
            </Card>

            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-1">Extra permissions for this batch</p>
              <div className="space-y-0.5">
                <Toggle checked={perms.create} onChange={v => setPerms(p => ({ ...p, create: v }))} label="Create" description="Add new records (eggs, feed, mortality)" />
                <Toggle checked={perms.update} onChange={v => setPerms(p => ({ ...p, update: v }))} label="Update" description="Edit existing entries" />
                <Toggle checked={perms.delete} onChange={v => setPerms(p => ({ ...p, delete: v }))} label="Delete" description="Remove records (dangerous)" />
              </div>
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                These are additions on top of the role defaults for {ROLE_LABELS[found.role]}. Financial visibility stays restricted for operational roles.
              </p>
            </Card>

            <Card>
              <TextArea label="Comments (optional)" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Reason for access, scope, duration…" />
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button block className="flex-1" loading={submitting} onClick={submit} icon={<CheckCircle2 size={16} />}>
                Grant access
              </Button>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
