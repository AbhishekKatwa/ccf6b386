import { useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Building2, ChevronRight, Plus } from 'lucide-react';
import { useApp, useCan, useCompanyData, useCurrentUser } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, StatusBadge, EmptyState, IconTile } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtClock, fmtIN, fmtPct, todayISO } from '@/lib/format';
import { eggStockTrays } from '@/lib/calc';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import { VaccinationPlanStep } from '@/components/vaccination/VaccinationPlan';
import { OpeningEntriesStep, blankOpening, toOpeningEntry, type OpeningForm } from '@/components/batch/OpeningEntries';
import { FEED_ROUNDS, FEED_ROUND_LABELS, type BirdType, type VaccinationDraft } from '@/types';

/** A shed with a live flock has no page of its own: the flock's operating view is the shed. */
export function ShedGate() {
  const { shedId } = useParams();
  const batches = useApp(s => s.batches);
  const live = batches.find(b => b.shedId === shedId && b.status === 'ACTIVE');
  if (live) return <Navigate to={`/batches/${live.id}`} replace />;
  return <ShedDetailScreen />;
}

export function ShedDetailScreen() {
  const { shedId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { sheds, farms, batches, eggs, saleEntries, eggWastages, feedRounds } = data;
  const shed = sheds.find(x => x.id === shedId);
  const farm = farms.find(f => f.id === shed?.farmId);
  const live = batches.find(b => b.shedId === shedId && b.status === 'ACTIVE');
  const m = useBatchMetrics(live?.id);
  const user = useCurrentUser();
  const addBatch = useApp(s => s.addBatch);
  const nextBatchCode = useApp(s => s.nextBatchCode);
  const pushToast = useApp(s => s.pushToast);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    birdType: 'LAYER' as BirdType, breed: '', hatchDate: '', placementDate: todayISO(), birds: '',
  });
  /** The plan copied into the new batch at placement; the batch owns these dates from then on. */
  const [schedule, setSchedule] = useState<VaccinationDraft[]>([]);
  /** Money that had already moved before this flock was tracked here. */
  const [opening, setOpening] = useState<OpeningForm[]>([]);

  if (!shed) return <Page><Header title="Shed" /><div className="px-4 sm:px-0"><EmptyState title="Shed not found" /></div></Page>;


  const today = todayISO();
  /** Labor's feed round log for this shed — when the feed actually reached the birds. */
  const rounds = FEED_ROUNDS.map(rd => ({ rd, e: feedRounds.find(r => r.shedId === shed.id && r.date === today && r.round === rd) }));

  const canPlace = !live && (user?.role === 'OWNER' || user?.role === 'FARM_SUPERVISOR');
  // Opening money lands in the Finance ledger, so only a role that may record finance sees the step.
  const canMoney = useCan('viewFinance');

  function resetForm() {
    setForm({ birdType: 'LAYER', breed: '', hatchDate: '', placementDate: todayISO(), birds: '' });
    setSchedule([]);
    setOpening([]);
  }

  function submit() {
    const code = nextBatchCode(shed!.id);
    const r = addBatch({
      farmId: shed!.farmId, shedId: shed!.id, birdType: form.birdType, breed: form.breed,
      hatchDate: form.hatchDate || form.placementDate, placementDate: form.placementDate,
      initialBirds: parseInt(form.birds, 10) || 0,
    }, schedule.length ? schedule : undefined, opening.length ? opening.map(toOpeningEntry) : undefined);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', `Batch ${code} placed in ${shed!.name}`
      + (schedule.length ? ` · ${schedule.length} vaccination${schedule.length === 1 ? '' : 's'} scheduled` : '')
      + (opening.length ? ` · ${opening.length} opening entr${opening.length === 1 ? 'y' : 'ies'} booked` : ''));
    setOpen(false);
    resetForm();
  }

  return (
    <Page withNav>
      <Header title={shed.name} subtitle={farm?.name} />
      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <IconTile tone="brand" size={42}><Building2 size={19} /></IconTile>
            <div className="flex-1 min-w-0">
              <p className="font-display text-[16px] font-semibold text-ink">Shed info</p>
              <p className="font-mono text-[11px] text-muted mt-0.5">{farm?.name ?? '—'}</p>
            </div>
            <StatusBadge status={shed.status} />
          </div>
          <Row label="Capacity" value={`${fmtIN(shed.capacity)} birds`} />
          <Row label="Live batch" value={live?.code ?? 'None'} mono={false} />
        </Card>

        {live && m && (
          <>
            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-1">Current batch · {live.code}</p>
              <Row label="Bird type" value={live.birdType} mono={false} />
              <Row label="Breed" value={live.breed} mono={false} />
              <Row label="Age" value={m.age.dayLabel} />
              <Row label="Live birds" value={fmtIN(m.live)} success />
              <Row label="Cumulative mortality" value={`${fmtIN(m.cumMort)} (${fmtPct(m.mortPct, 2)})`} danger />
              {live.birdType === 'LAYER' && (
                <>
                  <Row label="Today's eggs" value={`${fmtIN(m.todaysEggs.total)} trays`} />
                  <Row label="Egg stock" value={`${fmtIN(eggStockTrays(shed!.id, eggs, saleEntries, eggWastages).balance)} trays`} />
                </>
              )}
              <Row label="Feed (30d)" value={`${fmtIN(m.feed30.tonnes, 2)} t · ${fmtIN(m.feed30.kg)} kg`} />
              {rounds.map(({ rd, e }) => (
                <Row key={rd} label={`Feed given · ${FEED_ROUND_LABELS[rd]}`} mono={false}
                  value={e ? (e.status === 'GIVEN' ? `${fmtClock(e.at)} · ${e.workerName ?? 'labor'}` : 'Skipped') : 'Not logged'} />
              ))}
            </Card>
            <button onClick={() => nav(`/batches/${live.id}`)}
              className="w-full bg-brand text-white rounded-[14px] py-3.5 font-display text-[15px] font-semibold flex items-center justify-center gap-2 press hover:bg-brand-2 shadow-card">
              Open batch detail <ChevronRight size={16} />
            </button>
          </>
        )}

        {!live && !canPlace && (
          <EmptyState icon={<Building2 size={22} />} title="No live batch"
            description="This shed is idle. The Owner or Farm Supervisor can place the next batch." />
        )}

        {canPlace && (
          <>
            <EmptyState icon={<Building2 size={22} />} title="Shed is idle"
              description={`No batch is running in ${shed.name}. The next batch here will be numbered ${nextBatchCode(shed.id)}.`}
              action={<Button icon={<Plus size={15} />} onClick={() => setOpen(true)}>Create batch</Button>} />
            <p className="text-[12px] text-muted leading-relaxed px-1">
              The batch stays linked to this shed. Daily entries start from the placement date.
            </p>
          </>
        )}
      </div>

      {canPlace && (
        <Dialog open={open} onClose={() => setOpen(false)} title="Create batch"
          subtitle={`${farm?.name ?? ''} · ${shed.name} · capacity ${fmtIN(shed.capacity)}`}
          footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Place batch</Button></div>}>
          <div className="space-y-3">
            <SegmentedTabs value={form.birdType} onChange={t => setForm(f => ({ ...f, birdType: t }))}
              options={[{ value: 'LAYER', label: 'Layer' }, { value: 'BROILER', label: 'Broiler' }]} />
            <Field label="Breed" value={form.breed} onChange={e => setForm(f => ({ ...f, breed: e.target.value }))} placeholder="e.g. BV-300" />
            <Field label="Hatch date" type="date" value={form.hatchDate} onChange={e => setForm(f => ({ ...f, hatchDate: e.target.value }))} />
            <Field label="Placement date" type="date" value={form.placementDate} onChange={e => setForm(f => ({ ...f, placementDate: e.target.value }))} />
            <Field label="Birds placed" type="number" inputMode="numeric" value={form.birds}
              onChange={e => setForm(f => ({ ...f, birds: e.target.value }))}
              placeholder={`e.g. ${fmtIN(shed.capacity)}`} className="font-mono" suffix="birds"
              hint={`Shed capacity ${fmtIN(shed.capacity)} · Batch number ${nextBatchCode(shed.id)}`} />
            {canMoney && (
              <OpeningEntriesStep placementDate={form.placementDate} forms={opening} onChange={setOpening} />
            )}
            <VaccinationPlanStep placementDate={form.placementDate} birdType={form.birdType}
              drafts={schedule} onChange={setSchedule} />
          </div>
        </Dialog>
      )}
    </Page>
  );
}
