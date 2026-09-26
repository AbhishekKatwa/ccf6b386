/**
 * lib/dailyReport.ts — the day-wise sheet a batch is printed from.
 *
 * The arithmetic lives here rather than in the screen because every column of this report is
 * a number someone signs off on: birds alive, birds lost, feed given, eggs collected. A figure
 * that can only be read by rendering a table cannot be proved, so the calculation is a pure
 * function of the batch and the three ledgers that describe it, and the screen only draws it.
 *
 * Two rules the function holds to, both of which a screen-level filter once broke:
 *   - The window is counted from the app's own farm day, in local dates. A UTC cut of
 *     `new Date()` loses a day before 05:30 IST, which is exactly when the morning shift reads
 *     this sheet.
 *   - Every row is scoped by `batchId`, never by shed. A shed holds one flock after another,
 *     and a report that asked "what did this shed lay" would hand a batch the eggs of the flock
 *     that replaces it.
 */
import type { Batch, EggCollection, FeedConsumption, MortalityEntry } from '@/types';
import { EGGS_PER_TRAY } from '@/types';
import { batchAgeDays, cumulativeMortality, eggGradeTotals, gradeTotal, liveBirdsOn } from '@/lib/calc';
import { shiftDate, todayISO } from '@/lib/format';
import type { EggGradeCounts } from '@/types';

/** How many days the sheet prints — the last month of the flock, ending today. */
export const DAILY_REPORT_DAYS = 30;

export interface DailyReportRow {
  date: string;
  /** Flock day, counted from placement and floored at zero for days before it. */
  day: number;
  live: number;
  mort: number;
  /** A day's deaths as a share of the birds the batch started with. */
  mortPct: number;
  cumMort: number;
  cumMortPct: number;
  feedKg: number;
  /** Feed since the first day of this window, not since placement — the sheet is a month long. */
  cumFeedKg: number;
  feedPerBirdG: number;
  trays: number;
  eggs: number;
  byGrade: EggGradeCounts;
}

export interface DailyReportSource {
  batch: Batch;
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  eggs: EggCollection[];
  /** The farm day the window ends on; the screen passes nothing and gets today. */
  today?: string;
}

export function buildDailyReport({
  batch, mortality, feed, eggs, today = todayISO(),
}: DailyReportSource): DailyReportRow[] {
  const out: DailyReportRow[] = [];
  let cumFeedKg = 0;

  for (let i = DAILY_REPORT_DAYS - 1; i >= 0; i--) {
    const date = shiftDate(today, -i);
    const live = liveBirdsOn(batch, date, mortality);
    const mort = mortality.filter(m => m.batchId === batch.id && m.date === date)
      .reduce((s, m) => s + m.count, 0);
    const cumMort = cumulativeMortality(batch.id, mortality, date);
    const feedKg = Math.round(feed.filter(f => f.batchId === batch.id && f.date === date)
      .reduce((s, f) => s + f.tonnes, 0) * 1000);
    cumFeedKg += feedKg;

    const byGrade = eggGradeTotals(eggs.filter(e => e.batchId === batch.id && e.date === date));
    const trays = gradeTotal(byGrade);
    const started = batch.initialBirds;

    out.push({
      date,
      day: batchAgeDays(batch, date),
      live,
      mort,
      mortPct: started > 0 ? (mort / started) * 100 : 0,
      cumMort,
      cumMortPct: started > 0 ? (cumMort / started) * 100 : 0,
      feedKg,
      cumFeedKg,
      feedPerBirdG: live > 0 ? Math.round((feedKg * 1000) / live) : 0,
      trays,
      eggs: trays * EGGS_PER_TRAY,
      byGrade,
    });
  }

  return out;
}

/** The four totals the foot of the sheet and the Print summary quote. */
export function dailyReportTotals(rows: DailyReportRow[]) {
  const last = rows[rows.length - 1];
  return {
    feedKg: last?.cumFeedKg ?? 0,
    feedTonnes: (last?.cumFeedKg ?? 0) / 1000,
    mortality: last?.cumMort ?? 0,
    eggs: rows.reduce((s, r) => s + r.eggs, 0),
    trays: rows.reduce((s, r) => s + r.trays, 0),
  };
}
