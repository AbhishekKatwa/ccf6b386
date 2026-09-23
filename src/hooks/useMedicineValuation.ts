import { useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { valueMedicines } from '@/lib/medicines';
import type { MedicineItem, MedicineStockEntry } from '@/types';
import type { GodownValuation } from '@/lib/valuation';

/**
 * The medicine & vaccine ledger read through the godown's own weighted-average replay —
 * the same engine, a second set of rows. Stock rows point at a catalogue id, so `itemOf`
 * resolves that id back to the product rather than matching on a typed name (§3).
 */
export function useMedicineValuation(): {
  valuation: GodownValuation;
  entries: MedicineStockEntry[];
  items: MedicineItem[];
  itemOf: (medicineId: string) => MedicineItem | undefined;
} {
  const { medicineStock, medicineItems } = useCompanyData();
  const valuation = useMemo(() => valueMedicines(medicineStock), [medicineStock]);
  const byId = useMemo(() => new Map(medicineItems.map(i => [i.id, i])), [medicineItems]);
  return useMemo(() => ({
    valuation,
    entries: medicineStock,
    items: medicineItems,
    itemOf: (medicineId: string) => byId.get(medicineId),
  }), [valuation, medicineStock, medicineItems, byId]);
}
