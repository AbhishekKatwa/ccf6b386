/**
 * pull.ts — one pass that turns the database into store slices, exactly the shape
 * useCompanyData() already knows how to filter. RLS decides which rows answer; nothing here
 * filters by company a second time, so what a person sees is what their policies allow —
 * never what the client chose to ask for.
 */
import { supabase } from '@/lib/supabase';
import { fromRow } from './rows';
import { SLICES, type SliceDef } from './registry';

const MAX_ROWS = 50_000;

async function selectAll(table: string, orderBy?: string) {
  const { data, error } = await supabase!
    .from(table)
    .select('*')
    .limit(MAX_ROWS);
  if (error) throw new Error(`${table}: ${error.message}`);
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
 * Every slice is fetched on its own account: one table refusing must not cost the hydrate
 * the rows of all the others. `failed` carries the database's sentence per table — an
 * empty slice that came back denied says so here, it is never silently primeable as zero.
 */
export async function pullAll(): Promise<{ rows: PulledState; failed: string[] }> {
  const rows: PulledState = {};
  const failed: string[] = [];
  const one = async (label: string, go: () => Promise<unknown[]>): Promise<void> => {
    try { rows[label] = await go(); } catch (e) { failed.push(`${label}: ${(e as Error).message}`); }
  };
  for (const def of SLICES) await one(def.slice, () => pullSlice(def));
  await one('users', pullUsers);
  await one('ingredientCatalog', pullCatalog);
  return { rows, failed };
}
