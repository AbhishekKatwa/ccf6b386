/**
 * Proves the company lifecycle is a database fact, not a screen condition: with one company
 * switched off, its own members — including its Owner — read nothing, write nothing, and are
 * still listed as members so reactivation returns them to the same farm.
 *
 * Every statement below runs as `authenticated` with a forged JWT claim set inside a
 * transaction that is rolled back, which is the same path PostgREST takes. The seed rows live
 * under the synthetic companies 'ca'/'cb' and are removed at the end.
 *
 *   node --env-file=.env db/verify013.mjs --dry    # apply 013 inside a transaction, then probe
 *   node --env-file=.env db/verify013.mjs          # probe the database as it stands
 *
 * `--dry` is how the migration is proved before it is applied: 013's DDL runs, the probes run
 * against it, and the whole transaction is rolled back, so the live schema never changes.
 * Without the flag the same probes read the current database — run them before 013 and the
 * inactive block fails (that is the gap), run them after and it is the proof.
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const DRY = process.argv.includes('--dry');
const MIGRATION = new URL('./supabase/013_company_lifecycle.sql', import.meta.url);

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

const uuid = n => `00000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
const day = new Date().toISOString().slice(0, 10);
const [OA, LA, MA, OB] = [uuid(1), uuid(2), uuid(3), uuid(4)];

async function seed() {
  const q = sql => c.query(sql);
  await q(`insert into companies (id,name,active) values ('ca','Farm A',true), ('cb','Farm B',true)`);
  for (const [id, name, role, mobile] of [
    [OA, 'A Owner', 'OWNER', '9000000101'],
    [LA, 'A Labor', 'FARM_LABOR', '9000000102'],
    [MA, 'Platform', 'FARM_LABOR', '9000000103'],   // promoted below, past the insert guard
    [OB, 'B Owner', 'OWNER', '9000000104'],
  ]) {
    await q(`insert into auth.users (id, email) values ('${id}', '${mobile}@example.test') on conflict do nothing`);
    await q(`insert into profiles (id, legacy_id, name, mobile, role)
             values ('${id}','v13_${mobile}','${name}','${mobile}','${role}')`);
  }
  // app.profiles_is_append() (010) is a BEFORE INSERT guard on the platform role and answers to
  // the JWT's subject, which a seed run under the migration role has none of. The guard is for
  // API callers; promoting afterwards is the same fact this script needs a row for.
  await q(`update profiles set role = 'MASTER_ADMIN' where id = '${MA}'`);
  await q(`insert into company_users values ('${OA}','ca','OWNER'), ('${LA}','ca','FARM_LABOR'), ('${OB}','cb','OWNER')`);
  await q(`insert into farms (id,company_id,name) values ('fa','ca','A farm'), ('fb','cb','B farm')`);
  await q(`insert into sheds (id,company_id,farm_id,name,capacity) values ('sa','ca','fa','A-shed',1000)`);
  await q(`insert into batches (id,company_id,farm_id,shed_id,code,bird_type,placement_date,start_date,initial_birds)
           values ('ba','ca','fa','sa','A1','LAYER','2026-01-01','2026-01-01',100)`);
  await q(`insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('ma','ca','ba','sa','${day}',5)`);
  await q(`insert into egg_collections (id,company_id,batch_id,shed_id,date,good_trays) values ('ea','ca','ba','sa','${day}',40)`);
  await q(`insert into feed_stock (id,company_id,ingredient,date,kind,qty_kg) values ('fsa','ca','Maize','${day}','FEED_IN',1000)`);
  await q(`insert into traders (id,company_id,name,opening_balance) values ('tra','ca','A trader',0)`);
  await q(`insert into finance_txns (id,company_id,date,kind,amount,category) values ('fta','ca','${day}','EXPENSE',50,'Salaries')`);
}

/** One statement as a signed-in role, always rolled back. */
async function as(userId, sql) {
  await c.query(DRY ? 'savepoint probe' : 'begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
  await c.query('set local role authenticated');
  try {
    const r = await c.query(sql);
    await c.query(DRY ? 'rollback to savepoint probe' : 'rollback');
    return { rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query(DRY ? 'rollback to savepoint probe' : 'rollback');
    return { error: e.message };
  }
}
const n = async (userId, table, where = '') => {
  const r = await as(userId, `select count(*)::int n from ${table}${where ? ` where ${where}` : ''}`);
  return r.rows?.[0]?.n ?? `ERR ${r.error}`;
};
const setActive = v => c.query(`update companies set active = $1 where id = 'ca'`, [v]);

async function cleanup() {
  await c.query(`delete from companies where id in ('ca','cb')`);   // children cascade from here
  await c.query(`delete from profiles where id in ('${OA}','${LA}','${MA}','${OB}')`);
  await c.query(`delete from auth.users where id in ('${OA}','${LA}','${MA}','${OB}')`);
}

try {
  await cleanup();
  if (DRY) {
    await c.query('begin');
    await c.query(await readFile(MIGRATION, 'utf8'));
    console.log('\n013 applied inside this transaction — nothing below it is committed');
  }
  await seed();

  console.log('\nwhile Farm A stands (the control)');
  ok('its owner reads the flock', (await n(OA, 'mortality', `company_id='ca'`)) === 1);
  ok('its labor logs a death', !(await as(LA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('ml','ca','ba','sa','${day}',1)`)).error);
  ok('its owner numbers a receipt', !(await as(OA, `select app.next_receipt_no('ca','CR','${day}')`)).error);

  console.log('\nwith Farm A deactivated');
  await setActive(false);
  for (const t of ['farms', 'sheds', 'batches', 'mortality', 'egg_collections', 'feed_stock', 'traders', 'finance_txns']) {
    ok(`owner reads no ${t}`, (await n(OA, t, `company_id='ca'`)) === 0);
  }
  ok('labor reads no flock', (await n(LA, 'mortality')) === 0);
  ok('labor reads no egg stock view', (await n(LA, 'v_egg_stock')) === 0);
  ok('a rival owner still reads nothing of A', (await n(OB, 'mortality', `company_id='ca'`)) === 0);

  ok('insert refused', !!(await as(OA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('mx','ca','ba','sa','${day}',1)`)).error);
  // A policy's USING clause does not raise for an UPDATE/DELETE — the row set simply resolves
  // to nothing, which is the same refusal seen from the client as `count: 0`.
  const upd = await as(OA, `update mortality set count=99 where id='ma'`);
  ok('update touches no row', !upd.error && upd.count === 0, JSON.stringify(upd));
  const del = await as(OA, `delete from mortality where id='ma'`);
  ok('delete touches no row', !del.error && del.count === 0, JSON.stringify(del));
  ok('an egg entry refused', !!(await as(LA, `insert into egg_collections (id,company_id,batch_id,shed_id,date,good_trays) values ('ex','ca','ba','sa','${day}',1)`)).error);
  ok('receipt numbering refused', !!(await as(OA, `select app.next_receipt_no('ca','CR','${day}')`)).error);
  // Read as the table owner: under 013 the platform role is refused a deactivated company's
  // data too, so only a view from outside RLS can show the row is merely unreadable, not gone.
  ok('…and the death count stands as it was',
    (await c.query(`select count::int n from mortality where id='ma'`)).rows[0]?.n === 5);

  console.log('\nwhat a deactivation must NOT touch');
  ok('the member still sees the company row', (await n(OA, 'companies', `id='ca'`)) === 1);
  ok('…and reads it as inactive', (await as(OA, `select active from companies where id='ca'`)).rows?.[0]?.active === false);
  ok('the member still sees their own membership', (await n(OA, 'company_users', `company_id='ca'`)) === 2);
  ok('a colleague cannot add themselves to it', !!(await as(OB, `insert into company_users (user_id,company_id,role) values ('${OB}','ca','OWNER')`)).error);
  ok('the platform role still sees it', (await n(MA, 'companies', `id='ca'`)) === 1);
  ok('the platform role can still switch it back on',
    !(await as(MA, `update companies set active = true where id='ca'`)).error);

  console.log('\nreactivation restores, with nothing duplicated');
  await setActive(true);
  ok('the owner reads the flock again', (await n(OA, 'mortality', `company_id='ca'`)) === 1);
  ok('the labor can log again', !(await as(LA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('ml2','ca','ba','sa','${day}',1)`)).error);
  ok('receipt numbering answers again', !(await as(OA, `select app.next_receipt_no('ca','CR','${day}')`)).error);
  ok('one membership row, not two', (await n(MA, 'company_users', `company_id='ca'`)) === 2);
  ok('one company row', (await n(MA, 'companies', `id='ca'`)) === 1);

  console.log('\nmembership removal is still a full revoke');
  await c.query(`delete from company_users where user_id = '${OA}'`);
  ok('a detached owner reads nothing', (await n(OA, 'mortality', `company_id='ca'`)) === 0);
  ok('…even while the company stands', (await as(OA, `select active from companies where id='ca'`)).rows?.length === 0);
  await c.query(`insert into company_users values ('${OA}','ca','OWNER')`);
} finally {
  if (DRY) {
    await c.query('rollback');
    console.log('\nrolled back: the live schema and data are untouched');
  } else {
    await cleanup();
    console.log('\ncleaned up');
  }
}

console.log(fails ? `\n${fails} lifecycle problem(s)` : '\nCompany lifecycle holds in RLS');
await c.end();
process.exit(fails ? 1 : 0);
