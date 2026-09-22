import { useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { ageLabel, todayISO } from '@/lib/format';
import {
  batchAgeDays, cumulativeMortality, eggStockTrays, eggSummary,
  feedSummary, liveBirdsOn, saleTotals,
} from '@/lib/calc';

/**
 * Operational metrics for a batch. Scoped through the batch's shed because
 * egg stock, feed and sale logs are shed-level in the new model.
 */
export function useBatchMetrics(batchId: string | undefined) {
  const { batches, mortality, feed, eggs, saleLogs, eggSales, finance } = useCompanyData();

  return useMemo(() => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return null;
    const today = todayISO();
    const live = liveBirdsOn(batch, today, mortality);
    const cumMort = cumulativeMortality(batch.id, mortality, today);
    const mortPct = batch.initialBirds > 0 ? (cumMort / batch.initialBirds) * 100 : 0;
    const todaysEggs = eggSummary(batch.shedId, eggs, today);
    const stock = eggStockTrays(batch.shedId, eggs, saleLogs, today);

    const last30 = new Date(); last30.setDate(last30.getDate() - 29);
    const from30 = last30.toISOString().slice(0, 10);
    const feed30 = feedSummary(batch.shedId, feed, from30, today);

    // Sales are collated at trader level; attribute the batch's own logs.
    const batchLogIds = new Set(saleLogs.filter(l => l.batchId === batch.id).flatMap(l => l.eggSaleId ? [l.eggSaleId] : []));
    const sales = saleTotals(eggSales.filter(s => batchLogIds.has(s.id)));

    const batchFinance = finance.filter(f => f.batchId === batch.id);
    const income = batchFinance.filter(f => f.kind === 'INCOME' || f.kind === 'SALE' || f.kind === 'PAYMENT_IN').reduce((s, f) => s + f.amount, 0);
    const expense = batchFinance.filter(f => f.kind === 'EXPENSE' || f.kind === 'PURCHASE' || f.kind === 'PAYMENT_OUT').reduce((s, f) => s + f.amount, 0);
    const age = ageLabel(batch.placementDate, today);

    return {
      batch, today, live, cumMort, mortPct, age, ageDays: batchAgeDays(batch, today),
      todaysEggs, eggStock: stock, feed30, sales,
      income, expense, balance: income - expense,
    };
  }, [batchId, batches, mortality, feed, eggs, saleLogs, eggSales, finance]);
}
