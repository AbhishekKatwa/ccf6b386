-- 012_identity_id.sql — a second "create user" by the same admin no longer collides.
--
-- create_login (007, widened by 010) stamped the new person's auth.identities row with
-- `id = app.uid()` — the CALLER's uuid, not a fresh one. auth.identities has PRIMARY KEY (id),
-- so the first login a given admin opened went through and every later one died as
-- `duplicate key value violates unique constraint "identities_pkey"`, rolling the whole
-- transaction back: no auth user, no profile, no membership. 'bafd' is the one row that path
-- ever wrote, and it carries the platform admin's uuid as its own identity id — which is what
-- the next attempt then collided with. provision-auth.mjs already used gen_random_uuid(), so
-- the seeded logins never met this.
--
-- 1. repair: an email identity whose id is some OTHER person's auth.users id can only be a
--    create_login stamp, so re-key it. A genuine uuid collision with a random value is not a
--    thing that happens; this predicate does not touch the seeded rows.
-- 2. create_login takes the same fresh uuid the provisioner takes.
--
-- 007's source line is corrected as well so a from-scratch apply never reopens the door; the
-- function this database runs is the one below.

-- ============================= 1 · RE-KEY THE STAMPED IDENTITIES =============================

update auth.identities i
set id = gen_random_uuid(), updated_at = now()
where i.provider = 'email'
  and i.id <> i.user_id
  and exists (select 1 from auth.users u where u.id = i.id and u.id <> i.user_id);

-- ============================= 2 · create_login STAMPS A FRESH IDENTITY ID =============================

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

  -- auth.identities.email is GENERATED ALWAYS, so identity_data carries the fact (007). The id
  -- is this identity's own key, so it is generated: the caller's uuid would make one admin's
  -- second create collide with their first (012).
  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_user, p_user::text,
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
