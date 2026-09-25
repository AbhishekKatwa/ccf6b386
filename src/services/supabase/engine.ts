/**
 * engine.ts — the seam between the store and Supabase once a person has signed in.
 *
 * The store stays what it always was: the browser's one source of truth that screens read
 * synchronously. What changes is where its contents come from (a pull that RLS has already
 * scoped) and where edits go (a debounced diff). localStorage keeps its persist exactly as
 * before — it is the cache and the offline copy now, not the database.
 *
 * With no Supabase configured nothing in this module ever runs; the app behaves byte-for-byte
 * the way it did the day before it existed.
 */
import { supabase } from '@/lib/supabase';
import { runtime } from '@/lib/runtime';
import { useApp, rebalanceTraders } from '@/store/app';
import { pullAll, pullCatalog, pullSlice, pullUsers, type PulledState } from './pull';
import { PushEngine } from './push';
import { SLICES, SYNCED_SLICES } from './registry';

export const emailFor = (mobile: string): string => `${mobile}@login.amrut.app`;

const engine = new PushEngine();
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
/** True only between a finished hydrate (prime included) and the next sign-out. No row
 *  leaves the browser before that: an unprimed engine would offer the whole cache as a diff. */
let syncedIn = false;

/** The last sync-failure sentence we surfaced. A realtime burst or a store edit re-runs the
 *  diff every second; the same refusal must say itself once, not stack a wall of toasts. The
 *  badge already carries the standing error, so a repeat of the identical line is silent. */
let lastSyncError = '';
function reportSyncFailures(lines: string[]): void {
  const msg = lines.length ? `Supabase: ${lines.join(' · ')}` : '';
  if (msg === lastSyncError) return;
  lastSyncError = msg;
  if (msg) useApp.getState().pushToast('error', msg);
}

/** A slice the database accepted. Rows that were only awaiting a write keep their sync flag. */
const SYNC_FLAGGED = [
  'mortality', 'feed', 'feedRounds', 'eggs', 'eggWastages', 'saleLogs', 'saleEntries',
  'eggSaleBookings', 'feedStock', 'medicineStock', 'finance', 'traderTxns', 'tasks',
  'vaccinations', 'cashHandovers', 'cashCounts', 'supportMessages',
];

function markWritten(written: string[]): void {
  const keys = SYNC_FLAGGED.filter(k => written.includes(k));
  if (!keys.length) return;
  const state = useApp.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    const rows = state[key] as any[];
    if (rows.some(r => !r.synced)) patch[key] = rows.map(r => (r.synced ? r : { ...r, synced: true }));
  }
  if (Object.keys(patch).length) useApp.setState(patch as never);
}

/** pulled rows win; rows only the browser has (made while away from the network) are kept
 *  and go out on the first diff. Nothing cached is silently discarded. */
function mergeSlice(key: string, pulled: any[], local: any[]): any[] {
  if (key === 'ingredientCatalog') {
    return [...new Set([...(pulled as string[]), ...(local as string[])])];
  }
  const ids = new Set(pulled.map(o => String(o?.id)));
  return [...pulled, ...(local ?? []).filter(o => o?.id && !ids.has(String(o.id)))];
}

/** Applies pulled rows over the store's current slice, keeping browser-only rows. */
function mergeReceived(pulled: PulledState): void {
  const state = useApp.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, rows] of Object.entries(pulled)) {
    patch[key] = mergeSlice(key, rows, (state[key] as any[]) ?? []);
  }
  useApp.setState(patch as never);
  // The database has no column for a trader's balance, so a pulled trader arrives with that
  // cache at zero. Read every balance back off its own ledger — the one canonical sum, kept
  // unstamped — or the home and sales screens show ₹0 while the traders screen shows the
  // real dues until some later trader edit happens to heal them.
  if ('traders' in patch || 'traderTxns' in patch) {
    const next = useApp.getState() as unknown as Record<string, unknown>;
    useApp.setState({
      traders: rebalanceTraders(next.traders as any, next.traderTxns as any, false),
    } as never);
  }
}

export async function hydrateFromDatabase(): Promise<void> {
  const { rows, failed } = await pullAll();
  // signed out while the pull was in flight: nobody is waiting on these rows, and priming
  // the engine with them would let a later store change speak for a session that is gone.
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session) return;
  // prime first: what the database just handed over is what it already has. Only then does
  // the merge bring in the browser's own rows, so the diff sees as owed exactly the set
  // the database has never been told about — never the whole cache.
  engine.prime(rows);
  mergeReceived(rows);
  syncedIn = true;
  reportSyncFailures(failed);
  publishStatus();
  void flush();
}

export function setStoreSession(userId: string): void {
  const state = useApp.getState();
  const user = state.users.find(u => u.id === userId);
  const previous = state.session;
  const stillMember = previous?.companyId && user?.companyIds.includes(previous.companyId);
  useApp.setState({
    session: {
      userId,
      companyId: stillMember ? previous!.companyId : (user?.companyIds[0] ?? null),
      signedInAt: new Date().toISOString(),
    },
  });
}

async function flush(): Promise<void> {
  if (!syncedIn) return;
  const state = useApp.getState() as unknown as Record<string, unknown>;
  const { failures, written } = await engine.push(state);
  reportSyncFailures(failures);
  markWritten(written);
  publishStatus();
}

/** Retry now — the badge's tap. Failed rows are still owed, so this re-offers them. */
export function retrySync(): void {
  void flush();
}

// ============================== queue status (the badge's truth) ==============================

export interface CloudSyncStatus { pending: number; errors: string[] }

let status: CloudSyncStatus = { pending: 0, errors: [] };
const statusListeners = new Set<() => void>();

function publishStatus(): void {
  const state = useApp.getState() as unknown as Record<string, unknown>;
  const next = syncedIn ? engine.pending(state) : { count: 0, errors: [] };
  const shaped = { pending: next.count, errors: next.errors };
  if (shaped.pending === status.pending && shaped.errors.join('|') === status.errors.join('|')) return;
  status = shaped;
  for (const fn of statusListeners) fn();
}

/** useSyncExternalStore source: what the engine still owes the database, and why not yet. */
export const cloudSyncStatus = {
  subscribe(fn: () => void): () => void {
    statusListeners.add(fn);
    publishStatus();
    return () => statusListeners.delete(fn);
  },
  get(): CloudSyncStatus { return status; },
};

function schedulePush(): void {
  publishStatus(); // the badge moves with the edit, not only with the wire
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flush(); }, 1000);
}

/** Signs the store back into its cached company once Supabase answers for this person.
 *  The sign-in path and the auth listener can both land here for the same person; one
 *  hydrate runs, the second caller shares its promise — two overlapping pull/prime/merge
 *  passes are how a store can be read mid-flight and owe the database a delete storm. */
let flight: { uid: string; p: Promise<void> } | null = null;
export function completeSignIn(userId: string): Promise<void> {
  if (flight?.uid === userId) return flight.p;
  const entry: { uid: string; p: Promise<void> } = { uid: userId, p: null as unknown as Promise<void> };
  entry.p = (async () => {
    try {
      // session first (§4): the pull, the prime and every later diff read this person's
      // company membership off the store — with no session stamped yet, the engine's scope
      // would call every cached row foreign and its first flush would owe the base a wipe.
      setStoreSession(userId);
      await hydrateFromDatabase();
    } finally {
      if (flight === entry) flight = null;
    }
  })();
  flight = entry;
  return entry.p;
}

export function startCloudSync(): void {
  if (!supabase || started) return;
  started = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      syncedIn = false;
      lastSyncError = ''; // the next session earns its own first error
      publishStatus();
      if (useApp.getState().session) useApp.setState({ session: null });
      return;
    }
    const uid = session?.user?.id;
    // the sign-in path completes itself; this one only catches a session restored at boot
    // or added elsewhere, when nobody is waiting on it.
    if (uid && event === 'SIGNED_IN' && useApp.getState().session?.userId !== uid) {
      void completeSignIn(uid).catch(reportBootFailure);
    }
  });

  useApp.subscribe((state, prev) => {
    if (!runtime.cloud) return;
    if (prev.session && !state.session) {
      syncedIn = false; // whoever signs back in gets their own prime before anything is owed
      void supabase!.auth.signOut();
    }
    if (!state.session || !syncedIn) return;
    for (const key of SYNCED_SLICES) {
      if ((state as any)[key] !== (prev as any)[key]) { schedulePush(); return; }
    }
  });

  void supabase.auth.getSession().then(({ data: { session } }) => {
    runtime.cloud = true; // env configured: real ids from here on, whichever way sign-in goes
    if (session?.user) {
      void completeSignIn(session.user.id).catch(reportBootFailure);
    } else if (useApp.getState().session) {
      // a cached local session has no JWT behind it — in cloud mode nobody is signed in yet
      useApp.setState({ session: null });
    }
  });

  // §29 realtime: Postgres whispers which tables moved; we re-pull only those under RLS.
  supabase
    .channel('amrut-sync')
    .on('postgres_changes', { event: '*', schema: 'public' }, msg => noteExternalChange((msg as { table?: string }).table ?? ''))
    .subscribe();
}

// ============================== realtime ==============================

const sliceByTable = new Map<string, (typeof SLICES)[number]>();
for (const def of SLICES) {
  sliceByTable.set(def.table, def);
  for (const child of def.children ?? []) sliceByTable.set(child.table, def);
}

let rtTimer: ReturnType<typeof setTimeout> | null = null;
const rtTables = new Set<string>();

/** One burst of change events becomes one pull per touched slice, not per row. */
function noteExternalChange(table: string): void {
  rtTables.add(table);
  if (rtTimer) clearTimeout(rtTimer);
  rtTimer = setTimeout(() => { rtTimer = null; void reconcile(); }, 1500);
}

async function reconcile(): Promise<void> {
  const tables = [...rtTables];
  rtTables.clear();
  if (!supabase || !useApp.getState().session) return;
  const pulled: PulledState = {};
  try {
    for (const table of tables) {
      if (table === 'profiles' || table === 'company_users') pulled.users = await pullUsers();
      else if (table === 'ingredients') pulled.ingredientCatalog = await pullCatalog();
      else {
        const def = sliceByTable.get(table);
        if (def && !(def.slice in pulled)) pulled[def.slice] = await pullSlice(def);
      }
    }
  } catch (e) {
    reportBootFailure(e);
    return;
  }
  // server-authoritative (§37): pulled rows replace what they touch; browser-only rows survive.
  // What the pull just handed over is absorbed first, so the next diff owes only the rows
  // this browser changed — never the ones the database itself just answered with.
  engine.absorb(pulled);
  mergeReceived(pulled);
}

function reportBootFailure(e: unknown): void {
  useApp.getState().pushToast('error', `Supabase: ${(e as Error).message}`);
}
