import pg from 'pg';
const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const c = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: process.env.SUPABASE_DB_CA ? { ca: (await import('node:fs')).readFileSync(process.env.SUPABASE_DB_CA, 'utf8') } : { rejectUnauthorized: false },
});
await c.connect();

const names = (await c.query(
  "select table_name from information_schema.views where table_schema='public' order by 1")).rows.map(r => r.table_name);
console.log(`views: ${names.length}`, names.join(' '));

// Execute every view: forces the planner to run, not just to resolve names.
let bad = 0;
for (const n of names) {
  try { const r = await c.query(`select * from public.${n} limit 1`); console.log(`  ${n.padEnd(32)} ok (${r.rowCount} row sample)`); }
  catch (e) { bad++; console.log(`  ${n.padEnd(32)} FAIL ${e.message}`); }
}

// Round-trip the one thing a wrong CHECK/enum would break: insert then read back through views.
const seed = async (sql, params) => { const r = await c.query(sql, params); return r.rowCount; };
const day = new Date().toISOString().slice(0, 10);
try {
  await c.query('begin');
  await seed(`insert into companies (id,name) values ('_t_c','_test')`);
  await seed(`insert into farms (id,company_id,name) values ('_t_f','_t_c','Test farm')`);
  await seed(`insert into sheds (id,company_id,farm_id,name,capacity) values ('_t_s','_t_c','_t_f','S1',1000)`);
  await seed(`insert into batches (id,company_id,farm_id,shed_id,code,bird_type,placement_date,start_date,initial_birds)
              values ('_t_b','_t_c','_t_f','_t_s','B1','LAYER',$1,$1,100)`, [day]);
  await seed(`insert into mortality (id,company_id,batch_id,shed_id,date,count) values ('_t_m','_t_c','_t_b','_t_s',$1,5)`, [day]);
  await seed(`insert into traders (id,company_id,name,opening_balance) values ('_t_tr','_t_c','Test trader',1000)`);
  await seed(`insert into sale_entries (id,company_id,trader_id,date,pricing,amount,cash,phonepe,advance,labor_charge)
              values ('_t_se','_t_c','_t_tr',$1,'RATE',500,100,0,0,50)`, [day]);
  await seed(`insert into sale_entry_lines (sale_entry_id,position,shed_id,good_trays,broken_trays,double_trays,small_trays)
              values ('_t_se',0,'_t_s',10,1,0,0)`);
  await seed(`insert into trader_txns (id,company_id,trader_id,date,kind,amount,ref_id,sale_id)
              values ('_t_tt','_t_c','_t_tr',$1,'EGG_SALE',550,'_t_se','_t_se')`, [day]);
  await seed(`insert into trader_txns (id,company_id,trader_id,date,kind,amount,sale_id,payment_method)
              values ('_t_tt2','_t_c','_t_tr',$1,'PAYMENT_IN',200,'_t_se','CASH')`, [day]);
  await seed(`insert into egg_collections (id,company_id,batch_id,shed_id,date,good_trays,broken_trays,double_trays,small_trays)
              values ('_t_ec','_t_c','_t_b','_t_s',$1,40,2,1,0)`, [day]);
  await seed(`insert into feed_stock (id,company_id,ingredient,date,kind,qty_kg,rate_per_kg,supplier,purchase_ref)
              values ('_t_fs','_t_c','Maize',$1,'FEED_IN',1000,30,'Sup','PUR-1')`, [day]);
  await seed(`insert into feed_stock (id,company_id,ingredient,date,kind,qty_kg)
              values ('_t_fs2','_t_c','Maize',$1,'SHORTAGE',-40)`, [day]);
  await seed(`insert into finance_txns (id,company_id,date,kind,amount,category,purchase_id,godown)
              values ('_t_ft','_t_c',$1,'EXPENSE',600,'Feed Purchase','_t_fs',true)`, [day]);
  await seed(`insert into medicine_items (id,company_id,name,category,unit,low_stock_threshold)
              values ('_t_mi','_t_c','Vax A','VACCINE','vial',5)`);
  await seed(`insert into medicine_stock (id,company_id,medicine_id,date,kind,qty,rate_per_unit)
              values ('_t_ms','_t_c','_t_mi',$1,'RECEIPT',10,20)`, [day]);
  await seed(`insert into medicine_stock (id,company_id,medicine_id,date,kind,qty,shed_id)
              values ('_t_ms2','_t_c','_t_mi',$1,'USAGE',3,'_t_s')`, [day]);
  await seed(`insert into vaccinations (id,company_id,batch_id,shed_id,relative_day,vaccine_name,scheduled_date,reminder_days_before)
              values ('_t_v','_t_c','_t_b','_t_s',7,'Newcastle',($1::date + 2),3)`, [day]);

  const show = async (label, sql) => {
    const r = await c.query(sql);
    console.log(`${label}:`, JSON.stringify(r.rows[0] ?? null));
  };
  await show('flock', `select live_birds,mortality_to_date,age_days from v_batch_flock where batch_id='_t_b'`);
  await show('egg GOOD', `select collected,dispatched,balance from v_egg_stock where shed_id='_t_s' and grade='GOOD'`);
  await show('godown', `select qty_kg,status from v_godown_stock where company_id='_t_c'`);
  await show('medicine', `select qty,low_stock from v_medicine_stock where medicine_id='_t_mi'`);
  await show('trader', `select billed,received,balance from v_trader_balance where trader_id='_t_tr'`);
  await show('ledger running', `select kind,effect,running from v_trader_ledger where trader_id='_t_tr' order by date,running`);
  await show('sale position', `select billed,voucher_paid,voucher_credit,later_receipts,paid,outstanding,status from v_sale_entry_position where sale_entry_id='_t_se'`);
  await show('purchase', `select qty,rate_per_unit,value,paid,outstanding,status from v_purchase_payment where receipt_id='_t_fs'`);
  await show('unlinked', `select count(*)::int n from v_unlinked_purchase_payment where company_id='_t_c'`);
  await show('vaccination', `select state,to_go,needs_attention from v_vaccination_state where vaccination_id='_t_v'`);
  await c.query('rollback');
  console.log('scenario rolled back');
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.log('SCENARIO FAIL', e.message);
  bad++;
}
console.log(bad ? `${bad} problem(s)` : 'all views execute clean');
await c.end();
