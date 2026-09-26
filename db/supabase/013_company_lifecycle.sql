-- ============================= AMRUT POULTRY · 013 COMPANY LIFECYCLE IN RLS =============================
/*
 * A company has one lifecycle fact: it stands, or it does not. Until now `active` was a column
 * the client read and the policies ignored — `app.member_of()` asked only whether a membership
 * row exists. So a deactivated company's rows stayed fully readable and writable by its members
 * for as long as their JWT was valid, and the only thing refusing them was a React condition.
 *
 * The fix belongs in the two helpers every company policy in 003 is generated from, because
 * every predicate there resolves to one of exactly three calls:
 *
 *   app.member_of(col)              — '*' policies, and the read side of most modules
 *   app.role_in(col)  via role_can  — 'key:*' and 'roles:*' policies, and 004's own checks
 *
 * Gate those two and all ~24 company tables, the child policies that resolve through a parent,
 * and every 004 RPC that checks permission by hand move with them. Nothing else is touched:
 * no policy statement, no grant, no table.
 *
 * What this does NOT gate is `app.is_master_admin()` on the platform's own tables. The platform
 * role keeps reading `companies` (through attached_to) and keeps writing them (003's
 * company_write), so §16's "do not lock the admin out of reactivating" holds by construction —
 * that is the one door a deactivated company must leave open, and it is a door onto the
 * lifecycle, not onto the farm's records. The platform role's read of a dead company's data
 * goes with everybody else's.
 */

-- ============================= THE TWO NEW PREDICATES =============================

/** Does this company stand? A company the caller cannot see is not an active one, so a null
 *  answer is a refusal — the same way a null company has always refused everything. */
create or replace function app.company_active(company text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select company is not null
    and exists (select 1 from public.companies c where c.id = company and c.active)
$$;

/**
 * Membership without the lifecycle test.
 *
 * Two SELECT policies must be written in terms of this rather than member_of, and they are the
 * only two:
 *
 *   · companies — if a member could not read their own company's row once it is switched off,
 *     the client could never learn the status and would keep offering the farm as open. The
 *     status has to be readable from inside to be refused from inside.
 *   · company_users — pullUsers() rebuilds a person's company list from these rows and
 *     PushEngine diffs that list back. Hide a membership during a deactivation and the next
 *     sync reads it as a removal and deletes it: §13's "deactivation must not silently delete
 *     historical data" fails through the back door.
 *
 * Everything else — every data table, every write, every RPC — goes through member_of.
 */
create or replace function app.attached_to(company text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select company is not null and (
    exists (
      select 1 from public.company_users cu
      where cu.company_id = company and cu.user_id = app.uid()
    )
    or
    -- A Master Admin reaches every company from the platform side, without a membership row,
    -- and keeps that reach whether or not the company stands.
    exists (select 1 from public.profiles p where p.id = app.uid() and p.role = 'MASTER_ADMIN')
  )
$$;

-- ============================= THE TWO GATES =============================

create or replace function app.member_of(company text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.attached_to(company) and app.company_active(company)
$$;

comment on function app.member_of(text) is
  'Membership AND a company that stands. src/lib/companyAccess.ts mirrors this in the browser.';

/**
 * The caller's role inside one company — null when the company does not stand, which is how
 * role_can() turns into `false` for both 'key:*' and 'roles:*' policies without either branch
 * being rewritten, and how 004's own `role_can` checks refuse an inactive farm.
 */
create or replace function app.role_in(company text) returns text
language sql stable security definer set search_path = app, public as $$
  select case
    when not app.company_active(company) then null
    else coalesce(
      (select cu.role from public.company_users cu
        where cu.company_id = company and cu.user_id = app.uid()),
      -- The platform role for a Master Admin who is not a member of the company: their own
      -- standing, which is not a fact about this company and so not switched off with it.
      (select p.role from public.profiles p
        where p.id = app.uid() and p.role = 'MASTER_ADMIN')
    )
  end
$$;

/**
 * The per-batch jsonb grant — widened by an assignment, and narrowed by nothing. 004 checks
 * this by hand instead of relying on RLS, because a SECURITY DEFINER function runs as its
 * owner and the owner is not refused by these policies. Its role half already reads role_can
 * (now gated); the assignment half is pure jsonb and would survive a deactivation on its own,
 * so the whole thing is put behind the company's standing.
 */
create or replace function app.can_on_batch(p_company text, p_batch_id text, p_key text)
returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.member_of(p_company) and (
      app.role_can(p_company, p_key)
      or exists (
        select 1 from public.batch_assignments a
        where a.batch_id = p_batch_id and a.user_id = app.uid()
          and (a.permissions ->> p_key) = 'true'
      )
  )
$$;

-- ============================= THE TWO LIFECYCLE-SAFE READ POLICIES =============================
/*
 * Re-declared from 003 with the membership-only predicate, for exactly the two reasons set out
 * above. Both stay read-only relaxations: writes to `companies` remain the platform role's
 * alone, and writes to `company_users` remain `role_can(company_id,'manageUsers')` — which a
 * deactivated company can no longer resolve, so nobody adds themselves back into a farm that
 * has been switched off.
 */
drop policy if exists company_select on public.companies;
create policy company_select on public.companies
  for select to authenticated using (app.attached_to(id));

drop policy if exists company_select on public.company_users;
create policy company_select on public.company_users
  for select to authenticated using (app.attached_to(company_id));

/*
 * A note on ordering, since 003 generates the rest: applying this file after 003 is what makes
 * the whole set read as lifecycle-gated. Re-applying 003 alone does not undo it — 003 rebuilds
 * the policies but calls these same three helpers, so the gate holds either way. The only pair
 * that has to be re-declared in this order is the two above.
 */
