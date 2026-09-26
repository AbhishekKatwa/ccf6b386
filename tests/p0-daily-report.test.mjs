/**
 * tests/p0-daily-report.test.mjs — P0: the printable day-wise sheet of one batch.
 *
 * Every column of `/batches/:batchId/daily-report` is a figure a supervisor signs off on:
 * birds alive, birds lost, feed given, eggs collected, and the running totals beside them.
 * The report used to compute all of that inside a `useMemo`, which meant the only way to read
 * a number was to render a table and look at it. `lib/dailyReport.ts` is that same arithmetic
 * lifted out, so this file can assert the values themselves.
 *
 * The fixture is invented and chosen to be re-derivable by hand. The batch is placed on
 * 2026-01-17, which is exactly the first day of the 30-day window the sheet prints, so the
 * rows run Day 0 to Day 29 and end on the frozen farm day (`TEST_TODAY`, 2026-02-15). Each
 * expected figure below is written out as the division that produces it.
 *
 * Two defects are pinned here as regressions, both from filtering by the wrong key:
 *   - eggs were taken by *shed*, so the flock that replaces this batch in the same shed would
 *     have printed on this batch's sheet;
 *   - the window was counted from `new Date()` through a UTC cut, which loses the local day
 *     before 05:30 IST — the hours the morning shift actually reads this report.
 *
 * Run with: npm test
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyReport, dailyReportTotals, DAILY_REPORT_DAYS } from '@/lib/dailyReport';
import { shiftDate } from '@/lib/format';
import { EGGS_PER_TRAY } from '@/types';
import { freezeClock, TEST_NOW } from './harness/clock.mjs';
import { CO, U, SH, BT, DAY, buildWorld } from './harness/fixtures.ts';

/** The report's own flock: placed on the window's first day, 1,000 birds, in shed A1. */
const REP = 'bt_report_rep';
const PLACED = '2026-01-17';

const batch = (over = {}) => ({
  id: REP, companyId: CO.ALPHA, farmId: 'fp_test_alpha', shedId: SH.A1, code: 'REP-01',
  birdType: 'LAYER', breed: 'KH', hatchDate: '2026-01-01', placementDate: PLACED, startDate: PLACED,
  initialBirds: 1000, status: 'ACTIVE', createdBy: U.ALPHA_OWNER, createdAt: '2026-01-01T04:00:00.000Z',
  updatedAt: '2026-01-01T04:00:00.000Z', ...over,
});

const death = (id, batchId, date, count, companyId = CO.ALPHA) => ({
  id, companyId, batchId, shedId: SH.A1, date, count,
  createdBy: U.ALPHA_LABOR, createdAt: `${date}T04:00:00.000Z`, synced: true,
});

const eaten = (id, batchId, date, tonnes, companyId = CO.ALPHA) => ({
  id, companyId, batchId, shedId: SH.A1, date, tonnes,
  createdBy: U.ALPHA_LABOR, createdAt: `${date}T04:00:00.000Z`, synced: true,
});

const laid = (id, batchId, shedId, date, byGrade, companyId = CO.ALPHA) => ({
  id, companyId, batchId, shedId, date,
  goodTrays: byGrade.GOOD ?? 0, brokenTrays: byGrade.BROKEN ?? 0,
  doubleTrays: byGrade.DOUBLE ?? 0, smallTrays: byGrade.SMALL ?? 0,
  createdBy: U.ALPHA_LABOR, createdAt: `${date}T04:00:00.000Z`, synced: true,
});

/**
 * The whole scenario in three ledgers. Nothing else touches the batch, so any figure that
 * wanders into a row came from another batch or another company.
 */
function scenario() {
  return {
    batch: batch(),
    mortality: [
      // Before the window opens: still part of the flock's history, so day one starts at 995.
      death('mo_rep_early', REP, '2026-01-10', 5),
      death('mo_rep_1', REP, '2026-01-27', 20),
      death('mo_rep_2', REP, '2026-02-06', 30),
      // After the window closes: must not reach any row.
      death('mo_rep_after', REP, '2026-03-01', 99),
      // Another batch of the same company, on a day this report already reads.
      death('mo_other_batch', BT.A2, '2026-01-27', 500),
      // Another company entirely.
      death('mo_beta', BT.B1, '2026-01-27', 700, CO.BETA),
    ],
    feed: [
      eaten('fd_rep_1', REP, '2026-01-22', 0.12),
      // Two rounds on one day add up to that day's feed.
      eaten('fd_rep_2', REP, '2026-02-01', 0.24),
      eaten('fd_rep_2b', REP, '2026-02-01', 0.06),
      eaten('fd_rep_before', REP, '2026-01-05', 2),
      eaten('fd_rep_after', REP, '2026-03-05', 3),
      eaten('fd_other_batch', BT.A2, '2026-01-22', 5),
      eaten('fd_beta', BT.B1, '2026-01-22', 9, CO.BETA),
    ],
    eggs: [
      laid('eg_rep_1', REP, SH.A1, '2026-01-20', { GOOD: 10, BROKEN: 2, DOUBLE: 1, SMALL: 3 }),
      laid('eg_rep_2', REP, SH.A1, '2026-01-20', { GOOD: 4 }),
      laid('eg_rep_3', REP, SH.A1, '2026-02-11', { GOOD: 100, BROKEN: 5, DOUBLE: 2, SMALL: 1 }),
      laid('eg_rep_outside', REP, SH.A1, '2026-03-20', { GOOD: 77 }),
      /**
       * The flock that succeeds this one in the same shed. A report that asked "what did shed
       * A1 lay" would print these trays as this batch's own.
       */
      laid('eg_shed_successor', BT.A2, SH.A1, '2026-01-20', { GOOD: 999, BROKEN: 999, DOUBLE: 999, SMALL: 999 }),
      laid('eg_beta', BT.B1, SH.B1, '2026-01-20', { GOOD: 500 }, CO.BETA),
    ],
  };
}

const report = (over = {}) => buildDailyReport({ today: DAY, ...scenario(), ...over });
const rowOn = (rows, date) => rows.find(r => r.date === date);

afterEach(() => freezeClock(TEST_NOW));

describe('P0 · the daily report prints one row per day of the window', () => {
  it('thirty consecutive local days, ending on the farm day', () => {
    const rows = report();
    assert.equal(rows.length, DAILY_REPORT_DAYS);
    assert.equal(rows[0].date, '2026-01-17');
    assert.equal(rows[rows.length - 1].date, DAY);
    assert.equal(new Set(rows.map(r => r.date)).size, DAILY_REPORT_DAYS, 'one row per day, never two');
    rows.forEach((r, i) => {
      if (i === 0) return;
      assert.equal(r.date, shiftDate(rows[i - 1].date, 1), `${r.date} must follow ${rows[i - 1].date}`);
    });
  });

  it('the day counter runs from placement, so the window opens on Day 0', () => {
    assert.deepEqual(report().map(r => r.day), [...Array(30).keys()]);
  });

  it('a batch placed mid-window reads Day 0 for every day before its placement', () => {
    const rows = report({ batch: batch({ placementDate: '2026-02-10' }) });
    assert.deepEqual(rows.slice(-6).map(r => r.day), [0, 1, 2, 3, 4, 5],
      'placement day is Day 0, and the sheet still prints the days before it');
    assert.ok(rows.slice(0, 24).every(r => r.day === 0), 'a negative flock age is never printed');
  });

  it('the window belongs to the local farm day, not the UTC one', () => {
    // 00:30 IST on 2026-02-15 is still 2026-02-14 in UTC — the old code cut the wrong day off.
    freezeClock('2026-02-15T00:30:00+05:30');
    const rows = buildDailyReport(scenario());
    assert.equal(rows[rows.length - 1].date, DAY,
      'the morning shift reads this sheet before 05:30 IST; today must still be today');
    assert.equal(rows[0].date, '2026-01-17');
  });
});

describe('P0 · the daily report’s bird columns', () => {
  it('live birds fall only by this batch’s own deaths, on and after the day they happened', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-17').live, 995, '1,000 − the 5 birds lost before the window');
    assert.equal(rowOn(rows, '2026-01-26').live, 995, 'the day before a death still counts those birds');
    assert.equal(rowOn(rows, '2026-01-27').live, 975, '995 − 20');
    assert.equal(rowOn(rows, '2026-02-06').live, 945, '975 − 30');
    assert.equal(rowOn(rows, '2026-02-15').live, 945, 'and it holds until the next death');
  });

  it('a day’s mortality counts only that day, and only this batch', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-27').mort, 20, 'the other batch lost 500 birds that day');
    assert.equal(rowOn(rows, '2026-01-20').mort, 0, 'a quiet day is zero, never blank');
    assert.equal(rowOn(rows, '2026-02-15').mort, 0, 'a death after the window is not this month’s');
  });

  it('mortality percentage is of the birds the batch started with', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-27').mortPct, (20 / 1000) * 100);
    assert.equal(rowOn(rows, '2026-01-27').mortPct, 2);
    assert.equal(rowOn(rows, '2026-01-20').mortPct, 0);
  });

  it('cumulative mortality and its percentage run from placement, not from the window', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-17').cumMort, 5, 'the pre-window loss is still on the flock');
    assert.equal(rowOn(rows, '2026-01-26').cumMort, 5);
    assert.equal(rowOn(rows, '2026-01-27').cumMort, 25);
    assert.equal(rowOn(rows, '2026-01-27').cumMortPct, 2.5);
    assert.equal(rowOn(rows, '2026-02-06').cumMort, 55);
    assert.equal(rowOn(rows, '2026-02-15').cumMort, 55, 'nothing after the window is folded in');
    assert.equal(rowOn(rows, '2026-02-15').cumMortPct, 5.5);
  });

  it('a batch with no birds on paper divides by nothing and reads zero, never NaN', () => {
    const rows = report({ batch: batch({ initialBirds: 0 }) });
    const day = rowOn(rows, '2026-01-27');
    assert.equal(day.mortPct, 0);
    assert.equal(day.cumMortPct, 0);
    assert.equal(day.feedPerBirdG, 0, 'no bird to feed means no grams a bird');
    assert.equal(Number.isNaN(day.mortPct), false);
  });
});

describe('P0 · the daily report’s feed columns', () => {
  it('tonnes on the ledger become kilograms on the sheet', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-22').feedKg, 120, '0.12 t');
    assert.equal(rowOn(rows, '2026-02-01').feedKg, 300, '0.24 t + 0.06 t on one day');
    assert.equal(rowOn(rows, '2026-01-20').feedKg, 0, 'a day with no feed round');
  });

  it('cumulative feed is the window’s own running total', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-22').cumFeedKg, 120);
    assert.equal(rowOn(rows, '2026-01-31').cumFeedKg, 120, 'a feed-free day carries the total forward');
    assert.equal(rowOn(rows, '2026-02-01').cumFeedKg, 420, '120 + 300');
    assert.equal(rowOn(rows, '2026-02-15').cumFeedKg, 420,
      'the 2 t given before the window and the 3 t after it are neither row’s');
  });

  it('grams per bird uses the birds alive that day', () => {
    const rows = report();
    assert.equal(rowOn(rows, '2026-01-22').feedPerBirdG, Math.round((120 * 1000) / 995), '121 g a bird');
    assert.equal(rowOn(rows, '2026-01-22').feedPerBirdG, 121);
    assert.equal(rowOn(rows, '2026-02-01').feedPerBirdG, Math.round((300 * 1000) / 975), '308 g a bird');
    assert.equal(rowOn(rows, '2026-02-01').feedPerBirdG, 308);
    assert.equal(rowOn(rows, '2026-01-20').feedPerBirdG, 0);
  });
});

describe('P0 · the daily report’s egg columns', () => {
  it('the four grades are kept apart and summed by tray', () => {
    const rows = report();
    const day3 = rowOn(rows, '2026-01-20');
    assert.deepEqual(day3.byGrade, { GOOD: 14, BROKEN: 2, DOUBLE: 1, SMALL: 3 },
      'two collections on one day add grade by grade');
    assert.equal(day3.trays, 20);
    assert.equal(day3.eggs, 20 * EGGS_PER_TRAY, 'a tray is thirty eggs, always');
    assert.equal(day3.eggs, 600);
  });

  it('a day with no collection reads zero across every grade, not blank', () => {
    const day = rowOn(report(), '2026-01-19');
    assert.deepEqual(day.byGrade, { GOOD: 0, BROKEN: 0, DOUBLE: 0, SMALL: 0 });
    assert.equal(day.trays, 0);
    assert.equal(day.eggs, 0);
  });

  it('eggs are the batch’s own, even when the next flock lays in the same shed', () => {
    const day3 = rowOn(report(), '2026-01-20');
    assert.equal(day3.trays, 20, 'the successor flock’s 999 trays a grade are not this batch’s');
    assert.equal(day3.byGrade.GOOD, 14);
  });

  it('the 30-day foot of the sheet totals the window it prints', () => {
    const totals = dailyReportTotals(report());
    assert.equal(totals.feedKg, 420);
    assert.equal(totals.feedTonnes, 0.42);
    assert.equal(totals.mortality, 55);
    assert.equal(totals.trays, 128, '20 + 108');
    assert.equal(totals.eggs, 3840);
  });

  it('an empty month still foots to zero', () => {
    const rows = report({ mortality: [], feed: [], eggs: [] });
    assert.equal(rows.length, DAILY_REPORT_DAYS);
    assert.deepEqual(dailyReportTotals(rows), {
      feedKg: 0, feedTonnes: 0, mortality: 0, trays: 0, eggs: 0,
    });
    assert.ok(rows.every(r => r.live === 1000 && r.day >= 0), 'the flock is still there, whole');
    const totals = dailyReportTotals(rows);
    assert.equal(Number.isNaN(totals.eggs), false);
  });

  it('a broiler batch is arithmetically clean, and hides nothing by zeroing it', () => {
    // Which columns the sheet prints is the screen's call (`isLayer`); the numbers are not
    // rewritten for a broiler, so a report never silently invents or erases a figure.
    const rows = report({ batch: batch({ birdType: 'BROILER' }), eggs: [] });
    assert.ok(rows.every(r => r.eggs === 0 && r.trays === 0 && Number.isFinite(r.feedPerBirdG)));
    assert.equal(dailyReportTotals(rows).eggs, 0);
    assert.equal(rowOn(rows, '2026-02-01').feedPerBirdG, 308, 'the bird columns still read the flock');
  });
});

describe('P0 · the daily report cannot merge another batch or company', () => {
  it('every foreign figure is absent from every row', () => {
    const rows = report();
    const sum = (pick) => rows.reduce((s, r) => s + pick(r), 0);
    assert.equal(sum(r => r.mort), 50, '20 + 30, and never 500 or 700');
    assert.equal(sum(r => r.feedKg), 420, 'never the other batch’s 5,000 kg or Beta’s 9,000 kg');
    assert.equal(sum(r => r.trays), 128, 'never the successor flock’s 3,996 trays');
    assert.ok(rows.every(r => r.live >= 945 && r.live <= 1000));
  });

  it('the seeded two-farm world reads each flock separately', () => {
    const world = buildWorld();
    const of = id => world.batches.find(b => b.id === id);
    const args = { mortality: world.mortality, feed: world.feed, eggs: world.eggs, today: DAY };

    const a1 = buildDailyReport({ batch: of(BT.A1), ...args });
    assert.equal(rowOn(a1, '2026-02-14').trays, 135, 'Alpha A1’s own collection: 100+20+10+5');
    assert.equal(rowOn(a1, DAY).trays, 95, 'shed A2’s 20 trays today are not A1’s');
    assert.equal(rowOn(a1, '2026-02-10').mort, 10);
    assert.equal(rowOn(a1, '2026-02-10').live, 990);

    const b1 = buildDailyReport({ batch: of(BT.B1), ...args });
    assert.equal(rowOn(b1, DAY).trays, 18, 'Beta’s own 15+3');
    assert.equal(rowOn(b1, '2026-02-10').mort, 5, 'Beta lost 5 birds, not Alpha’s 10');
    assert.equal(rowOn(b1, DAY).live, 795, '800 placed − 5');
    assert.equal(b1.reduce((s, r) => s + r.trays, 0), 18, 'not one Alpha tray reached Beta’s sheet');

    const a2 = buildDailyReport({ batch: of(BT.A2), ...args });
    assert.equal(rowOn(a2, DAY).trays, 20);
    assert.equal(a2.reduce((s, r) => s + r.mort, 0), 0, 'A1’s deaths are not A2’s');
  });

  it('building a report changes nothing it was handed', () => {
    const src = scenario();
    const snapshot = JSON.stringify([src.batch, src.mortality, src.feed, src.eggs]);
    buildDailyReport({ ...src, today: DAY });
    assert.equal(JSON.stringify([src.batch, src.mortality, src.feed, src.eggs]), snapshot);
  });
});

describe('P0 · who may open and print the daily report', () => {
  it('the route is gated by the same roles as the reports centre', async () => {
    const { REPORT_ROLES } = await import('@/lib/permissions');
    assert.deepEqual([...REPORT_ROLES].sort(), ['FINANCIAL_SUPERVISOR', 'MASTER_ADMIN', 'OWNER']);
    assert.ok(!REPORT_ROLES.includes('FARM_SUPERVISOR'), 'a Farm Supervisor sees no reports (§ reports rule)');
    assert.ok(!REPORT_ROLES.includes('FARM_LABOR'), 'labor has its own today log, not the printed sheet');
    assert.ok(!REPORT_ROLES.includes('FARM_MANAGER'));
  });
});
