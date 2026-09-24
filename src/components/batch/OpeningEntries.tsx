/**
 * The opening-money step of batch creation.
 *
 * A flock onboarded mid-life arrives with a history: labour already paid, birds already
 * bought, maybe a sale already made. Each line typed here becomes an ordinary dated row in
 * the Finance ledger, tagged to the new batch — there is no second money store, so the
 * ledger, the cash position and every report see exactly what they see for a hand-typed entry.
 *
 * The category decides the accounting, not this form: a stock head stays capital (money out,
 * cost realised later) exactly as it does when the same purchase is booked by hand, and the
 * step says so on the row rather than letting it be discovered in a report.
 */
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp } from '@/store/app';
import { SectionTitle } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs, SelectField } from '@/components/ui/Form';
import { EMPTY_PAYMENT, PaymentFields, type PaymentDraft } from '@/components/finance/PaymentFields';
import { FINANCE_CATEGORIES, INVENTORY_CATEGORIES, isInflow } from '@/lib/accounting';
import { fmtDate, fmtMoney } from '@/lib/format';
import { PAYMENT_METHOD_LABEL, type OpeningEntry } from '@/types';

/** The row as typed — every value stays a string until the placement is submitted. */
export interface OpeningForm {
  kind: OpeningEntry['kind'];
  category: string;
  amount: string;
  date: string;
  remarks: string;
  pay: PaymentDraft;
}

export function blankOpening(date: string): OpeningForm {
  return { kind: 'EXPENSE', category: '', amount: '', date, remarks: '', pay: { ...EMPTY_PAYMENT } };
}

export function toOpeningEntry(f: OpeningForm): OpeningEntry {
  return {
    kind: f.kind,
    category: f.category.trim(),
    amount: Number(f.amount) || 0,
    date: f.date,
    remarks: f.remarks.trim() || undefined,
    paymentMethod: f.pay.paymentMethod || undefined,
    time: f.pay.time || undefined,
    handledById: f.pay.handledById || undefined,
    handedTo: f.pay.handedTo || undefined,
    authorizedById: f.pay.authorizedById || undefined,
    reference: f.pay.reference || undefined,
  };
}

const KIND_TABS = [{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }];

export function OpeningEntriesStep({ placementDate, forms, onChange }: {
  placementDate: string;
  forms: OpeningForm[];
  onChange: (next: OpeningForm[]) => void;
}) {
  const cashPeople = useApp(s => s.cashPeople);
  const people = useMemo(() => cashPeople(), [cashPeople]);
  const [open, setOpen] = useState<number | null>(null);

  function add() {
    onChange([...forms, blankOpening(placementDate)]);
    setOpen(forms.length);
  }
  function patch(i: number, p: Partial<OpeningForm>) {
    onChange(forms.map((f, n) => (n === i ? { ...f, ...p } : f)));
  }
  function remove(i: number) {
    onChange(forms.filter((_, n) => n !== i));
    setOpen(null);
  }

  const sum = (kind: OpeningEntry['kind']) => forms
    .filter(f => f.kind === kind)
    .reduce((t, f) => t + (Number(f.amount) || 0), 0);

  return (
    <div className="pt-1">
      <SectionTitle right={
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={add}>Add entry</Button>
      }>Opening money</SectionTitle>

      <p className="text-[11.5px] text-muted leading-relaxed mb-2.5">
        Onboarding a flock that is already running? Enter what has already been paid out for it
        or taken in from it. Each line is saved as a dated Finance entry mapped to this batch.
      </p>

      {!forms.length ? (
        <div className="rounded-[14px] border border-dashed border-line px-4 py-5 text-center">
          <p className="text-[12.5px] text-muted">Nothing booked before placement.</p>
          <p className="text-[11.5px] text-muted-2 mt-0.5">
            Add a line only for money that had already moved — the batch's own days are entered as they happen.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {forms.map((f, i) => {
            const inflow = isInflow(f.kind);
            const capital = !inflow && INVENTORY_CATEGORIES.has(f.category);
            return (
              <div key={i} className="rounded-[14px] border border-line bg-card overflow-hidden">
                <div className="flex items-center gap-1 pl-3">
                  <button type="button" onClick={() => setOpen(open === i ? null : i)}
                    className="flex-1 min-w-0 flex items-center gap-2.5 py-2.5 text-left press">
                    <span className={clsx('w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0',
                      inflow ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                      {inflow ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold text-ink truncate">
                        {f.category || (inflow ? 'Money in' : 'Money out')}
                      </span>
                      <span className="block font-mono text-[10.5px] text-muted tnum truncate">
                        {f.date ? fmtDate(f.date) : 'No date'}
                        {f.pay.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[f.pay.paymentMethod]}` : ''}
                        {capital ? ' · capital' : ''}
                      </span>
                    </span>
                    <span className="font-mono text-[13px] font-semibold text-ink tnum shrink-0">
                      {fmtMoney(Number(f.amount) || 0)}
                    </span>
                    <ChevronDown size={15} className={clsx('shrink-0 text-muted transition-transform', open === i && 'rotate-180')} />
                  </button>
                  <button type="button" onClick={() => remove(i)} aria-label="Remove this entry"
                    className="p-2 text-muted hover:text-danger press shrink-0"><Trash2 size={15} /></button>
                </div>

                {open === i && (
                  <div className="px-3 pb-3 pt-3 space-y-3 border-t border-line">
                    <SegmentedTabs value={f.kind} onChange={k => patch(i, { kind: k as OpeningEntry['kind'] })}
                      options={KIND_TABS} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <SelectField label="Head" value={f.category}
                        onChange={e => patch(i, { category: e.target.value })}
                        options={[{ value: '', label: '— What was it for? —' }, ...FINANCE_CATEGORIES.map(c => ({ value: c, label: c }))]} />
                      <Field label="Amount" type="number" inputMode="decimal" value={f.amount}
                        onChange={e => patch(i, { amount: e.target.value })} placeholder="0" className="font-mono" suffix="₹" />
                    </div>
                    <Field label="Date the money moved" type="date" value={f.date}
                      onChange={e => patch(i, { date: e.target.value })}
                      hint={f.date !== placementDate ? undefined : 'Defaults to the placement date — move it back for anything already paid'} />
                    {capital && (
                      <p className="text-[11px] text-muted leading-relaxed">
                        {f.category} is stock: it is money out on that day, and its cost is
                        realised later when a shed draws it, so it is not charged to this batch as an expense.
                      </p>
                    )}
                    <PaymentFields draft={f.pay} onChange={p => patch(i, { pay: { ...f.pay, ...p } })}
                      inflow={inflow} people={people} heading={inflow ? 'Receipt & custody' : 'Payment & custody'} />
                    <Field label="Remarks" value={f.remarks} onChange={e => patch(i, { remarks: e.target.value })}
                      placeholder="Optional — who it was paid to, what it covered" />
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex items-center gap-4 rounded-[12px] bg-sunk px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Already paid out</p>
            <p className="font-mono text-[12.5px] font-semibold text-ink tnum">{fmtMoney(sum('EXPENSE'))}</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted ml-auto">Received</p>
            <p className="font-mono text-[12.5px] font-semibold text-ink tnum">{fmtMoney(sum('INCOME'))}</p>
          </div>
        </div>
      )}
    </div>
  );
}
