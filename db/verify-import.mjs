/**
 * Reads the imported database back as the people in it, not as its owner.
 *
 *   node --env-file=.env db/verify-import.mjs
 *
 * verify003 proves the policies against rows it seeds itself. This is the other question: does a
 * real farm's history, landed by import-localstorage.mjs, still resolve for a supervisor and stay
 * invisible to a money-only role? A shed list that comes back empty for its own Owner is a broken
 * import just as surely as a missing row.
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
/*
 * One transaction for the whole read: `set_config(..., true)` is transaction-local, and outside
 * one each statement would start its own and lose the identity the next query needs.
 */
await c.query('begin');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

const who = await c.query(`
  select p.id, p.name, cu.company_id, cu.role
  from public.profiles p join public.company_users cu on cu.user_id = p.id
  order by cu.role, p.name`);
console.log('\nwho the import made');
for (const r of who.rows) console.log(`  ${r.role.padEnd(22)} ${r.company_id}  ${r.name}`);
if (!who.rows.length) { console.log('\nnothing imported yet — run db/import-localstorage.mjs first'); process.exit(1); }

const pick = role => who.rows.find(r => r.role === role);
const as = async (r, sql, params) => {
  await c.query('savepoint who');
  await c.query(`select set_config('app.company_id', $1, true), set_config('request.jwt.claims', $2, true)`,
    [r.company_id, JSON.stringify({ sub: r.id })]);
  await c.query('set role authenticated');
  try { return (await c.query(sql, params)).rows; }
  finally {
    await c.query('reset role');
    await c.query('rollback to savepoint who');   // drops the transaction-local GUCs too
  }
};

const owner = pick('OWNER');
const comp = owner?.company_id;
/* The comparisons below are inside one company, so a second farm's supervisor is not a stand-in. */
const mate = role => who.rows.find(r => r.role === role && r.company_id === comp);
const sup = mate('FARM_SUPERVISOR'), fin = mate('FINANCIAL_SUPERVISOR'), labor = mate('FARM_LABOR');

console.log(`\nas the Owner of ${comp}`);
const sheds = await as(owner, 'select id from public.sheds where company_id = $1', [comp]);
ok('the sheds they own resolve', sheds.length > 0, `${sheds.length} rows`);
const eggs = await as(owner, 'select coalesce(sum(balance),0)::int trays from v_egg_stock where company_id = $1', [comp]);
ok('egg stock reads open trays', eggs[0].trays > 0, JSON.stringify(eggs[0]));
const money = await as(owner, 'select count(*)::int n, coalesce(sum(balance),0)::numeric owed from v_trader_balance where company_id = $1', [comp]);
ok('trader balances read with their receivables', money[0].n > 0, JSON.stringify(money[0]));
const locked = await as(owner, 'select count(*)::int n from public.day_locks where company_id = $1', [comp]);
ok('the locked days came across', locked[0].n > 0, JSON.stringify(locked[0]));

console.log(`\nas ${sup?.name ?? 'a supervisor'} (${sup?.role})`);
if (sup) {
  const ops = await as(sup, 'select count(*)::int n from public.egg_collections where company_id = $1', [sup.company_id]);
  ok('the daily operations are theirs to see', ops[0].n > 0, JSON.stringify(ops[0]));
  const fin2 = await as(sup, 'select 1 from public.finance_txns where company_id = $1 limit 1', [sup.company_id]);
  ok('and the money tables are not', fin2.length === 0, JSON.stringify(fin2));
  const bal = await as(sup, 'select coalesce(sum(balance),0)::int trays from v_egg_stock where company_id = $1', [sup.company_id]);
  ok('stock still balances for them, not just for the Owner', bal[0].trays === eggs[0].trays, JSON.stringify(bal[0]));
}

console.log(`\nas ${fin?.name ?? 'a finance supervisor'} (${fin?.role})`);
if (fin) {
  const rows = await as(fin, 'select count(*)::int n from public.finance_txns where company_id = $1', [fin.company_id]);
  ok('the ledger is theirs to read', rows[0].n > 0, JSON.stringify(rows[0]));
}

console.log(`\nas ${labor?.name ?? 'labor'} (${labor?.role})`);
if (labor) {
  const feed = await as(labor, 'select 1 from public.feed_stock where company_id = $1 limit 1', [labor.company_id]);
  ok('Labor sees no godown stock', feed.length === 0);
  /* The point of the definer reads: the answer a supervisor needs cannot depend on a policy they
     do not have. Somebody must still be able to ask what is on the shelf. */
  const kg = await as(labor, 'select app.godown_kg($1, $2) kg', [labor.company_id, 'Maize']);
  ok('…yet the average-cost function still answers truthfully', Number(kg[0].kg) > 0, JSON.stringify(kg[0]));
}

await c.query('reset role');
await c.query('rollback');
console.log(fails ? `\n${fails} read-back problem(s)` : '\nthe imported farm reads back whole, role by role');
await c.end();
process.exit(fails ? 1 : 0);
