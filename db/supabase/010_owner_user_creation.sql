-- 010_owner_user_creation.sql — an OWNER may create a person in their own company.
--
-- Until now "create user" was a platform-admin path end to end: create_login (007) opened the
-- GoTrue row for a company manager, but the tables behind it refused them — profiles INSERT is
-- `with check (app.is_master_admin())`, so the sync push of the new person died at the wall
-- and left a login with no profile. This file completes the door:
--
-- 1. create_login grows to p_name/p_mobile/p_role and writes the whole person in one guarded
--    transaction: auth.users + identities (as 007), profiles, and the primary company's
--    membership row. Its gate stays app.role_can(p_company,'manageUsers') or platform admin,
--    hardened so a company caller may only place a non-MASTER_ADMIN into a company they manage.
--
-- 2. profiles gets one INSERT policy a company manager can pass. One, not the others: an
--    upsert on conflict executes as UPDATE, so a bare widening would let a manager rewrite any
--    person's row by quoting their id — an append-only trigger enforces that reading (a fresh
--    row must be a fresh person), and UPDATE/DELETE stay platform-admin policies. A company
--    manager's browser never pushes people at all (push.ts · opsDenied skips that for them):
--    the function above is their write path, and the pull is how the row comes back.

-- ============================= 1 · APPEND-ONLY GUARD FOR MANAGER INSERTS =============================

create or replace function app.profiles_is_append() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- the definer path inside create_login resolves to the same role as the caller's policy
  -- (auth.jwt still carries this session's sub), so the trigger, not a role test, is what
  -- decides "is this id new?" — and only for rows a non-admin policy clause let through.
  if not app.is_master_admin() then
    perform 1 from public.profiles where id = new.id;
    if found then
      raise exception 'only a platform admin may change an existing profile';
    end if;
    if new.role = 'MASTER_ADMIN' then
      raise exception 'only a platform admin may create a platform admin';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_is_append on public.profiles;
create trigger profiles_is_append
  before insert on public.profiles
  for each row execute function app.profiles_is_append();

-- ============================= 2 · THE POLICY A MANAGER CAN PASS =============================

drop policy if exists company_write on public.profiles;
create policy company_write on public.profiles
  for insert to authenticated with check (
    app.is_master_admin()
    or (
      role <> 'MASTER_ADMIN'
      and exists (
        select 1 from public.company_users cu
        where cu.user_id = profiles.id and app.role_can(cu.company_id, 'manageUsers')
      )
    )
  );

-- ============================= 3 · create_login WRITES THE WHOLE PERSON =============================

drop function if exists public.create_login(uuid, text, text, text);
drop function if exists public.create_login(uuid, text, text, text, text, text, text);

create or replace function public.create_login(
  p_user uuid, p_email text, p_password text, p_company text,
  p_name text default null, p_mobile text default null, p_role text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_initials text;
begin
  if length(p_password) < 4 then
    raise exception 'password is too short';
  end if;
  if not (app.is_master_admin() or app.role_can(p_company, 'manageUsers')) then
    raise exception 'not allowed to create a login';
  end if;

  -- The full-person form: the 007 callers pass only the four original arguments and stop at
  -- the auth row; a name+mobile+role draft is what lets a company owner land a real person.
  if p_name is not null or p_mobile is not null or p_role is not null then
    if p_name is null or length(btrim(p_name)) = 0 then
      raise exception 'name is required';
    end if;
    if p_mobile is null or p_mobile !~ '^[0-9]{10}$' then
      raise exception 'mobile must be 10 digits';
    end if;
    if p_role is null or p_role not in
       ('MASTER_ADMIN','OWNER','FARM_SUPERVISOR','FINANCIAL_SUPERVISOR','FARM_MANAGER','FARM_LABOR') then
      raise exception 'unknown role';
    end if;
    -- 'in his company', made literal: a manager places an operational person, never a platform
    -- admin. (An unknown company never reaches here — the manageUsers gate above already fails
    -- closed when no membership row exists to answer for p_company.)
    if not app.is_master_admin() and p_role = 'MASTER_ADMIN' then
      raise exception 'only a platform admin may create a platform admin';
    end if;
    v_initials := upper(left(split_part(btrim(p_name), ' ', 1), 1)
                    || coalesce(nullif(split_part(btrim(p_name), ' ', 2), ''), ''));
  end if;

  -- GoTrue scopes every lookup by instance_id and scans the token columns as plain strings: a
  -- NULL in either place hides the row from the password grant (007).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user,
                          confirmation_token, recovery_token, email_change, email_change_token_new,
                          email_change_token_current)
  values ('00000000-0000-0000-0000-000000000000', p_user, 'authenticated', 'authenticated', p_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), false,
          '', '', '', '', '')
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email = excluded.email,
    instance_id = '00000000-0000-0000-0000-000000000000',
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    confirmation_token = '',
    recovery_token = '',
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    updated_at = now();

  -- auth.identities.email is GENERATED ALWAYS, so identity_data carries the fact (007).
  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (app.uid(), p_user, p_user::text,
          jsonb_build_object('sub', p_user::text, 'email', p_email), 'email',
          now(), now(), now())
  on conflict (provider_id, provider) do update
    set identity_data = excluded.identity_data;

  if p_name is not null then
    -- mobile is unique: a person already on the platform raises here, and the auth write
    -- above rolls back with the whole transaction — no login without a person, either way.
    insert into public.profiles (id, name, mobile, role, initials)
    values (p_user, btrim(p_name), p_mobile, p_role, upper(v_initials))
    on conflict (id) do update set
      name = excluded.name,
      mobile = excluded.mobile,
      role = excluded.role,
      initials = excluded.initials,
      updated_at = now();

    insert into public.company_users (user_id, company_id, role)
    values (p_user, p_company, p_role)
    on conflict (user_id, company_id) do update set role = excluded.role;
  end if;
end $$;

revoke all on function public.create_login(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_login(uuid, text, text, text, text, text, text) to authenticated;
