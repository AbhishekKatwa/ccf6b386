-- ============================= AMRUT POULTRY · 002 DERIVED VIEWS =============================
/*
 * Everything in this file is a READ of rows that already exist. No view stores a figure the
 * app would otherwise derive, so there is exactly one source of truth per number — the ledger.
 *
 * Each view names the client function it reproduces (file + symbol) so the two can be diffed
 * when either side changes. Where the client function takes an `asOf`/`today` argument, the
 * view resolves it against `current_date`; the same SQL with a date bind parameter is the
 * historical read, and 004 exposes those as functions where a screen needs them.
 *
 * Money is rounded to 2dp exactly where the client rounds it (`round2`), so a figure shown
 * from Postgres and one shown from the browser are the same digits, not two conventions.
 *
 * Deliberately NOT here: the godown's weighted-average valuation (src/lib/valuation.ts walks
 * the ledger chronologically and carries state between rows — a set-based view would read as
 * an independent implementation of it) and the feed-coverage forecast (planning-only, and it
 * depends on the same valuation).
 */

-- ============================= TRADERS =============================

/**
 * src/lib/calc.ts · txnSignedAmount — how one ledger row moves the balance it sits on.
 * The OPENING and RATE_UPDATE rows are information, not movement, so they carry 0.
 */
create or replace view v_trader_txn_effect as
select
  t.id                                          as txn_id,
  t.company_id,
  t.trader_id,
  t.date,
  t.kind,
  t.amount,
  case t.kind
    when 'EGG_SALE'    then t.amount
    when 'PAYMENT_OUT' then t.amount
    when 'PAYMENT_IN'  then -t.amount
    else 0
  end                                           as effect,
  case t.kind
    when 'OPENING'     then 'Opening balance'
    when 'EGG_SALE'    then 'Egg sale billed'
    when 'PAYMENT_IN'  then 'Payment received'
    when 'PAYMENT_OUT' then 'Additional billed'
    when 'RATE_UPDATE' then 'Rate revision'
  end                                           as label
from public.trader_txns t;

/**
 * src/lib/calc.ts · traderLedger — the trader's statement with its running column.
 * Oldest-first replay, newest booking on top within a day (BOOKED_FIRST), so the last row of
 * the replay is always the balance; the display order is reversed afterwards.
 */
create or replace view v_trader_ledger as
select
  e.txn_id,
  e.company_id,
  e.trader_id,
  tr.name          as trader_name,
  e.date,
  e.kind,
  e.label,
  e.amount,
  e.effect,
  round(tr.opening_balance
    + sum(e.effect) over (
        partition by e.trader_id
        order by e.date,
                 case e.kind
                   when 'OPENING'     then 0
                   when 'EGG_SALE'    then 1
                   when 'PAYMENT_OUT' then 1
                   when 'RATE_UPDATE' then 2
                   else 3
                 end,
                 tx.created_at,
                 tx.id
        rows unbounded preceding
      ), 2)        as running
from v_trader_txn_effect e
join public.traders tr on tr.id = e.trader_id
join public.trader_txns tx on tx.id = e.txn_id;

/**
 * src/lib/calc.ts · traderBalance — derived, never stored. Negative means the trader has paid
 * ahead and the farm is holding their money.
 */
create or replace view v_trader_balance as
select
  tr.company_id,
  tr.id            as trader_id,
  tr.name          as trader_name,
  tr.active,
  tr.opening_balance,
  round(coalesce(sum(e.effect), 0), 2)                        as ledger_effect,
  round(tr.opening_balance + coalesce(sum(e.effect), 0), 2)   as balance,
  coalesce(sum(e.effect) filter (where e.kind = 'EGG_SALE' or e.kind = 'PAYMENT_OUT'), 0)   as billed,
  coalesce(-sum(e.effect) filter (where e.kind = 'PAYMENT_IN'), 0)                          as received
from public.traders tr
left join v_trader_txn_effect e on e.trader_id = tr.id
group by tr.id;

/*
 * `traders.outstanding_amount` does not exist (001 removed the stored cache SalesScreen used
 * to read): v_trader_balance.balance is the one receivable figure.
 */

-- ============================= SALE ENTRIES =============================

/** Trays per grade per voucher line, un-pivoted so a grade is a row like it is a pool. */
create or replace view v_sale_entry_trays as
select l.sale_entry_id, l.shed_id, g.grade, g.trays
from public.sale_entry_lines l
cross join lateral (values
  ('GOOD',   l.good_trays),
  ('BROKEN', l.broken_trays),
  ('DOUBLE', l.double_trays),
  ('SMALL',  l.small_trays)
) as g(grade, trays)
where g.trays > 0;

/**
 * src/lib/calc.ts · salePositions / saleBilled / salePaid / saleStatus.
 * The voucher is the billing event; a receipt on the trader ledger is a separate money event.
 * `voucher_*` columns are what was handed over at the time of the load (loadPaid/loadCredit),
 * `paid`/`outstanding` add every later receipt against the same sale.
 */
create or replace view v_sale_entry_position as
with trays as (
  select sale_entry_id, sum(trays) as trays from v_sale_entry_trays group by 1
),
receipts as (
  select sale_id as sale_entry_id, sum(amount) as later_paid
  from public.trader_txns
  where kind = 'PAYMENT_IN' and sale_id is not null
  group by 1
)
select
  se.company_id,
  se.id            as sale_entry_id,
  se.trader_id,
  tr.name          as trader_name,
  se.date,
  se.pricing,
  coalesce(t.trays, 0)                              as trays,
  se.amount                                         as eggs_money,
  se.labor_charge,
  round(se.amount + se.labor_charge, 2)             as billed,
  round(se.cash + se.phonepe + se.advance, 2)       as voucher_paid,
  round(se.amount + se.labor_charge
        - (se.cash + se.phonepe + se.advance), 2)   as voucher_credit,
  coalesce(r.later_paid, 0)                         as later_receipts,
  round(se.cash + se.phonepe + se.advance + coalesce(r.later_paid, 0), 2) as paid,
  round(se.amount + se.labor_charge
        - (se.cash + se.phonepe + se.advance + coalesce(r.later_paid, 0)), 2) as outstanding,
  case
    when se.cash + se.phonepe + se.advance + coalesce(r.later_paid, 0) <= 0 then 'PENDING'
    when round(se.amount + se.labor_charge
               - (se.cash + se.phonepe + se.advance + coalesce(r.later_paid, 0)), 2) > 0 then 'PARTIAL'
    else 'PAID'
  end                                               as status
from public.sale_entries se
join public.traders tr on tr.id = se.trader_id
left join trays t on t.sale_entry_id = se.id
left join receipts r on r.sale_entry_id = se.id;

/**
 * src/lib/calc.ts · paymentStatusOf — the voucher's own standing, ignoring receipts made after
 * the load left. Kept separate because the sale sheet shows this, not the ledger-side status.
 */
create or replace view v_sale_entry_voucher_status as
select
  sale_entry_id,
  case
    when voucher_credit <= 0 then 'PAID'
    when voucher_credit >= billed then 'PENDING'
    else 'PARTIAL'
  end as voucher_status
from v_sale_entry_position;

-- ============================= EGG STOCK (TRAYS) =============================

/*
 * The date of a voucher, and nothing else about it.
 *
 * Egg stock is collected trays minus sold trays, so the operational screens have to know when
 * a load was billed — but `sale_entries` also carries every rupee of that load, and money is
 * for the accounts roles only. Read as a plain security-invoker view it would silently return
 * no dispatches for a supervisor and overstate their stock, which is a worse failure than an
 * error. So this one view runs as its owner, is scoped to companies the caller belongs to, and
 * hands out the three columns the arithmetic needs. It is the ONLY view here that does not
 * respect the caller's own rights, and it exposes no amount, rate, trader or method.
 */
create or replace view v_sale_entry_day as
select se.id as sale_entry_id, se.company_id, se.date
from public.sale_entries se
where app.member_of(se.company_id);

/**
 * src/lib/calc.ts · eggStockByGrade. Collected minus what a final sale entry moved.
 * A shed dispatch log (sale_logs) never appears here: it records a load leaving, and only the
 * accounts voucher moves stock, so an unbilled load is still unsold stock.
 */
create or replace view v_egg_stock as
with collected as (
  select c.company_id, c.shed_id, g.grade, sum(g.trays) as trays
  from public.egg_collections c
  cross join lateral (values
    ('GOOD',   c.good_trays),
    ('BROKEN', c.broken_trays),
    ('DOUBLE', c.double_trays),
    ('SMALL',  c.small_trays)
  ) as g(grade, trays)
  where c.date <= current_date and g.trays > 0
  group by 1, 2, 3
),
sold as (
  select d.company_id, l.shed_id, g.grade, sum(g.trays) as trays
  from v_sale_entry_day d
  join public.sale_entry_lines l on l.sale_entry_id = d.sale_entry_id
  cross join lateral (values
    ('GOOD',   l.good_trays),
    ('BROKEN', l.broken_trays),
    ('DOUBLE', l.double_trays),
    ('SMALL',  l.small_trays)
  ) as g(grade, trays)
  where d.date <= current_date and g.trays > 0
  group by 1, 2, 3
),
grades as (
  select shed.company_id, shed.id as shed_id, g.grade
  from public.sheds shed
  cross join (values ('GOOD'), ('BROKEN'), ('DOUBLE'), ('SMALL')) as g(grade)
)
select
  gr.company_id,
  gr.shed_id,
  sh.name  as shed_name,
  gr.grade,
  coalesce(c.trays, 0)                          as collected,
  coalesce(s.trays, 0)                          as dispatched,
  coalesce(c.trays, 0) - coalesce(s.trays, 0)   as balance
from grades gr
join public.sheds sh on sh.id = gr.shed_id
left join collected c on c.shed_id = gr.shed_id and c.grade = gr.grade
left join sold s on s.shed_id = gr.shed_id and s.grade = gr.grade;

/** src/lib/calc.ts · eggSummary — today's collection per shed, by grade. */
create or replace view v_egg_collection_today as
select c.company_id, c.shed_id, sum(c.good_trays) as good_trays, sum(c.broken_trays) as broken_trays,
       sum(c.double_trays) as double_trays, sum(c.small_trays) as small_trays,
       sum(c.good_trays + c.broken_trays + c.double_trays + c.small_trays) as total_trays
from public.egg_collections c
where c.date = current_date
group by 1, 2;

-- ============================= GODOWN (KG) =============================

/**
 * src/lib/calc.ts · stockDelta. SHORTAGE always takes stock out however it was typed, and
 * ADJUSTMENT is signed on purpose — which is why feed_stock.qty_kg carries no sign CHECK.
 */
create or replace view v_godown_movement as
select
  f.id           as entry_id,
  f.company_id,
  f.ingredient,
  f.date,
  f.kind,
  f.qty_kg,
  case f.kind
    when 'OPENING'     then f.qty_kg
    when 'FEED_IN'     then f.qty_kg
    when 'FEED_OUT'    then -f.qty_kg
    when 'CONSUMPTION' then -f.qty_kg
    when 'ADJUSTMENT'  then f.qty_kg
    when 'SHORTAGE'    then -abs(f.qty_kg)
  end            as delta_kg,
  f.rate_per_kg,
  f.shed_id,
  f.batch_id,
  f.supplier,
  f.purchase_ref
from public.feed_stock f;

/**
 * src/lib/calc.ts · godownBalances + stockStatus. The two reorder levels are the app's own
 * constants (GODOWN_LOW_KG / GODOWN_CRITICAL_KG); no per-ingredient minimum exists anywhere.
 */
create or replace view v_godown_stock as
with balance as (
  select company_id, ingredient, sum(delta_kg) as qty_kg
  from v_godown_movement
  where date <= current_date
  group by 1, 2
)
select
  b.company_id,
  b.ingredient,
  b.qty_kg,
  case
    when b.qty_kg <  500 then 'CRITICAL'
    when b.qty_kg < 1000 then 'LOW'
    else 'NORMAL'
  end as status
from balance b;

-- ============================= MEDICINE & VACCINE STORE =============================

/**
 * src/lib/medicines.ts · medicineSignedLabel's delta. USAGE only ever removes, ADJUSTMENT is
 * signed, everything else comes in.
 */
create or replace view v_medicine_movement as
select
  m.id           as entry_id,
  m.company_id,
  m.medicine_id,
  i.name         as medicine_name,
  i.category,
  i.unit,
  m.date,
  m.kind,
  m.qty,
  case m.kind
    when 'USAGE'     then -abs(m.qty)
    when 'ADJUSTMENT' then m.qty
    else abs(m.qty)
  end            as delta_qty,
  m.rate_per_unit,
  m.shed_id,
  m.batch_id,
  m.supplier,
  m.purchase_ref,
  m.lot_number,
  m.expiry_date,
  m.vaccination_id
from public.medicine_stock m
join public.medicine_items i on i.id = m.medicine_id;

/** Live shelf per item, with the item's own reorder threshold applied. */
create or replace view v_medicine_stock as
with balance as (
  select company_id, medicine_id, sum(delta_qty) as qty
  from v_medicine_movement
  where date <= current_date
  group by 1, 2
)
select
  b.company_id,
  b.medicine_id,
  i.name,
  i.category,
  i.unit,
  i.active,
  b.qty,
  i.low_stock_threshold,
  case when b.qty <= i.low_stock_threshold then true else false end as low_stock
from balance b
join public.medicine_items i on i.id = b.medicine_id;

-- ============================= FLOCK =============================

/**
 * src/lib/calc.ts · liveBirdsOn + cumulativeMortality + batchAgeDays.
 * A closed batch keeps its closing row beside these figures rather than overwriting them: the
 * store's final_birds is the count the birds were actually sold at.
 */
create or replace view v_batch_flock as
select
  b.company_id,
  b.id           as batch_id,
  b.code,
  b.farm_id,
  b.shed_id,
  b.bird_type,
  b.status,
  b.placement_date,
  b.start_date,
  b.initial_birds,
  coalesce(m.dead, 0)                                as mortality_to_date,
  greatest(0, b.initial_birds - coalesce(m.dead, 0)) as live_birds,
  greatest(0, (current_date - b.placement_date)::integer) as age_days,
  b.approximate_feed_tpd,
  c.date        as closing_date,
  c.final_birds as closing_birds
from public.batches b
left join (
  select batch_id, sum(count) as dead from public.mortality where date <= current_date group by 1
) m on m.batch_id = b.id
left join public.batch_closings c on c.batch_id = b.id;

-- ============================= VACCINATION =============================

/**
 * src/lib/vaccination.ts · vaccinationState + vaccinationPositions.
 * Only `status` is stored; OVERDUE / DUE_TODAY / DUE_SOON come from the calendar each read, so
 * a reminder stops the moment a dose is done without a notification table. `attention` is the
 * app's own rule: pending AND the flock still standing (§17).
 */
create or replace view v_vaccination_state as
select
  v.company_id,
  v.id           as vaccination_id,
  v.batch_id,
  v.shed_id,
  b.code         as batch_code,
  sh.name        as shed_name,
  v.relative_day,
  v.vaccine_name,
  v.scheduled_date,
  v.reminder_days_before,
  v.status,
  v.completed_date,
  (v.scheduled_date - current_date)      as to_go,
  case
    when v.status = 'COMPLETED' then 'COMPLETED'
    when v.status = 'CANCELLED' then 'CANCELLED'
    when v.scheduled_date <  current_date then 'OVERDUE'
    when v.scheduled_date =  current_date then 'DUE_TODAY'
    when v.scheduled_date <= current_date + v.reminder_days_before then 'DUE_SOON'
    else 'SCHEDULED'
  end as state,
  case when v.status = 'SCHEDULED' and v.scheduled_date < current_date
       then (current_date - v.scheduled_date)::integer else 0 end as overdue_days,
  (b.status = 'ACTIVE') as batch_active,
  (v.status = 'COMPLETED' and v.completed_date is not null
    and (v.completed_date - v.scheduled_date) > 0) as late,
  case
    when v.status in ('COMPLETED','CANCELLED') then false
    when b.status <> 'ACTIVE' then false
    when v.status = 'SCHEDULED' and (
      v.scheduled_date <= current_date
      or v.scheduled_date <= current_date + v.reminder_days_before
    ) then true
    else false
  end as needs_attention
from public.vaccinations v
join public.batches b on b.id = v.batch_id
left join public.sheds sh on sh.id = v.shed_id;

-- ============================= PURCHASES AND THE MONEY THAT SETTLES THEM =============================

/**
 * src/lib/purchasing.ts · purchasePosition / purchasePositions / medicinePurchasePositions.
 * Both stores' receipts resolve against the same finance rows, which is exactly why
 * finance_txns.purchase_id is plain text rather than a single-table FK.
 * An unpriced receipt has no value — reported as NULL, never as ₹0.
 */
create or replace view v_purchase_payment as
with receipts as (
  select
    f.company_id,
    'godown'                as source,
    f.id,
    f.date,
    f.ingredient            as title,
    'KG'                    as unit,
    f.ingredient,
    f.qty_kg                as qty,
    f.rate_per_kg           as rate_per_unit,
    f.supplier,
    f.purchase_ref
  from public.feed_stock f
  where f.kind = 'FEED_IN'
  union all
  select
    m.company_id,
    'medicine',
    m.id,
    m.date,
    coalesce(i.name, 'Removed item'),
    coalesce(i.unit, 'units'),
    m.medicine_id,
    m.qty,
    m.rate_per_unit,
    m.supplier,
    m.purchase_ref
  from public.medicine_stock m
  left join public.medicine_items i on i.id = m.medicine_id
  where m.kind = 'RECEIPT'
),
payments as (
  select purchase_id, sum(amount) as paid, count(*) as payment_count
  from public.finance_txns
  where purchase_id is not null
  group by 1
)
select
  r.company_id,
  r.source,
  r.id           as receipt_id,
  r.date,
  r.title,
  r.unit,
  r.ingredient,
  nullif(btrim(coalesce(r.supplier, '')), '') as supplier,
  r.purchase_ref,
  r.qty,
  r.rate_per_unit,
  case when r.qty > 0 and r.rate_per_unit > 0
       then round(r.qty * r.rate_per_unit, 2) end              as value,
  coalesce(p.paid, 0)                                          as paid,
  p.payment_count,
  case when r.qty > 0 and r.rate_per_unit > 0
       then round(r.qty * r.rate_per_unit - coalesce(p.paid, 0), 2) end as outstanding,
  case
    when not (r.qty > 0 and r.rate_per_unit > 0) then null
    when coalesce(p.paid, 0) <= 0 then 'PENDING'
    when round(r.qty * r.rate_per_unit - p.paid, 2) > 0 then 'PARTIAL'
    else 'PAID'
  end                                                         as status
from receipts r
left join payments p on p.purchase_id = r.id;

/**
 * src/lib/purchasing.ts · unlinkedPurchasePayments — money that left but answers to no receipt
 * on this company: a legacy row, or one whose receipt has since been removed. Kept visible on
 * purpose; it must never be quietly applied to something else.
 */
create or replace view v_unlinked_purchase_payment as
select
  f.id,
  f.company_id,
  f.date,
  f.kind,
  f.category,
  f.counterparty,
  f.purchase_id,
  f.amount,
  f.payment_method,
  f.reference,
  f.remarks
from public.finance_txns f
where f.kind not in ('INCOME', 'SALE', 'PAYMENT_IN')
  and (
    f.purchase_id is not null
    or f.kind = 'PURCHASE'
    or f.category in ('Feed Purchase', 'Medicine Purchase', 'Chick Purchase')
  )
  and not exists (
    select 1 from v_purchase_payment v
    where v.receipt_id = f.purchase_id and v.company_id = f.company_id
  );

-- ============================= GRANTS =============================
-- RLS policies arrive in 003; until then these are readable by the roles Supabase hands out
-- by default, and 003 will tighten them in the same migration order.

/*
 * Every view below resolves rows with the CALLER's own rights, so a policy that hides a row
 * from a user also hides it from any view they query — a view must never become a door around
 * RLS. v_sale_entry_day is the single deliberate exception, and the reason is stated on it.
 */
do $$
declare v text;
begin
  for v in
    select table_name from information_schema.views
    where table_schema = 'public' and table_name <> 'v_sale_entry_day'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v);
  end loop;
end $$;

grant select on all tables in schema public to authenticated;
