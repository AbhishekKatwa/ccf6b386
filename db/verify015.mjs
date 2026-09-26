/**
 * Proves 015: a company OWNER can change a person of their own company and nobody else's, can
 * switch an account off in a way the database then honours, and cannot reach the two things that
 * would break the model — their own access, and a platform account.
 *
 * Every statement runs as `authenticated` with a forged JWT claim set inside a transaction, which
 * is the same path PostgREST takes. The seed rows live under the synthetic companies 'ca'/'cb'
 * and are removed at the end.
 *
 *   node --env-file=.env db/verify015.mjs --dry    # apply 015 inside a transaction, then probe
 *   node --env-file=.env db/verify015.mjs          # probe the database as it stands
 *
 * `--dry` is how the migration is proved before it is applied: 015's DDL runs, the probes run
 * against it, and the whole transaction is rolled back so the live schema never changes.
 * Without the flag the same probes read the current database — run them before 015 and the RPC
 * does not exist at all, run them after and this is the proof.
 *
 * Two probe shapes, and the difference is the point: `rpc` rolls its statement back, so a refusal
 * is checked without touching anything, while `set` keeps the change for the probes that follow —
 * a deactivation the next statement cannot see would prove nothing. The order matters too: a step
 * down is a real write, so every section that acts as an OWNER runs before the one that leaves
 * somebody demoted.
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const DRY = process.argv.includes('--dry');
const MIGRATION = new URL('./supabase/015_owner_user_management.sql', import.meta.url);

const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const c = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: { rejectUnauthorized: false },
});
await c.connect();

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const uuid = n => `00000000-0000-0000-0002-${String(n).padStart(12, '0')}`;
const day = new Date().toISOString().slice(0, 10);
// One of each kind of person the Users screen can put in front of an owner.
const [OA, O2, LB, OB, SH, PL, MA] = [1, 2, 3, 4, 5, 6, 7].map(uuid);

async function seed() {
  const q = sql => c.query(sql);
  await q(`insert into companies (id,name,active) values ('ca','Farm A',true), ('cb','Farm B',true)`);
  for (const [id, name, mobile, role] of [
    [OA, 'A Owner', '9000000201', 'OWNER'],
    [O2, 'A Owner Two', '9000000202', 'OWNER'],
    [LB, 'A Labor', '9000000203', 'FARM_LABOR'],
    [OB, 'B Owner', '9000000204', 'OWNER'],
    [SH, 'Shared Manager', '9000000205', 'FARM_MANAGER'],   // in both farms
    [PL, 'Platform Admin', '9000000206', 'MASTER_ADMIN'],
    [MA, 'Another Platform', '9000000207', 'MASTER_ADMIN'],
  ]) {
    await q(`insert into auth.users (id, email) values ('${id}', '${mobile}@example.test') on conflict do nothing`);
    // app.profiles_is_append() (010) is a BEFORE INSERT guard on the platform role and answers to
    // the JWT's subject, which a seed run under the migration role has none of. The guard is for
    // API callers; promoting afterwards is the only way to have a platform account to probe with.
    await q(`insert into profiles (id, legacy_id, name, mobile, role)
             values ('${id}','v15_${mobile}','${name}','${mobile}',
                     '${role === 'MASTER_ADMIN' ? 'FARM_MANAGER' : role}')`);
  }
  await q(`update profiles set role = 'MASTER_ADMIN' where id in ('${PL}','${MA}')`);
  await q(`insert into company_users values
             ('${OA}','ca','OWNER'), ('${O2}','ca','OWNER'), ('${LB}','ca','FARM_LABOR'),
             ('${OB}','cb','OWNER'), ('${SH}','ca','FARM_MANAGER'), ('${SH}','cb','FARM_MANAGER')`);
  await q(`insert into farms (id,company_id,name) values ('fa','ca','A farm'), ('fb','cb','B farm')`);
  await q(`insert into sheds (id,company_id,farm_id,name,capacity) values ('sa','ca','fa','A-shed',1000)`);
  await q(`insert into batches (id,company_id,farm_id,shed_id,code,bird_type,placement_date,start_date,initial_birds)
           values ('ba','ca','fa','sa','A1','LAYER','2026-01-01','2026-01-01',100)`);
  await q(`insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('ma','ca','ba','sa','${day}',5)`);
}

/**
 * One statement as a signed-in role. `keep` decides whether the statement's own effect survives
 * it, and the role and claim are put back either way: under --dry the outer transaction is still
 * open afterwards, and a session left acting as somebody else would be a probe of the wrong
 * identity for everything that followed.
 */
async function run(userId, sql, keep) {
  if (DRY) await c.query(keep ? 'savepoint act' : 'savepoint probe');
  else await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
  await c.query('set local role authenticated');
  try {
    const r = await c.query(sql);
    await c.query('reset role');
    await c.query(`select set_config('request.jwt.claims', '', true)`);
    if (DRY) await c.query(keep ? 'release savepoint act' : 'rollback to savepoint probe');
    else await c.query('commit');
    return { rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query(DRY ? (keep ? 'rollback to savepoint act' : 'rollback to savepoint probe') : 'rollback');
    return { error: e.message };
  }
}
const as = (userId, sql) => run(userId, sql, false);
const act = (userId, sql) => run(userId, sql, true);

const call = (target, company, extra = {}) =>
  `select public.set_person_access('${target}'::uuid, '${company}'`
  + `${'role' in extra ? `, '${extra.role}'` : ', null'}`
  + `${'active' in extra ? `, ${extra.active}` : ', null'})`;
/** A refusal: asked for, checked, and rolled back — a denied call must leave nothing behind. */
const rpc = (userId, target, company, extra = {}) => as(userId, call(target, company, extra));
/** A change that has to stand, because the next probe is the proof of it. */
const set = (userId, target, company, extra = {}) => act(userId, call(target, company, extra));

const denied = r => r.error !== undefined;
const done = r => r.error === undefined;
const n = async (userId, table, where = '') => {
  const r = await as(userId, `select count(*)::int n from ${table}${where ? ` where ${where}` : ''}`);
  return r.rows?.[0]?.n ?? `ERR ${r.error}`;
};
/** Read one column of one row, as one of the roles (so the read is inside RLS too). */
const field = async (userId, table, where, col) =>
  (await as(userId, `select ${col} v from ${table} where ${where}`)).rows?.[0]?.v;
/** A write every member may do — the smallest one that touches no company data. */
const memberWrite = who => as(who, `insert into audit (id,company_id,entity,entity_id,action)
  values ('au15','ca','User','x','CREATE')`);

async function cleanup() {
  await c.query(`delete from companies where id in ('ca','cb')`);   // children cascade from here
  await c.query(`delete from profiles where id in ('${OA}','${O2}','${LB}','${OB}','${SH}','${PL}','${MA}')`);
  await c.query(`delete from auth.users where id in ('${OA}','${O2}','${LB}','${OB}','${SH}','${PL}','${MA}')`);
}

try {
  await cleanup();
  if (DRY) {
    await c.query('begin');
    await c.query(await readFile(MIGRATION, 'utf8'));
    console.log('\n015 applied inside this transaction — nothing below it is committed');
  }
  await seed();

  console.log('\nthe roster is the company, seen from inside RLS');
  ok('A\'s owner lists A\'s people', (await n(OA, 'profiles', `id in ('${OA}','${O2}','${LB}')`)) === 3);
  ok('…and nothing of B', (await n(OA, 'profiles', `id='${OB}'`)) === 0);
  ok('…no membership row of B either', (await n(OA, 'company_users', `company_id='cb'`)) === 0);
  ok('a labor reads the same directory they may not change',
    (await n(LB, 'profiles', `id='${OA}'`)) === 1);

  console.log('\ncompany isolation on the write path');
  ok('cannot change another company\'s person', denied(await rpc(OA, OB, 'ca', { role: 'FARM_LABOR' })));
  ok('…nor by naming their company instead', denied(await rpc(OA, OB, 'cb', { role: 'FARM_LABOR' })));
  ok('B\'s owner cannot change A\'s labor', denied(await rpc(OB, LB, 'cb', { role: 'FARM_LABOR' })));
  ok('…nor reach it by naming A', denied(await rpc(OB, LB, 'ca', { role: 'FARM_LABOR' })));
  ok('a person shared with a company the caller does not manage is the platform\'s',
    denied(await rpc(OA, SH, 'ca', { role: 'FARM_LABOR' })));
  ok('nothing half-happened to the shared manager',
    (await field(MA, 'profiles', `id='${SH}'`, 'role')) === 'FARM_MANAGER'
    && (await field(MA, 'company_users', `user_id='${SH}' and company_id='cb'`, 'role')) === 'FARM_MANAGER');

  console.log('\nwhat a company owner may never reach');
  ok('their own access', denied(await rpc(OA, OA, 'ca', { active: false })));
  ok('…nor their own role', denied(await rpc(OA, OA, 'ca', { role: 'FARM_LABOR' })));
  ok('a promotion to OWNER', denied(await rpc(OA, LB, 'ca', { role: 'OWNER' })));
  ok('a promotion to MASTER_ADMIN', denied(await rpc(OA, LB, 'ca', { role: 'MASTER_ADMIN' })));
  ok('a platform account', denied(await rpc(OA, PL, 'ca', { active: false })));
  ok('an unknown person', denied(await rpc(OA, uuid(99), 'ca', { active: false })));
  ok('an unknown company', denied(await rpc(OA, LB, 'zz', { role: 'FARM_LABOR' })));
  ok('a labor has no door to knock on', denied(await rpc(LB, OA, 'ca', { role: 'FARM_LABOR' })));
  ok('…and no narrower one: not even their own status', denied(await rpc(LB, LB, 'ca', { active: true })));
  ok('a role nobody could work with is refused outright', denied(await rpc(OA, LB, 'ca', { role: 'CEO' })));
  ok('…and asking for nothing changes nothing',
    done(await rpc(OA, LB, 'ca')) && (await field(OA, 'profiles', `id='${LB}'`, 'role')) === 'FARM_LABOR');

  console.log('\nwhat a company owner may do, to their own people');
  ok('change a role', done(await set(OA, LB, 'ca', { role: 'FARM_MANAGER' })));
  ok('…on the profile', (await field(OA, 'profiles', `id='${LB}'`, 'role')) === 'FARM_MANAGER');
  ok('…and on that company\'s membership, which is what app.role_can answers from',
    (await field(OA, 'company_users', `user_id='${LB}' and company_id='ca'`, 'role')) === 'FARM_MANAGER');
  ok('the new role is the one that takes effect: no people writes for a manager either',
    denied(await rpc(LB, OA, 'ca', { role: 'FARM_LABOR' })));
  ok('switch an account off', done(await set(OA, LB, 'ca', { active: false })));
  ok('…and back on', done(await set(OA, LB, 'ca', { active: true })));
  ok('another owner of the same company can too', done(await set(O2, LB, 'ca', { active: false })));
  ok('…and their change is the one the first owner sees',
    (await field(OA, 'profiles', `id='${LB}'`, 'active')) === false);
  ok('a second owner can step a colleague down', done(await set(OA, O2, 'ca', { role: 'FARM_SUPERVISOR' })));
  ok('…and that role holds no manageUsers, so the door closes behind them',
    denied(await rpc(O2, LB, 'ca', { active: true })));
  await set(OA, LB, 'ca', { role: 'FARM_LABOR', active: true });   // back where the next section starts

  console.log('\ndeactivation is a database fact, not a screen condition');
  await set(OA, LB, 'ca', { active: false });
  ok('they read no flock', (await n(LB, 'mortality', `company_id='ca'`)) === 0);
  ok('they write nothing', denied(await memberWrite(LB)));
  ok('they have no membership', (await n(LB, 'company_users', `user_id='${LB}'`)) === 0);
  ok('they are not even themselves', (await n(LB, 'profiles', `id='${LB}'`)) === 0);
  ok('they cannot switch themselves back on', denied(await rpc(LB, LB, 'ca', { active: true })));
  ok('…and an active person still writes fine (the control)', done(await memberWrite(OA)));
  ok('their history stands as it was', (await field(OA, 'mortality', `id='ma'`, 'count')) === 5);
  ok('their colleagues still list them', (await n(OA, 'profiles', `id='${LB}'`)) === 1);
  ok('…as switched off', (await field(OA, 'profiles', `id='${LB}'`, 'active')) === false);
  ok('their membership row survives', (await n(MA, 'company_users', `user_id='${LB}'`)) === 1);
  ok('their login survives', (await c.query(`select 1 from auth.users where id='${LB}'`)).rowCount === 1);
  ok('another owner switches them back on', done(await set(OA, LB, 'ca', { active: true })));
  ok('…and the flock reads again', (await n(LB, 'mortality', `company_id='ca'`)) === 1);
  ok('…and a write lands', done(await memberWrite(LB)));

  console.log('\nthe platform admin is untouched by these gates');
  ok('changes a shared person', done(await set(PL, SH, 'cb', { role: 'FARM_LABOR' })));
  ok('…in the company named, leaving the other membership',
    (await field(MA, 'company_users', `user_id='${SH}' and company_id='cb'`, 'role')) === 'FARM_LABOR'
    && (await field(MA, 'company_users', `user_id='${SH}' and company_id='ca'`, 'role')) === 'FARM_MANAGER');
  ok('can make an owner', done(await set(PL, LB, 'ca', { role: 'OWNER' })));
  ok('can switch a platform account off, membership or none',
    done(await set(MA, PL, 'ca', { active: false })));
  ok('…but not their own', denied(await rpc(MA, MA, 'ca', { active: false })));
  await c.query(`update profiles set active = true where id = '${PL}'`);
  ok('and a platform admin restored can act again', done(await set(PL, LB, 'ca', { active: true })));
} finally {
  if (DRY) {
    await c.query('rollback');
    console.log('\nrolled back: the live schema and data are untouched');
  } else {
    await cleanup();
    console.log('\ncleaned up');
  }
}

console.log(fails ? `\n${fails} user-management problem(s)` : '\nOwner user management holds in RLS');
await c.end();
process.exit(fails ? 1 : 0);
