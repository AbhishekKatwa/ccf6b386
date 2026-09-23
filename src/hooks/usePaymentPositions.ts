import { useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { salePositions, type SalePosition } from '@/lib/calc';
import {
  medicinePurchasePositions, purchasePositions, type PurchasePosition,
} from '@/lib/purchasing';

/**
 * What is owed, in both directions: purchases the farm has taken on credit, and loads a
 * trader has not finished paying for. Both are read off the ledgers that already exist —
 * a receipt against the finance rows linked to it, a sale against the receipts on the
 * trader's ledger — so nothing here stores a second set of amounts.
 */

/**
 * Every stock receipt the company holds, with what has been paid against it. Newest first.
 * The godown and the medicine store raise payables into one list, because the money that
 * settles them is one common payment ledger.
 */
export function usePurchasePositions(): PurchasePosition[] {
  const { feedStock, medicineStock, medicineItems, finance } = useCompanyData();
  return useMemo(() => [
    ...purchasePositions(feedStock, finance),
    ...medicinePurchasePositions(medicineStock, medicineItems, finance),
  ].sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.id.localeCompare(a.entry.id)),
  [feedStock, medicineStock, medicineItems, finance]);
}

/** Look a receipt up by its ledger id, for a detail sheet that has the row but not its position. */
export function usePurchaseLookup(): (entryId: string | null | undefined) => PurchasePosition | null {
  const positions = usePurchasePositions();
  return useMemo(() => {
    const byId = new Map(positions.map(p => [p.entry.id, p]));
    return (entryId: string | null | undefined) => (entryId ? byId.get(entryId) ?? null : null);
  }, [positions]);
}

/** Every billed load with the money that arrived against it. Newest first. */
export function useSalePositions(): SalePosition[] {
  const { saleEntries, traderTxns } = useCompanyData();
  return useMemo(() => salePositions(saleEntries, traderTxns), [saleEntries, traderTxns]);
}
