/**
 * Payment accountability, in one place.
 *
 * These components only ever *show* and *collect* how money physically moved — they never
 * restate an amount. The ledger row stays the accounting event; the channel chips are that
 * same amount split by cash / online / cheque / advance, and whatever nobody classified is
 * reported as "Not recorded" rather than guessed from remarks or category.
 */
import { Banknote, Building2, CreditCard, Hash, ReceiptText, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { Badge, Row, type Tone } from '@/components/ui/Card';
import { Field, SelectField } from '@/components/ui/Form';
import { channelChips, channelOf, splitOf, type ChannelKey } from '@/lib/cashflow';
import { fmtMoney } from '@/lib/format';
import {
  PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
  type FinanceTxn, type PaymentAccountability, type PaymentMethod, type TraderTxn,
} from '@/types';

/** Restrained tones: only an unclassified channel is flagged, and nothing is rainbow. */
const CHANNEL_TONE: Record<ChannelKey, Tone> = {
  cash: 'brand', online: 'accent', cheque: 'neutral', other: 'neutral', advance: 'neutral', unrecorded: 'warn',
};

/**
 * The chips a row earns — one per channel carrying money, so a partly-cash, partly-PhonePe
 * load shows both halves and still adds back to the row's own amount.
 */
export function PaymentChips({ row, className, compact }: {
  row: FinanceTxn | TraderTxn; className?: string; compact?: boolean;
}) {
  const chips = channelChips(row);
  if (!chips.length) return null;
  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1', className)}>
      {chips.map(c => (
        <Badge key={c.channel} tone={CHANNEL_TONE[c.channel]} className={compact ? '!px-2 !py-0.5 !text-[9px] !tracking-[0.06em]' : undefined}>
          {c.label} {fmtMoney(c.amount)}
        </Badge>
      ))}
    </span>
  );
}

/* ============================= FORM BLOCK ============================= */

/** What the payment block collects. Kept flat so a screen can hold it in one useState. */
export interface PaymentDraft {
  paymentMethod: PaymentMethod | '';
  time: string;
  handledById: string;
  handedTo: string;
  authorizedById: string;
  reference: string;
}

export const EMPTY_PAYMENT: PaymentDraft = {
  paymentMethod: '', time: '', handledById: '', handedTo: '', authorizedById: '', reference: '',
};

export function paymentDraftOf(row: Partial<PaymentAccountability> | null | undefined): PaymentDraft {
  return {
    paymentMethod: row?.paymentMethod ?? '',
    time: row?.time ?? '',
    handledById: row?.handledById ?? '',
    handedTo: row?.handedTo ?? '',
    authorizedById: row?.authorizedById ?? '',
    reference: row?.reference ?? '',
  };
}

/** The ledger fields a payment block writes back, or nothing when it stayed blank. */
export function paymentPatch(draft: PaymentDraft): Partial<PaymentAccountability> {
  if (!draft.paymentMethod) return {};
  return {
    paymentMethod: draft.paymentMethod,
    time: draft.time || undefined,
    handledById: draft.handledById || undefined,
    handedTo: draft.handedTo.trim() || undefined,
    authorizedById: draft.authorizedById || undefined,
    reference: draft.reference.trim() || undefined,
  };
}

export const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map(m => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }));

function methodIcon(method: PaymentMethod) {
  if (method === 'CASH') return <Banknote size={13} />;
  if (method === 'CHEQUE') return <ReceiptText size={13} />;
  if (method === 'BANK_TRANSFER' || method === 'NEFT' || method === 'RTGS') return <Building2 size={13} />;
  if (method === 'OTHER') return <Hash size={13} />;
  return <CreditCard size={13} />;
}

/**
 * Method plus the custody trail. The people fields only appear for cash, because cash is
 * the only channel that changes hands in person; an online movement records its reference
 * and who authorised it instead.
 *
 * `inflow` only chooses the wording — "received by" against "paid by". The logged-in user
 * is never assumed to be the person holding the cash; `Recorded by` is shown separately.
 */
export function PaymentFields({ draft, onChange, inflow, people, heading = 'Payment', onReceiptNo }: {
  draft: PaymentDraft;
  onChange: (patch: Partial<PaymentDraft>) => void;
  inflow: boolean;
  people: { id: string; name: string }[];
  heading?: string;
  onReceiptNo?: () => void;
}) {
  const method = draft.paymentMethod;
  const channel = method ? channelOf(method) : null;
  const isCash = channel === 'cash';
  const peopleOptions = [
    { value: '', label: '— Select the person —' },
    ...people.map(p => ({ value: p.id, label: p.name })),
  ];
  const referenceLabel = !method ? 'Reference number'
    : isCash ? (inflow ? 'Receipt number' : 'Cash voucher number')
      : method === 'CHEQUE' ? 'Cheque number'
        : 'UTR / reference number';

  return (
    <div className="space-y-3 rounded-[14px] border border-line bg-sunk/40 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-2">{heading}</p>
        <p className="font-mono text-[9.5px] text-muted">how the money actually moved</p>
      </div>

      <SelectField
        label="Payment method"
        value={method}
        onChange={e => onChange({ paymentMethod: e.target.value as PaymentMethod | '' })}
        options={[{ value: '', label: '— How was it paid? —' }, ...PAYMENT_METHOD_OPTIONS]}
      />

      {method && (
        <p className="-mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
          {methodIcon(method)}
          {isCash
            ? 'Cash changes hands — record whose hands, so a later dispute has an answer.'
            : 'No cash custody needed; this movement left or entered a bank or app.'}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Time" type="time" value={draft.time} onChange={e => onChange({ time: e.target.value })} />
        <div className="min-w-0">
          <SelectField
            label={isCash ? (inflow ? 'Cash received by' : 'Cash paid by') : 'Handled by'}
            hint={isCash ? 'The person who physically held this cash — not the person typing it in' : undefined}
            value={draft.handledById}
            onChange={e => onChange({ handledById: e.target.value })}
            options={peopleOptions}
          />
        </div>
      </div>

      {isCash && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label={inflow ? 'Cash handed over by (their side)' : 'Received by (their side)'}
            value={draft.handedTo}
            onChange={e => onChange({ handedTo: e.target.value })}
            placeholder={inflow ? "e.g. driver / trader's representative" : "e.g. supplier's store keeper"}
          />
          <SelectField
            label="Authorised by"
            value={draft.authorizedById}
            onChange={e => onChange({ authorizedById: e.target.value })}
            options={peopleOptions}
          />
        </div>
      )}

      {!isCash && method && (
        <SelectField
          label="Authorised by"
          value={draft.authorizedById}
          onChange={e => onChange({ authorizedById: e.target.value })}
          options={peopleOptions}
        />
      )}

      <Field
        label={referenceLabel}
        value={draft.reference}
        onChange={e => onChange({ reference: e.target.value })}
        placeholder={isCash && inflow ? 'CR-2026-09-23-001' : 'UTR, cheque no. or reference'}
        className="font-mono text-[13px]"
        suffix={onReceiptNo && isCash && inflow
          ? <button type="button" onClick={onReceiptNo} className="text-[11px] font-semibold text-brand press whitespace-nowrap">Next no.</button>
          : undefined}
      />
    </div>
  );
}

/* ============================= DETAIL BLOCK ============================= */

/**
 * The same accountability read back off a stored row: the channel split, whose hands the
 * cash went through, who authorised it and who recorded it. Missing answers show as an em
 * dash — never as a zero and never as somebody's name inferred from the session.
 */
export function AccountabilityDetail({ row, nameOf, inflow }: {
  row: FinanceTxn | TraderTxn;
  nameOf: (userId?: string) => string;
  inflow: boolean;
}) {
  const parts = splitOf(row);
  const method = row.paymentMethod;
  const cashSide = method ? channelOf(method) === 'cash' : parts.cash > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">Payment accountability</p>
        <PaymentChips row={row} compact />
      </div>
      <Row label="Method" value={method ? PAYMENT_METHOD_LABEL[method] : 'Not recorded'} mono={false} />
      {cashSide && (
        <>
          <Row label={inflow ? 'Cash received by' : 'Cash paid by'} value={nameOf(row.handledById)} mono={false} />
          <Row label="Handed across by" value={row.handedTo || '—'} mono={false} />
        </>
      )}
      {!cashSide && <Row label="Handled by" value={nameOf(row.handledById)} mono={false} />}
      <Row label="Authorised by" value={nameOf(row.authorizedById)} mono={false} />
      <Row label="Recorded by" value={nameOf(row.createdBy)} mono={false} />
      {row.time && <Row label="Time" value={row.time} />}
      <Row label={cashSide ? 'Receipt / voucher no.' : 'UTR / reference no.'} value={row.reference || '—'} />
      {parts.unrecorded !== 0 && (
        <p className="pt-1.5 font-mono text-[10px] text-warn leading-relaxed">
          {fmtMoney(Math.abs(parts.unrecorded))} of this entry has no channel on record, so it is reported as
          &ldquo;Not recorded&rdquo; instead of being counted as cash.
        </p>
      )}
    </div>
  );
}

/** A one-line nudge used where unclassified money exists and can be corrected. */
export function UnclassifiedNote({ count, amount, onShow }: { count: number; amount: number; onShow?: () => void }) {
  if (!count) return null;
  return (
    <div className="flex items-start gap-2 rounded-[12px] bg-warn-soft px-3 py-2.5">
      <ShieldCheck size={15} className="text-warn shrink-0 mt-0.5" />
      <p className="text-[11.5px] text-ink-2 leading-relaxed min-w-0">
        {count} {count === 1 ? 'money entry' : 'money entries'} in this period ({fmtMoney(amount)}) do not say
        how the payment arrived or left. Nothing is counted as cash until someone records it.
        {onShow && (
          <button type="button" onClick={onShow} className="ml-1 font-semibold text-brand press underline">Show them</button>
        )}
      </p>
    </div>
  );
}
