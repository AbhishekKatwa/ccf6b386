/**
 * The shed-side feeding entry: tonnes given today, deducted from the shared godown through
 * the formula version in force on that date. It stays a dialog rather than a page because
 * the person feeding is in the middle of a flock's record, not shopping for inventory —
 * the Godown screen and Batch Detail both open this same sheet.
 *
 * `presetBatchId` opens it on the flock the caller is looking at. The batch list is still
 * live batches only, and the deduction preview is still the formula's own arithmetic.
 */
import { useState } from 'react';
import { useApp, useCompanyData } from '@/store/app';
import { Button, Field, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { formulaDeduction, formulaForDate } from '@/lib/calc';
import { fmtIN, todayISO } from '@/lib/format';

/** Mounted only while it is open, so the preset is read once at mount. */
export function FeedGivenDialog({ onClose, presetBatchId }: {
  onClose: () => void;
  presetBatchId?: string;
}) {
  const data = useCompanyData();
  const addFeedConsumption = useApp(s => s.addFeedConsumption);
  const pushToast = useApp(s => s.pushToast);

  const activeBatches = data.batches.filter(b => b.status === 'ACTIVE');
  const [form, setForm] = useState({
    batchId: activeBatches.some(b => b.id === presetBatchId) ? presetBatchId ?? '' : activeBatches[0]?.id ?? '',
    tonnes: '',
    date: todayISO(),
  });

  const batch = activeBatches.find(b => b.id === form.batchId);
  const formula = formulaForDate(batch?.shedId ?? '', form.date, data.feedFormulas);
  const tonnes = parseFloat(form.tonnes) || 0;
  const deduction = formula && tonnes > 0 ? formulaDeduction(formula, tonnes) : [];

  function submit() {
    if (!batch) return pushToast('error', 'Select a live batch');
    if (!(tonnes > 0)) return pushToast('error', 'Enter tonnes above 0');
    const r = addFeedConsumption({
      batchId: batch.id, shedId: batch.shedId,
      date: form.date, tonnes,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', `${tonnes} t fed · godown deducted`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Feed given in shed" subtitle="Tonnes drawn from the godown through the shed formula"
      footer={<div className="flex gap-2"><Button variant="outline" block onClick={onClose}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
      <div className="space-y-3">
        <SelectField label="Batch / shed" value={form.batchId} onChange={e => setForm(f => ({ ...f, batchId: e.target.value }))}
          options={activeBatches.map(b => ({ value: b.id, label: `${b.code} · ${data.sheds.find(s => s.id === b.shedId)?.name ?? ''}` }))} />
        <Field label="Tonnes given" type="number" inputMode="decimal" step="0.01" value={form.tonnes}
          onChange={e => setForm(f => ({ ...f, tonnes: e.target.value }))} placeholder="e.g. 1.25" className="font-mono" />
        <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        {batch && !formula && (
          <p className="text-[12px] text-warn bg-warn-soft rounded-[10px] px-3 py-2">
            This shed has no active formula, so only the consumption entry is recorded — godown stock stays unchanged.
          </p>
        )}
        {deduction.length > 0 && (
          <div className="rounded-[12px] bg-sunk px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">Godown deduction</p>
            <ul className="space-y-1">
              {deduction.map(d => (
                <li key={d.ingredient} className="flex justify-between text-[13px]">
                  <span className="text-ink-2">{d.ingredient}</span>
                  <span className="font-mono tnum text-ink">{fmtIN(d.kg)} kg</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
