/**
 * tests/ordering.test.mjs — every history view opens with its newest line.
 *
 * A farm owner scanning a ledger wants the thing that just happened, not the morning's first
 * entry. The rule is one comparator (`lib/order`) for ledgers and the timeline's own
 * `timelineOrder`, which additionally reads a record's clock inside its day. These tests hold
 * both ends of that rule so a screen cannot quietly revert to oldest-first.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compareLatestFirst, latestFirst } from '@/lib/order';
import { timelineOrder } from '@/lib/timeline';
import { traderLedger } from '@/lib/calc';

/** The smallest shape `timelineOrder` reads; the rest of an event is display matter. */
const ev = (over) => ({ id: 'a', date: '2026-02-15', clock: null, ...over });

describe('P1 · a history view leads with its newest line', () => {
  it('the timeline reads the latest day first', () => {
    const order = [ev({ id: 'old', date: '2026-02-13' }), ev({ id: 'new', date: '2026-02-15' })]
      .sort(timelineOrder).map(e => e.id);
    assert.deepEqual(order, ['new', 'old']);
  });

  it('inside one day the latest clock leads, and the morning closes it', () => {
    const day = [
      ev({ id: 'noon', clock: '12:00' }),
      ev({ id: 'evening', clock: '18:30' }),
      ev({ id: 'morning', clock: '06:05' }),
      ev({ id: 'unclocked', clock: null }),
    ].sort(timelineOrder).map(e => e.id);
    assert.deepEqual(day, ['evening', 'noon', 'morning', 'unclocked'],
      'a line with no clock of its own is not promoted over the day’s work');
  });

  it('two lines at one clock still fall in one fixed order', () => {
    const a = ev({ id: 'fin:9', clock: '14:56' });
    const b = ev({ id: 'fin:10', clock: '14:56' });
    assert.deepEqual([a, b].sort(timelineOrder).map(e => e.id), ['fin:9', 'fin:10']);
    assert.deepEqual([b, a].sort(timelineOrder).map(e => e.id), ['fin:9', 'fin:10'],
      'the order never depends on which row the store happened to write first');
  });

  it('the ledger comparator is newest day, newest booking, newest id', () => {
    const rows = [
      { id: 'r1', date: '2026-02-15', createdAt: '2026-02-15T04:00:00.000Z' },
      { id: 'r2', date: '2026-02-15', createdAt: '2026-02-15T09:00:00.000Z' },
      { id: 'r3', date: '2026-02-14', createdAt: '2026-02-14T09:00:00.000Z' },
      { id: 'r4', date: '2026-02-15' },
    ];
    assert.deepEqual(latestFirst(rows).map(r => r.id), ['r2', 'r1', 'r4', 'r3']);
    assert.equal(compareLatestFirst(rows[0], { ...rows[0] }), 0);
  });

  it('a trader statement carries its running balance and still opens latest-first', () => {
    const txns = [
      { id: 't1', kind: 'EGG_SALE', amount: 1000, date: '2026-02-11', createdAt: '2026-02-11T04:00:00.000Z' },
      { id: 't2', kind: 'PAYMENT_IN', amount: 400, date: '2026-02-12', createdAt: '2026-02-12T04:00:00.000Z' },
      { id: 't3', kind: 'EGG_SALE', amount: 700, date: '2026-02-13', createdAt: '2026-02-13T04:00:00.000Z' },
    ];
    const rows = traderLedger(0, txns);
    assert.deepEqual(rows.map(r => r.txn.id), ['t3', 't2', 't1']);
    assert.equal(rows[rows.length - 1].running, 1000, 'the running figure is built in booking order');
    assert.equal(rows[0].running, 1300);
  });
});
