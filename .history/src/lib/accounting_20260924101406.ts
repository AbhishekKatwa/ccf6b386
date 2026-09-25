/**
 * Farm accounting model for the Finance module.
 *
 * The money ledger (FinanceTxn) records cash: money in, money out. This layer
 * turns that plus the derived godown numbers into a proper accrual P&L, holding
 * one rule above all — GODOWN IS INVENTORY, SHEDS ARE OPERATING UNITS. So:
 *
 *  - Buying feed into the godown, or medicine into the store, is an inventory
 *    acquisition, NOT a period expense. Charging it as expense AND charging the derived
 *    consumption would be double counting (spec §6, §24). The consumed feed, valued as it
 *    leaves the godown, and the medicine drawn for a flock, valued as it leaves the shelf,
 *    are the shed's expenses.
 *  - Livestock is the exception the farm asked for: a chick purchase is charged as expense
 *    on the day the money is paid. A flock has no issue ledger, so nothing would ever
 *    realise its cost later, and leaving it out hid the largest sum on the farm.
 *  - A godown shortage is one economically meaningful loss. It is recognised once
 *    and shared across sheds so the total allocated equals the source exactly.
 *  - Nothing is invented. An unmapped amount stays "Unallocated" and is reported;
 *    an unpriced quantity is counted, never valued at zero.
 *
 * Amounts are kept unrounded and only rounded at the end, so totals add up.
 */
import type { Batch, FeedConsumption, FeedFormula, FeedStockEntry, FinanceTxn, MedicineStockEntry, Shed, TxnKind } from '@/types';
import {
  feedCostByShed, godownShortages, inRange, isISODate,
  fin, type Range, type ShedFeedCost, type ShortageRow,
} from './analytics';
import { shiftDate } from './format';
import { medicineCostByShed } from './medicines';
import { valueGodown } from './valuation';

const round = (n: number) => Number(n.toFixed(2));

/** Inflow kinds — money the farm received. Unchanged from the ledger's own rule. */
export const isInflow = (k: TxnKind) => k === 'INCOME' || k === 'SALE' || k === 'PAYMENT_IN';

/**
 * Categories that buy consumable stock in — inventory, never a period expense. Medicine and
 * vaccine purchases sit here for the same reason feed does: the money left, but the cost is
 * realised when a dose is drawn for a flock, not on the day it was bought. Livestock is
 * deliberately absent — see `isLivestockPurchase`.
 */
export const FEED_PURCHASE_CATEGORY = 'Feed Purchase';
export const MEDICINE_PURCHASE_CATEGORY = 'Medicine Purchase';
export const CHICK_PURCHASE_CATEGORY = 'Chick Purchase';
export const INVENTORY_CATEGORIES = new Set([FEED_PURCHASE_CATEGORY, MEDICINE_PURCHASE_CATEGORY]);

/** The heads the money forms offer. One list, so a category means the same thing everywhere. */
export const FINANCE_CATEGORIES = [
  'Egg Sale', 'Bird Sale', 'Manure Sale',
  FEED_PURCHASE_CATEGORY, MEDICINE_PURCHASE_CATEGORY, CHICK_PURCHASE_CATEGORY,
  'Medicine', 'Labour', 'Electricity', 'Transport', 'Maintenance', 'Other',
];

/**
 * Money paid for birds. A flock is never drawn out of a store, so nothing realises its cost
 * later — it is expense on the day it is paid, whichever kind the row was entered as.
 */
export function isLivestockPurchase(t: FinanceTxn): boolean {
  return !isInflow(t.kind) && t.category === CHICK_PURCHASE_CATEGORY;
}

/**
 * Is this outflow an inventory acquisition rather than operating spend? Feed and medicine
 * build the godown and the store; their cost is realised as a shed draws them, so they must
 * not also stand as an expense the day the money left. Livestock is exempted by rule.
 */
export function isInventoryPurchase(t: FinanceTxn): boolean {
  if (isInflow(t.kind) || isLivestockPurchase(t)) return false;
  return t.kind === 'PURCHASE' || INVENTORY_CATEGORIES.has(t.category);
}

/** Which accounting location a row belongs to: a shed (via its batch), the godown, or nothing yet. */
export type Scope =
  | { kind: 'shed'; shedId: string }
  | { kind: 'godown' }
  | { kind: 'unallocated' };

export function scopeOf(t: FinanceTxn, batchShed: Map<string, string>): Scope {
  if (t.batchId) {
    const shedId = batchShed.get(t.batchId);
    if (shedId) return { kind: 'shed', shedId };
    return { kind: 'unallocated' }; // a batch that no longer resolves is not silently dropped
  }
  if (t.godown) return { kind: 'godown' };
  return { kind: 'unallocated' };
}

/* ============================= SHED / FARM P&L ============================= */

export type ShedPnl = {
  shedId: string; shedName: string;
  income: number;
  directExpense: number;
  feedExpense: number;
  medicineExpense: number;      // medicine & vaccine drawn for this shed, at the rate booked
  sharedExpense: number;      // allocated godown shortage
  totalExpense: number;       // direct + feed + medicine + shared (excludes inventory purchases)
  profit: number;
  hasFeed: boolean;           // shed recorded consumption
  feedTonnes: number;
  unpricedFeedKg: number;     // consumed kg with no rate anywhere — counted, not zeroed
  hasMedicine: boolean;       // shed recorded a usage
  unpricedMedicineQty: number; // units drawn with no rate — counted, not zeroed
  incomeCount: number;
  directCount: number;
};

export type FarmPnl = {
  periodTxns: FinanceTxn[];
  sheds: ShedPnl[];
  income: number;                 // every inflow in period
  operatingExpense: number;       // every non-inventory outflow in period
  inventoryPurchase: number;      // feed/medicine purchases — inventory, memo only
  chickExpense: number;           // livestock bought in the period — inside operatingExpense
  feedExpense: number;            // derived consumption cost
  medicineExpense: number;        // derived medicine/vaccine usage cost, same basis as feed
  unpricedMedicineQty: number;    // units drawn with no rate anywhere
  shortageExpense: number | null; // priced shortage total, null when nothing priced
  godownOperatingExpense: number; // farm-level retained (godown operating spend)
  unallocatedExpense: number;
  unallocatedIncome: number;
  unallocatedCount: number;
  totalExpense: number;           // operating outflows + feed consumption + medicine usage + shortage
  net: number;                    // income − totalExpense
  moneyIn: number;                // cash view
  moneyOut: number;               // cash view (includes inventory purchases)
  cashNet: number;
  allocatedShortage: number;      // what landed on sheds
  unallocatedShortage: number;    // shortage that could not be spread (no feed consumed)
  shortageUnpricedKg: number;
  missingFormula: boolean;
  warnings: string[];
};

/**
 * Build the reconciled P&L for the period.
 *
 * Shed expense = operating outflows mapped to that shed + its derived feed cost
 * + its medicine drawn for the flock + its share of the godown shortage. Feed and
 * medicine purchases are excluded from every expense total; they surface as an
 * inventory memo and in the cash view. Chick purchase is not excluded — it is an
 * operating outflow of the day it was paid.
 * Farm totals reconcile as SUM(sheds) + farm-level retained = farm expense.
 */
export function computeFarmPnl(args: {
  finance: FinanceTxn[];
  batches: Batch[];
  sheds: Shed[];
  feed: FeedConsumption[];
  feedStock: FeedStockEntry[];
  medicineStock: MedicineStockEntry[];
  feedFormulas: FeedFormula[];
  range: Range;
}): FarmPnl {
  const { finance, batches, sheds, feed, feedStock, medicineStock, feedFormulas, range } = args;
  const periodTxns = finance.filter(t => inRange(t.date, range) && isISODate(t.date) && fin(t.amount) !== null);
  const batchShed = new Map(batches.map(b => [b.id, b.shedId]));
  const shedName = new Map(sheds.map(s => [s.id, s.name]));

  const rows = new Map<string, ShedPnl>();
  const shedRow = (shedId: string): ShedPnl => {
    let r = rows.get(shedId);
    if (!r) {
      r = {
        shedId, shedName: shedName.get(shedId) ?? 'Removed shed',
        income: 0, directExpense: 0, feedExpense: 0, medicineExpense: 0, sharedExpense: 0,
        totalExpense: 0, profit: 0,
        hasFeed: false, feedTonnes: 0, unpricedFeedKg: 0,
        hasMedicine: false, unpricedMedicineQty: 0, incomeCount: 0, directCount: 0,
      };
      rows.set(shedId, r);
    }
    return r;
  };
  for (const s of sheds) shedRow(s.id);

  let inventoryPurchase = 0;
  let chickExpense = 0;
  let godownOperatingExpense = 0;
  let unallocatedExpense = 0;
  let unallocatedIncome = 0;
  let unallocatedCount = 0;

  for (const t of periodTxns) {
    if (isInflow(t.kind)) {
      const sc = scopeOf(t, batchShed);
      if (sc.kind === 'shed') { const r = shedRow(sc.shedId); r.income += t.amount; r.incomeCount++; }
      else { unallocatedIncome += t.amount; unallocatedCount++; } // godown income is unusual — hold it visibly
      continue;
    }
    if (isLivestockPurchase(t)) chickExpense += t.amount; // counted below as spend of this day
    if (isInventoryPurchase(t)) { inventoryPurchase += t.amount; continue; }
    const sc = scopeOf(t, batchShed);
    if (sc.kind === 'shed') { const r = shedRow(sc.shedId); r.directExpense += t.amount; r.directCount++; }
    else if (sc.kind === 'godown') godownOperatingExpense += t.amount;
    else { unallocatedExpense += t.amount; unallocatedCount++; }
  }

  const feedCost = feedCostByShed(feed, feedStock, feedFormulas, range);
  for (const f of feedCost.rows) {
    const r = shedRow(f.shedId);
    r.feedExpense = f.cost;
    r.hasFeed = true;
    r.feedTonnes = f.tonnes;
    r.unpricedFeedKg = f.unpricedKg;
  }

  // A dose drawn from the medicine store is that shed's expense, on the same basis as
  // feed: the receipt that bought it was inventory, so the money ledger never carries it
  // as spend. The rate is the one frozen on the usage row, so a later purchase at a
  // different price cannot restate a day that has already been charged.
  const medicineCost = medicineCostByShed(medicineStock, range);
  for (const m of medicineCost.rows) {
    const r = shedRow(m.shedId);
    r.medicineExpense = m.cost;
    r.hasMedicine = true;
    r.unpricedMedicineQty = m.unpricedQty;
  }

  const shortages = godownShortages(feedStock, range);
  const alloc = allocateShortage(shortages.totalValue, feedCost.rows, shedName);
  for (const a of alloc.shares) shedRow(a.shedId).sharedExpense += a.amount;

  for (const r of rows.values()) {
    r.totalExpense = r.directExpense + r.feedExpense + r.medicineExpense + r.sharedExpense;
    r.profit = r.income - r.totalExpense;
  }

  const income = sumBy(periodTxns, t => (isInflow(t.kind) ? t.amount : 0));
  const operatingExpense = sumBy(periodTxns, t => (!isInflow(t.kind) && !isInventoryPurchase(t) ? t.amount : 0));
  const moneyOut = sumBy(periodTxns, t => (isInflow(t.kind) ? 0 : t.amount));
  const feedExpense = feedCost.total;
  const medicineExpense = medicineCost.total ?? 0;
  const shortageExpense = shortages.totalValue;
  const totalExpense = operatingExpense + feedExpense + medicineExpense + (shortageExpense ?? 0);

  const warnings: string[] = [];
  if (feedCost.missingFormula) warnings.push('Formula version unavailable for some feed — those days are left out of the feed expense.');
  if (feedCost.unpricedKg > 0) warnings.push('Some consumed feed has no rate on record — its cost is not guessed.');
  if (medicineCost.unpricedQty > 0) warnings.push('Some medicine used has no rate on record — counted in units, excluded from the money total.');
  if (shortages.unpricedKg > 0) warnings.push('Some godown shortage carries no rate — counted in kg, excluded from the money total.');
  if (unallocatedCount > 0) warnings.push('Some money is not mapped to a shed or the godown yet — it is held in Unallocated, never guessed.');
  if (alloc.basis === 'none' && (shortageExpense ?? 0) > 0) warnings.push('No feed was consumed to spread the shortage against, so it is held as a farm-level cost.');

  return {
    periodTxns,
    sheds: [...rows.values()]
      .filter(r => r.income || r.totalExpense || r.hasFeed || r.hasMedicine)
      .sort((a, b) => b.totalExpense - a.totalExpense || b.income - a.income),
    income: round(income),
    operatingExpense: round(operatingExpense),
    inventoryPurchase: round(inventoryPurchase),
    chickExpense: round(chickExpense),
    feedExpense: round(feedExpense),
    medicineExpense: round(medicineExpense),
    unpricedMedicineQty: medicineCost.unpricedQty,
    shortageExpense: shortageExpense === null ? null : round(shortageExpense),
    godownOperatingExpense: round(godownOperatingExpense),
    unallocatedExpense: round(unallocatedExpense),
    unallocatedIncome: round(unallocatedIncome),
    unallocatedCount,
    totalExpense: round(totalExpense),
    net: round(income - totalExpense),
    moneyIn: round(income),
    moneyOut: round(moneyOut),
    cashNet: round(income - moneyOut),
    allocatedShortage: round(alloc.allocated),
    unallocatedShortage: round((shortageExpense ?? 0) - alloc.allocated),
    shortageUnpricedKg: shortages.unpricedKg,
    missingFormula: feedCost.missingFormula,
    warnings,
  };
}

function sumBy<T>(rows: T[], pick: (r: T) => number): number {
  let s = 0;
  for (const r of rows) s += pick(r);
  return s;
}

/* ============================= SHORTAGE ALLOCATION ============================= */

export type ShortageShare = { shedId: string; shedName: string; amount: number; weight: number };

/**
 * Spread the godown shortage across the sheds that consumed feed, in proportion
 * to the feed cost each shed drew. The basis is deliberately feed consumption —
 * the existing, explicit rule — stated in the UI, never hidden. Shares sum to the
 * source to the cent: the last shed absorbs the rounding residual. When no feed
 * was consumed the shortage cannot be spread honestly, so nothing is allocated and
 * it stays a farm-level cost.
 */
export function allocateShortage(
  totalValue: number | null,
  feedRows: ShedFeedCost[],
  shedName?: Map<string, string>,
): { shares: ShortageShare[]; allocated: number; basis: 'feed' | 'none' } {
  if (totalValue === null || totalValue === 0) return { shares: [], allocated: 0, basis: 'none' };
  const positive = feedRows.filter(r => r.cost > 0);
  const totalCost = positive.reduce((s, r) => s + r.cost, 0);
  if (totalCost <= 0) return { shares: [], allocated: 0, basis: 'none' };
  const shares: ShortageShare[] = [];
  let running = 0;
  for (let i = 0; i < positive.length; i++) {
    const r = positive[i];
    const last = i === positive.length - 1;
    const amount = last ? round(totalValue - running) : round((totalValue * r.cost) / totalCost);
    running += amount;
    shares.push({
      shedId: r.shedId, shedName: shedName?.get(r.shedId) ?? 'Removed shed',
      amount, weight: r.cost / totalCost,
    });
  }
  return { shares, allocated: round(shares.reduce((s, x) => s + x.amount, 0)), basis: 'feed' };
}

/* ============================= GODOWN LEDGER ============================= */

export type GodownIngredientRow = {
  ingredient: string;
  openingKg: number; receivedKg: number; consumedKg: number; feedOutKg: number; shortageKg: number; closingKg: number;
  /** The godown's weighted average cost for this ingredient, and the value it carries. */
  avg: number | null; closingValue: number; receivedValue: number; consumedValue: number; shortageValue: number;
};

export type GodownLedger = {
  perIngredient: GodownIngredientRow[];
  totals: Omit<GodownIngredientRow, 'ingredient' | 'avg'>;
  asOfValue: number; asOfKg: number; inStock: number; unpricedKg: number;
};

/**
 * "What physically exists in the godown, and how did that position arise?" — per
 * ingredient over the range. Quantities come from the ledger rows themselves, so
 * Opening + In − Eaten − Out − Short always equals Closing. Money comes from the
 * valuation engine: receipts at the rate actually paid, stock leaving at the weighted
 * average in force the day it left. An ingredient the godown has never priced is
 * counted in kg and left out of the money columns rather than priced at zero.
 */
export function godownLedger(stock: FeedStockEntry[], range: Range): GodownLedger {
  const valuation = valueGodown(stock);
  const asOf = (ingredient: string, date: string) => valuation.at(ingredient, date);
  const openingDate = shiftDate(range.from, -1);

  const ingredients = new Set<string>();
  for (const e of stock) if (isISODate(e.date) && fin(e.qtyKg) !== null) ingredients.add(e.ingredient);

  const perIngredient: GodownIngredientRow[] = Array.from(ingredients).map(ingredient => {
    const rows = stock.filter(e => e.ingredient === ingredient && isISODate(e.date) && fin(e.qtyKg) !== null);
    let receivedKg = 0, consumedKg = 0, feedOutKg = 0, shortageKg = 0;
    let receivedValue = 0, consumedValue = 0, shortageValue = 0;
    for (const e of rows) {
      if (e.date < range.from) continue; // it already sits in the opening position
      const kg = e.qtyKg;
      // Each row is moneyed at the price it was actually booked at, not the day's closing average.
      const moved = valuation.basis(e.id).value ?? 0;
      if (e.kind === 'OPENING' || e.kind === 'FEED_IN' || (e.kind === 'ADJUSTMENT' && kg > 0)) {
        receivedKg += Math.abs(kg);
        receivedValue += moved;
      } else if (e.kind === 'CONSUMPTION') {
        consumedKg += Math.abs(kg);
        consumedValue += moved;
      } else if (e.kind === 'FEED_OUT') {
        feedOutKg += Math.abs(kg);
      } else if (e.kind === 'ADJUSTMENT' || e.kind === 'SHORTAGE') {
        shortageKg += Math.abs(kg);
        shortageValue += moved;
      }
    }
    const position = asOf(ingredient, range.to);
    return {
      ingredient,
      openingKg: round(asOf(ingredient, openingDate).kg),
      receivedKg: round(receivedKg), consumedKg: round(consumedKg),
      feedOutKg: round(feedOutKg), shortageKg: round(shortageKg),
      closingKg: round(position.kg),
      avg: position.avg,
      closingValue: round(position.value),
      receivedValue: round(receivedValue), consumedValue: round(consumedValue), shortageValue: round(shortageValue),
    };
  })
    .filter(r => r.openingKg || r.receivedKg || r.consumedKg || r.feedOutKg || r.shortageKg || r.closingKg)
    .sort((a, b) => b.closingKg - a.closingKg);

  const sum = (pick: (r: GodownIngredientRow) => number) => round(perIngredient.reduce((s, r) => s + pick(r), 0));
  const totals = {
    openingKg: sum(r => r.openingKg), receivedKg: sum(r => r.receivedKg), consumedKg: sum(r => r.consumedKg),
    feedOutKg: sum(r => r.feedOutKg), shortageKg: sum(r => r.shortageKg), closingKg: sum(r => r.closingKg),
    closingValue: sum(r => r.closingValue), receivedValue: sum(r => r.receivedValue),
    consumedValue: sum(r => r.consumedValue), shortageValue: sum(r => r.shortageValue),
  };

  const overall = valuation.totals(range.to);
  return {
    perIngredient, totals,
    asOfValue: round(overall.value), asOfKg: round(overall.kg),
    inStock: overall.inStock, unpricedKg: round(overall.unpricedKg),
  };
}

/** Shortage rows for the alert panel; the negative adjustment IS the expected-vs-actual gap. */
export function shortageRows(stock: FeedStockEntry[], range: Range): ShortageRow[] {
  return godownShortages(stock, range).rows;
}
