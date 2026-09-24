import { useState } from 'react';
import { CheckCircle2, Pencil, Plus, Syringe, Trash2, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp, useCompanyData, useCurrentUser } from '@/store/app';
import { Badge, Card, Row, SectionTitle } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, Toggle } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { ageDaysLabel, daysBetween, fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { fmtScheduled, vaccinationDayLabel, type VaccinationPosition } from '@/lib/vaccination';
import { medicineBasis } from '@/lib/medicines';
import { useMedicineValuation } from '@/hooks/useMedicineValuation';
import { unitQty } from '@/components/medicine/medicineMeta';
import {
  BIRD_OPTIONS, LineFields, REMINDER_OPTIONS, ROUTE_OPTIONS, blankLine, draftOf, fail, lineOf, type LineForm,
} from './ScheduleLineFields';
import type { BirdType, VaccinationTemplate, VaccinationTemplateItem } from '@/types';

/**
 * Every way a schedule line is written: give the dose, plan a line, move a line,
 * call a line off, read the whole record, and the template library the Owner plans from.
 *
 * A scheduled date is a value the Owner moves deliberately — and one the completion sheet
 * only reads back, so a dose given late leaves both days on the record (§8).
 */

export function VaccinationStateBadge({ p }: { p: VaccinationPosition }) {
  return <Badge tone={p.meta.tone}>{p.meta.label}</Badge>;
}

/* ---------------- plan a line ---------------- */

/** Add a vaccination to a batch's own schedule. */
export function VaccinationAddSheet({ batchId, batchCode, placementDate, defaultDate, onClose }: {
  batchId: string; batchCode: string; placementDate: string; defaultDate: string; onClose: () => void;
}) {
  const addVaccination = useApp(s => s.addVaccination);
  const pushToast = useApp(s => s.pushToast);
  const [form, setForm] = useState<LineForm>(blankLine(defaultDate));

  function submit() {
    const draft = draftOf(form);
    const r = addVaccination({ batchId, ...draft });
    if (!r.ok) return pushToast('error', fail(r, 'Could not add this vaccination'));
    pushToast('success', `${draft.vaccineName} added to ${batchCode}`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Add vaccination" subtitle={`${batchCode} · placed ${fmtDate(placementDate)}`}
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit} icon={<Plus size={14} />}>Add to schedule</Button>
      </div>}>
      <LineFields value={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} placementDate={placementDate} />
    </Dialog>
  );
}

/**
 * Change a planned line. Moving the date asks for a reason: the old date, the new one,
 * who moved it and why all stay on the audit trail (§9).
 */
export function VaccinationEditSheet({ p, onClose }: { p: VaccinationPosition; onClose: () => void }) {
  const updateVaccination = useApp(s => s.updateVaccination);
  const pushToast = useApp(s => s.pushToast);
  const [form, setForm] = useState<LineForm>(lineOf(p.item));
  const [reason, setReason] = useState('');
  const moved = form.scheduledDate !== p.item.scheduledDate;

  function submit() {
    const draft = draftOf(form);
    const r = updateVaccination(p.item.id, draft, reason.trim() || undefined);
    if (!r.ok) return pushToast('error', fail(r, 'Could not change this vaccination'));
    pushToast('success', moved ? `${draft.vaccineName} moved to ${fmtDate(draft.scheduledDate)}` : 'Schedule line updated');
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Change vaccination"
      subtitle={`${p.batchCode} · scheduled ${fmtScheduled(p.item)}`}
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit} disabled={moved && !reason.trim()}>Save changes</Button>
      </div>}>
      <LineFields value={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} placementDate={p.batch?.placementDate} />
      {moved && (
        <div className="mt-4 rounded-[14px] bg-warn-soft px-4 py-3">
          <p className="text-[12px] font-semibold text-warn tnum">
            {fmtDate(p.item.scheduledDate)} → {fmtDate(form.scheduledDate)}
          </p>
          <p className="text-[11.5px] text-warn/80 mt-0.5">The original date stays on the record. Say why it moved.</p>
          <div className="mt-2">
            <Field label="Reason" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Vaccine supply arrived late" />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------- give the dose ---------------- */

/**
 * Record that a vaccination was given. The scheduled date is shown, never edited: a dose
 * given late keeps both days and says how late it was (§7, §8).
 */
export function VaccinationCompleteSheet({ p, onClose }: { p: VaccinationPosition; onClose: () => void }) {
  const completeVaccination = useApp(s => s.completeVaccination);
  const pushToast = useApp(s => s.pushToast);
  const user = useCurrentUser();
  const { users } = useCompanyData();
  const { items, entries, valuation } = useMedicineValuation();
  const today = todayISO();

  const [form, setForm] = useState({
    completedDate: today,
    completedBy: user?.name ?? '',
    actualDose: p.item.dose ?? '',
    completionRemarks: '',
  });
  const daysLate = daysBetween(p.item.scheduledDate, form.completedDate);

  // The dose stands behind this line already if a usage carries its id — a second
  // submission must not take another lot off the shelf (§12).
  const alreadyDrawn = entries.some(e => e.vaccinationId === p.item.id);
  const suggested = items.find(i => i.active && i.name.toLowerCase() === p.item.vaccineName.toLowerCase());
  const [draw, setDraw] = useState({ medicineId: suggested?.id ?? '', qty: '' });
  const product = items.find(i => i.id === draw.medicineId) ?? null;
  const shelf = product ? medicineBasis(entries, product.id, form.completedDate) : null;
  const qty = parseFloat(draw.qty);
  const avg = product ? valuation.now(product.id).avg : null;
  const drawGate = !product ? null
    : !(qty > 0) ? `Enter how many ${product.unit} the dose drew`
      : shelf && qty > shelf.stock ? `Only ${unitQty(shelf.stock, product.unit)} on the shelf for ${form.completedDate}`
        : null;
  const charge = product && avg !== null && qty > 0 ? qty * avg : null;

  function submit() {
    const r = completeVaccination(p.item.id, {
      completedDate: form.completedDate,
      completedBy: form.completedBy,
      actualDose: form.actualDose.trim() || undefined,
      completionRemarks: form.completionRemarks.trim() || undefined,
      medicineId: product && !alreadyDrawn ? product.id : undefined,
      medicineQty: product && !alreadyDrawn ? qty : undefined,
    });
    if (!r.ok) return pushToast('error', fail(r, 'Could not record this vaccination'));
    pushToast('success', r.expense
      ? `${p.item.vaccineName} recorded for ${p.batchCode} · ${fmtMoney(r.expense)} drawn from the store`
      : `${p.item.vaccineName} recorded for ${p.batchCode}`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Mark vaccination done"
      subtitle={`${p.batchCode} · ${p.item.vaccineName}`}
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block variant="success" onClick={submit} disabled={!!drawGate} icon={<CheckCircle2 size={15} />}>
          Mark completed
        </Button>
      </div>}>
      <Card className="mb-4">
        <Row label="Batch" value={p.batchCode} mono={false} />
        <Row label="Shed" value={p.shedName} mono={false} />
        <Row label="Vaccine" value={p.item.vaccineName} mono={false} />
        <Row label="Scheduled date" value={fmtDate(p.item.scheduledDate)} />
      </Card>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Completed date" type="date" value={form.completedDate} max={today}
            onChange={e => setForm(f => ({ ...f, completedDate: e.target.value }))} className="font-mono" />
          <SelectField label="Administered by" value={form.completedBy}
            onChange={e => setForm(f => ({ ...f, completedBy: e.target.value }))}
            options={users.filter(u => u.active).map(u => ({ value: u.name, label: u.name }))} />
        </div>
        {daysLate !== 0 && (
          <p className={clsx('text-[12px] font-medium', daysLate > 0 ? 'text-danger' : 'text-success')}>
            {daysLate > 0
              ? `${daysLate} day${daysLate === 1 ? '' : 's'} after the scheduled date — both days will be kept.`
              : `${-daysLate} day${daysLate === -1 ? '' : 's'} ahead of schedule.`}
          </p>
        )}
        <Field label="Actual dose" value={form.actualDose} placeholder={p.item.dose ?? 'e.g. 0.5 ml / bird'}
          onChange={e => setForm(f => ({ ...f, actualDose: e.target.value }))} />

        {alreadyDrawn ? (
          <div className="rounded-[14px] bg-sunk px-3.5 py-3">
            <p className="text-[12px] font-semibold text-ink">Stock already drawn for this dose</p>
            <p className="text-[11.5px] text-muted leading-relaxed mt-1">
              This line is linked to a medicine store usage, so completing it again takes nothing
              further off the shelf. Correct the usage in the store if the quantity is wrong.
            </p>
          </div>
        ) : (
          <div className="rounded-[16px] border border-line bg-card p-3.5 space-y-3">
            <div>
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                Draw from the medicine store
              </p>
              <p className="text-[11.5px] text-muted leading-relaxed mt-1">
                Only giving a dose reduces stock — a scheduled line never does. Name the product here to
                take it off the shelf and charge this flock.
              </p>
            </div>
            <SelectField label="Product" value={draw.medicineId}
              onChange={e => setDraw(d => ({ ...d, medicineId: e.target.value }))}
              options={[
                { value: '', label: 'Not drawn from the store' },
                ...items.filter(i => i.active).map(i => ({
                  value: i.id,
                  label: `${i.name} · ${unitQty(medicineBasis(entries, i.id, form.completedDate).stock, i.unit)}`,
                })),
              ]} />
            {product && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quantity drawn" type="number" min="0" inputMode="decimal" value={draw.qty}
                    onChange={e => setDraw(d => ({ ...d, qty: e.target.value }))}
                    suffix={product.unit} className="font-mono" error={drawGate ?? undefined}
                    hint={shelf ? `${unitQty(shelf.stock, product.unit)} on the shelf that day` : undefined} />
                  <div className="pt-[19px]">
                    <Row label="On shelf after" mono={false}
                      value={shelf && qty > 0 ? unitQty(shelf.stock - qty, product.unit) : '—'} />
                    <Row label="Charged to this flock" mono={false}
                      value={charge != null && product && avg != null
                        ? `${fmtMoney(charge)} at ${fmtMoney(avg, 2)}/${product.unit}`
                        : product && avg === null ? 'No rate on the shelf yet' : '—'} />
                  </div>
                </div>
                <p className="text-[11.5px] text-muted leading-relaxed">
                  The cost is the store average in force on {fmtDate(form.completedDate)}, frozen on the usage
                  row. It lands on {p.shedName} / {p.batchCode} as medicine expense and is not written as a
                  Finance transaction.
                </p>
              </>
            )}
          </div>
        )}
        <TextArea label="Remarks" rows={2} value={form.completionRemarks}
          onChange={e => setForm(f => ({ ...f, completionRemarks: e.target.value }))}
          placeholder="Reactions, birds missed, water batch…" />
      </div>
      <p className="mt-3 text-[11.5px] text-muted leading-relaxed">
        Recording this stops every reminder on the line. The scheduled date is not rewritten.
      </p>
    </Dialog>
  );
}

/* ---------------- call a line off ---------------- */

/** Cancellation keeps the row with its reason and who called it off; nothing deletes history (§10). */
export function VaccinationCancelSheet({ p, onClose }: { p: VaccinationPosition; onClose: () => void }) {
  const cancelVaccination = useApp(s => s.cancelVaccination);
  const pushToast = useApp(s => s.pushToast);
  const [reason, setReason] = useState('');

  function submit() {
    const r = cancelVaccination(p.item.id, reason.trim());
    if (!r.ok) return pushToast('error', fail(r, 'Could not cancel this vaccination'));
    pushToast('success', `${p.item.vaccineName} cancelled`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Cancel vaccination" subtitle={`${p.batchCode} · ${fmtScheduled(p.item)}`}
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Keep it</Button>
        <Button block variant="danger" onClick={submit} disabled={!reason.trim()}>Cancel vaccination</Button>
      </div>}>
      <p className="text-[13px] text-muted leading-relaxed mb-3">
        The line stays on the batch&rsquo;s record with this reason against it. Reminders for it stop.
      </p>
      <Field label="Reason" value={reason} onChange={e => setReason(e.target.value)}
        placeholder="e.g. Flock treated during a veterinary visit" />
    </Dialog>
  );
}

/* ---------------- read one line ---------------- */

export function VaccinationDetailSheet({ p, canManage, canComplete, onComplete, onEdit, onCancel, onOpenBatch, onClose }: {
  p: VaccinationPosition; canManage: boolean; canComplete: boolean;
  onComplete: () => void; onEdit: () => void; onCancel: () => void; onOpenBatch?: () => void; onClose: () => void;
}) {
  const { users } = useCompanyData();
  // "Administered by" is a name as the worker recorded it, "cancelled by" is a user id: read either back.
  const nameOf = (v?: string) => users.find(u => u.id === v || u.name === v)?.name ?? v ?? '—';
  const done = p.state === 'COMPLETED';
  const off = p.state === 'CANCELLED';
  const open = !done && !off;

  return (
    <Dialog open onClose={onClose} title={p.item.vaccineName} subtitle={`${p.batchCode} · ${p.shedName}`}
      footer={<div className="flex gap-2">
        {canComplete && <Button block icon={<CheckCircle2 size={15} />} onClick={onComplete}>Mark done</Button>}
        {canManage && open && <Button variant="outline" block icon={<Pencil size={14} />} onClick={onEdit}>Change</Button>}
        {canManage && open && <Button variant="outline" block icon={<XCircle size={14} />} onClick={onCancel}>Call off</Button>}
      </div>}>
      <div className="flex items-center gap-2 mb-3">
        <VaccinationStateBadge p={p} />
        {open && <span className="font-mono text-[11px] text-muted tnum">{vaccinationDayLabel(p)}</span>}
      </div>
      <Card>
        <Row label="Scheduled" value={fmtDate(p.item.scheduledDate)} />
        <Row label="Flock day" value={ageDaysLabel(p.item.relativeDay)} />
        <Row label="Route" value={p.item.route ?? '—'} mono={false} />
        <Row label="Planned dose" value={p.item.dose ?? '—'} mono={false} />
        <Row label="Remind" value={p.item.reminderDaysBefore === 0 ? 'On the day' : `${p.item.reminderDaysBefore} days before`} mono={false} />
        {p.item.remarks && <Row label="Planned remarks" value={p.item.remarks} mono={false} />}
        {done && <>
          <Row label="Completed" value={p.item.completedDate ? fmtDate(p.item.completedDate) : '—'} success />
          {p.late && <Row label="Given" value={`${daysBetween(p.item.scheduledDate, p.item.completedDate ?? '')} days after schedule`} danger />}
          <Row label="Administered by" value={nameOf(p.item.completedBy)} mono={false} />
          <Row label="Actual dose" value={p.item.actualDose ?? '—'} mono={false} />
          {p.item.completionRemarks && <Row label="Completion remarks" value={p.item.completionRemarks} mono={false} />}
        </>}
        {off && <>
          <Row label="Cancelled on" value={p.item.cancelledAt ? fmtDate(p.item.cancelledAt.slice(0, 10)) : '—'} />
          <Row label="By" value={nameOf(p.item.cancelledBy)} mono={false} />
          <Row label="Reason" value={p.item.cancellationReason ?? '—'} mono={false} />
        </>}
      </Card>
      {/* The batch's own Health tab is already the batch: no way out of it to itself. */}
      {onOpenBatch && (
        <Button className="mt-3" variant="ghost" block size="sm" icon={<Syringe size={14} />} onClick={onOpenBatch}>
          Open {p.batchCode}
        </Button>
      )}
    </Dialog>
  );
}

/* ---------------- templates ---------------- */

type TemplateLine = VaccinationTemplateItem & { key: string };

const templateLine = (n: number, i?: VaccinationTemplateItem): TemplateLine => ({
  relativeDay: i?.relativeDay ?? n * 7, vaccineName: i?.vaccineName ?? '',
  reminderDaysBefore: i?.reminderDaysBefore ?? 3, dose: i?.dose, route: i?.route, remarks: i?.remarks,
  key: `tl_${n}_${Math.random().toString(36).slice(2, 6)}`,
});

/**
 * The template library. A template is copied into a batch at placement and never
 * referenced again, so nothing below can reach a schedule already placed (§11).
 */
export function VaccinationTemplateSheet({ template, onClose }: {
  template: VaccinationTemplate | null; onClose: () => void;
}) {
  const addTemplate = useApp(s => s.addVaccinationTemplate);
  const updateTemplate = useApp(s => s.updateVaccinationTemplate);
  const pushToast = useApp(s => s.pushToast);

  const [name, setName] = useState(template?.name ?? '');
  const [birdType, setBirdType] = useState<'' | BirdType>(template?.birdType ?? '');
  const [lines, setLines] = useState<TemplateLine[]>(() => {
    const items = template?.items ?? [];
    return items.length ? items.map((it, n) => templateLine(n, it)) : [templateLine(0)];
  });
  const [error, setError] = useState<string | null>(null);

  const patch = (key: string, p: Partial<TemplateLine>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...p } : l)));

  function submit() {
    const items = lines.map(({ key, ...rest }) => rest);
    const input = { name: name.trim(), birdType: birdType || undefined, items };
    const r = template ? updateTemplate(template.id, input) : addTemplate(input);
    if (!r.ok) return setError(fail(r, 'Could not save this template'));
    pushToast('success', template ? 'Template updated' : 'Template created');
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={template ? 'Edit template' : 'New template'}
      subtitle="Copied into a batch at placement — later edits reach new batches only"
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit}>Save template</Button>
      </div>}>
      <div className="space-y-3">
        <Field label="Template name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Layer standard" />
        <SelectField label="Bird type" value={birdType} onChange={e => setBirdType(e.target.value as '' | BirdType)}
          options={BIRD_OPTIONS} hint="Any bird offers this template for every batch" />
        {error && <p className="text-[12px] font-medium text-danger">{error}</p>}

        <SectionTitle right={
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setLines(ls => [...ls, templateLine(ls.length)])}>
            Add line
          </Button>
        }>Vaccines</SectionTitle>

        <div className="space-y-2.5">
          {lines.map((l, i) => (
            <Card key={l.key} className="relative">
              <div className="grid grid-cols-[84px_1fr] gap-2.5">
                <Field label={`Day${i === 0 ? ' after placement' : ''}`} type="number" min="0" inputMode="numeric"
                  value={String(l.relativeDay)} className="font-mono"
                  onChange={e => patch(l.key, { relativeDay: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                <Field label="Vaccine name" value={l.vaccineName} onChange={e => patch(l.key, { vaccineName: e.target.value })}
                  placeholder="e.g. Marek's HVT" />
              </div>
              <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                <SelectField label="Remind" value={String(l.reminderDaysBefore)}
                  onChange={e => patch(l.key, { reminderDaysBefore: Number(e.target.value) })}
                  options={REMINDER_OPTIONS} />
                <SelectField label="Route" value={l.route ?? ''}
                  onChange={e => patch(l.key, { route: e.target.value || undefined })} options={ROUTE_OPTIONS} />
              </div>
              {lines.length > 1 && (
                <button type="button" aria-label="Remove line" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                  className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-card border border-line text-muted hover:text-danger flex items-center justify-center press shadow-card">
                  <Trash2 size={13} />
                </button>
              )}
            </Card>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** Retire or reinstate a template — nothing is deleted, and placed schedules are untouched. */
export function TemplateActiveToggle({ template }: { template: VaccinationTemplate }) {
  const setActive = useApp(s => s.setVaccinationTemplateActive);
  const pushToast = useApp(s => s.pushToast);
  return (
    <Toggle checked={template.active} label={template.active ? 'Offered at placement' : 'Not offered'}
      description={template.active
        ? 'Shown when a batch of this type is created.'
        : 'Kept for reference; new batches will not see it.'}
      onChange={v => {
        const r = setActive(template.id, v);
        if (!r.ok) pushToast('error', fail(r, 'Could not change this template'));
      }} />
  );
}
