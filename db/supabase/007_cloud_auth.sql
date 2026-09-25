-- 007_cloud_auth.sql — what the Supabase-backed app still needs beside 000–006.
--
-- 1. app.create_login: profiles.id IS auth.users.id, and the browser role cannot write the
--    auth schema, so creating a person needs one SECURITY DEFINER door with a permission test
--    in front of it. The bcrypt hash lands in auth.users exactly where Supabase puts it; no
--    password ever leaves the client except over the API it signs in through anyway.
--
-- 2. Three delete policies. The store edits a voucher by replacing the ledger rows it owns
--    (persist v15 rebuilds them), but 003 gave finance_txns / trader_txns / sale_entries no
--    DELETE verb at all, so an edit made here would die at the wall. What is allowed is narrow
--    by construction: a caller deletes only rows they created, and only with the same role
--    key that lets them read or book the money in the first place. UPDATE stays denied: money
--    rows are immutable; they are reversed by replacement, never rewritten.

-- ============================= 1 · LOGIN PROVISIONING =============================

-- Declared in public because that is the one schema PostgREST is guaranteed to expose;
-- every fact it touches is still read through app.* helpers.
drop function if exists app.create_login(uuid, text, text, text);
create or replace function public.create_login(p_user uuid, p_email text, p_password text, p_company text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if length(p_password) < 4 then
    raise exception 'password is too short';
  end if;
  if not (app.is_master_admin() or app.role_can(p_company, 'manageUsers')) then
    raise exception 'not allowed to create a login';
  end if;

  -- GoTrue scopes every lookup by instance_id and scans the token columns as plain strings: a
  -- NULL in either place hides the row from the password grant, which then fails as a generic
  -- "Invalid login credentials". db/provision-auth.mjs has always written them; a login created
  -- from the app must look the same.
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

  -- auth.identities.email is GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED, so it
  -- is left out of the write: GoTrue derives it from identity_data, which is where it belongs.
  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values (app.uid(), p_user, p_user::text,
          jsonb_build_object('sub', p_user::text, 'email', p_email), 'email',
          now(), now(), now())
  on conflict (provider_id, provider) do update
    set identity_data = excluded.identity_data;
end $$;

revoke all on function public.create_login(uuid, text, text, text) from public, anon;
grant execute on function public.create_login(uuid, text, text, text) to authenticated;

-- ============================= 2 · OWNED-ROW DELETES =============================

-- The voucher rebuilds its own money trail, so whoever booked it may remove exactly their own
-- rows. The using-clause reads both the role matrix and created_by of the row being deleted.
drop policy if exists company_delete on public.finance_txns;
create policy company_delete on public.finance_txns
  for delete to authenticated
  using (app.role_can(finance_txns.company_id, 'viewFinance')
         and created_by = app.uid());

drop policy if exists company_delete on public.trader_txns;
create policy company_delete on public.trader_txns
  for delete to authenticated
  using (app.role_can(trader_txns.company_id, 'createSaleEntries')
         and created_by = app.uid());

drop policy if exists company_delete on public.sale_entries;
create policy company_delete on public.sale_entries
  for delete to authenticated
  using (app.role_can(sale_entries.company_id, 'createSaleEntries')
         and created_by = app.uid());
