-- 004_functions.sql — the writes that must land whole.
--
-- The client store performs some actions by rebuilding several arrays at once: a sale voucher
-- owns its trader rows and its finance rows, a dose draws its medicine usage, a formula
-- revision supersedes the version in force. One HTTP call per table would leave stock and
-- money disagreeing the moment a middle request failed, so each of those steps is one
-- Postgres function here instead.
--
-- Two security shapes, chosen per function rather than by habit:
--
--   SECURITY INVOKER — the caller's own RLS runs. Used wherever 003's policies already carry
--   the exact gate the store applies (a godown movement needs createDailyOps, a medicine row
--   needs the store's key, a dose needs completeVaccination). Inventing a second copy of a
--   permission inside a function is how the two halves of an app drift apart, so these
--   functions add derivation and atomicity and change nothing about who may write. The
--   day-lock triggers from 003 still fire, because they belong to the table.
--
--   SECURITY DEFINER — only where the client's gate is NOT the table policy, or where reading
--   through the caller's policy would produce a wrong answer instead of an error. A voucher
--   has to see every earlier voucher to know what a shed still holds (a supervisor's ledger is
--   deliberately invisible to them), and a formula revision has to know whether consumption
--   already read that version. Each such function re-checks the store's own predicate through
--   app.role_can / app.can_on_batch, which read the same app.role_permissions table the
--   policies were compiled from — one list, two readers.
--
-- Every failure raises the client's exact message with the default P0001 code, so PostgREST
-- returns 400 + the same sentence the localStorage form shows. Callers never see a partial
-- write: the statement that raises rolls the whole call back.

-- ============================= SMALL READS EVERY WRITER NEEDS =============================

/** Ids stay app-shaped text (src/lib/format.ts uid()); uniqueness is what matters, not the prefix. */
create or replace function app.id(p_prefix text) returns text
language sql volatile set search_path = app, public
as $$
  select p_prefix || '_' || replace(gen_random_uuid()::text, '-', '')
$$;

/** numOf() (src/store/app.ts): anything that is not a number reads as 0, never as an error. */
create or replace function app.num(p_text text) returns numeric
language sql immutable set search_path = app, public
as $$
  select case when p_text ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
              then p_text::numeric else 0 end
$$;

/** A person id or nothing: the client writes 'system' when it has no session, and that is not a profile. */
create or replace function app.person(p_text text) returns uuid
language sql immutable set search_path = app, public
as $$
  select case when p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then p_text::uuid end
$$;

/** `<input type="time">` gives HH:MM; anything else is not a clock time and is dropped, as the client's CLOCK_TIME test drops it. */
create or replace function app.clock(p_text text) returns time
language sql immutable set search_path = app, public
as $$
  select case when p_text ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then p_text::time end
$$;

/** money() / round2: the two-decimal rupee the ledger stores. */
create or replace function app.r2(p_value numeric) returns numeric
language sql immutable set search_path = app, public
as $$
  select round(coalesce(p_value, 0), 2)
$$;

/** isLocked(shedId, date) (src/store/app.ts). */
create or replace function app.is_locked(p_shed_id text, p_day date) returns boolean
language sql stable security definer set search_path = app, public
as $$
  select p_day is not null and exists (
    select 1 from public.day_locks l where l.shed_id = p_shed_id and l.date = p_day
  )
$$;

/** batchOfShedOn() (src/lib/calc.ts): the batch that held this shed on that day. */
create or replace function app.batch_of_shed_on(p_shed_id text, p_day date) returns text
language sql stable security definer set search_path = app, public
as $$
  select b.id from public.batches b
  left join public.batch_closings c on c.batch_id = b.id
  where b.shed_id = p_shed_id and b.start_date <= p_day
    and (c.date is null or p_day <= c.date)
  order by b.start_date desc limit 1
$$;

-- ============================= DERIVED READS THE CALLER MUST NOT BE BLINDED BY =============================

/**
 * app/valuation.ts valueGodown(), replayed over one product's ledger up to a day.
 *
 * The same rules, in the same order: a receipt that carries a rate re-weights the average
 * (§2), stock leaving is valued at the average in force the moment it is booked and leaves it
 * untouched (§14, §15), and quantity with no price basis anywhere is counted but never valued
 * at ₹0 (§19). `source` picks which of the two ledgers the farm shares — feed by ingredient
 * name, medicine by item id, the same pair v_purchase_payment already reads.
 *
 * SECURITY DEFINER on purpose: the average a usage must be booked at cannot depend on
 * whether the caller's policies can see the receipts behind it.
 */
create or replace function app.valuation_at(
  p_company text, p_source text, p_key text, p_day date default date '9999-12-31'
) returns table (kg numeric, valued_kg numeric, unpriced_kg numeric, value numeric, average numeric)
language plpgsql stable security definer set search_path = app, public
as $$
declare
  r        record;
  before_  numeric;   -- averageOf(s) immediately before this movement
  d        numeric;
  taken    numeric;
  from_valued numeric;
  v_kg      numeric := 0;
  v_valued  numeric := 0;
  v_unpriced numeric := 0;
  v_value   numeric := 0;
  v_avg     numeric;  -- the average once held, kept after stock empties
begin
  if p_source not in ('godown', 'medicine') then
    raise exception 'valuation_at: unknown stock ledger "%"', p_source;
  end if;

  for r in
    with movements as (
      -- stockDelta() over the godown ledger
      select f.id, f.date as day, f.created_at as at,
             case f.kind
               when 'OPENING'     then f.qty_kg
               when 'FEED_IN'     then f.qty_kg
               when 'FEED_OUT'    then -f.qty_kg
               when 'CONSUMPTION' then -f.qty_kg
               when 'ADJUSTMENT'  then f.qty_kg
               else -abs(f.qty_kg)                     -- SHORTAGE: out, however it was typed
             end as delta,
             case when f.rate_per_kg > 0 then f.rate_per_kg end as rate
      from public.feed_stock f
      where p_source = 'godown' and f.company_id = p_company
        and f.ingredient = p_key and f.date <= p_day
      union all
      -- the same delta through asLedgerRow(): a receipt is an issue-in, a usage a consumption
      select m.id, m.date, m.created_at,
             case m.kind
               when 'OPENING'   then m.qty
               when 'RECEIPT'   then m.qty
               when 'USAGE'     then -m.qty
               else m.qty                              -- ADJUSTMENT is signed as entered
             end,
             case when m.rate_per_unit > 0 then m.rate_per_unit end
      from public.medicine_stock m
      where p_source = 'medicine' and m.company_id = p_company
        and m.medicine_id = p_key and m.date <= p_day
    )
    select x.id, x.delta, x.rate from movements x
    order by x.day, x.at, x.id
  loop
    before_ := case when v_valued > 0 then v_value / v_valued else v_avg end;
    d := r.delta;
    if d > 0 then
      v_kg := v_kg + d;
      if r.rate is not null then
        -- blendPrice(): held stock pools with the new receipt's value
        v_avg := case when before_ is null or v_valued <= 0 then r.rate
                      else (v_valued * before_ + d * r.rate) / (v_valued + d) end;
        v_valued := v_valued + d;
        v_value := v_value + d * r.rate;
      elsif before_ is not null then
        -- stock back with no rate of its own re-enters at the ledger's own basis
        v_valued := v_valued + d;
        v_value := v_value + d * before_;
      else
        v_unpriced := v_unpriced + d;
      end if;
    elsif d < 0 then
      taken := -d;
      -- takeOut(): priced stock goes first, the unpriced remainder after it, and value follows
      -- quantity at the same average — so the average itself never moves.
      from_valued := least(v_valued, taken);
      v_valued := v_valued - from_valued;
      v_value := case when v_valued > 0 then v_valued * coalesce(before_, 0) else 0 end;
      v_unpriced := v_unpriced - least(greatest(0, v_unpriced), taken - from_valued);
      v_kg := v_kg - taken;
      v_avg := before_;
    end if;
  end loop;

  return query select
    v_kg, v_valued, v_unpriced, greatest(0, v_value),
    case when v_valued > 0 then v_value / v_valued else v_avg end;
end
$$;

/** medicineBasis()/avgAt(): the average to book a usage at, or null when nothing ever priced it. */
create or replace function app.average_at(
  p_company text, p_source text, p_key text, p_day date default date '9999-12-31'
) returns numeric
language sql stable security definer set search_path = app, public
as $$
  select average from app.valuation_at(p_company, p_source, p_key, p_day)
$$;

/** wouldGoNegative()'s balance (src/store/app.ts): every row the company holds, whatever the date. */
create or replace function app.godown_kg(p_company text, p_ingredient text) returns numeric
language sql stable security definer set search_path = app, public
as $$
  select coalesce(sum(case f.kind
    when 'OPENING'     then f.qty_kg
    when 'FEED_IN'     then f.qty_kg
    when 'FEED_OUT'    then -f.qty_kg
    when 'CONSUMPTION' then -f.qty_kg
    when 'ADJUSTMENT'  then f.qty_kg
    else -abs(f.qty_kg) end), 0)
  from public.feed_stock f
  where f.company_id = p_company and f.ingredient = p_ingredient
$$;

/**
 * eggStockByGrade() (src/lib/calc.ts) for one shed: trays collected minus trays sold in a
 * final voucher, grade by grade. Dispatch logs never appear here — a load that has left the
 * shed but is not billed yet still counts as unsold, which is the whole reason this reads
 * sale_entry_lines and not a movement table.
 *
 * The sold side has to see every voucher, including the money columns a caller may not read,
 * or a supervisor's stock balance would be silently overstated. Only a count comes out.
 */
create or replace function app.egg_balance(
  p_company text, p_shed_id text, p_day date default current_date, p_ignore_id text default null
) returns table (grade text, collected integer, sold integer, balance integer)
language sql stable security definer set search_path = app, public
as $$
  select g.grade,
         coalesce((select sum(case g.grade
                                when 'GOOD' then e.good_trays when 'BROKEN' then e.broken_trays
                                when 'DOUBLE' then e.double_trays else e.small_trays end)
                   from public.egg_collections e
                   where e.company_id = p_company and e.shed_id = p_shed_id and e.date <= p_day), 0)::int,
         coalesce((select sum(case g.grade
                                when 'GOOD' then l.good_trays when 'BROKEN' then l.broken_trays
                                when 'DOUBLE' then l.double_trays else l.small_trays end)
                   from public.sale_entry_lines l
                   join public.sale_entries x on x.id = l.sale_entry_id
                   where x.company_id = p_company and l.shed_id = p_shed_id and x.date <= p_day
                     and (p_ignore_id is null or x.id <> p_ignore_id)), 0)::int,
         coalesce((select sum(case g.grade
                                when 'GOOD' then e.good_trays when 'BROKEN' then e.broken_trays
                                when 'DOUBLE' then e.double_trays else e.small_trays end)
                   from public.egg_collections e
                   where e.company_id = p_company and e.shed_id = p_shed_id and e.date <= p_day), 0)::int
         - coalesce((select sum(case g.grade
                                when 'GOOD' then l.good_trays when 'BROKEN' then l.broken_trays
                                when 'DOUBLE' then l.double_trays else l.small_trays end)
                   from public.sale_entry_lines l
                   join public.sale_entries x on x.id = l.sale_entry_id
                   where x.company_id = p_company and l.shed_id = p_shed_id and x.date <= p_day
                     and (p_ignore_id is null or x.id <> p_ignore_id)), 0)::int
  from (values ('GOOD'), ('BROKEN'), ('DOUBLE'), ('SMALL')) as g(grade)
$$;

/**
 * effectiveCan(role, assignment.permissions, key) (src/lib/permissions.ts) for one batch:
 * the company-wide matrix, widened by the jsonb grant a person holds on this flock. The grant
 * lives only here and in nothing else — RLS stays company-wide because a policy cannot read a
 * per-batch jsonb per row without turning every screen into a join.
 */
create or replace function app.can_on_batch(p_company text, p_batch_id text, p_key text)
returns boolean
language sql stable security definer set search_path = app, public
as $$
  select app.role_can(p_company, p_key)
      or exists (
        select 1 from public.batch_assignments a
        where a.batch_id = p_batch_id and a.user_id = app.uid()
          and (a.permissions ->> p_key) = 'true'
      )
$$;

-- ============================= RECEIPT NUMBERING =============================

/**
 * nextCashReceiptNo() / nextPurchaseRef() / nextMedicineRef(), made atomic.
 *
 * Numbering is per company and per day, and the prefix is load-bearing: migrateSaved() reads
 * PUR-{date}- back off a stored value, so the format is `SCOPE-YYYY-MM-DD-NNN` unchanged.
 * The client scanned its whole store for the highest number already taken; a counter row
 * claims the next one in a single statement, so two people saving at the same moment cannot
 * be handed the same receipt. `p_taken` lets an import seed the series from the highest
 * number already on a saved record.
 */
create or replace function app.next_receipt_no(
  p_company text, p_scope text, p_day date, p_taken integer default null
) returns text
language plpgsql volatile security definer set search_path = app, public
as $$
declare v_next integer;
begin
  if p_scope not in ('CR','PUR','MED') then
    raise exception 'Unknown receipt series "%"', p_scope;
  end if;
  if p_day is null then
    raise exception 'A receipt number needs the day it was raised';
  end if;
  -- The migration role has no session and is the only caller allowed to number silently;
  -- anyone signed in must belong to the company they are numbering for.
  if app.uid() is not null and not app.member_of(p_company) then
    raise exception 'That company is not yours';
  end if;

  with claimed as (
    insert into public.receipt_counters as c (company_id, scope, day, next_value)
    values (p_company, p_scope, p_day, coalesce(p_taken, 0) + 2)
    on conflict (company_id, scope, day) do update
      set next_value = greatest(c.next_value, coalesce(p_taken, 0) + 1) + 1
    returning c.next_value
  )
  select next_value - 1 into v_next from claimed;

  return format('%s-%s-%s', p_scope, p_day, lpad(v_next::text, 3, '0'));
end
$$;

-- ============================= THE SALE VOUCHER =============================

/**
 * addSaleEntry() / updateSaleEntry() (src/store/app.ts) as one write.
 *
 * A voucher is one record that takes trays out of several sheds and books money against one
 * trader, so its five effects land together or not at all: the header and its lines, the two
 * trader ledger rows it owns, the income/expense pairs it owns, and the audit row. Editing
 * rewrites exactly the rows that carry its ref_id — the client's replaceLedger() in SQL —
 * which is what keeps a correction from double-bookinging a load.
 *
 * Input (JSONB, camelCase as the client's SaleEntryDraft names it):
 *   id?                     present to edit, absent to create
 *   traderId, date, pricing ('RATE'|'AGREED'), agreedAmount?, laborCharge?,
 *   rates {good,broken,double,small}  ₹ per egg,
 *   cash?, phonepe?, advance?, cashHandledById?, cashTime?, cashReference?, remarks?,
 *   lines [{ shedId, byGrade {good,broken,double,small} }]
 *
 * The checks run in the client's order and raise the client's sentences, because the form and
 * the database must never disagree about which one the user is told.
 */
create or replace function app.save_sale_entry(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_comp     text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_actor    uuid := app.uid();
  v_id       text := nullif(p->>'id', '');
  v_prev     jsonb;
  v_lines    jsonb;
  v_trader   jsonb;
  v_pricing  text := coalesce(nullif(p->>'pricing', ''), 'RATE');
  v_trays    integer;
  v_eggs     numeric := 0;      -- egg money alone
  v_amount   numeric;
  v_labor    numeric := app.r2(app.num(p->>'laborCharge'));
  v_cash     numeric := app.r2(app.num(p->>'cash'));
  v_online   numeric := app.r2(app.num(p->>'phonepe'));
  v_advance  numeric := app.r2(app.num(p->>'advance'));
  v_paid     numeric;
  v_credit   numeric;
  v_billed   numeric;
  v_received jsonb;
  v_handler  uuid := app.person(p->>'cashHandledById');
  v_time     time := app.clock(p->>'cashTime');
  v_ref      text := nullif(trim(coalesce(p->>'cashReference', '')), '');
  v_remarks  text := nullif(trim(coalesce(p->>'remarks', '')), '');
  v_line     jsonb;
  v_total    numeric;
  v_share    numeric;
  v_last     boolean;
  v_i        integer := -1;
  v_seen     numeric := 0;      -- received already allocated
  v_seen_c   numeric := 0;
  v_seen_o   numeric := 0;
  v_seen_l   numeric := 0;
  v_cash_p   numeric;
  v_online_p numeric;
  v_paid_p   numeric;
  v_lab_p    numeric;
  v_batch    text;
  v_grade    text;
  v_unrated  text;
  v_have     integer;
  v_name     text;
  v_method   text;
  v_split    jsonb;
  v_new      boolean;
begin
  if v_actor is null then raise exception 'You are not signed in'; end if;
  if v_comp is null then raise exception 'No company selected'; end if;
  -- createSaleEntries is the store's gate, and the same predicate 003's policy compiles to.
  if not app.role_can(v_comp, 'createSaleEntries') then
    raise exception 'Only Finance or the Owner can record a sale entry';
  end if;

  -- normalizeLines(): whole trays only, no negatives, and a shed that sold nothing is dropped.
  select coalesce(jsonb_agg(x.l order by (x.l ->> '_p')::int), '[]'::jsonb) into v_lines
  from (
    select jsonb_build_object(
             '_p', ord - 1,
             'shedId', trim(coalesce(l ->> 'shedId', '')),
             'GOOD', greatest(0, floor(app.num(coalesce(l -> 'byGrade' ->> 'good', l ->> 'good')))),
             'BROKEN', greatest(0, floor(app.num(coalesce(l -> 'byGrade' ->> 'broken', l ->> 'broken')))),
             'DOUBLE', greatest(0, floor(app.num(coalesce(l -> 'byGrade' ->> 'double', l ->> 'double')))),
             'SMALL', greatest(0, floor(app.num(coalesce(l -> 'byGrade' ->> 'small', l ->> 'small'))))
           ) as l
    from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) with ordinality as e(l, ord)
  ) x
  where x.l ->> 'shedId' <> ''
    and (x.l ->> 'GOOD')::int + (x.l ->> 'BROKEN')::int
        + (x.l ->> 'DOUBLE')::int + (x.l ->> 'SMALL')::int > 0;

  v_trays := coalesce((select sum((l ->> 'GOOD')::int + (l ->> 'BROKEN')::int
                                  + (l ->> 'DOUBLE')::int + (l ->> 'SMALL')::int)
                       from jsonb_array_elements(v_lines) l), 0)::int;

  -- ---- saleEntryError(), in order -----------------------------------------------------
  select to_jsonb(t) into v_trader from public.traders t
   where t.id = nullif(p->>'traderId', '') and t.company_id = v_comp;
  if v_trader is null then raise exception 'Select the trader this sale is against'; end if;
  if nullif(p->>'date', '') is null then raise exception 'Select the sale date'; end if;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Enter the trays sold from at least one shed';
  end if;
  if app.num(p->>'cash') < 0 or app.num(p->>'phonepe') < 0
     or app.num(p->>'advance') < 0 or app.num(p->>'laborCharge') < 0 then
    raise exception 'Amounts cannot be negative';
  end if;
  -- Cash is held by a person, so it names one. The one typing the voucher is never assumed to be them.
  if v_cash > 0 and v_handler is null then
    raise exception 'Record who received the cash on this load';
  end if;

  -- entryAmount(): the per-egg rate the trader quoted × the eggs those trays hold, or the
  -- single figure accounts agreed for the whole load. Labour is never inside it.
  if v_pricing = 'AGREED' then
    v_amount := greatest(0, app.r2(app.num(p->>'agreedAmount')));
  else
    v_eggs := (select round(sum((l ->> g.grade)::int * 30
                                * app.num(coalesce(p -> 'rates' ->> lower(g.grade), '0'))), 2)
               from jsonb_array_elements(v_lines) l
               cross join (values ('GOOD'), ('BROKEN'), ('DOUBLE'), ('SMALL')) g(grade));
    v_amount := coalesce(v_eggs, 0);
  end if;
  if v_amount <= 0 then
    raise exception '%', case when v_pricing = 'AGREED'
      then 'Enter the amount collected for this sale'
      else 'Enter the per-egg rate for each grade you sold' end;
  end if;

  if v_pricing = 'RATE' then
    -- The client names every missing grade in one sentence, so the message is built whole.
    select string_agg(lower(g.grade), ', ') into v_unrated
      from (values ('GOOD'), ('BROKEN'), ('DOUBLE'), ('SMALL')) as g(grade)
     where coalesce((select sum((l ->> g.grade)::int) from jsonb_array_elements(v_lines) l), 0) > 0
       and not (app.num(coalesce(p -> 'rates' ->> lower(g.grade), '0')) > 0);
    if v_unrated is not null then
      raise exception 'Set a per-egg rate for the % trays', v_unrated;
    end if;
  end if;

  -- Per shed: same company, the day still open, and the grade actually in the pool. The
  -- voucher being edited is excluded so its own trays are not counted against it twice.
  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    select s.name into v_name from public.sheds s
     where s.id = v_line ->> 'shedId' and s.company_id = v_comp;
    if v_name is null then
      raise exception 'A shed on this entry does not belong to this company';
    end if;
    if app.is_locked(v_line ->> 'shedId', (p ->> 'date')::date) then
      raise exception '% is locked for this date — the Owner must unlock it first', v_name;
    end if;
    -- The first grade asked in the client's own order (good, broken, double, small).
    select g.grade, b.balance into v_grade, v_have
      from (values ('GOOD'), ('BROKEN'), ('DOUBLE'), ('SMALL')) as g(grade)
      join lateral (select x.balance from app.egg_balance(v_comp, v_line ->> 'shedId', current_date, v_id) x
                     where x.grade = g.grade) b on true
     where (v_line ->> g.grade)::int > b.balance
     order by case g.grade when 'GOOD' then 0 when 'BROKEN' then 1 when 'DOUBLE' then 2 else 3 end
     limit 1;
    if found then
      raise exception '% has only % % trays left in stock', v_name, coalesce(v_have, 0), lower(v_grade);
    end if;
  end loop;

  -- ---- the header (loadCredit: billed − what was handed over) -------------------------
  v_billed := app.r2(v_amount + v_labor);
  v_paid := app.r2(v_cash + v_online + v_advance);
  v_credit := app.r2(v_billed - v_paid);
  v_new := v_id is null;
  if v_new then
    v_id := app.id('se');
  else
    select to_jsonb(x) into v_prev from public.sale_entries x
     where x.id = v_id and x.company_id = v_comp;
    if v_prev is null then raise exception 'Sale entry not found'; end if;
  end if;

  insert into public.sale_entries as x (
    id, company_id, trader_id, date, pricing,
    rate_good, rate_broken, rate_double, rate_small,
    amount, cash, phonepe, advance, labor_charge,
    cash_handled_by, cash_time, cash_reference, remarks,
    created_by, created_at, updated_by, updated_at
  ) values (
    v_id, v_comp, v_trader ->> 'id', (p ->> 'date')::date, v_pricing,
    nullif(app.num(coalesce(p -> 'rates' ->> 'good', '0')), 0),
    nullif(app.num(coalesce(p -> 'rates' ->> 'broken', '0')), 0),
    nullif(app.num(coalesce(p -> 'rates' ->> 'double', '0')), 0),
    nullif(app.num(coalesce(p -> 'rates' ->> 'small', '0')), 0),
    v_amount, v_cash, v_online, v_advance, v_labor,
    v_handler, v_time, v_ref, v_remarks,
    v_actor, now(), case when v_new then null else v_actor end,
    case when v_new then null else now() end
  )
  on conflict (id) do update set
    trader_id = excluded.trader_id, date = excluded.date, pricing = excluded.pricing,
    rate_good = excluded.rate_good, rate_broken = excluded.rate_broken,
    rate_double = excluded.rate_double, rate_small = excluded.rate_small,
    amount = excluded.amount, cash = excluded.cash, phonepe = excluded.phonepe,
    advance = excluded.advance, labor_charge = excluded.labor_charge,
    cash_handled_by = excluded.cash_handled_by, cash_time = excluded.cash_time,
    cash_reference = excluded.cash_reference, remarks = excluded.remarks,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  delete from public.sale_entry_lines l where l.sale_entry_id = v_id;
  v_i := -1;
  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_i := v_i + 1;
    insert into public.sale_entry_lines (sale_entry_id, position, shed_id,
                                         good_trays, broken_trays, double_trays, small_trays)
    values (v_id, v_i, v_line ->> 'shedId',
            (v_line ->> 'GOOD')::int, (v_line ->> 'BROKEN')::int,
            (v_line ->> 'DOUBLE')::int, (v_line ->> 'SMALL')::int);
  end loop;

  -- ---- the rows this voucher owns: replaceLedger() on both ledgers --------------------
  delete from public.trader_txns t where t.ref_id = v_id;
  delete from public.finance_txns f where f.ref_id = v_id;

  -- paymentChannels(): how the money arrived, in the ledger's own language. An advance is its
  -- own channel — that money was already with us, so it must not read as cash collected today.
  v_split := jsonb_strip_nulls(jsonb_build_object(
    'cash', case when v_cash > 0 then v_cash end,
    'online', case when v_online > 0 then v_online end,
    'advance', case when v_advance > 0 then v_advance end));
  v_method := case when v_cash > 0 and v_online = 0 and v_advance = 0 then 'CASH'
                   when v_online > 0 and v_cash = 0 and v_advance = 0 then 'PHONEPE' end;

  -- traderRows(): the trader is billed for the whole load — eggs plus loading labour — and
  -- credited for what they handed over. The price is ₹ per egg off the egg money alone.
  insert into public.trader_txns (id, company_id, trader_id, date, kind, trays, rate, amount,
                                  ref_id, payment_method, split, time, handled_by, reference,
                                  remarks, created_by, created_at)
  values (app.id('tt'), v_comp, v_trader ->> 'id', (p ->> 'date')::date, 'EGG_SALE', v_trays,
          case when v_trays > 0 then round(v_amount / (v_trays * 30), 2) end, v_billed,
          v_id, null, null, null, null, null, v_remarks, v_actor, now());

  if v_paid > 0 then
    insert into public.trader_txns (id, company_id, trader_id, date, kind, amount,
                                    ref_id, payment_method, split, time, handled_by, reference,
                                    created_by, created_at)
    values (app.id('tt'), v_comp, v_trader ->> 'id', (p ->> 'date')::date, 'PAYMENT_IN', v_paid,
            v_id, v_method, nullif(v_split, '{}'::jsonb), v_time, v_handler, v_ref, v_actor, now());
  end if;

  -- financeRows(): one pair per shed line, so each batch is credited with the trays that left
  -- it. Shares are pro-rata and the LAST line takes the remainder, which is how the client
  -- keeps the parts adding back to the whole to the paisa.
  v_total := nullif(v_trays, 0);
  v_i := -1;
  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_i := v_i + 1;
    v_last := v_i = jsonb_array_length(v_lines) - 1;
    v_share := coalesce(((v_line ->> 'GOOD')::int + (v_line ->> 'BROKEN')::int
                         + (v_line ->> 'DOUBLE')::int + (v_line ->> 'SMALL')::int)::numeric
                        / nullif(v_total, 0), 0);
    v_batch := app.batch_of_shed_on(v_line ->> 'shedId', (p ->> 'date')::date);
    v_cash_p := case when v_last then app.r2(v_cash - v_seen_c) else app.r2(v_cash * v_share) end;
    v_online_p := case when v_last then app.r2(v_online - v_seen_o) else app.r2(v_online * v_share) end;
    v_paid_p := case when v_last then app.r2(v_paid - v_seen) else app.r2(v_paid * v_share) end;
    v_lab_p := case when v_last then app.r2(v_labor - v_seen_l) else app.r2(v_labor * v_share) end;
    v_seen := app.r2(v_seen + v_paid_p);
    v_seen_c := app.r2(v_seen_c + v_cash_p);
    v_seen_o := app.r2(v_seen_o + v_online_p);
    v_seen_l := app.r2(v_seen_l + v_lab_p);

    if v_paid_p > 0 then
      insert into public.finance_txns (id, company_id, batch_id, date, kind, amount, category,
                                       counterparty, ref_id, payment_method, split, time,
                                       handled_by, reference, created_by, created_at)
      values (app.id('fx'), v_comp, v_batch, (p ->> 'date')::date, 'INCOME', v_paid_p,
              'Egg Sale', v_trader ->> 'name', v_id,
              case when v_cash_p > 0 and v_online_p = 0 and v_paid_p - v_cash_p - v_online_p = 0 then 'CASH'
                   when v_online_p > 0 and v_cash_p = 0 and v_paid_p - v_cash_p - v_online_p = 0 then 'PHONEPE' end,
              nullif(jsonb_strip_nulls(jsonb_build_object(
                'cash', case when v_cash_p > 0 then v_cash_p end,
                'online', case when v_online_p > 0 then v_online_p end,
                'advance', case when app.r2(v_paid_p - v_cash_p - v_online_p) > 0
                               then app.r2(v_paid_p - v_cash_p - v_online_p) end)), '{}'::jsonb),
              -- Who physically took the cash is a fact about the money, not about who typed the voucher in.
              v_time, v_handler, v_ref, v_actor, now());
    end if;

    if v_lab_p > 0 then
      insert into public.finance_txns (id, company_id, batch_id, date, kind, amount, category,
                                       counterparty, ref_id, remarks, created_by, created_at)
      values (app.id('fx'), v_comp, v_batch, (p ->> 'date')::date, 'EXPENSE', v_lab_p,
              'Labour', v_trader ->> 'name', v_id, 'Loading labour for this sale', v_actor, now());
    end if;
  end loop;

  -- What stays with the trader is not finance yet — it sits on their ledger, derived.
  insert into public.audit (id, company_id, entity, entity_id, action, field, old_value, new_value,
                            by_user_id, at)
  values (app.id('au'), v_comp, 'SaleEntry', v_id,
          case when v_new then 'CREATE' else 'UPDATE' end,
          case when v_new then null else 'amount' end,
          case when v_new then null else jsonb_build_object('amount', (v_prev ->> 'amount')::numeric) end,
          case when v_new then jsonb_build_object('traderId', v_trader ->> 'id', 'amount', v_amount)
               else jsonb_build_object('amount', v_amount) end,
          v_actor, now());

  -- What stays with the trader is not finance yet: the receivable is read back off the two
  -- ledgers this just rewrote (v_sale_entry_position), never carried out of here as a stored
  -- second opinion.
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new, 'trays', v_trays,
                            'amount', v_amount, 'billed', v_billed, 'paid', v_paid,
                            'credit', v_credit);
end
$$;

/**
 * deleteSaleEntry() (src/store/app.ts): the Owner alone, and never across a locked day.
 * The voucher's own ledger rows carry its ref_id, so removing the header removes exactly its
 * money — a later receipt against the load moves to `sale_id` and is kept, as the client does.
 */
create or replace function app.delete_sale_entry(p_id text) returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_comp text := coalesce(app.current_company(), (select x.company_id from public.sale_entries x where x.id = p_id));
  v_entry public.sale_entries;
  v_locked boolean;
begin
  if app.uid() is null then raise exception 'You are not signed in'; end if;
  if not app.role_can(v_comp, 'delete') then
    raise exception 'Only the Owner can delete a sale entry';
  end if;
  select * into v_entry from public.sale_entries where id = p_id and company_id = v_comp;
  if v_entry.id is null then raise exception 'Sale entry not found'; end if;

  -- A voucher spans sheds, so the lock test is per line, not per header.
  select exists (
    select 1 from public.sale_entry_lines l
    join public.day_locks d on d.shed_id = l.shed_id and d.date = v_entry.date
    where l.sale_entry_id = p_id
  ) into v_locked;
  if v_locked then raise exception 'Day is locked — the Owner must unlock it first'; end if;

  insert into public.audit (id, company_id, entity, entity_id, action, field, old_value, by_user_id, at)
  values (app.id('au'), v_comp, 'SaleEntry', p_id, 'DELETE', 'amount',
          jsonb_build_object('amount', v_entry.amount), app.uid(), now());

  delete from public.sale_entries where id = p_id;   -- lines, ref_id rows and links cascade
  return jsonb_build_object('ok', true, 'id', p_id);
end
$$;

-- ============================= GODOWN =============================

/**
 * addFeedStock() (src/store/app.ts) as one write. SECURITY INVOKER: a godown movement is one
 * row, so the only thing an RPC adds here is the receipt number nobody else can hand out twice
 * and the balance test the client runs before it commits. Permissions stay exactly 003's
 * (createDailyOps to insert, the day-lock trigger to protect a closed day), and the money that
 * settles a receipt is still entered only in Finance.
 */
create or replace function app.add_feed_stock(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = app, public
as $$
declare
  v_comp   text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_kind   text := nullif(p->>'kind', '');
  v_day    date := nullif(p->>'date', '')::date;
  v_ing    text := trim(coalesce(p->>'ingredient', ''));
  v_qty    numeric := app.num(p->>'qtyKg');
  v_effect numeric;
  v_ref    text;
  v_id     text := app.id('fs');
  v_outgoing boolean;
begin
  if v_comp is null then raise exception 'No company selected'; end if;
  if v_kind not in ('OPENING','FEED_IN','FEED_OUT','CONSUMPTION','ADJUSTMENT','SHORTAGE') then
    raise exception 'Choose the kind of stock movement';
  end if;
  if v_day is null then raise exception 'Choose the date of this movement'; end if;
  if v_ing = '' then raise exception 'Choose the ingredient'; end if;

  v_outgoing := v_kind in ('FEED_OUT','CONSUMPTION');
  -- A shortage is an outflow: it is booked as negative KG however the quantity is typed.
  v_effect := case when v_kind = 'SHORTAGE' then -abs(v_qty) else v_qty end;
  if not v_outgoing and v_kind not in ('ADJUSTMENT','SHORTAGE') and v_effect <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;
  if v_kind = 'SHORTAGE' and v_effect = 0 then
    raise exception 'Enter the quantity found short';
  end if;
  if v_effect = 0 then raise exception 'Quantity cannot be zero'; end if;
  -- wouldGoNegative(), unless the caller knowingly allows an overdraw as the client does.
  if v_outgoing and coalesce((p->>'allowNegative')::boolean, false) is not true
     and app.godown_kg(v_comp, v_ing) - v_qty < 0 then
    raise exception 'Insufficient stock: % would go negative (have % kg, need % kg)',
      v_ing, round(app.godown_kg(v_comp, v_ing)), round(v_qty);
  end if;

  -- A purchase is a payable, so it names the supplier it is owed to. The receipt number is
  -- issued here rather than typed: two farms must not raise the same purchase number.
  if v_kind = 'FEED_IN' then
    if nullif(trim(coalesce(p->>'supplier', '')), '') is null then
      raise exception 'Record the supplier this stock was bought from';
    end if;
    v_ref := app.next_receipt_no(v_comp, 'PUR', v_day);
  end if;

  insert into public.feed_stock (id, company_id, ingredient, date, kind, qty_kg, rate_per_kg,
                                 shed_id, batch_id, supplier, purchase_ref, remarks,
                                 created_by, created_at)
  values (v_id, v_comp, v_ing, v_day, v_kind, v_effect,
          case when app.num(p->>'ratePerKg') > 0 then app.num(p->>'ratePerKg') end,
          nullif(p->>'shedId', ''), nullif(p->>'batchId', ''),
          nullif(trim(coalesce(p->>'supplier', '')), ''), v_ref,
          nullif(trim(coalesce(p->>'remarks', '')), ''),
          app.uid(), now());

  insert into public.audit (id, company_id, entity, entity_id, action, by_user_id, at)
  values (app.id('au'), v_comp, 'FeedStock', v_id, 'CREATE', app.uid(), now());

  return jsonb_build_object('ok', true, 'id', v_id, 'purchaseRef', v_ref, 'qtyKg', v_effect);
end
$$;

-- ============================= MEDICINE & VACCINE STORE =============================

/**
 * receiveMedicine(): stock and the payable only. Cash, bank and every expense total are
 * untouched, because buying something and paying for it are two events on this farm. The MED
 * series is numbered apart from PUR so the two stores can never hand out the same receipt.
 */
create or replace function app.receive_medicine(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = app, public
as $$
declare
  v_comp  text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_item  public.medicine_items;
  v_day   date := nullif(p->>'date', '')::date;
  v_qty   numeric := app.num(p->>'qty');
  v_sup   text := trim(coalesce(p->>'supplier', ''));
  v_rate  numeric := case when app.num(p->>'ratePerUnit') > 0 then app.num(p->>'ratePerUnit') end;
  v_ref   text;
  v_id    text := app.id('ms');
begin
  if v_comp is null then raise exception 'No company selected'; end if;
  select * into v_item from public.medicine_items
   where id = nullif(p->>'medicineId', '') and company_id = v_comp;
  if v_item.id is null then raise exception 'Choose the medicine or vaccine'; end if;
  if v_day is null then raise exception 'Choose the date it arrived'; end if;
  if not (v_qty > 0) then raise exception 'Quantity must be greater than 0'; end if;
  -- A rate of zero is not a free purchase, it is a rate nobody wrote down.
  if v_sup = '' then raise exception 'Record the supplier this stock was bought from'; end if;
  if nullif(p->>'expiryDate', '') is not null and (p->>'expiryDate')::date < v_day then
    raise exception 'The expiry date is before the day it arrived';
  end if;
  v_ref := app.next_receipt_no(v_comp, 'MED', v_day);

  insert into public.medicine_stock (id, company_id, medicine_id, date, kind, qty, rate_per_unit,
                                     supplier, purchase_ref, lot_number, expiry_date, remarks,
                                     created_by, created_at)
  values (v_id, v_comp, v_item.id, v_day, 'RECEIPT', v_qty, v_rate, v_sup, v_ref,
          nullif(trim(coalesce(p->>'lotNumber', '')), ''),
          nullif(p->>'expiryDate', '')::date,
          nullif(trim(coalesce(p->>'remarks', '')), ''), app.uid(), now());

  insert into public.audit (id, company_id, entity, entity_id, action, reason, by_user_id, at)
  values (app.id('au'), v_comp, 'MedicineStock', v_id, 'CREATE',
          format('%s %s %s from %s', v_item.name, v_qty, v_item.unit, v_sup), app.uid(), now());

  return jsonb_build_object('ok', true, 'id', v_id, 'purchaseRef', v_ref);
end
$$;

/**
 * medicineIssueRow() + useMedicine(): the validated shelf draw, as one reusable step.
 *
 * Stock off the shelf and onto the flock's account, valued at the average in force the moment
 * it is booked — and nothing from this write reaches the Finance ledger, so a medicine usage
 * cannot be counted twice. Returns the row it built (without writing it) so completing a
 * vaccination can book its dose in the same statement as its status.
 */
create or replace function app.medicine_issue(p jsonb, p_write boolean default true)
returns jsonb
language plpgsql volatile security invoker set search_path = app, public
as $$
declare
  v_comp  text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_item  public.medicine_items;
  v_day   date := nullif(p->>'date', '')::date;
  v_qty   numeric := app.num(p->>'qty');
  v_shed  public.sheds;
  v_batch public.batches;
  v_stock numeric;
  v_avg   numeric;
  v_expense numeric;
  v_id    text := app.id('ms');
begin
  if v_comp is null then raise exception 'No company selected'; end if;
  select * into v_item from public.medicine_items
   where id = nullif(p->>'medicineId', '') and company_id = v_comp;
  if v_item.id is null then
    raise exception 'Choose the medicine or vaccine in this store';
  end if;
  if v_day is null then raise exception 'Choose the date it was used'; end if;
  if not (v_qty > 0) then raise exception 'Quantity must be greater than 0'; end if;
  if trim(coalesce(p->>'reason', '')) = '' then raise exception 'Say what it was used for'; end if;
  if trim(coalesce(p->>'usedBy', '')) = '' then raise exception 'Enter who used it'; end if;
  select * into v_shed from public.sheds
   where id = nullif(p->>'shedId', '') and company_id = v_comp;
  if v_shed.id is null then raise exception 'Choose the shed this went into'; end if;
  if nullif(p->>'batchId', '') is not null then
    select * into v_batch from public.batches
     where id = p->>'batchId' and company_id = v_comp;
    if v_batch.id is null then raise exception 'Batch does not belong to this company'; end if;
    if v_batch.shed_id <> v_shed.id then
      raise exception '% is not in %', v_batch.code, v_shed.name;
    end if;
  end if;
  if app.is_locked(v_shed.id, v_day) then raise exception 'Day is locked — contact owner'; end if;

  select k.kg, k.average into v_stock, v_avg
   from app.valuation_at(v_comp, 'medicine', v_item.id, v_day) k;
  if coalesce(v_stock, 0) < v_qty then
    raise exception 'Only % % of % in stock', trim(to_char(coalesce(v_stock, 0), 'FM999999990.###')),
      v_item.unit, v_item.name;
  end if;
  v_expense := case when v_avg is null then null else round(v_qty * v_avg, 2) end;

  if p_write then
    insert into public.medicine_stock (id, company_id, medicine_id, date, kind, qty,
                                       rate_per_unit, amount, shed_id, batch_id, reason, used_by,
                                       vaccination_id, remarks, created_by, created_at)
    values (v_id, v_comp, v_item.id, v_day, 'USAGE', v_qty, v_avg, v_expense, v_shed.id,
            nullif(v_batch.id, ''), trim(p->>'reason'), trim(p->>'usedBy'),
            nullif(p->>'vaccinationId', ''), nullif(trim(coalesce(p->>'remarks', '')), ''),
            app.uid(), now());
    insert into public.audit (id, company_id, entity, entity_id, action, reason, by_user_id, at)
    values (app.id('au'), v_comp, 'MedicineStock', v_id, 'CREATE',
            format('%s %s %s → %s · %s', v_item.name, v_qty, v_item.unit, v_shed.name,
                   coalesce(to_char(v_expense, 'FM999999990.00'), 'no cost basis')),
            app.uid(), now());
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'expense', v_expense,
                            'average', v_avg, 'qty', v_qty,
                            'itemName', v_item.name, 'unit', v_item.unit, 'shedName', v_shed.name);
end
$$;

/** adjustMedicine(): a counted shelf corrected, signed, with the reason the count changed. */
create or replace function app.adjust_medicine(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = app, public
as $$
declare
  v_comp text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_item public.medicine_items;
  v_day  date := nullif(p->>'date', '')::date;
  v_qty  numeric := app.num(p->>'qty');
  v_bal  numeric;
  v_id   text := app.id('ms');
begin
  if v_comp is null then raise exception 'No company selected'; end if;
  select * into v_item from public.medicine_items
   where id = nullif(p->>'medicineId', '') and company_id = v_comp;
  if v_item.id is null then raise exception 'Choose the medicine or vaccine'; end if;
  if v_day is null then raise exception 'Choose the date of the correction'; end if;
  if v_qty = 0 then raise exception 'Enter the correction, positive or negative'; end if;
  if trim(coalesce(p->>'reason', '')) = '' then
    raise exception 'Say why the count is being corrected';
  end if;
  select k.kg into v_bal from app.valuation_at(v_comp, 'medicine', v_item.id, v_day) k;
  if coalesce(v_bal, 0) + v_qty < 0 then
    raise exception 'Only % % in stock — this correction would take the shelf below zero',
      trim(to_char(v_bal, 'FM999999990.###')), v_item.unit;
  end if;

  insert into public.medicine_stock (id, company_id, medicine_id, date, kind, qty, reason,
                                     used_by, remarks, created_by, created_at)
  values (v_id, v_comp, v_item.id, v_day, 'ADJUSTMENT', v_qty, trim(p->>'reason'),
          (select name from public.profiles where id = app.uid()),
          nullif(trim(coalesce(p->>'remarks', '')), ''), app.uid(), now());
  insert into public.audit (id, company_id, entity, entity_id, action, reason, by_user_id, at)
  values (app.id('au'), v_comp, 'MedicineStock', v_id, 'CREATE',
          format('%s %s%s %s · %s', v_item.name, case when v_qty > 0 then '+' else '−' end,
                 trim(to_char(abs(v_qty), 'FM999999990.###')), v_item.unit, trim(p->>'reason')),
          app.uid(), now());
  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

-- ============================= FLOCK HEALTH =============================

/**
 * completeVaccination(): the dose, its stock draw and the history rows, in one statement.
 *
 * `scheduledDate` is not among the fields this writes: a dose given late keeps both days on
 * the record and reads as late. When the dose came out of the store, the same step books the
 * one usage that takes it off the shelf — and a dose that already has its usage never gets a
 * second one, which the unique (company_id, vaccination_id) key on the shelf also refuses.
 * SECURITY INVOKER: the row the caller may write is exactly the row 003 lets them complete.
 */
create or replace function app.complete_vaccination(p_id text, p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = app, public
as $$
declare
  v_comp text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v        public.vaccinations;
  v_batch  public.batches;
  v_date   date := nullif(p->>'completedDate', '')::date;
  v_by     text := trim(coalesce(p->>'completedBy', ''));
  v_issued jsonb;
  v_late   integer;
  v_why    text;
begin
  select * into v from public.vaccinations where id = p_id and company_id = v_comp;
  if v.id is null then raise exception 'Vaccination not found'; end if;
  if v.status = 'COMPLETED' then raise exception 'This vaccination is already recorded'; end if;
  if v.status = 'CANCELLED' then raise exception 'This vaccination was cancelled'; end if;

  select * into v_batch from public.batches where id = v.batch_id;
  if v_batch.id is null or v_batch.company_id <> v_comp then
    raise exception 'Batch does not belong to this company';
  end if;
  -- A closed batch keeps its plan as history and stops asking for action.
  if v_batch.status <> 'ACTIVE' then
    raise exception 'This batch is closed — its vaccination schedule stands as history';
  end if;
  if not app.can_on_batch(v_comp, v.batch_id, 'completeVaccination') then
    raise exception 'You are not permitted to record a vaccination for this batch';
  end if;

  if v_date is null then raise exception 'Choose the date it was given'; end if;
  if v_date > current_date then
    raise exception 'A vaccination cannot be given on a future date';
  end if;
  if v_by = '' then raise exception 'Enter who administered it'; end if;
  if app.is_locked(v.shed_id, v_date) then raise exception 'Day is locked — contact owner'; end if;

  -- A dose is deducted once, so reopening the record cannot take a second lot off the shelf.
  if nullif(p->>'medicineId', '') is not null
     and not exists (select 1 from public.medicine_stock m
                      where m.vaccination_id = p_id and m.company_id = v_comp) then
    v_issued := app.medicine_issue(jsonb_build_object(
      'companyId', v_comp, 'medicineId', p->>'medicineId', 'date', v_date::text,
      'qty', coalesce(app.num(p->>'medicineQty'), 0), 'shedId', v.shed_id, 'batchId', v.batch_id,
      'reason', 'Vaccination', 'usedBy', v_by,
      'remarks', coalesce(p->>'completionRemarks', ''), 'vaccinationId', p_id));
  end if;

  v_late := (v_date - v.scheduled_date)::int;
  v_why := 'Given by ' || v_by
    || case when v_late <> 0 then ' · ' || abs(v_late)::text
            || case when abs(v_late) = 1 then ' day ' else ' days ' end
            || case when v_late > 0 then 'late' else 'early' end end
    || case when v_issued is not null
            then ' · ' || trim(to_char((v_issued ->> 'qty')::numeric, 'FM999999990.###'))
                 || ' drawn from the medicine store' end;

  update public.vaccinations set
    status = 'COMPLETED', completed_date = v_date, completed_at = now(), completed_by = v_by,
    actual_dose = nullif(trim(coalesce(p->>'actualDose', '')), ''),
    completion_remarks = nullif(trim(coalesce(p->>'completionRemarks', '')), ''),
    updated_at = now()
  where id = p_id;

  -- One audit row per field the completion touched, all carrying the reason.
  insert into public.audit (id, company_id, entity, entity_id, action, field, old_value, new_value, reason, by_user_id, at)
  values (app.id('au'), v_comp, 'Vaccination', p_id, 'UPDATE', 'status', to_jsonb(v.status), '"COMPLETED"', v_why, app.uid(), now()),
         (app.id('au'), v_comp, 'Vaccination', p_id, 'UPDATE', 'completedDate', 'null', to_jsonb(v_date), v_why, app.uid(), now());

  return jsonb_build_object('ok', true, 'id', p_id, 'lateBy', v_late,
                            'expense', case when v_issued is null then null else v_issued -> 'expense' end,
                            'usageId', case when v_issued is null then null else v_issued ->> 'id' end);
end
$$;

-- ============================= FEED FORMULA VERSIONS =============================

/**
 * reviseFeedFormula() (src/store/app.ts). SECURITY DEFINER, and not for the money: whether a
 * version has already been consumed decides between a plain correction and a new version, and
 * that question is asked of feed_consumption — which some formula managers' policies cannot
 * read. Answered wrongly it would rewrite the mix a past day was fed, so the read is taken
 * with full sight while the write still needs the caller's own manageFormulas reach.
 */
create or replace function app.revise_feed_formula(p_id text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_comp     text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_existing public.feed_formulas;
  v_prev_items jsonb;
  v_items    jsonb;
  v_shed     public.sheds;
  v_role     text;
  v_used     boolean;
  v_assigned boolean;
  v_granted  boolean;
  v_shed_id  text;
  v_name     text := trim(coalesce(p->>'name', ''));
  v_new_id   text;
  v_version  integer;
  v_i        integer := -1;
  v_item     jsonb;
begin
  if app.uid() is null then raise exception 'You are not signed in'; end if;
  select * into v_existing from public.feed_formulas where id = p_id and company_id = v_comp;
  if v_existing.id is null then raise exception 'Formula not found'; end if;
  -- The mix as it stands now, kept for the audit row this revision is asked to explain.
  select coalesce(jsonb_agg(jsonb_build_object('ingredient', i.ingredient,
                                               'kgPerTonne', i.kg_per_tonne)
                            order by i.position), '[]'::jsonb)
    into v_prev_items
    from public.feed_formula_items i where i.formula_id = p_id;

  -- hasConsumption(): the client pins formula_id on every consumption row it books, so a
  -- version that fed is one that appears there. Used versions are never edited in place.
  select exists (select 1 from public.feed_consumption c
                  where c.formula_id = v_existing.id) into v_used;
  -- A version that already fed is tied to its shed for history; an unused one may move.
  v_shed_id := case when v_used then v_existing.shed_id
                    else coalesce(nullif(p->>'shedId', ''), v_existing.shed_id) end;

  -- canManageFormula() (src/store/app.ts), step for step: the Owner reaches any shed, a batch
  -- grant reaches its own, and everyone else is limited to what their role already holds —
  -- with supervisors further limited to the shed they are named on.
  select * into v_shed from public.sheds where id = v_shed_id and company_id = v_comp;
  if v_shed.id is null then raise exception 'You cannot manage formulas for this shed'; end if;
  v_role := app.role_in(v_comp);
  select exists (
    select 1 from public.batch_assignments a
    join public.batches b on b.id = a.batch_id
    where a.user_id = app.uid() and b.shed_id = v_shed.id
  ), exists (
    select 1 from public.batch_assignments a
    join public.batches b on b.id = a.batch_id
    where a.user_id = app.uid() and b.shed_id = v_shed.id
      and (a.permissions ->> 'manageFormulas') = 'true'
  ) into v_assigned, v_granted;

  if v_role = 'OWNER' or v_granted then
    null;  -- the two unconditional reaches
  elsif not app.role_can(v_comp, 'manageFormulas') then
    raise exception 'You cannot manage formulas for this shed';
  elsif v_role = 'FARM_SUPERVISOR' then
    if v_shed.farm_supervisor_id is distinct from app.uid() and not v_assigned then
      raise exception 'You cannot manage formulas for this shed';
    end if;
  elsif not v_assigned then
    raise exception 'You cannot manage formulas for this shed';
  end if;

  if v_name = '' then raise exception 'Formula name is required'; end if;
  -- normalizeItems(): whole-of-two-decimals KG per tonne, blank names and zero shares dropped.
  select coalesce(jsonb_agg(x.i order by (x.i ->> '_p')::int), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object('_p', ord - 1,
                              'ingredient', trim(coalesce(i ->> 'ingredient', '')),
                              'kgPerTonne', round(app.num(i ->> 'kgPerTonne'), 2)) i
    from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) with ordinality e(i, ord)
  ) x
  where x.i ->> 'ingredient' <> '' and (x.i ->> 'kgPerTonne')::numeric > 0;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one ingredient with a quantity';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) i
             group by lower(i ->> 'ingredient') having count(*) > 1) then
    raise exception '% appears twice in the mix',
      (select min(i ->> 'ingredient') from jsonb_array_elements(v_items) i
       group by lower(i ->> 'ingredient') having count(*) > 1 limit 1);
  end if;

  if not v_used then
    -- Nothing has consumed this version yet, so a plain correction is safe.
    update public.feed_formulas f set
      name = v_name, shed_id = v_shed_id,
      effective_from = coalesce(nullif(p->>'effectiveFrom', '')::date, f.effective_from),
      change_reason = coalesce(nullif(p->>'changeReason', ''), f.change_reason),
      updated_at = now()
    where f.id = p_id;
    delete from public.feed_formula_items i where i.formula_id = p_id;
  else
    v_new_id := app.id('ff');
    select max(f.version) + 1 into v_version
      from public.feed_formulas f where f.family_id = v_existing.family_id;
    -- An ACTIVE formula is replaced by the new version; a superseded one is amended alongside.
    -- deactivateOther() takes no exception here: the version that just fed is itself superseded,
    -- and its own mix stays untouched to be read back.
    if v_existing.status = 'ACTIVE' then
      update public.feed_formulas f set
        status = 'INACTIVE', superseded_at = coalesce(f.superseded_at, now()), updated_at = now()
      where f.shed_id = v_shed_id and f.status = 'ACTIVE';
    end if;
    insert into public.feed_formulas (id, company_id, shed_id, name, family_id, version,
                                      effective_from, status, change_reason, created_by,
                                      created_at, updated_at)
    values (v_new_id, v_comp, v_shed_id, v_name, v_existing.family_id, v_version,
            coalesce(nullif(p->>'effectiveFrom', '')::date, current_date), v_existing.status,
            nullif(p->>'changeReason', ''), app.uid(), now(), now());
    p_id := v_new_id;
  end if;

  v_i := -1;
  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_i := v_i + 1;
    insert into public.feed_formula_items (formula_id, position, ingredient, kg_per_tonne)
    values (p_id, v_i, v_item ->> 'ingredient', (v_item ->> 'kgPerTonne')::numeric);
  end loop;

  -- A plain correction is audited as the field it moved; a new version is created, and both
  -- the mix it replaced and the mix it now holds stand in the row.
  insert into public.audit (id, company_id, entity, entity_id, action, field, old_value, new_value, by_user_id, at)
  values (app.id('au'), v_comp, 'FeedFormula', p_id,
          case when v_used then 'CREATE' else 'UPDATE' end,
          case when v_used then null else 'items' end,
          v_prev_items,
          v_items, app.uid(), now());

  return jsonb_build_object('ok', true, 'id', p_id,
                            'version', (select f.version from public.feed_formulas f where f.id = p_id),
                            'totalKg', (select round(sum(i.kg_per_tonne), 2)
                                          from public.feed_formula_items i where i.formula_id = p_id));
end
$$;

-- ============================= THE MONEY THAT SETTLES A BILL =============================

/** accountabilityError() (src/lib/cashflow.ts): what a money movement must carry. */
create or replace function app.accountability_error(
  p_kind text, p_method text, p_handled_by uuid
) returns text
language sql immutable set search_path = app, public
as $$
  -- Kinds that raise a bill or restate a position are not a movement of money at all.
  select case when p_kind in ('OPENING','EGG_SALE','RATE_UPDATE') then null
              when p_method is null then 'Select how the money was paid'
              when p_method <> 'CASH' then null
              when p_handled_by is not null then null
              when p_kind in ('INCOME','SALE','PAYMENT_IN') then 'Record who received the cash'
              else 'Record who paid the cash' end
$$;

/**
 * recordPurchasePayment(): the money that settles a receipt, and nothing else.
 *
 * SECURITY DEFINER because this is a Finance write on a stock table's payable: the caller
 * needs viewFinance (the store's gate), and the receipt it settles is read from either store —
 * a payment cannot be told which ledger it belongs to by whichever one the caller can browse.
 * Stock, the purchase value and the P&L are all untouched: this row is only the money that
 * left, and the payable it closes is read back off the ledger.
 */
create or replace function app.record_purchase_payment(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_comp   text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_day    date := nullif(p->>'date', '')::date;
  v_feed   public.feed_stock;
  v_med    public.medicine_stock;
  v_kind   text;
  v_qty    numeric;
  v_rate   numeric;
  v_supplier text;
  v_ref    text;
  v_value  numeric;
  v_paid   numeric;
  v_due    numeric;
  v_amount numeric := app.num(p->>'amount');
  v_method text := nullif(p->>'paymentMethod', '');
  v_handler uuid := app.person(p->>'handledById');
  v_problem text;
  v_id     text := app.id('fx');
begin
  if app.uid() is null then raise exception 'You are not signed in'; end if;
  if v_comp is null then raise exception 'No company selected'; end if;
  if not app.role_can(v_comp, 'viewFinance') then
    raise exception 'Only Finance/Owner can record a payment';
  end if;
  if v_day is null then raise exception 'Choose the date the money was paid'; end if;

  -- A payable is a payable whichever store raised it: the money row is written the same way,
  -- and the receipt it settles is never restated by the payment.
  select * into v_feed from public.feed_stock
   where id = nullif(p->>'purchaseId', '') and company_id = v_comp;
  select * into v_med  from public.medicine_stock
   where id = nullif(p->>'purchaseId', '') and company_id = v_comp;
  if v_feed.id is null and v_med.id is null then
    raise exception 'Select the purchase this payment settles';
  end if;
  if v_med.id is not null then
    v_kind := case v_med.kind when 'OPENING' then 'OPENING' when 'RECEIPT' then 'FEED_IN'
                              when 'USAGE' then 'CONSUMPTION' else 'ADJUSTMENT' end;
    v_qty := v_med.qty; v_rate := v_med.rate_per_unit; v_supplier := v_med.supplier;
    v_ref := v_med.purchase_ref;
  else
    v_kind := v_feed.kind; v_qty := v_feed.qty_kg; v_rate := v_feed.rate_per_kg;
    v_supplier := v_feed.supplier; v_ref := v_feed.purchase_ref;
  end if;
  if v_kind <> 'FEED_IN' then
    raise exception 'Only a stock purchase carries a payable';
  end if;

  -- purchaseValue() / purchasePosition(): value is the receipt's own quantity × its rate, and
  -- a receipt with no rate has no value either — reported as a gap, never rounded down to ₹0.
  if coalesce(v_qty, 0) > 0 and coalesce(v_rate, 0) > 0 then
    v_value := round(v_qty * v_rate, 2);
  end if;
  if v_value is null then
    raise exception 'This purchase carries no receipt rate, so there is no amount to pay';
  end if;
  select coalesce(sum(f.amount), 0) into v_paid from public.finance_txns f
   where f.purchase_id = p->>'purchaseId' and f.company_id = v_comp;
  v_due := round(v_value - v_paid, 2);
  if not (v_amount > 0) then raise exception 'Enter the amount paid'; end if;
  if v_due > 0 and round(v_amount, 2) > v_due then
    raise exception 'Only % is still due on this purchase', to_char(v_due, 'FM999999990.00');
  end if;
  v_problem := app.accountability_error('PAYMENT_OUT', v_method, v_handler);
  if v_problem is not null then raise exception '%', v_problem; end if;

  insert into public.finance_txns (id, company_id, date, kind, amount, category, counterparty,
                                   godown, purchase_id, payment_method, time, handled_by,
                                   handed_to, authorized_by, reference, remarks,
                                   created_by, created_at)
  values (v_id, v_comp, v_day, 'PAYMENT_OUT', round(v_amount, 2),
          case when v_med.id is not null then 'Medicine Purchase' else 'Feed Purchase' end,
          nullif(v_supplier, ''), true, p->>'purchaseId', v_method,
          app.clock(p->>'time'), v_handler, nullif(p->>'handedTo', ''),
          app.person(p->>'authorizedById'), nullif(p->>'reference', ''),
          nullif(p->>'remarks', ''), app.uid(), now());

  insert into public.audit (id, company_id, entity, entity_id, action, field, new_value, by_user_id, at)
  values (app.id('au'), v_comp, 'Finance', v_id, 'CREATE', 'purchaseId',
          to_jsonb(coalesce(v_ref, p->>'purchaseId')), app.uid(), now());

  return jsonb_build_object('ok', true, 'id', v_id, 'value', v_value, 'paid', round(v_paid + v_amount, 2),
                            'outstanding', round(v_due - round(v_amount, 2), 2));
end
$$;

/**
 * recordSalePayment(): one receipt, two books, no re-billing of the load it settles.
 *
 * The finance row is the money that arrived; the trader row is what settles that load, and it
 * points at the voucher through sale_id rather than ref_id — the voucher owns its own ref_id
 * rows, and a later receipt is not part of the voucher. That distinction is what keeps the
 * receivable on a load readable after the fact.
 */
create or replace function app.record_sale_payment(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = app, public
as $$
declare
  v_comp   text := coalesce(nullif(p->>'companyId', ''), app.current_company());
  v_entry  public.sale_entries;
  v_trader public.traders;
  v_day    date := nullif(p->>'date', '')::date;
  v_amount numeric := app.num(p->>'amount');
  v_method text := nullif(p->>'paymentMethod', '');
  v_handler uuid := app.person(p->>'handledById');
  v_billed numeric;
  v_paid   numeric;
  v_due    numeric;
  v_split  jsonb;
  v_method_row text;
  v_problem text;
  v_tt     text := app.id('tt');
  v_fx     text := app.id('fx');
begin
  if app.uid() is null then raise exception 'You are not signed in'; end if;
  if v_comp is null then raise exception 'No company selected'; end if;
  if not (app.role_can(v_comp, 'viewFinance') and app.role_can(v_comp, 'manageTraders')) then
    raise exception 'Only Finance/Owner can record a receipt against a sale';
  end if;
  select * into v_entry from public.sale_entries
   where id = nullif(p->>'saleId', '') and company_id = v_comp;
  if v_entry.id is null then
    raise exception 'Select the sale this money was received against';
  end if;
  select * into v_trader from public.traders
   where id = v_entry.trader_id and company_id = v_comp;
  if v_trader.id is null then
    raise exception 'The trader on this sale is no longer in this company';
  end if;
  if v_day is null then raise exception 'Choose the date the money was received'; end if;

  -- saleOutstanding(): billed for the load against the voucher money plus every later receipt.
  v_billed := round(v_entry.amount + v_entry.labor_charge, 2);
  select round(v_entry.cash + v_entry.phonepe + v_entry.advance
               + coalesce(sum(t.amount), 0), 2) into v_paid
    from public.trader_txns t
    where t.sale_id = v_entry.id and t.kind = 'PAYMENT_IN';
  v_due := round(v_billed - v_paid, 2);
  if not (v_amount > 0) then raise exception 'Enter the amount received'; end if;
  if v_due > 0 and round(v_amount, 2) > v_due then
    raise exception 'Only % is still due on this sale', to_char(v_due, 'FM999999990.00');
  end if;
  v_problem := app.accountability_error('PAYMENT_IN', v_method, v_handler);
  if v_problem is not null then raise exception '%', v_problem; end if;

  -- How the money arrived, spoken as the ledger's own language rather than as remarks prose.
  v_split := case v_method
               when 'CASH' then jsonb_build_object('cash', round(v_amount, 2))
               when 'CHEQUE' then jsonb_build_object('cheque', round(v_amount, 2))
               when 'OTHER' then jsonb_build_object('other', round(v_amount, 2))
               else jsonb_build_object('online', round(v_amount, 2)) end;
  v_method_row := case when v_method in ('CASH','CHEQUE','OTHER') then null else v_method end;

  insert into public.trader_txns (id, company_id, trader_id, date, kind, amount, sale_id,
                                  payment_method, split, time, handled_by, handed_to,
                                  authorized_by, reference, remarks, created_by, created_at)
  values (v_tt, v_comp, v_trader.id, v_day, 'PAYMENT_IN', round(v_amount, 2), v_entry.id,
          v_method, v_split, app.clock(p->>'time'), v_handler, nullif(p->>'handedTo', ''),
          app.person(p->>'authorizedById'), nullif(p->>'reference', ''), nullif(p->>'remarks', ''),
          app.uid(), now());

  insert into public.finance_txns (id, company_id, date, kind, amount, category, counterparty,
                                   sale_id, payment_method, split, time, handled_by, handed_to,
                                   authorized_by, reference, remarks, created_by, created_at)
  values (v_fx, v_comp, v_day, 'PAYMENT_IN', round(v_amount, 2), 'Egg Sale', v_trader.name,
          v_entry.id, v_method, v_split, app.clock(p->>'time'), v_handler, nullif(p->>'handedTo', ''),
          app.person(p->>'authorizedById'), nullif(p->>'reference', ''), nullif(p->>'remarks', ''),
          app.uid(), now());

  insert into public.audit (id, company_id, entity, entity_id, action, field, new_value, by_user_id, at)
  values (app.id('au'), v_comp, 'Finance', v_fx, 'CREATE', 'saleId', to_jsonb(v_entry.id), app.uid(), now());

  return jsonb_build_object('ok', true, 'traderTxnId', v_tt, 'financeId', v_fx,
                            'outstanding', round(v_due - round(v_amount, 2), 2));
end
$$;

-- ============================= WHO MAY CALL WHAT =============================

-- These are the app's write paths, so the client role executes them; anon never does. The
-- functions carry their own checks, so nothing here widens what a caller may already do.
grant execute on function
  app.id(text), app.num(text), app.person(text), app.clock(text), app.r2(numeric),
  app.is_locked(text, date), app.batch_of_shed_on(text, date),
  app.valuation_at(text, text, text, date), app.average_at(text, text, text, date),
  app.godown_kg(text, text), app.egg_balance(text, text, date, text),
  app.can_on_batch(text, text, text), app.next_receipt_no(text, text, date, integer),
  app.save_sale_entry(jsonb), app.delete_sale_entry(text), app.add_feed_stock(jsonb),
  app.receive_medicine(jsonb), app.medicine_issue(jsonb, boolean), app.adjust_medicine(jsonb),
  app.complete_vaccination(text, jsonb), app.revise_feed_formula(text, jsonb),
  app.accountability_error(text, text, uuid),
  app.record_purchase_payment(jsonb), app.record_sale_payment(jsonb)
to authenticated, service_role;

revoke execute on function
  app.next_receipt_no(text, text, date, integer), app.save_sale_entry(jsonb),
  app.delete_sale_entry(text), app.add_feed_stock(jsonb), app.receive_medicine(jsonb),
  app.medicine_issue(jsonb, boolean), app.adjust_medicine(jsonb),
  app.complete_vaccination(text, jsonb), app.revise_feed_formula(text, jsonb),
  app.record_purchase_payment(jsonb), app.record_sale_payment(jsonb)
from anon;
