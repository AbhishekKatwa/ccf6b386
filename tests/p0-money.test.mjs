/**
 * tests/p0-money.test.mjs — P0: the receipt counter, a trader's balance and the one voucher.
 *
 * These three are where a farm's money is actually decided, so each is read the way the app
 * reads it: a reference comes out of `app.takeReceiptNo`, a balance out of `traderBalance`, and
 * a load's worth of rupees out of the sale-entry action that writes the voucher, its ledger
 * rows and its stock draw in one step. No expectation here is copied from a screen — the
 * figures are the ones `tests/harness/fixtures.ts` was built so a human can re-derive by hand
 * (60 good trays × 30 eggs × ₹6 = ₹10,800 of eggs, ₹500 loading, ₹5,000 cash, ₹6,300 still owed).
 *
 * The receipt half runs in both worlds the app lives in: offline, where this device numbers
 * itself and must say so, and cloud, where `next_receipt_no` arbitrates. The cloud half drives
 * the fake client in tests/harness/supabase-stub.mjs, which stands in for the wire — it proves
 * what the store asks the counter and what it does with the answer. That a Postgres upsert
 * cannot hand two devices the same number is a database fact, proved in
 * tests/integration/p0-rls.test.mjs, and is not claimed here.
 *
 * Run with: npm test
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useApp, rebalanceTraders } from '@/store/app';
import { receiptNo, receiptHighWater } from '@/lib/receipts';
import { traderBalance, loadCredit, saleOutstanding, saleBilled, eggStockByGrade, entryAmount } from '@/lib/calc';
import { purchaseReceiptHighWater } from '@/lib/purchasing';
import { medicineReceiptHighWater } from '@/lib/medicines';
import { runtime } from '@/lib/runtime';
import { installClient, createFakeClient, resetClient, requestLog } from './harness/supabase-stub.mjs';
import {
  CO, U, SH, BT, TR, MED, DAY, MONEY, buildWorld, worldAs, resetApp, signInAs, alphaSaleDraft,
} from './harness/fixtures.ts';

const state = () => useApp.getState();
const s = world => resetApp(world);

/** The store's toast list, read as the person would: the text, not the object. */
const toastTexts = () => state().toasts.map(t => t.message);

/**
 * A counter that behaves like `app.next_receipt_no`: one upsert per claim, keyed by company,
 * series and day, that never hands back a number it has already given and jumps past the
 * `p_taken` floor the device brings.
 */
function cloudCounter({ refuse = null, drop = false } = {}) {
  const held = new Map();
  installClient(createFakeClient({
    respond: {
      'rpc:next_receipt_no': (req) => {
        if (drop) return { data: null, error: { code: 'NETWORK', message: 'fetch failed: connection refused' } };
        if (refuse) return { data: null, error: refuse };
        const { p_company: co, p_scope: sc, p_day: day, p_taken: taken } = req.args;
        const key = `${co}|${sc}|${day}`;
        const next = Math.max(held.get(key) ?? 0, Number(taken) ?? 0) + 1;
        held.set(key, next);
        return { data: receiptNo(sc, day, next), error: null };
      },
    },
  }));
  runtime.cloud = true;
  return held;
}

/** Back to a test run with no cloud, whatever a test just installed. */
afterEach(() => {
  resetClient();
  runtime.cloud = false;
});

describe('P0 · a receipt reference is one format, minted once per company, day and series', () => {
  it('the three series read exactly as the database counter writes them', () => {
    assert.equal(receiptNo('CR', '2026-09-25', 7), 'CR-2026-09-25-007');
    assert.equal(receiptNo('PUR', '2026-09-25', 1), 'PUR-2026-09-25-001');
    assert.equal(receiptNo('MED', '2026-09-25', 128), 'MED-2026-09-25-128');
  });

  it('the high water reads one series on one day and nothing else', () => {
    const refs = [
      'PUR-2026-02-15-003', 'PUR-2026-02-15-011', 'PUR-2026-02-14-009',
      'CR-2026-02-15-040', 'MED-2026-02-15-007', undefined, 'PUR-2026-02-15-abc',
    ];
    assert.equal(receiptHighWater(refs, 'PUR', '2026-02-15'), 11, 'the highest of the series, not the last row');
    assert.equal(receiptHighWater(refs, 'CR', '2026-02-15'), 40);
    assert.equal(receiptHighWater(refs, 'MED', '2026-02-14'), 0, 'another day is another series');
    assert.equal(receiptHighWater([], 'PUR', '2026-02-15'), 0);
  });

  it('each ledger reads its own series out of its own column', () => {
    const world = buildWorld();
    assert.equal(purchaseReceiptHighWater(world.feedStock, CO.ALPHA, '2026-02-10'), 1);
    assert.equal(medicineReceiptHighWater(world.medicineStock, CO.ALPHA, '2026-02-10'), 1);
    assert.equal(purchaseReceiptHighWater(world.feedStock, CO.BETA, '2026-02-10'), 0,
      'Beta holds no purchase of that number');
  });

  it('offline, the device numbers past its own records and never repeats one', async () => {
    const D = '2026-02-16';
    s(worldAs(U.ALPHA_OWNER, CO.ALPHA, { online: false }));
    assert.equal(await state().takeReceiptNo('PUR', D), 'PUR-2026-02-16-001');
    assert.equal(await state().takeReceiptNo('PUR', D), 'PUR-2026-02-16-002',
      'two receipts written on one offline afternoon cannot be handed the same reference');
    assert.equal(await state().takeReceiptNo('PUR', D), 'PUR-2026-02-16-003');
    assert.equal(requestLog().length, 0, 'offline means offline: no request went out');
  });

  it('a cash receipt continues past every table a CR number can already stand in', async () => {
    const D = '2026-02-17';
    const world = worldAs(U.ALPHA_FINANCE, CO.ALPHA, {
      online: false,
      finance: [...buildWorld().finance,
        { id: 'fx_cr05', companyId: CO.ALPHA, date: D, kind: 'INCOME', amount: 100, category: 'Other Income', reference: `CR-${D}-005`, createdBy: U.ALPHA_FINANCE, createdAt: '2026-02-17T04:00:00.000Z', synced: false }],
      traderTxns: [...buildWorld().traderTxns,
        { id: 'tt_cr09', companyId: CO.ALPHA, traderId: TR.A2, date: D, kind: 'PAYMENT_IN', amount: 200, reference: `CR-${D}-009`, createdBy: U.ALPHA_FINANCE, createdAt: '2026-02-17T04:00:00.000Z', synced: false }],
      cashHandovers: [...buildWorld().cashHandovers,
        { id: 'ch_cr02', companyId: CO.ALPHA, date: D, amount: 50, reference: `CR-${D}-002`, handedById: U.ALPHA_FINANCE, receivedById: U.ALPHA_OWNER, createdBy: U.ALPHA_FINANCE, createdAt: '2026-02-17T04:00:00.000Z', synced: false }],
    });
    s(world);
    assert.equal(await state().takeReceiptNo('CR', D), `CR-${D}-010`,
      'one collection cannot be given two numbers by the screen that recorded it');
  });

  it('the two farms number the same day separately', async () => {
    const D = '2026-02-18';
    s(worldAs(U.ALPHA_OWNER, CO.ALPHA, { online: false }));
    assert.equal(await state().takeReceiptNo('MED', D), `MED-${D}-001`);
    signInAs(U.BETA_OWNER, CO.BETA);
    assert.equal(await state().takeReceiptNo('MED', D), `MED-${D}-001`,
      'Alpha’s number is not Beta’s');
  });

  it('cloud: the counter is asked with this company, day, series and the local high water as a floor', async () => {
    const D = '2026-02-19';
    cloudCounter();
    s(worldAs(U.ALPHA_OWNER, CO.ALPHA, {
      feedStock: [...buildWorld().feedStock,
        { id: 'fs_local_4', companyId: CO.ALPHA, ingredient: 'Maize', date: D, kind: 'FEED_IN', qtyKg: 10, ratePerKg: 30, purchaseRef: `PUR-${D}-004`, createdBy: U.ALPHA_OWNER, createdAt: '2026-02-19T04:00:00.000Z', synced: true }],
    }));
    const ref = await state().takeReceiptNo('PUR', D);
    assert.equal(ref, `PUR-${D}-005`, 'the counter continues past what this device holds');
    const call = requestLog().find(r => r.method === 'rpc');
    assert.equal(call.rpcName, 'next_receipt_no');
    assert.deepEqual(call.args, { p_company: CO.ALPHA, p_scope: 'PUR', p_day: D, p_taken: 4 },
      'p_taken is mandatory: without it a row numbered while offline gets numbered over');
  });

  it('cloud: five simultaneous claims come back with five different numbers', async () => {
    const D = '2026-02-20';
    const held = cloudCounter();
    s(worldAs(U.ALPHA_FINANCE, CO.ALPHA));
    const refs = await Promise.all([1, 2, 3, 4, 5].map(() => state().takeReceiptNo('CR', D)));
    assert.equal(new Set(refs).size, 5, `duplicate receipt: ${refs.join(', ')}`);
    assert.deepEqual(refs.map(r => r.slice(-3)).sort(), ['001', '002', '003', '004', '005']);
    assert.equal(held.get(`${CO.ALPHA}|CR|${D}`), 5, 'the counter, not the client, decided the order');
  });

  it('a refused counter mints nothing and saves nothing', async () => {
    const D = '2026-02-21';
    cloudCounter({ refuse: { code: '42501', message: 'new row violates row-level security policy for table "receipt_counters"' } });
    s(worldAs(U.ALPHA_OWNER, CO.ALPHA));
    assert.equal(await state().takeReceiptNo('CR', D), '',
      'the answer to a refusal is no number, never a made-up one');
    const told = toastTexts().join(' ');
    assert.match(told, /denied|again/i, 'and the person is told why nothing happened');
    assert.doesNotMatch(told, /42501|row-level security|receipt_counters/,
      'the raw database words never reach the screen');
  });

  it('a counter that was never reached numbers locally and says so', async () => {
    const D = '2026-02-22';
    cloudCounter({ drop: true });
    s(worldAs(U.ALPHA_OWNER, CO.ALPHA));
    assert.equal(await state().takeReceiptNo('CR', D), `CR-${D}-001`);
    assert.match(toastTexts().join(' '), /only unique on this device/,
      'the limit of a local number is stated, not hidden');
  });

  it('a reload reads the saved receipts back as its floor', async () => {
    const D = '2026-02-23';
    s(worldAs(U.ALPHA_OWNER, CO.ALPHA, { online: false }));
    assert.equal(await state().takeReceiptNo('PUR', D), `PUR-${D}-001`);

    // The next boot of this browser finds rows numbered past what it remembered itself showed.
    const world = worldAs(U.ALPHA_OWNER, CO.ALPHA, {
      online: false,
      feedStock: [...buildWorld().feedStock,
        { id: 'fs_saved_7', companyId: CO.ALPHA, ingredient: 'Maize', date: D, kind: 'FEED_IN', qtyKg: 10, ratePerKg: 30, purchaseRef: `PUR-${D}-007`, createdBy: U.ALPHA_OWNER, createdAt: '2026-02-23T04:00:00.000Z', synced: true }],
    });
    s(world);
    assert.equal(await state().takeReceiptNo('PUR', D), `PUR-${D}-008`,
      'a number already standing on a saved receipt is never handed out again');
  });
});

describe('P0 · a trader’s balance is the ledger it sits on', () => {
  it('the opening balance plus every billing, minus every receipt', () => {
    const txns = [
      { id: 'a', kind: 'EGG_SALE', amount: 11300 },
      { id: 'b', kind: 'PAYMENT_IN', amount: 5000 },
      { id: 'c', kind: 'OPENING', amount: 5000 },
    ];
    assert.equal(traderBalance(0, txns), 6300, 'an OPENING row on the ledger is a record of the base, never a second movement');
    assert.equal(traderBalance(5000, [txns[0], txns[1]]), 11300);
    assert.equal(traderBalance(0, [{ id: 'd', kind: 'PAYMENT_OUT', amount: 1000 }]), 1000,
      'money handed back to the trader is a fresh due');
    assert.equal(traderBalance(0, [{ id: 'e', kind: 'PAYMENT_IN', amount: 4000 }]), -4000,
      'negative means they have paid ahead and the farm is holding their money');
  });

  it('the world its own tests start from is internally consistent', () => {
    const world = buildWorld();
    const healed = rebalanceTraders(world.traders, world.traderTxns, false);
    for (const t of healed) {
      assert.equal(t.outstandingAmount, traderBalance(t.openingBalance,
        world.traderTxns.filter(x => x.traderId === t.id)), `${t.name}’s cached figure matches its ledger`);
    }
  });

  it('a stale cached balance is healed by the ledger, without a database write', () => {
    const world = buildWorld();
    const drift = world.traders.map(t => ({ ...t, outstandingAmount: 999_999, updatedAt: t.updatedAt }));
    const healed = rebalanceTraders(drift, world.traderTxns, false);
    assert.deepEqual(healed.map(t => t.outstandingAmount), [0, 5000, 1500]);
    assert.deepEqual(healed.map(t => t.updatedAt), drift.map(t => t.updatedAt),
      'healing a cache is not an edit: stamping it would offer the database a write nobody asked for');
    const stamped = rebalanceTraders(drift, world.traderTxns);
    assert.notDeepEqual(stamped.map(t => t.updatedAt), drift.map(t => t.updatedAt),
      'a real edit from the terminal does stamp');
  });

  it('the voucher that bills a load leaves exactly its credit on the account', () => {
    s(worldAs(U.ALPHA_FINANCE));
    const before = state().traders.find(t => t.id === TR.A1).outstandingAmount;
    const res = state().addSaleEntry(alphaSaleDraft());
    assert.equal(res.ok, true, res.error);
    const after = state().traders.find(t => t.id === TR.A1).outstandingAmount;
    assert.equal(before, 0);
    assert.equal(after, MONEY.CREDIT, '₹11,300 billed − ₹5,000 cash');
    assert.equal(after - before, loadCredit({ ...alphaSaleDraft(), amount: MONEY.EGGS_MONEY }));
  });

  it('a later receipt takes the same figure down, and never more than the load still owes', () => {
    s(worldAs(U.ALPHA_FINANCE));
    const entryId = state().addSaleEntry(alphaSaleDraft()).id;
    const entryOf = () => state().saleEntries.find(e => e.id === entryId);
    const balanceOf = () => state().traders.find(t => t.id === TR.A1).outstandingAmount;

    assert.equal(state().recordSalePayment({ saleId: entryId, amount: 1300, date: DAY, paymentMethod: 'UPI', handledById: U.ALPHA_FINANCE }).ok, true);
    assert.equal(balanceOf(), MONEY.CREDIT - 1300);
    assert.equal(saleOutstanding(entryOf(), state().traderTxns), 5000);

    const over = state().recordSalePayment({ saleId: entryId, amount: 6000, date: DAY, paymentMethod: 'CASH', handledById: U.ALPHA_FINANCE });
    assert.equal(over.ok, false);
    assert.match(over.error, /still due/, 'a load cannot be paid twice by accident');
    assert.equal(balanceOf(), MONEY.CREDIT - 1300, 'the refused receipt left no row behind');

    assert.equal(state().recordSalePayment({ saleId: entryId, amount: 5000, date: DAY, paymentMethod: 'CASH', handledById: U.ALPHA_FINANCE }).ok, true);
    assert.equal(saleOutstanding(entryOf(), state().traderTxns), 0);
    assert.equal(balanceOf(), 0);

    // Money handed over outside a load is the one way the farm ends up holding a trader's rupees.
    assert.equal(state().addTraderTxn({ traderId: TR.A1, date: DAY, kind: 'PAYMENT_IN', amount: 1000, paymentMethod: 'CASH', handledById: U.ALPHA_FINANCE }).ok, true);
    assert.equal(balanceOf(), -1000, 'paid ahead, and said as a negative rather than dropped');
    assert.equal(saleOutstanding(entryOf(), state().traderTxns), 0, 'the settled load is not un-settled by it');
  });

  it('an opening balance survives a switch between the two farms', () => {
    s(worldAs(U.BOTH_OWNER, CO.ALPHA));
    const alpha = state().traders.find(t => t.id === TR.A2).outstandingAmount;
    assert.equal(alpha, 5000);
    signInAs(U.BOTH_OWNER, CO.BETA);
    const beta = state().traders.find(t => t.id === TR.B1).outstandingAmount;
    assert.equal(beta, 1500);
    signInAs(U.BOTH_OWNER, CO.ALPHA);
    assert.equal(state().traders.find(t => t.id === TR.A2).outstandingAmount, alpha);
    assert.equal(state().traders.find(t => t.id === TR.B1).outstandingAmount, beta);
  });
});

describe('P0 · one egg sale voucher moves stock and books the money once', () => {
  it('the arithmetic is the one a person can re-derive', () => {
    assert.equal(MONEY.EGGS_SOLD, 1800);
    assert.equal(MONEY.EGGS_MONEY, 10_800);
    assert.equal(MONEY.BILLED, 11_300);
    assert.equal(MONEY.CREDIT, 6_300);
    const draft = alphaSaleDraft();
    assert.equal(entryAmount(draft.lines, draft.rates, draft.pricing, draft.amount), MONEY.EGGS_MONEY,
      '₹6 an egg against 60 good trays — labour is never inside the egg money');
    assert.equal(loadCredit({ ...draft, amount: MONEY.EGGS_MONEY }), MONEY.CREDIT);
  });

  it('a saved voucher writes itself, two ledger rows and one money row — nothing else', () => {
    const world = worldAs(U.ALPHA_FINANCE);
    s(world);
    const base = { finance: 4, traderTxns: 2, saleEntries: 0 };
    const res = state().addSaleEntry(alphaSaleDraft());
    assert.equal(res.ok, true, res.error);
    const st = state();
    const entry = st.saleEntries.find(e => e.id === res.id);

    assert.equal(entry.amount, MONEY.EGGS_MONEY);
    assert.equal(entry.credit, MONEY.CREDIT);
    assert.equal(saleBilled(entry), MONEY.BILLED);

    assert.equal(st.saleEntries.length, base.saleEntries + 1);
    assert.equal(st.finance.length, base.finance + 1, 'only the cash actually received enters the finance ledger');
    assert.equal(st.traderTxns.length, base.traderTxns + 2, 'one billing row and one receipt row, both owned by the voucher');

    const rows = st.traderTxns.filter(t => t.refId === entry.id);
    assert.deepEqual(rows.map(r => [r.kind, r.amount]).sort(),
      [['EGG_SALE', MONEY.BILLED], ['PAYMENT_IN', MONEY.CASH_IN]]);
    assert.equal(rows.find(r => r.kind === 'EGG_SALE').trays, 60);
    assert.equal(rows.find(r => r.kind === 'EGG_SALE').rate, MONEY.EGG_RATE);
    assert.equal(st.finance.filter(f => f.refId === entry.id).length, 1);
    const money = st.finance.find(f => f.refId === entry.id);
    assert.equal(money.kind, 'INCOME');
    assert.equal(money.amount, MONEY.CASH_IN);
    assert.equal(money.batchId, BT.A1, 'the money lands on the flock that laid the eggs');
  });

  it('the trays leave the shed exactly once', () => {
    s(worldAs(U.ALPHA_FINANCE));
    const stockOf = () => eggStockByGrade(SH.A1, state().eggs, state().saleEntries, state().eggWastages);
    assert.equal(stockOf().GOOD.balance, 180);
    assert.equal(stockOf().BROKEN.balance, 25);
    const res = state().addSaleEntry(alphaSaleDraft());
    assert.equal(res.ok, true, res.error);
    assert.equal(stockOf().GOOD.balance, 120, '180 collected − 60 sold, and no second draw');
    assert.equal(stockOf().BROKEN.balance, 25, 'a grade nobody sold is untouched');
  });

  it('a load bigger than the shelf is refused and writes nothing', () => {
    s(worldAs(U.ALPHA_FINANCE));
    const before = state();
    const res = state().addSaleEntry(alphaSaleDraft({
      lines: [{ shedId: SH.A1, byGrade: { GOOD: 200, BROKEN: 0, DOUBLE: 0, SMALL: 0 } }],
    }));
    assert.equal(res.ok, false);
    assert.match(res.error, /only 180 good trays/);
    assert.equal(state().saleEntries.length, before.saleEntries.length);
    assert.equal(state().traderTxns.length, before.traderTxns.length, 'a refused voucher mints no ledger row');
    assert.equal(eggStockByGrade(SH.A1, state().eggs, state().saleEntries, state().eggWastages).GOOD.balance, 180);
  });

  it('correcting a voucher rewrites the rows it owns instead of adding a second pair', () => {
    s(worldAs(U.ALPHA_FINANCE));
    const id = state().addSaleEntry(alphaSaleDraft()).id;
    const res = state().updateSaleEntry(id, alphaSaleDraft({
      lines: [{ shedId: SH.A1, byGrade: { GOOD: 30, BROKEN: 0, DOUBLE: 0, SMALL: 0 } }],
    }));
    assert.equal(res.ok, true, res.error);

    const st = state();
    assert.equal(st.saleEntries.length, 1);
    assert.equal(st.traderTxns.filter(t => t.kind === 'EGG_SALE').length, 1, 'one billing row for one voucher');
    assert.equal(st.traderTxns.find(t => t.kind === 'EGG_SALE').amount, 30 * 30 * 6 + MONEY.LABOR);
    assert.equal(st.finance.filter(f => f.refId === id).length, 1);
    assert.equal(st.traders.find(t => t.id === TR.A1).outstandingAmount, 5900 - MONEY.CASH_IN);
    assert.equal(eggStockByGrade(SH.A1, st.eggs, st.saleEntries, st.eggWastages).GOOD.balance, 150,
      'the stock draw follows the corrected trays');
  });

  it('deleting a voucher takes its ledger rows and its trays back', () => {
    s(worldAs(U.ALPHA_OWNER));
    const id = state().addSaleEntry(alphaSaleDraft()).id;
    const res = state().deleteSaleEntry(id);
    assert.equal(res.ok, true, res.error);
    const st = state();
    assert.equal(st.saleEntries.length, 0);
    assert.equal(st.traderTxns.filter(t => t.refId === id).length, 0);
    assert.equal(st.finance.filter(f => f.refId === id).length, 0);
    assert.equal(st.traders.find(t => t.id === TR.A1).outstandingAmount, 0, 'the balance is the ledger, so it falls back too');
    assert.equal(eggStockByGrade(SH.A1, st.eggs, st.saleEntries, st.eggWastages).GOOD.balance, 180);
  });

  it('an agreed figure for a mixed load is booked as typed and never repriced', () => {
    s(worldAs(U.ALPHA_FINANCE));
    const res = state().addSaleEntry(alphaSaleDraft({
      pricing: 'AGREED', amount: 9000, rates: {},
      lines: [
        { shedId: SH.A1, byGrade: { GOOD: 40, BROKEN: 10, DOUBLE: 0, SMALL: 0 } },
        { shedId: SH.A2, byGrade: { GOOD: 5, BROKEN: 0, DOUBLE: 0, SMALL: 0 } },
      ],
    }));
    assert.equal(res.ok, true, res.error);
    const entry = state().saleEntries.find(e => e.id === res.id);
    assert.equal(entry.amount, 9000);
    assert.equal(entry.credit, 9000 + MONEY.LABOR - MONEY.CASH_IN);
    assert.equal(eggStockByGrade(SH.A1, state().eggs, state().saleEntries, state().eggWastages).BROKEN.balance, 15,
      'a mixed load still draws from each grade it names');
  });

  it('money in is only ever cash, PhonePe and advance — cash nobody named is refused', () => {
    s(worldAs(U.ALPHA_FINANCE));
    assert.match(state().addSaleEntry(alphaSaleDraft({ cashHandledById: undefined })).error, /who received the cash/);

    const res = state().addSaleEntry(alphaSaleDraft({
      cash: 2000, phonepe: 3000, advance: 1000, cashHandledById: U.ALPHA_OWNER,
    }));
    assert.equal(res.ok, true, res.error);
    const entry = state().saleEntries.find(e => e.id === res.id);
    assert.equal(entry.credit, MONEY.BILLED - 6_000);

    const paid = state().traderTxns.find(t => t.refId === entry.id && t.kind === 'PAYMENT_IN');
    assert.equal(paid.amount, 6_000, 'the three buckets the trader handed over settle one load');
    assert.deepEqual(paid.split, { cash: 2000, online: 3000, advance: 1000 });
    assert.notEqual(paid.paymentMethod, 'CASH', 'a mixed load is not filed under one channel');

    const money = state().finance.filter(f => f.refId === entry.id);
    assert.equal(money.length, 1);
    assert.equal(money[0].amount, 6_000, 'every rupee that arrived today is income, including the advance adjusted');
  });
});
