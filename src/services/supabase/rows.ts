/**
 * rows.ts — the same two translations db/import-localstorage.mjs performs against
 * information_schema, done in the browser against columns.gen.ts.
 *
 * The store speaks camelCase and the schema speaks snake_case, and PostgREST hands numbers
 * back as strings and clocks as HH:mm:ss. These four functions are the only place any of
 * that is allowed to leak.
 */
import { COLUMNS } from './columns.gen';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = new Set(['numeric', 'integer', 'bigint', 'smallint', 'real', 'double precision']);

/** A key the `profiles`/`auth.users` uuid columns will accept — and the mark of a record that
 *  can hold a synced reference at all. Legacy cache rows key on `u_*` and stop at the browser. */
export const isUuid = (v: unknown): boolean => UUID_RE.test(String(v));

export const snake = (k: string): string => k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
export const camel = (k: string): string => k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

type Json = Record<string, unknown>;

function castWrite(type: string, v: unknown): unknown {
  if (v === null) return null;
  if (type === 'uuid') return UUID_RE.test(String(v)) ? String(v) : null;
  if (NUMERIC.has(type)) {
    if (v === '' || typeof v === 'boolean' || typeof v === 'object') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return typeof v === 'boolean' ? v : null;
  if (type === 'jsonb') return typeof v === 'object' ? v : null;
  if (type === 'date' || type.startsWith('timestamp') || type.startsWith('time')) {
    return v === '' ? null : String(v);
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * A client object to a database row. Keys with no column are dropped — exactly what the
 * import reported as "kept in the dump, not in the row" — and `renames` carries the few
 * names the two sides settled on differently (the batch's t/day intake, the cash handler).
 */
export function toRow(table: string, obj: Json, renames: Record<string, string> = {}): Json {
  const cols = COLUMNS[table];
  const out: Json = {};
  if (!cols) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const col = renames[k] ?? snake(k);
    const type = cols[col];
    if (!type) continue;
    out[col] = castWrite(type, v);
  }
  return out;
}

function castRead(type: string | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (type && NUMERIC.has(type)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  if (type && type.startsWith('time without')) return typeof v === 'string' ? v.slice(0, 5) : v;
  return v;
}

/** A database row back to the client shape, with `inverse` naming the reads renames undo. */
export function fromRow(table: string, row: Json, inverse: Record<string, string> = {}): Json {
  const cols = COLUMNS[table];
  const out: Json = {};
  for (const [col, v] of Object.entries(row)) {
    if (cols && !(col in cols)) continue;
    out[inverse[col] ?? camel(col)] = castRead(cols?.[col], v);
  }
  return out;
}

/** Key-sorted JSON, so two logically equal rows hash to the same string whatever order
 *  the store happened to keep its object keys in. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Json;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
