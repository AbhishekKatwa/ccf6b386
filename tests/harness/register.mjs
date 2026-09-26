/**
 * tests/harness/register.mjs — the suite's boot script.
 *
 * Loaded with `--import` before any test file runs, so it does the four things that have to
 * exist before application code is evaluated: install the resolver that understands the
 * app's own import style, fix the timezone, give the store a `localStorage` for its
 * persistence layer, and pin the clock to one deterministic farm day.
 */
import { register } from 'node:module';
import { freezeClock, TEST_NOW } from './clock.mjs';

/** The app is written for one timezone: flock days are local calendar days. */
process.env.TZ = 'Asia/Kolkata';

register('./loader.mjs', import.meta.url);

/** A Map-backed Web Storage, so the store's persist works and nothing leaks between tests. */
class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(i) { return [...this.#data.keys()][i] ?? null; }
  getItem(k) { return this.#data.has(k) ? this.#data.get(k) : null; }
  setItem(k, v) { this.#data.set(k, String(v)); }
  removeItem(k) { this.#data.delete(k); }
  clear() { this.#data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

/**
 * `matchMedia` answers "does this browser want motion?". Nothing in the store graph asks
 * today; it is declared so a component-level test can be added without a new boot file.
 */
globalThis.matchMedia ??= (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { },
});

freezeClock(TEST_NOW);
