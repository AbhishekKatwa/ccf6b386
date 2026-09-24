/**
 * Proves 003 actually isolates: two companies, six roles, and the questions the design claims
 * to answer. Everything below runs as `authenticated` with a forged JWT claim set, which is how
 * PostgREST reaches Postgres — so a pass here is a pass through the same code path.
 *
 *   node --env-file=.env db/verify003.mjs
 */
import pg from 'pg';

const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const c = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: process.env.SUPABASE_DB_CA ? { ca: (await import('node:fs')).readFileSync(process.env.SUPABASE_DB_CA, 'utf8') } : { rejectUnauthorized: false },
});
await c.connect();

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const day = new Date().toISOString().slice(0, 10);
const lockedDay = '2026-01-05';

// As the migration role (table owner, not subject to RLS): lay out two rival farms.
async function seed() {
  const q = sql => c.query(sql);
  await q(`insert into companies (id,name) values ('ca','Farm A'), ('cb','Farm B')`);
  const people = [
    [uuid(1), 'A Owner', 'OWNER', '9000000001'],
    [uuid(2), 'A Labor', 'FARM_LABOR', '9000000002'],
    [uuid(3), 'A Supervisor', 'FARM_SUPERVISOR', '9000000003'],
    [uuid(4), 'A Finance', 'FINANCIAL_SUPERVISOR', '9000000004'],
    [uuid(5), 'B Owner', 'OWNER', '9000000005'],
    [uuid(6), 'Platform', 'MASTER_ADMIN', '9000000006'],
  ];
  for (const [id, name, role, mobile] of people) {
    await q(`insert into auth.users (id, email) values ('${id}', '${mobile}@example.test')
             on conflict do nothing`);
    await q(`insert into profiles (id, legacy_id, name, mobile, role)
             values ('${id}','l_${mobile}','${name}','${mobile}','${role}')`);
  }
  for (const [id, , role] of people.slice(0, 4)) await q(`insert into company_users values ('${id}','ca','${role}')`);
  await q(`insert into company_users values ('${uuid(5)}','cb','OWNER')`);

  await q(`insert into farms (id,company_id,name) values ('fa','ca','A farm'), ('fb','cb','B farm')`);
  await q(`insert into sheds (id,company_id,farm_id,name,capacity) values
             ('sa','ca','fa','A-shed',1000), ('sb','cb','fb','B-shed',1000)`);
  await q(`insert into batches (id,company_id,farm_id,shed_id,code,bird_type,placement_date,start_date,initial_birds) values
             ('ba','ca','fa','sa','A1','LAYER','2026-01-01','2026-01-01',100),
             ('bb','cb','fb','sb','B1','LAYER','2026-01-01','2026-01-01',100)`);
  // The farm manager's view test needs an assignment.
  await q(`insert into mortality (id,company_id,batch_id,shed_id,date,count) values
             ('ma','ca','ba','sa','${day}',5), ('mb','cb','bb','sb','${day}',7)`);
  await q(`insert into egg_collections (id,company_id,batch_id,shed_id,date,good_trays) values
             ('ea','ca','ba','sa','${day}',40), ('eb','cb','bb','sb','${day}',60)`);
  await q(`insert into feed_stock (id,company_id,ingredient,date,kind,qty_kg) values
             ('fsa','ca','Maize','${day}','FEED_IN',1000), ('fsb','cb','Maize','${day}','FEED_IN',2000)`);
  await q(`insert into traders (id,company_id,name,opening_balance) values ('tra','ca','A trader',0), ('trb','cb','B trader',0)`);
  await q(`insert into sale_entries (id,company_id,trader_id,date,pricing,amount,cash,labor_charge)
           values ('sea','ca','tra','${day}','RATE',500,100,0)`);
  await q(`insert into sale_entry_lines (sale_entry_id,position,shed_id,good_trays) values ('sea',0,'sa',10)`);
  await q(`insert into trader_txns (id,company_id,trader_id,date,kind,amount,sale_id)
           values ('tta','ca','tra','${day}','EGG_SALE',500,'sea')`);
  await q(`insert into finance_txns (id,company_id,date,kind,amount,category) values ('fta','ca','${day}','EXPENSE',50,'Salaries')`);
  await q(`insert into day_locks (id,company_id,batch_id,shed_id,date) values ('dl1','ca','ba','sa','${lockedDay}')`);
  await q(`insert into vaccinations (id,company_id,batch_id,shed_id,relative_day,vaccine_name,scheduled_date)
           values ('va','ca','ba','sa',1,'Newcastle','${day}')`);
}

/** Run one statement as a signed-in role. */
async function as(userId, sql, params) {
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
  await c.query('set local role authenticated');
  try {
    const r = await c.query(sql, params);
    await c.query('rollback');
    return { rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query('rollback');
    return { error: e.message, code: e.code };
  }
}
const visible = (userId, table, where = '') =>
  as(userId, `select count(*)::int n from ${table}${where ? ` where ${where}` : ''}`).then(r => r.rows?.[0]?.n ?? `ERR ${r.error}`);

/** ON DELETE RESTRICT edges go first: a line names a shed, and a shed names a farm. */
async function cleanup() {
  await c.query(`delete from sale_entry_lines where sale_entry_id like 'se%'`);
  await c.query(`delete from companies where id in ('ca','cb')`);
  await c.query(`delete from profiles where id in (${[1, 2, 3, 4, 5, 6].map(n => `'${uuid(n)}'`).join(',')})`);
  await c.query(`delete from auth.users where id in (${[1, 2, 3, 4, 5, 6].map(n => `'${uuid(n)}'`).join(',')})`);
}

try {
  await cleanup();
  await seed();
  const [OA, LA, SA, FA, OB, MA] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), uuid(6)];

  console.log('\ncompany isolation (as A’s Owner)');
  for (const t of ['farms', 'sheds', 'batches', 'mortality', 'egg_collections', 'feed_stock', 'traders', 'sale_entries', 'finance_txns', 'vaccinations', 'day_locks', 'company_users']) {
    const leaks = await visible(OA, t, `company_id='cb'`);
    ok(`${t.padEnd(17)} reveals no Farm B row`, leaks === 0, `got ${leaks}`);
  }
  ok('other company invisible', (await as(OB, `select id from mortality`)).rows.every(r => r.id === 'mb'));

  console.log('\nmoney is not merely hidden (as A’s Labor)');
  ok('sale_entries unreadable', (await visible(LA, 'sale_entries')) === 0);
  ok('traders unreadable', (await visible(LA, 'traders')) === 0);
  ok('finance_txns unreadable', (await visible(LA, 'finance_txns')) === 0);
  ok('trader balance view empty', (await visible(LA, 'v_trader_balance')) === 0);
  ok('godown ledger unreadable', (await visible(LA, 'feed_stock')) === 0);
  ok('receipt counter unreadable', (await visible(LA, 'receipt_counters')) === 0);
  ok('…but its own flock reads', (await visible(LA, 'mortality', `id='ma'`)) === 1);

  console.log('\nsupervisor egg stock stays correct without the money');
  const sup = await as(SA, `select collected, dispatched, balance from v_egg_stock where shed_id='sa' and grade='GOOD'`);
  ok('v_egg_stock visible', sup.rows?.length === 1, JSON.stringify(sup));
  ok('dispatched read through the day view', sup.rows?.[0]?.dispatched === '10' && sup.rows?.[0]?.balance === '30',
    JSON.stringify(sup.rows?.[0]));
  ok('supervisor still cannot open the voucher', (await visible(SA, 'sale_entries')) === 0);

  console.log('\nwrites a role may not make');
  ok('labor cannot bill a sale', !!(await as(LA, `insert into sale_entries (id,company_id,trader_id,date,amount) values ('x','ca','tra','${day}',1)`)).error);
  ok('labor cannot write another company', !!(await as(LA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('x','cb','bb','sb','${day}',1)`)).error);
  ok('labor can log today’s mortality', !(await as(LA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('ml','ca','ba','sa','${day}',1)`)).error);
  const crossUpdate = await as(OB, `update mortality set count=99 where id='ma'`);
  ok('B owner updates zero A rows', !crossUpdate.error && crossUpdate.count === 0, JSON.stringify(crossUpdate));
  const crossInsert = await as(OB, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('xb','ca','ba','sa','${day}',1)`);
  ok('B owner cannot write into A', !!crossInsert.error);
  ok('finance role cannot log daily ops', !!(await as(FA, `insert into egg_collections (id,company_id,batch_id,shed_id,date,good_trays) values ('x','ca','ba','sa','${day}',1)`)).error);

  console.log('\nthe locked day holds against a direct write');
  const lockWrite = await as(LA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('mx','ca','ba','sa','${lockedDay}',1)`);
  ok('labor refused on a locked date', !!lockWrite.error, lockWrite.error ?? '');
  const lockEdit = await as(SA, `update mortality set count=6 where id='ma' and date='${day}'`);
  ok('unlocked date still editable by supervisor', !lockEdit.error, lockEdit.error ?? '');
  const ownerUnlock = await as(OA, `insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('mo','ca','ba','sa','${lockedDay}',1)`);
  ok('owner may write through a lock', !ownerUnlock.error, ownerUnlock.error ?? '');

  console.log('\nthe platform role');
  // Counted inside this run's own two companies: a real farm's rows land in `sheds` too, and the
  // point of the check is that the platform role crosses a tenancy line a company role cannot.
  ok('master admin reads both companies’ sheds', (await visible(MA, 'sheds', `company_id in ('ca','cb')`)) === 2);
  ok('master admin reads money', (await visible(MA, 'sale_entries', `company_id in ('ca','cb')`)) === 1);
  ok('master admin cannot bill a sale', !!(await as(MA, `insert into sale_entries (id,company_id,trader_id,date,amount) values ('x','ca','tra','${day}',1)`)).error);

  console.log('\nanonymous callers');
  await c.query('begin'); await c.query('set local role anon');
  const anon = await c.query('select count(*)::int n from public.mortality').catch(e => e.message);
  ok('anon cannot read the flock', typeof anon === 'string' ? true : anon === 0, JSON.stringify(anon));
  await c.query('rollback');
} finally {
  // ON DELETE RESTRICT edges go first: a line names a shed, and a shed names a farm.
  await c.query(`delete from sale_entry_lines where sale_entry_id like 'se%'`);
  await c.query(`delete from companies where id in ('ca','cb')`);
  await c.query(`delete from profiles where id in (${[1, 2, 3, 4, 5, 6].map(n => `'${uuid(n)}'`).join(',')})`);
  await c.query(`delete from auth.users where id in (${[1, 2, 3, 4, 5, 6].map(n => `'${uuid(n)}'`).join(',')})`);
  console.log('\ncleaned up');
}

console.log(fails ? `\n${fails} RLS problem(s)` : '\nRLS holds');
await c.end();
process.exit(fails ? 1 : 0);
