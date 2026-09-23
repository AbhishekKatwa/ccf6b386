import { eggStockTrays, eggSummary } from '@/lib/calc';
import { shiftDate, todayISO } from '@/lib/format';
import type { EggCollection, EggSaleBooking, SaleEntry } from '@/types';

/**
 * The Egg Sale Planner's arithmetic. Everything here is a FORECAST: no function in
 * this file moves stock, books money or touches a trader balance — those belong to
 * the actual sale entry alone. A plan that could alter the books would be a second
 * set of them.
 */

/** Today plus the next four days. */
export const PLANNER_DAYS = 5;

/** The rolling board. It slides forward on its own; records that leave it are kept. */
export function plannerWindow(today = todayISO(), days = PLANNER_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => shiftDate(today, i));
}

/** A booking is a promise of trays whether it is still open or already sold — either way the load counts. */
const counts = (b: EggSaleBooking) => b.status !== 'CANCELLED';

/**
 * Trays a shed is expected to lay on a date. A day already collected reads its own
 * record; a day still to come borrows the average of the previous seven recorded
 * days. With nothing collected on record at all it stays unknown rather than being
 * guessed at zero.
 */
export function projectedProduction(
  shedId: string, eggs: EggCollection[], date: string, today = todayISO(),
): { trays: number | null; recorded: boolean } {
  if (date <= today && eggs.some(e => e.shedId === shedId && e.date === date)) {
    return { trays: eggSummary(shedId, eggs, date).total, recorded: true };
  }
  const days: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = shiftDate(date, -i);
    if (eggs.some(e => e.shedId === shedId && e.date === d)) days.push(eggSummary(shedId, eggs, d).total);
  }
  if (!days.length) return { trays: null, recorded: false };
  return { trays: Math.round(days.reduce((s, v) => s + v, 0) / days.length), recorded: false };
}

export type ShedDayPlan = {
  date: string;
  /** Yesterday's actual closing stock, or the previous projected day's remainder. */
  opening: number;
  production: number | null;
  /** Trays the shed should hold for dispatch that day. Null means nothing supports the figure. */
  available: number | null;
  booked: number;
  remaining: number | null;
  /** Trays promised past the projection, or 0. */
  shortage: number;
  /** False when the day's production is a forecast rather than a collection record. */
  recorded: boolean;
  bookings: EggSaleBooking[];
};

/**
 * One shed walked forward across the window: last night's real closing stock, plus
 * each day's lay, less every tray already promised — carried day to day so an
 * over-booked date pulls the ones after it down with it.
 */
export function shedDayPlans(input: {
  shedId: string;
  eggs: EggCollection[];
  entries: SaleEntry[];
  bookings: EggSaleBooking[];
  dates: string[];
  today?: string;
}): ShedDayPlan[] {
  const { shedId, eggs, entries, bookings, dates } = input;
  const today = input.today ?? todayISO();
  const own = bookings.filter(b => b.shedId === shedId && counts(b));

  // The evening before the board opens is the only figure here that is not a forecast.
  let carry = eggStockTrays(shedId, eggs, entries, shiftDate(today, -1)).balance;

  return dates.map(date => {
    const prod = projectedProduction(shedId, eggs, date, today);
    const available = prod.trays === null ? null : carry + prod.trays;
    const booked = own.filter(b => b.date === date).reduce((s, b) => s + b.plannedTrays, 0);
    const remaining = available === null ? null : available - booked;
    const plan: ShedDayPlan = {
      date, opening: carry, production: prod.trays, available, booked,
      remaining, shortage: remaining !== null && remaining < 0 ? -remaining : 0,
      recorded: prod.recorded, bookings: own.filter(b => b.date === date),
    };
    // A day cannot hand on more than it ends with, so a shortfall carries forward too.
    carry = remaining ?? carry;
    return plan;
  });
}

/** What the window adds up to for one shed: promised trays, and how many days fall short. */
export function planSummary(plans: ShedDayPlan[]) {
  return {
    booked: plans.reduce((s, p) => s + p.booked, 0),
    bookings: plans.reduce((s, p) => s + p.bookings.length, 0),
    shortDays: plans.filter(p => p.shortage > 0).length,
    unknown: plans.some(p => p.available === null),
  };
}

/**
 * Why a booking cannot be saved, or null when it can. Company membership of the shed
 * and the trader is checked here as well as in the picker, so a hand-made payload
 * cannot plan another farm's load.
 */
export function bookingError(
  input: { date: string; shedId: string; traderId: string; plannedTrays: number },
  ctx: {
    window: string[];
    shedIds: string[];
    traderIds: string[];
    /** The booking being edited, so its own saved date is not judged as a change. */
    existing?: { date: string };
  },
): string | null {
  const { date, shedId, traderId, plannedTrays } = input;
  if (!shedId) return 'Select the shed';
  if (!ctx.shedIds.includes(shedId)) return 'That shed does not belong to this company';
  if (!traderId) return 'Select the trader';
  if (!ctx.traderIds.includes(traderId)) return 'That trader does not belong to this company';
  if (!Number.isFinite(plannedTrays) || plannedTrays <= 0) return 'Planned trays must be greater than 0';
  if (!ctx.window.includes(date) && date !== ctx.existing?.date) {
    return 'A booking can only be planned for today or the next four days';
  }
  return null;
}
