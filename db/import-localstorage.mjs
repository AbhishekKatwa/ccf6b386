/**
 * Brings a browser's saved Amrut state into the Postgres schema.
 *
 *   node --env-file=.env db/import-localstorage.mjs <dump.json>            # dry run, rolled back
 *   node --env-file=.env db/import-localstorage.mjs <dump.json> --commit    # write it
 *
 * The dump is the raw value of localStorage['amrut-poultry-v1'] — { state, version } as the app
 * wrote it, at whatever version the running build persists. Get it from the browser devtools:
 * copy(localStorage.getItem('amrut-poultry-v1')). Nothing here invents a row: a slice that has no
 * table, and a field that has no column, are counted and reported instead of being guessed at.
 *
 * The store's user ids are text ('u_owner') and people are uuids here, so every person id is
 * resolved through one legacy map that profiles.legacy_id keeps afterwards — the same import run
 * twice lands on the same uuids. Passwords are deliberately NOT carried: auth.users gets a
 * placeholder hash and each person signs in through Supabase Auth once it is wired up.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('usage: node --env-file=.env db/import-localstorage.mjs <dump.json> [--commit]');
  process.exit(2);
}
const COMMIT = process.argv.includes('--commit');

const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const state = dump.state ?? dump;
const version = dump.version ?? null;

const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const c = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: process.env.SUPABASE_DB_CA
    ? { ca: fs.readFileSync(process.env.SUPABASE_DB_CA, 'utf8') }
    : { rejectUnauthorized: false },
});
await c.connect();
await c.query('begin');

/* ============================= WHAT THE DATABASE ACCEPTS ============================= */

const specQ = await c.query(`
  select table_name, column_name, data_type, is_nullable, column_default,
         coalesce(ordinal_position, 0) ord
  from information_schema.columns
  where table_schema = 'public' and table_name not like 'v!_%' escape '!'
  order by 1, 4`);
const spec = new Map();
for (const r of specQ.rows) {
  if (!spec.has(r.table_name)) spec.set(r.table_name, new Map());
  spec.get(r.table_name).set(r.column_name, {
    type: r.data_type,
    // A required column the database fills in itself is not something the dump has to carry.
    nn: r.is_nullable === 'NO' && !r.column_default,
  });
}
const pkQ = await c.query(`
  select tc.table_name, string_agg(kcu.column_name, ',' order by kcu.ordinal_position) cols
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
  group by 1`);
const pks = new Map(pkQ.rows.map(r => [r.table_name, r.cols.split(',')]));

const snake = s => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());

/** People, companies and the audit trail name a person in several shapes; all resolve here. */
const people = new Map();
const uuidOf = legacy => {
  const h = crypto.createHash('sha256').update(`amrut-user:${legacy}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;            // a stable, valid v5-looking id from the old text id
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.subarray(0, 16).toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
};

const skipped = { fields: new Map(), people: new Map() };
const noteField = (table, f) => skipped.fields.set(`${table}.${f}`, (skipped.fields.get(`${table}.${f}`) ?? 0) + 1);
const notePerson = (table, v) => {
  const k = `${table}: ${v === '' ? "''" : v === undefined ? 'undefined' : JSON.stringify(v)}`;
  skipped.people.set(k, (skipped.people.get(k) ?? 0) + 1);
};

function value(table, col, raw) {
  const s = spec.get(table).get(col);
  if (raw === undefined) return undefined;
  if (s.type === 'uuid') {
    if (raw === null || raw === '' || raw === 'system') { notePerson(table, raw); return null; }
    const id = people.get(raw) ?? (/^[0-9a-f-]{36}$/.test(raw) ? raw : null);
    if (!id) { notePerson(table, raw); return null; }
    return id;
  }
  if (raw === '' && (s.type === 'date' || s.type.startsWith('timestamp'))) return null;
  if (raw === null || raw === '') return null;
  if (s.type === 'jsonb') {
    if (typeof raw !== 'object') return null;
    return Array.isArray(raw) ? (raw.length ? JSON.stringify(raw) : null)
      : (Object.keys(raw).length ? JSON.stringify(raw) : null);
  }
  if (s.type.startsWith('numeric') || s.type === 'integer' || s.type === 'bigint') {
    return Number.isFinite(Number(raw)) ? Number(raw) : null;
  }
  if (s.type === 'boolean') return typeof raw === 'boolean' ? raw : null;
  return String(raw);
}

const written = new Map();

/*
 * An import that re-states a company's own history writes as that company's Owner, the role whose
 * grants cover every table the dump touches — RLS is not involved (the migration role owns the
 * tables), only this one identity test is. A company in the dump with no Owner is left anonymous,
 * and the refusal that follows is the honest answer rather than a bypass.
 */
const owners = new Map((await c.query(`
  select cu.company_id, (array_agg(cu.user_id order by cu.user_id))[1] owner
  from public.company_users cu where cu.role = 'OWNER' group by 1`)).rows.map(r => [r.company_id, r.owner]));
let acting = null;
async function actAs(company) {
  const who = (company && owners.get(company)) || null;
  if (acting === who) return;
  acting = who;
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [who ? JSON.stringify({ sub: who }) : '']);
}

async function put(table, row, extra = {}) {
  const cols = spec.get(table);
  await actAs(row.companyId ?? row.company_id ?? null);
  const out = {};
  for (const [k, v] of Object.entries({ ...row, ...extra })) {
    const col = snake(k);
    if (!cols.has(col)) { if (v !== undefined) noteField(table, k); continue; }
    const val = value(table, col, v);
    if (val !== undefined) out[col] = val;
  }
  const pk = pks.get(table);
  for (const [col, s] of cols) {
    if (s.nn && out[col] === undefined) throw new Error(`${table}.${col} is required and the dump has nothing for it (${pk ?? ''})`);
  }
  const names = Object.keys(out);
  if (!names.length) return 0;
  const sql = `insert into public.${table} (${names.map(n => `"${n}"`).join(', ')})
               values (${names.map((_, i) => `$${i + 1}`).join(', ')})
               on conflict (${pk.map(n => `"${n}"`).join(', ')}) do update
               set ${names.filter(n => !pk.includes(n)).map(n => `"${n}" = excluded."${n}"`).join(', ')
                 || `"${pk[0]}" = excluded."${pk[0]}"`}`;
  const r = await c.query(sql, names.map(n => out[n]));
  written.set(table, (written.get(table) ?? 0) + r.rowCount);
  return r.rowCount;
}

/** @param {string} table child rows are re-stated from their parent, so a stale position never survives. */
async function putChild(table, parentId, fk, list, map = x => x) {
  if (!Array.isArray(list)) return 0;
  for (const [i, item] of list.entries()) {
    await put(table, { [fk]: parentId, position: i, ...map(item, i) });
  }
  return list.length;
}

/* ============================= PEOPLE FIRST ============================= */

const users = Array.isArray(state.users) ? state.users : [];
for (const p of users) people.set(p.id, uuidOf(p.id));

/* Companies come first: a membership row is only legal once the company exists, and a shed
   points at the people who supervise it, so profiles come before every flock table. */
head('Companies');
for (const c2 of state.companies ?? []) await put('companies', c2);

head('People');
for (const p of users) {
  const id = people.get(p.id);
  await c.query(`insert into auth.users (id, aud, role, email, phone, encrypted_password,
                   email_confirmed_at, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                   created_at, updated_at, is_sso_user)
                 values ($1,'authenticated','authenticated',null,null,'__legacy_import__',null,null,'{}','{}',$2,$2,false)
                 on conflict (id) do nothing`, [id, p.createdAt ?? new Date().toISOString()]);
  await put('profiles', { ...p, id });
  for (const companyId of p.companyIds ?? []) {
    if (p.role === 'MASTER_ADMIN' && companyId === '*') continue;
    await put('company_users', { userId: id, companyId, role: p.role });
  }
}
console.log(`  ${users.length} people, ${written.get('company_users') ?? 0} memberships`);

/* ============================= THE SLICES, IN FK ORDER ============================= */

/** Which slice lands in which table — the read-back below counts against exactly this. */
const expect = {
  companies: 'companies', farms: 'farms', sheds: 'sheds', batches: 'batches',
  assignments: 'batch_assignments', mortality: 'mortality', feed: 'feed_consumption',
  feedRounds: 'feed_round_logs', eggs: 'egg_collections', saleLogs: 'sale_logs',
  saleEntries: 'sale_entries', eggSaleBookings: 'egg_sale_bookings', feedStock: 'feed_stock',
  medicineItems: 'medicine_items', medicineStock: 'medicine_stock', feedFormulas: 'feed_formulas',
  finance: 'finance_txns', traders: 'traders', traderTxns: 'trader_txns', tasks: 'tasks',
  vaccinations: 'vaccinations', vaccinationTemplates: 'vaccination_templates',
  supportMessages: 'support_messages', cashHandovers: 'cash_handovers',
  cashCounts: 'cash_counts', audit: 'audit',
};

head('Farms, sheds and flocks');
for (const x of state.farms ?? []) await put('farms', x);
for (const x of state.sheds ?? []) await put('sheds', x);
for (const x of state.batches ?? []) {
  const { closing, approximateFeedTonnesPerDay, ...row } = x;
  // The only name the app and the schema disagree on: the planner's intake, per batch.
  await put('batches', { ...row, approximateFeedTpd: approximateFeedTonnesPerDay });
  if (closing) await put('batch_closings', { ...closing, batchId: x.id, companyId: x.companyId, closedBy: closing.closedBy });
}
for (const x of state.assignments ?? []) await put('batch_assignments', x);
for (const x of state.mortality ?? []) await put('mortality', x);

head('Godown');
for (const name of state.ingredientCatalog ?? []) {
  if (typeof name === 'string' && name.trim()) await put('ingredients', { name: name.trim() });
}
for (const x of state.feedStock ?? []) await put('feed_stock', x);
for (const x of state.feedFormulas ?? []) {
  const { items, ...row } = x;
  await put('feed_formulas', row);
  await putChild('feed_formula_items', x.id, 'formulaId', items,
    i => ({ ingredient: i.ingredient, kgPerTonne: i.kgPerTonne }));
}
for (const x of state.feed ?? []) {
  const { deduction, ...row } = x;
  await put('feed_consumption', row);
  await putChild('feed_consumption_deductions', x.id, 'consumptionId', deduction);
}
for (const x of state.feedRounds ?? []) await put('feed_round_logs', x);
for (const x of state.medicineItems ?? []) await put('medicine_items', x);
for (const x of state.medicineStock ?? []) await put('medicine_stock', x);

head('Eggs and sales');
for (const x of state.traders ?? []) await put('traders', x);
for (const x of state.eggs ?? []) await put('egg_collections', x);
for (const x of state.saleLogs ?? []) await put('sale_logs', x);
for (const x of state.saleEntries ?? []) {
  const { lines, rates, credit, ...row } = x;
  await put('sale_entries', {
    ...row,
    rateGood: rates?.GOOD, rateBroken: rates?.BROKEN,
    rateDouble: rates?.DOUBLE, rateSmall: rates?.SMALL,
  });
  await putChild('sale_entry_lines', x.id, 'saleEntryId', lines,
    l => ({
      shedId: l.shedId,
      goodTrays: l.byGrade?.GOOD, brokenTrays: l.byGrade?.BROKEN,
      doubleTrays: l.byGrade?.DOUBLE, smallTrays: l.byGrade?.SMALL,
    }));
}
for (const x of state.eggSaleBookings ?? []) await put('egg_sale_bookings', x);
for (const x of state.traderTxns ?? []) await put('trader_txns', x);

head('Money, medicine work and the rest');
for (const x of state.finance ?? []) await put('finance_txns', x);
for (const x of state.cashHandovers ?? []) await put('cash_handovers', x);
for (const x of state.cashCounts ?? []) await put('cash_counts', x);
for (const x of state.vaccinationTemplates ?? []) {
  const { items, ...row } = x;
  await put('vaccination_templates', row);
  await putChild('vaccination_template_items', x.id, 'templateId', items);
}
for (const x of state.vaccinations ?? []) await put('vaccinations', x);
for (const x of state.tasks ?? []) await put('tasks', x);
for (const x of state.supportMessages ?? []) await put('support_messages', x);
// A dump taken before the day lock was removed still carries its trail; the table no longer has
// the verbs for it, and the app's own v19 migration drops the same rows.
for (const x of (state.audit ?? []).filter(a => !['LOCK', 'UNLOCK'].includes(a.action) && a.entity !== 'DayLock')) await put('audit', x);

/*
 * Receipt numbers continue from the highest one already on the books, never from 001 — the same
 * rule nextReceiptNumber() follows in the browser. A dump with no numbers seeds nothing.
 */
head('Receipt counters');
const counters = new Map();
const numCols = { feed_stock: ['purchase_ref', 'company_id', 'date'], finance_txns: ['reference', 'company_id', 'date'], trader_txns: ['reference', 'company_id', 'date'] };
for (const [table, [field, compCol, dayCol]] of Object.entries(numCols)) {
  const r = await c.query(
    `select ${compCol} as comp, left(${field}, 3) as scope,
            to_char(${dayCol}, 'YYYY-MM-DD') as on_day,
            max((right(${field}, 3))::int) as taken
       from public.${table}
      where ${field} ~ '^(PUR|MED|CR)-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$'
        and ${compCol} is not null and ${dayCol} is not null
      group by 1, 2, 3`);
  for (const x of r.rows) if (x.taken) counters.set(`${x.comp}|${x.scope}|${x.on_day}`, x.taken);
}
let seeded = 0;
for (const [k, taken] of counters) {
  const [comp, scope, day] = k.split('|');
  await c.query(`select app.next_receipt_no($1,$2,$3::date,$4)`, [comp, scope, day, taken]);
  seeded++;
}
console.log(`  ${seeded} series continued from their highest used number`);

head('Left in the browser');
const known = new Set(Object.keys(expect).concat(['users', 'ingredientCatalog', 'session', 'online', 'toasts']));
const extras = Object.keys(state).filter(k => !known.has(k))
  .map(k => `${k} (${Array.isArray(state[k]) ? state[k].length + ' rows' : typeof state[k]})`);
console.log(extras.length ? `  slices with no table: ${extras.join(', ')}`
  : '  every slice in the dump has a table');
const drop = [...skipped.fields.entries()].sort((a, b) => b[1] - a[1]);
if (drop.length) {
  console.log(`  ${drop.length} field name(s) with no column — kept in the dump, not in the row:`);
  for (const [k, n] of drop) console.log(`     ${k} ×${n}`);
}
const unmapped = [...skipped.people.entries()].sort((a, b) => b[1] - a[1]);
if (unmapped.length) {
  console.log(`  ${unmapped.length} person reference(s) that named nobody here:`);
  for (const [k, n] of unmapped) console.log(`     ${k} ×${n}`);
}

/* ============================= DOES IT ALL ADD UP ============================= */

head('Read-back');
let bad = 0;
for (const [slice, table] of Object.entries(expect)) {
  const want = (state[slice] ?? []).length;
  const { rows } = await c.query(`select count(*)::int n from public.${table}`);
  const got = rows[0].n;
  const nested = table === 'sale_entries'
    ? (state[slice] ?? []).reduce((a, x) => a + (x.lines?.length ?? 0), 0) : 0;
  const okCount = got >= want && (got - want === 0 || nested > 0);
  if (!okCount) bad++;
  console.log(`  ${okCount ? 'ok  ' : 'FAIL'} ${slice} → ${table}: ${got} rows for ${want} in the dump`);
}
for (const [table, col, want] of [
  ['sale_entry_lines', 'lines of the vouchers', (state.saleEntries ?? []).reduce((a, x) => a + (x.lines?.length ?? 0), 0)],
  ['feed_formula_items', 'items', (state.feedFormulas ?? []).reduce((a, x) => a + (x.items?.length ?? 0), 0)],
  ['feed_consumption_deductions', 'deductions', (state.feed ?? []).reduce((a, x) => a + (x.deduction?.length ?? 0), 0)],
  ['vaccination_template_items', 'template items', (state.vaccinationTemplates ?? []).reduce((a, x) => a + (x.items?.length ?? 0), 0)],
]) {
  const got = (await c.query(`select count(*)::int n from public.${table}`)).rows[0].n;
  if (got !== want) bad++;
  console.log(`  ${got === want ? 'ok  ' : 'FAIL'} ${col} → ${table}: ${got}/${want}`);
}
const stock = await c.query(`select count(*)::int n from v_godown_stock where qty_kg < 0`);
if (stock.rows[0].n) { bad++; console.log(`  FAIL ${stock.rows[0].n} ingredients read negative off v_godown_stock`); }
else console.log('  ok   no ingredient is negative in v_godown_stock');

/* ============================= THE VIEWS MUST AGREE ============================= */

head('Derived views');
const tb = await c.query(`select count(*)::int n, coalesce(sum(balance),0)::numeric owed from v_trader_balance`);
console.log(`  ${tb.rows[0].n} trader balances, ${tb.rows[0].owed} net receivable across the farm`);
/*
 * v_egg_stock reads its sold side through v_sale_entry_day, which answers only for companies the
 * caller belongs to. As the migration role — which is not a person — that side is empty and the
 * stock reads too high, so this one check runs as an Owner exactly the way a screen does.
 */
const asOwner = (await c.query(`select p.id, cu.company_id from public.profiles p
  join public.company_users cu on cu.user_id = p.id and cu.role = 'OWNER'
  order by cu.company_id limit 1`)).rows[0];
if (!asOwner) {
  bad++;
  console.log('  FAIL the dump has no Owner membership, so no one can be asked for the stock view');
} else {
  const day = (await c.query('select current_date::text d')).rows[0].d;
  const open = a => (a ?? []).filter(x => x.companyId === asOwner.company_id && (x.date ?? '') <= day);
  const collected = open(state.eggs).reduce((a, x) => a + x.goodTrays + x.brokenTrays + x.doubleTrays + x.smallTrays, 0);
  const sold = open(state.saleEntries).reduce(
    (a, x) => a + (x.lines ?? []).reduce((b, l) => b + Object.values(l.byGrade ?? {}).reduce((s, v) => s + (v || 0), 0), 0), 0);
  await c.query('savepoint probe');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: asOwner.id })]);
  await c.query('set local role authenticated');
  const egg = await c.query(
    `select coalesce(sum(balance), 0)::int trays from v_egg_stock where company_id = $1`,
    [asOwner.company_id]);
  await c.query('rollback to savepoint probe');
  const okStock = egg.rows?.[0]?.trays === collected - sold;
  if (!okStock) bad++;
  console.log(`  ${okStock ? 'ok  ' : 'FAIL'} v_egg_stock as ${asOwner.company_id}'s Owner: `
    + `${egg.rows?.[0]?.trays} open = ${collected} collected − ${sold} billed`);
}
const bal = await c.query(`select coalesce(sum(effect),0)::numeric n from v_trader_txn_effect`);
const fin = await c.query(`select coalesce(sum(case when kind in ('INCOME','SALE','PAYMENT_IN') then amount when kind in ('EXPENSE','PURCHASE','PAYMENT_OUT') then -amount else 0 end),0)::numeric n from finance_txns`);
console.log(`  trader ledger moves ${bal.rows[0].n}; finance rows net ${fin.rows[0].n}`);

console.log(`\n${COMMIT ? 'COMMITTING' : 'rolling back — pass --commit to write'}${bad ? ` · ${bad} count mismatch(es) above` : ''}`);
await (COMMIT ? c.query('commit') : c.query('rollback'));
await c.end();

function head(t) { console.log(`\n${t}`); }
