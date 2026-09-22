import type {
  Batch, EggCollection, EggGrade, EggGradeCounts, EggSale, FeedConsumption,
  FeedStockEntry, MortalityEntry, SaleLog, FeedFormula,
} from '@/types';
import { EGG_GRADES, EMPTY_GRADE_COUNTS } from '@/types';
import { daysBetween, todayISO } from './format';

/* ============================= BIRDS / MORTALITY ============================= */

export function liveBirdsOn(batch: Batch, date: string, mortality: MortalityEntry[]): number {
  const dead = mortality
    .filter(m => m.batchId === batch.id && m.date <= date)
    .reduce((s, m) => s + m.count, 0);
  return Math.max(0, batch.initialBirds - dead);
}

export function cumulativeMortality(batchId: string, mortality: MortalityEntry[], onDate = todayISO()) {
  return mortality
    .filter(m => m.batchId === batchId && m.date <= onDate)
    .reduce((s, m) => s + m.count, 0);
}

export function batchAgeDays(batch: Batch, onDate = todayISO()): number {
  return Math.max(0, daysBetween(batch.placementDate, onDate));
}

/* ============================= EGGS (TRAYS) ============================= */

const GRADE_KEYS: (keyof Pick<EggCollection, 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays'>)[] =
  ['goodTrays', 'brokenTrays', 'doubleTrays', 'smallTrays'];

function gradeOf(key: (typeof GRADE_KEYS)[number]): EggGrade {
  return { goodTrays: 'GOOD', brokenTrays: 'BROKEN', doubleTrays: 'DOUBLE', smallTrays: 'SMALL' }[key] as EggGrade;
}

/** Trays collected per grade across any set of collection entries. */
export function eggGradeTotals(items: EggCollection[]): EggGradeCounts {
  const out = { ...EMPTY_GRADE_COUNTS };
  for (const e of items) for (const k of GRADE_KEYS) out[gradeOf(k)] += e[k] || 0;
  return out;
}

export function gradeTotal(byGrade: EggGradeCounts): number {
  return EGG_GRADES.reduce((s, g) => s + byGrade[g], 0);
}

export function eggSummary(shedId: string, eggs: EggCollection[], onDate = todayISO()) {
  const byGrade = eggGradeTotals(eggs.filter(e => e.shedId === shedId && e.date === onDate));
  return { byGrade, total: gradeTotal(byGrade) };
}

export function eggTotalsRange(shedId: string, eggs: EggCollection[], from: string, to: string) {
  const byGrade = eggGradeTotals(eggs.filter(e => e.shedId === shedId && e.date >= from && e.date <= to));
  return { byGrade, total: gradeTotal(byGrade) };
}

export type GradeStock = { collected: number; dispatched: number; balance: number };

/**
 * Physical egg stock per grade for a shed in TRAYS, as of a date:
 *   collected − dispatched via sale logs of the same grade.
 * Sale logs deduct at creation, so acknowledging or converting to a trader sale
 * must NOT deduct again.
 */
export function eggStockByGrade(
  shedId: string,
  eggs: EggCollection[],
  saleLogs: SaleLog[],
  asOf = todayISO(),
): Record<EggGrade, GradeStock> {
  const collected = eggGradeTotals(eggs.filter(e => e.shedId === shedId && e.date <= asOf));
  const out = {} as Record<EggGrade, GradeStock>;
  for (const g of EGG_GRADES) {
    const dispatched = saleLogs
      .filter(l => l.shedId === shedId && l.date <= asOf && l.grade === g)
      .reduce((s, l) => s + l.trays, 0);
    out[g] = { collected: collected[g], dispatched, balance: collected[g] - dispatched };
  }
  return out;
}

/** All grades combined — used where a shed-level total is what matters. */
export function eggStockTrays(
  shedId: string,
  eggs: EggCollection[],
  saleLogs: SaleLog[],
  asOf = todayISO(),
): GradeStock {
  const byGrade = eggStockByGrade(shedId, eggs, saleLogs, asOf);
  return EGG_GRADES.reduce<GradeStock>(
    (acc, g) => ({
      collected: acc.collected + byGrade[g].collected,
      dispatched: acc.dispatched + byGrade[g].dispatched,
      balance: acc.balance + byGrade[g].balance,
    }),
    { collected: 0, dispatched: 0, balance: 0 },
  );
}

export function saleTotals(sales: EggSale[]) {
  const trays = sales.reduce((s, x) => s + x.trays, 0);
  const amount = sales.reduce((s, x) => s + x.amount, 0);
  return { trays, amount, avgRatePerTray: trays ? amount / trays : 0 };
}

/* ============================= GODOWN (KG) ============================= */

function stockDelta(e: FeedStockEntry): number {
  switch (e.kind) {
    case 'OPENING':
    case 'FEED_IN':
      return e.qtyKg;
    case 'FEED_OUT':
    case 'CONSUMPTION':
      return -e.qtyKg;
    case 'ADJUSTMENT':
      return e.qtyKg; // signed quantity
    default:
      return 0;
  }
}

/** Derived current godown stock per ingredient (KG) from the ledger. */
export function godownBalances(entries: FeedStockEntry[], asOf = todayISO()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (e.date > asOf) continue;
    out[e.ingredient] = (out[e.ingredient] ?? 0) + stockDelta(e);
  }
  return out;
}

export function ingredientBalance(entries: FeedStockEntry[], ingredient: string, asOf = todayISO()): number {
  return entries
    .filter(e => e.ingredient === ingredient && e.date <= asOf)
    .reduce((s, e) => s + stockDelta(e), 0);
}

/* ============================= FEED FORMULAS ============================= */

/** A formula always describes exactly one tonne of finished mix. */
export const FORMULA_TONNE_KG = 1000;
/** Weighing rounds to grams, so a mix within ±1 kg of a tonne is accepted. */
export const FORMULA_TOLERANCE_KG = 1;

export function formulaTotalKg(items: { kgPerTonne: number }[]): number {
  return Number(items.reduce((s, i) => s + (i.kgPerTonne || 0), 0).toFixed(2));
}

/** KG per tonne maps 1:10 onto a percentage of the mix. */
export function formulaPct(kgPerTonne: number): number {
  return Number((kgPerTonne / 10).toFixed(2));
}

/** Null when the mix totals one tonne within tolerance. */
export function formulaTotalError(totalKg: number): string | null {
  const diff = Number((totalKg - FORMULA_TONNE_KG).toFixed(2));
  if (Math.abs(diff) <= FORMULA_TOLERANCE_KG) return null;
  return diff > 0
    ? `Mix totals ${diff} kg over one tonne`
    : `Mix is ${Math.abs(diff)} kg short of one tonne`;
}

export function formulaDeduction(formula: FeedFormula, tonnes: number): { ingredient: string; kg: number }[] {
  return formula.items.map(it => ({
    ingredient: it.ingredient,
    kg: Number((it.kgPerTonne * tonnes).toFixed(2)),
  }));
}

/** The version currently applied to new consumption for a shed. */
export function currentFormula(shedId: string, formulas: FeedFormula[]): FeedFormula | null {
  return formulas
    .filter(f => f.shedId === shedId && f.status === 'ACTIVE')
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0] ?? null;
}

/**
 * The version in force on a date. The activated version drives entries from the newest
 * effective date in the family onward; anything older reads back through the family
 * timeline, so reactivating an old mix never rewrites the days a later version fed.
 */
export function formulaForDate(shedId: string, date: string, formulas: FeedFormula[]): FeedFormula | null {
  const byDate = (a: FeedFormula, b: FeedFormula) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom) || a.version - b.version;
  const current = currentFormula(shedId, formulas);
  const family = current
    ? formulas.filter(f => f.familyId === current.familyId)
    : formulas.filter(f => f.shedId === shedId);
  const newest = family.slice().sort(byDate).at(-1);
  if (current && date >= current.effectiveFrom && (!newest || date >= newest.effectiveFrom)) return current;
  return family.filter(f => f.effectiveFrom <= date).sort(byDate).at(-1) ?? null;
}

/** Entries fed by this exact version — pinned records first, date resolution for older ones. */
export function formulaUsage(formula: FeedFormula, feed: FeedConsumption[], formulas: FeedFormula[]): FeedConsumption[] {
  return feed.filter(x => x.companyId === formula.companyId && (
    x.formulaId
      ? x.formulaId === formula.id
      : x.shedId === formula.shedId && formulaForDate(x.shedId, x.date, formulas)?.id === formula.id
  ));
}

/** Snapshot first, so a later formula edit can never rewrite history. */
export function consumptionDeduction(entry: FeedConsumption, formulas: FeedFormula[]): { ingredient: string; kg: number }[] {
  if (entry.deduction?.length) return entry.deduction;
  const version = entry.formulaId
    ? formulas.find(f => f.id === entry.formulaId) ?? null
    : formulaForDate(entry.shedId, entry.date, formulas);
  return version ? formulaDeduction(version, entry.tonnes) : [];
}

export function formulaCostPerTonne(formula: FeedFormula): number {
  return formula.items.reduce((s, it) => s + it.kgPerTonne * (it.costPerKg ?? 0), 0);
}

export function feedSummary(shedId: string, feed: FeedConsumption[], from: string, to: string) {
  const items = feed.filter(f => f.shedId === shedId && f.date >= from && f.date <= to);
  return {
    tonnes: items.reduce((s, f) => s + f.tonnes, 0),
    kg: items.reduce((s, f) => s + f.tonnes * 1000, 0),
  };
}
