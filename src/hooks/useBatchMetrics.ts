import { useMemo } from 'react';
import { useApp } from '@/store/app';
import type { Batch } from '@/types';
import { ageLabel, todayISO } from '@/lib/format';
import {
  batchAgeDays, cumulativeMortality, eggSummary, fcrForBatch,
  feedSummary, liveBirdsOn, productionPct, saleTotals,
} from '@/lib/calc';

export function useBatchMetrics(batchId: string | undefined) {
  const batches = useApp(s => s.batches);
  const mortality = useApp(s => s.mortality);
  const feed = useApp(s => s.feed);
  const eggs = useApp(s => s.eggs);
  const weights = useApp(s => s.weights);
  const eggSales = useApp(s => s.eggSales);
  const finance = useApp(s => s.finance);

  return useMemo(() => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return null;
    const today = todayISO();
    const live = liveBirdsOn(batch, today, mortality);
    const cumMort = cumulativeMortality(batch.id, mortality, today);
    const mortPct = batch.initialBirds > 0 ? (cumMort / batch.initialBirds) * 100 : 0;
    const todaysEggs = eggSummary(batch.id, eggs, today);
    const prodPct = productionPct(todaysEggs.good + todaysEggs.damaged + todaysEggs.cracked, live);
    const fcr = fcrForBatch(batch.id, feed, weights, mortality, batch, today);
    const last30 = new Date(); last30.setDate(last30.getDate() - 29);
    const from30 = last30.toISOString().slice(0, 10);
    const f30 = feedSummary(batch.id, feed, from30, today);
    const sales = saleTotals(eggSales.filter(s => s.batchId === batch.id));
    const batchFinance = finance.filter(f => f.batchId === batch.id);
    const income = batchFinance.filter(f => f.kind === 'INCOME' || f.kind === 'SALE' || f.kind === 'PAYMENT_IN').reduce((s, f) => s + f.amount, 0);
    const expense = batchFinance.filter(f => f.kind === 'EXPENSE' || f.kind === 'PURCHASE' || f.kind === 'PAYMENT_OUT').reduce((s, f) => s + f.amount, 0);
    const age = ageLabel(batch.placementDate, today);
    return {
      batch, today, live, cumMort, mortPct, age,
      todaysEggs, prodPct, fcr, feed30: f30, sales,
      income, expense, balance: income - expense,
      feedPerBirdG: live > 0 ? (f30.kg * 1000) / (live * 30) : 0,
    };
  }, [batchId, batches, mortality, feed, eggs, weights, eggSales, finance]);
}

export function useDailySeries(batchId: string | undefined, days = 7) {
  const mortality = useApp(s => s.mortality);
  const feed = useApp(s => s.feed);
  const eggs = useApp(s => s.eggs);
  const batches = useApp(s => s.batches);

  return useMemo(() => {
    if (!batchId) return { labels: [] as string[], mortality: [] as number[], mortalityCum: [] as number[], feedBags: [] as number[], feedPerBird: [] as number[], eggsGood: [] as number[], productionPct: [] as number[], dates: [] as string[] };
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return { labels: [], mortality: [], mortalityCum: [], feedBags: [], feedPerBird: [], eggsGood: [], productionPct: [], dates: [] };
    const out = { labels: [] as string[], dates: [] as string[], mortality: [] as number[], mortalityCum: [] as number[], feedBags: [] as number[], feedPerBird: [] as number[], eggsGood: [] as number[], productionPct: [] as number[] };
    let cum = cumulativeMortality(batchId, mortality, (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); })());
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const m = mortality.filter(x => x.batchId === batchId && x.date === date).reduce((s, x) => s + x.count, 0);
      cum += m;
      const f = feed.filter(x => x.batchId === batchId && x.date === date).reduce((s, x) => s + x.bags, 0);
      const live = liveBirdsOn(batch, date, mortality);
      const e = eggs.filter(x => x.batchId === batchId && x.date === date).reduce((s, x) => s + x.good, 0);
      out.dates.push(date);
      out.labels.push(`D${batchAgeDays(batch, date)}`);
      out.mortality.push(m);
      out.mortalityCum.push(cum);
      out.feedBags.push(f);
      out.feedPerBird.push(live > 0 ? Math.round((f * 50 * 1000) / live) : 0);
      out.eggsGood.push(e);
      out.productionPct.push(Number(productionPct(e, live).toFixed(2)));
    }
    return out;
  }, [batchId, days, mortality, feed, eggs, batches]);
}
