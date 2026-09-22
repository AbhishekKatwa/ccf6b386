import type {
  Batch, EggCollection, EggSale, FeedConsumption, MortalityEntry, WeightEntry,
} from '@/types';
import { daysBetween, todayISO } from './format';

export function liveBirdsOn(batch: Batch, date: string, mortality: MortalityEntry[]): number {
  const cutoff = date;
  const dead = mortality
    .filter(m => m.batchId === batch.id && m.date <= cutoff)
    .reduce((s, m) => s + m.count, 0);
  return Math.max(0, batch.initialBirds - dead);
}

export function cumulativeMortality(batchId: string, mortality: MortalityEntry[], onDate = todayISO()) {
  const items = mortality.filter(m => m.batchId === batchId && m.date <= onDate);
  return items.reduce((s, m) => s + m.count, 0);
}

export function productionPct(eggs: number, liveBirds: number): number {
  if (liveBirds <= 0) return 0;
  return (eggs / liveBirds) * 100;
}

export function batchAgeDays(batch: Batch, onDate = todayISO()): number {
  return Math.max(0, daysBetween(batch.placementDate, onDate));
}

export function fcrForBatch(
  batchId: string,
  feed: FeedConsumption[],
  weights: WeightEntry[],
  mortality: MortalityEntry[],
  batch: Batch,
  asOf = todayISO(),
): { totalFeedKg: number; totalBirdWeightKg: number; fcr: number } {
  const totalFeedKg = feed
    .filter(f => f.batchId === batchId && f.date <= asOf)
    .reduce((s, f) => s + f.bags * f.bagWeightKg, 0);

  const latestWeight = weights
    .filter(w => w.batchId === batchId && w.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();

  const live = liveBirdsOn(batch, asOf, mortality);
  const avgKg = latestWeight?.avgWeightKg ?? 0;
  const totalBirdWeightKg = live * avgKg;
  const fcr = totalBirdWeightKg > 0 ? totalFeedKg / totalBirdWeightKg : 0;
  return { totalFeedKg, totalBirdWeightKg, fcr };
}

export function eggSummary(batchId: string, eggs: EggCollection[], onDate = todayISO()) {
  const todays = eggs.filter(e => e.batchId === batchId && e.date === onDate);
  const total = todays.reduce((s, e) => s + e.good + e.damaged + e.cracked, 0);
  const good = todays.reduce((s, e) => s + e.good, 0);
  const damaged = todays.reduce((s, e) => s + e.damaged, 0);
  const cracked = todays.reduce((s, e) => s + e.cracked, 0);
  return { total, good, damaged, cracked };
}

export function eggTotalsRange(batchId: string, eggs: EggCollection[], from: string, to: string) {
  const items = eggs.filter(e => e.batchId === batchId && e.date >= from && e.date <= to);
  return {
    good: items.reduce((s, e) => s + e.good, 0),
    damaged: items.reduce((s, e) => s + e.damaged, 0),
    cracked: items.reduce((s, e) => s + e.cracked, 0),
    total: items.reduce((s, e) => s + e.good + e.damaged + e.cracked, 0),
  };
}

export function saleTotals(sales: EggSale[]) {
  const eggs = sales.reduce((s, x) => s + x.trays * x.eggsPerTray, 0);
  const trays = sales.reduce((s, x) => s + x.trays, 0);
  const amount = sales.reduce((s, x) => s + x.trays * x.eggsPerTray * x.ratePerEgg, 0);
  return { trays, eggs, amount, avgRate: eggs ? amount / eggs : 0 };
}

export function feedSummary(batchId: string, feed: FeedConsumption[], from: string, to: string) {
  const items = feed.filter(f => f.batchId === batchId && f.date >= from && f.date <= to);
  return {
    bags: items.reduce((s, f) => s + f.bags, 0),
    kg: items.reduce((s, f) => s + f.bags * f.bagWeightKg, 0),
  };
}
