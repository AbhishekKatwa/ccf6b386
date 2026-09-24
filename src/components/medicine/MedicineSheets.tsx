import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, Info, PackageMinus, Plus, TriangleAlert } from 'lucide-react';
import { useApp, useCompanyData, useCurrentUser, useVisibleSheds } from '@/store/app';
import { Row } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, Toggle } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { medicineBasis, projectedAverage } from '@/lib/medicines';
import { useMedicineValuation } from '@/hooks/useMedicineValuation';
import { unitQty } from './medicineMeta';
import {
  MEDICINE_CATEGORIES, MEDICINE_CATEGORY_LABELS, MEDICINE_UNITS,
  type MedicineCategory, type MedicineItem, type MedicineUnit,
} from '@/types';

/**
 * The four ways the medicine store is written to, built on the godown's own forms:
 * a receipt that raises stock and a payable, a usage that takes stock off the shelf and
 * charges the flock, a counted correction, and the catalogue itself.
 *
 * None of them writes money. Payment for a receipt belongs to Finance (§13), and the cost
 * of a usage is derived from the average in force — never typed (§9).
 */

const USE_REASONS = ['Treatment', 'Vaccination', 'Deworming', 'Heat stress', 'Disinfection', 'Water medication', 'Other (see remarks)'];
const ADJUST_REASONS = ['Counted short', 'Damaged in storage', 'Expired stock removed', 'Found during count', 'Data entry correction'];

const num = (s: string) => parseFloat(s);

function ErrorLine({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-[12px] font-medium text-danger leading-relaxed">
      <TriangleAlert size={14} className="shrink-0 mt-0.5" />{children}
    </p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[14px] bg-sunk px-3.5 py-3">
      <Info size={14} className="text-muted mt-0.5 shrink-0" />
      <p className="text-[11.5px] text-muted leading-relaxed">{children}</p>
    </div>
  );
}

function EffectCard({ title, rows }: { title: string; rows: { label: string; value: string; tone?: 'success' | 'danger' }[] }) {
  return (
    <div>
      <p className="mb-1.5 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</p>
      <div className="rounded-[16px] border border-line bg-card px-4 py-1">
        {rows.map(r => (
          <Row key={r.label} label={r.label} value={r.value} mono={false}
            success={r.tone === 'success'} danger={r.tone === 'danger'} />
        ))}
      </div>
    </div>
  );
}

/* ============================= CATALOGUE ============================= */

export function MedicineItemSheet({ item, onClose }: { item?: MedicineItem | null; onClose: () => void }) {
  const addMedicineItem = useApp(s => s.addMedicineItem);
  const updateMedicineItem = useApp(s => s.updateMedicineItem);
  const setItemActive = useApp(s => s.setMedicineItemActive);
  const pushToast = useApp(s => s.pushToast);
  const { items } = useMedicineValuation();

  const [f, setF] = useState({
    name: item?.name ?? '', category: (item?.category ?? 'MEDICINE') as MedicineCategory,
    unit: (item?.unit ?? 'bottle') as MedicineUnit,
    lowStockThreshold: String(item?.lowStockThreshold ?? ''),
    specifications: item?.specifications ?? '', remarks: item?.remarks ?? '',
  });

  const trimmed = f.name.trim();
  const clash = items.some(i => i.id !== item?.id && i.name.toLowerCase() === trimmed.toLowerCase());
  const gate = !trimmed ? 'Enter the medicine or vaccine name'
    : clash ? `${trimmed} is already in this store`
      : f.lowStockThreshold.trim() && !(num(f.lowStockThreshold) >= 0) ? 'The reorder level must be 0 or more'
        : null;

  function submit() {
    const draft = {
      name: trimmed, category: f.category, unit: f.unit,
      lowStockThreshold: num(f.lowStockThreshold) || 0,
      specifications: f.specifications.trim() || undefined,
      remarks: f.remarks.trim() || undefined,
      active: item?.active ?? true,
    };
    const r = item ? updateMedicineItem(item.id, draft) : addMedicineItem(draft);
    if (!r.ok) return pushToast('error', r.error ?? 'Could not save this item');
    pushToast('success', item ? `${draft.name} updated` : `${draft.name} added to the medicine store`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={item ? `Change ${item.name}` : 'Add medicine or vaccine'}
      subtitle="Stock transactions are keyed to this entry, not to a typed name"
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit} disabled={!!gate} icon={item ? undefined : <Plus size={14} />}>
          {item ? 'Save changes' : 'Add to store'}
        </Button>
      </div>}>
      <div className="space-y-3">
        <Field label="Name" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))}
          placeholder="e.g. Lasota Vaccine" error={clash ? trimmed : undefined} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Category" value={f.category}
            onChange={e => setF(x => ({ ...x, category: e.target.value as MedicineCategory }))}
            options={MEDICINE_CATEGORIES.map(c => ({ value: c, label: MEDICINE_CATEGORY_LABELS[c] }))} />
          <SelectField label="Counted in" value={f.unit}
            onChange={e => setF(x => ({ ...x, unit: e.target.value as MedicineUnit }))}
            options={MEDICINE_UNITS.map(u => ({ value: u, label: u }))}
            hint="Stock is held in this unit, never in KG" />
        </div>
        <Field label="Reorder level" type="number" min="0" inputMode="numeric" value={f.lowStockThreshold}
          onChange={e => setF(x => ({ ...x, lowStockThreshold: e.target.value }))}
          suffix={f.unit} className="font-mono" hint="Stock at or below this figure is reported as low" />
        <Field label="Pack size / strength" value={f.specifications}
          onChange={e => setF(x => ({ ...x, specifications: e.target.value }))}
          placeholder="e.g. 1000-dose vial" />
        <TextArea label="Remarks" rows={2} value={f.remarks}
          onChange={e => setF(x => ({ ...x, remarks: e.target.value }))}
          placeholder="Storage, veterinary note…" />
        {item && (
          <div className="border-t border-line-2 pt-1">
            <Toggle checked={item.active} label={item.active ? 'In use' : 'Retired'}
              description="A retired item keeps its whole history and stops appearing in new entries."
              onChange={v => {
                const r = setItemActive(item.id, v);
                if (!r.ok) return pushToast('error', r.error ?? 'Could not change this item');
                pushToast('success', `${item.name} ${v ? 'is back in use' : 'retired'}`);
              }} />
          </div>
        )}
        <ErrorLine>{gate}</ErrorLine>
      </div>
    </Dialog>
  );
}

/* ============================= PURCHASE / RECEIVE ============================= */

export function MedicineReceiveSheet({ medicineId, onClose }: { medicineId?: string; onClose: () => void }) {
  const receiveMedicine = useApp(s => s.receiveMedicine);
  const pushToast = useApp(s => s.pushToast);
  const { items, valuation } = useMedicineValuation();
  const today = todayISO();
  const usable = items.filter(i => i.active);
  const [f, setF] = useState({
    medicineId: medicineId ?? usable[0]?.id ?? '', date: today,
    qty: '', ratePerUnit: '', supplier: '', lotNumber: '', expiryDate: '', remarks: '',
  });

  const item = items.find(i => i.id === f.medicineId);
  const pos = item ? valuation.now(item.id) : null;
  const qty = num(f.qty);
  const rate = num(f.ratePerUnit);
  const receiving = qty > 0;
  const value = receiving && rate > 0 ? qty * rate : null;
  const rateError = f.ratePerUnit.trim() !== '' && !(rate > 0) ? 'Enter a rate above ₹0, or leave it empty' : undefined;

  const gate = !item ? 'Choose the medicine or vaccine'
    : !(qty > 0) ? 'Quantity must be greater than 0'
      : !f.supplier.trim() ? 'Record the supplier this stock was bought from'
        : rateError ?? null;

  const after = item && pos && receiving ? {
    kg: pos.kg + qty,
    avg: rate > 0 ? projectedAverage(pos.kg, pos.avg, qty, rate) : pos.avg,
  } : null;

  function submit() {
    const r = receiveMedicine({
      medicineId: f.medicineId, date: f.date, qty,
      ratePerUnit: rate > 0 ? rate : undefined,
      supplier: f.supplier.trim(), lotNumber: f.lotNumber.trim() || undefined,
      expiryDate: f.expiryDate || undefined, remarks: f.remarks.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not receive this stock');
    pushToast('success', value !== null
      ? `${r.purchaseRef} booked · ${fmtMoney(value)} payable to ${f.supplier.trim()} — no money has left yet`
      : `${r.purchaseRef} booked · ${item?.name} counted in, with no rate on record`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Receive stock"
      subtitle="Stock in, and a payable to the supplier — money does not move here"
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit} disabled={!!gate} icon={<ArrowDownToLine size={14} />}>Receive stock</Button>
      </div>}>
      <div className="space-y-3">
        <SelectField label="Medicine / vaccine" value={f.medicineId}
          onChange={e => setF(x => ({ ...x, medicineId: e.target.value }))}
          options={usable.length ? usable.map(i => ({
            value: i.id, label: `${i.name} · ${unitQty(valuation.now(i.id).kg, i.unit)}`,
          })) : [{ value: '', label: 'Nothing in the store yet' }]} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date received" type="date" value={f.date} max={today} className="font-mono"
            onChange={e => setF(x => ({ ...x, date: e.target.value }))} />
          <Field label={`Quantity${item ? ` (${item.unit})` : ''}`} type="number" min="0" inputMode="decimal"
            value={f.qty} onChange={e => setF(x => ({ ...x, qty: e.target.value }))}
            suffix={item?.unit} placeholder="0" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate per unit" type="number" min="0" inputMode="decimal" value={f.ratePerUnit}
            onChange={e => setF(x => ({ ...x, ratePerUnit: e.target.value }))}
            prefix="₹" error={rateError} hint={rateError ? undefined : 'Re-weights the average'} />
          <Field label="Supplier" value={f.supplier} onChange={e => setF(x => ({ ...x, supplier: e.target.value }))}
            placeholder="e.g. Poona Vet Suppliers" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Lot number" value={f.lotNumber} onChange={e => setF(x => ({ ...x, lotNumber: e.target.value }))}
            placeholder="optional" />
          <Field label="Expiry" type="date" value={f.expiryDate} min={f.date} className="font-mono"
            onChange={e => setF(x => ({ ...x, expiryDate: e.target.value }))} />
        </div>

        <TextArea label="Remarks" rows={2} value={f.remarks}
          onChange={e => setF(x => ({ ...x, remarks: e.target.value }))} placeholder="Invoice / order reference…" />

        {after && item && (
          <EffectCard title="Effect on the store average" rows={[
            { label: 'Stock before', value: unitQty(pos?.kg ?? 0, item.unit) },
            { label: 'Average before', value: pos?.avg == null ? 'Not priced yet' : `${fmtMoney(pos.avg, 2)}/${item.unit}` },
            { label: 'Stock after', value: unitQty(after.kg, item.unit) },
            { label: 'Average after', value: after.avg == null ? 'Still no rate on record' : `${fmtMoney(after.avg, 2)}/${item.unit}`, tone: 'success' },
          ]} />
        )}
        {after && item && pos?.avg != null && after.avg != null && Math.abs(after.avg - pos.avg) > 0.005 && (
          <p className="text-[11.5px] text-muted leading-relaxed px-1">
            This receipt&rsquo;s own rate is what re-weights the average. Stock already on the shelf keeps
            being valued at the new average from now on, and every usage booked before today stays at the
            rate it left at.
          </p>
        )}
        {receiving && !(rate > 0) && (
          <Note>No rate written on this receipt, so the stock will be counted on the shelf but left
            out of the money totals — and there is no amount to pay against it yet.</Note>
        )}
        <Note>Booking this stock does not pay for it. {value !== null
          ? <>The <span className="font-mono tnum">{fmtMoney(value)}</span> stays owed to {f.supplier.trim() || 'the supplier'} until Finance records a payment.</>
          : 'A payment is recorded separately by Finance.'}
        </Note>
        <ErrorLine>{gate}</ErrorLine>
      </div>
    </Dialog>
  );
}

/* ============================= USE IN SHED / BATCH ============================= */

/** Mounted only while it is open; `presetBatchId` opens it on the flock the caller is reading. */
export function MedicineUsageSheet({ medicineId, presetBatchId, onClose }: {
  medicineId?: string; presetBatchId?: string; onClose: () => void;
}) {
  const useMedicine = useApp(s => s.useMedicine);
  const pushToast = useApp(s => s.pushToast);
  const user = useCurrentUser();
  const { users } = useCompanyData();
  const sheds = useVisibleSheds();
  const { batches } = useCompanyData();
  const { items, entries, valuation } = useMedicineValuation();
  const today = todayISO();

  const usable = items.filter(i => i.active);
  // Only a flock whose shed this person can see may seed the sheet, or the gate would jam.
  const preset = batches.find(b => b.id === presetBatchId && sheds.some(s => s.id === b.shedId));
  const [f, setF] = useState({
    medicineId: medicineId ?? usable[0]?.id ?? '', date: today, qty: '',
    shedId: preset?.shedId ?? sheds[0]?.id ?? '', batchId: preset?.id ?? '',
    reason: USE_REASONS[0],
    usedBy: user?.name ?? '', remarks: '',
  });

  const item = items.find(i => i.id === f.medicineId);
  const shed = sheds.find(s => s.id === f.shedId);
  const shedBatches = batches.filter(b => b.shedId === f.shedId && b.status === 'ACTIVE');
  const batch = shedBatches.find(b => b.id === f.batchId);
  const qty = num(f.qty);
  const basis = item ? medicineBasis(entries, item.id, f.date) : { avg: null, stock: 0 };
  const cost = basis.avg === null || !(qty > 0) ? null : Number((qty * basis.avg).toFixed(2));

  const gate = !item ? 'Choose the medicine or vaccine'
    : !shed ? 'Choose the shed this went into'
      : !(qty > 0) ? 'Quantity must be greater than 0'
        : !f.usedBy.trim() ? 'Enter who used it'
          : qty > basis.stock ? `Only ${unitQty(basis.stock, item.unit)} of ${item.name} in stock`
            : f.date > today ? 'A usage cannot be booked on a future date' : null;

  function submit() {
    const r = useMedicine({
      medicineId: f.medicineId, date: f.date, qty,
      shedId: f.shedId, batchId: batch?.id,
      reason: f.reason === 'Other (see remarks)' ? (f.remarks.trim() || 'Other') : f.reason,
      usedBy: f.usedBy.trim(), remarks: f.remarks.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not record this usage');
    pushToast('success', r.expense != null
      ? `${item?.name} · ${unitQty(qty, item?.unit ?? '')} used · ${fmtMoney(r.expense)} charged to ${shed?.name}`
      : `${item?.name} · ${unitQty(qty, item?.unit ?? '')} used — no rate on record, so no cost was booked`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Record usage"
      subtitle="Stock leaves the shelf here and becomes the shed's expense"
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block variant="danger" onClick={submit} disabled={!!gate} icon={<PackageMinus size={14} />}>Use stock</Button>
      </div>}>
      <div className="space-y-3">
        <SelectField label="Medicine / vaccine" value={f.medicineId}
          onChange={e => setF(x => ({ ...x, medicineId: e.target.value, batchId: '' }))}
          options={usable.length ? usable.map(i => ({
            value: i.id, label: `${i.name} · ${unitQty(medicineBasis(entries, i.id, f.date).stock, i.unit)} in stock`,
          })) : [{ value: '', label: 'Nothing in the store yet' }]} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date used" type="date" value={f.date} max={today} className="font-mono"
            onChange={e => setF(x => ({ ...x, date: e.target.value }))} />
          <Field label={`Quantity${item ? ` (${item.unit})` : ''}`} type="number" min="0" inputMode="decimal"
            value={f.qty} onChange={e => setF(x => ({ ...x, qty: e.target.value }))}
            suffix={item?.unit} placeholder="0" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Shed" value={f.shedId} onChange={e => setF(x => ({ ...x, shedId: e.target.value, batchId: '' }))}
            options={sheds.length ? sheds.map(s => ({ value: s.id, label: s.name })) : [{ value: '', label: 'No shed visible' }]} />
          <SelectField label="Batch" value={f.batchId} onChange={e => setF(x => ({ ...x, batchId: e.target.value }))}
            hint="Optional — a batch makes it the flock&rsquo;s cost"
            options={[{ value: '', label: shedBatches.length ? 'No batch' : 'No live batch' },
              ...shedBatches.map(b => ({ value: b.id, label: b.code }))]} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Used for" value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))}
            options={USE_REASONS.map(r => ({ value: r, label: r }))} />
          <SelectField label="Used by" value={f.usedBy} onChange={e => setF(x => ({ ...x, usedBy: e.target.value }))}
            options={users.filter(u => u.active).map(u => ({ value: u.name, label: u.name }))} />
        </div>

        <TextArea label="Remarks" rows={2} value={f.remarks}
          onChange={e => setF(x => ({ ...x, remarks: e.target.value }))}
          placeholder={f.reason === 'Other (see remarks)' ? 'Say what it was used for' : 'Water round, birds covered…'} />

        {item && (
          <EffectCard title="What this books" rows={[
            { label: 'Stock before', value: unitQty(basis.stock, item.unit) },
            { label: 'Stock after', value: unitQty(basis.stock - (qty > 0 ? qty : 0), item.unit), tone: 'danger' },
            { label: 'Valued at', value: basis.avg === null ? 'No rate on record' : `${fmtMoney(basis.avg, 2)}/${item.unit}` },
            { label: 'Expense on the flock', value: cost === null ? 'Not priced' : fmtMoney(cost), tone: 'success' },
          ]} />
        )}
        <Note>
          {basis.avg === null
            ? 'Nothing has ever priced this item, so the quantity leaves the shelf and no cost is booked — the rate comes from a receipt.'
            : `The cost is derived from the average in force on ${fmtDate(f.date)}, not typed in. It lands on ${shed?.name ?? 'the shed'}${batch ? ` / ${batch.code}` : ''} as that flock&rsquo;s medicine expense, and never as a Finance row.`}
        </Note>
        <ErrorLine>{gate}</ErrorLine>
      </div>
    </Dialog>
  );
}

/* ============================= COUNTED CORRECTION ============================= */

export function MedicineAdjustSheet({ medicineId, onClose }: { medicineId?: string; onClose: () => void }) {
  const adjustMedicine = useApp(s => s.adjustMedicine);
  const pushToast = useApp(s => s.pushToast);
  const { items, entries } = useMedicineValuation();
  const today = todayISO();
  const usable = items.filter(i => i.active);
  const [f, setF] = useState({
    medicineId: medicineId ?? usable[0]?.id ?? '', date: today,
    direction: 'out' as 'out' | 'in', qty: '', reason: ADJUST_REASONS[0], remarks: '',
  });

  const item = items.find(i => i.id === f.medicineId);
  const magnitude = num(f.qty);
  const signed = magnitude > 0 ? (f.direction === 'out' ? -magnitude : magnitude) : 0;
  const balance = item ? medicineBasis(entries, item.id, f.date).stock : 0;

  const gate = !item ? 'Choose the medicine or vaccine'
    : !(magnitude > 0) ? 'Enter the amount counted, above 0'
      : balance + signed < 0 ? `Only ${unitQty(balance, item.unit)} in stock — this correction would take the shelf below zero` : null;

  function submit() {
    const r = adjustMedicine({
      medicineId: f.medicineId, date: f.date, qty: signed,
      reason: f.reason === 'Data entry correction' && f.remarks.trim() ? f.remarks.trim() : f.reason,
      remarks: f.remarks.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not book this correction');
    pushToast('success', `${item?.name} ${f.direction === 'out' ? 'reduced' : 'increased'} by ${unitQty(magnitude, item?.unit ?? '')}`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Count correction"
      subtitle="A signed correction — stock found is as honest as stock lost"
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit} disabled={!!gate}>Book correction</Button>
      </div>}>
      <div className="space-y-3">
        <SelectField label="Medicine / vaccine" value={f.medicineId}
          onChange={e => setF(x => ({ ...x, medicineId: e.target.value }))}
          options={usable.length ? usable.map(i => ({ value: i.id, label: i.name })) : [{ value: '', label: 'Nothing in the store yet' }]} />

        <div>
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Direction</p>
          <div className="grid grid-cols-2 gap-2">
            {([['out', 'Stock lost'], ['in', 'Stock found']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setF(x => ({ ...x, direction: v }))} aria-pressed={f.direction === v}
                className={`rounded-[11px] border px-3 py-2.5 text-[13px] font-semibold press ${f.direction === v
                  ? v === 'out' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-success/40 bg-success-soft text-success'
                  : 'border-line bg-card text-ink-2'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" type="date" value={f.date} max={today} className="font-mono"
            onChange={e => setF(x => ({ ...x, date: e.target.value }))} />
          <Field label={`Quantity${item ? ` (${item.unit})` : ''}`} type="number" min="0" inputMode="decimal"
            value={f.qty} onChange={e => setF(x => ({ ...x, qty: e.target.value }))} suffix={item?.unit} placeholder="0" />
        </div>

        <SelectField label="Why" value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))}
          options={ADJUST_REASONS.map(r => ({ value: r, label: r }))} />
        <TextArea label="Remarks" rows={2} value={f.remarks}
          onChange={e => setF(x => ({ ...x, remarks: e.target.value }))} placeholder="What the count found…" />

        {item && (
          <EffectCard title="Effect on the shelf" rows={[
            { label: 'Stock on record', value: unitQty(balance, item.unit) },
            { label: 'After this correction', value: unitQty(balance + signed, item.unit), tone: signed < 0 ? 'danger' : 'success' },
          ]} />
        )}
        <Note>A correction never restates a usage that was already booked. It stands beside it, with its
          reason and who booked it, so the count stays auditable (§21).</Note>
        <ErrorLine>{gate}</ErrorLine>
      </div>
    </Dialog>
  );
}
