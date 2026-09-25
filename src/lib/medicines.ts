/**
 * Medicine & vaccine inventory — the godown's rules applied to a second ledger.
 *
 * There is deliberately no second valuation engine: a medicine row is read as a godown
 * row (one product is one "ingredient", one unit is one "KG") and replayed by the same
 * weighted-average code. So a receipt re-weights the average (§6), stock leaving is
 * valued at the average in force the moment it is booked (§9), and a later, dearer
 * purchase can never restate an issue that was already taken.
 */
import type { FeedStockEntry, MedicineItem, MedicineStockEntry, MedicineStockKind } from '@/types';
import { daysBetween, fmtIN } from './format';
import { blendPrice, valueGodown, type GodownValuation } from './valuation';
import { receiptHighWater, receiptNo } from './receipts';

/**
 * Medicine kinds carry the godown's directions under their own names: a receipt is an
 * issue-in, a usage is a consumption. `stockDelta` therefore reads them unchanged.
 */
const AS_FEED_KIND: Record<MedicineStockKind, FeedStockEntry['kind']> = {
  OPENING: 'OPENING',
  RECEIPT: 'FEED_IN',
  USAGE: 'CONSUMPTION',
  ADJUSTMENT: 'ADJUSTMENT',
};

/** One medicine ledger row, stated in the vocabulary the shared valuation understands. */
export function asLedgerRow(e: MedicineStockEntry): FeedStockEntry {
  return {
    id: e.id, companyId: e.companyId, ingredient: e.medicineId, date: e.date,
    kind: AS_FEED_KIND[e.kind], qtyKg: e.qty, ratePerKg: e.ratePerUnit,
    shedId: e.shedId, batchId: e.batchId, supplier: e.supplier, purchaseRef: e.purchaseRef,
    remarks: e.remarks, createdBy: e.createdBy, createdAt: e.createdAt, synced: e.synced,
  };
}

/** The replayed medicine ledger, keyed by stable item id. */
export function valueMedicines(entries: MedicineStockEntry[]): GodownValuation {
  return valueGodown(entries.map(asLedgerRow));
}

/** The average to book a usage at, and the live stock the usage must come out of. */
export function medicineBasis(entries: MedicineStockEntry[], medicineId: string, date: string) {
  const v = valueMedicines(entries);
  const p = v.at(medicineId, date);
  return { avg: p.avg, stock: p.kg };
}

/** Where the average stands after a receipt at `rate` lands on the current position. */
export function projectedAverage(stockQty: number, stockAvg: number | null, receiptQty: number, receiptRate: number) {
  return blendPrice(stockQty, stockAvg, receiptQty, receiptRate);
}

/** The highest medicine receipt number this device holds for a company and day, or 0. */
export function medicineReceiptHighWater(entries: MedicineStockEntry[], companyId: string, date: string): number {
  return receiptHighWater(
    entries.filter(e => e.companyId === companyId).map(e => e.purchaseRef), 'MED', date,
  );
}

/**
 * Stock receipts are numbered per company, in their own series so they never clash with feed.
 * The device's own series again: the counter answers while it can be reached.
 */
export function nextMedicineRef(entries: MedicineStockEntry[], companyId: string, date: string): string {
  return receiptNo('MED', date, medicineReceiptHighWater(entries, companyId, date) + 1);
}

/* ============================= CURRENT STOCK ============================= */

/** How soon an expiry counts as "expiring". */
export const EXPIRING_WITHIN_DAYS = 30;

export type ExpiryState = 'NONE' | 'OK' | 'EXPIRING' | 'EXPIRED';

export const EXPIRY_LABELS: Record<ExpiryState, string> = {
  NONE: 'No expiry recorded', OK: 'In date', EXPIRING: 'Expiring soon', EXPIRED: 'Expired',
};

/**
 * The item's earliest recorded lot expiry. Only an item that still holds stock is
 * asked this question — a lot that has been used up is not an expiring one.
 */
export function expiryOf(entries: MedicineStockEntry[], today: string): { date: string | null; state: ExpiryState } {
  const dated = entries
    .filter(e => (e.kind === 'OPENING' || e.kind === 'RECEIPT') && e.expiryDate)
    .map(e => e.expiryDate as string)
    .sort();
  const date = dated[0] ?? null;
  if (!date) return { date: null, state: 'NONE' };
  const left = daysBetween(today, date);
  return { date, state: left < 0 ? 'EXPIRED' : left <= EXPIRING_WITHIN_DAYS ? 'EXPIRING' : 'OK' };
}

/** One line of the Current Stock table, with everything read off the ledger. */
export type MedicineStockRow = {
  item: MedicineItem;
  /** Live stock in the item's own unit; negative means the ledger is over-drawn. */
  qty: number;
  avg: number | null;
  value: number;
  /** Units standing with no price basis anywhere — counted, never valued at ₹0. */
  unpricedQty: number;
  low: boolean;
  expiry: { date: string | null; state: ExpiryState };
  movements: number;
  lastActivity: string | null;
};

export type MedicineStockBoard = {
  rows: MedicineStockRow[];
  totals: {
    items: number;
    inStock: number;
    low: number;
    value: number;
    unpricedItems: number;
    expiring: number;
    expired: number;
  };
};

/**
 * Current stock, item by item. Items with no ledger history are shown at zero rather
 * than dropped, because "we have none" is the answer the screen is asked for.
 */
export function medicineStockBoard(
  items: MedicineItem[],
  entries: MedicineStockEntry[],
  asOf: string,
): MedicineStockBoard {
  const valuation = valueMedicines(entries);
  const own = new Map<string, MedicineStockEntry[]>();
  for (const e of entries) {
    const list = own.get(e.medicineId);
    if (list) list.push(e); else own.set(e.medicineId, [e]);
  }

  const rows = items.map<MedicineStockRow>(item => {
    const list = own.get(item.id) ?? [];
    const p = valuation.now(item.id);
    const expiry = expiryOf(list, asOf);
    return {
      item,
      qty: p.kg,
      avg: p.avg,
      value: p.kg > 0 ? p.value : 0,
      unpricedQty: p.kg > 0 ? p.unpricedKg : 0,
      low: p.kg <= item.lowStockThreshold,
      expiry: p.kg > 0 ? expiry : { date: null, state: 'NONE' },
      movements: list.length,
      lastActivity: list.length
        ? list.map(e => e.date).sort()[list.length - 1]
        : null,
    };
  }).sort((a, b) => Number(b.low) - Number(a.low)
    || b.value - a.value
    || a.item.name.localeCompare(b.item.name));

  return {
    rows,
    totals: {
      items: items.length,
      inStock: rows.filter(r => r.qty > 0).length,
      low: rows.filter(r => r.low).length,
      value: rows.reduce((s, r) => s + r.value, 0),
      unpricedItems: rows.filter(r => r.qty > 0 && r.avg === null).length,
      expiring: rows.filter(r => r.expiry.state === 'EXPIRING').length,
      expired: rows.filter(r => r.expiry.state === 'EXPIRED').length,
    },
  };
}

/* ============================= USAGE AS EXPENSE ============================= */

/** What one usage actually cost: the rate frozen on the row, else the average it was booked at. */
export function usageExpenseOf(entry: MedicineStockEntry, valuation?: GodownValuation): number | null {
  if (typeof entry.amount === 'number' && Number.isFinite(entry.amount)) return entry.amount;
  return valuation?.basis(entry.id).value ?? null;
}

/** Medicine issued to sheds in the period — the expense line, derived, never typed. */
export type MedicineCostRow = { shedId: string; cost: number; qty: number; unpricedQty: number; usages: number };

export function medicineCostByShed(
  entries: MedicineStockEntry[],
  range: { from: string; to: string },
): { rows: MedicineCostRow[]; total: number | null; unpricedQty: number } {
  const valuation = valueMedicines(entries);
  const map = new Map<string, MedicineCostRow>();
  let unpricedQty = 0;
  let priced = 0;
  let any = false;
  for (const e of entries) {
    if (e.kind !== 'USAGE' || e.date < range.from || e.date > range.to) continue;
    const cost = usageExpenseOf(e, valuation);
    const line = map.get(e.shedId ?? '') ?? { shedId: e.shedId ?? '', cost: 0, qty: 0, unpricedQty: 0, usages: 0 };
    line.qty += e.qty;
    line.usages++;
    if (cost === null) line.unpricedQty += e.qty;
    else { line.cost += cost; priced += cost; any = true; }
    map.set(e.shedId ?? '', line);
    unpricedQty += cost === null ? e.qty : 0;
  }
  return {
    rows: [...map.values()].filter(r => r.shedId).sort((a, b) => b.cost - a.cost),
    total: any ? priced : null,
    unpricedQty,
  };
}

/** Medicine expense charged to one batch, for the batch's own P&L. */
export function medicineCostForBatch(entries: MedicineStockEntry[], batchId: string): number {
  const valuation = valueMedicines(entries);
  return entries.filter(e => e.kind === 'USAGE' && e.batchId === batchId)
    .reduce((s, e) => s + (usageExpenseOf(e, valuation) ?? 0), 0);
}

/* ============================= LABELS ============================= */

export const MEDICINE_KIND_LABELS: Record<MedicineStockKind, string> = {
  OPENING: 'Opening stock',
  RECEIPT: 'Purchase / receive',
  USAGE: 'Usage',
  ADJUSTMENT: 'Adjustment',
};

/** The ledger's own view of a movement: signed quantity as it should read on screen. */
export function medicineSignedLabel(entry: MedicineStockEntry, item?: MedicineItem): string {
  const unit = item?.unit ?? '';
  const delta = entry.kind === 'USAGE' ? -Math.abs(entry.qty)
    : entry.kind === 'ADJUSTMENT' ? entry.qty
      : Math.abs(entry.qty);
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtIN(Math.abs(delta))} ${unit}`.trim();
}

/** A medicine receipt, named the way the payables table names a feed receipt. */
export const medicineReceiptLabel = (item: MedicineItem | undefined, entry: MedicineStockEntry) =>
  `${item?.name ?? 'Removed item'} · ${fmtIN(entry.qty)} ${item?.unit ?? 'units'}`;
