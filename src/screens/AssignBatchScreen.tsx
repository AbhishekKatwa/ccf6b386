import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Search, CheckCircle2, Phone, Check } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Avatar, Row, EmptyState } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, Toggle } from '@/components/ui/Form';
import { ROLE_LABELS, type Role } from '@/types';

const ROLES: Role[] = ['OWNER', 'FARMER', 'FARM_MANAGER', 'FARM_SUPERVISOR', 'FARM_EMPLOYEE', 'COMPANY_MANAGER', 'COMPANY_SUPERVISOR', 'FINANCER', 'OTHER'];

export function AssignBatchScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const users = useApp(s => s.users);
  const batches = useApp(s => s.batches);
  const assignUser = useApp(s => s.assignUser);
  const pushToast = useApp(s => s.pushToast);
  const canManage = useCan('manageUsers');

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mobile, setMobile] = useState('');
  const [found, setFound] = useState<typeof users[0] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [perms, setPerms] = useState({ create: true, update: false, delete: false });
  const [role, setRole] = useState<Role>('FARM_EMPLOYEE');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const batch = batches.find(b => b.id === batchId);

  if (!canManage) {
    return (
      <Page withNav>
        <Header title="Assign batch" />
        <div className="px-4 sm:px-0 mt-4">
          <Card className="bg-danger-soft border-danger/20">
            <p className="font-display text-[15px] font-semibold text-danger">Permission denied</p>
            <p className="text-[13px] text-danger/80 mt-1">Only the OWNER and Company Manager can grant batch access.</p>
          </Card>
        </div>
      </Page>
    );
  }

  function search() {
    setSearchError(null);
    const m = mobile.replace(/\D/g, '');
    if (m.length !== 10) { setSearchError('Enter a valid 10-digit mobile number'); setFound(null); return; }
    const u = users.find(x => x.mobile === m);
    if (!u) { setSearchError(`No user found for ${m}`); setFound(null); return; }
    setFound(u);
  }

  function submit() {
    if (!batch || !found) return;
    setSubmitting(true);
    setTimeout(() => {
      const r = assignUser({ batchId: batch.id, mobile, role, perms, comments: comments.trim() || undefined });
      setSubmitting(false);
      if (!r.ok) { pushToast('error', r.error ?? 'Failed'); return; }
      pushToast('success', `Access granted to ${found.name}`);
      nav(`/batches/${batch.id}/users`, { replace: true });
    }, 400);
  }

  const steps = ['Find user', 'Permissions', 'Confirm'];

  return (
    <Page withNav>
      <Header title="Assign batch" subtitle={batch?.code} />

      {/* stepper */}
      <div className="flex items-center px-4 sm:px-0 mt-4 mb-5">
        {steps.map((s, i) => {
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
              {i < 2 && <div className={clsx('flex-1 h-0.5 mb-5 mx-2 rounded-full transition-colors', done ? 'bg-success' : 'bg-line')} />}
            </div>
          );
        })}
      </div>

      <div className="px-4 sm:px-0 space-y-4">
        {step === 1 && (
          <>
            <Card>
              <Field
                label="Mobile number"
                type="tel" inputMode="numeric" maxLength={10}
                value={mobile}
                onChange={e => { setMobile(e.target.value.replace(/\D/g, '')); setFound(null); setSearchError(null); }}
                prefix={<Phone size={14} />}
                placeholder="10-digit number"
                className="font-mono"
                error={searchError ?? undefined}
              />
              <Button block className="mt-3" onClick={search} icon={<Search size={15} />}>Search user</Button>
            </Card>

            {found && (
              <Card className="bg-success-soft border-success/25">
                <div className="flex items-center gap-3">
                  <Avatar name={found.name} initials={found.initials} size={44} tone="success" />
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-[15px] font-semibold text-ink truncate">{found.name}</p>
                    <p className="font-mono text-[12px] text-success tnum mt-0.5">{found.mobile}</p>
                    <p className="font-mono text-[10px] text-muted mt-0.5 uppercase tracking-wide">{ROLE_LABELS[found.role]}</p>
                  </div>
                  <CheckCircle2 size={20} className="text-success shrink-0" />
                </div>
              </Card>
            )}

            {found
              ? <Button block size="lg" onClick={() => setStep(2)}>Continue</Button>
              : !searchError && <EmptyState icon={<Search size={22} />} title="Find a user" description="Search by the 10-digit mobile number registered with Amrut Poultry." />}
          </>
        )}

        {step === 2 && found && (
          <>
            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-1">Permissions</p>
              <div className="space-y-0.5">
                <Toggle checked={perms.create} onChange={v => setPerms(p => ({ ...p, create: v }))} label="Create" description="Add new records (eggs, feed, mortality)" />
                <Toggle checked={perms.update} onChange={v => setPerms(p => ({ ...p, update: v }))} label="Update" description="Edit existing entries" />
                <Toggle checked={perms.delete} onChange={v => setPerms(p => ({ ...p, delete: v }))} label="Delete" description="Remove records (dangerous)" />
              </div>
            </Card>

            <Card>
              <SelectField label="User role" value={role} onChange={e => setRole(e.target.value as Role)}
                options={ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] }))} />
              <p className="text-[12px] text-muted mt-2 leading-relaxed">
                Role sets default permissions. Financial visibility stays restricted for operational roles (Farm Manager, Supervisor, Employee) unless explicitly granted.
              </p>
            </Card>

            <Card>
              <TextArea label="Comments (optional)" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Reason for access, scope, duration…" />
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button block className="flex-1" onClick={() => {
                if (!perms.create && !perms.update && !perms.delete) { pushToast('error', 'Select at least one permission'); return; }
                setStep(3);
              }}>Review</Button>
            </div>
          </>
        )}

        {step === 3 && found && (
          <>
            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-1">Review access grant</p>
              <Row label="Batch" value={batch?.code ?? '—'} mono={false} />
              <Row label="User" value={found.name} mono={false} />
              <Row label="Mobile" value={`+91 ${found.mobile}`} />
              <Row label="Role" value={ROLE_LABELS[role]} mono={false} />
              <Row label="Permissions" value={[perms.create && 'Create', perms.update && 'Update', perms.delete && 'Delete'].filter(Boolean).join(', ') || 'None'} mono={false} />
              {comments && <div className="bg-sunk rounded-[12px] p-3 mt-3"><p className="text-[12px] text-muted leading-relaxed">Notes: {comments}</p></div>}
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button variant="success" block className="flex-1" loading={submitting} onClick={submit} icon={<CheckCircle2 size={16} />}>
                Grant access
              </Button>
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
