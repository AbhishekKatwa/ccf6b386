/**
 * tests/p0-security.test.mjs — P0: company isolation, the company lifecycle and roles.
 *
 * Every assertion here goes through a real store action, because that is where this
 * application enforces its rules (`src/store/app.ts` reads `cid()` / `can()` before it
 * writes). Nothing in this file re-implements a permission check: where the expected
 * verdict is needed it is read out of the app's own `DEFAULT_ROLE_PERMISSIONS` through
 * `roleCan`, so a change to that table changes the expectation with it.
 *
 * The client half of the boundary is what P0-2 asks for: a session can be a day old, a
 * `companyId` in a payload is attacker-supplied data, and React hiding a button is not a
 * defence. What the database adds on top of this is proved separately, in
 * tests/integration/p0-rls.test.mjs.
 *
 * Run with: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { roleCan, effectiveCan } from '@/lib/permissions';
import { ingredientBalance } from '@/lib/calc';
import { useApp } from '@/store/app';
import {
  CO, U, SH, BT, TR, MED, FP, DAY, YESTERDAY, PASSWORD, MONEY,
  buildWorld, worldAs, worldWithUser, worldWithCompany, mobileOf, resetApp, signInAs, alphaSaleDraft,
} from './harness/fixtures.ts';

/** The world with this person signed in, working in `companyId`. */
function signInAsWorld(userId, companyId = CO.ALPHA) {
  return resetApp(worldAs(userId, companyId));
}

/** Some actions answer `{ ok, error }`, others answer the row or `null`. Both are verdicts. */
function verdict(res) {
  if (res === null || res === undefined) return { ok: false, error: null };
  if (typeof res === 'object' && 'ok' in res) return res;
  return { ok: true, error: null };
}

/** A write through the store, read back as the row it claims to have made. */
const state = () => useApp.getState();

describe('P0 · sign-in applies the account and company gates', () => {
  it('a correct password enters the one company this person belongs to', () => {
    const world = buildWorld();
    resetApp(world);
    assert.equal(verdict(state().signInWithPassword(mobileOf(world, U.ALPHA_OWNER), PASSWORD)).ok, true);
    assert.equal(state().session.userId, U.ALPHA_OWNER);
    assert.equal(state().session.companyId, CO.ALPHA, 'a sole membership is entered straight away');
  });

  it('a wrong password, an unknown number and a malformed number all leave no session', () => {
    const world = buildWorld();
    resetApp(world);
    const mobile = mobileOf(world, U.ALPHA_OWNER);
    assert.equal(state().signInWithPassword(mobile, 'wrong').ok, false);
    assert.equal(state().session, null);
    assert.equal(state().signInWithPassword('9000009999', PASSWORD).ok, false);
    assert.equal(state().signInWithPassword('12345', PASSWORD).ok, false);
    assert.equal(state().session, null);
  });

  it('a deactivated account cannot sign in, by password or by OTP', () => {
    const world = buildWorld();
    resetApp(world);
    const mobile = mobileOf(world, U.ALPHA_EX);
    assert.equal(state().signInWithPassword(mobile, PASSWORD).error, 'This account is deactivated');
    assert.equal(state().requestOtp(mobile).ok, false);
    assert.equal(state().signInWithOtp(mobile, '123456').ok, false);
    assert.equal(state().session, null);
  });

  it('signing in with only a shut company gives no context and says why', () => {
    const world = buildWorld();
    resetApp(world);
    assert.equal(state().signInWithPassword(mobileOf(world, U.CLOSED_OWNER), PASSWORD).ok, true,
      'the account is valid; the company simply is not open');
    assert.equal(state().session.companyId, null);
    state().revalidateCompanyAccess();
    assert.equal(state().accessNotice?.reason, 'INACTIVE');
    assert.equal(state().addSaleEntry(alphaSaleDraft()).error, 'No company selected');
  });

  it('an OTP session only accepts the code that was issued for it', () => {
    const world = buildWorld();
    resetApp(world);
    const mobile = mobileOf(world, U.ALPHA_OWNER);
    const { code } = state().requestOtp(mobile);
    assert.equal(state().signInWithOtp(mobile, '000000').ok, false);
    assert.equal(state().signInWithOtp(mobile, code).ok, true);
  });
});

describe('P0 · the company context is the only thing a write may stamp', () => {
  it('a person in two farms chooses which one to work in', () => {
    const world = buildWorld();
    resetApp(world);
    state().signInWithPassword(mobileOf(world, U.BOTH_OWNER), PASSWORD);
    assert.equal(state().session.companyId, null, 'two operable companies means the picker');
    assert.equal(state().selectCompany(CO.BETA).ok, true);
    assert.equal(state().session.companyId, CO.BETA);
  });

  it("a company this person does not belong to is refused, and the context is unchanged", () => {
    signInAsWorld(U.ALPHA_OWNER);
    assert.equal(state().selectCompany(CO.BETA).error, 'You do not have access to this company');
    assert.equal(state().session.companyId, CO.ALPHA);
  });

  it('an inactive company cannot be entered, even by someone who belongs to it', () => {
    signInAsWorld(U.BOTH_OWNER, null);
    assert.equal(state().selectCompany(CO.CLOSED).error, 'Company unavailable');
    assert.equal(state().session.companyId, null);
  });

  it('a platform admin may enter a live company they are not a member of', () => {
    const world = buildWorld();
    resetApp(world);
    state().signInWithPassword(mobileOf(world, U.PLATFORM), PASSWORD);
    assert.equal(state().session.companyId, null, 'no membership means no auto-entry');
    assert.equal(state().selectCompany(CO.ALPHA).ok, true);
    assert.equal(state().session.companyId, CO.ALPHA);
  });

  it('losing the membership mid-session drops the context and blocks every write', () => {
    const world = worldWithUser(buildWorld(), U.ALPHA_FINANCE, { companyIds: [] });
    resetApp({ ...world, session: { userId: U.ALPHA_FINANCE, companyId: CO.ALPHA, signedInAt: `${DAY}T09:30:00+05:30` } });
    state().revalidateCompanyAccess();
    assert.equal(state().session.companyId, null, 'the stale context is dropped');
    assert.equal(state().accessNotice?.reason, 'MEMBERSHIP_REMOVED');
    assert.equal(state().addSaleEntry(alphaSaleDraft()).error, 'No company selected');
    assert.equal(state().addFinance({ date: DAY, kind: 'EXPENSE', amount: 100, category: 'Labour', paymentMethod: 'CASH', handledById: U.ALPHA_FINANCE }).error, 'No company selected');
    assert.equal(state().saleEntries.length, 0);
  });

  it('switching the company off mid-session stops writes; switching it back on resumes them', () => {
    signInAsWorld(U.ALPHA_OWNER);
    useApp.setState({ companies: worldWithCompany(buildWorld(), CO.ALPHA, { active: false }).companies });
    state().revalidateCompanyAccess();
    assert.equal(state().accessNotice?.reason, 'INACTIVE');
    assert.equal(state().session.companyId, null);
    assert.equal(verdict(state().addTrader({ name: 'Dead Company Trader', mobile: '9777777777', openingBalance: 0, active: true })).ok, false);

    // The platform admin works from the platform, where no farm is selected. The notice about
    // the dead company is what later lets revalidate walk the owner back in, so it stays put.
    useApp.setState({ session: { userId: U.PLATFORM, companyId: null, signedInAt: 'x' } });
    assert.equal(state().selectCompany(CO.ALPHA).error, 'Company unavailable');

    state().toggleCompanyActive(CO.ALPHA);
    assert.equal(state().companies.find(c => c.id === CO.ALPHA).active, true);

    useApp.setState({ session: { userId: U.ALPHA_OWNER, companyId: null, signedInAt: 'x' } });
    state().revalidateCompanyAccess();
    assert.equal(state().session.companyId, CO.ALPHA, 'revalidate walks them back into the sole open farm');
    assert.equal(verdict(state().addTrader({ name: 'Live Trader', mobile: '9777777778', openingBalance: 0, active: true })).ok, true);
  });

  it('a context naming a company this browser has never heard of is refused', () => {
    signInAsWorld(U.ALPHA_OWNER, 'co_ghost');
    state().revalidateCompanyAccess();
    assert.equal(state().accessNotice?.reason, 'UNKNOWN_COMPANY');
    assert.equal(state().session.companyId, null);
  });

  it('signing out removes the context that every write depends on', () => {
    signInAsWorld(U.ALPHA_OWNER);
    state().signOut();
    assert.equal(state().session, null);
    assert.equal(state().addEggCollection({ batchId: BT.A1, shedId: SH.A1, date: DAY, goodTrays: 5, brokenTrays: 0, doubleTrays: 0, smallTrays: 0 }).error, 'No company selected');
  });
});

describe('P0 · a companyId supplied by the client cannot widen access', () => {
  it('a voucher is stamped with the session company and person, not with the payload', () => {
    signInAsWorld(U.ALPHA_FINANCE);
    // Fields the draft type does not even carry, pushed in as if the form had sent them.
    const res = state().addSaleEntry({
      ...alphaSaleDraft(),
      companyId: CO.BETA, id: 'se_hijacked', createdBy: U.BETA_OWNER,
      createdAt: '1999-01-01T00:00:00.000Z', synced: false,
    });
    assert.equal(res.ok, true);
    const entry = state().saleEntries.find(e => e.id === res.id);
    assert.equal(entry.companyId, CO.ALPHA);
    assert.notEqual(entry.id, 'se_hijacked', 'the id is minted, never accepted');
    assert.equal(entry.createdBy, U.ALPHA_FINANCE);
    assert.equal(entry.createdAt, '2026-02-15T04:00:00.000Z', 'the timestamp is the store’s clock');
    assert.equal(entry.synced, true, 'sync state is the engine’s business');
    assert.equal(state().saleEntries.find(e => e.id === 'se_hijacked'), undefined);
  });

  it('another farm’s trader and shed are not in this farm’s catalogue', () => {
    signInAsWorld(U.ALPHA_FINANCE);
    assert.equal(state().addSaleEntry(alphaSaleDraft({ traderId: TR.B1 })).error, 'Select the trader this sale is against');
    assert.equal(state().addSaleEntry(alphaSaleDraft({
      lines: [{ shedId: SH.B1, byGrade: { GOOD: 1, BROKEN: 0, DOUBLE: 0, SMALL: 0 } }],
    })).error, 'A shed on this entry does not belong to this company');
    assert.equal(state().saleEntries.length, 0);
  });

  it('the same record id in another farm cannot be read, edited or deleted', () => {
    signInAsWorld(U.ALPHA_FINANCE);
    const alphaEntryId = state().addSaleEntry(alphaSaleDraft()).id;
    const alphaBookingId = buildWorld().eggSaleBookings[0].id;
    const alphaTxnId = buildWorld().traderTxns.find(t => t.companyId === CO.ALPHA).id;
    const alphaFinanceId = buildWorld().finance.find(f => f.companyId === CO.ALPHA && !f.refId).id;
    const alphaTrader = state().traders.find(t => t.id === TR.A1);

    signInAs(U.BETA_OWNER, CO.BETA);
    assert.equal(state().updateSaleEntry(alphaEntryId, alphaSaleDraft()).error, 'Sale entry not found');
    assert.equal(state().deleteSaleEntry(alphaEntryId).error, 'Sale entry not found');
    assert.equal(state().recordSalePayment({ saleId: alphaEntryId, amount: 500, date: DAY, paymentMethod: 'CASH', handledById: U.BETA_OWNER }).ok, false);
    assert.equal(state().updateEggSalePlannerBooking(alphaBookingId, { shedId: SH.B1, date: DAY, traderId: TR.B1, plannedTrays: 5, grade: 'GOOD' }).ok, false);
    assert.equal(state().cancelEggSalePlannerBooking(alphaBookingId, 'cross tenant').ok, false);
    assert.equal(state().fulfillEggSalePlannerBooking(alphaBookingId, alphaEntryId).ok, false);
    assert.equal(state().updateTraderTxn(alphaTxnId, { amount: 1 }, 'cross tenant').error, 'Transaction not found');
    assert.equal(state().updateFinance(alphaFinanceId, { amount: 1 }, 'cross tenant').ok, false);
    assert.equal(state().setBatchFeedIntake(BT.A1, 0.2).ok, false);
    assert.equal(state().closeBatch(BT.A1, { birdsSold: 0, saleAmount: 0, reason: 'cross tenant' }).ok, false);
    assert.equal(state().useMedicine({ medicineId: MED.OXY, date: DAY, qty: 1, reason: 'cross tenant', usedBy: 'Beta Owner', shedId: SH.B1 }).error,
      'Choose the medicine or vaccine in this store');
    assert.equal(state().reviseFeedFormula('ff_test_a1', { name: 'Hijack', shedId: SH.B1, effectiveFrom: DAY, items: [] }).ok, false);
    assert.equal(state().updateEggCollection('eg_test_a1_today', { goodTrays: 999 }).ok, false);
    state().updateTrader(TR.A1, { name: 'Hijacked', phone: '0000000000' });
    assert.equal(state().traders.find(t => t.id === TR.A1).name, alphaTrader.name,
      'a trader patch is matched inside the writer’s own company only');

    // Back at Alpha, without rebuilding the world: these are the rows the attacks touched.
    signInAs(U.ALPHA_FINANCE);
    const after = state();
    assert.equal(after.saleEntries.find(e => e.id === alphaEntryId).companyId, CO.ALPHA);
    assert.equal(after.eggSaleBookings.find(b => b.id === alphaBookingId).status, 'PLANNED');
    assert.equal(after.traderTxns.find(t => t.id === alphaTxnId).amount, 5000);
    assert.equal(after.finance.find(f => f.id === alphaFinanceId).amount, 1000);
    assert.equal(after.batches.find(b => b.id === BT.A1).status, 'ACTIVE');
    assert.equal(after.eggs.find(e => e.id === 'eg_test_a1_today').goodTrays, 80);
    assert.deepEqual(after.traders.find(t => t.id === TR.A1), alphaTrader);
  });

  it("a ledger row cannot be booked onto another farm's trader", () => {
    signInAsWorld(U.ALPHA_FINANCE);
    const before = state().traders.find(t => t.id === TR.A1).outstandingAmount;
    signInAsWorld(U.BETA_OWNER, CO.BETA);
    const res = state().addTraderTxn({
      traderId: TR.A1, date: DAY, kind: 'PAYMENT_IN', amount: 500,
      paymentMethod: 'CASH', handledById: U.BETA_OWNER,
    });
    const row = state().traderTxns.find(t => t.traderId === TR.A1 && t.date === DAY && t.kind === 'PAYMENT_IN');
    assert.equal(row, undefined,
      `Beta must not be able to write onto Alpha's trader; the store accepted ${JSON.stringify(res)}`);
    assert.equal(before, 0);
  });

  it('every record-level patch stops at the writer’s own company', () => {
    signInAsWorld(U.ALPHA_OWNER);
    state().logFeedRound({
      batchId: BT.A1, shedId: SH.A1, date: DAY, round: 'MORNING',
      status: 'GIVEN', at: '08:00', workerName: 'Alpha Labor',
    });
    const alphaRoundId = state().feedRounds.find(r => r.companyId === CO.ALPHA).id;

    // Beta holds the same verbs and no compunction: each call below carries an Alpha id.
    signInAs(U.BETA_OWNER, CO.BETA);
    assert.equal(state().updateMortality('mo_test_a1', { count: 99 }).error, 'Entry not found');
    assert.equal(state().updateEggWastage('ew_test_a1', { reason: 'Other' }).error, 'Entry not found');
    assert.equal(state().updateFeedRound(alphaRoundId, { at: '11:00' }).error, 'Entry not found');
    state().updateFarm(FP.ALPHA, { name: 'Hijacked' });
    state().updateShed(SH.A1, { name: 'Hijacked' });
    state().updateBatch(BT.A1, { code: 'HIJACKED' });
    state().revokeAssignment('ba_test_labor_a1');
    state().updateTask('tk_test_1', { title: 'Hijacked' });
    state().deleteTask('tk_test_1');

    const s = state();
    assert.equal(s.mortality.find(m => m.id === 'mo_test_a1').count, 10);
    assert.equal(s.eggWastages.find(w => w.id === 'ew_test_a1').reason, 'Cracked in handling');
    assert.equal(s.feedRounds.find(r => r.id === alphaRoundId).at, '08:00');
    assert.equal(s.farms.find(f => f.id === FP.ALPHA).name, 'Alpha Farm');
    assert.equal(s.sheds.find(x => x.id === SH.A1).name, 'Shed A1');
    assert.equal(s.batches.find(b => b.id === BT.A1).code, 'A1-01');
    assert.ok(s.assignments.some(a => a.id === 'ba_test_labor_a1'), 'Alpha’s labor keeps his batch');
    assert.equal(s.tasks.find(t => t.id === 'tk_test_1').title, 'Clean the water lines');
  });

  it('the two farms keep separate books for the very same ingredient name', () => {
    signInAsWorld(U.BETA_OWNER, CO.BETA);
    assert.equal(state().addFeedStock({ ingredient: 'Maize', date: DAY, kind: 'FEED_IN', qtyKg: 400, ratePerKg: 50, supplier: 'Beta Feeds' }).ok, true);
    const maize = co => ingredientBalance(state().feedStock.filter(e => e.companyId === co), 'Maize');
    assert.equal(maize(CO.ALPHA), MONEY.MAIZE_BALANCE, 'Alpha’s maize is untouched');
    assert.equal(maize(CO.BETA), 1300);
  });

  it('every row in the world belongs to exactly one company, so no read filter can miss it', () => {
    const world = buildWorld();
    const companyIds = new Set(world.companies.map(c => c.id));
    /** A person holds memberships; every other row is stamped with one company. */
    const owners = (key, row) => (key === 'users' ? row.companyIds : [row.companyId]);
    for (const [key, rows] of Object.entries(world)) {
      if (!Array.isArray(rows) || ['companies', 'ingredientCatalog', 'toasts'].includes(key)) continue;
      for (const row of rows) {
        const held = owners(key, row);
        assert.ok(Array.isArray(held) && held.every(id => companyIds.has(id)),
          `${key} row ${row.id ?? JSON.stringify(row)} points at an unknown company`);
      }
    }
    for (const key of ['sheds', 'batches', 'eggs', 'saleEntries', 'traders', 'traderTxns', 'feedStock',
      'medicineItems', 'medicineStock', 'finance', 'eggSaleBookings', 'eggWastages', 'feedFormulas',
      'vaccinations', 'tasks', 'mortality', 'assignments']) {
      const inAlpha = world[key].filter(r => r.companyId === CO.ALPHA);
      const inBeta = world[key].filter(r => r.companyId === CO.BETA);
      const shared = inAlpha.map(r => r.id).filter(id => inBeta.some(r => r.id === id));
      assert.deepEqual(shared, [], `${key}: a row cannot answer to two farms at once`);
    }
    // A person may belong to both farms; a farm's records may never be shared, so the
    // platform admin is the only account with no membership at all.
    for (const u of world.users) {
      if (u.role === 'MASTER_ADMIN') continue;
      assert.ok(u.companyIds.length > 0, `${u.name} has no company to work in`);
    }
  });
});

describe('P0 · role permissions are enforced in the data layer, not in React', () => {
  /**
   * Each probe is a real write. `key` is the permission the app's own table gates it with,
   * so the expectation comes from `src/lib/permissions.ts` and cannot drift away from it.
   */
  const PROBES = [
    ['createSaleEntries', 'record a sale voucher', s => s.addSaleEntry(alphaSaleDraft())],
    ['createDailyOps', 'log the day’s eggs', s => s.addEggCollection({ batchId: BT.A1, shedId: SH.A1, date: DAY, goodTrays: 5, brokenTrays: 0, doubleTrays: 0, smallTrays: 0 })],
    ['createDailyOps', 'waste a tray', s => s.addEggWastage({ batchId: BT.A1, shedId: SH.A1, date: DAY, byGrade: { GOOD: 0, BROKEN: 1, DOUBLE: 0, SMALL: 0 }, reason: 'Cracked' })],
    ['createDailyOps', 'assign a task', s => s.addTask({ title: 'Matrix task', date: DAY, priority: 'MEDIUM', status: 'PENDING' })],
    ['viewFinance', 'write a ledger row', s => s.addFinance({ date: DAY, kind: 'EXPENSE', amount: 100, category: 'Labour', counterparty: 'Wages', paymentMethod: 'CASH', handledById: U.ALPHA_FINANCE })],
    ['manageTraders', 'add a trader', s => s.addTrader({ name: 'Matrix Trader', mobile: '9444444444', openingBalance: 0, active: true })],
    ['manageTraders', 'book a trader payment', s => s.addTraderTxn({ traderId: TR.A1, date: DAY, kind: 'PAYMENT_IN', amount: 200, paymentMethod: 'CASH', handledById: U.ALPHA_FINANCE })],
    ['create', 'receive medicine stock', s => s.receiveMedicine({ medicineId: MED.OXY, date: DAY, qty: 5, ratePerUnit: 100, supplier: 'Matrix Vet' })],
    ['create', 'record medicine usage', s => s.useMedicine({ medicineId: MED.OXY, date: DAY, qty: 1, reason: 'Dose', usedBy: 'Nurse', shedId: SH.A1, batchId: BT.A1 })],
    ['manageFormulas', 'create a feed formula', s => s.createFeedFormula({ name: 'Matrix mash', shedId: SH.A1, effectiveFrom: DAY, items: [{ ingredient: 'Maize', kgPerTonne: 1000 }] })],
    ['exportReports', 'export the company backup', s => s.exportCompanyBackup()],
    ['manageUsers', 'create a login', s => s.createUser({ name: 'Matrix User', mobile: '9555555555', password: PASSWORD, role: 'FARM_LABOR', companyIds: [CO.ALPHA] })],
  ];

  const PERSON_OF = {
    OWNER: U.ALPHA_OWNER,
    FARM_SUPERVISOR: U.ALPHA_FARM_SUP,
    FINANCIAL_SUPERVISOR: U.ALPHA_FINANCE,
    FARM_MANAGER: U.ALPHA_MANAGER,
    FARM_LABOR: U.ALPHA_LABOR,
    MASTER_ADMIN: U.PLATFORM,
  };

  for (const [role, userId] of Object.entries(PERSON_OF)) {
    for (const [key, name, run] of PROBES) {
      it(`${role}: ${name} follows the permission table (${key})`, () => {
        const world = buildWorld();
        resetApp(world);
        state().signInWithPassword(mobileOf(world, userId), PASSWORD);
        if (role === 'MASTER_ADMIN') state().selectCompany(CO.ALPHA);
        const res = verdict(run(state()));
        const allowed = roleCan(role, key);
        assert.equal(res.ok, allowed,
          `${role} ${allowed ? 'may' : 'may not'} ${name}; the store answered ${JSON.stringify(res).slice(0, 180)}`);
        if (!allowed) {
          // A refusal must be a refusal, not a half write.
          const after = state();
          assert.equal(after.saleEntries.length, 0, 'nothing landed');
          assert.equal(after.eggs.length, world.eggs.length);
          assert.equal(after.finance.length, world.finance.length);
          assert.equal(after.traderTxns.length, world.traderTxns.length);
          assert.equal(after.traders.length, world.traders.length);
          assert.equal(after.users.length, world.users.length);
          assert.equal(after.feedFormulas.length, world.feedFormulas.length);
          assert.equal(after.medicineStock.length, world.medicineStock.length);
        }
      });
    }
  }

  it('an OWNER holds every company-scoped permission, whatever the saved set says', () => {
    for (const key of ['delete', 'closeBatch', 'manageCompanies', 'exportReports', 'viewFinance', 'createSaleEntries']) {
      assert.equal(effectiveCan('OWNER', undefined, key), true);
      assert.equal(effectiveCan('FARM_LABOR', undefined, key), roleCan('FARM_LABOR', key));
    }
    assert.equal(effectiveCan('MASTER_ADMIN', undefined, 'manageCompanies'), true);
    assert.equal(effectiveCan('MASTER_ADMIN', undefined, 'createSaleEntries'), false,
      'platform administration is not farm operation');
  });

  it('a batch assignment is the only per-person grant, and it is the store that reads it', () => {
    const s = signInAsWorld(U.ALPHA_LABOR);
    assert.equal(s.canManageFormula(SH.A1), false, 'the seeded grant is daily ops, not formulas');
    signInAsWorld(U.ALPHA_FARM_SUP);
    assert.equal(state().canManageFormula(SH.A1), true, 'FARM_SUPERVISOR holds manageFormulas');
  });

  it('money is not writable by the operational roles', () => {
    for (const userId of [U.ALPHA_FARM_SUP, U.ALPHA_MANAGER, U.ALPHA_LABOR]) {
      signInAsWorld(userId);
      assert.equal(verdict(state().addFinance({ date: DAY, kind: 'EXPENSE', amount: 100, category: 'Labour', paymentMethod: 'CASH', handledById: userId })).ok, false);
      assert.equal(verdict(state().addTrader({ name: 'Nope', mobile: '9666666666', openingBalance: 0, active: true })).ok, false);
      assert.equal(state().finance.length, 4);
      assert.equal(state().traders.length, 3);
    }
  });
});

describe('P0 · the day-lock is gone and stays gone', () => {
  it('an earlier day is still open to the roles that own it', () => {
    const s = signInAsWorld(U.ALPHA_OWNER);
    assert.equal(s.addEggCollection({ batchId: BT.A1, shedId: SH.A1, date: YESTERDAY, goodTrays: 7, brokenTrays: 0, doubleTrays: 0, smallTrays: 0 }).ok, true);
    assert.equal(s.updateEggCollection('eg_test_a1_yday', { goodTrays: 101 }).ok, true);
    assert.equal(s.addFinance({ date: YESTERDAY, kind: 'EXPENSE', amount: 250, category: 'Labour', counterparty: 'Wages', paymentMethod: 'CASH', handledById: U.ALPHA_OWNER }).ok, true);
    const minted = s.addSaleEntry(alphaSaleDraft({ date: YESTERDAY }));
    assert.equal(minted.ok, true);
    assert.equal(s.updateSaleEntry(minted.id, alphaSaleDraft({ date: YESTERDAY, laborCharge: 600 })).ok, true);
    assert.equal(s.deleteSaleEntry(minted.id).ok, true);
  });

  it('no write path mentions a lock any more', () => {
    const s = signInAsWorld(U.ALPHA_OWNER);
    const verdicts = [
      s.addEggCollection({ batchId: BT.A1, shedId: SH.A1, date: '2026-01-04', goodTrays: 3, brokenTrays: 0, doubleTrays: 0, smallTrays: 0 }),
      s.addEggWastage({ batchId: BT.A1, shedId: SH.A1, date: '2026-01-04', byGrade: { GOOD: 0, BROKEN: 1, DOUBLE: 0, SMALL: 0 }, reason: 'Old day' }),
      s.addSaleEntry(alphaSaleDraft({ date: '2026-01-04' })),
      s.updateEggWastage('ew_test_a1', { reason: 'Still editable' }),
      s.addFeedConsumption({ batchId: BT.A1, shedId: SH.A1, date: '2026-01-04', tonnes: 0.1 }),
    ];
    for (const v of verdicts) assert.doesNotMatch(JSON.stringify(v), /lock/i);
  });
});
