/**
 * Dashboard analytics: every owner graph reads its numbers from here.
 *
 * The slices passed in are already company-scoped by `useCompanyData()`, so no
 * selector here can reach another farm's rows. Two rules hold throughout:
 * a day with no record stays `null` rather than becoming a zero, and a figure
 * that cannot be derived from the ledger is reported as unavailable instead of
 * guessed. Warnings say what was left out; they never carry money.
 */
import { endOfMonth, format, isValid, parseISO, startOfMonth, subMonths } from 'date-fns';
import type {
  Batch, EggCollection, FeedConsumption, FeedFormula, FeedStockEntry,
  FinanceTxn, MortalityEntry, SaleEntry, Shed, Trader, TraderTxn,
} from '@/types';
import { EGG_GRADES, EGGS_PER_TRAY } from '@/types';
import {
  consumptionDeduction, entryTrays, formulaForDate, GODOWN_CRITICAL_KG, GODOWN_LOW_KG,
  godownBalances, liveBirdsOn, loadBilled, ratePerEgg, stockStatus, traderBalance,
} from './calc';
import { valueGodown } from './valuation';
import { fmtDateShort, shiftDate, todayISO } from './format';

/** CUSTOM windows are built by the screen that owns the picker; `rangeOf` never serves one. */
export type RangeKey = '7D' | '30D' | '90D' | 'CUSTOM';
export type Range = { key: RangeKey; from: string; to: string; days: number };
export type Point = { date: string; value: number | null; label?: string };
export type Tone = 'brand' | 'accent' | 'success' | 'danger' | 'warn' | 'neutral';

/* ============================= SAFE PRIMITIVES ============================= */

/** A finite number, or null — the only value arithmetic is allowed to see. */
export function fin(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const r2 = (n: number) => Number(n.toFixed(2));

/** Division that refuses to invent: a zero or broken divisor yields null. */
export function div(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return fin(a / b);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return fin(values.reduce((s, v) => s + v, 0) / values.length);
}

export function isISODate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}

/** Every date from `from` to `to` inclusive; an inverted range yields nothing. */
export function dayKeys(from: string, to: string): string[] {
  if (!isISODate(from) || !isISODate(to) || from > to) return [];
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    cur = shiftDate(cur, 1);
  }
  return out;
}

export function rangeOf(key: RangeKey, to = todayISO()): Range {
  const days = key === '7D' ? 7 : key === '90D' ? 90 : 30;
  return { key, days, from: shiftDate(to, -(days - 1)), to };
}

export function inRange(date: string, range: Range): boolean {
  return isISODate(date) && date >= range.from && date <= range.to;
}

/** The equally-sized window immediately before a range, for period-on-period change. */
export function previousRange(range: Range): Range {
  const to = shiftDate(range.from, -1);
  return { ...range, from: shiftDate(to, -(range.days - 1)), to };
}

/** A calendar-day series: one slot per day, null where nothing was recorded. */
function series(range: Range, byDay: Map<string, number>): Point[] {
  return dayKeys(range.from, range.to).map(date => ({ date, value: byDay.get(date) ?? null }));
}

function sumBy<T>(rows: T[], date: (r: T) => string, value: (r: T) => number | null, skip: (r: T) => void): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const d = date(row);
    if (!isISODate(d)) { skip(row); continue; }
    const v = value(row);
    if (v === null) { skip(row); continue; }
    map.set(d, (map.get(d) ?? 0) + v);
  }
  return map;
}

/** Days in a series that carry no record — reported, never plotted as zero. */
export function missingDays(points: Point[]): number {
  return points.filter(p => p.value === null).length;
}

export function noRecordWarning(points: Point[], subject: string): string[] {
  const missing = missingDays(points);
  if (!missing) return [];
  if (missing === points.length) return [`No ${subject} recorded for this period`];
  return [`${missing} of ${points.length} days have no ${subject} record`];
}

/* ============================= EGG PRODUCTION ============================= */

export type ProductionTrend = {
  points: Point[]; goodPoints: Point[]; total: number | null;
  today: number | null; avg7: number | null; avg30: number | null;
  best: { date: string; value: number } | null;
  worst: { date: string; value: number } | null;
  changePct: number | null; warnings: string[];
};

const traysOf = (e: EggCollection) =>
  (e.goodTrays || 0) + (e.brokenTrays || 0) + (e.doubleTrays || 0) + (e.smallTrays || 0);

export function eggProductionTrend(eggs: EggCollection[], range: Range): ProductionTrend {
  const skipped: string[] = [];
  const rows = eggs.filter(e => {
    const ok = isISODate(e.date) && traysOf(e) >= 0 && Number.isFinite(traysOf(e));
    if (!ok) skipped.push(e.id);
    return ok;
  });
  const byDay = sumBy(rows.filter(e => inRange(e.date, range)), e => e.date, e => traysOf(e), () => undefined);
  const good = sumBy(rows.filter(e => inRange(e.date, range)), e => e.date, e => fin(e.goodTrays), () => undefined);
  const points = series(range, byDay);
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const prevRange = previousRange(range);
  const prevSum = rows.filter(e => inRange(e.date, prevRange)).reduce((s, e) => s + traysOf(e), 0);
  const curSum = recorded.reduce((s, p) => s + p.value, 0);
  const nonNegative = (ns: number[]) => ns.filter(n => n >= 0);
  const last7 = nonNegative(points.slice(-7).map(p => p.value).filter((v): v is number => v !== null));
  const last30 = nonNegative(points.slice(-30).map(p => p.value).filter((v): v is number => v !== null));
  const best = recorded.length ? recorded.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const worst = recorded.length ? recorded.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const warnings = noRecordWarning(points, 'egg collection');
  if (skipped.length) warnings.push(`${skipped.length} ${skipped.length === 1 ? 'collection record was' : 'collection records were'} unreadable and excluded.`);
  return {
    points,
    goodPoints: series(range, good),
    total: recorded.length ? curSum : null,
    today: byDay.get(range.to) ?? null,
    avg7: mean(last7), avg30: mean(last30),
    best: best ? { date: best.date, value: best.value } : null,
    worst: worst ? { date: worst.date, value: worst.value } : null,
    changePct: prevSum > 0 ? r2(((curSum - prevSum) / prevSum) * 100) : null,
    warnings,
  };
}

export type ShedProduction = {
  shedId: string; shedName: string; trays: number;
  byGrade: Record<string, number>; recorded: boolean;
};

/** One bar per shed for a single day — the sheds never share a line. */
export function productionByShed(eggs: EggCollection[], sheds: Shed[], date = todayISO()): ShedProduction[] {
  if (!isISODate(date)) return [];
  return sheds.map(shed => {
    const rows = eggs.filter(e => e.shedId === shed.id && e.date === date);
    const byGrade: Record<string, number> = {};
    for (const g of EGG_GRADES) byGrade[g] = 0;
    for (const e of rows) {
      byGrade.GOOD += e.goodTrays || 0; byGrade.BROKEN += e.brokenTrays || 0;
      byGrade.DOUBLE += e.doubleTrays || 0; byGrade.SMALL += e.smallTrays || 0;
    }
    return {
      shedId: shed.id, shedName: shed.name,
      trays: rows.reduce((s, e) => s + traysOf(e), 0),
      byGrade, recorded: rows.length > 0,
    };
  });
}

/* ============================= EGG STOCK MOVEMENT ============================= */

export type StockMovement = {
  closing: Point[]; collection: Point[]; sales: Point[]; damage: Point[];
  opening: number; closingNow: number; change: number;
  todayCollection: number | null; todaySales: number | null; todayDamage: number | null;
  damagedTotal: number; warnings: string[];
};

/**
 * Trays in the sheds' egg rooms, day by day: collected − sold in a final sale entry.
 * A shed dispatch note is deliberately absent — stock only leaves when accounts bills
 * the load, so a dispatch and its sale can never deduct the same tray twice.
 */
export function eggStockMovement(eggs: EggCollection[], entries: SaleEntry[], range: Range): StockMovement {
  let badSales = 0, badCollections = 0;
  const soldByDay = sumBy(entries, e => e.date, e => fin(entryTrays(e)), () => { badSales++; });
  const collByDay = sumBy(eggs, e => e.date, e => fin(traysOf(e)), () => { badCollections++; });
  const dmgByDay = sumBy(eggs, e => e.date, e => fin(e.brokenTrays), () => undefined);
  const days = dayKeys(range.from, range.to);
  const before = (date: string, map: Map<string, number>) =>
    Array.from(map.entries()).filter(([d]) => d < date).reduce((s, [, v]) => s + v, 0);
  const opening = before(range.from, collByDay) - before(range.from, soldByDay);
  let run = opening;
  const closing: Point[] = [];
  for (const date of days) {
    run += (collByDay.get(date) ?? 0) - (soldByDay.get(date) ?? 0);
    closing.push({ date, value: run });
  }
  const damagedTotal = Array.from(dmgByDay.values()).reduce((s, v) => s + v, 0);
  const warnings: string[] = [];
  if (badCollections) warnings.push(`${badCollections} ${badCollections === 1 ? 'collection record was' : 'collection records were'} unreadable and left out of the stock trail.`);
  if (badSales) warnings.push(`${badSales} sale ${badSales === 1 ? 'entry was' : 'entries were'} unreadable and left out of the stock trail.`);
  if (closing.some(p => (p.value ?? 0) < 0)) warnings.push('Some sheds show negative egg stock — it needs a collection or sale correction.');
  return {
    closing,
    collection: series(range, collByDay),
    sales: series(range, soldByDay),
    damage: series(range, dmgByDay),
    opening, closingNow: closing.at(-1)?.value ?? opening,
    change: (closing.at(-1)?.value ?? opening) - opening,
    todayCollection: collByDay.get(range.to) ?? null,
    todaySales: soldByDay.get(range.to) ?? null,
    todayDamage: dmgByDay.get(range.to) ?? null,
    damagedTotal, warnings,
  };
}

/* ============================= EGG SALES ============================= */

export type SalesMode = 'TRAYS' | 'VALUE' | 'RATE';
export type SalesTrend = {
  points: Point[]; mode: SalesMode; unit: 'trays' | 'money' | 'rate';
  today: number | null; periodTotal: number | null; avgRate: number | null;
  entries: number; warnings: string[];
};

/** Trays, billed value, or the selling rate per egg, one point per sale day. */
export function eggSalesTrend(entries: SaleEntry[], range: Range, mode: SalesMode): SalesTrend {
  const undated = entries.filter(e => !isISODate(e.date));
  const rows = entries.filter(e => inRange(e.date, range));
  const warnings: string[] = [];
  if (undated.length) warnings.push(`${undated.length} sale ${undated.length === 1 ? 'entry carries' : 'entries carry'} a date this graph could not read ${undated.length === 1 ? 'and is' : 'and are'} left out.`);
  const sums = new Map<string, { trays: number; billed: number; eggs: number }>();
  for (const e of rows) {
    const trays = fin(entryTrays(e));
    const billed = fin(loadBilled(e.amount, e.laborCharge));
    const eggs = fin(e.amount);
    if (trays === null || billed === null || eggs === null) { warnings.push('1 sale entry has unreadable money or trays and was excluded.'); continue; }
    const day = sums.get(e.date) ?? { trays: 0, billed: 0, eggs: 0 };
    day.trays += trays; day.billed += billed; day.eggs += eggs;
    sums.set(e.date, day);
  }
  // A day's rate is that day's egg money over that day's eggs — rates are never added up.
  const byDay = new Map<string, number>();
  for (const [date, day] of sums) {
    const value = mode === 'TRAYS' ? day.trays : mode === 'VALUE' ? day.billed : ratePerEgg(day.eggs, day.trays);
    if (value === null) {
      if (mode === 'RATE') warnings.push('A sale day records no eggs, so its rate cannot be derived.');
      continue;
    }
    byDay.set(date, value);
  }
  const points = series(range, byDay);
  const trayTotal = rows.reduce((s, e) => s + (fin(entryTrays(e)) ?? 0), 0);
  const billedTotal = rows.reduce((s, e) => s + (fin(loadBilled(e.amount, e.laborCharge)) ?? 0), 0);
  const eggsTotal = rows.reduce((s, e) => s + (fin(e.amount) ?? 0), 0);
  const ratePoints = points.map(p => p.value).filter((v): v is number => v !== null);
  return {
    points, mode, unit: mode === 'TRAYS' ? 'trays' : mode === 'VALUE' ? 'money' : 'rate',
    today: byDay.get(range.to) ?? null,
    periodTotal: mode === 'TRAYS' ? trayTotal : mode === 'VALUE' ? billedTotal : (mean(ratePoints) ?? null),
    avgRate: ratePerEgg(eggsTotal, trayTotal),
    entries: rows.length,
    warnings: [...warnings, ...(rows.length ? [] : [`No egg sale billed for this period`])],
  };
}

export type TraderSales = { traderId: string; name: string; value: number; trays: number; active: boolean };

/** Sales value per trader off the billed ledger rows — never off a typed balance. */
export function salesByTrader(txns: TraderTxn[], traders: Trader[], range: Range): TraderSales[] {
  const names = new Map(traders.map(t => [t.id, t.name]));
  const acc = new Map<string, { value: number; trays: number }>();
  for (const t of txns) {
    if (t.kind !== 'EGG_SALE' || !inRange(t.date, range)) continue;
    const amount = fin(t.amount);
    if (amount === null) continue;
    const cur = acc.get(t.traderId) ?? { value: 0, trays: 0 };
    acc.set(t.traderId, { value: cur.value + amount, trays: cur.trays + (fin(t.trays) ?? 0) });
  }
  return Array.from(acc.entries())
    .map(([traderId, v]) => ({
      traderId, name: names.get(traderId) ?? 'Removed trader',
      value: r2(v.value), trays: v.trays, active: traders.some(t => t.id === traderId && t.active),
    }))
    .sort((a, b) => b.value - a.value);
}

/* ============================= EGG DAMAGE ============================= */

export type DamageTrend = {
  points: Point[]; trayPoints: Point[];
  todayPct: number | null; todayTrays: number | null; avg7Pct: number | null;
  worst: { date: string; value: number } | null; totalTrays: number | null;
  available: boolean; warnings: string[];
};

/** Broken trays as a share of the trays produced that day. */
export function eggDamageTrend(eggs: EggCollection[], range: Range): DamageTrend {
  const rows = eggs.filter(e => inRange(e.date, range) && isISODate(e.date));
  const broken = sumBy(rows, e => e.date, e => fin(e.brokenTrays), () => undefined);
  const total = sumBy(rows, e => e.date, e => fin(traysOf(e)), () => undefined);
  const pct = new Map<string, number>();
  let zeroProduction = 0;
  for (const [date, t] of total.entries()) {
    const b = broken.get(date) ?? 0;
    if (t > 0) pct.set(date, r2((b / t) * 100)); else zeroProduction++;
  }
  const points = series(range, pct);
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const last7 = recorded.filter(p => p.date > shiftDate(range.to, -7));
  const worst = recorded.length ? recorded.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const produced = Array.from(total.values()).reduce((s, v) => s + v, 0);
  const warnings: string[] = [];
  if (!recorded.length) warnings.push('Damage percentage unavailable — no day in this period has both a collection record and trays to divide by.');
  else if (zeroProduction) warnings.push(`${zeroProduction} day${zeroProduction === 1 ? '' : 's'} reported trays but no production total, so damage was not calculated for them.`);
  return {
    points,
    trayPoints: series(range, broken),
    todayPct: pct.get(range.to) ?? null,
    todayTrays: broken.get(range.to) ?? null,
    avg7Pct: mean(last7.map(p => p.value)),
    worst: worst ? { date: worst.date, value: worst.value } : null,
    totalTrays: produced > 0 ? produced : null,
    available: recorded.length > 0,
    warnings,
  };
}

export type ShedDamage = { shedId: string; shedName: string; trays: number; totalTrays: number; pct: number | null };

export function damageByShed(eggs: EggCollection[], sheds: Shed[], range: Range): ShedDamage[] {
  return sheds.map(shed => {
    const rows = eggs.filter(e => e.shedId === shed.id && inRange(e.date, range));
    const trays = rows.reduce((s, e) => s + (fin(e.brokenTrays) ?? 0), 0);
    const totalTrays = rows.reduce((s, e) => s + traysOf(e), 0);
    const pct = div(trays, totalTrays);
    return { shedId: shed.id, shedName: shed.name, trays, totalTrays, pct: pct === null ? null : r2(pct * 100) };
  }).sort((a, b) => b.trays - a.trays);
}

/* ============================= GODOWN ============================= */

export type GodownRow = {
  ingredient: string; stockKg: number; status: 'NORMAL' | 'LOW' | 'CRITICAL';
  todayKg: number; avg7Kg: number | null; daysLeft: number | null;
  receivedKg: number; issuedKg: number; negative: boolean;
};

/**
 * Stock, consumption rate and runway per ingredient. The low/critical levels are
 * the godown screen's own rule — nothing per ingredient is configured, so nothing
 * is invented: an unknown burn rate simply reports no runway. An ingredient whose
 * rows are all unreadable is left out rather than shown as an invented zero.
 */
export function godownPosition(stock: FeedStockEntry[], asOf = todayISO(), windowDays = 7): { rows: GodownRow[]; warnings: string[] } {
  const balances = godownBalances(stock, asOf);
  const burn = new Map<string, number>();
  const today = new Map<string, number>();
  const received = new Map<string, number>();
  const issued = new Map<string, number>();
  const readable = new Set<string>();
  const from = shiftDate(asOf, -(windowDays - 1));
  for (const e of stock) {
    if (!isISODate(e.date) || fin(e.qtyKg) === null) continue;
    readable.add(e.ingredient);
    const kg = e.qtyKg;
    if (e.kind === 'CONSUMPTION' && e.date >= from && e.date <= asOf) {
      burn.set(e.ingredient, (burn.get(e.ingredient) ?? 0) + Math.abs(kg));
      if (e.date === asOf) today.set(e.ingredient, (today.get(e.ingredient) ?? 0) + Math.abs(kg));
    }
    if (e.kind === 'FEED_IN' || e.kind === 'OPENING') received.set(e.ingredient, (received.get(e.ingredient) ?? 0) + kg);
    if (e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION') issued.set(e.ingredient, (issued.get(e.ingredient) ?? 0) + Math.abs(kg));
  }
  const unreadable = Array.from(new Set(stock.map(e => e.ingredient))).filter(i => !readable.has(i));
  const warnings = unreadable.length
    ? [`${unreadable.length} ${unreadable.length === 1 ? 'ingredient has' : 'ingredients have'} no entry this graph could read, so no stock is claimed for ${unreadable.length === 1 ? 'it' : 'them'}.`]
    : [];
  const rows = Array.from(readable)
    .map(ingredient => {
      const stockKg = r2(balances[ingredient] ?? 0);
      const avg7Kg = div(burn.get(ingredient) ?? 0, windowDays);
      const daysLeft = avg7Kg && avg7Kg > 0 ? r2(stockKg / avg7Kg) : null;
      const negative = stockKg < 0;
      const status = negative ? 'CRITICAL' as const : stockStatus(stockKg);
      return {
        ingredient, stockKg, status,
        todayKg: r2(today.get(ingredient) ?? 0),
        avg7Kg: avg7Kg === null ? null : r2(avg7Kg),
        daysLeft, receivedKg: r2(received.get(ingredient) ?? 0),
        issuedKg: r2(issued.get(ingredient) ?? 0), negative,
      };
    })
    .sort((a, b) => b.stockKg - a.stockKg);
  return { rows, warnings };
}

export type IngredientTrend = {
  closing: Point[]; feedIn: Point[]; consumption: Point[]; feedOut: Point[]; adjustment: Point[];
  opening: number; current: number; avgDailyUse: number | null; daysLeft: number | null;
  heaviest: { date: string; value: number } | null;
  totalConsumed: number; totalReceived: number; warnings: string[];
};

/** One ingredient's ledger unwound day by day, closing stock leading. */
export function ingredientStockTrend(stock: FeedStockEntry[], ingredient: string, range: Range): IngredientTrend {
  const rows = stock.filter(e => e.ingredient === ingredient);
  const valid = rows.filter(e => isISODate(e.date) && fin(e.qtyKg) !== null);
  const warnings: string[] = [];
  if (valid.length !== rows.length) warnings.push(`${rows.length - valid.length} ${rows.length - valid.length === 1 ? 'entry has' : 'entries have'} a date or quantity this graph could not read.`);
  const kindMap = (kind: FeedStockEntry['kind'], signed = false) => sumBy(
    valid.filter(e => e.kind === kind), e => e.date,
    e => fin(signed ? e.qtyKg : Math.abs(e.qtyKg)), () => undefined,
  );
  const inMap = kindMap('FEED_IN');
  const consMap = kindMap('CONSUMPTION');
  const outMap = kindMap('FEED_OUT');
  // Adjustments and shortages are both signed corrections to the shelf.
  const adjMap = sumBy(
    valid.filter(e => e.kind === 'ADJUSTMENT' || e.kind === 'SHORTAGE'), e => e.date,
    e => fin(e.qtyKg), () => undefined,
  );
  const openingMap = kindMap('OPENING');
  const before = (map: Map<string, number>) =>
    Array.from(map.entries()).filter(([d]) => d < range.from).reduce((s, [, v]) => s + v, 0);
  const opening = before(openingMap) + before(inMap) - before(consMap) - before(outMap) + before(adjMap);
  let run = opening;
  const closing: Point[] = [];
  for (const date of dayKeys(range.from, range.to)) {
    run += (inMap.get(date) ?? 0) + (openingMap.get(date) ?? 0) - (consMap.get(date) ?? 0) - (outMap.get(date) ?? 0) + (adjMap.get(date) ?? 0);
    closing.push({ date, value: r2(run) });
  }
  const consPoints = series(range, consMap);
  const used = consPoints.map(p => p.value ?? 0);
  const nonZero = used.filter(v => v > 0);
  const heaviest = consPoints.reduce<{ date: string; value: number } | null>(
    (best, p) => (p.value !== null && (!best || p.value > best.value) ? { date: p.date, value: p.value } : best), null);
  const avgDailyUse = mean(used);
  const current = closing.at(-1)?.value ?? opening;
  if (!nonZero.length) warnings.push('No consumption drawn from this ingredient in the period — days remaining cannot be estimated.');
  if (current < 0) warnings.push('Negative stock requires adjustment.');
  return {
    closing,
    feedIn: series(range, inMap), consumption: consPoints,
    feedOut: series(range, outMap), adjustment: series(range, adjMap),
    opening, current,
    avgDailyUse: avgDailyUse === null ? null : r2(avgDailyUse),
    daysLeft: avgDailyUse && avgDailyUse > 0 ? r2(current / avgDailyUse) : null,
    heaviest,
    totalConsumed: r2(nonZero.reduce((s, v) => s + v, 0)),
    totalReceived: r2(Array.from(inMap.values()).reduce((s, v) => s + v, 0) + Array.from(series(range, openingMap).values()).reduce((s, p) => s + (p.value ?? 0), 0)),
    warnings,
  };
}

/** Ingredients that actually appear in the godown ledger, most-stocked first. */
export function godownIngredients(stock: FeedStockEntry[]): string[] {
  const kg = new Map<string, number>();
  for (const e of stock) kg.set(e.ingredient, (kg.get(e.ingredient) ?? 0) + Math.abs(fin(e.qtyKg) ?? 0));
  return Array.from(kg.entries()).sort((a, b) => b[1] - a[1]).map(([i]) => i);
}

/* ============================= FEED ============================= */

export type FeedTrend = {
  points: Point[]; total: number | null; today: number | null; avg7: number | null;
  heaviest: { date: string; value: number } | null; warnings: string[];
};

/** Tonnes offered per day — a shed that fed nothing shows a gap, not a zero. */
export function feedConsumptionTrend(feed: FeedConsumption[], range: Range): FeedTrend {
  const valid = feed.filter(f => inRange(f.date, range) && isISODate(f.date) && (fin(f.tonnes) ?? -1) >= 0);
  const byDay = sumBy(valid, f => f.date, f => fin(f.tonnes), () => undefined);
  const points = series(range, byDay);
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const last7 = recorded.filter(p => p.date > shiftDate(range.to, -7)).map(p => p.value);
  const heaviest = recorded.length ? recorded.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const dropped = feed.filter(f => inRange(f.date, range)).length - valid.length;
  const warnings = noRecordWarning(points, 'feed');
  if (dropped > 0) warnings.push(`${dropped} feed ${dropped === 1 ? 'entry has' : 'entries have'} a quantity this graph could not read.`);
  return {
    points,
    total: recorded.length ? r2(recorded.reduce((s, p) => s + p.value, 0)) : null,
    today: byDay.get(range.to) ?? null,
    avg7: mean(last7) === null ? null : r2(mean(last7)!),
    heaviest: heaviest ? { date: heaviest.date, value: r2(heaviest.value) } : null,
    warnings,
  };
}

export type ShedFeed = {
  shedId: string; shedName: string; tonnes: number; days: number;
  formulaName: string | null; formulaVersion: number | null; missingFormula: boolean;
};

/** Tonnes per shed over the period, tagged with the formula version that fed it. */
export function feedByShed(feed: FeedConsumption[], sheds: Shed[], formulas: FeedFormula[], range: Range): ShedFeed[] {
  return sheds.map(shed => {
    const rows = feed.filter(f => f.shedId === shed.id && inRange(f.date, range) && isISODate(f.date));
    const missingFormula = rows.some(f => !consumptionDeduction(f, formulas).length);
    const newest = rows.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const pinned = newest?.formulaId
      ? formulas.find(f => f.id === newest.formulaId)
      : (newest ? formulaForDate(newest.shedId, newest.date, formulas) : null);
    return {
      shedId: shed.id, shedName: shed.name,
      tonnes: r2(rows.reduce((s, f) => s + (fin(f.tonnes) ?? 0), 0)),
      days: rows.length,
      formulaName: pinned?.name ?? null, formulaVersion: pinned?.version ?? null,
      missingFormula,
    };
  }).filter(x => x.tonnes > 0).sort((a, b) => b.tonnes - a.tonnes);
}

export type FeedCost = {
  points: Point[]; today: number | null; avg7: number | null; perTonne: number | null;
  total: number | null; tonnes: number; pricedKg: number; unpricedKg: number;
  missingFormula: boolean; available: boolean; warnings: string[];
};

/* ============================= FEED VALUATION =============================
 * Every feed cost in the app comes from here, and every line is priced by the
 * godown's own weighted average in force on the day that feed was drawn — never a
 * latest purchase price, never a rate typed into a formula. One price chain:
 * godown average → formula cost → shed feed expense → shed P&L.
 */

export type FeedTraceLine = { ingredient: string; kg: number; avg: number | null; cost: number | null };

/** One shed feeding, unwound into the ingredient lines that left the godown. */
export type FeedTrace = {
  consumptionId: string; date: string; shedId: string; batchId: string; tonnes: number;
  formulaId: string | null; formulaName: string | null; formulaVersion: number | null;
  lines: FeedTraceLine[]; cost: number; pricedKg: number; unpricedKg: number; missingFormula: boolean;
};

/**
 * The trace the owner can follow: shed feed expense → this consumption record → the
 * formula version that drove it → each ingredient → KG drawn → the godown average it was
 * drawn at → the cost it produced. KG with no average on record is counted in `unpricedKg`
 * and left out of the money rather than priced at zero.
 */
export function feedExpenseTraces(
  feed: FeedConsumption[], stock: FeedStockEntry[], formulas: FeedFormula[], range?: Range,
): FeedTrace[] {
  const valuation = valueGodown(stock);
  // The deduction rows a feeding wrote, so each line is priced at the average that was
  // in force the moment it left the shelf — not at whatever the day ended on.
  const drawnBy = new Map<string, FeedStockEntry[]>();
  for (const e of stock) {
    if (e.kind !== 'CONSUMPTION' || !e.remarks?.startsWith('ref:')) continue;
    const own = drawnBy.get(e.remarks.slice(4));
    if (own) own.push(e); else drawnBy.set(e.remarks.slice(4), [e]);
  }
  const traces: FeedTrace[] = [];
  for (const f of feed) {
    if (!isISODate(f.date) || (fin(f.tonnes) ?? -1) <= 0) continue;
    if (range && !inRange(f.date, range)) continue;
    const parts = consumptionDeduction(f, formulas);
    const version = f.formulaId
      ? formulas.find(x => x.id === f.formulaId) ?? null
      : formulaForDate(f.shedId, f.date, formulas);
    const drawn = drawnBy.get(f.id);
    let cost = 0, pricedKg = 0, unpricedKg = 0;
    const lines: FeedTraceLine[] = (drawn?.length
      ? drawn.map(r => {
          const b = valuation.basis(r.id);
          return { ingredient: r.ingredient, kg: Math.abs(r.qtyKg), avg: b.avg, cost: b.value, unpriced: b.unpricedKg };
        })
      : parts.map(p => {
          const kg = fin(p.kg) ?? 0;
          const avg = valuation.avgAt(p.ingredient, f.date);
          return { ingredient: p.ingredient, kg, avg, cost: avg === null ? null : kg * avg, unpriced: avg === null ? kg : 0 };
        }))
      .map(l => {
        if (l.kg > 0) {
          if (l.cost !== null) { cost += l.cost; pricedKg += l.kg - l.unpriced; }
          unpricedKg += l.unpriced;
        }
        return { ingredient: l.ingredient, kg: r2(l.kg), avg: l.avg, cost: l.cost === null ? null : r2(l.cost) };
      })
      .sort((a, b) => b.kg - a.kg);
    traces.push({
      consumptionId: f.id, date: f.date, shedId: f.shedId, batchId: f.batchId, tonnes: f.tonnes,
      formulaId: version?.id ?? null,
      formulaName: version?.name ?? f.formulaName ?? null,
      formulaVersion: version?.version ?? f.formulaVersion ?? null,
      lines, cost: r2(cost), pricedKg: r2(pricedKg), unpricedKg: r2(unpricedKg),
      missingFormula: parts.length === 0,
    });
  }
  return traces;
}

/** What the feed actually used cost, day by day, priced at the godown average of that day. */
export function feedCostTrend(
  feed: FeedConsumption[], stock: FeedStockEntry[], formulas: FeedFormula[], range: Range,
): FeedCost {
  const traces = feedExpenseTraces(feed, stock, formulas, range);
  const byDay = new Map<string, number>();
  let pricedKg = 0, unpricedKg = 0, tonnes = 0, missingFormula = false;
  for (const t of traces) {
    tonnes += t.tonnes;
    pricedKg += t.pricedKg;
    unpricedKg += t.unpricedKg;
    if (t.missingFormula) { missingFormula = true; continue; }
    if (t.cost > 0) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.cost);
  }
  const points = series(range, byDay);
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const total = recorded.length ? r2(recorded.reduce((s, p) => s + p.value, 0)) : null;
  const last7 = recorded.filter(p => p.date > shiftDate(range.to, -7)).map(p => p.value);
  const warnings: string[] = [];
  if (missingFormula) warnings.push('Formula version unavailable for some feed — those days are left out of the cost.');
  if (unpricedKg > 0 && pricedKg > 0) warnings.push('Cost data incomplete — the godown has never priced some consumed ingredient.');
  if (unpricedKg > 0 && pricedKg === 0) warnings.push('No godown average on record for any consumed ingredient — the cost is not guessed.');
  if (!recorded.length && !warnings.length) warnings.push('No feed cost for this period');
  return {
    points, today: byDay.get(range.to) === undefined ? null : r2(byDay.get(range.to)!),
    avg7: mean(last7) === null ? null : r2(mean(last7)!),
    perTonne: div(total, tonnes === 0 ? null : r2(tonnes)),
    total, tonnes: r2(tonnes), pricedKg: r2(pricedKg), unpricedKg: r2(unpricedKg),
    missingFormula, available: recorded.length > 0, warnings,
  };
}

export type ShedFeedCost = {
  shedId: string; cost: number; tonnes: number; pricedKg: number; unpricedKg: number; missingFormula: boolean;
};

/**
 * The same valuation as feedCostTrend, grouped per shed instead of per day: what each
 * shed's birds actually ate, which is that shed's feed expense in the P&L.
 */
export function feedCostByShed(
  feed: FeedConsumption[], stock: FeedStockEntry[], formulas: FeedFormula[], range: Range,
): { rows: ShedFeedCost[]; total: number; unpricedKg: number; missingFormula: boolean } {
  const traces = feedExpenseTraces(feed, stock, formulas, range);
  const acc = new Map<string, ShedFeedCost>();
  let unpricedKg = 0, missingFormula = false;
  for (const t of traces) {
    const row = acc.get(t.shedId) ?? {
      shedId: t.shedId, cost: 0, tonnes: 0, pricedKg: 0, unpricedKg: 0, missingFormula: false,
    };
    row.tonnes += t.tonnes;
    row.cost += t.cost;
    row.pricedKg += t.pricedKg;
    row.unpricedKg += t.unpricedKg;
    if (t.missingFormula) row.missingFormula = missingFormula = true;
    acc.set(t.shedId, row);
    unpricedKg += t.unpricedKg;
  }
  const rows = [...acc.values()].map(r => ({
    ...r, cost: r2(r.cost), tonnes: r2(r.tonnes), pricedKg: r2(r.pricedKg), unpricedKg: r2(r.unpricedKg),
  }));
  const total = r2(rows.reduce((s, r) => s + r.cost, 0));
  return { rows: rows.sort((a, b) => b.cost - a.cost), total, unpricedKg: r2(unpricedKg), missingFormula };
}

export type ShortageRow = { id: string; date: string; ingredient: string; kg: number; avg: number | null; value: number | null };

/**
 * Godown shortages: signed adjustments that took stock out without a shed taking the
 * feed — loss, spoilage or a counting error. Valued at the godown average in force the
 * moment the loss was booked; a shortage with no average is counted in kg and left out
 * of the money rather than guessed at.
 */
export function godownShortages(stock: FeedStockEntry[], range: Range): {
  rows: ShortageRow[]; totalKg: number; totalValue: number | null; unpricedKg: number;
} {
  const valuation = valueGodown(stock);
  const rows: ShortageRow[] = [];
  let unpricedKg = 0;
  for (const e of stock) {
    if (e.kind !== 'ADJUSTMENT' && e.kind !== 'SHORTAGE') continue;
    if (!inRange(e.date, range) || !isISODate(e.date)) continue;
    const kg = fin(e.qtyKg);
    if (kg === null || kg >= 0) continue;
    const lost = Math.abs(kg);
    const b = valuation.basis(e.id);
    unpricedKg += b.unpricedKg;
    rows.push({ id: e.id, date: e.date, ingredient: e.ingredient, kg: r2(lost), avg: b.avg, value: b.value === null ? null : r2(b.value) });
  }
  const priced = rows.filter(r => r.value !== null);
  return {
    rows: rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    totalKg: r2(rows.reduce((s, r) => s + r.kg, 0)),
    totalValue: priced.length ? r2(priced.reduce((s, r) => s + r.value!, 0)) : null,
    unpricedKg: r2(unpricedKg),
  };
}

/* ============================= TRADERS ============================= */

export type TraderBalanceRow = { traderId: string; name: string; balance: number; active: boolean; txns: number };

/** Balances read back off the signed ledger: opening + billed − received. */
export function traderOutstanding(traders: Trader[], txns: TraderTxn[]): TraderBalanceRow[] {
  const byTrader = new Map<string, TraderTxn[]>();
  for (const t of txns) {
    const own = byTrader.get(t.traderId);
    if (own) own.push(t); else byTrader.set(t.traderId, [t]);
  }
  return traders
    .map(t => ({
      traderId: t.id, name: t.name, active: t.active,
      balance: traderBalance(t.openingBalance, byTrader.get(t.id) ?? []),
      txns: (byTrader.get(t.id) ?? []).length,
    }))
    .sort((a, b) => b.balance - a.balance);
}

export type CollectionTrend = {
  billed: Point[]; received: Point[]; movement: Point[];
  /** The grouping actually used, so a graph can say so. */
  groupUsed: 'DAY' | 'MONTH';
  totalBilled: number | null; totalReceived: number | null; outstanding: number;
  warnings: string[];
};

/** How wide a graph slot is: one day, a whole calendar month, or whatever fits the data. */
export type TrendGroup = 'DAY' | 'MONTH' | 'AUTO';

function trendSeries(range: Range, byDay: Map<string, number>, group: 'DAY' | 'MONTH'): Point[] {
  if (group === 'DAY') return series(range, byDay);
  return monthBuckets(range.to, Math.max(1, Math.ceil(range.days / 28))).map(b => {
    const hit = Array.from(byDay.entries()).filter(([d]) => d >= b.from && d <= b.to);
    return {
      date: b.from, label: b.label,
      value: hit.length ? r2(hit.reduce((s, [, v]) => s + v, 0)) : null,
    };
  });
}

/**
 * Sales billed against payments received, and the swing in dues, read off the signed
 * ledger. `AUTO` groups by calendar month only when a wide window has activity in at
 * least two months — a quarter that holds a single trading month is still told day by
 * day, because one monthly dot is not a trend. A bucket with no row shows no point
 * rather than a zero.
 */
export function traderCollections(
  traders: Trader[], txns: TraderTxn[], range: Range, group: TrendGroup = 'DAY',
): CollectionTrend {
  const live = new Set(traders.map(t => t.id));
  const rows = txns.filter(t => inRange(t.date, range) && live.has(t.traderId) && fin(t.amount) !== null);
  const billed = sumBy(rows.filter(t => t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT'), t => t.date, t => fin(t.amount), () => undefined);
  const received = sumBy(rows.filter(t => t.kind === 'PAYMENT_IN'), t => t.date, t => fin(t.amount), () => undefined);
  const monthUsed = range.days >= 60 && new Set([
    ...Array.from(billed.keys()), ...Array.from(received.keys()),
  ].map(d => d.slice(0, 7))).size >= 2;
  const groupUsed: 'DAY' | 'MONTH' = group === 'AUTO' ? (monthUsed ? 'MONTH' : 'DAY') : group;
  const movement = new Map<string, number>();
  for (const [d, v] of billed) movement.set(d, (movement.get(d) ?? 0) + v);
  for (const [d, v] of received) movement.set(d, (movement.get(d) ?? 0) - v);
  const sum = (m: Map<string, number>) => (m.size ? r2(Array.from(m.values()).reduce((s, v) => s + v, 0)) : null);
  return {
    billed: trendSeries(range, billed, groupUsed), received: trendSeries(range, received, groupUsed),
    movement: series(range, movement),
    groupUsed,
    totalBilled: sum(billed), totalReceived: sum(received),
    outstanding: r2(traderOutstanding(traders, txns).reduce((s, t) => s + Math.max(0, t.balance), 0)),
    warnings: rows.length ? [] : ['No trader transactions available for this period'],
  };
}

/* ============================= MONEY ============================= */

export type PnlBucket = {
  label: string; from: string; to: string;
  revenue: number | null; expense: number | null; net: number | null;
  revenueRows: number; expenseRows: number;
};

export type PnlMode = 'WEEK' | 'MONTH' | 'QUARTER';
export type Pnl = { buckets: PnlBucket[]; warnings: string[]; available: boolean };

const money = (rows: FinanceTxn[], kinds: FinanceTxn['kind'][]) => {
  const ok = rows.filter(r => kinds.includes(r.kind) && fin(r.amount) !== null);
  return { total: ok.length ? r2(ok.reduce((s, r) => s + (r.amount || 0), 0)) : null, count: ok.length };
};

function monthBuckets(to: string, count: number) {
  const end = parseISO(to);
  const out: { from: string; to: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = startOfMonth(subMonths(end, i));
    const monthEnd = endOfMonth(start);
    const last = monthEnd > end ? end : monthEnd;
    out.push({
      from: format(start, 'yyyy-MM-dd'),
      to: format(last, 'yyyy-MM-dd'),
      label: format(start, 'MMM yy'),
    });
  }
  return out;
}

function weekBuckets(to: string, count: number) {
  const out: { from: string; to: string; label: string }[] = [];
  let cursor = to;
  for (let i = 0; i < count; i++) {
    const from = shiftDate(cursor, -6);
    out.unshift({ from, to: cursor, label: `${fmtDateShort(from)}–${fmtDateShort(cursor)}` });
    cursor = shiftDate(from, -1);
  }
  return out;
}

/**
 * Money in against money out over time. A bucket with no expense row shows no net:
 * an unrecorded expense is not the same as a zero one.
 */
export function pnlTrend(finance: FinanceTxn[], mode: PnlMode, to = todayISO()): Pnl {
  const valid = finance.filter(f => isISODate(f.date) && fin(f.amount) !== null);
  const windows = mode === 'WEEK' ? weekBuckets(to, 8) : monthBuckets(to, mode === 'QUARTER' ? 3 : 6);
  const warnings: string[] = [];
  const buckets = windows.map(w => {
    const rows = valid.filter(f => f.date >= w.from && f.date <= w.to);
    const rev = money(rows, ['INCOME', 'SALE']);
    const exp = money(rows, ['EXPENSE', 'PURCHASE', 'PAYMENT_OUT']);
    if (rev.count && !exp.count) warnings.push(`Expenses not recorded for ${w.label}`);
    return {
      label: w.label, from: w.from, to: w.to,
      revenue: rev.total, expense: exp.total,
      net: rev.total !== null && exp.total !== null ? r2(rev.total - exp.total) : null,
      revenueRows: rev.count, expenseRows: exp.count,
    };
  });
  const usable = buckets.filter(b => b.net !== null);
  if (!usable.length) warnings.unshift('Not enough financial data to calculate P&L');
  return { buckets, warnings: Array.from(new Set(warnings)), available: usable.length > 0 };
}

export type RevenueTrend = {
  points: Point[]; today: number | null; avg7: number | null; total: number | null;
  eggShareKg: number | null; warnings: string[];
};

/** Money actually received, day by day, from the finance ledger. */
export function revenueTrend(finance: FinanceTxn[], range: Range): RevenueTrend {
  const rows = finance.filter(f => inRange(f.date, range) && isISODate(f.date) && fin(f.amount) !== null);
  const income = rows.filter(f => f.kind === 'INCOME' || f.kind === 'SALE');
  const byDay = sumBy(income, f => f.date, f => fin(f.amount), () => undefined);
  const points = series(range, byDay);
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const last7 = recorded.filter(p => p.date > shiftDate(range.to, -7)).map(p => p.value);
  const eggs = income.filter(f => f.category === 'Egg Sale').reduce((s, f) => s + f.amount, 0);
  return {
    points, today: byDay.get(range.to) ?? null,
    avg7: mean(last7) === null ? null : r2(mean(last7)!),
    total: recorded.length ? r2(recorded.reduce((s, p) => s + p.value, 0)) : null,
    eggShareKg: income.length ? r2(eggs) : null,
    warnings: noRecordWarning(points, 'income').slice(0, 1),
  };
}

export type BreakdownRow = { label: string; value: number; share: number | null };

/** Recorded categories only; an empty ledger returns nothing rather than a fake slice. */
export function revenueBreakdown(finance: FinanceTxn[], range: Range): { rows: BreakdownRow[]; donut: boolean } {
  const rows = finance.filter(f => inRange(f.date, range) && isISODate(f.date) && (f.kind === 'INCOME' || f.kind === 'SALE') && fin(f.amount) !== null);
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category || 'Uncategorised', (byCat.get(r.category || 'Uncategorised') ?? 0) + r.amount);
  const total = Array.from(byCat.values()).reduce((s, v) => s + v, 0);
  return {
    rows: Array.from(byCat.entries())
      .map(([label, value]) => ({ label, value: r2(value), share: div(value, total) }))
      .sort((a, b) => b.value - a.value),
    donut: byCat.size > 0 && byCat.size <= 5,
  };
}

/** Expense categories, used to label the P&L honestly. */
export function expenseBreakdown(finance: FinanceTxn[], range: Range): BreakdownRow[] {
  const rows = finance.filter(f => inRange(f.date, range) && isISODate(f.date)
    && (f.kind === 'EXPENSE' || f.kind === 'PURCHASE' || f.kind === 'PAYMENT_OUT') && fin(f.amount) !== null);
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category || 'Uncategorised', (byCat.get(r.category || 'Uncategorised') ?? 0) + r.amount);
  const total = Array.from(byCat.values()).reduce((s, v) => s + v, 0);
  return Array.from(byCat.entries())
    .map(([label, value]) => ({ label, value: r2(value), share: div(value, total) }))
    .sort((a, b) => b.value - a.value);
}

/* ============================= MORTALITY ============================= */

export type MortalityTrend = {
  points: Point[]; cumulative: Point[]; today: number | null; avg7: number | null;
  total: number | null; liveBirds: number | null; worst: { date: string; value: number } | null;
  excluded: number; warnings: string[];
};

/** Daily deaths, the running total and the birds still standing. */
export function mortalityTrend(
  mortality: MortalityEntry[], batches: Batch[], range: Range,
  filter: { shedId?: string; batchId?: string } = {},
): MortalityTrend {
  const batchIds = new Set(batches.map(b => b.id));
  const shedOf = new Map(batches.map(b => [b.id, b.shedId]));
  let excluded = 0;
  const rows = mortality.filter(m => {
    const numeric = fin(m.count);
    const linked = batchIds.has(m.batchId) && (!filter.shedId || shedOf.get(m.batchId) === filter.shedId);
    const ok = isISODate(m.date) && numeric !== null && numeric >= 0 && linked
      && (!filter.batchId || m.batchId === filter.batchId);
    if (!ok) excluded++;
    return ok;
  });
  const byDay = sumBy(rows.filter(r => inRange(r.date, range)), r => r.date, r => fin(r.count), () => undefined);
  const points = series(range, byDay);
  const before = (date: string) => rows.filter(r => r.date < date).reduce((s, r) => s + r.count, 0);
  let running = before(range.from);
  const cumulative: Point[] = [];
  for (const p of points) {
    if (p.value !== null) running += p.value;
    cumulative.push({ date: p.date, value: running });
  }
  const scope = batches.filter(b => b.status === 'ACTIVE'
    && (!filter.shedId || b.shedId === filter.shedId) && (!filter.batchId || b.id === filter.batchId));
  const liveBirds = scope.length ? scope.reduce((s, b) => s + liveBirdsOn(b, range.to, rows), 0) : null;
  const recorded = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const last7 = recorded.filter(p => p.date > shiftDate(range.to, -7)).map(p => p.value);
  const worst = recorded.length ? recorded.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const warnings = noRecordWarning(points, 'mortality');
  if (excluded) warnings.push(`${excluded} mortality ${excluded === 1 ? 'entry was' : 'entries were'} excluded for an invalid count, date or shed link.`);
  return {
    points, cumulative,
    today: byDay.get(range.to) ?? null,
    avg7: mean(last7) === null ? null : r2(mean(last7)!),
    total: recorded.length ? recorded.reduce((s, p) => s + p.value, 0) : null,
    liveBirds, worst: worst ? { date: worst.date, value: worst.value } : null,
    excluded, warnings,
  };
}

/* ============================= HELPERS FOR THE CARDS ============================= */

/** Eggs implied by trays, used only where a card explains a rate per egg. */
export function eggsOf(trays: number): number { return trays * EGGS_PER_TRAY; }

export function sumPoints(points: Point[]): number | null {
  const vals = points.map(p => p.value).filter((v): v is number => v !== null);
  return vals.length ? r2(vals.reduce((s, v) => s + v, 0)) : null;
}

export const TONE_BY_STOCK_STATUS: Record<GodownRow['status'], Tone> = {
  NORMAL: 'success', LOW: 'warn', CRITICAL: 'danger',
};
