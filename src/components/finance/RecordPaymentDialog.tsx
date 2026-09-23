/**
 * The payment workflow, in one place — Finance owns it (§15).
 *
 * A payment is a money event on its own: it never restates the purchase or the sale it
 * settles, and the billing record never writes it on the other side's behalf. What is owed
 * is read from the ledger, so the only figure anyone types here is the amount that actually
 * moved, and the only people named are the ones whose hands were on it.
 */
import { useMemo, useState } from 'react';
import { HandCoins, ReceiptText } from 'lucide-react';
import { Badge, Row } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs, SelectField, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { EMPTY_PAYMENT, PaymentFields, type PaymentDraft } from './PaymentFields';
import { accountabilityError } from '@/lib/cashflow';
import { fmtDateShort, fmtIN, fmtMoney, todayISO } from '@/lib/format';
import type { SalePosition } from '@/lib/calc';
import { UNSUPPLIED, type PurchasePosition } from '@/lib/purchasing';
import type { PaymentMethod } from '@/types';
import type { PurchasePaymentInput, Result, SalePaymentInput } from '@/store/app';

export type PaymentDirection = 'pay_purchase' | 'receive_sale';

/** A billed load and the name it is owed by. */
export type Receivable = { position: SalePosition; traderName: string };

type Draft = {
  direction: PaymentDirection;
  party: string;
  linkId: string;
  amount: string;
  date: string;
  remarks: string;
};

/**
 * The purchase or sale already chosen upstream — the godown's `Record payment` shortcut and a
 * payable line both arrive with this in hand, so nobody has to find the receipt again.
 */
export type PaymentTarget = { direction: PaymentDirection; purchaseId?: string; saleId?: string };

export function RecordPaymentDialog({ open, onClose, target, purchases, receivables, people, recordedBy, nextReceiptNo, onPayPurchase, onReceiveSale }: {
  open: boolean;
  onClose: () => void;
  target?: PaymentTarget;
  /** Stock receipts still owed — the only things a payment out can be linked to. */
  purchases: PurchasePosition[];
  /** Loads the trader has not finished paying for. */
  receivables: Receivable[];
  people: { id: string; name: string }[];
  recordedBy: string;
  nextReceiptNo: (date: string) => string;
  onPayPurchase: (input: PurchasePaymentInput) => Result;
  onReceiveSale: (input: SalePaymentInput) => Result;
}) {
  const [draft, setDraft] = useState<Draft>({
    direction: target?.direction ?? 'pay_purchase',
    party: '',
    linkId: target?.purchaseId ?? target?.saleId ?? '',
    amount: '', date: todayISO(), remarks: '',
  });
  const [pay, setPay] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [error, setError] = useState<string | null>(null);

  const paying = draft.direction === 'pay_purchase';
  const openPurchases = useMemo(() => purchases.filter(p => p.status === 'PENDING' || p.status === 'PARTIAL'), [purchases]);
  const openDues = useMemo(() => receivables.filter(r => r.position.status !== 'PAID'), [receivables]);

  /** The parties are the ones with something outstanding — a payable list, not a name book. */
  const partyOptions = useMemo(() => {
    if (paying) {
      const bySupplier = new Map<string, number>();
      for (const p of openPurchases) {
        const key = p.supplier ?? UNSUPPLIED;
        bySupplier.set(key, (bySupplier.get(key) ?? 0) + Math.max(0, p.outstanding ?? 0));
      }
      return [...bySupplier.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, due]) => ({ value: name, label: `${name} · ${fmtMoney(due)} owed` }));
    }
    const byTrader = new Map<string, number>();
    for (const r of openDues) byTrader.set(r.traderName, (byTrader.get(r.traderName) ?? 0) + Math.max(0, r.position.outstanding));
    return [...byTrader.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, due]) => ({ value: name, label: `${name} · ${fmtMoney(due)} due` }));
  }, [paying, openPurchases, openDues]);

  /** Whoever the shortcut came in for — the supplier or trader named by the linked record. */
  const targetParty = useMemo(() => {
    const id = target?.purchaseId ?? target?.saleId;
    if (!id) return '';
    const purchase = openPurchases.find(p => p.entry.id === id);
    if (purchase) return purchase.supplier ?? UNSUPPLIED;
    return openDues.find(r => r.position.entry.id === id)?.traderName ?? '';
  }, [target, openPurchases, openDues]);

  const party = draft.party || targetParty || (partyOptions.length === 1 ? partyOptions[0].value : '');

  const linkOptions = useMemo(() => {
    if (paying) {
      return openPurchases
        .filter(p => (p.supplier ?? UNSUPPLIED) === party)
        .map(p => ({
          value: p.entry.id,
          label: `${p.entry.purchaseRef ?? 'Purchase'} · ${p.title} ${fmtIN(p.qtyKg)} ${p.unit} · ${fmtDateShort(p.entry.date)} · ${fmtMoney(p.outstanding ?? 0)} due`,
        }));
    }
    return openDues
      .filter(r => r.traderName === party)
      .map(r => ({
        value: r.position.entry.id,
        label: `${fmtDateShort(r.position.entry.date)} load · ${fmtMoney(r.position.billed)} billed · ${fmtMoney(Math.max(0, r.position.outstanding))} due`,
      }));
  }, [paying, openPurchases, openDues, party]);

  const linkId = draft.linkId && linkOptions.some(o => o.value === draft.linkId)
    ? draft.linkId
    : linkOptions.length === 1 ? linkOptions[0].value : '';

  if (!open) return null;

  const purchase = paying && linkId ? openPurchases.find(p => p.entry.id === linkId) : undefined;
  const due_ = !paying && linkId ? openDues.find(r => r.position.entry.id === linkId) : undefined;
  const due = purchase ? purchase.outstanding : due_?.position.outstanding ?? null;
  const paidSoFar = purchase ? purchase.paid : due_?.position.paid ?? null;
  const billed = purchase ? purchase.value : due_?.position.billed ?? null;
  const amount = parseFloat(draft.amount);
  const settles = due !== null && Number.isFinite(amount) && amount >= due;

  const custodyError = accountabilityError({
    kind: paying ? 'PAYMENT_OUT' : 'PAYMENT_IN',
    paymentMethod: (pay.paymentMethod || undefined) as PaymentMethod | undefined,
    handledById: pay.handledById || undefined,
  });
  const ready = !!linkId && Number.isFinite(amount) && amount > 0 && !custodyError;

  function submit() {
    if (!ready) {
      setError(custodyError ?? 'Fill in the amount and the link first');
      return;
    }
    const money = {
      amount, date: draft.date, paymentMethod: pay.paymentMethod as PaymentMethod,
      time: pay.time || undefined, handledById: pay.handledById || undefined,
      handedTo: pay.handedTo.trim() || undefined, authorizedById: pay.authorizedById || undefined,
      reference: pay.reference.trim() || undefined, remarks: draft.remarks || undefined,
    };
    const r = paying
      ? onPayPurchase({ ...money, purchaseId: linkId })
      : onReceiveSale({ ...money, saleId: linkId });
    if (!r.ok) {
      setError(r.error ?? 'The payment could not be recorded');
      return;
    }
    onClose();
  }

  if (!partyOptions.length) {
    return (
      <Dialog open onClose={onClose}
        title={paying ? 'Record Payment' : 'Record Receipt'}
        subtitle={paying ? 'Money out against a godown purchase' : 'Money in against a billed load'}
        footer={<Button block variant="outline" onClick={onClose}>Close</Button>}>
        <p className="px-1 py-6 text-center text-[13px] text-muted leading-relaxed">
          {paying
            ? 'Every godown purchase on this farm is fully paid, so there is nothing a payment can be linked to yet.'
            : 'Every billed load is settled, so there is nothing a receipt can be linked to yet.'}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose}
      title={paying ? 'Record Payment' : 'Record Receipt'}
      subtitle={paying ? 'Money out against a godown purchase' : 'Money in against a billed load'}
      footer={<div className="flex gap-2">
        <Button block variant="outline" onClick={onClose}>Cancel</Button>
        <Button block onClick={submit} disabled={!ready}
          icon={paying ? <HandCoins size={14} /> : <ReceiptText size={14} />}>
          {paying ? 'Record payment' : 'Record receipt'}
        </Button>
      </div>}>
      <div className="space-y-3">
        <SegmentedTabs<PaymentDirection> value={draft.direction} scroll
          onChange={d => { setError(null); setDraft(s => ({ ...s, direction: d, party: '', linkId: '', amount: '' })); }}
          options={[
            { value: 'pay_purchase', label: 'Payment out', icon: <HandCoins size={13} /> },
            { value: 'receive_sale', label: 'Payment in', icon: <ReceiptText size={13} /> },
          ]} />

        <SelectField label={paying ? 'Supplier' : 'Trader'} value={party}
          onChange={e => setDraft(s => ({ ...s, party: e.target.value, linkId: '' }))}
          options={[{ value: '', label: paying ? '— Who is being paid? —' : '— Who is paying us? —' }, ...partyOptions]} />

        <SelectField label={paying ? 'Linked purchase' : 'Linked sale'} value={linkId}
          onChange={e => setDraft(s => ({ ...s, linkId: e.target.value, amount: '' }))}
          options={[
            { value: '', label: party ? (paying ? '— Which purchase? —' : '— Which load? —') : 'Choose the party first' },
            ...linkOptions,
          ]}
          hint={paying
            ? 'Only purchases that are still owed money appear here — the purchase itself is never changed by its payment'
            : 'Only loads that are still unpaid or partly paid appear here — the sale is never re-billed by a receipt'} />

        {linkId && (
          <div className="rounded-[14px] border border-line bg-sunk/50 px-3 py-1">
            <Row label={paying ? 'Purchase value' : 'Load billed'} value={billed === null ? 'No rate on record' : fmtMoney(billed)} />
            <Row label={paying ? 'Already paid' : 'Already received'} value={fmtMoney(paidSoFar ?? 0)} />
            <Row label={paying ? 'Still outstanding' : 'Still due'} value={fmtMoney(Math.max(0, due ?? 0))} danger={(due ?? 0) > 0} />
          </div>
        )}

        <Field label={paying ? 'Amount paid (₹)' : 'Amount received (₹)'} type="number" inputMode="decimal"
          value={draft.amount} onChange={e => setDraft(s => ({ ...s, amount: e.target.value }))}
          placeholder="0.00" className="font-mono"
          error={draft.amount !== '' && (!Number.isFinite(amount) || amount <= 0) ? 'Enter the amount that moved' : undefined}
          hint={due !== null ? `${fmtMoney(Math.max(0, due))} is outstanding — this payment is checked against that figure` : undefined} />
        <Field label="Date" type="date" value={draft.date} onChange={e => setDraft(s => ({ ...s, date: e.target.value }))} />

        <PaymentFields draft={pay} onChange={p => setPay(d => ({ ...d, ...p }))} inflow={!paying} people={people}
          heading={paying ? 'Payment & custody' : 'Receipt & custody'}
          onReceiptNo={() => setPay(d => ({ ...d, reference: nextReceiptNo(draft.date) }))} />

        {Number.isFinite(amount) && amount > 0 && due !== null && (
          <div className="flex items-center gap-2">
            {settles
              ? <Badge tone="success">{paying ? 'Purchase fully paid' : 'Load fully paid'}</Badge>
              : <Badge tone="accent">Stays partly paid</Badge>}
            <p className="text-[11.5px] text-muted min-w-0 leading-relaxed">
              {fmtMoney(Math.max(0, due - amount))} {paying ? 'will remain owed on this purchase' : 'will remain due on this load'}.
            </p>
          </div>
        )}

        <TextArea label="Remarks" rows={2} value={draft.remarks}
          onChange={e => setDraft(s => ({ ...s, remarks: e.target.value }))}
          placeholder="Slip number, vehicle, whatever explains it" />

        {pay.paymentMethod && custodyError && (
          <p className="text-[11.5px] text-warn leading-relaxed">
            {custodyError} — cash is the only channel that changes hands in person, so the ledger needs that name.
          </p>
        )}

        {error && (
          <p className="rounded-[12px] bg-danger-soft px-3 py-2 text-[11.5px] text-danger leading-relaxed">{error}</p>
        )}

        <p className="text-[11.5px] text-muted leading-relaxed">
          {paying
            ? 'The godown already holds the stock; this row only says the money left. Nothing is re-entered on the purchase, and the stock value is untouched.'
            : 'The load was billed when it left; this row only says the money arrived. The trader’s balance and this load’s dues are both read back from it.'}
          {' '}Recorded by <strong className="text-ink-2">{recordedBy}</strong> — the person who physically held the cash is asked for separately above.
        </p>
      </div>
    </Dialog>
  );
}
