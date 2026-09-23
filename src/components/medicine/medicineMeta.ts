import {
  Boxes, PackagePlus, Pill, SlidersHorizontal, Syringe,
} from 'lucide-react';
import type { Tone } from '@/components/ui/Card';
import { fmtIN } from '@/lib/format';
import { usageExpenseOf } from '@/lib/medicines';
import type { ExpiryState } from '@/lib/medicines';
import type { MedicineItem, MedicineStockEntry, MedicineStockKind } from '@/types';
import type { GodownValuation } from '@/lib/valuation';

/**
 * The medicine ledger's visual vocabulary, kept beside the godown's so the same kind of
 * movement reads the same way in both stores.
 */
export const MEDICINE_KIND_META: Record<MedicineStockKind, { tone: Tone; Icon: typeof Boxes }> = {
  OPENING: { tone: 'brand', Icon: Boxes },
  RECEIPT: { tone: 'success', Icon: PackagePlus },
  USAGE: { tone: 'accent', Icon: Pill },
  ADJUSTMENT: { tone: 'neutral', Icon: SlidersHorizontal },
};

/** A vaccine going into a flock reads as a syringe; a medicine reads as a dose. */
export function kindMetaFor(entry: MedicineStockEntry, item?: MedicineItem) {
  const meta = MEDICINE_KIND_META[entry.kind];
  return entry.kind === 'USAGE' && item?.category === 'VACCINE' ? { ...meta, Icon: Syringe } : meta;
}

export const EXPIRY_TONE: Record<ExpiryState, Tone> = {
  NONE: 'neutral', OK: 'success', EXPIRING: 'warn', EXPIRED: 'danger',
};

/** Stock is counted in the product's own unit, never forced into KG (§4). */
export function unitQty(n: number, unit: string): string {
  return `${fmtIN(Math.abs(n), Number.isInteger(n) ? 0 : 2)} ${unit}`.trim();
}

/** The signed quantity a ledger row moved. */
export function signedQty(entry: MedicineStockEntry, unit: string): string {
  const delta = entryDelta(entry);
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${unitQty(delta, unit)}`;
}

export function entryDelta(entry: MedicineStockEntry): number {
  return entry.kind === 'USAGE' ? -Math.abs(entry.qty)
    : entry.kind === 'ADJUSTMENT' ? entry.qty
      : Math.abs(entry.qty);
}

export const entryIncoming = (entry: MedicineStockEntry) => entryDelta(entry) > 0;

/** What one row cost or fetched, preferring the money frozen on the row itself (§9). */
export function entryValue(entry: MedicineStockEntry, valuation?: GodownValuation): number | null {
  if (entry.kind === 'USAGE') return usageExpenseOf(entry, valuation);
  return valuation?.basis(entry.id).value ?? null;
}

/** Newest movement first — the order every ledger in this app reads (§ history). */
export const ledgerOrder = (a: MedicineStockEntry, b: MedicineStockEntry) =>
  b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id);

export const byNewest = (entries: MedicineStockEntry[]) => [...entries].sort(ledgerOrder);

/** Rows already in ledger order, folded into the days they belong to. */
export function groupByDay(entries: MedicineStockEntry[]): { date: string; rows: MedicineStockEntry[] }[] {
  const out: { date: string; rows: MedicineStockEntry[] }[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) last.rows.push(e);
    else out.push({ date: e.date, rows: [e] });
  }
  return out;
}

/** Per-kind totals a mixed-unit store may honestly report: rows and money, never summed units. */
export type MedicineLedgerTotals = Record<MedicineStockKind, { count: number; qty: number; value: number | null }>;

export function ledgerTotals(entries: MedicineStockEntry[], valuation: GodownValuation): MedicineLedgerTotals {
  const out = {
    OPENING: { count: 0, qty: 0, value: null as number | null },
    RECEIPT: { count: 0, qty: 0, value: null as number | null },
    USAGE: { count: 0, qty: 0, value: null as number | null },
    ADJUSTMENT: { count: 0, qty: 0, value: null as number | null },
  } as MedicineLedgerTotals;
  for (const e of entries) {
    const bucket = out[e.kind];
    bucket.count++;
    bucket.qty += Math.abs(e.qty);
    const v = entryValue(e, valuation);
    if (v !== null) bucket.value = (bucket.value ?? 0) + v;
  }
  return out;
}
