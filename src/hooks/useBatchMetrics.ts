import { useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { ageLabel, todayISO } from '@/lib/format';
import {
  batchAgeDays, cumulativeMortality, eggStockTrays, eggSummary,
  feedSummary, liveBirdsOn, saleEntryTotals,
} from '@/lib/calc';
import { usageExpenseOf, valueMedicines } from '@/lib/medicines';
import { ledgerOrder } from '@/components/medicine/medicineMeta';

/**
 * Operational metrics for a batch. Scoped through the batch's shed because
 * egg stock, feed and sale entries are shed-level in the new model.
 */
export function useBatchMetrics(batchId: string | undefined) {
  const { batches, mortality, feed, eggs, saleEntries, finance, medicineStock } = useCompanyData();

  return useMemo(() => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return null;
    const today = todayISO();
    const live = liveBirdsOn(batch, today, mortality);
    const cumMort = cumulativeMortality(batch.id, mortality, today);
    const mortPct = batch.initialBirds > 0 ? (cumMort / batch.initialBirds) * 100 : 0;
    const todaysEggs = eggSummary(batch.shedId, eggs, today);
    const stock = eggStockTrays(batch.shedId, eggs, saleEntries, today);

    const last30 = new Date(); last30.setDate(last30.getDate() - 29);
    const from30 = last30.toISOString().slice(0, 10);
    const feed30 = feedSummary(batch.shedId, feed, from30, today);

    // A sale entry belongs to this batch where it took trays from its shed.
    const sales = saleEntryTotals(saleEntries.filter(e => e.lines.some(l => l.shedId === batch.shedId)));

    const batchFinance = finance.filter(f => f.batchId === batch.id);
    const income = batchFinance.filter(f => f.kind === 'INCOME' || f.kind === 'SALE' || f.kind === 'PAYMENT_IN').reduce((s, f) => s + f.amount, 0);
    const expense = batchFinance.filter(f => f.kind === 'EXPENSE' || f.kind === 'PURCHASE' || f.kind === 'PAYMENT_OUT').reduce((s, f) => s + f.amount, 0);
    const age = ageLabel(batch.placementDate, today);

    // Medicine is the one expense that never appears as a Finance row: it is stock leaving
    // the store for this flock, so its cost comes off the usage ledger and each row's frozen
    // rate — a later purchase cannot restate what this batch was already charged.
    const medValuation = valueMedicines(medicineStock);
    const medicineUses = medicineStock
      .filter(e => e.batchId === batch.id && e.kind === 'USAGE')
      .sort(ledgerOrder);
    const medicineCosts = medicineUses.map(e => usageExpenseOf(e, medValuation));
    const medicineExpense = medicineCosts.reduce<number>((s, c) => s + (c ?? 0), 0);
    const medicineUnpriced = medicineCosts.filter(c => c === null).length;

    return {
      batch, today, live, cumMort, mortPct, age, ageDays: batchAgeDays(batch, today),
      todaysEggs, eggStock: stock, feed30, sales,
      income, expense, balance: income - expense,
      medicine: { uses: medicineUses, expense: medicineExpense, unpriced: medicineUnpriced },
    };
  }, [batchId, batches, mortality, feed, eggs, saleEntries, finance, medicineStock]);
}
