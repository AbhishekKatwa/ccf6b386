/**
 * Godown purchases and the money that settles them.
 *
 * A receipt moves stock; a payment moves money. They are two ledger events linked by
 * `purchaseId`, never one row doing both jobs — so entering a purchase leaves cash, bank and
 * the P&L exactly where they were, and paying it down never restates what was bought.
 *
 * Nothing here is stored: the purchase value is the receipt's own quantity × its receipt rate,
 * and what has been paid is the sum of the finance rows pointed at it. A purchase with no rate
 * has no value either, which is reported as a gap rather than rounded down to ₹0.
 */
import type { FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry, PaymentStatus } from '@/types';
import { INVENTORY_CATEGORIES, isLivestockPurchase, isInflow } from './accounting';
import { fin } from './analytics';
import { asLedgerRow } from './medicines';

const round = (n: number) => Number(n.toFixed(2));

/** The two stores that raise a payable: the feed godown and the medicine & vaccine store. */
export type PurchaseSource = 'godown' | 'medicine';

/** ₹ this receipt bought, or null when nothing priced it. */
export function purchaseValue(e: FeedStockEntry): number | null {
  const qty = fin(e.qtyKg);
  const rate = fin(e.ratePerKg);
  if (qty === null || rate === null || qty <= 0 || rate <= 0) return null;
  return round(qty * rate);
}

/**
 * Is this ledger row money that went out to buy stock? A row linked to a receipt is one by
 * definition; a legacy purchase payment is recognised by its own kind or category, which is
 * how the ledger already separates inventory money from operating spend. Birds are exempt —
 * a flock has no receipt to settle and no store to draw from, so its payment is plain expense.
 */
export function isPurchasePayment(t: FinanceTxn): boolean {
  if (isInflow(t.kind) || isLivestockPurchase(t)) return false;
  return !!t.purchaseId || t.kind === 'PURCHASE' || INVENTORY_CATEGORIES.has(t.category);
}

/** The rows that settle one receipt, newest first — the payment history of a purchase. */
export function paymentsFor(purchaseId: string, finance: FinanceTxn[]): FinanceTxn[] {
  return finance.filter(t => t.purchaseId === purchaseId)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id));
}

export type PurchasePosition = {
  entry: FeedStockEntry;
  /** Which store the receipt was raised in, so a payable names its home. */
  source: PurchaseSource;
  /** What the receipt brought in: an ingredient name, or the medicine or vaccine. */
  title: string;
  /** The unit that quantity is counted in — KG in the godown, the item's own unit in the medicine store. */
  unit: string;
  /** The supplier's name as recorded, or null when nothing named who it was. */
  supplier: string | null;
  ingredient: string;
  qtyKg: number;
  /** ₹ the purchase was worth; null when it carries no rate. */
  value: number | null;
  paid: number;
  /** value − paid. Negative means more was paid than the receipt is worth — an advance held. */
  outstanding: number | null;
  /** null when the purchase is unpriced, because then its status cannot be stated. */
  status: PaymentStatus | null;
  payments: FinanceTxn[];
};

/** Where one receipt stands: what it was worth, what has been paid, and what is still owed. */
export function purchasePosition(
  entry: FeedStockEntry,
  finance: FinanceTxn[],
  meta: { source?: PurchaseSource; title?: string; unit?: string } = {},
): PurchasePosition {
  const payments = paymentsFor(entry.id, finance);
  const paid = round(payments.reduce((s, t) => s + (fin(t.amount) ?? 0), 0));
  const value = purchaseValue(entry);
  const outstanding = value === null ? null : round(value - paid);
  return {
    entry,
    source: meta.source ?? 'godown',
    title: meta.title ?? entry.ingredient,
    unit: meta.unit ?? 'KG',
    supplier: entry.supplier?.trim() || null,
    ingredient: entry.ingredient,
    qtyKg: entry.qtyKg,
    value,
    paid,
    outstanding,
    status: value === null ? null : paid <= 0 ? 'PENDING' : outstanding !== null && outstanding > 0 ? 'PARTIAL' : 'PAID',
    payments,
  };
}

/** Every stock receipt the godown holds, newest first. Opening stock owes nobody. */
export function purchasePositions(entries: FeedStockEntry[], finance: FinanceTxn[]): PurchasePosition[] {
  return entries.filter(e => e.kind === 'FEED_IN')
    .map(e => purchasePosition(e, finance))
    .sort(byReceiptDate);
}

/**
 * Medicine and vaccine receipts as payables. The receipt is read through the item it
 * names, so a payable shows the product and its own unit instead of a KG figure —
 * and the settling money is the same common finance payment as any godown purchase.
 */
export function medicinePurchasePositions(
  entries: MedicineStockEntry[],
  items: MedicineItem[],
  finance: FinanceTxn[],
): PurchasePosition[] {
  const byId = new Map(items.map(i => [i.id, i]));
  return entries.filter(e => e.kind === 'RECEIPT')
    .map(e => {
      const item = byId.get(e.medicineId);
      return purchasePosition(asLedgerRow(e), finance, {
        source: 'medicine',
        title: item?.name ?? 'Removed item',
        unit: item?.unit ?? 'units',
      });
    })
    .sort(byReceiptDate);
}

function byReceiptDate(a: PurchasePosition, b: PurchasePosition): number {
  return b.entry.date.localeCompare(a.entry.date) || b.entry.id.localeCompare(a.entry.id);
}

export type PayableGroup = {
  /** null is the honest bucket: receipts booked without naming a supplier. */
  supplier: string | null;
  purchases: number;
  value: number | null;
  paid: number;
  outstanding: number | null;
  /** Receipts with no rate: counted in KG, kept out of the money total. */
  unpriced: number;
  open: PurchasePosition[];
};

/** Payables read supplier by supplier, biggest debt first. */
export function payablesBySupplier(positions: PurchasePosition[]): PayableGroup[] {
  const map = new Map<string | null, PurchasePosition[]>();
  for (const p of positions) {
    const key = p.supplier;
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return [...map.entries()].map(([supplier, list]) => {
    const priced = list.filter(p => p.value !== null);
    const value = priced.length ? round(priced.reduce((s, p) => s + (p.value ?? 0), 0)) : null;
    const paid = round(list.reduce((s, p) => s + p.paid, 0));
    return {
      supplier,
      purchases: list.length,
      value,
      paid,
      outstanding: value === null ? null : round(value - paid),
      unpriced: list.length - priced.length,
      open: list.filter(p => p.status === 'PENDING' || p.status === 'PARTIAL'),
    };
  }).sort((a, b) => (b.outstanding ?? -1) - (a.outstanding ?? -1)
    || (a.supplier ?? 'zzz').localeCompare(b.supplier ?? 'zzz'));
}

export type PayableTotals = {
  purchases: number;
  /** ₹ still owed across every priced receipt. Receipts with no rate cannot add to it. */
  outstanding: number;
  value: number;
  paid: number;
  unpaidPurchases: number;
  unpriced: number;
};

/** The figures the finance overview states as outstanding payables. */
export function payableTotals(positions: PurchasePosition[]): PayableTotals {
  const priced = positions.filter(p => p.value !== null);
  return {
    purchases: positions.length,
    value: round(priced.reduce((s, p) => s + (p.value ?? 0), 0)),
    paid: round(priced.reduce((s, p) => s + p.paid, 0)),
    outstanding: round(priced.reduce((s, p) => s + Math.max(0, p.outstanding ?? 0), 0)),
    unpaidPurchases: positions.filter(p => p.status === 'PENDING' || p.status === 'PARTIAL').length,
    unpriced: positions.length - priced.length,
  };
}

/**
 * Purchase payments the ledger carries that no receipt on this company answers to — a legacy
 * row, or one whose receipt has since been removed. They are money that left, so they stay
 * visible rather than silently settling nothing. Receipts from either store settle a payment.
 */
export function unlinkedPurchasePayments(
  finance: FinanceTxn[],
  entries: FeedStockEntry[],
  medicineEntries: MedicineStockEntry[] = [],
): FinanceTxn[] {
  const known = new Set([...entries.map(e => e.id), ...medicineEntries.map(e => e.id)]);
  return finance.filter(t => isPurchasePayment(t) && !(t.purchaseId && known.has(t.purchaseId)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** The label a payable line carries when the receipt never named its supplier. */
export const UNSUPPLIED = 'Supplier not recorded';

/**
 * Issue the next stock receipt number for a company and day. Numbered per company the way cash
 * receipts are, so two farms cannot be handed the same purchase number.
 */
export function nextPurchaseRef(entries: FeedStockEntry[], companyId: string, date: string): string {
  const prefix = `PUR-${date}-`;
  const taken = (ref: string | undefined) => (ref?.startsWith(prefix)
    ? Number.parseInt(ref.slice(prefix.length), 10) : NaN);
  const used = entries.filter(e => e.companyId === companyId).map(e => taken(e.purchaseRef)).filter(n => Number.isFinite(n));
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
}
