import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, CircleDot, Plus, Syringe, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useCompanyData } from '@/store/app';
import { Card, EmptyState, GroupList, IconTile, ListRow, SectionTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { fmtDate, todayISO } from '@/lib/format';
import { countsSummaryLine, vaccinationDayLabel, type VaccinationPosition } from '@/lib/vaccination';
import { useVaccinationSchedule } from '@/hooks/useVaccinations';
import {
  VaccinationAddSheet, VaccinationCancelSheet, VaccinationCompleteSheet, VaccinationDetailSheet,
  VaccinationEditSheet, VaccinationStateBadge,
} from './VaccinationSheets';

/**
 * This flock's vaccine schedule — the one place it is planned, moved, given or called off.
 * A line stays overdue until somebody records the dose or cancels it; the batch and shed are
 * already known here, so nothing asks for them again. Scheduling moves no stock and no money:
 * only recording the dose draws inventory and charges this batch.
 */

/** ✓ done, ✕ called off, ● due or overdue, ○ still ahead. */
const MARK_TONE: Record<string, string> = {
  brand: 'text-brand', accent: 'text-accent-ink', success: 'text-success',
  danger: 'text-danger', warn: 'text-warn', neutral: 'text-muted-2',
};

function MarkDot({ p }: { p: VaccinationPosition }) {
  const Icon = p.state === 'COMPLETED' ? CheckCircle2
    : p.state === 'CANCELLED' ? XCircle
      : p.state === 'OVERDUE' || p.state === 'DUE_TODAY' ? CircleDot
        : Circle;
  return <Icon size={16} className={clsx('shrink-0', MARK_TONE[p.meta.tone])} />;
}

/** Keeps a row action from also opening the row's own record. */
function RowAction({ children }: { children: ReactNode }) {
  return <span className="shrink-0" onClick={e => e.stopPropagation()}>{children}</span>;
}

export function VaccinationBatchSection({ batchId }: { batchId: string }) {
  const { batches } = useCompanyData();
  const batch = batches.find(b => b.id === batchId);
  const { positions, counts, canManage, canComplete, canAdd } = useVaccinationSchedule(batchId);

  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const byId = (id: string | null) => (id ? positions.find(p => p.item.id === id) ?? null : null);
  const selected = byId(selectedId);
  const completing = byId(completingId);
  const editing = byId(editingId);
  const cancelling = byId(cancellingId);

  /** Still owed, soonest action first; then what the record already holds. */
  const open = useMemo(() => positions.filter(p => p.state !== 'COMPLETED' && p.state !== 'CANCELLED'), [positions]);
  const closed = useMemo(() => positions.filter(p => p.state === 'COMPLETED' || p.state === 'CANCELLED'), [positions]);
  const closedShown = showClosed ? closed : closed.slice(0, 2);

  if (!batch) return null;

  const addButton = canAdd ? (
    <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Schedule vaccine</Button>
  ) : undefined;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line-2">
        <IconTile tone={counts.overdue ? 'danger' : 'brand'} size={34}><Syringe size={16} /></IconTile>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Vaccine schedule</p>
          <p className={clsx('font-mono text-[11px] tnum mt-0.5', counts.overdue ? 'text-danger font-semibold' : 'text-ink-2')}>
            {positions.length ? countsSummaryLine(counts) : 'Nothing planned for this flock yet'}
          </p>
        </div>
        {addButton}
      </div>

      {!positions.length ? (
        <div className="p-4">
          <EmptyState icon={<Syringe size={20} />} title="No doses scheduled"
            description="Plan what this flock is owed and when — reminders start from the day it is scheduled."
            action={canAdd ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Schedule vaccine</Button> : undefined} />
        </div>
      ) : (
        <>
          {open.length ? (
            <GroupList className="border-0 rounded-none shadow-none divide-y divide-line-2">
              {open.map(p => (
                <ListRow key={p.item.id} onClick={() => setSelectedId(p.item.id)} className="px-4"
                  leading={<MarkDot p={p} />}
                  title={p.item.vaccineName}
                  subtitle={
                    <span className={clsx('tnum', p.state === 'OVERDUE' && 'text-danger font-semibold')}>
                      {fmtDate(p.item.scheduledDate)} · {vaccinationDayLabel(p)}
                    </span>
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      <VaccinationStateBadge p={p} />
                      {canComplete(p) && (
                        <RowAction>
                          <Button size="sm" variant="success" onClick={() => setCompletingId(p.item.id)}>Record</Button>
                        </RowAction>
                      )}
                    </div>
                  }
                />
              ))}
            </GroupList>
          ) : (
            <p className="px-4 py-3 text-[12.5px] text-muted leading-relaxed border-b border-line-2">
              Nothing outstanding — every scheduled dose on this flock is recorded or called off.
            </p>
          )}

          {closed.length > 0 && (
            <div className="px-4 pt-3">
              <SectionTitle>Record</SectionTitle>
            </div>
          )}
          {closedShown.length > 0 && (
            <GroupList className="border-0 rounded-none shadow-none divide-y divide-line-2">
              {closedShown.map(p => (
                <ListRow key={p.item.id} onClick={() => setSelectedId(p.item.id)} className="px-4"
                  leading={<MarkDot p={p} />}
                  title={<span className={clsx(p.state === 'CANCELLED' && 'line-through text-muted')}>{p.item.vaccineName}</span>}
                  subtitle={
                    <span className="tnum">
                      {p.state === 'COMPLETED' && p.item.completedDate
                        ? `Given ${fmtDate(p.item.completedDate)} · scheduled ${fmtDate(p.item.scheduledDate)}`
                        : `Scheduled ${fmtDate(p.item.scheduledDate)}`}
                    </span>
                  }
                  trailing={<VaccinationStateBadge p={p} />}
                />
              ))}
            </GroupList>
          )}

          <div className="px-4 py-3 border-t border-line-2 flex flex-wrap items-center gap-2">
            {closed.length > 2 && (
              <Button size="sm" variant="ghost" onClick={() => setShowClosed(s => !s)}>
                {showClosed ? 'Show less' : `${closed.length} recorded / cancelled`}
              </Button>
            )}
            {canAdd && (
              <Button size="sm" variant="outline" className="ml-auto" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
                Schedule vaccine
              </Button>
            )}
          </div>
        </>
      )}

      {adding && (
        <VaccinationAddSheet batchId={batch.id} batchCode={batch.code}
          placementDate={batch.placementDate} defaultDate={todayISO()} onClose={() => setAdding(false)} />
      )}
      {completing && <VaccinationCompleteSheet p={completing} onClose={() => setCompletingId(null)} />}
      {editing && <VaccinationEditSheet p={editing} onClose={() => setEditingId(null)} />}
      {cancelling && <VaccinationCancelSheet p={cancelling} onClose={() => setCancellingId(null)} />}
      {selected && (
        <VaccinationDetailSheet p={selected} canManage={canManage(selected)} canComplete={canComplete(selected)}
          onClose={() => setSelectedId(null)}
          onComplete={() => { setSelectedId(null); setCompletingId(selected.item.id); }}
          onEdit={() => { setSelectedId(null); setEditingId(selected.item.id); }}
          onCancel={() => { setSelectedId(null); setCancellingId(selected.item.id); }} />
      )}
    </Card>
  );
}
