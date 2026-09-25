/**
 * push.ts — turns store changes back into database writes.
 *
 * It never uploads the world: the engine remembers the exact row-set it last sent, and only
 * what differs from that goes over the wire. The snapshot is keyed by the mapped database
 * row (children included, keys sorted), so a `synced` flag flipping in localStorage cannot
 * by itself wake the network.
 *
 * Deletes are the store's own semantics, mirrored: a row the app removed leaves the table
 * (FK cascades take its children), and where RLS refuses the delete the caller sees the
 * database's own sentence, not a silence.
 */
import { supabase } from '@/lib/supabase';
import { toRow, stable } from './rows';
import { SLICES, rowId, type SliceDef } from './registry';
import { PRIMARY_KEYS } from './columns.gen';

interface RowPlan {
  /** canonical JSON of parent + children — the memory of what was sent */
  canon: string;
  parent: Record<string, unknown>;
  children: { table: string; fk: string; rows: Record<string, unknown>[] }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one exception to the opsDenied() skip: asking the platform for help is not a company
 *  operation, so a Master Admin's own message still goes out — never a company's books. */
const PLATFORM_SLICES = new Set(['supportMessages']);

function planOf(def: SliceDef, obj: any): RowPlan | null {
  if (def.skip?.(obj)) return null;
  const src = def.prepare ? def.prepare(obj) : obj;
  const parent = toRow(def.table, src, def.renames);
  const children = (def.children ?? []).map(c => ({
    table: c.table,
    fk: c.fk,
    rows: c.single
      ? (obj[c.field] ? [c.toDb!(rowId(obj), obj[c.field], 0)] : [])
      : ((obj[c.field] ?? []) as any[]).map((item, i) => c.toDb!(rowId(obj), item, i)),
  }));
  return { canon: stable([parent, children.map(c => c.rows)]), parent, children };
}

export class PushEngine {
  private sent = new Map<string, Map<string, string>>();
  private busy = false;
  /** table → the database's own sentence for the last pass that refused it. */
  private errors = new Map<string, string>();

  /** Remember the database's own rows after a pull so the first push only carries what the
   *  browser changed since — including nothing at all on a clean machine. */
  prime(pulled: Record<string, any[]>): void {
    this.sent.clear();
    for (const def of SLICES) {
      const m = new Map<string, string>();
      for (const o of pulled[def.slice] ?? []) {
        const p = planOf(def, o);
        if (p) m.set(rowId(o), p.canon);
      }
      this.sent.set(def.slice, m);
    }
    const users = new Map<string, string>();
    for (const u of pulled.users ?? []) users.set(rowId(u), this.usersCanon(u));
    this.sent.set('users', users);
    this.sent.set('ingredientCatalog', new Map(
      (pulled.ingredientCatalog ?? []).map((n: string) => [n, n])));
  }

  /** Rows the database just handed over are, by definition, rows it already has. A live pull
   *  (realtime reconcile) must fold them into the snapshot the same way prime() does at
   *  hydrate, or the next diff offers them straight back: an upsert that, for a row the
   *  session may read but not update, is refused — a queue that can never drain. The pulled
   *  shape is the one remembered, because a null column and an absent one read the same to
   *  the database but hash differently in the canon. */
  absorb(rows: Record<string, any[]>): void {
    for (const [slice, list] of Object.entries(rows)) {
      if (slice === 'ingredientCatalog') {
        const m = this.sent.get('ingredientCatalog') ?? new Map<string, string>();
        for (const n of list ?? []) m.set(String(n), String(n));
        this.sent.set('ingredientCatalog', m);
        continue;
      }
      if (slice === 'users') {
        const m = this.sent.get('users') ?? new Map<string, string>();
        for (const u of list ?? []) m.set(rowId(u), this.usersCanon(u));
        this.sent.set('users', m);
        continue;
      }
      const def = SLICES.find(s => s.slice === slice);
      if (!def) continue;
      const m = this.sent.get(slice) ?? new Map<string, string>();
      for (const o of list ?? []) {
        const p = planOf(def, o);
        if (p) m.set(rowId(o), p.canon);
      }
      this.sent.set(slice, m);
    }
  }

  private usersCanon(u: any): string {
    return stable([
      toRow('profiles', u),
      (u.companyIds ?? [])
        .filter((c: string) => !(u.role === 'MASTER_ADMIN' && c === '*'))
        .map((c: string) => ({ user_id: u.id, company_id: c, role: u.role }))
        .sort((a: any, b: any) => a.company_id.localeCompare(b.company_id)),
    ]);
  }

  /**
   * Which rows this session may offer the database at all. The cache is per-browser, not
   * per-login, so it can still hold another company's rows from a different account that
   * used this device. RLS will never accept those from this user and the pull can never
   * confirm them, so they must not be counted as owed either — they wait in the cache
   * until someone of their own company signs in here. Membership is the mirror of the
   * boundary; RLS stays the boundary.
   *
   * Two rows a session may read but never write are excluded the same way. A support
   * message belongs to its sender, not to a company: INSERT accepts only `user_id =
   * auth.uid()` (or an anonymous row), so a teammate's message stays the teammate's even
   * where the select policy lets a company manager read it. And a company-scoped row with
   * no company belongs to no member at all — every policy behind it is member_of(...),
   * which refuses a null company for everybody.
   */
  private scope(state: Record<string, any>): (def: SliceDef, o: any) => boolean {
    const me = (state.users ?? []).find((u: any) => u.id === state.session?.userId);
    const uid = String(state.session?.userId ?? '');
    const ids = new Set<string>((me?.companyIds ?? []).map(String));
    if (state.session?.companyId) ids.add(String(state.session.companyId));
    const wildcard = me?.role === 'MASTER_ADMIN' || ids.has('*');
    return (def, o) => {
      if (def.slice === 'supportMessages') {
        const sender = o.userId ?? o.user_id;
        return sender != null && String(sender) !== uid;
      }
      if (wildcard) return false;
      const c = def.companyOf ? def.companyOf(o) : o.companyId;
      return c == null || !ids.has(String(c));
    };
  }

  /**
   * A Platform Admin (MASTER_ADMIN) belongs to no company, so RLS reads its whole cache but
   * refuses every operational write — "new row violates row-level security". Those rows are
   * not the admin's to send, and their absence must never read as a delete. So the engine
   * skips the company-scoped slices for this session entirely; platform-level work (users,
   * the ingredient catalogue) is the admin's own job and still goes out.
   */
  private opsDenied(state: Record<string, any>): boolean {
    const me = (state.users ?? []).find((u: any) => u.id === state.session?.userId);
    if (me?.role === 'MASTER_ADMIN') return true;
    return ((me?.companyIds ?? []) as unknown[]).map(String).includes('*');
  }

  /**
   * PostgREST turns an array body into ONE statement over the union of every object's keys:
   * if any row omits a key another row carries — a godown flag on one finance row, say —
   * the whole batch fails ("All object keys must match") or a defaulted NOT NULL column
   * null-fills. So a batch only goes out with rows whose keys match exactly, one statement
   * per shape. A single plain row used to take every other finance row in the batch down.
   */
  private async write(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) return;
    const pk = PRIMARY_KEYS[table]!;
    const buckets = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const sig = Object.keys(r).sort().join(',');
      const list = buckets.get(sig);
      if (list) list.push(r); else buckets.set(sig, [r]);
    }
    for (const bucket of buckets.values()) {
      const { error } = await supabase!
        .from(table)
        .upsert(bucket, { onConflict: pk.join(',') });
      if (error) {
        const why = `${table}${bucket.length > 1 ? ` (${bucket.length} rows, from id ${bucket[0].id ?? bucket[0][pk[0]]})` : ''}: ${error.message}`;
        this.errors.set(table, why);
        throw new Error(why);
      }
      this.errors.delete(table);
    }
  }

  private async remove(table: string, column: string, value: string): Promise<void> {
    const { error } = await supabase!
      .from(table)
      .delete()
      .eq(column, value);
    if (error) {
      const why = `${table}: ${error.message}`;
      this.errors.set(table, why);
      throw new Error(why);
    }
    this.errors.delete(table);
  }

  /** Rows the database is owed on the next pass — new, changed, or deleted since the last
   *  send — plus the database's own sentence for each table that refused them. This is the
   *  real queue: it drains only when a write actually lands. */
  pending(state: Record<string, any>): { count: number; errors: string[] } {
    let count = 0;
    const foreign = this.scope(state);
    const skipOps = this.opsDenied(state);
    for (const def of SLICES) {
      if (skipOps && !PLATFORM_SLICES.has(def.slice)) continue;
      const last = this.sent.get(def.slice) ?? new Map<string, string>();
      const rows = (state[def.slice] ?? []) as any[];
      const storeIds = new Set(rows.map(rowId));
      const now = new Map<string, string>();
      for (const o of rows) {
        if (foreign(def, o)) continue;
        const plan = planOf(def, o);
        if (plan) now.set(rowId(o), plan.canon);
      }
      for (const [id, canon] of now) if (last.get(id) !== canon) count++;
      // a primed row this session may read but not write (a teammate's support message)
      // is still in the store and is not a local delete
      for (const id of last.keys()) if (!now.has(id) && !storeIds.has(id)) count++;
    }
    return { count, errors: [...this.errors.values()] };
  }

  /** One diff pass over every synced slice. `failures` is a line per table that refused;
   *  `written` names the slices whose rows are now proven to be in the database. */
  async push(state: Record<string, any>): Promise<{ failures: string[]; written: string[] }> {
    if (this.busy) return { failures: [], written: [] };
    this.busy = true;
    const failures: string[] = [];
    const written: string[] = [];
    const foreign = this.scope(state);
    const skipOps = this.opsDenied(state);
    try {
      // children first, parents last on delete; parents before children is impossible in one
      // upsert pass, so each slice finishes its parent before moving on. The ops skip leaves
      // the platform slices alone: they are the admin's own work, not a company's.
      for (const def of SLICES) {
        if (skipOps && !PLATFORM_SLICES.has(def.slice)) continue;
        const f = await this.pushSlice(def, state, foreign);
        failures.push(...f);
        if (!f.length) written.push(def.slice);
      }
      // people are platform work too: profiles and memberships are written for the platform
      // admin alone, so a company session holding cached people offers none of them
      if (skipOps) failures.push(...await this.pushUsers(state.users ?? []));
      failures.push(...await this.pushCatalog(state.ingredientCatalog ?? []));
    } finally {
      this.busy = false;
    }
    return { failures, written };
  }

  /** A whole slice vanishing at once is not the user deleting every row — no screen can ask
   *  that of them. It is the store mid-hydration, or a state the session never owned: refuse
   *  the delete list, keep the rows in the queue, and say so. (A sign-in that raced its own
   *  second hydrate once read every primed row as gone, and one pass emptied a company's
   *  feed, vaccination and money rows out of the database.) */
  private refuseWipe(table: string, gone: number, nowSize: number, lastSize: number): string | null {
    return gone && !nowSize && lastSize
      ? `${table}: refused to delete ${gone} rows — the store offered this slice with nothing in it`
      : null;
  }

  private async pushSlice(def: SliceDef, state: Record<string, any>,
    foreign: (def: SliceDef, o: any) => boolean): Promise<string[]> {
    const failures: string[] = [];
    const last = this.sent.get(def.slice) ?? new Map<string, string>();
    const store = (state[def.slice] ?? []) as any[];
    const storeIds = new Set(store.map(rowId));
    const now = new Map<string, string>();
    const rows: Record<string, unknown>[] = [];
    const pending: RowPlan[] = [];
    for (const o of store) {
      if (foreign(def, o)) continue;
      const plan = planOf(def, o);
      if (!plan) continue;
      now.set(rowId(o), plan.canon);
      if (last.get(rowId(o)) !== plan.canon) {
        pending.push(plan);
        rows.push(plan.parent);
      }
    }
    // a primed row that is foreign but still in the store is not a local delete
    const gone = [...last.keys()].filter(id => !now.has(id) && !storeIds.has(id));
    const wipe = this.refuseWipe(def.table, gone.length, now.size, last.size);
    if (wipe) return [wipe];
    if (!rows.length && !gone.length) {
      // nothing owed: whatever this table was refused for, that refusal is no longer the truth
      this.errors.delete(def.table);
      this.sent.set(def.slice, now);
      return [];
    }
    try {
      await this.write(def.table, rows);
      for (const plan of pending) {
        for (const c of plan.children) {
          await this.remove(c.table, c.fk, String(plan.parent.id));
          await this.write(c.table, c.rows);
        }
      }
      for (const id of gone) await this.remove(def.table, 'id', id);
      this.sent.set(def.slice, now);
    } catch (e) {
      failures.push((e as Error).message);
    }
    return failures;
  }

  private async pushUsers(users: any[]): Promise<string[]> {
    const failures: string[] = [];
    const last = this.sent.get('users') ?? new Map<string, string>();
    const now = new Map<string, string>();
    const changed: any[] = [];
    try {
      for (const u of users) {
        if (!UUID_RE.test(String(u.id))) continue; // legacy cache rows are the old world's
        const canon = this.usersCanon(u);
        now.set(rowId(u), canon);
        if (last.get(rowId(u)) !== canon) changed.push(u);
      }
      const gone = [...last.keys()].filter(i => !now.has(i));
      const wipe = this.refuseWipe('profiles', gone.length, now.size, last.size);
      if (wipe) return [wipe];
      if (!changed.length && !gone.length) {
        this.errors.delete('profiles');
        this.errors.delete('company_users');
        this.sent.set('users', now);
        return [];
      }
      await this.write('profiles', changed.map(u => toRow('profiles', u)));
      for (const u of changed) {
        await this.remove('company_users', 'user_id', String(u.id));
        const rows = (u.companyIds ?? [])
          .filter((c: string) => !(u.role === 'MASTER_ADMIN' && c === '*'))
          .map((c: string) => toRow('company_users', { userId: u.id, companyId: c, role: u.role }));
        await this.write('company_users', rows);
      }
      for (const id of gone) {
        await this.remove('company_users', 'user_id', id);
        await this.remove('profiles', 'id', id);
      }
      this.sent.set('users', now);
    } catch (e) {
      failures.push((e as Error).message);
    }
    return failures;
  }

  private async pushCatalog(names: string[]): Promise<string[]> {
    const failures: string[] = [];
    const last = this.sent.get('ingredientCatalog') ?? new Map<string, string>();
    const clean = [...new Set(names.filter(n => typeof n === 'string' && n.trim()))].map(String);
    const now = new Map(clean.map(n => [n, n]));
    const gone = [...last.keys()].filter(k => !now.has(k));
    const wipe = this.refuseWipe('ingredients', gone.length, now.size, last.size);
    if (wipe) return [wipe];
    if (!gone.length && clean.every(n => last.has(n))) {
      this.errors.delete('ingredients');
      this.sent.set('ingredientCatalog', now);
      return [];
    }
    try {
      await this.write('ingredients', clean.filter(n => !last.has(n)).map(n => ({ name: n })));
      for (const n of gone) {
        const { error } = await supabase!.from('ingredients').delete().eq('name', n);
        if (error) throw new Error(`ingredients: ${error.message}`);
      }
      this.sent.set('ingredientCatalog', now);
    } catch (e) {
      failures.push((e as Error).message);
    }
    return failures;
  }
}
