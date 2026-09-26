/**
 * tests/p0-user-management.test.mjs — the Owner Users flow migration 015 exists for.
 *
 * 015 gives a company owner one write in the database (`public.set_person_access`) and makes a
 * switched-off account have no identity there. This file proves the half above that wire: the
 * screen's gate, the store's verdict, the audit trail the store keeps, and — in cloud mode —
 * the exact call the app puts on the wire and what it does when the database says no.
 *
 * The database's own answers are proved separately, against real Postgres RLS, by
 * `db/verify015.mjs`. A fake client here proves the client keeps its side of the deal; it is
 * not evidence about RLS.
 *
 * Run with: npm test
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { GROUPS, allowed, itemVisible } from '@/components/layout/nav';
import { MANAGEABLE_ROLES, buildTeam, personBlock } from '@/lib/team';
import { runtime } from '@/lib/runtime';
import { useApp } from '@/store/app';
import { dataService } from '@/services/dataService';
import { installClient, createFakeClient, resetClient, requestLog } from './harness/supabase-stub.mjs';
import {
  CO, U, PASSWORD, buildWorld, resetApp, worldAs, worldWithUser, mobileOf, signInAs,
} from './harness/fixtures.ts';

const state = () => useApp.getState();
const owner = () => resetApp(worldAs(U.ALPHA_OWNER, CO.ALPHA));
const person = id => state().users.find(u => u.id === id);
const lastAudit = () => state().audit.find(a => a.entity === 'User');

/** The navigation entry the app shows for `/users`, found the way the sidebar finds it. */
const usersItem = () => {
  for (const g of GROUPS) {
    const item = g.items.find(i => i.to === '/users');
    if (item) return { group: g, item };
  }
  return null;
};

describe('P0 · who the app lets near the Users screen', () => {
  for (const [userId, role] of [
    [U.ALPHA_OWNER, 'OWNER'], [U.BETA_OWNER, 'OWNER'], [U.PLATFORM, 'MASTER_ADMIN'],
  ]) {
    it(`${role} on ${userId}: Users is in the navigation`, () => {
      const { group, item } = usersItem();
      assert.equal(allowed(group, role) && itemVisible(item, role), true);
    });
  }

  for (const role of ['FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR']) {
    it(`${role}: Users is not offered, and the route guard asks the same permission`, () => {
      const { group, item } = usersItem();
      assert.equal(allowed(group, role) && itemVisible(item, role), false,
        'a hidden menu is only half a gate; the store and RLS carry the rest');
      assert.equal(item.permission, 'manageUsers', '/users is guarded by the permission, not a role list');
    });
  }

  it('a labor who types the address still cannot change anybody', async () => {
    resetApp(worldAs(U.ALPHA_LABOR, CO.ALPHA));
    assert.equal(person(U.ALPHA_MANAGER).role, 'FARM_MANAGER');
    assert.equal((await dataService.users.updateRole(U.ALPHA_MANAGER, 'FARM_LABOR')).ok, false);
    assert.equal(state().users.find(u => u.id === U.ALPHA_MANAGER).role, 'FARM_MANAGER');
    assert.equal(state().audit.filter(a => a.entity === 'User').length, 0);
  });
});

describe('P0 · an owner changes the people of their own company', () => {
  it('a role change is one store write, and it is audited', async () => {
    owner();
    const res = await dataService.users.updateRole(U.ALPHA_LABOR, 'FARM_MANAGER');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(person(U.ALPHA_LABOR).role, 'FARM_MANAGER');
    const a = lastAudit();
    assert.deepEqual(
      { entity: a.entity, action: a.action, field: a.field, oldValue: a.oldValue, newValue: a.newValue, byUserId: a.byUserId, companyId: a.companyId },
      { entity: 'User', action: 'UPDATE', field: 'role', oldValue: 'FARM_LABOR', newValue: 'FARM_MANAGER', byUserId: U.ALPHA_OWNER, companyId: CO.ALPHA },
    );
    assert.match(a.reason, new RegExp(buildWorld().companies.find(c => c.id === CO.ALPHA).name),
      'the audit says which company it happened in');
  });

  it('every operational role an owner may hand out actually hands out', async () => {
    for (const role of MANAGEABLE_ROLES) {
      owner();
      assert.equal((await dataService.users.updateRole(U.ALPHA_LABOR, role)).ok, true, role);
      assert.equal(person(U.ALPHA_LABOR).role, role);
    }
    assert.deepEqual([...MANAGEABLE_ROLES], ['FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR']);
  });

  it('deactivating and reactivating both hold, and neither touches a person’s history', async () => {
    const world = owner();
    const before = state().audit.length;
    assert.equal((await dataService.users.setActive(U.ALPHA_LABOR, false)).ok, true);
    assert.equal(person(U.ALPHA_LABOR).active, false);
    assert.equal(lastAudit().field, 'active');
    assert.equal(lastAudit().newValue, false);

    assert.equal((await dataService.users.setActive(U.ALPHA_LABOR, true)).ok, true);
    assert.equal(person(U.ALPHA_LABOR).active, true);
    // Two switches, two audit rows, and nothing else about the world moved.
    assert.equal(state().audit.length, before + 2);
    assert.deepEqual(state().eggs, world.eggs, 'a person’s work stays where it was');
    assert.deepEqual(state().mortality, world.mortality);
    assert.deepEqual(state().finance, world.finance);
  });

  it('a switched-off person cannot sign back in until an owner switches them on', () => {
    const world = buildWorld();
    resetApp(world);
    const ownerMobile = mobileOf(world, U.ALPHA_OWNER);
    const laborMobile = mobileOf(world, U.ALPHA_LABOR);
    assert.equal(state().signInWithPassword(ownerMobile, PASSWORD).ok, true);
    state().setUserActive(U.ALPHA_LABOR, false);
    state().signOut();

    assert.equal(state().signInWithPassword(laborMobile, PASSWORD).error, 'This account is deactivated');
    assert.equal(state().session, null);

    assert.equal(state().signInWithPassword(ownerMobile, PASSWORD).ok, true);
    state().setUserActive(U.ALPHA_LABOR, true);
    state().signOut();
    assert.equal(state().signInWithPassword(laborMobile, PASSWORD).ok, true);
    assert.equal(state().session.userId, U.ALPHA_LABOR);
  });

  it('the roster still shows a switched-off person, marked and still reachable by an owner', () => {
    const world = worldWithUser(buildWorld(), U.ALPHA_LABOR, { active: false });
    signInAs(U.ALPHA_OWNER, CO.ALPHA);
    useApp.setState({ ...world, session: state().session });
    const rows = buildTeam({ ...state(), companyId: CO.ALPHA, caller: person(U.ALPHA_OWNER), platform: false });
    const off = rows.find(r => r.user.id === U.ALPHA_LABOR);
    assert.equal(off.user.active, false, 'visible: an owner has to be able to switch them back on');
    assert.equal(off.manageable, true);
    assert.equal(rows.find(r => r.user.id === U.ALPHA_OWNER).manageable, false,
      'the owner sees their own row, but it is not theirs to change');
  });
});

describe('P0 · what an owner may never reach, whatever the screen offers', () => {
  it('their own account', async () => {
    owner();
    for (const res of [
      await dataService.users.updateRole(U.ALPHA_OWNER, 'FARM_LABOR'),
      await dataService.users.setActive(U.ALPHA_OWNER, false),
    ]) {
      assert.equal(res.ok, false);
      assert.match(res.error, /your own account/i);
    }
    assert.equal(person(U.ALPHA_OWNER).role, 'OWNER');
    assert.equal(person(U.ALPHA_OWNER).active, true);
  });

  it('ownership, and the platform', async () => {
    owner();
    /** Two different refusals: an owner is simply not on the list, a platform account is somebody
     *  else's to touch. Both come from `src/store/app.ts`, quoted so a silent widening shows up. */
    const SAY = { OWNER: /operational role/i, MASTER_ADMIN: /platform admin/i };
    for (const role of ['OWNER', 'MASTER_ADMIN']) {
      const res = await dataService.users.updateRole(U.ALPHA_LABOR, role);
      assert.equal(res.ok, false, role);
      assert.match(res.error, SAY[role]);
      assert.equal(person(U.ALPHA_LABOR).role, 'FARM_LABOR');
    }
    const platform = resetApp(worldWithUser(buildWorld(), U.PLATFORM, { companyIds: [CO.ALPHA] }));
    resetApp(worldAs(U.ALPHA_OWNER, CO.ALPHA, { users: platform.users }));
    const res = await dataService.users.updateRole(U.PLATFORM, 'FARM_LABOR');
    assert.equal(res.ok, false);
    assert.match(res.error, /platform/i);
  });

  it('another company’s person — by id, by their company, or by nobody’s', async () => {
    owner();
    const byId = await dataService.users.updateRole(U.BETA_OWNER, 'FARM_LABOR');
    assert.equal(byId.ok, false);
    assert.equal(byId.error, 'This user does not belong to the company you are working in');
    assert.equal((await dataService.users.setActive(U.BETA_OWNER, false)).ok, false);
    assert.equal(person(U.BETA_OWNER).active, true);

    // Beta's owner gets the same answer about Alpha's labor.
    resetApp(worldAs(U.BETA_OWNER, CO.BETA));
    assert.equal((await dataService.users.updateRole(U.ALPHA_LABOR, 'FARM_MANAGER')).ok, false);
    assert.equal(person(U.ALPHA_LABOR).role, 'FARM_LABOR');
    assert.equal(state().audit.filter(a => a.entity === 'User').length, 0, 'a refusal writes no trail');
  });

  it('a person who belongs to two companies is the platform’s to change', async () => {
    owner();
    const shared = person(U.BOTH_OWNER);
    assert.equal(shared.companyIds.length, 2);
    const res = await dataService.users.updateRole(U.BOTH_OWNER, 'FARM_LABOR');
    assert.equal(res.ok, false);
    assert.equal(res.error, personBlock(shared, person(U.ALPHA_OWNER), false));
    assert.match(res.error, /more than one company/i);
    assert.equal(person(U.BOTH_OWNER).role, 'OWNER');
  });

  it('a person this browser has never heard of', async () => {
    owner();
    assert.equal((await dataService.users.updateRole('u_ghost', 'FARM_LABOR')).error, 'User not found');
    assert.equal((await dataService.users.setActive('u_ghost', false)).error, 'User not found');
  });

  it('the platform admin works everywhere, including on an owner', async () => {
    const world = buildWorld();
    resetApp(world);
    state().signInWithPassword(mobileOf(world, U.PLATFORM), PASSWORD);
    state().selectCompany(CO.ALPHA);
    assert.equal((await dataService.users.updateRole(U.ALPHA_FINANCE, 'FARM_LABOR')).ok, true,
      'a platform session pushes profiles itself, so no RPC is expected on the wire');
    assert.equal(person(U.ALPHA_FINANCE).role, 'FARM_LABOR');
    assert.equal(requestLog().filter(r => r.method === 'rpc').length, 0);
  });

  it('the platform roster’s own switch still refuses the account it is signed in with', () => {
    const world = buildWorld();
    resetApp(world);
    state().signInWithPassword(mobileOf(world, U.PLATFORM), PASSWORD);
    // The Platform screen writes through `toggleUserActive` rather than the owner's guarded
    // seam, so the self-rule has to hold on that door too: under 015 a deactivated profile has
    // no identity at all, and this click would leave the session reading an empty database.
    const res = state().toggleUserActive(U.PLATFORM);
    assert.equal(res.ok, false);
    assert.match(res.error, /signed in with/i);
    assert.equal(person(U.PLATFORM).active, true);

    // Somebody else is still the platform's to switch off, and back on.
    assert.equal(state().toggleUserActive(U.ALPHA_LABOR).ok, true);
    assert.equal(person(U.ALPHA_LABOR).active, false);
    assert.equal(state().toggleUserActive(U.ALPHA_LABOR).ok, true);
    assert.equal(person(U.ALPHA_LABOR).active, true);
  });
});

describe('P0 · in cloud mode the owner’s edit goes through set_person_access, and only then', () => {
  /** Answer the RPC as the database would; `refuse` carries RLS's own sentence. */
  function cloud(refuse = null) {
    const seen = [];
    installClient(createFakeClient({
      respond: {
        'rpc:set_person_access': req => {
          seen.push(req.args);
          return refuse ? { data: null, error: refuse } : { data: null, error: null };
        },
      },
    }));
    runtime.cloud = true;
    return seen;
  }
  afterEach(() => { resetClient(); runtime.cloud = false; });

  it('a role change is one call, carrying the session’s company rather than an invented one', async () => {
    owner();
    const seen = cloud();
    assert.equal((await dataService.users.updateRole(U.ALPHA_LABOR, 'FARM_MANAGER')).ok, true);
    assert.deepEqual(seen, [{ p_user: U.ALPHA_LABOR, p_company: CO.ALPHA, p_role: 'FARM_MANAGER', p_active: null }]);
    assert.equal(person(U.ALPHA_LABOR).role, 'FARM_MANAGER');
  });

  it('a status change is the same call with the other half filled in', async () => {
    owner();
    const seen = cloud();
    assert.equal((await dataService.users.setActive(U.ALPHA_LABOR, false)).ok, true);
    assert.deepEqual(seen, [{ p_user: U.ALPHA_LABOR, p_company: CO.ALPHA, p_role: null, p_active: false }]);
    assert.equal(person(U.ALPHA_LABOR).active, false);
  });

  it('when the database refuses, the browser does not remember the change', async () => {
    owner();
    cloud({ code: '42501', message: 'You cannot manage users in this company' });
    const res = await dataService.users.updateRole(U.ALPHA_LABOR, 'FARM_MANAGER');
    assert.equal(res.ok, false);
    assert.equal(person(U.ALPHA_LABOR).role, 'FARM_LABOR',
      'an RLS refusal must not sit in localStorage as a fact that syncs back later');
    assert.equal(state().audit.filter(a => a.entity === 'User').length, 0, 'nor be audited as if it had happened');
    assert.doesNotMatch(res.error, /42501|SQLSTATE|relation|permission denied/i,
      'the person sees a sentence, not the database’s');
  });

  it('a call that never went out is not a change that was refused', async () => {
    owner();
    cloud({ code: 'NETWORK', message: 'fetch failed: connection refused' });
    const res = await dataService.users.updateRole(U.ALPHA_LABOR, 'FARM_MANAGER');
    assert.equal(res.ok, false);
    assert.equal(person(U.ALPHA_LABOR).role, 'FARM_LABOR');
  });

  it('the store’s own gate is checked before the network is used', async () => {
    resetApp(worldAs(U.ALPHA_LABOR, CO.ALPHA));
    const seen = cloud();
    assert.equal((await dataService.users.updateRole(U.ALPHA_MANAGER, 'FARM_LABOR')).ok, false);
    assert.deepEqual(seen, [], 'a refusal costs no request');
    assert.equal(requestLog().length, 0);
  });
});
