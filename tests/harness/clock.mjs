/**
 * tests/harness/clock.mjs — one place the suite decides what "today" is.
 *
 * The app reads the calendar through `todayISO()`/`nowISO()` in `lib/format`, both of which
 * call `new Date()`. Pinning the clock means a test written in 2026 still says the shed is
 * on day 40 of its batch in 2031, and date-scoped rules (the planner window, vaccination
 * reminders, period P&L) can be asserted without waiting for a calendar to agree.
 */

const RealDate = Date;

/** The farm day every fixture is written against: `todayISO()` reads this. */
export const TEST_TODAY = '2026-02-15';
/** A Sunday morning at the shed — 09:30 IST, the instant `nowISO()` reports. */
export const TEST_NOW = `${TEST_TODAY}T09:30:00+05:30`;

let frozenMs = null;

class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(frozenMs ?? RealDate.now());
    else super(...args);
  }
  static now() {
    return frozenMs ?? RealDate.now();
  }
}

/** Pin `new Date()` and `Date.now()` to an instant. Accepts an ISO string or epoch ms. */
export function freezeClock(at = TEST_NOW) {
  frozenMs = typeof at === 'number' ? at : new RealDate(at).getTime();
  if (Number.isNaN(frozenMs)) throw new Error(`[tests] cannot freeze the clock at ${at}`);
  globalThis.Date = PinnedDate;
  return frozenMs;
}

/** Hour and day forward from the pinned instant — a cheap stand-in for elapsed time. */
export function advanceClock(ms) {
  if (frozenMs === null) throw new Error('[tests] advanceClock() needs a frozen clock');
  frozenMs += ms;
  return frozenMs;
}

export function unfreezeClock() {
  frozenMs = null;
  globalThis.Date = RealDate;
}

export function clockFrozen() {
  return frozenMs !== null;
}
