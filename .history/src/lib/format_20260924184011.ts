import { addDays, format, parseISO, differenceInDays, isValid } from 'date-fns';

export function fmtIN(n: number, decimals = 0): string {
  if (!isFinite(n)) return '0';
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return neg ? `-${s}` : s;
}

export function fmtMoney(n: number, decimals = 0): string {
  return `₹${fmtIN(n, decimals)}`;
}

export function fmtPct(n: number, decimals = 2): string {
  if (!isFinite(n)) return '0%';
  return `${n.toFixed(decimals)}%`;
}

export function fmtKg(n: number, decimals = 0): string {
  return `${fmtIN(n, decimals)} kg`;
}

export function fmtDate(iso: string): string {
  const d = safeDate(iso);
  return d ? format(d, 'dd-MMM-yyyy') : '—';
}

export function fmtDateShort(iso: string): string {
  const d = safeDate(iso);
  return d ? format(d, 'dd-MMM') : '—';
}

export function fmtDateTime(iso: string): string {
  const d = safeDate(iso);
  return d ? format(d, 'dd-MMM-yyyy HH:mm') : '—';
}

export function safeDate(iso: string): Date | null {
  if (!iso) return null;
  try {
    const d = iso.length === 10 ? parseISO(iso + 'T00:00:00') : parseISO(iso);
    return isValid(d) ? d : null;
  } catch { return null; }
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * A calendar day moved by a whole number of days — read and written as a date, never as a
 * UTC instant, which would put an Indian flock-day one day early.
 */
export function shiftDate(iso: string, days: number): string {
  const d = safeDate(iso);
  return d ? format(addDays(d, days), 'yyyy-MM-dd') : iso;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = safeDate(fromISO); const b = safeDate(toISO);
  if (!a || !b) return 0;
  return differenceInDays(b, a);
}

/**
 * A flock age in days with its completed weeks and remaining days beside it. Broilers are
 * bought and sold by day, vaccinations and lay onset are read by week, so a figure that
 * says only one of them always costs somebody a mental division. Below a week there is no
 * completed week to report, so the bracket stays out rather than reading "(0 wk 3 d)".
 */
export function ageDaysLabel(days: number): string {
  const d = Math.max(0, days);
  const w = Math.floor(d / 7);
  const rem = d % 7;
  if (w === 0) return `Day ${d}`;
  if (rem === 0) return `Day ${d} (${w} wk)`;
  return `Day ${d} (${w} wk ${rem} d)`;
}

export function ageLabel(placementISO: string, asOfISO = todayISO()) {
  const days = Math.max(0, daysBetween(placementISO, asOfISO));
  return { days, weeks: Math.floor(days / 7), dayOfWeek: days % 7, dayLabel: ageDaysLabel(days) };
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Good Night';
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  if (h < 21) return 'Good Evening';
  return 'Good Night';
}

/** 'HH:mm' → '7:15 AM'. Labor reads clocks, not 24-hour strings. */
export function fmtClock(hhmm: string): string {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return '—';
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Local 'HH:mm' of a full ISO timestamp. */
export function timeOf(iso: string): string {
  const d = safeDate(iso);
  return d ? format(d, 'HH:mm') : '';
}

/** Current local time as 'HH:mm', for prefilling a feed round. */
export function nowHHMM(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
