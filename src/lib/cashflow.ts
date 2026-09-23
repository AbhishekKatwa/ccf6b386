/**
 * Cash & online accountability read-out.
 *
 * The finance ledger stays the one source of truth: every figure here is an existing
 * ledger row re-classified by how its money physically moved, so no amount is added to
 * or taken from the accounts (spec §21 — one economic event, one accounting event).
 * A row whose channel is not on record lands in `unrecorded`, and is never guessed from
 * its category, its remarks or the person who typed it in.
 *
 * Custody lives here too. A handover moves *possession* between two people without
 * touching the ledger, and a physical count records a difference rather than quietly
 * adjusting the balance to match it.
 */
import type {
  CashCount, CashHandover, FinanceTxn, MoneyChannel, PaymentMethod, PaymentSplit, TraderTxn, TraderTxnKind, User,
} from '@/types';
import { CHANNEL_LABEL, MONEY_CHANNELS, PAYMENT_METHOD_LABEL } from '@/types';
import { isInflow } from './accounting';
import { fin, isISODate } from './analytics';

/** A date window; `Range` is accepted wherever a full one exists. */
export type DateWindow = { from: string; to: string };

/** The channels on record, plus the honest remainder for rows nobody classified. */
export type ChannelKey = MoneyChannel | 'unrecorded';

export const CHANNEL_KEYS: ChannelKey[] = [...MONEY_CHANNELS, 'unrecorded'];

export const CHANNEL_FULL_LABEL: Record<ChannelKey, string> = {
  ...CHANNEL_LABEL, unrecorded: 'Not recorded',
};

/** 'UPI' / 'NEFT' / 'RTGS' / 'BANK_TRANSFER' / 'PHONEPE' all mean money that left a bank account. */
export function channelOf(method: PaymentMethod): MoneyChannel {
  if (method === 'CASH') return 'cash';
  if (method === 'CHEQUE') return 'cheque';
  if (method === 'OTHER') return 'other';
  return 'online';
}

/**
 * What a row's amount was made of. The structured split written at booking time wins;
 * `paymentMethod` covers whatever it leaves over; anything neither explains stays
 * `unrecorded`. The parts always add back to the row amount.
 */
export function splitOf(row: { amount: number; paymentMethod?: PaymentMethod; split?: PaymentSplit }): Record<ChannelKey, number> {
  const out: Record<ChannelKey, number> = { cash: 0, online: 0, cheque: 0, other: 0, advance: 0, unrecorded: 0 };
  let claimed = 0;
  for (const key of MONEY_CHANNELS) {
    const value = fin(row.split?.[key]);
    if (value !== null && value > 0) { out[key] = value; claimed += value; }
  }
  const rest = (fin(row.amount) ?? 0) - claimed;
  if (rest > 0) out[row.paymentMethod ? channelOf(row.paymentMethod) : 'unrecorded'] += rest;
  else if (rest < 0) out.unrecorded = rest; // a split larger than its row is shown, not trimmed
  return out;
}

/** Does this row say how the money moved? */
export function isClassified(row: { paymentMethod?: PaymentMethod; split?: unknown }): boolean {
  return !!row.paymentMethod || !!row.split;
}

export type ChannelTotals = { [k in ChannelKey]: number } & { total: number };

const round = (n: number) => Number(n.toFixed(2));

function zeroTotals(): ChannelTotals {
  return { cash: 0, online: 0, cheque: 0, other: 0, advance: 0, unrecorded: 0, total: 0 };
}

export function totalsOf(rows: FinanceTxn[]): ChannelTotals {
  const t = zeroTotals();
  for (const row of rows) {
    const amount = fin(row.amount);
    if (amount === null) continue;
    const parts = splitOf(row);
    for (const key of CHANNEL_KEYS) t[key] += parts[key];
    t.total += amount;
  }
  for (const key of CHANNEL_KEYS) t[key] = round(t[key]);
  t.total = round(t.total);
  return t;
}

export function inWindow(rows: FinanceTxn[], window: DateWindow): FinanceTxn[] {
  return rows.filter(t => isISODate(t.date) && t.date >= window.from && t.date <= window.to);
}

export type CashFlow = {
  in: ChannelTotals;
  out: ChannelTotals;
  /** Ledger rows that say how their money moved — the statements and the dispute trail read these. */
  movements: FinanceTxn[];
};

/**
 * Money in and money out split by channel. `in.cash + in.online + in.cheque + in.other
 * + in.advance + in.unrecorded` always equals `in.total`, which is the ledger's own
 * money-in figure — so the split can never disagree with the accounts.
 */
export function cashFlowOf(finance: FinanceTxn[], window: DateWindow): CashFlow {
  const rows = inWindow(finance, window);
  const movements = rows.filter(isClassified);
  return {
    in: totalsOf(rows.filter(t => isInflow(t.kind))),
    out: totalsOf(rows.filter(t => !isInflow(t.kind))),
    movements,
  };
}

/**
 * Cash the company should be holding at a date, from every ledger row up to it.
 * Derived only — there is no way to type a balance in.
 */
export function cashPositionOf(finance: FinanceTxn[], upTo: string): number {
  let cash = 0;
  for (const t of finance) {
    if (!isISODate(t.date) || t.date > upTo) continue;
    const amount = fin(t.amount);
    if (amount === null) continue;
    const { cash: c } = splitOf(t);
    cash += isInflow(t.kind) ? c : -c;
  }
  return round(cash);
}

/** The same position across every row on record. */
export function cashOnHand(finance: FinanceTxn[]): number {
  return cashPositionOf(finance, '9999-12-31');
}

export type MethodSummaryRow = {
  method: PaymentMethod | null;
  channel: ChannelKey;
  label: string;
  received: number;
  paid: number;
  net: number;
  count: number;
};

/**
 * Money per payment method. Where a row names its method, its amount is reported under
 * that method; where only a channel is on record (a load paid partly in cash and partly
 * on PhonePe, say), the amount is reported under the channel. Nothing is dropped: what
 * nobody classified surfaces as 'Not recorded'.
 */
export function methodSummary(finance: FinanceTxn[], window: DateWindow): MethodSummaryRow[] {
  const rows = new Map<string, MethodSummaryRow>();
  for (const t of inWindow(finance, window)) {
    if (fin(t.amount) === null) continue;
    const inflow = isInflow(t.kind);
    const parts = splitOf(t);
    for (const channel of CHANNEL_KEYS) {
      const value = parts[channel];
      if (!value) continue;
      const method = t.paymentMethod && channelOf(t.paymentMethod) === channel ? t.paymentMethod : null;
      const key = method ? `m:${method}` : `c:${channel}`;
      let row = rows.get(key);
      if (!row) {
        row = { method, channel, label: method ? PAYMENT_METHOD_LABEL[method] : CHANNEL_FULL_LABEL[channel], received: 0, paid: 0, net: 0, count: 0 };
        rows.set(key, row);
      }
      if (inflow) row.received += value; else row.paid += value;
      row.count += 1;
    }
  }
  return [...rows.values()]
    .map(r => ({ ...r, received: round(r.received), paid: round(r.paid), net: round(r.received - r.paid) }))
    .sort((a, b) => (b.received + b.paid) - (a.received + a.paid) || a.label.localeCompare(b.label));
}

/* ============================= CASH CUSTODY ============================= */

export type Custodian = {
  userId: string;
  name: string;
  /** Cash taken in on inflow rows. */
  received: number;
  /** Cash handed over to a supplier or trader on outflow rows. */
  paidOut: number;
  /** Cash passed to someone else inside the company. */
  handedAway: number;
  /** Cash taken over from someone else inside the company. */
  handedIn: number;
  inHand: number;
};

export type Custody = {
  /** Cash the records say the company holds — the ledger's own cash position. */
  total: number;
  byCustodian: Custodian[];
  /** Cash movements with no handler on record: part of the total, held by nobody in particular. */
  unassigned: number;
  unassignedReceived: number;
  unassignedPaid: number;
};

/**
 * Who is holding how much cash. `SUM(byCustodian) + unassigned` equals `total` by
 * construction, so the custody list always reconciles with the ledger. A person who
 * paid out cash they had never received shows negative: that is a missing handover
 * record, and it is reported rather than smoothed away.
 */
export function custodyOf(finance: FinanceTxn[], handovers: CashHandover[], users: User[]): Custody {
  const names = new Map(users.map(u => [u.id, u.name]));
  const rows = new Map<string, Custodian>();
  const row = (userId: string): Custodian => {
    let r = rows.get(userId);
    if (!r) {
      r = { userId, name: names.get(userId) ?? 'Removed user', received: 0, paidOut: 0, handedAway: 0, handedIn: 0, inHand: 0 };
      rows.set(userId, r);
    }
    return r;
  };
  let unassignedReceived = 0;
  let unassignedPaid = 0;
  for (const t of finance) {
    const amount = fin(t.amount);
    if (amount === null) continue;
    const { cash } = splitOf(t);
    if (!cash) continue;
    const inflow = isInflow(t.kind);
    if (t.handledById) {
      const r = row(t.handledById);
      if (inflow) r.received += cash; else r.paidOut += cash;
    } else if (inflow) unassignedReceived += cash;
    else unassignedPaid += cash;
  }
  for (const h of handovers) {
    const amount = fin(h.amount) ?? 0;
    if (amount <= 0) continue;
    row(h.fromUserId).handedAway += amount;
    row(h.toUserId).handedIn += amount;
  }
  const list = [...rows.values()].map(r => ({
    ...r,
    received: round(r.received), paidOut: round(r.paidOut),
    handedAway: round(r.handedAway), handedIn: round(r.handedIn),
    inHand: round(r.received - r.paidOut - r.handedAway + r.handedIn),
  })).filter(r => r.received || r.paidOut || r.handedAway || r.handedIn)
    .sort((a, b) => b.inHand - a.inHand || a.name.localeCompare(b.name));
  const total = cashOnHand(finance);
  return {
    total,
    byCustodian: list,
    unassignedReceived: round(unassignedReceived),
    unassignedPaid: round(unassignedPaid),
    unassigned: round(unassignedReceived - unassignedPaid),
  };
}

/* ============================= DISPLAY & VALIDATION ============================= */

export type ChannelChip = { channel: ChannelKey; label: string; amount: number };

/**
 * The chips a ledger row earns: one per channel that carries money. A row with nothing
 * on record yields a single 'Not recorded' chip, which is the honest answer and the
 * prompt to record it.
 */
export function channelChips(row: FinanceTxn | TraderTxn): ChannelChip[] {
  const parts = splitOf(row);
  const chips: ChannelChip[] = [];
  for (const channel of CHANNEL_KEYS) {
    const amount = parts[channel];
    if (!amount) continue;
    const method = row.paymentMethod && channelOf(row.paymentMethod) === channel ? row.paymentMethod : null;
    chips.push({ channel, label: method ? PAYMENT_METHOD_LABEL[method] : CHANNEL_FULL_LABEL[channel], amount: round(amount) });
  }
  return chips;
}

/** Does any part of this row's money sit in that channel? Used by the ledger filters. */
export function carriesChannel(row: FinanceTxn | TraderTxn, channel: ChannelKey): boolean {
  return splitOf(row)[channel] !== 0;
}

/** Kinds that raise a bill or restate a position rather than move money. */
const NOT_A_MOVEMENT = ['OPENING', 'EGG_SALE', 'RATE_UPDATE'] as const;

/** Is this ledger row an actual movement of cash or bank money? */
export function movesMoney(kind: FinanceTxn['kind'] | TraderTxnKind): boolean {
  return !(NOT_A_MOVEMENT as readonly string[]).includes(kind);
}

/**
 * What a money movement must carry to be answerable in a dispute later: how the money
 * moved, and — for cash — whose hands it went through. Returns the question to ask.
 */
export function accountabilityError(row: {
  kind: FinanceTxn['kind'] | TraderTxnKind;
  paymentMethod?: PaymentMethod;
  handledById?: string;
}): string | null {
  if (!movesMoney(row.kind)) return null;
  if (!row.paymentMethod) return 'Select how the money was paid';
  if (channelOf(row.paymentMethod) !== 'cash') return null;
  if (row.handledById) return null;
  return isInflow(row.kind as FinanceTxn['kind'])
    ? 'Record who received the cash'
    : 'Record who paid the cash';
}

/* ============================= DAILY CASH RECONCILIATION ============================= */

export type CashReconciliation = {
  from: string;
  to: string;
  /** Cash carried into the window, derived from everything booked before it. */
  opening: number;
  received: number;
  paid: number;
  /** Rows whose cash channel is not on record, so the figure below says "at least". */
  unrecorded: number;
  expected: number;
  /** The most recent physical count on or before the window's end, if one exists. */
  count: CashCount | null;
  /** Counts whose difference is not zero, latest first. */
  openDifferences: CashCount[];
};

/**
 * Expected cash for a window, next to the last count actually taken. A difference is
 * never folded back into the balance (spec §11): it stays on record until someone
 * books the transaction that explains it.
 */
export function reconcileCash(finance: FinanceTxn[], window: DateWindow, counts: CashCount[]): CashReconciliation {
  const opening = cashOnHand(finance.filter(t => isISODate(t.date) && t.date < window.from));
  const rows = inWindow(finance, window);
  const cashIn = totalsOf(rows.filter(t => isInflow(t.kind))).cash;
  const cashOut = totalsOf(rows.filter(t => !isInflow(t.kind))).cash;
  const unrecorded = totalsOf(rows).unrecorded;
  const sorted = counts.filter(c => isISODate(c.date) && c.date <= window.to).sort((a, b) => b.date.localeCompare(a.date));
  return {
    from: window.from, to: window.to,
    opening,
    received: cashIn, paid: cashOut, unrecorded,
    expected: round(opening + cashIn - cashOut),
    count: sorted[0] ?? null,
    openDifferences: sorted.filter(c => c.difference !== 0),
  };
}
