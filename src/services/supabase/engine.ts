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
import { DatabaseError, logDatabaseError, normalizeDatabaseError } from '@/lib/dbErrors';
import { companyAccessOf, contextIntact, operableCompanies } from '@/lib/companyAccess';
import { useApp, rebalanceTraders, foldSeedIdentities } from '@/store/app';
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

/** The same standing error, said once. A store edit re-runs the diff every second, and one
 *  refusal must not stack a wall of toasts — the badge already carries what is owed.
 *
 *  A queue that refused is not a form that refused (§21): the line names the queue, and the
 *  reasons the engine carries — already the user's words, never the database's — go underneath. */
let lastSyncError = '';
function reportSyncFailures(lines: string[]): void {
  const detail = [...new Set(lines.filter(Boolean))].join(' · ');
  if (!detail) { lastSyncError = ''; return; }
  if (detail === lastSyncError) return;
  lastSyncError = detail;
  useApp.getState().pushToast('error', 'Some changes could not sync.', detail);
}

/** A slice the database accepted. Rows that were only awaiting a write keep their sync flag. */
const SYNC_FLAGGED = [
  'mortality', 'feed', 'feedRounds', 'eggs', 'eggWastages', 'saleLogs', 'saleEntries',
  'eggSaleBookings', 'feedStock', 'medicineStock', 'finance', 'traderTxns', 'tasks',
  'vaccinations', 'cashHandovers', 'cashCounts', 'supportMessages',
];

const EMPTY: Set<string> = new Set<string>();

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

/** pulled rows win, except where this browser has a change the database has not been given
 *  yet; rows only the browser has (made while away from the network) are kept and go out on the
 *  first diff. Nothing the farm recorded offline is silently discarded. */
function mergeSlice(key: string, pulled: any[], local: any[], owed: Set<string>): any[] {
  if (key === 'ingredientCatalog') {
    return [...new Set([...(pulled as string[]), ...(local as string[])])];
  }
  // Drop the pulled copy of a row this device still owes, so the local one survives as the
  // only row with that id; everything else takes the database's version.
  const keep = pulled.filter(o => !owed.has(String(o?.id)));
  const ids = new Set(keep.map(o => String(o?.id)));
  return [...keep, ...(local ?? []).filter(o => o?.id && !ids.has(String(o.id)))];
}

/** Applies pulled rows over the store's current slice, keeping browser-only rows and the
 *  rows this device still owes (`owed`, measured before the pull rewrote the send memory). */
function mergeReceived(pulled: PulledState, owed: Record<string, Set<string>> = {}): void {
  const state = useApp.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, rows] of Object.entries(pulled)) {
    patch[key] = mergeSlice(key, rows, (state[key] as any[]) ?? [], owed[key] ?? EMPTY);
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
  // Fold first (§45): seed identities that have cloud twins must be collapsed before any
  // measurement or priming, or the diff will see repointed references as new rows and try
  // to push them against ids the database has already retired. The hold gate ("waits for X
  // to have a login") only fires when the send memory knows the person — a fold that moves
  // the reference after prime() bypasses that gate entirely.
  if ('users' in rows) foldSeedIdentities();
  // prime first: what the database just handed over is what it already has. Only then does
  // the merge bring in the browser's own rows, so the diff sees as owed exactly the set
  // the database has never been told about — never the whole cache.
  // Measured before the prime: this device's own unsent changes, so a row the farm edited while
  // no wire was there is not read back off the database and quietly overwritten with the older
  // copy. It stays in the store and goes out on the flush below.
  const owed = engine.owed(rows, useApp.getState() as unknown as Record<string, any>);
  engine.prime(rows);
  mergeReceived(rows, owed);
  syncedIn = true;
  clearRetry();
  attempt = 0; // a fresh read of the database is the start of the ladder, not its fourth rung
  // The pull has just refreshed `companies`, `users` and every membership: if the working
  // context no longer stands, it goes now, before the first diff and before any screen can
  // render off it.
  useApp.getState().revalidateCompanyAccess();
  reportSyncFailures(failed);
  publishStatus();
  void flush();
}

/** The database has this person now, written by `create_login` rather than by a push of ours:
 *  confirm them so an access granted in the same breath is sendable at once, instead of waiting
 *  on the realtime pull that will land a second later and say the same thing. */
export function confirmLogin(userId: string): void {
  engine.confirmPerson(userId);
}

export function setStoreSession(userId: string): void {
  const state = useApp.getState();
  const user = state.users.find(u => u.id === userId);
  const previous = state.session;
  // Re-read the context the browser last held against what the database now says of it.
  const was = companyAccessOf(previous, user, state.companies);
  // A context that was taken while this device slept (the company switched off, or the person
  // was detached from it) is a revocation, not an empty slot. Blank it and the screen that
  // fills is a company picker that quietly omits the dead one — the person is left to guess
  // whether they were ever here. Name the reason instead, on the one screen that carries it.
  // With no previous session there is nothing to revoke, and a notice carried into a fresh
  // sign-in would read as though this one had been refused.
  const carried = !previous ? null : contextIntact(was) ? state.accessNotice : was;
  useApp.setState({
    session: {
      userId,
      companyId: was.reason === 'USABLE'
        ? previous!.companyId
        : (operableCompanies(user, state.companies)[0]?.id ?? null),
      signedInAt: new Date().toISOString(),
    },
    accessNotice: carried,
  });
}

async function flush(): Promise<void> {
  if (!syncedIn) return;
  // Offline there is nothing to send to. The queue is a diff against the store, so waiting
  // costs nothing and the rows are still owed when the wire returns; offering them to a dead
  // network only trades a full cache for a wall of "failed to fetch".
  if (!useApp.getState().online) { publishStatus(); return; }
  const state = useApp.getState() as unknown as Record<string, unknown>;
  clearRetry(); // one pass at a time: this flush carries the next rung, not a timer already set for it
  syncing = true;
  publishStatus();
  const { failures, written } = await engine.push(state);
  syncing = false;
  reportSyncFailures(failures);
  markWritten(written);
  publishStatus();
  scheduleRetry();
}

/** Retry now — the badge's tap. Failed rows are still owed, so this re-offers them.
 *  A person asking is a fresh case: the ladder starts again at its first rung. */
export function retrySync(): void {
  attempt = 0;
  void flush();
}

// ============================== bounded retry ==============================

/**
 * A pass the wire refused leaves the rows owed, and the badge already says so. This device
 * still comes back to them on its own — a blip, a tunnel, a laptop waking — a few times on a
 * widening ladder, then stops. The queue is the store's own diff, so a stopped retry loses
 * nothing: the next edit, the network returning or a tap on the badge starts the ladder again.
 */
const RETRY_LADDER = [5_000, 20_000, 60_000, 300_000];
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  clearRetry();
  const state = useApp.getState() as unknown as Record<string, unknown>;
  if (engine.pending(state).count === 0 || !useApp.getState().online) { attempt = 0; return; }
  if (attempt >= RETRY_LADDER.length) return;
  const wait = RETRY_LADDER[attempt++];
  retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, wait);
}

/**
 * Back on the network: an outage swallows realtime events, so the rows others changed while
 * this device was away have to be pulled, not just answered for. The existing hydrate does
 * exactly that (pull → prime → merge → flush), so reconnection re-enters it rather than
 * opening a second path. A pull landing while a write is in flight would re-prime the engine
 * off a snapshot the wire has not finished confirming, so that pass sends alone.
 */
async function resync(): Promise<void> {
  if (!syncedIn) return;
  if (engine.isBusy()) { void flush(); return; }
  await hydrateFromDatabase();
}

// ============================== queue status (the badge's truth) ==============================

export interface CloudSyncStatus { pending: number; errors: string[]; syncing: boolean }

let status: CloudSyncStatus = { pending: 0, errors: [], syncing: false };
const statusListeners = new Set<() => void>();

function publishStatus(): void {
  const state = useApp.getState() as unknown as Record<string, unknown>;
  const next = syncedIn ? engine.pending(state) : { count: 0, errors: [] as string[] };
  const shaped = { pending: next.count, errors: next.errors, syncing };
  if (shaped.pending === status.pending && shaped.errors.join('|') === status.errors.join('|')
    && shaped.syncing === status.syncing) return;
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
  clearRetry();    // one pass at a time: the edit's own debounce carries the retry ladder
  // This is also the sound a landing write makes: `markWritten` flips `synced`, the store
  // changes, and the diff arrives here. So a pass that got rows in restarts the ladder, while a
  // pass the wire refused everything on advances it — progress keeps its full allowance and a
  // dead end still stops.
  attempt = 0;
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

/** When this tab last went to the background; 0 means it is not hidden right now. */
let hiddenAt = 0;

export function startCloudSync(): void {
  if (!supabase || started) return;
  started = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      syncedIn = false;
      syncing = false;
      clearRetry();
      attempt = 0;
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
      syncing = false;
      clearRetry();
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

  // The network itself is a change to react to, not only a thing to discover on the next edit:
  // a phone leaving a tunnel has no reason to touch the store, and a queue that waits for one
  // reads as a sync that never happens. The flag is stamped here first because the decision
  // below is made off it, and App's own listener may be registered after this one.
  window.addEventListener('online', () => {
    useApp.getState().setOnline(true);
    attempt = 0;
    clearRetry();
    void resync().catch(reportBootFailure);
  });
  // Away from the network the queue simply waits: nothing is dropped, nothing is retried
  // against a wire that cannot answer, and no failure loop starts.
  window.addEventListener('offline', () => {
    useApp.getState().setOnline(false);
    clearRetry();
    attempt = 0;
    publishStatus();
  });

  // Android parks a WebView instead of dropping its network, so coming back to the app is a
  // transition of its own — and the one where the realtime socket died quietly, with no
  // 'online' event ever arriving to say so. A short look at another app is not a reason to
  // re-pull the world; a sleep is. Both halves are idempotent: the diff owes only rows the
  // database does not have, so returning twice cannot send an edit twice.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const slept = hiddenAt > 0 && Date.now() - hiddenAt > 60_000;
    hiddenAt = 0;
    useApp.getState().setOnline(navigator.onLine);
    if (!slept || !navigator.onLine) return;
    attempt = 0;
    clearRetry();
    void resync().catch(reportBootFailure);
  });
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
  // Fold seed identities before the measurement, or repointed references look like new rows
  // and bypass the hold gate that says "waits for X to have a login".
  if ('users' in pulled) foldSeedIdentities();
  const owed = engine.owed(pulled, useApp.getState() as unknown as Record<string, any>);
  engine.absorb(pulled);
  mergeReceived(pulled, owed);
  // A deactivation or a removed membership arrives like any other row change: the pull makes
  // it local truth, and the context is re-read against it the same second.
  useApp.getState().revalidateCompanyAccess();
}

/** A pass that never got to the database at all: still read once into the user's words. */
function reportBootFailure(e: unknown): void {
  const n = normalizeDatabaseError(e, { origin: 'background' });
  // A DatabaseError was already logged where the wire refused it; say it once.
  if (!(e instanceof DatabaseError)) logDatabaseError(n, e);
  useApp.getState().pushToast('error', n.userMessage, n.actionMessage);
}
