/**
 * pull.ts — one pass that turns the database into store slices, exactly the shape
 * useCompanyData() already knows how to filter. RLS decides which rows answer; nothing here
 * filters by company a second time, so what a person sees is what their policies allow —
 * never what the client chose to ask for.
 */
import { supabase } from '@/lib/supabase';
import {
  DatabaseError, logDatabaseError, normalizeDatabaseError, technicalLineOf,
} from '@/lib/dbErrors';
import { fromRow } from './rows';
import { SLICES, type SliceDef } from './registry';

const MAX_ROWS = 50_000;

async function selectAll(table: string, orderBy?: string) {
  const { data, error } = await supabase!
    .from(table)
    .select('*')
    .limit(MAX_ROWS);
  if (error) {
    // Read once, here, where the table is known: everything downstream carries the sentence
    // the person can read, and the database's own words go to the log.
    const n = normalizeDatabaseError(error, { table, origin: 'background' });
    logDatabaseError({ ...n, technicalMessage: technicalLineOf(n) }, error);
    throw new DatabaseError(n, error);
  }
  const rows = data ?? [];
  if (orderBy) {
    // children ride along grouped, but stable order makes the re-state reproducible
    rows.sort((a: any, b: any) => String(a[orderBy]).localeCompare(String(b[orderBy])));
  }
  return rows as Record<string, unknown>[];
}

function kidsByParent(childRows: Record<string, unknown>[], fk: string) {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const r of childRows) {
    const k = String(r[fk]);
    const list = map.get(k);
    if (list) list.push(r); else map.set(k, [r]);
  }
  return map;
}

export async function pullSlice(def: SliceDef): Promise<Record<string, unknown>[]> {
  const rows = await selectAll(def.table);
  const groups = new Map<string, Map<string, Record<string, unknown>[]>>();
  for (const c of def.children ?? []) {
    groups.set(c.table, kidsByParent(await selectAll(c.table), c.fk));
  }
  return rows.map(row => {
    const mine: Record<string, unknown[]> = {};
    for (const c of def.children ?? []) {
      const list = (groups.get(c.table)!.get(String(row.id)) ?? [])
        .map(r => (c.fromDb ? c.fromDb(r) : r));
      mine[c.table] = list;
    }
    const base = fromRow(def.table, row, def.inverse);
    return def.finish ? def.finish(base, mine) : base;
  });
}

/** profiles + company_users → the store's `users` slice, uuid ids and all. */
export async function pullUsers(): Promise<Record<string, unknown>[]> {
  const profiles = await selectAll('profiles');
  const memberships = await selectAll('company_users');
  const byUser = kidsByParent(memberships, 'user_id');
  return profiles.map(p => {
    const mine = byUser.get(String(p.id)) ?? [];
    const role = (p.role as string) ?? mine[0]?.role ?? '';
    return {
      ...fromRow('profiles', p),
      id: p.id,
      passwordHash: '',
      role,
      companyIds: mine.map(m => m.company_id as string),
    };
  });
}

/** the global ingredient catalogue, which is a list of names on both sides. */
export async function pullCatalog(): Promise<string[]> {
  const rows = await selectAll('ingredients');
  return rows.map(r => String(r.name));
}

export type PulledState = Record<string, unknown[]>;

/**
 * Each table answers on its own account, but they are asked together. Serial was measured at
 * 3.85s for one company's 27 slices on a warm connection — the price of every round trip added
 * up, on the one path a phone takes every time it comes back to the app. Run together, the
 * hydrate costs the slowest table rather than the sum. A ceiling of six keeps a capped mobile
 * link from queueing thirty requests behind itself, and results still land in slice order, so a
 * table that refused says so in the same place in `failed` it always did.
 */
const WIDTH = 6;

async function pooled(tasks: (() => Promise<unknown[]>)[]): Promise<(unknown[] | { error: unknown })[]> {
  const out = new Array<unknown[] | { error: unknown }>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      try { out[i] = await tasks[i](); }
      catch (error) { out[i] = { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WIDTH, tasks.length) }, worker));
  return out;
}

/**
 * Every slice is fetched on its own account: one table refusing must not cost the hydrate
 * the rows of all the others. `failed` carries a readable sentence per table — an empty slice
 * that came back denied says so here, it is never silently primeable as zero.
 */
export async function pullAll(): Promise<{ rows: PulledState; failed: string[] }> {
  const asked: [string, () => Promise<unknown[]>][] = [
    ...SLICES.map((def): [string, () => Promise<unknown[]>] => [def.slice, () => pullSlice(def)]),
    ['users', pullUsers],
    ['ingredientCatalog', pullCatalog],
  ];
  const settled = await pooled(asked.map(([, go]) => go));
  const rows: PulledState = {};
  const failed: string[] = [];
  settled.forEach((result, i) => {
    if (Array.isArray(result)) rows[asked[i][0]] = result;
    else failed.push(normalizeDatabaseError(result.error).userMessage);
  });
  return { rows, failed };
}
