/**
 * tests/harness/supabase-stub.mjs — the seam that keeps tests off the network.
 *
 * `src/lib/supabase.ts` is the only module in the app that builds a client, so replacing
 * that one module replaces it everywhere: the store, `dataService`, the sync engine and
 * the receipt allocator all receive whatever a test installs here.
 *
 * The exported `supabase` binding is a live ESM reference, and that is what makes the
 * harness honest: with nothing installed it is `null`, so every existing `if (!supabase)`
 * guard in the app takes its documented no-cloud branch. A test that wants cloud mode
 * installs a fake and sets `runtime.cloud` itself. Nothing is ever answered from thin
 * air — a request with no responder installed reports an error, because a suite that
 * silently receives `[]` would pass while proving nothing.
 */

let supabaseClient = null;

/** @type {Array<object>} every request the installed client received, oldest first */
const requests = [];

/** Install a client for the duration of a test; pass nothing to return to local mode. */
export function installClient(client) {
  supabaseClient = client ?? null;
  requests.length = 0;
  return supabaseClient;
}

export function resetClient() {
  supabaseClient = null;
  requests.length = 0;
}

export function isInstalled() {
  return supabaseClient !== null;
}

/** Every request the installed client received, oldest first. */
export function requestLog() {
  return requests;
}

/** Requests made against one table, in the order they went out. */
export function requestsFor(table) {
  return requests.filter(r => r.table === table);
}

const FILTERS = new Set(['eq', 'neq', 'in', 'gte', 'lte', 'is', 'like', 'ilike']);
const TRAVERSAL = new Set(['select', 'order', 'limit', 'range', 'single', 'maybeSingle']);
const WRITES = new Set(['insert', 'upsert', 'update', 'delete']);

const notImplemented = name => async () => {
  throw new Error(`[tests] the fake Supabase client does not implement '${name}' — install a responder or extend the stub`);
};

/**
 * A stand-in for the PostgREST chain the app builds. One object records the call sequence,
 * resolves it through the responder map when awaited, and appends itself to the log so a
 * test can assert what went on the wire rather than only what came back.
 *
 * `respond` is keyed `'table:eggs'`, `'rpc:next_receipt_no'`, `'auth:signInWithPassword'`;
 * a value is either the `{ data, error }` object to return or a function of the request.
 */
export function createFakeClient({ respond = {} } = {}) {
  class Query {
    constructor(table) {
      this.table = table;
      this.method = null;
      this.columns = undefined;
      this.payload = undefined;
      this.filters = [];
      this.options = {};
    }

    toString() {
      return `${this.table}.${this.method ?? 'query'}(${this.filters.map(f => `${f.op}(${f.column})`).join(',')})`;
    }

    then(onOk, onErr) {
      requests.push(this);
      return resolve(this, respond).then(onOk, onErr);
    }
  }

  const client = {
    from(table) {
      const q = new Query(table);
      const chain = new Proxy(q, {
        get(target, prop) {
          if (prop in target) return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
          if (FILTERS.has(prop)) {
            return (column, value) => { target.filters.push({ op: prop, column, value }); return chain; };
          }
          if (TRAVERSAL.has(prop)) {
            return (...args) => {
              target.method ??= prop;
              if (prop === 'select') target.columns = args[0];
              if (prop === 'limit' || prop === 'range' || prop === 'order') target.options[prop] = args;
              return chain;
            };
          }
          if (WRITES.has(prop)) {
            return (payload, options) => {
              target.method = prop;
              if (payload !== undefined) target.payload = payload;
              Object.assign(target.options, options ?? {});
              return chain;
            };
          }
          throw new Error(`[tests] the fake Supabase client was called with '.${String(prop)}', which the app never uses`);
        },
      });
      return chain;
    },

    rpc(name, args) {
      const request = { table: null, method: 'rpc', rpcName: name, args, filters: [], toString: () => `rpc(${name})` };
      requests.push(request);
      const found = lookup(`rpc:${name}`, respond);
      return Promise.resolve(handlerOf(found, request));
    },

    auth: {
      async signInWithPassword(args) {
        const request = { table: null, method: 'auth.signInWithPassword', args, toString: () => 'auth.signInWithPassword' };
        requests.push(request);
        return await handlerOf(lookup('auth:signInWithPassword', respond) ?? { data: null, error: { message: NO_RESPONDER } }, request);
      },
      async signUp(args) {
        const request = { table: null, method: 'auth.signUp', args, toString: () => 'auth.signUp' };
        requests.push(request);
        return await handlerOf(lookup('auth:signUp', respond) ?? { data: null, error: { message: NO_RESPONDER } }, request);
      },
      async signOut() { requests.push({ table: null, method: 'auth.signOut' }); return { data: null, error: null }; },
      async getSession() { return await handlerOf(lookup('auth:getSession', respond) ?? { data: { session: null }, error: null }, {}); },
      async getUser() { return await handlerOf(lookup('auth:getUser', respond) ?? { data: { user: null }, error: null }, {}); },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() { } } } }; },
      refreshSession: notImplemented('auth.refreshSession'),
      setSession: notImplemented('auth.setSession'),
    },

    channel: notImplemented('channel'),
    removeChannel: notImplemented('removeChannel'),
    removeAllChannels: async () => ({ error: null }),
  };

  return client;
}

const NO_RESPONDER = '[tests] no responder installed for this request';

function lookup(key, respond) {
  return key in respond ? respond[key] : undefined;
}

function handlerOf(found, request) {
  return typeof found === 'function' ? found(request) : found;
}

async function resolve(query, respond) {
  const found = lookup(`table:${query.table}`, respond);
  if (found === undefined) return { data: null, error: { message: NO_RESPONDER, code: 'TEST_NO_RESPONDER' } };
  return await handlerOf(found, query);
}

export { supabaseClient as supabase };
