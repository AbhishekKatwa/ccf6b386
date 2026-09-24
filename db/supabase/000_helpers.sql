-- ============================= AMRUT POULTRY · 000 HELPERS =============================
/*
 * Identity, tenancy and the role matrix, in one place, because both the views (002) and the
 * policies (003) need them and neither should re-derive the other's answer.
 *
 * Every function here is SECURITY DEFINER with a pinned search_path. That is not a shortcut:
 * a policy on company_users cannot ask company_users "does this caller belong?" without
 * recursing into its own policy, so membership has to be readable by definition. These
 * functions read membership and the role matrix only — never business data.
 */

create schema if not exists app;
grant usage on schema app to authenticated, service_role;
revoke all on schema app from public, anon;

/** The signed-in user, from the JWT Supabase puts in `request.jwt.claims`. NULL for anon. */
create or replace function app.uid() returns uuid
language plpgsql stable security definer set search_path = app, public as $$
declare sub text;
begin
  begin
    sub := nullif(current_setting('request.jwt.claim.sub', true), '');
    if sub is null then
      sub := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
    end if;
  exception when others then
    sub := null;
  end;
  if sub is null or sub = '' then return null; end if;
  begin
    return sub::uuid;
  exception when others then
    return null;
  end;
end $$;

/** Any other top-level or nested JWT claim, as text. */
create or replace function app.claim(claim_path text[]) returns text
language plpgsql stable security definer set search_path = app, public as $$
declare raw text; v jsonb;
begin
  begin
    raw := nullif(current_setting('request.jwt.claims', true), '');
    if raw is null then return null; end if;
    v := raw::jsonb #> claim_path;
  exception when others then return null; end;
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  return trim(both '"' from v #>> '{}');
end $$;

/**
 * The company this request is acting for.
 *
 * The JWT is minted at login, so it can carry the company a user STARTED in but not the one
 * they switched to a minute later — which is the whole point of a Master Admin or a person in
 * two farms. So the caller states it per request (`app.company_id`, or the token's
 * app_metadata as the default) and RLS then proves they belong to it. Membership, not this
 * value, is the security boundary: naming another company wins nothing.
 */
create or replace function app.current_company() returns text
language sql stable security definer set search_path = app, public as $$
  select coalesce(
    nullif(current_setting('app.company_id', true), ''),
    app.claim(array['app_metadata','companyId']),
    app.claim(array['app_metadata','company_id']),
    (select cu.company_id from public.company_users cu
      where cu.user_id = app.uid() order by cu.company_id limit 1)
  )
$$;

/** Does the caller belong to this company? The one test every company policy starts from. */
create or replace function app.member_of(company text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select company is not null and exists (
    select 1 from public.company_users cu
    where cu.company_id = company and cu.user_id = app.uid()
  ) or (
    -- A Master Admin reaches every company from the platform side, without a membership row.
    exists (select 1 from public.profiles p where p.id = app.uid() and p.role = 'MASTER_ADMIN')
  )
$$;

/**
 * The caller's role inside one company.
 *
 * Falls back to the platform role for a Master Admin who is not a member of the company: their
 * authority comes from `profiles.role`, exactly as it does in the client's permissionsFor(),
 * and without this every company panel would read empty for the one role that exists to
 * inspect them. Everyone else is bounded by their membership row.
 */
create or replace function app.role_in(company text) returns text
language sql stable security definer set search_path = app, public as $$
  select coalesce(
    (select cu.role from public.company_users cu
      where cu.company_id = company and cu.user_id = app.uid()),
    (select p.role from public.profiles p
      where p.id = app.uid() and p.role = 'MASTER_ADMIN' and company is not null)
  )
$$;

/*
 * The role → permission matrix, as data.
 * This table IS src/lib/permissions.ts · DEFAULT_ROLE_PERMISSIONS. When a key changes there,
 * it changes here in the same commit — the client keeps checking its own copy for the UI, and
 * the database checks this one for the rows. Two copies of a list is a real risk, so it is
 * stated as the single seed below rather than buried in eighteen CASE expressions.
 */
create table if not exists app.role_permissions (
  role text not null check (role in (
         'MASTER_ADMIN','OWNER','FARM_SUPERVISOR','FINANCIAL_SUPERVISOR','FARM_MANAGER','FARM_LABOR')),
  key  text not null,
  primary key (role, key)
);
revoke all on app.role_permissions from public, anon, authenticated;

truncate app.role_permissions;
insert into app.role_permissions (role, key) values
  -- Global platform administration: companies and people, plus the read of money once inside.
  ('MASTER_ADMIN','manageCompanies'), ('MASTER_ADMIN','manageUsers'),
  ('MASTER_ADMIN','viewFinance'),     ('MASTER_ADMIN','viewRates'),

  -- Everything in their own company.
  ('OWNER','create'), ('OWNER','createDailyOps'), ('OWNER','update'), ('OWNER','delete'),
  ('OWNER','viewFinance'), ('OWNER','viewRates'),
  ('OWNER','manageUsers'),
  ('OWNER','manageTraders'), ('OWNER','manageFormulas'), ('OWNER','acknowledgeSales'),
  ('OWNER','createSaleEntries'), ('OWNER','closeBatch'), ('OWNER','exportReports'),
  ('OWNER','manageVaccination'), ('OWNER','completeVaccination'),

  -- Daily operations: feed, mortality, tasks, egg stock, shed dispatch logs. Not reports.
  ('FARM_SUPERVISOR','create'), ('FARM_SUPERVISOR','createDailyOps'), ('FARM_SUPERVISOR','update'),
  ('FARM_SUPERVISOR','manageFormulas'), ('FARM_SUPERVISOR','completeVaccination'),

  -- Money and traders; formulas and flock work are read-only or absent.
  ('FINANCIAL_SUPERVISOR','update'), ('FINANCIAL_SUPERVISOR','viewFinance'), ('FINANCIAL_SUPERVISOR','viewRates'),
  ('FINANCIAL_SUPERVISOR','manageTraders'), ('FINANCIAL_SUPERVISOR','acknowledgeSales'),
  ('FINANCIAL_SUPERVISOR','createSaleEntries'), ('FINANCIAL_SUPERVISOR','exportReports'),

  -- Operational only: shed dispatch logs (§5) and the rounds they were assigned.
  ('FARM_MANAGER','create'), ('FARM_MANAGER','completeVaccination'),

  -- Today's entries and assigned tasks, nothing else (§5).
  ('FARM_LABOR','create'), ('FARM_LABOR','createDailyOps'), ('FARM_LABOR','completeVaccination');

/**
 * The role-level half of a permission. The batch-level half (the jsonb grant set on
 * batch_assignments) is checked inside the RPCs in 004, exactly as the client keeps
 * useCan() and canOnBatch() as two separate questions. Flattening them here would quietly
 * widen what a granted operator can write everywhere.
 */
create or replace function app.role_can(company text, perm_key text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select case
    when app.role_in(company) = 'OWNER' then true           -- every company-scoped permission
    when app.role_in(company) is null then false            -- not in this company at all
    else exists (
      select 1 from app.role_permissions rp
      where rp.role = app.role_in(company) and rp.key = perm_key
    )
  end
$$;

/** Somebody who may change people or companies. */
create or replace function app.is_master_admin() returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from public.profiles p where p.id = app.uid() and p.role = 'MASTER_ADMIN')
$$;

/**
 * Sheds the caller may see. A Farm Manager works only the sheds an assignment places them in,
 * so an unassigned shed must not resolve for them at all — src/store/app.ts · useVisibleSheds
 * does the same filtering in the browser today.
 */
create or replace function app.may_see_shed(shed text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from public.sheds s where s.id = shed and app.member_of(s.company_id)
  ) and not (
    app.role_in((select s.company_id from public.sheds s where s.id = shed)) = 'FARM_MANAGER'
    and not exists (
      select 1
      from public.batch_assignments ba
      join public.batches b on b.id = ba.batch_id
      where ba.user_id = app.uid() and b.shed_id = shed
    )
  )
$$;

comment on function app.role_can(text, text) is
  'Database-side half of src/lib/permissions.ts; see the note above app.role_permissions.';
