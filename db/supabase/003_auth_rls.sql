-- ============================= AMRUT POULTRY · 003 TENANCY AND RLS =============================
/*
 * Company isolation and permissions stop being a JavaScript convention here.
 *
 * Today useCompanyData() (src/store/app.ts) filters one hydrated blob in a memo, so anything
 * holding the connection string can read every farm in the database, and the ₹••••• mask is a
 * rendering decision. These policies make the row answer two questions: does the caller belong
 * to this company, and does their role allow this action?
 *
 * Two permission layers, kept apart exactly as the client keeps them apart:
 *   · RLS (this file)   — the role matrix (src/lib/permissions.ts), because a role is a fact
 *                         about a person in a company and can be evaluated per row.
 *   · RPCs (004)        — the per-batch jsonb grant set on batch_assignments (canOnBatch),
 *                         because it depends on which batch is open and must be passed in.
 * Anything needing both is decided in 004; no policy here is widened to accommodate it.
 *
 * Note there is no `force row level security` in this file on purpose: it would also apply to
 * the migration role, which owns these tables and has to keep being able to alter and import
 * them. The API role (`authenticated`) is not the owner, so every statement below is enforced
 * for it, and `service_role` (imports, backups) is BYPASSRLS by Supabase's own design.
 */

-- ============================= BASE GRANTS =============================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables    in schema public from public;
grant usage on schema public to authenticated;

-- What `authenticated` gets here is the ceiling; RLS below is the floor, and the floor is what
-- decides who may write a voucher versus merely read one. The heavier writes still belong to
-- the 004 functions because they span several tables at once.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ============================= ENABLE RLS EVERYWHERE =============================
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

/* =============================================================================
 * THE COMPANY POLICY TEMPLATE, APPLIED PER TABLE
 *
 * Columns: table, its company column, then the SELECT / INSERT / UPDATE / DELETE predicate.
 * Each predicate is one of:
 *   '*'              any member of the company that owns the row
 *   'key:<name>'     the role matrix says so (src/lib/permissions.ts · PermissionKey)
 *   'roles:A,B'      a module gate from src/lib/permissions.ts · *_ROLES
 *   'false'          nothing is created, so the verb is denied to every caller
 * `C` inside a predicate is replaced by the qualified company column, so it reads the row it
 * guards rather than a parameter the caller controls.
 * ============================================================================= */
do $$
declare
  x        record;
  verbs    text[] := array['select','insert','update','delete'];
  v        text;
  raw      text;
  expr     text;
  colref   text;
begin
  for x in
    select * from (values
      -- ---- FLOCK: the daily record of a company's own birds ------------------------------
      ('mortality',            'company_id', '*',                    'key:createDailyOps', 'key:update',           'key:delete'),
      ('egg_collections',      'company_id', '*',                    'key:createDailyOps', 'key:update',           'key:delete'),
      ('feed_round_logs',      'company_id', 'roles:OWNER,FARM_SUPERVISOR,FARM_MANAGER,FARM_LABOR,MASTER_ADMIN',
                                                                        'key:createDailyOps', 'key:update',           'key:delete'),
      ('feed_consumption',     'company_id', 'roles:OWNER,FARM_SUPERVISOR,FINANCIAL_SUPERVISOR,FARM_MANAGER,MASTER_ADMIN',
                                                                        'key:createDailyOps', 'key:update',           'key:delete'),
      ('tasks',                'company_id', '*',                    'key:create',         'key:update',           'key:delete'),
      ('sale_logs',            'company_id', '*',                    'key:create',         'key:update',           'key:delete'),

      -- ---- STRUCTURE: who lays out farms, sheds and batches ------------------------------
      ('farms',                'company_id', '*',                    'roles:OWNER,FARM_SUPERVISOR,MASTER_ADMIN',
                                                                        'roles:OWNER,FARM_SUPERVISOR,MASTER_ADMIN', 'key:delete'),
      ('sheds',                'company_id', '*',                    'roles:OWNER,FARM_SUPERVISOR,MASTER_ADMIN',
                                                                        'roles:OWNER,FARM_SUPERVISOR,MASTER_ADMIN', 'key:delete'),
      ('batches',              'company_id', '*',                    'key:create',         'key:update',           'key:delete'),
      ('batch_closings',       'company_id', '*',                    'key:closeBatch',     'key:closeBatch',       'key:closeBatch'),
      ('batch_assignments',    'company_id', '*',                    'key:manageUsers',    'key:manageUsers',      'key:manageUsers'),

      -- ---- FEED FORMULAS: readable by every role except labor, edited only by manage ------
      ('feed_formulas',        'company_id', 'roles:OWNER,FARM_SUPERVISOR,FINANCIAL_SUPERVISOR,FARM_MANAGER,MASTER_ADMIN',
                                                                        'key:manageFormulas', 'key:manageFormulas',   'key:manageFormulas'),
      ('feed_stock',           'company_id', 'roles:OWNER,FARM_SUPERVISOR,FINANCIAL_SUPERVISOR,MASTER_ADMIN',
                                                                        'key:createDailyOps', 'key:update',           'key:delete'),

      -- ---- FLOCK HEALTH: the vaccination module and its store (§13) ----------------------
      ('vaccinations',         'company_id', 'roles:OWNER,FARM_SUPERVISOR,FARM_MANAGER,FARM_LABOR',
                                                                        'key:manageVaccination', 'key:completeVaccination', 'key:manageVaccination'),
      ('vaccination_templates','company_id', 'roles:OWNER,FARM_SUPERVISOR,FARM_MANAGER,FARM_LABOR',
                                                                        'key:manageVaccination', 'key:manageVaccination', 'key:manageVaccination'),
      ('medicine_items',       'company_id', 'roles:OWNER,FARM_SUPERVISOR,FARM_MANAGER,FARM_LABOR,MASTER_ADMIN',
                                                                        'key:manageVaccination', 'key:manageVaccination', 'key:manageVaccination'),
      ('medicine_stock',       'company_id', 'roles:OWNER,FARM_SUPERVISOR,FARM_MANAGER,FARM_LABOR,MASTER_ADMIN',
                                                                        'key:completeVaccination', 'key:update',      'key:delete'),

      -- ---- MONEY: unreadable without viewFinance, so masking is a property of the row ----
      ('traders',              'company_id', 'key:viewFinance',      'key:manageTraders',  'key:manageTraders',    'key:manageTraders'),
      ('trader_txns',          'company_id', 'key:viewFinance',      'key:createSaleEntries', 'false',             'false'),
      ('finance_txns',         'company_id', 'key:viewFinance',      'key:viewFinance',    'false',                'false'),
      ('sale_entries',         'company_id', 'key:viewFinance',      'key:createSaleEntries', 'false',             'false'),
      ('egg_sale_bookings',    'company_id', 'key:viewFinance',      'key:createSaleEntries', 'key:createSaleEntries', 'key:delete'),
      ('cash_handovers',       'company_id', 'key:viewFinance',      'key:viewFinance',    'false',                'false'),
      ('cash_counts',          'company_id', 'key:viewFinance',      'key:viewFinance',    'false',                'false'),

      -- ---- CONTROL ----------------------------------------------------------------------
      ('audit',                'company_id', 'key:manageUsers',      '*',                  'false',                'false'),
      ('receipt_counters',     'company_id', 'false',                'false',              'false',                'false')
    ) as t(rel, col, s, i, u, d)
  loop
    colref := 'public.' || x.rel || '.' || x.col;
    for v in select unnest(verbs) loop
      raw := case v when 'select' then x.s when 'insert' then x.i
                    when 'update' then x.u else x.d end;
      continue when raw = 'false';
      expr := case
        when raw = '*' then 'app.member_of(' || colref || ')'
        when raw like 'key:%' then 'app.role_can(' || colref || ', ' || quote_literal(substr(raw, 5)) || ')'
        when raw like 'roles:%' then 'app.role_in(' || colref || ') in ('
          || (select string_agg(quote_literal(r), ',' order by r)
                from unnest(string_to_array(substr(raw, 7), ',')) r) || ')'
        else raw
      end;
      execute format('drop policy if exists company_%s on public.%I', v, x.rel);
      if v = 'select' then
        execute format('create policy company_select on public.%I for select to authenticated using (%s)', x.rel, expr);
      elsif v = 'insert' then
        execute format('create policy company_insert on public.%I for insert to authenticated with check (%s)', x.rel, expr);
      elsif v = 'update' then
        execute format('create policy company_update on public.%I for update to authenticated using (%s) with check (%s)',
          x.rel, expr, expr);
      else
        execute format('create policy company_delete on public.%I for delete to authenticated using (%s)', x.rel, expr);
      end if;
    end loop;
  end loop;
end $$;

/* =============================================================================
 * CHILD TABLES WITH NO COMPANY COLUMN
 * A voucher line, a formula ingredient, a template item and a consumption snapshot belong to
 * their parent, so they inherit the parent's right. Without these an RPC that writes a voucher
 * and then its lines would be refused by the lines.
 * ============================================================================= */
do $$
declare
  kid record;
  v   text;
  raw text;
begin
  for kid in
    select * from (values
      -- Lines carry trays and nothing else: anybody who may see the flock they came from may
      -- read them, which is what keeps a supervisor's egg stock correct without exposing the
      -- money on the voucher. The parent is therefore v_sale_entry_day (002) rather than
      -- sale_entries, because the money table is precisely what this reader may not open.
      -- Writing them is the accounts role's, and in practice the 004 function's.
      ('sale_entry_lines', 'v_sale_entry_day', 'sale_entry_id', 'sale_entry_id',
        'member', 'key:createSaleEntries', 'false', 'false'),
      ('feed_formula_items', 'feed_formulas', 'formula_id', 'id',
        'roles:OWNER,FARM_SUPERVISOR,FINANCIAL_SUPERVISOR,FARM_MANAGER,MASTER_ADMIN',
        'key:manageFormulas', 'key:manageFormulas', 'key:manageFormulas'),
      ('vaccination_template_items', 'vaccination_templates', 'template_id', 'id',
        'roles:OWNER,FARM_SUPERVISOR,FARM_MANAGER,FARM_LABOR',
        'key:manageVaccination', 'key:manageVaccination', 'key:manageVaccination'),
      ('feed_consumption_deductions', 'feed_consumption', 'consumption_id', 'id',
        'member', 'key:createDailyOps', 'false', 'false')
    ) as k(rel, parent, fk, pkey, s, i, u, d)
  loop
    for v in select unnest(array['select','insert','update','delete']) loop
      raw := case v when 'select' then kid.s when 'insert' then kid.i
                    when 'update' then kid.u else kid.d end;
      continue when raw = 'false';
      declare
        pred text := case
          when raw = 'member' then 'app.member_of(p.company_id)'
          when raw like 'key:%' then 'app.role_can(p.company_id, ' || quote_literal(substr(raw, 5)) || ')'
          when raw like 'roles:%' then 'app.role_in(p.company_id) in ('
            || (select string_agg(quote_literal(r), ',' order by r)
                  from unnest(string_to_array(substr(raw, 7), ',')) r) || ')'
        end;
        -- Resolves the parent from the row being touched.
        via_parent text := format(
          'exists (select 1 from public.%I p where p.%I = %I.%I and %s)',
          kid.parent, kid.pkey, kid.rel, kid.fk, pred);
        -- INSERT sees no alias of its own table, so the key is read bare off the new row.
        via_new text := format(
          'exists (select 1 from public.%I p where p.%I = %I and %s)',
          kid.parent, kid.pkey, kid.fk, pred);
      begin
        execute format('drop policy if exists company_%s on public.%I', v, kid.rel);
        if v = 'insert' then
          execute format('create policy company_insert on public.%I for insert to authenticated with check (%s)',
            kid.rel, via_new);
        elsif v = 'update' then
          execute format('create policy company_update on public.%I for update to authenticated using (%s) with check (%s)',
            kid.rel, via_parent, via_parent);
        else
          execute format('create policy company_%s on public.%I for %s to authenticated using (%s)',
            v, kid.rel, v, via_parent);
        end if;
      end;
    end loop;
  end loop;
end $$;

/* =============================================================================
 * THE TABLES THAT ARE NOT COMPANY-SCOPED
 * ============================================================================= */

-- COMPANIES: a member sees their own row; only the platform role creates, renames or retires.
drop policy if exists company_select on public.companies;
create policy company_select on public.companies
  for select to authenticated using (app.member_of(id) or app.is_master_admin());
drop policy if exists company_write on public.companies;
create policy company_write on public.companies
  for all to authenticated using (app.is_master_admin()) with check (app.is_master_admin());

-- PROFILES: the login identity. A person reads themselves; colleagues in a shared company read
-- the directory they already see on the team screen; the platform role administers it.
drop policy if exists company_select on public.profiles;
create policy company_select on public.profiles
  for select to authenticated using (
    id = app.uid()
    or app.is_master_admin()
    or exists (
      select 1 from public.company_users mine
      join public.company_users theirs on theirs.company_id = mine.company_id
      where mine.user_id = app.uid() and theirs.user_id = profiles.id
    )
  );
drop policy if exists company_write on public.profiles;
create policy company_write on public.profiles
  for insert to authenticated with check (app.is_master_admin());
drop policy if exists company_update on public.profiles;
create policy company_update on public.profiles
  for update to authenticated using (app.is_master_admin()) with check (app.is_master_admin());
drop policy if exists company_delete on public.profiles;
create policy company_delete on public.profiles
  for delete to authenticated using (app.is_master_admin());

-- MEMBERSHIP: readable inside a company (the team screen needs it), changed only by somebody
-- who manages users. Without the second clause a person could add themselves to another farm.
drop policy if exists company_select on public.company_users;
create policy company_select on public.company_users
  for select to authenticated using (app.member_of(company_id) or app.is_master_admin());
drop policy if exists company_write on public.company_users;
create policy company_write on public.company_users
  for all to authenticated
  using (app.role_can(company_id, 'manageUsers') or app.is_master_admin())
  with check (app.role_can(company_id, 'manageUsers') or app.is_master_admin());

-- SUPPORT MESSAGES: anybody may ask for help, including before they have a company at all.
drop policy if exists company_select on public.support_messages;
create policy company_select on public.support_messages
  for select to authenticated using (
    user_id = app.uid()
    or app.is_master_admin()
    or (company_id is not null and app.role_can(company_id, 'manageUsers'))
  );
drop policy if exists company_insert on public.support_messages;
create policy company_insert on public.support_messages
  for insert to authenticated with check (user_id is null or user_id = app.uid());
drop policy if exists company_update on public.support_messages;
create policy company_update on public.support_messages
  for update to authenticated using (app.is_master_admin()) with check (app.is_master_admin());

/*
 * INGREDIENTS is one catalogue for the whole platform, deliberately not company-scoped: an
 * ingredient is a thing, not a farm's data. Everyone reads it, anyone who runs a godown adds to
 * it (additive only — see src/store/app.ts · addIngredientType), only the platform role removes
 * it. The add test names no company, because the catalogue row is not the company's to begin
 * with; asking it to resolve one would fail for a person who belongs to two farms.
 */
drop policy if exists company_select on public.ingredients;
create policy company_select on public.ingredients for select to authenticated using (true);
drop policy if exists company_insert on public.ingredients;
create policy company_insert on public.ingredients
  for insert to authenticated with check (
    app.is_master_admin()
    or exists (
      select 1 from app.role_permissions rp
      join public.company_users cu on cu.role = rp.role
      where cu.user_id = app.uid() and rp.key = 'createDailyOps'
    )
  );
drop policy if exists company_delete on public.ingredients;
create policy company_delete on public.ingredients for delete to authenticated using (app.is_master_admin());

-- ============================= WHAT THIS FILE DOES NOT DO =============================
/*
 * `receipt_counters` gets no policy at all (the 'false' row above), which is the point: only a
 * SECURITY DEFINER function in 004 may take a number, so a client cannot hand itself a receipt
 * number or push the counter backwards.
 *
 * Money masking is no longer implemented here. A role without viewFinance cannot select
 * `sale_entries`, `traders`, `finance_txns` or any of the money views built on them, so the
 * ₹••••• path in TradersScreen/FinanceScreen becomes a rendering nicety rather than the control.
 */
