/**
 * Godown valuation — the farm's single source of ingredient price.
 *
 * The godown ledger (`FeedStockEntry` rows) stays the only record of what exists and of
 * what it cost. This replays that ledger in date order and maintains ONE weighted average
 * cost per ingredient, so every downstream figure — a formula's cost per tonne, a shed's
 * feed expense, a shortage valuation, the inventory asset on the Finance screen — reads the
 * same number rather than keeping a price of its own.
 *
 * The rules are the accounting rules the farm runs on:
 *  - A receipt that carries a rate re-weights the average: the value already in stock pools
 *    with the new receipt's value (§2). Receipt at zero stock simply sets the average (§3).
 *    The previous average is never overwritten by the latest purchase price (§4).
 *  - Stock leaving — a shed's consumption, an issue out, a shortage — is valued at the
 *    average in force the moment it is booked and leaves the average untouched (§14, §15).
 *  - Every movement's own price is retained, so a shed's draw keeps the average it was
 *    taken at even when a receipt later in the same day re-weights it (§20, §21).
 *  - Quantities with no price basis anywhere are counted in KG and left out of the money
 *    totals. A missing rate is never read as ₹0.
 */
import type { FeedStockEntry } from '@/types';
import { stockDelta } from './calc';

/** A rate is only usable when it is a real, positive price. */
function rate(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function qty(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Weighted average of stock already held and a receipt coming in — the rule of §2. */
export function blendPrice(stockKg: number, stockAvg: number | null, receiptKg: number, receiptRate: number): number {
  const held = Math.max(0, stockKg);
  const added = Math.max(0, receiptKg);
  if (stockAvg === null || held <= 0) return receiptRate;
  if (added <= 0) return stockAvg;
  return (held * stockAvg + added * receiptRate) / (held + added);
}

/** An ingredient's valuation position at a point in time. */
export type GodownPosition = {
  /** Physical KG in stock — always the godown ledger's own balance. */
  kg: number;
  /** The part of that stock whose cost is known. */
  valuedKg: number;
  /** KG carried with no price basis on record; counted, never valued at zero. */
  unpricedKg: number;
  /** Cost lying in the godown for this ingredient. */
  value: number;
  /** The authoritative average cost per KG, or null when nothing has ever priced it. */
  avg: number | null;
};

type State = GodownPosition;

const emptyState = (): State => ({ kg: 0, valuedKg: 0, unpricedKg: 0, value: 0, avg: null });

/** Weighted average in force: derived from valued stock, or held over once stock empties. */
function averageOf(s: State): number | null {
  return s.valuedKg > 0 ? s.value / s.valuedKg : s.avg;
}

/** The money one ledger movement took, and the ₹/kg it was taken at. */
export type MovementBasis = {
  /** ₹/kg applied to the priced part of the movement; null when nothing priced it. */
  avg: number | null;
  /** ₹ that this movement added to or removed from the godown's value; null when unpriced. */
  value: number | null;
  /** KG that moved with no cost basis behind them. */
  unpricedKg: number;
};

const UNPRICED: MovementBasis = { avg: null, value: null, unpricedKg: 0 };

function takeIn(s: State, kg: number, receiptRate: number | null): MovementBasis {
  if (kg <= 0) return UNPRICED;
  const before = averageOf(s);
  s.kg += kg;
  if (receiptRate !== null) {
    const blend = blendPrice(s.valuedKg, before, kg, receiptRate);
    s.valuedKg += kg;
    s.value += kg * receiptRate;
    s.avg = blend;
    return { avg: receiptRate, value: kg * receiptRate, unpricedKg: 0 };
  }
  if (before !== null) {
    // Stock coming back with no rate of its own re-enters at the godown's own basis, which
    // is what a day's reversal should do: quantity returns, the average does not move.
    s.valuedKg += kg;
    s.value += kg * before;
    return { avg: before, value: kg * before, unpricedKg: 0 };
  }
  s.unpricedKg += kg;
  return { avg: null, value: null, unpricedKg: kg };
}

function takeOut(s: State, kg: number): MovementBasis {
  if (kg <= 0) return UNPRICED;
  const before = averageOf(s);
  const fromValued = Math.min(s.valuedKg, kg);
  s.valuedKg -= fromValued;
  // Value follows quantity at the same average, so the average itself never moves (§15).
  s.value = s.valuedKg > 0 ? s.valuedKg * (before ?? 0) : 0;
  const fromUnpriced = Math.min(Math.max(0, s.unpricedKg), kg - fromValued);
  s.unpricedKg -= fromUnpriced;
  s.kg -= kg;
  s.avg = before;
  return before === null
    ? { avg: null, value: null, unpricedKg: kg }
    : { avg: before, value: fromValued * before, unpricedKg: kg - fromValued };
}

const snapshot = (s: State): State => ({ ...s });
/** The position a state describes, with the average resolved. */
function positionOf(s: State): GodownPosition {
  const avg = averageOf(s);
  return {
    kg: s.kg,
    valuedKg: s.valuedKg,
    unpricedKg: s.unpricedKg,
    value: Math.max(0, s.value),
    avg: avg === null || !Number.isFinite(avg) ? null : avg,
  };
}

const ZERO = emptyState();

/** The book state a movement was booked against, and the state it left behind. */
export type MovementPositions = { before: GodownPosition; after: GodownPosition };

/** The replayed ledger, queried by ingredient and date. */
export type GodownValuation = {
  /** Position at the close of `date`; an ingredient never seen yields zeroes. */
  at(ingredient: string, date: string): GodownPosition;
  /** Position after every recorded movement — the godown as it stands. */
  now(ingredient: string): GodownPosition;
  /** The average cost per KG in force for an ingredient on a date. */
  avgAt(ingredient: string, date: string): number | null;
  /** What one ledger movement actually cost, at the price in force the moment it was booked. */
  basis(entryId: string): MovementBasis;
  /** The stock and average immediately around one movement, or null when the replay never read it. */
  positions(entryId: string): MovementPositions | null;
  /** Every ingredient with readable ledger history, positioned as of `asOf`. */
  rows(asOf: string): (GodownPosition & { ingredient: string })[];
  totals(asOf: string): { kg: number; value: number; pricedKg: number; unpricedKg: number; inStock: number };
  /** Ingredients the ledger mentions but this replay could not read a quantity for. */
  unreadable: string[];
};

/**
 * Replay the godown ledger into weighted-average valuations. Rows with an unreadable date
 * or quantity are skipped and named in `unreadable` rather than quietly counted as zero.
 */
export function valueGodown(stock: FeedStockEntry[]): GodownValuation {
  const grouped = new Map<string, FeedStockEntry[]>();
  for (const e of stock) {
    if (!isDay(e.date) || qty(e.qtyKg) === null) continue;
    const own = grouped.get(e.ingredient);
    if (own) own.push(e); else grouped.set(e.ingredient, [e]);
  }
  // An ingredient whose rows are all unreadable would otherwise vanish silently.
  const readable = new Set(grouped.keys());
  const unreadable = Array.from(new Set(stock.map(e => e.ingredient)))
    .filter(i => !readable.has(i)).sort();

  const timelines = new Map<string, { date: string; state: State }[]>();
  const bases = new Map<string, MovementBasis>();
  const places = new Map<string, MovementPositions>();
  for (const [ingredient, rows] of grouped) {
    rows.sort((a, b) =>
      a.date.localeCompare(b.date)
      || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
      || a.id.localeCompare(b.id));
    const s = emptyState();
    const snaps: { date: string; state: State }[] = [];
    for (const e of rows) {
      const delta = stockDelta(e);
      const before = snapshot(s);
      const basis = delta > 0 ? takeIn(s, delta, rate(e.ratePerKg))
        : delta < 0 ? takeOut(s, -delta)
          : { avg: averageOf(s), value: 0, unpricedKg: 0 };
      bases.set(e.id, basis);
      places.set(e.id, { before: positionOf(before), after: positionOf(s) });
      snaps.push({ date: e.date, state: snapshot(s) });
    }
    timelines.set(ingredient, snaps);
  }

  const stateAt = (ingredient: string, date: string): State => {
    const snaps = timelines.get(ingredient);
    if (!snaps?.length) return ZERO;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].date <= date) return snaps[i].state;
    }
    return ZERO;
  };

  const at = (ingredient: string, date: string) => positionOf(stateAt(ingredient, date));

  return {
    at,
    now: ingredient => at(ingredient, '9999-12-31'),
    avgAt: (ingredient, date) => at(ingredient, date).avg,
    basis: entryId => bases.get(entryId) ?? UNPRICED,
    positions: entryId => places.get(entryId) ?? null,
    rows: asOf => Array.from(timelines.keys())
      .map(ingredient => ({ ingredient, ...at(ingredient, asOf) }))
      .sort((a, b) => b.kg - a.kg),
    totals: asOf => {
      let kg = 0, value = 0, pricedKg = 0, unpricedKg = 0, inStock = 0;
      for (const row of Array.from(timelines.keys()).map(ingredient => at(ingredient, asOf))) {
        if (row.kg > 0) { inStock++; kg += row.kg; }
        if (row.kg <= 0) continue; // a settled or overdrawn ingredient holds no value
        if (row.avg === null) unpricedKg += row.kg;
        else { value += row.value; pricedKg += row.valuedKg; unpricedKg += Math.max(0, row.kg - row.valuedKg); }
      }
      return { kg, value, pricedKg, unpricedKg, inStock };
    },
    unreadable,
  };
}
