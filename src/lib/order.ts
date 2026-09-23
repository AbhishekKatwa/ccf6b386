/**
 * Ledger ordering — the one rule every statement screen shares: newest day first,
 * then the newest booking, then the id, so a fresh row always leads and the order
 * never depends on insertion luck.
 */
export type Dated = { date: string; createdAt?: string; id: string };

export function compareLatestFirst(a: Dated, b: Dated): number {
  return b.date.localeCompare(a.date)
    || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    || b.id.localeCompare(a.id);
}

export function latestFirst<T extends Dated>(rows: T[]): T[] {
  return [...rows].sort(compareLatestFirst);
}

/** The same rows read in booking order — for a running-balance replay. */
export function chronological<T extends Dated>(rows: T[]): T[] {
  return [...rows].sort((a, b) => -compareLatestFirst(a, b));
}
