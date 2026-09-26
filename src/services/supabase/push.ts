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
import { roleReadable } from '@/lib/permissions';
import {
  DatabaseError, logDatabaseError, normalizeDatabaseError, tableLabel, technicalLineOf,
} from '@/lib/dbErrors';
import type { Role } from '@/types';
import { toRow, stable, isUuid } from './rows';
import { SLICES, rowId, type SliceDef } from './registry';
import { PRIMARY_KEYS } from './columns.gen';

interface RowPlan {
  /** canonical JSON of parent + children — the memory of what was sent */
  canon: string;
  parent: Record<string, unknown>;
  children: { table: string; fk: string; rows: Record<string, unknown>[] }[];
}

/** The exceptions to the opsDenied() skip: asking the platform for help is not a company
 *  operation, so a Master Admin's own message still goes out — never a company's books. And a
 *  company row is the platform's own record: only MASTER_ADMIN may write `companies` (003), so
 *  the lifecycle it carries — active or retired — is exactly the thing that skip must not eat. */
const PLATFORM_SLICES = new Set(['supportMessages', 'companies']);

/** The person a row names, for the one table whose pointer to `profiles` is NOT NULL. Every
 *  other reference is nullable, so losing a login blanks the name rather than refusing the
 *  row; an assignment has no such escape. */
const PERSON_REF: Record<string, (o: any) => unknown> = {
  assignments: o => o.userId,
};

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
  /** table → the sentence this session can read for the last pass that refused it. The
   *  database's own wording stays in the developer log (`dbErrors`), never on the badge. */
  private errors = new Map<string, string>();

  /** Remember the database's own rows after a pull so the first push only carries what the
   *  browser changed since — including nothing at all on a clean machine. A slice the pull
   *  never answered for keeps the memory it had rather than being primed as empty: an absent
   *  slice is a table this pass did not read, not a table the database has nothing in, and
   *  forgetting it would hand the next pass the whole cached slice to re-send over a
   *  teammate's newer row. */
  prime(pulled: Record<string, any[]>): void {
    this.sent.clear();
    for (const def of SLICES) {
      if (!(def.slice in pulled)) continue;
      const m = new Map<string, string>();
      for (const o of pulled[def.slice]) {
        const p = planOf(def, o);
        if (p) m.set(rowId(o), p.canon);
      }
      this.sent.set(def.slice, m);
    }
    if ('users' in pulled) {
      const users = new Map<string, string>();
      for (const u of pulled.users) users.set(rowId(u), this.usersCanon(u));
      this.sent.set('users', users);
    }
    if ('ingredientCatalog' in pulled) {
      this.sent.set('ingredientCatalog', new Map(
        pulled.ingredientCatalog.map((n: string) => [n, n])));
    }
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
        // pullUsers answers with every person this session may see, so a complete read
        // rewrites that memory instead of adding to it: a login deleted elsewhere has to stop
        // counting as one the database has.
        this.sent.set('users', new Map(
          (list ?? []).map((u: any) => [rowId(u), this.usersCanon(u)])));
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

  /** Rows this browser still owes the database: present in the last confirmed send and changed
   *  since. Asked for BEFORE a pull rewrites that memory — after it, "different from the
   *  database" would also describe a teammate's newer row, and protecting that would push a
   *  stale copy straight over theirs. A row the database has never been told about is not here:
   *  the merge already keeps those. */
  owed(pulled: Record<string, any[]>, state: Record<string, any>): Record<string, Set<string>> {
    const out: Record<string, Set<string>> = {};
    for (const key of Object.keys(pulled)) {
      if (key === 'ingredientCatalog') continue; // merged as a union; no row of it can be clobbered
      const before = this.sent.get(key);
      if (!before || !before.size) continue;
      const def = SLICES.find(s => s.slice === key);
      if (!def && key !== 'users') continue;
      const canon = key === 'users'
        ? (o: any) => this.usersCanon(o)
        : (o: any) => planOf(def!, o)?.canon;
      const ids = new Set<string>();
      for (const o of ((state[key] as any[]) ?? [])) {
        const id = String(rowId(o));
        const was = before.get(id);
        if (was === undefined) continue;
        const now = canon(o);
        if (now && now !== was) ids.add(id);
      }
      if (ids.size) out[key] = ids;
    }
    return out;
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
   *
   * A company that has been deactivated is foreign for the same reason: `app.member_of()`
   * and `app.role_in()` now refuse it on every table (013), so its cached rows must neither
   * go out nor sit in the queue as owed — and, above all, must not read as rows to delete
   * when the company stands again.
   */
  private scope(state: Record<string, any>): (def: SliceDef, o: any) => boolean {
    const me = (state.users ?? []).find((u: any) => u.id === state.session?.userId);
    const uid = String(state.session?.userId ?? '');
    const ids = new Set<string>((me?.companyIds ?? []).map(String));
    if (state.session?.companyId) ids.add(String(state.session.companyId));
    const wildcard = me?.role === 'MASTER_ADMIN' || ids.has('*');
    const dead = new Set<string>((state.companies ?? [])
      .filter((c: any) => c?.active === false)
      .map((c: any) => String(c.id)));
    return (def, o) => {
      if (def.slice === 'supportMessages') {
        const sender = o.userId ?? o.user_id;
        return sender != null && String(sender) !== uid;
      }
      const c = def.companyOf ? def.companyOf(o) : o.companyId;
      if (c != null && dead.has(String(c))) return true;
      if (wildcard) return false;
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
   * Whether this session's role may read a table at all — the registry's mirror of 003's own
   * SELECT verb, which is narrower than membership for the money, formula, godown, flock-health
   * and audit tables.
   *
   * The engine's entire memory is the set of rows the database handed back, so a slice this
   * session cannot read can never be confirmed: every cached row of it reads as one the
   * database has never seen, on every pass, forever. A labour's device holding the company's
   * traders is the case that shows it — 140 rows queued, RLS refusing every one of them, and a
   * badge that cannot drain. Worse, the day the cache drops those rows the same blindness reads
   * them as local deletes to replay.
   *
   * So such a slice is left alone: not sent, not owed, and never a delete. It is the same
   * judgement `scope()` makes of another company's rows — what this session cannot see through
   * RLS is not its to speak for.
   */
  private readDenied(def: SliceDef, state: Record<string, any>): boolean {
    if (!def.readKey && !def.readRoles) return false;
    const me = (state.users ?? []).find((u: any) => u.id === state.session?.userId);
    return !roleReadable(me?.role as Role | undefined, def);
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
        const n = normalizeDatabaseError(error, { table, origin: 'background' });
        // The badge carries the sentence the user can read; the log keeps the database's own,
        // with the bucket size that made this statement fail.
        this.errors.set(table, n.userMessage);
        logDatabaseError({
          ...n,
          technicalMessage: technicalLineOf(n,
            bucket.length > 1 ? `(${bucket.length} rows, from id ${bucket[0].id ?? bucket[0][pk[0]]})` : ''),
        }, error);
        throw new DatabaseError(n, error);
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
      const n = normalizeDatabaseError(error, { table, origin: 'background' });
      this.errors.set(table, n.userMessage);
      logDatabaseError({ ...n, technicalMessage: technicalLineOf(n) }, error);
      throw new DatabaseError(n, error);
    }
    this.errors.delete(table);
  }

  /** A pass is on the wire. A pull that re-primes the snapshot mid-flight would be undone by
   *  the write that set it, so a caller that must choose between the two asks here. */
  isBusy(): boolean { return this.busy; }

  /** Rows the database is owed on the next pass — new, changed, or deleted since the last
   *  send — plus a readable reason for each table that refused them. This is the real
   *  queue: it drains only when a write actually lands. */
  pending(state: Record<string, any>): { count: number; errors: string[] } {
    let count = 0;
    const foreign = this.scope(state);
    const skipOps = this.opsDenied(state);
    for (const def of SLICES) {
      if (skipOps && !PLATFORM_SLICES.has(def.slice)) continue;
      if (this.readDenied(def, state)) continue;
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

  /** One diff pass over every synced slice. `failures` is one readable line per table that
   *  refused; `written` names the slices whose rows are now proven to be in the database. */
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
        if (this.readDenied(def, state)) continue;
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
      ? `Refused to delete ${gone} ${tableLabel(table)} — the app offered that list with nothing in it`
      : null;
  }

  /** Whose record the last complete read of the people tables carried: exactly the logins this
   *  account can point a row at. */
  private knownPerson(id: string): boolean {
    return this.sent.get('users')?.has(id) ?? false;
  }

  /** A login the database wrote itself (create_login): the person exists from this moment, so a
   *  row naming them must not wait on the realtime pull to notice. The canon is empty on
   *  purpose — the next complete read of the people tables overwrites it with the real one. */
  confirmPerson(id: string): void {
    this.sent.get('users')?.set(id, '');
  }

  private nameOf(state: Record<string, any>, id: string): string {
    return ((state.users ?? []) as any[]).find(u => String(u.id) === id)?.name ?? id;
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
    const held: any[] = [];
    for (const o of store) {
      if (foreign(def, o)) continue;
      const plan = planOf(def, o);
      if (!plan) continue;
      const person = PERSON_REF[def.slice]?.(o);
      if (person != null && !this.knownPerson(String(person))) {
        // The database has never answered for this person, so it would refuse the row — and one
        // refused row brings its whole bucket down with it. Held back, not forgotten: it stays
        // owed, and the day a login appears for them the next diff carries it out.
        held.push(o);
        continue;
      }
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
    // The held rows get their own error key: a refusal the database itself spoke stays the
    // sentence the badge carries, and this one is restated every pass rather than clobbering it.
    const holdKey = `${def.table}#people`;
    if (held.length) {
      const who = held.map(o => this.nameOf(state, String(PERSON_REF[def.slice]!(o)))).join(', ');
      const why = `${held.length} ${tableLabel(def.table)} wait for ${who} to have a login`;
      this.errors.set(holdKey, why);
      failures.push(why);
    } else this.errors.delete(holdKey);
    if (!rows.length && !gone.length) {
      // nothing owed: whatever this table was refused for, that refusal is no longer the truth
      if (!held.length) this.errors.delete(def.table);
      this.sent.set(def.slice, now);
      return failures;
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
      failures.push(normalizeDatabaseError(e, { table: def.table, origin: 'background' }).userMessage);
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
        if (!isUuid(u.id)) continue; // legacy cache rows are the old world's
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
      failures.push(normalizeDatabaseError(e, { table: 'profiles', origin: 'background' }).userMessage);
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
        if (error) {
          const normalized = normalizeDatabaseError(error, { table: 'ingredients', origin: 'background' });
          this.errors.set('ingredients', normalized.userMessage);
          logDatabaseError({ ...normalized, technicalMessage: technicalLineOf(normalized) }, error);
          throw new DatabaseError(normalized, error);
        }
      }
      this.sent.set('ingredientCatalog', now);
    } catch (e) {
      failures.push(normalizeDatabaseError(e, { table: 'ingredients', origin: 'background' }).userMessage);
    }
    return failures;
  }
}
