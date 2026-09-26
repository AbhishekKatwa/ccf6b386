-- ============================= AMRUT POULTRY · 015 OWNER USER MANAGEMENT =============================
/*
 * The Users screen (src/screens/UsersScreen.tsx) lets an OWNER change the role of a person in
 * their own company, and switch an account off. Two things were missing for that to be real:
 *
 * 1. No door. `profiles` UPDATE/DELETE (003) answer to the platform role alone, and a company
 *    session never pushes people at all (push.ts · opsDenied is false for it, so pushUsers is
 *    skipped). So an owner's edit lived in localStorage, was invisible to RLS, and evaporated
 *    on the next pull. `create_login` (010) opened creation but not change.
 *
 *    → `public.set_person_access` is the write, one per person, gated the same way the client
 *      gates the button. It is the owner's `create_login` for an existing person.
 *
 * 2. No consequence. `profiles.active` was a column the app read and the database ignored: a
 *    switched-off account kept a valid JWT and RLS carried on answering it. Deactivating a
 *    person has to end their access, not merely hide a menu.
 *
 *    → `app.uid()` now returns NULL for a profile that is switched off, which is the single
 *      narrowest place to say it. Every policy in 003 and 013 is built on app.uid() through
 *      member_of / role_in / can_on_batch, so one clause makes the account have no identity in
 *      the database at all — on every table, including the views, with no policy list to
 *      remember to extend. It is deliberately NOT done inside member_of/role_in: 013 rewrites
 *      those helpers, and a deactivated account must fail as "not signed in to anything" rather
 *      than as a member who lost a company (their membership rows stay, exactly as §5's
 *      "preserve historical records" requires — the audit trail names them afterwards).
 *
 * Deliberately absent:
 *   · No audit write here. Every other action in this app is audited by the store, whose row
 *     the sync then pushes (src/store/app.ts · audit()); a second writer would record each
 *     change twice. `create_login` set that precedent for the same reason.
 *   · No company_users INSERT/DELETE path: adding a person to a second company, and removing a
 *     membership, stay the platform's (003) — §2's "never alter platform-level administration".
 *   · Nothing about passwords. A role or status change is not a credential change; the auth row
 *     is not touched.
 */

-- ============================= 1 · A SWITCHED-OFF ACCOUNT HAS NO IDENTITY =============================

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
    sub := sub::uuid::text;
  exception when others then
    return null;
  end;
  -- Only a profile that says `false` is switched off. A login with no profile row at all keeps
  -- the answer it had before this file: provisioning a login and its person are two steps in
  -- db/provision-auth.mjs, and refusing identity in between would break that import rather
  -- than tighten anything.
  if exists (select 1 from public.profiles p where p.id = sub::uuid and p.active = false) then
    return null;
  end if;
  return sub::uuid;
end $$;

-- ============================= 2 · THE OWNER'S WRITE PATH =============================

/**
 * Change one person's role, or switch their account off and back on, for one company.
 *
 * SECURITY DEFINER because the tables it must touch are platform-admin policies by design; the
 * gates below are therefore the whole of its permission surface, and they close outwards from
 * the acting company:
 *   · the caller manages users in p_company (the same app.role_can the button asks),
 *   · for a company caller, the target belongs to p_company — tenancy before anything else, so
 *     naming another company's uuid in the call wins nothing,
 *   · nobody changes their own access: an OWNER cannot unlock themselves into another role, and
 *     a switch-off must not be a self-service way of dropping a session mid-task,
 *   · a company caller works on operational people only — never a platform account, never into
 *     OWNER (creating an owner is 010's/platform's, and §2 lists the four roles it supports),
 *   · and never on a person shared with a company the caller does not manage, because
 *     `profiles.role` is global while their authority is not.
 * A platform admin skips the rest of that list: cross-company administration is their job.
 */
create or replace function public.set_person_access(
  p_user uuid,
  p_company text,
  p_role text default null,
  p_active boolean default null
) returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_admin  boolean;
  v_target public.profiles;
begin
  if app.uid() is null then
    raise exception 'You are not signed in';
  end if;
  if p_role is null and p_active is null then
    return;                                    -- nothing asked for; nothing to refuse either
  end if;
  if not (app.is_master_admin() or app.role_can(p_company, 'manageUsers')) then
    raise exception 'You cannot manage users in this company';
  end if;
  if p_user = app.uid() then
    raise exception 'You cannot change your own access';
  end if;

  select * into v_target from public.profiles where id = p_user;
  if v_target.id is null then
    raise exception 'User not found';
  end if;

  v_admin := app.is_master_admin();
  if not v_admin then
    -- Tenancy before anything else: naming another company's person in the call must win
    -- nothing. A platform admin is bounded by no company, and a MASTER_ADMIN profile has no
    -- membership rows to bound it with (001), so this is the company caller's gate alone.
    if not exists (
      select 1 from public.company_users cu
      where cu.user_id = p_user and cu.company_id = p_company
    ) then
      raise exception 'This user does not belong to the company you are working in';
    end if;
    if v_target.role = 'MASTER_ADMIN' then
      raise exception 'Only the platform admin can change a platform account';
    end if;
    if p_role is not null and p_role not in
       ('FARM_SUPERVISOR','FINANCIAL_SUPERVISOR','FARM_MANAGER','FARM_LABOR') then
      raise exception 'Choose an operational role for this person';
    end if;
    if exists (
      select 1 from public.company_users cu
      where cu.user_id = p_user
        and not app.role_can(cu.company_id, 'manageUsers')
    ) then
      raise exception 'They belong to a company you do not manage, so only the platform admin can change them';
    end if;
  end if;

  if p_role is not null and p_role <> v_target.role then
    update public.profiles set role = p_role, updated_at = now() where id = p_user;
  end if;
  -- The membership role is the per-company half of the same fact (001): app.role_can answers
  -- from it, so leaving it behind would keep the old authority after the change.
  if p_role is not null then
    update public.company_users set role = p_role
    where user_id = p_user and company_id = p_company and role <> p_role;
  end if;
  if p_active is not null and p_active is distinct from v_target.active then
    update public.profiles set active = p_active, updated_at = now() where id = p_user;
  end if;
end $$;

revoke all on function public.set_person_access(uuid, text, text, boolean) from public, anon;
grant execute on function public.set_person_access(uuid, text, text, boolean) to authenticated;

comment on function public.set_person_access(uuid, text, text, boolean) is
  'An OWNER''s write to a person of their own company: role and account status. src/services/dataService.ts · users.updateRole/setActive.';
