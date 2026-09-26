import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ShieldCheck, Eye } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, PermissionChip, EmptyState, Avatar, Badge } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import { ROLE_LABELS } from '@/types';

export function BatchUsersScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const { batches, assignments, users } = useCompanyData();
  const revoke = useApp(s => s.revokeAssignment);
  const pushToast = useApp(s => s.pushToast);
  const canManage = useCan('manageUsers');
  const [toRevoke, setToRevoke] = useState<string | null>(null);

  const batch = batches.find(b => b.id === batchId);
  const list = assignments.filter(a => a.batchId === batchId);

  if (!batch) return <Page><Header title="Users" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;

  function confirmRevoke() {
    if (!toRevoke) return;
    revoke(toRevoke);
    pushToast('success', 'Access revoked');
    setToRevoke(null);
  }

  return (
    <Page withNav>
      <Header title="Assigned users" subtitle={batch.code}
        action={canManage ? <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => nav(`/batches/${batch.id}/users/assign`)}>Add</Button> : undefined} />

      <StaggerContainer className="px-4 sm:px-0 mt-3 space-y-3">
        <StaggerItem>
        <Card className="bg-brand-soft border-brand/10">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={16} className="text-brand mt-0.5 shrink-0" />
            <p className="text-[13px] text-brand-ink leading-relaxed">
              Permissions control what each user can do on this batch. Financial data stays hidden from operational roles unless explicitly granted.
            </p>
          </div>
        </Card>
        </StaggerItem>

        <StaggerItem className="space-y-3">
        {list.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={22} />} title="No users assigned"
            description="Grant access to managers, supervisors or employees for this batch."
            action={canManage ? <Button onClick={() => nav(`/batches/${batch.id}/users/assign`)} icon={<Plus size={14} />}>Provide access</Button> : undefined} />
        ) : list.map(a => {
          const u = users.find(x => x.id === a.userId);
          if (!u) return null;
          return (
            <Card key={a.id}>
              <div className="flex items-center gap-3">
                <Avatar name={u.name} initials={u.initials} size={42} />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[15px] font-semibold text-ink truncate">{u.name}</p>
                  <p className="font-mono text-[11px] text-muted tnum mt-0.5">{u.mobile}</p>
                </div>
                <Badge tone="brand">{ROLE_LABELS[a.role]}</Badge>
              </div>
              <div className="flex gap-1.5 flex-wrap mt-3">
                <PermissionChip active={a.permissions.create} label="Create" />
                <PermissionChip active={a.permissions.update} label="Update" />
                <PermissionChip active={a.permissions.delete} label="Delete" />
              </div>
              {a.permissions.viewFinance && (
                <p className="text-[12px] text-success font-semibold mt-2.5 flex items-center gap-1.5"><Eye size={13} /> Finance & rates visible</p>
              )}
              {a.comments && <p className="text-[13px] text-muted mt-2.5 italic leading-relaxed">“{a.comments}”</p>}
              {canManage && (
                <button onClick={() => setToRevoke(a.id)}
                  className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-wide text-danger flex items-center gap-1 press">
                  <Trash2 size={12} /> Revoke access
                </button>
              )}
            </Card>
          );
        })}
        </StaggerItem>

        <StaggerItem>
        {canManage && list.length > 0 && (
          <Button block variant="primary" icon={<Plus size={16} />} onClick={() => nav(`/batches/${batch.id}/users/assign`)}>
            Provide access
          </Button>
        )}
        </StaggerItem>
      </StaggerContainer>

      <ConfirmDialog open={!!toRevoke} title="Revoke access?" danger
        message="This user will immediately lose access to this batch. This action is audited."
        confirmLabel="Revoke" onCancel={() => setToRevoke(null)} onConfirm={confirmRevoke} />
    </Page>
  );
}
