import type { Batch, FeedFormula } from '@/types';
import { formulaDeduction, formulaForDate } from './calc';
import { fin } from './analytics';

/**
 * Feed stock coverage — how long the shelf lasts against what the live batches are
 * expected to eat. A planning read of each shed's current formula version and the
 * intake the owner sets on a batch: it books nothing, and the actual feed ledger
 * stays the operational record.
 */

/** The day bands the coverage views colour by. The kg reorder rule is a separate thing in calc. */
export const COVERAGE_CRITICAL_DAYS = 3;
export const COVERAGE_LOW_DAYS = 7;

export type CoverageStatus = 'IDLE' | 'CRITICAL' | 'LOW' | 'HEALTHY';

/** A live batch the forecast had to leave out, and why. */
export interface CoverageBlocker {
  batchId: string;
  batchCode: string;
  shedName: string;
  reason: 'NO_INTAKE' | 'NO_FORMULA';
}

/** One batch's expected daily draw of one ingredient, with the mix version behind it. */
export interface CoverageSource {
  batchId: string;
  batchCode: string;
  shedName: string;
  tonnesPerDay: number;
  formulaName: string;
  formulaVersion: number;
  kgPerTonne: number;
  dailyKg: number;
}

export interface FeedForecast {
  dailyKg: Map<string, number>;
  contributors: Map<string, CoverageSource[]>;
  blockers: CoverageBlocker[];
  /** Live batches whose intake is set and whose shed has a formula in force. */
  counted: number;
  totalDailyKg: number;
}

export interface IngredientCoverage {
  ingredient: string;
  dailyKg: number;
  contributors: CoverageSource[];
  stockKg: number;
  /** null when no batch is expected to eat this ingredient — never a fake infinity. */
  days: number | null;
  status: CoverageStatus;
}

/**
 * Expected daily ingredient use across the ACTIVE batches only: a batch counts when it
 * has an approximate intake above zero and its shed has a formula in force today.
 * Planned and closed batches are left out, as is any batch that cannot be priced.
 */
export function feedForecast(
  batches: Batch[],
  formulas: FeedFormula[],
  today: string,
  shedName: (shedId: string) => string = () => 'Shed',
): FeedForecast {
  const dailyKg = new Map<string, number>();
  const contributors = new Map<string, CoverageSource[]>();
  const blockers: CoverageBlocker[] = [];
  let counted = 0;
  let totalDailyKg = 0;

  for (const b of batches) {
    if (b.status !== 'ACTIVE') continue;
    const who = { batchId: b.id, batchCode: b.code, shedName: shedName(b.shedId) };
    const intake = fin(b.approximateFeedTonnesPerDay);
    if (intake === null || intake <= 0) {
      blockers.push({ ...who, reason: 'NO_INTAKE' });
      continue;
    }
    const formula = formulaForDate(b.shedId, today, formulas);
    if (!formula) {
      blockers.push({ ...who, reason: 'NO_FORMULA' });
      continue;
    }
    counted++;
    const perTonne = new Map<string, number>();
    for (const it of formula.items) {
      perTonne.set(it.ingredient, (perTonne.get(it.ingredient) ?? 0) + (fin(it.kgPerTonne) ?? 0));
    }
    for (const d of formulaDeduction(formula, intake)) {
      if (!(d.kg > 0)) continue;
      dailyKg.set(d.ingredient, Number(((dailyKg.get(d.ingredient) ?? 0) + d.kg).toFixed(2)));
      const list = contributors.get(d.ingredient) ?? [];
      list.push({
        ...who, tonnesPerDay: intake, formulaName: formula.name,
        formulaVersion: formula.version, kgPerTonne: perTonne.get(d.ingredient) ?? 0, dailyKg: d.kg,
      });
      contributors.set(d.ingredient, list);
      totalDailyKg = Number((totalDailyKg + d.kg).toFixed(2));
    }
  }

  for (const list of contributors.values()) list.sort((a, b) => b.dailyKg - a.dailyKg);
  return { dailyKg, contributors, blockers, counted, totalDailyKg };
}

/** Days the shelf would last at the expected rate: 0 when there is nothing left to eat. */
export function daysOfStock(stockKg: number, dailyKg: number): number | null {
  if (!(dailyKg > 0)) return null;
  return Number((Math.max(0, fin(stockKg) ?? 0) / dailyKg).toFixed(1));
}

export function coverageStatus(days: number | null): CoverageStatus {
  if (days === null) return 'IDLE';
  if (days < COVERAGE_CRITICAL_DAYS) return 'CRITICAL';
  if (days < COVERAGE_LOW_DAYS) return 'LOW';
  return 'HEALTHY';
}

/** One ingredient's standing: the shelf against the forecast. */
export function coverageOf(forecast: FeedForecast, ingredient: string, stockKg: number): IngredientCoverage {
  const daily = forecast.dailyKg.get(ingredient) ?? 0;
  const days = daysOfStock(stockKg, daily);
  return {
    ingredient,
    dailyKg: daily,
    contributors: forecast.contributors.get(ingredient) ?? [],
    stockKg,
    days,
    status: coverageStatus(days),
  };
}

/**
 * Coverage for the godown's own ingredient list, plus anything a live batch is expected
 * to eat that the shelf does not hold at all — a gap is a gap.
 */
export function coverageRows(
  forecast: FeedForecast,
  ingredients: Iterable<string>,
  stockOf: (ingredient: string) => number,
): IngredientCoverage[] {
  const all = new Set<string>(ingredients);
  for (const ing of forecast.dailyKg.keys()) all.add(ing);
  return Array.from(all)
    .sort((a, b) => a.localeCompare(b))
    .map(ing => coverageOf(forecast, ing, Math.max(0, stockOf(ing))));
}

export interface CoverageBands {
  under3: number;
  under7: number;
  /** The tightest shelf that something is actually eating. */
  lowest: IngredientCoverage | null;
  /** Expected every day across every counted batch, in KG. */
  expectedDailyKg: number;
}

/** The farm-level read of coverage: how many shelves are about to run dry. */
export function coverageBands(rows: IngredientCoverage[]): CoverageBands {
  const eaten = rows.filter(r => r.days !== null);
  const sorted = eaten.slice().sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  return {
    under3: sorted.filter(r => r.days! < COVERAGE_CRITICAL_DAYS).length,
    under7: sorted.filter(r => r.days! < COVERAGE_LOW_DAYS).length,
    lowest: sorted[0] ?? null,
    expectedDailyKg: Number(rows.reduce((s, r) => s + r.dailyKg, 0).toFixed(2)),
  };
}

/** Lowest coverage first, with the shelves nothing is eating kept at the end. */
export function compareCoverage(a: IngredientCoverage, b: IngredientCoverage): number {
  if (a.days === null && b.days === null) return a.ingredient.localeCompare(b.ingredient);
  if (a.days === null) return 1;
  if (b.days === null) return -1;
  return a.days - b.days || a.ingredient.localeCompare(b.ingredient);
}

/** "~5.2 days"; a shelf nothing is expected to eat reads as the dash, never as forever. */
export function fmtDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'out today';
  const unit = days === 1 ? 'day' : 'days';
  return `~${days % 1 === 0 ? days.toFixed(0) : days.toFixed(1)} ${unit}`;
}
