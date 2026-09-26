/**
 * provision-auth.mjs — gives every imported Amrut person a real Supabase Auth login.
 *
 *   node --env-file=.env db/provision-auth.mjs [--password 1234]
 *
 * Server-side ops only, like the import itself: the postgres role writes auth.users and
 * auth.identities, and the password becomes a genuine bcrypt hash through pgcrypto. No key
 * ever reaches the browser, and no custom password storage is added to the app — Supabase
 * Auth stays the only thing a login answers to.
 *
 * The legacy import created auth.users rows with a placeholder hash and no identities, so a
 * password grant could never answer. This walks profiles (the people with mobiles), gives
 * each one the email login `<mobile>@login.amrut.app` that the app derives from a mobile,
 * confirms the address, and states the email identity the grant rides on. Idempotent: a
 * second run re-states the same logins and touches nothing else.
 */
import fs from 'node:fs';
import pg from 'pg';

const argv = process.argv.slice(2);
const password = (() => {
  const i = argv.indexOf('--password');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '1234';
})();

const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const db = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: process.env.SUPABASE_DB_CA
    ? { ca: fs.readFileSync(process.env.SUPABASE_DB_CA, 'utf8') }
    : { rejectUnauthorized: false },
});
await db.connect();
await db.query('begin');

const { rows: people } = await db.query(
  "select id, name, mobile from public.profiles where mobile is not null and mobile <> '' order by id",
);

for (const p of people) {
  const email = `${p.mobile}@login.amrut.app`;
  await db.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
     select '00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated',
            $2, extensions.crypt($3, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', $4::text),
            now(), now(), '', '', '', '', ''
     on conflict (id) do update
       set encrypted_password = excluded.encrypted_password,
           email = excluded.email,
           -- GoTrue scopes every lookup by instance_id; a NULL here hides the row from the
           -- grant entirely and login dies as a generic "Invalid login credentials".
           instance_id = '00000000-0000-0000-0000-000000000000',
           email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
           -- GoTrue scans these as plain strings; a NULL here fails the row read and the
           -- login dies as a generic "Invalid login credentials". An admin-created user
           -- carries '' — the upsert states the same.
           confirmation_token = '',
           recovery_token = '',
           email_change = '',
           email_change_token_new = '',
           email_change_token_current = '',
           raw_app_meta_data = auth.users.raw_app_meta_data
             || '{"provider":"email","providers":["email"]}'::jsonb,
           updated_at = now()`,
    [p.id, email, password, p.name],
  );
  await db.query(
    `insert into auth.identities
       (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     select gen_random_uuid(), $1::uuid, $1::text,
            jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
            'email', now(), now(), now()
     on conflict (provider_id, provider) do update
       set identity_data = excluded.identity_data, updated_at = now()`,
    [p.id, email],
  );
  console.log(`login ready: ${p.name} <${email}>`);
}

await db.query('commit');
await db.end();
console.log(`\n${people.length} logins provisioned. Sign in from the app with mobile + password.`);
