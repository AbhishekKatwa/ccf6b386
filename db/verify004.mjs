/**
 * Proves 004's RPCs do what the store's actions do — same numbers, same sentences, same gates.
 *
 * Every check runs inside ONE transaction that is rolled back at the end, so a scenario can
 * take seven steps (receive, receive, issue, adjust, vaccinate) and still leave the database
 * exactly as it was found. Each statement is wrapped in a savepoint so a refused write — which
 * is half the point — does not abort the run.
 *
 *   node --env-file=.env db/verify004.mjs
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
const head = t => console.log(`\n${t}`);
const has = (m, s) => typeof m === 'string' && m.includes(s);
const N = v => (v === null || v === undefined || v === '' ? null : Number(v));
const eq = (a, b, tol = 0.005) => a !== null && Math.abs(Number(a) - b) <= tol;
const show = r => (r.error ? `ERROR ${r.error}` : JSON.stringify(r.rows ?? r.r ?? r));

const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const OA = uuid(1), LA = uuid(2), SA = uuid(3), FA = uuid(4), OB = uuid(5);

/** Dates are asked of the server so `current_date` inside the functions agrees with ours. */
const today = (await c.query('select current_date::text d')).rows[0].d;
const shift = (s, n) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const D = {
  coll: shift(today, -30),
  sale: shift(today, -25),
  feedIn: shift(today, -20),
  feedOut: shift(today, -19),
  soy1: shift(today, -20),
  soy2: shift(today, -19),
  soy3: shift(today, -18),
  lime: shift(today, -18),
  medA: shift(today, -16),
  medB: shift(today, -15),
  medUse: shift(today, -14),
  medAdj: shift(today, -13),
  vacc: shift(today, -12),
  vaccDue: shift(today, -14),
  consume: shift(today, -10),
  number: shift(today, -6),
  number2: shift(today, -5),
  future: shift(today, 1),
};

// ============================= THE HARNESS =============================

await c.query('begin');
let actor = null;
const as = who => { actor = who; };
const json = a => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a);

/** Run one statement as the current actor (null = the migration role, no identity). */
async function step(sql, params) {
  await c.query('savepoint sp');
  try {
    if (actor) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actor })]);
      await c.query('set local role authenticated');
    } else {
      await c.query('reset role');
      await c.query(`select set_config('request.jwt.claims', '', true)`);
    }
    const r = await c.query(sql, params);
    await c.query('release savepoint sp');
    return { rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query('rollback to savepoint sp');
    return { error: String(e.message ?? e) };
  }
}

/** Call one 004 function; returns {r} on success, {error} when it refused. */
async function fn(sig, ...args) {
  const sql = `select app.${sig}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`;
  const out = await step(sql, args.map(json));
  return out.error ? out : { r: out.rows[0].r };
}
const one = async (sql, params) => (await step(sql, params)).rows?.[0];
/** Read a replayed position. `valuation_at` is a table function, so it goes in FROM. */
const position = async (ingredient, day, source = 'godown') =>
  (await step(`select kg, valued_kg, unpriced_kg, value, average from app.valuation_at('ca',$1,$2,$3)`, [source, ingredient, day])).rows?.[0];

// ============================= TWO FARMS TO WORK ON =============================

/** A seed statement that fails must stop the run, not silently skew every later check. */
async function must(sql, params) {
  const r = await step(sql, params);
  if (r.error) throw new Error(`seed failed: ${r.error}\n  ${sql}`);
  return r;
}

as(null);
await must(`insert into companies (id,name) values ('ca','Farm A'), ('cb','Farm B')`);
for (const [id, name, role, mobile] of [
  [OA, 'A Owner', 'OWNER', '9100000001'],
  [LA, 'A Labor', 'FARM_LABOR', '9100000002'],
  [SA, 'A Supervisor', 'FARM_SUPERVISOR', '9100000003'],
  [FA, 'A Finance', 'FINANCIAL_SUPERVISOR', '9100000004'],
  [OB, 'B Owner', 'OWNER', '9100000005'],
  [uuid(9), 'A Manager', 'FARM_MANAGER', '9100000009'],
]) {
  await must(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [id, `${mobile}@example.test`]);
  await must(`insert into profiles (id, legacy_id, name, mobile, role) values ($1,$2,$3,$4,$5)`, [id, `l_${mobile}`, name, mobile, role]);
}
for (const [id, role] of [[OA, 'OWNER'], [LA, 'FARM_LABOR'], [SA, 'FARM_SUPERVISOR'], [FA, 'FINANCIAL_SUPERVISOR'], [uuid(9), 'FARM_MANAGER']]) {
  await must(`insert into company_users (user_id, company_id, role) values ($1,'ca',$2)`, [id, role]);
}
await must(`insert into company_users (user_id, company_id, role) values ($1,'cb','OWNER')`, [OB]);

await must(`insert into farms (id,company_id,name) values ('fa','ca','A farm'), ('fb','cb','B farm')`);
await must(`insert into sheds (id,company_id,farm_id,name,capacity) values
             ('sa','ca','fa','A-shed',1000), ('sa2','ca','fa','A-shed 2',1000), ('sb','cb','fb','B-shed',1000)`);
await must(`insert into batches (id,company_id,farm_id,shed_id,code,bird_type,placement_date,start_date,initial_birds) values
             ('ba','ca','fa','sa','A1','LAYER','2026-01-01','2026-01-01',1000),
             ('ba2','ca','fa','sa2','A2','LAYER','2026-01-01','2026-01-01',800),
             ('bb','cb','fb','sb','B1','LAYER','2026-01-01','2026-01-01',500)`);
await must(`insert into egg_collections (id,company_id,batch_id,shed_id,date,good_trays,broken_trays,double_trays,small_trays) values
             ('ec1','ca','ba','sa',$1,100,20,10,5),
             ('ec2','ca','ba2','sa2',$1,50,0,0,0)`, [D.coll]);
await must(`insert into traders (id,company_id,name,opening_balance) values ('tra','ca','A trader',0), ('trb','cb','B trader',0)`);
await must(`insert into medicine_items (id,company_id,name,category,unit,low_stock_threshold)
             values ('mi','ca','Newcastle vaccine','VACCINE','dose',0)`);
await must(`insert into feed_formulas (id,company_id,shed_id,name,family_id,version,effective_from,status)
             values ('ff1','ca','sa','Layer Grow','fam1',1,$1,'ACTIVE')`, [D.coll]);
await must(`insert into feed_formula_items (formula_id,position,ingredient,kg_per_tonne) values
             ('ff1',0,'Maize',400), ('ff1',1,'Soybean',300)`);
await must(`insert into vaccinations (id,company_id,batch_id,shed_id,relative_day,vaccine_name,scheduled_date) values
             ('va','ca','ba','sa',120,'Newcastle',$1),
             ('vb','ca','ba','sa',121,'IBD',$1),
             ('vc','ca','ba','sa',122,'Fowl pox',$1),
             ('vd','ca','ba2','sa2',123,'Closed one',$1)`, [D.vaccDue]);

// ============================= 1. RECEIPT NUMBERS =============================

head('receipt numbers are handed out once (app.next_receipt_no)');
{
  const a = await fn('next_receipt_no', 'ca', 'CR', D.number, null);
  const b = await fn('next_receipt_no', 'ca', 'CR', D.number, null);
  const seeded = await fn('next_receipt_no', 'ca', 'PUR', D.number2, 7);
  ok('first cash receipt', a.r === `CR-${D.number}-001`, JSON.stringify(a));
  ok('second does not repeat it', b.r === `CR-${D.number}-002`, JSON.stringify(b));
  ok('the counter sits ahead of what was given',
     (await one(`select next_value::int n from receipt_counters where company_id='ca' and scope='CR' and day=$1`, [D.number]))?.n === 3);
  ok('an import seeds the series from its own highest number', seeded.r === `PUR-${D.number2}-008`, JSON.stringify(seeded));
  const later = await fn('next_receipt_no', 'ca', 'PUR', D.number2, 4);
  ok('a smaller seed cannot pull the series back', later.r === `PUR-${D.number2}-009`, JSON.stringify(later));

  as(OB);
  const across = await fn('next_receipt_no', 'ca', 'CR', D.future, null);
  ok('another company cannot number into this one', has(across.error, 'That company is not yours'), show(across));
  as(OA);
  const own = await fn('next_receipt_no', 'ca', 'CR', D.future, null);
  ok('its own Owner can', own.r === `CR-${D.future}-001`, JSON.stringify(own));
  const bogus = await fn('next_receipt_no', 'ca', 'XX', D.future, null);
  ok('only the three series exist', has(bogus.error, 'Unknown receipt series'), show(bogus));
  as(null);
}

// ============================= 2. THE GODOWN =============================

head('the godown moves and prices itself (app.add_feed_stock)');
{
  as(SA);
  const noSupplier = await fn('add_feed_stock', { kind: 'FEED_IN', date: D.feedIn, ingredient: 'Maize', qtyKg: 1000, ratePerKg: 32 });
  ok('a purchase names who it is owed to', has(noSupplier.error, 'Record the supplier this stock was bought from'), show(noSupplier));

  const in1 = await fn('add_feed_stock', { kind: 'FEED_IN', date: D.feedIn, ingredient: 'Maize', qtyKg: 1000, ratePerKg: 32, supplier: 'Anand Feeds' });
  const maizeId = in1.r?.id;
  ok('a receipt is numbered in the PUR series', has(in1.r?.purchaseRef, `PUR-${D.feedIn}-`), JSON.stringify(in1));
  ok('the Owner can pay for it later, so the row keeps its supplier and rate',
     (await one(`select supplier, rate_per_kg from feed_stock where id=$1`, [maizeId]))?.supplier === 'Anand Feeds');

  const bad = await fn('add_feed_stock', { kind: 'FEED_OUT', date: D.feedOut, ingredient: 'Maize', qtyKg: 5000 });
  ok('stock that is not there is refused', has(bad.error, 'Insufficient stock: Maize would go negative (have 1000 kg, need 5000 kg)'), show(bad));

  const out = await fn('add_feed_stock', { kind: 'FEED_OUT', date: D.feedOut, ingredient: 'Maize', qtyKg: 400, shedId: 'sa', batchId: 'ba' });
  const short = await fn('add_feed_stock', { kind: 'SHORTAGE', date: D.feedOut, ingredient: 'Maize', qtyKg: 50, remarks: 'wet bag' });
  ok('a shortage is booked as an outflow however it is typed', short.r?.qtyKg === -50, JSON.stringify(short));
  ok('the balance reads 1000 − 400 − 50', eq((await fn('godown_kg', 'ca', 'Maize')).r, 550));
  ok('zero is not a movement', has((await fn('add_feed_stock', { kind: 'FEED_OUT', date: D.feedOut, ingredient: 'Maize', qtyKg: 0 })).error, 'Quantity cannot be zero'));
  ok('a short of nothing is not a shortage', has((await fn('add_feed_stock', { kind: 'SHORTAGE', date: D.feedOut, ingredient: 'Maize', qtyKg: 0 })).error, 'Enter the quantity found short'));
  ok('an unknown kind is refused', has((await fn('add_feed_stock', { kind: 'DONATE', date: D.feedOut, ingredient: 'Maize', qtyKg: 10 })).error, 'Choose the kind of stock movement'));
  as(FA);
  ok('Finance cannot move godown stock', !!(await fn('add_feed_stock', { kind: 'FEED_IN', date: D.feedIn, ingredient: 'Maize', qtyKg: 10, ratePerKg: 5, supplier: 'x' })).error);
  as(SA);

  // Weighted average: 500 @ 40 then 500 @ 60, then 200 out.
  await fn('add_feed_stock', { kind: 'FEED_IN', date: D.soy1, ingredient: 'Soybean', qtyKg: 500, ratePerKg: 40, supplier: 'Anand Feeds' });
  await fn('add_feed_stock', { kind: 'FEED_IN', date: D.soy2, ingredient: 'Soybean', qtyKg: 500, ratePerKg: 60, supplier: 'Anand Feeds' });
  const mid = await position('Soybean', D.soy2);
  ok('a receipt re-weights the average to 50', eq(mid?.average, 50), JSON.stringify(mid));
  await fn('add_feed_stock', { kind: 'FEED_OUT', date: D.soy3, ingredient: 'Soybean', qtyKg: 200, shedId: 'sa', batchId: 'ba' });
  const after = await position('Soybean', D.soy3);
  ok('stock leaving never moves the average (§15)', eq(after?.average, 50) && eq(after?.kg, 800) && eq(after?.value, 40000), JSON.stringify(after));

  const free = await fn('add_feed_stock', { kind: 'FEED_IN', date: D.lime, ingredient: 'Limestone', qtyKg: 100, supplier: 'A friend' });
  const unpriced = (await step(`select kg, unpriced_kg, value, average from app.valuation_at('ca','godown','Limestone',$1)`, [D.lime])).rows?.[0];
  ok('a rate nobody wrote down is counted, never valued at zero',
     eq(unpriced?.kg, 100) && eq(unpriced?.unpriced_kg, 100) && eq(unpriced?.value, 0) && unpriced?.average === null,
     JSON.stringify({ free, unpriced }));
  as(FA);
  const payFree = await fn('record_purchase_payment', { purchaseId: free.r?.id, date: D.lime, amount: 100, paymentMethod: 'CASH', handledById: OA });
  ok('and it carries no payable', has(payFree.error, 'This purchase carries no receipt rate, so there is no amount to pay'), show(payFree));
  as(null);
}

// ============================= 3. THE SALE VOUCHER =============================

head('one voucher, five effects (app.save_sale_entry)');
let voucher = null;
{
  as(FA);
  const draft = {
    traderId: 'tra', date: D.sale, pricing: 'RATE',
    rates: { good: 6, broken: 4 },
    cash: 5000, phonepe: 1000, advance: 2000, cashHandledById: FA, cashTime: '11:20', cashReference: 'BOC-44',
    laborCharge: 500,
    lines: [{ shedId: 'sa', byGrade: { good: 30, broken: 10 } }, { shedId: 'sa2', byGrade: { good: 20 } }],
  };

  // ---- the refusals, each rolled back ----
  as(LA);
  ok('Labor cannot bill a load', has((await fn('save_sale_entry', draft)).error, 'Only Finance or the Owner can record a sale entry'));
  as(FA);
  ok('cash names the person holding it', has((await fn('save_sale_entry', { ...draft, cashHandledById: null })).error, 'Record who received the cash on this load'));
  ok('a trader from another farm is not a trader', has((await fn('save_sale_entry', { ...draft, traderId: 'trb' })).error, 'Select the trader this sale is against'));
  as(OB);
  ok("Farm B's Owner cannot bill against Farm A's trader", has((await fn('save_sale_entry', { ...draft, traderId: 'tra' })).error, 'Select the trader this sale is against'));
  as(FA);
  ok('a load needs a shed on it', has((await fn('save_sale_entry', { ...draft, lines: [] })).error, 'Enter the trays sold from at least one shed'));
  ok('a shed from another farm is refused', has((await fn('save_sale_entry', { ...draft, lines: [{ shedId: 'sb', byGrade: { good: 5 } }] })).error, 'A shed on this entry does not belong to this company'));
  ok('an empty shed is not a line', has((await fn('save_sale_entry', { ...draft, lines: [{ shedId: 'sa', byGrade: { good: 0 } }] })).error, 'Enter the trays sold from at least one shed'));
  ok('a grade sold without a rate is named', has((await fn('save_sale_entry', { ...draft, rates: { good: 6 } })).error, 'Set a per-egg rate for the broken trays'));
  ok('an agreed figure of nothing is not a sale', has((await fn('save_sale_entry', { ...draft, pricing: 'AGREED', agreedAmount: 0 })).error, 'Enter the amount collected for this sale'));
  ok('money cannot be negative', has((await fn('save_sale_entry', { ...draft, cash: -1, cashHandledById: FA })).error, 'Amounts cannot be negative'));
  ok('trays the shed does not have are refused', has((await fn('save_sale_entry', { ...draft, lines: [{ shedId: 'sa', byGrade: { good: 500 } }] })).error, 'A-shed has only 100 good trays left in stock'));

  // ---- the write, kept for the rest of the run ----
  const r = await fn('save_sale_entry', draft);
  voucher = r.r?.id;
  ok('created', r.r?.created === true && r.r?.ok === true, JSON.stringify(r));
  ok('60 trays leave the sheds', r.r?.trays === 60, JSON.stringify(r.r));
  ok('eggs priced per egg: 30×30×6 + 10×30×4 + 20×30×6 = 10200', eq(r.r?.amount, 10200), JSON.stringify(r.r));
  ok('labour sits on top of the egg money, never inside its rate', eq(r.r?.billed, 10700) && eq(r.r?.credit, 2700), JSON.stringify(r.r));

  const tt = (await step(`select kind, amount, trays, rate, payment_method, split, time, handled_by from trader_txns where ref_id=$1 order by kind`, [voucher])).rows;
  ok('the trader is billed for the whole load once', tt?.length === 2 && eq(tt.find(t => t.kind === 'EGG_SALE')?.amount, 10700), JSON.stringify(tt));
  ok('the ₹/egg on the ledger is off egg money alone (10200/1800 = 5.67)', eq(tt.find(t => t.kind === 'EGG_SALE')?.rate, 5.67, 0.001), JSON.stringify(tt));
  const pay = tt?.find(t => t.kind === 'PAYMENT_IN');
  ok('what was handed over is credited, in three channels', eq(pay?.amount, 8000) && pay?.payment_method === null
     && eq(pay?.split?.cash, 5000) && eq(pay?.split?.online, 1000) && eq(pay?.split?.advance, 2000), JSON.stringify(pay));
  ok('the advance is not read as cash collected today', has(JSON.stringify(pay?.split), 'advance') && pay?.time === '11:20:00', JSON.stringify(pay));

  const fx = (await step(`select kind, amount, split, batch_id from finance_txns where ref_id=$1 order by amount desc`, [voucher])).rows;
  const income = fx?.filter(f => f.kind === 'INCOME') ?? [];
  const labour = fx?.filter(f => f.kind === 'EXPENSE') ?? [];
  ok('one income + one labour pair per shed line', income.length === 2 && labour.length === 2, JSON.stringify(fx));
  ok('the parts add back to the whole to the paisa: income 8000', income.reduce((s, f) => s + Number(f.amount), 0) === 8000, JSON.stringify(income));
  ok('…and labour 500', labour.reduce((s, f) => s + Number(f.amount), 0) === 500, JSON.stringify(labour));
  ok('the last line carries the remainder, not a rounding hole',
     eq(income[0]?.amount, 5333.33) && eq(income[1]?.amount, 2666.67), JSON.stringify(income));
  ok('each line keeps its own shed’s batch', income.every(f => f.batch_id === 'ba' || f.batch_id === 'ba2'), JSON.stringify(income));
  ok('money is not invented by an empty channel', income.every(f => Object.keys(f.split ?? {}).length > 0), JSON.stringify(income.map(f => f.split)));

  const pos = (await step(`select trays, billed, voucher_paid, outstanding, status from v_sale_entry_position where sale_entry_id=$1`, [voucher])).rows?.[0];
  ok('the receivable is read back off the ledger the function just wrote',
     eq(pos?.billed, 10700) && eq(pos?.voucher_paid, 8000) && eq(pos?.outstanding, 2700) && pos?.status === 'PARTIAL', JSON.stringify(pos));
  const tb = (await step(`select balance, billed, received from v_trader_balance where trader_id='tra'`)).rows?.[0];
  ok('the trader’s balance is the same 2700, not a stored cache',
     eq(tb?.balance, 2700) && eq(tb?.billed, 10700) && eq(tb?.received, 8000), JSON.stringify(tb));
  const stock = (await step(`select grade, balance from v_egg_stock where shed_id='sa'`)).rows;
  ok('the pools drop by exactly what left', eq(stock.find(s => s.grade === 'GOOD')?.balance, 70)
     && eq(stock.find(s => s.grade === 'BROKEN')?.balance, 10), JSON.stringify(stock));

  // ---- editing replaces, never doubles ----
  const edit = await fn('save_sale_entry', {
    id: voucher, traderId: 'tra', date: D.sale, pricing: 'RATE', rates: { good: 6 },
    lines: [{ shedId: 'sa', byGrade: { good: 10 } }],
  });
  ok('an edit keeps the same voucher', edit.r?.id === voucher && edit.r?.created === false, JSON.stringify(edit));
  ok('one line replaces two', (await step(`select count(*)::int n from sale_entry_lines where sale_entry_id=$1`, [voucher])).rows?.[0]?.n === 1);
  ok('its ledger rows are replaced, not appended',
     (await step(`select count(*)::int n from trader_txns where ref_id=$1`, [voucher])).rows?.[0]?.n === 1
     && (await step(`select count(*)::int n from finance_txns where ref_id=$1`, [voucher])).rows?.[0]?.n === 0);
  ok('10 trays × 30 × ₹6 = 1800 billed with nothing handed over', eq(edit.r?.billed, 1800) && eq(edit.r?.paid, 0), JSON.stringify(edit.r));
  ok('the shed gets its 20 unused trays back', eq((await step(`select balance from v_egg_stock where shed_id='sa2' and grade='GOOD'`)).rows?.[0]?.balance, 50));
  as(null);   // the audit trail is the Owner's read, not Finance's
  const audit = (await step(`select action, field, old_value from audit where entity='SaleEntry' and entity_id=$1`, [voucher])).rows;
  const upd = audit?.find(a => a.action === 'UPDATE');
  ok('the correction is audited as a change of amount', audit?.length === 2 && upd?.field === 'amount'
     && eq(upd?.old_value?.amount, 10200), JSON.stringify(audit));
  as(FA);
}

// ============================= 4. THE MEDICINE SHELF =============================

head('the medicine shelf keeps the godown’s averages (receive / issue / adjust)');
{
  as(FA);
  ok('Finance does not draw from the shelf', !!(await fn('receive_medicine', { medicineId: 'mi', date: D.medA, qty: 1, ratePerUnit: 1, supplier: 'x' })).error);
  as(OA);
  const r1 = await fn('receive_medicine', { medicineId: 'mi', date: D.medA, qty: 100, ratePerUnit: 10, supplier: 'Vet Supplies', lotNumber: 'L1', expiryDate: shift(today, 200) });
  const r2 = await fn('receive_medicine', { medicineId: 'mi', date: D.medB, qty: 100, ratePerUnit: 20, supplier: 'Vet Supplies' });
  ok('a medicine receipt is numbered in its own MED series', has(r2.r?.purchaseRef, `MED-${D.medB}-`), JSON.stringify(r2));
  ok('100 @ ₹10 then 100 @ ₹20 averages ₹15, not ₹20',
     eq((await position('mi', D.medB, 'medicine'))?.average, 15));
  ok('a purchase with no supplier is refused', has((await fn('receive_medicine', { medicineId: 'mi', date: D.medA, qty: 5, ratePerUnit: 5 })).error, 'Record the supplier this stock was bought from'));
  ok('stock that arrives already expired is refused', has((await fn('receive_medicine', { medicineId: 'mi', date: D.medB, qty: 5, ratePerUnit: 5, supplier: 'x', expiryDate: D.medA })).error, 'The expiry date is before the day it arrived'));
  ok('an unknown item is not a shelf row', has((await fn('receive_medicine', { medicineId: 'zz', date: D.medB, qty: 5, ratePerUnit: 5, supplier: 'x' })).error, 'Choose the medicine or vaccine'));

  const use = await fn('medicine_issue', { medicineId: 'mi', date: D.medUse, qty: 10, shedId: 'sa', batchId: 'ba', reason: 'Drinking water', usedBy: 'Ravi' });
  ok('a draw costs the average in force that day (10 × 15 = 150)', eq(use.r?.expense, 150) && eq(use.r?.average, 15), JSON.stringify(use));
  const mid = (await step(`select kg, average, value from app.valuation_at('ca','medicine','mi',$1)`, [D.medUse])).rows?.[0];
  ok('and leaves the average where it was', eq(mid?.kg, 190) && eq(mid?.average, 15) && eq(mid?.value, 2850), JSON.stringify(mid));
  ok('a dry run costs the same without touching the shelf',
     eq((await fn('medicine_issue', { medicineId: 'mi', date: D.medUse, qty: 10, shedId: 'sa', reason: 'check', usedBy: 'Ravi' }, false)).r?.expense, 150)
     && (await step(`select count(*)::int n from medicine_stock where date=$1 and kind='USAGE'`, [D.medUse])).rows?.[0]?.n === 1);
  ok('drawing more than the shelf holds is refused', has((await fn('medicine_issue', { medicineId: 'mi', date: D.medUse, qty: 500, shedId: 'sa', reason: 'x', usedBy: 'Ravi' })).error, 'Only 190 dose of Newcastle vaccine in stock'));
  ok('a batch must live in the shed it is dosed in', has((await fn('medicine_issue', { medicineId: 'mi', date: D.medUse, qty: 1, shedId: 'sa', batchId: 'ba2', reason: 'x', usedBy: 'Ravi' })).error, 'A2 is not in A-shed'));
  ok('who used it is part of the record', has((await fn('medicine_issue', { medicineId: 'mi', date: D.medUse, qty: 1, shedId: 'sa', reason: 'x', usedBy: ' ' })).error, 'Enter who used it'));
  ok('a purpose is part of the record', has((await fn('medicine_issue', { medicineId: 'mi', date: D.medUse, qty: 1, shedId: 'sa', usedBy: 'Ravi' })).error, 'Say what it was used for'));

  const adj = await fn('adjust_medicine', { medicineId: 'mi', date: D.medAdj, qty: -5, reason: 'broken vial' });
  ok('a counted correction is signed and needs a reason', adj.r?.ok === true
     && eq((await step(`select kg from app.valuation_at('ca','medicine','mi',$1)`, [D.medAdj])).rows?.[0]?.kg, 185));
  ok('no reason, no correction', has((await fn('adjust_medicine', { medicineId: 'mi', date: D.medAdj, qty: -1 })).error, 'Say why the count is being corrected'));
  ok('a shelf cannot be corrected below zero', has((await fn('adjust_medicine', { medicineId: 'mi', date: D.medAdj, qty: -1000, reason: 'x' })).error, 'Only 185 dose in stock — this correction would take the shelf below zero'));
}

// ============================= 5. COMPLETING A VACCINATION =============================

head('completing a dose books stock and history together (app.complete_vaccination)');
{
  as(FA);
  ok('a money-only role never even sees the health row — RLS, not the RPC, decides',
     has((await fn('complete_vaccination', 'va', { completedDate: D.vacc, completedBy: 'Ravi' })).error, 'Vaccination not found'));
  ok('…and the batch grant agrees: no completeVaccination reach',
     (await step(`select app.can_on_batch('ca','ba','completeVaccination') as can`)).rows?.[0]?.can === false);
  as(LA);
  ok('Labor does have it', (await step(`select app.can_on_batch('ca','ba','completeVaccination') as can`)).rows?.[0]?.can === true);
  as(OB);
  ok('another farm cannot even see it', has((await fn('complete_vaccination', 'va', { completedDate: D.vacc, completedBy: 'Ravi' })).error, 'Vaccination not found'));
  as(LA);
  ok('a dose cannot be given in the future', has((await fn('complete_vaccination', 'vb', { completedDate: D.future, completedBy: 'Ravi' })).error, 'A vaccination cannot be given on a future date'));
  ok('who gave it is asked for', has((await fn('complete_vaccination', 'vc', { completedDate: D.vacc })).error, 'Enter who administered it'));
  ok('the date is asked for', has((await fn('complete_vaccination', 'vc', { completedBy: 'Ravi' })).error, 'Choose the date it was given'));
  as(null);
  await must(`update batches set status='CLOSED' where id='ba2'`);
  await must(`insert into batch_closings (batch_id,company_id,date,final_birds) values ('ba2','ca',$1,780)`, [D.coll]);
  as(LA);
  ok('a closed flock’s schedule stands as history', has((await fn('complete_vaccination', 'vd', { completedDate: D.vacc, completedBy: 'Ravi' })).error, 'This batch is closed — its vaccination schedule stands as history'));

  as(OA);
  const done = await fn('complete_vaccination', 'va', {
    completedDate: D.vacc, completedBy: 'Ravi', actualDose: '0.5 ml', completionRemarks: 'Group immunity ok',
    medicineId: 'mi', medicineQty: 5,
  });
  ok('given two days late, and it says so', done.r?.lateBy === 2, JSON.stringify(done));
  ok('the dose cost the average in force that day (5 × 15 = 75)', eq(done.r?.expense, 75), JSON.stringify(done));
  const uses = (await step(`select kind, qty, rate_per_unit, amount, used_by, batch_id from medicine_stock where vaccination_id='va'`)).rows;
  ok('one dose, one usage row, priced at booking', uses?.length === 1 && eq(uses[0]?.amount, 75) && uses[0]?.used_by === 'Ravi', JSON.stringify(uses));
  ok('the shelf went down by the dose and no further',
     eq((await step(`select kg from app.valuation_at('ca','medicine','mi',$1)`, [D.vacc])).rows?.[0]?.kg, 180));
  const v = (await step(`select status, completed_date, completed_by, actual_dose from vaccinations where id='va'`)).rows?.[0];
  ok('completed_by keeps the name somebody typed, not an id', v?.status === 'COMPLETED' && v?.completed_by === 'Ravi' && v?.actual_dose === '0.5 ml', JSON.stringify(v));
  const why = (await step(`select reason, field from audit where entity='Vaccination' and entity_id='va' order by field`)).rows;
  ok('both history rows carry the same reason', has(why?.[0]?.reason, '2 days late') && has(why?.[0]?.reason, '5 drawn from the medicine store'), JSON.stringify(why));
  ok('reopening a completed dose is refused', has((await fn('complete_vaccination', 'va', { completedDate: D.vacc, completedBy: 'Ravi', medicineId: 'mi', medicineQty: 5 })).error, 'This vaccination is already recorded'));
  ok('…so a second dose never reaches the shelf', (await step(`select count(*)::int n from medicine_stock where vaccination_id='va'`)).rows?.[0]?.n === 1);
}

// ============================= 6. A FORMULA REVISION =============================

head('a formula that has fed is never rewritten (app.revise_feed_formula)');
{
  const mix = [{ ingredient: ' Maize ', kgPerTonne: 450.4 }, { ingredient: 'Soybean', kgPerTonne: 350 }];
  as(SA);
  ok('a supervisor not named on this shed cannot edit its mix', has((await fn('revise_feed_formula', 'ff1', { name: 'Layer Grow', items: mix })).error, 'You cannot manage formulas for this shed'));
  as(LA);
  ok('Labor cannot either', has((await fn('revise_feed_formula', 'ff1', { name: 'Layer Grow', items: mix })).error, 'You cannot manage formulas for this shed'));
  as(FA);
  ok('Finance has no formula key at all', has((await fn('revise_feed_formula', 'ff1', { name: 'Layer Grow', items: mix })).error, 'You cannot manage formulas for this shed'));
  as(null);
  await must(`update sheds set farm_supervisor_id=$1 where id='sa'`, [SA]);
  await must(`insert into batch_assignments (id,company_id,batch_id,user_id,role,permissions)
               values ('asn1','ca','ba',$1,'FARM_MANAGER','{"manageFormulas": true}'::jsonb)`, [uuid(9)]);
  as(uuid(9));
  ok('a Farm Manager reaches it only through a batch grant', has((await fn('revise_feed_formula', 'ff1', { name: 'x', items: [] })).error, 'Add at least one ingredient with a quantity'));
  as(SA);
  ok('the named supervisor of this shed can revise it', has((await fn('revise_feed_formula', 'ff1', { name: '', items: mix })).error, 'Formula name is required'));
  const dup = await fn('revise_feed_formula', 'ff1', { name: 'Layer Grow', items: [...mix, { ingredient: 'maize', kgPerTonne: 10 }] });
  ok('an ingredient typed twice is the mix refusing', has(dup.error, 'appears twice in the mix'), show(dup));
  const first = await fn('revise_feed_formula', 'ff1', { name: 'Layer Grow R1', items: mix });
  ok('unused yet → corrected in place, same id and version 1', first.r?.id === 'ff1' && first.r?.version === 1, JSON.stringify(first));
  ok('quantities round to 2 dp and blanks are dropped', eq(first.r?.totalKg, 450.4 + 350)
     && (await step(`select count(*)::int n from feed_formula_items where formula_id='ff1'`)).rows?.[0]?.n === 2);
  ok('the trimmed name is what was stored', (await step(`select name from feed_formulas where id='ff1'`)).rows?.[0]?.name === 'Layer Grow R1');

  as(null);
  await must(`insert into feed_consumption (id,company_id,shed_id,batch_id,date,tonnes,formula_id,formula_version,formula_name)
               values ('fc1','ca','sa','ba',$1,1,'ff1',1,'Layer Grow R1')`, [D.consume]);
  as(SA);
  const second = await fn('revise_feed_formula', 'ff1', {
    name: 'Layer Grow R2', effectiveFrom: D.consume, changeReason: 'maize dearer',
    items: [{ ingredient: 'Maize', kgPerTonne: 500 }],
  });
  ok('used → a new version under the same family', second.r?.id !== 'ff1' && second.r?.version === 2, JSON.stringify(second));
  const old = (await step(`select status, superseded_at from feed_formulas where id='ff1'`)).rows?.[0];
  ok('the version September fed is now inactive, not edited', old?.status === 'INACTIVE' && !!old?.superseded_at, JSON.stringify(old));
  ok('…and still carries its own mix', (await step(`select count(*)::int n, coalesce(sum(kg_per_tonne),0) s from feed_formula_items where formula_id='ff1'`)).rows?.[0]?.s == 800.4);
  ok('the new version holds only the new mix',
     (await step(`select count(*)::int n from feed_formula_items where formula_id=$1`, [second.r?.id])).rows?.[0]?.n === 1);
  ok('the change reason is kept on the version that explains it',
     (await step(`select change_reason from feed_formulas where id=$1`, [second.r?.id])).rows?.[0]?.change_reason === 'maize dearer');
  const fam = (await step(`select count(*)::int n from feed_formulas where family_id='fam1'`)).rows?.[0]?.n;
  ok('one family, two versions, no duplicates', fam === 2, String(fam));
  const moved = await fn('revise_feed_formula', 'ff1', { name: 'Layer Grow R3', shedId: 'sa2', items: mix });
  ok('a shed asked for on a used version is ignored — its history stays where it fed',
     has(moved.error ?? '', 'You cannot manage') === false
     && (await step(`select shed_id from feed_formulas where id=$1`, [moved.r?.id])).rows?.[0]?.shed_id === 'sa',
     JSON.stringify({ moved, shed: (await step(`select shed_id from feed_formulas where id=$1`, [moved.r?.id])).rows?.[0] }));
  as(null);
  const kinds = (await step(`select action, field from audit where entity='FeedFormula'`)).rows;
  ok('a correction audits as UPDATE, a version as CREATE',
     kinds?.some(k => k.action === 'UPDATE' && k.field === 'items') && kinds?.some(k => k.action === 'CREATE' && k.field === null),
     JSON.stringify(kinds));
  as(SA);
}

// ============================= 7. THE MONEY THAT SETTLES A BILL =============================

head('paying for a receipt, and paying in against a load (record_*_payment)');
{
  const maizeId = (await step(`select id from feed_stock where kind='FEED_IN' and ingredient='Maize'`)).rows?.[0]?.id;
  const medId = (await step(`select id from medicine_stock where kind='RECEIPT' order by date limit 1`)).rows?.[0]?.id;
  as(LA);
  ok('Labor has no part in payments', has((await fn('record_purchase_payment', { purchaseId: maizeId, date: D.feedIn, amount: 10, paymentMethod: 'CASH', handledById: LA })).error, 'Only Finance/Owner can record a payment'));
  as(FA);
  const over = await fn('record_purchase_payment', { purchaseId: maizeId, date: D.feedIn, amount: 40000, paymentMethod: 'CASH', handledById: FA });
  ok('over-paying a receipt is refused, and says what is left', has(over.error, 'Only 32000.00 is still due on this purchase'), show(over));
  ok('the channel is asked for', has((await fn('record_purchase_payment', { purchaseId: maizeId, date: D.feedIn, amount: 100 })).error, 'Select how the money was paid'));
  ok('cash names who paid it', has((await fn('record_purchase_payment', { purchaseId: maizeId, date: D.feedIn, amount: 100, paymentMethod: 'CASH' })).error, 'Record who paid the cash'));
  ok('a consumption carries no payable', has((await fn('record_purchase_payment', { purchaseId: (await step(`select id from feed_stock where kind='FEED_OUT' limit 1`)).rows?.[0]?.id, date: D.feedIn, amount: 1, paymentMethod: 'CASH', handledById: FA })).error, 'Only a stock purchase carries a payable'));
  ok('money cannot settle a receipt that does not exist', has((await fn('record_purchase_payment', { purchaseId: 'zz', date: D.feedIn, amount: 1, paymentMethod: 'CASH', handledById: FA })).error, 'Select the purchase this payment settles'));

  const p1 = await fn('record_purchase_payment', { purchaseId: maizeId, date: D.feedIn, amount: 20000, paymentMethod: 'CASH', handledById: FA, reference: 'Anand' });
  const p2 = await fn('record_purchase_payment', { purchaseId: maizeId, date: shift(D.feedIn, 3), amount: 12000, paymentMethod: 'PHONEPE' });
  ok('two instalments close 1000 kg @ ₹32', eq(p1.r?.outstanding, 12000) && eq(p2.r?.outstanding, 0), JSON.stringify({ p1: p1.r, p2: p2.r }));
  const rows = (await step(`select kind, category, godown, amount, payment_method, counterparty from finance_txns where purchase_id=$1 order by amount`, [maizeId])).rows;
  ok('both land in Finance as money out of the godown', rows?.length === 2 && rows.every(f => f.kind === 'PAYMENT_OUT' && f.godown === true && f.category === 'Feed Purchase')
     && eq(rows.reduce((s, f) => s + Number(f.amount), 0), 32000), JSON.stringify(rows));
  const shelf = (await step(`select qty_kg, rate_per_kg from feed_stock where id=$1`, [maizeId])).rows?.[0];
  ok('paying for it never restates the stock', eq(shelf?.qty_kg, 1000) && eq(shelf?.rate_per_kg, 32), JSON.stringify(shelf));
  const mp = await fn('record_purchase_payment', { purchaseId: medId, date: D.medB, amount: 1000, paymentMethod: 'CASH', handledById: FA });
  ok('a medicine receipt is settled the same way, under its own category',
     eq(mp.r?.value, 1000) && (await step(`select category from finance_txns where purchase_id=$1`, [medId])).rows?.[0]?.category === 'Medicine Purchase', JSON.stringify(mp));

  // ---- a receipt against a load: two books, no re-billing ----
  const due = (await step(`select outstanding from v_sale_entry_position where sale_entry_id=$1`, [voucher])).rows?.[0];
  as(LA);
  ok('Labor cannot receive money for the farm', has((await fn('record_sale_payment', { saleId: voucher, date: D.sale, amount: 100, paymentMethod: 'CASH', handledById: LA })).error, 'Only Finance/Owner can record a receipt against a sale'));
  as(FA);
  const oversale = await fn('record_sale_payment', { saleId: voucher, date: D.sale, amount: 5000, paymentMethod: 'CASH', handledById: FA });
  ok('more than the load still owes is refused', has(oversale.error, 'Only 1800.00 is still due on this sale'), show(oversale));
  ok('a receipt names its sale', has((await fn('record_sale_payment', { saleId: 'zz', date: D.sale, amount: 100, paymentMethod: 'CASH', handledById: FA })).error, 'Select the sale this money was received against'));
  const rec = await fn('record_sale_payment', { saleId: voucher, date: shift(D.sale, 2), amount: 1000, paymentMethod: 'CASH', handledById: FA });
  ok('it settles 1000 of the 1800 the ledger says is owed', eq(N(due?.outstanding), 1800) && eq(rec.r?.outstanding, 800), JSON.stringify({ due, rec: rec.r }));
  const books = (await step(`select split, payment_method, handled_by, sale_id, ref_id from trader_txns where id=$1`, [rec.r?.traderTxnId])).rows?.[0];
  ok('the trader row points at the sale, not at the voucher’s own rows',
     books?.sale_id === voucher && books?.ref_id === null && eq(books?.split?.cash, 1000) && !!books?.handled_by, JSON.stringify(books));
  const fin = (await step(`select kind, category, amount, counterparty from finance_txns where id=$1`, [rec.r?.financeId])).rows?.[0];
  ok('the finance row is the money in, against the same load',
     fin?.kind === 'PAYMENT_IN' && fin?.category === 'Egg Sale' && fin?.counterparty === 'A trader' && eq(fin?.amount, 1000), JSON.stringify(fin));
  ok('the voucher still shows one billing and one receipt',
     (await step(`select count(*)::int n from trader_txns where ref_id=$1`, [voucher])).rows?.[0]?.n === 1);
  const after = (await step(`select paid, outstanding, status from v_sale_entry_position where sale_entry_id=$1`, [voucher])).rows?.[0];
  ok('and the receivable falls to 800 without touching the voucher',
     eq(after?.paid, 1000) && eq(after?.outstanding, 800) && after?.status === 'PARTIAL', JSON.stringify(after));
  ok('the trader’s balance moves with it', eq((await step(`select balance from v_trader_balance where trader_id='tra'`)).rows?.[0]?.balance, 800));

  // ---- deleting the voucher: its own rows go, a later receipt stays ----
  as(FA);
  ok('Finance cannot delete a voucher', has((await fn('delete_sale_entry', voucher)).error, 'Only the Owner can delete a sale entry'));
  as(OA);
  const del = await fn('delete_sale_entry', voucher);
  ok('the Owner can', del.r?.ok === true, JSON.stringify(del));
  ok('its lines and its own ledger rows are gone',
     (await step(`select count(*)::int n from sale_entry_lines where sale_entry_id=$1`, [voucher])).rows?.[0]?.n === 0
     && (await step(`select count(*)::int n from trader_txns where ref_id=$1`, [voucher])).rows?.[0]?.n === 0);
  const stray = (await step(`select sale_id, amount from trader_txns where trader_id='tra' and kind='PAYMENT_IN'`)).rows;
  ok('a receipt made after the load survives as its own fact',
     stray?.length === 1 && stray[0]?.sale_id === null && eq(stray[0]?.amount, 1000), JSON.stringify(stray));
  ok('the trays come back to the pool', eq((await step(`select balance from v_egg_stock where shed_id='sa' and grade='GOOD'`)).rows?.[0]?.balance, 100));
}

// ============================= 8. DEFINER / INVOKER, PROVEN NOT ASSUMED =============================

head('who the function reads as (definer where a wrong answer is possible, invoker otherwise)');
{
  as(LA);
  ok('Labor cannot read the godown table…', (await step(`select count(*)::int n from feed_stock`)).rows?.[0]?.n === 0);
  ok('…yet still gets the true average, because the read must not depend on their policies',
     eq((await step(`select average from app.valuation_at('ca','godown','Soybean',$1)`, [D.soy3])).rows?.[0]?.average, 50)
     && eq(N((await fn('godown_kg', 'ca', 'Maize')).r), 550));
  as(FA);
  ok('an invoker write still needs the caller’s own key', !!(await fn('add_feed_stock', { kind: 'FEED_IN', date: D.feedIn, ingredient: 'Wheat', qtyKg: 10, ratePerKg: 5, supplier: 'x' })).error);
  ok('and it wrote nothing', (await step(`select count(*)::int n from feed_stock where ingredient='Wheat'`)).rows?.[0]?.n === 0);
  as(null);
}

await c.query('rollback');
console.log('\nrolled back — nothing this run wrote is left behind');
await c.end();
console.log(fails ? `\n${fails} RPC problem(s)` : '\nThe RPCs match the store');
process.exit(fails ? 1 : 0);
