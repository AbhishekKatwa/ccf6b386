/**
 * tests/harness.test.mjs — proves the test harness itself.
 *
 * Everything else in this suite asserts business outcomes through application code, so
 * before any of that is trusted the harness has to show that it is really loading the
 * app: the `@/…` alias resolving to `src/`, Node stripping the types off the real modules,
 * the store booting against a stand-in `localStorage`, no cloud for the session, and the
 * one seam that lets a test install a fake Supabase client.
 *
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { EGGS_PER_TRAY } from '@/types';
import { entryAmount, eggStockByGrade, traderBalance } from '@/lib/calc';
import { todayISO, nowISO, daysBetween } from '@/lib/format';
import { runtime } from '@/lib/runtime';
import { supabase as supabaseBinding } from '@/lib/supabase';
import { installClient, resetClient, createFakeClient, requestLog } from './harness/supabase-stub.mjs';
import { TEST_TODAY } from './harness/clock.mjs';

test('the @/ alias resolves into the real src/ modules', () => {
  assert.equal(EGGS_PER_TRAY, 30, 'a constant read out of src/types through the alias');
});

test('Node strips the application types and the calculations run', () => {
  const stock = eggStockByGrade('sh_a1', [
    { id: 'e1', shedId: 'sh_a1', date: '2026-02-10', goodTrays: 40, brokenTrays: 5, doubleTrays: 3, smallTrays: 2 },
  ], [], []);
  assert.equal(stock.GOOD.balance, 40);
  assert.equal(stock.SMALL.balance, 2);

  assert.equal(entryAmount(
    [{ shedId: 'sh_a1', byGrade: { GOOD: 10, BROKEN: 0, DOUBLE: 0, SMALL: 0 } }],
    { GOOD: 5.5 }, 'RATE'), 10 * EGGS_PER_TRAY * 5.5);
  assert.equal(traderBalance(1000, [{ kind: 'EGG_SALE', amount: 250 }]), 1250);
});

test('the clock is pinned, so the farm day is the one fixtures are written against', () => {
  assert.equal(todayISO(), TEST_TODAY);
  assert.equal(nowISO().slice(0, 10), '2026-02-15');
  assert.equal(daysBetween('2026-02-10', todayISO()), 5);
});

test('the store boots, exposes its actions and reads as a local session', async () => {
  const { useApp, rebalanceTraders } = await import('@/store/app');
  const state = useApp.getState();

  assert.ok(state.companies.length > 0, 'the store seeded itself');
  assert.equal(typeof state.addSaleEntry, 'function');
  assert.equal(typeof rebalanceTraders, 'function', 'the hydration fix stays reachable');
  assert.equal(runtime.cloud, false, 'no test signs a session into the cloud by accident');
});

test('the store persists into the harness localStorage, not a real browser', async () => {
  const { useApp } = await import('@/store/app');
  useApp.setState(s => ({ companies: [...s.companies] }));
  await new Promise(r => setTimeout(r, 0));
  const saved = globalThis.localStorage.getItem('amrut-poultry-v1');
  assert.ok(saved, 'persist wrote through the shim');
  assert.ok(JSON.parse(saved).state.companies, 'and what it wrote is the company list');
});

test('the Supabase seam is off by default and a client can be installed into it', async () => {
  assert.equal(supabaseBinding, null, 'application code sees no client, so its no-cloud branches run');

  const client = createFakeClient({ respond: { 'table:eggs': { data: [{ id: 'e1' }], error: null } } });
  installClient(client);
  const { supabase } = await import('@/lib/supabase');
  assert.equal(supabase, client, 'the live binding carries the installed client to every importer');

  const { data } = await supabase.from('eggs').select('*').limit(10);
  assert.deepEqual(data, [{ id: 'e1' }]);
  assert.equal(requestLog().length, 1);
  assert.equal(requestLog()[0].method, 'select');

  resetClient();
  const again = await import('@/lib/supabase');
  assert.equal(again.supabase, null, 'a test that finishes leaves local mode behind');
});

test('an undescribed request answers with an error rather than invented data', async () => {
  installClient(createFakeClient());
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.from('finance_txns').select('*');
  assert.equal(data, null);
  assert.match(error.message, /no responder/);
  resetClient();
});
