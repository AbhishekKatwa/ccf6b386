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
  return `Day ${Math.max(0, Math.floor(days))}`;
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

/**
 * A v4 UUID, for the ids the database accepts as a `uuid` column. `crypto.randomUUID` only
 * exists in a secure context, and a farm device usually opens the app over plain http on the
 * LAN, so the same randomness is drawn through `getRandomValues`, which has no such gate.
 */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

/** An id this app no longer issues — a seed-era `u_*`, or a uuid whose auth row is gone. */
const RETIRED_ID = /^(?:u_[a-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Read a "who" field back as a person. The field carries a user id when the app wrote it and
 * the name a worker typed when they did, so both are matched. An id that resolves to nobody
 * stays unattributed: an internal key must never reach the screen as if it were a name.
 */
export function personName(users: { id: string; name: string }[], value?: string | null): string {
  if (!value) return '—';
  return users.find(u => u.id === value || u.name === value)?.name
    ?? (RETIRED_ID.test(value) ? '—' : value);
}
