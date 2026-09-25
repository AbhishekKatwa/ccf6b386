import { useMemo, useState } from 'react';
import { useApp, useCurrentUser } from '@/store/app';
import { Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import {
  EMPTY_PAYMENT, PaymentFields, paymentPatch, type PaymentDraft,
} from '@/components/finance/PaymentFields';
import { isInflow } from '@/lib/accounting';
import { todayISO } from '@/lib/format';

export type MoneyKind = 'INCOME' | 'EXPENSE';

/**
 * The heads a flock's own money takes here. Egg and bird sales arrive through a voucher and
 * feed/medicine purchases are godown stock, so neither is offered — this form is for what the
 * shed itself earned or spent and nobody else's record wrote.
 */
const CATEGORIES: Record<MoneyKind, string[]> = {
  INCOME: ['Manure Sale', 'Other'],
  EXPENSE: ['Labour', 'Electricity', 'Transport', 'Maintenance', 'Other'],
};

/**
 * The finance capture, pinned to one batch: the same ledger row Finance's own Add writes,
 * raised where the flock is being read instead of after a trip to the ledger.
 */
export function BatchMoneyDialog({ kind: openedAs, batchId, subtitle, onClose }: {
  kind: MoneyKind; batchId: string; subtitle: string; onClose: () => void;
}) {
  const addFinance = useApp(s => s.addFinance);
  const cashPeople = useApp(s => s.cashPeople);
  const nextCashReceiptNo = useApp(s => s.nextCashReceiptNo);
  const pushToast = useApp(s => s.pushToast);
  const me = useCurrentUser();

  const people = useMemo(() => cashPeople(), [cashPeople]);
  const [kind, setKind] = useState<MoneyKind>(openedAs);
  const [form, setForm] = useState({
    date: todayISO(), amount: '', category: CATEGORIES[openedAs][0], counterparty: '', remarks: '',
  });
  /** How the money physically moved — method, time and whose hands held it. */
  const [pay, setPay] = useState<PaymentDraft>(EMPTY_PAYMENT);

  function pickKind(next: MoneyKind) {
    setKind(next);
    setForm(f => ({ ...f, category: CATEGORIES[next].includes(f.category) ? f.category : CATEGORIES[next][0] }));
  }

  function submit() {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return pushToast('error', 'Enter a valid amount');
    const r = addFinance({
      date: form.date, kind, amount: amt, category: form.category, batchId,
      counterparty: form.counterparty || undefined,
      remarks: form.remarks || undefined,
      ...paymentPatch(pay),
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', kind === 'INCOME' ? 'Income recorded for this flock' : 'Expense recorded for this flock');
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={kind === 'INCOME' ? 'Record income' : 'Record expense'}
      subtitle={`${subtitle} · this entry belongs to this batch`}
      footer={<div className="flex gap-2">
        <Button variant="outline" block onClick={onClose}>Cancel</Button>
        <Button block onClick={submit}>Save</Button>
      </div>}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button size="sm" block variant={kind === 'INCOME' ? 'success' : 'outline'} onClick={() => pickKind('INCOME')}>Money in</Button>
          <Button size="sm" block variant={kind === 'EXPENSE' ? 'danger' : 'outline'} onClick={() => pickKind('EXPENSE')}>Money out</Button>
        </div>
        <Badge tone={isInflow(kind) ? 'success' : 'danger'}>{isInflow(kind) ? 'Income' : 'Expense'}</Badge>
        <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        <Field label="Amount (₹)" type="number" inputMode="decimal" placeholder="0.00" className="font-mono"
          value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        <SelectField label="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          options={CATEGORIES[kind].map(c => ({ value: c, label: c }))} />
        <Field label="Counterparty" value={form.counterparty} placeholder="Trader / worker / supplier name"
          onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} />
        <PaymentFields
          draft={pay}
          onChange={patch => setPay(d => ({ ...d, ...patch }))}
          inflow={isInflow(kind)}
          people={people}
          onReceiptNo={() => setPay(d => ({ ...d, reference: nextCashReceiptNo(form.date) }))}
        />
        <p className="text-[11px] text-muted leading-relaxed">
          Recorded by <strong className="text-ink-2">{me?.name ?? 'you'}</strong> — the person who physically held
          the cash is asked for separately above, because the two are often different people.
        </p>
        <TextArea label="Remarks" rows={2} value={form.remarks}
          onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
      </div>
    </Dialog>
  );
}
