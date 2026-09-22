import { Lock, Unlock } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Badge, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { fmtDate } from '@/lib/format';

/** §6: locked days stay visible to the shed team; only the Owner can unlock one. */
export function DayLockPanel({ batchId, shedId }: { batchId: string; shedId: string }) {
  const { dayLocks, users } = useCompanyData();
  const unlockDay = useApp(s => s.unlockDay);
  const pushToast = useApp(s => s.pushToast);
  const canUnlock = useCan('unlockDay');

  const locked = dayLocks
    .filter(l => l.shedId === shedId)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (locked.length === 0) return null;

  function unlock(date: string) {
    const r = unlockDay(batchId, shedId, date);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', `${fmtDate(date)} unlocked — corrections are audited`);
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line-2">
        <Lock size={13} className="text-warn" />
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Locked days · {locked.length}
        </p>
      </div>
      {locked.map(l => (
        <div key={l.id} className="flex items-center gap-3 px-4 py-3 border-b border-line-2 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtDate(l.date)}</p>
            <p className="text-[12px] text-muted truncate mt-0.5">
              {l.reason ?? 'No reason given'} · by {users.find(u => u.id === l.lockedBy)?.name ?? 'system'}
            </p>
          </div>
          {canUnlock ? (
            <Button size="sm" variant="outline" icon={<Unlock size={13} />} onClick={() => unlock(l.date)}>Unlock</Button>
          ) : (
            <Badge tone="warn"><Lock size={9} /> Owner unlocks</Badge>
          )}
        </div>
      ))}
    </Card>
  );
}
