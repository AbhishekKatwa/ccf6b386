/**
 * Supabase migration runner for AMRUT Poultry Farm.
 *
 *   node db/migrate.mjs --check          connect, report server + current schema, apply nothing
 *   node db/migrate.mjs                  apply every db/supabase/*.sql not yet recorded
 *   node db/migrate.mjs 003              apply only the files matching that prefix
 *   node db/migrate.mjs --force 003      re-run a file even if already recorded (each is idempotent)
 *
 * Uses POSTGRES_URL_NON_POOLING on purpose: the 6543 pooler is transaction-mode, so
 * `SET`/temp state does not survive between statements and DDL must not rely on it.
 * Each file runs in one transaction, so a half-applied file is never left behind.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'supabase');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const force = args.includes('--force');
const filters = args.filter(a => !a.startsWith('--'));

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error('POSTGRES_URL_NON_POOLING is not set. Run with: node --env-file=.env db/migrate.mjs');
  process.exit(1);
}

/**
 * Supabase's pooler presents a chain this machine does not root-trust, and `?sslmode=require`
 * in the URL would quietly win over an `ssl` option — so the URL is parsed apart and TLS is
 * configured here. Set SUPABASE_DB_CA to a CA bundle to keep certificate verification on;
 * without it the connection is still encrypted but unverified, which is acceptable for a
 * laptop-run migration and is not acceptable in CI.
 */
const u = new URL(url.replace(/^postgres:/, 'postgresql:'));
const caFile = process.env.SUPABASE_DB_CA;
if (caFile) console.log('TLS verified against', caFile);
else console.warn('warning: TLS certificate not verified (set SUPABASE_DB_CA to a CA bundle to enable verification)');

const client = new Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: caFile ? { ca: readFileSync(caFile, 'utf8') } : { rejectUnauthorized: false },
});
await client.connect();
console.log('connected to', (await client.query('select current_database() as db')).rows[0].db);

if (checkOnly) {
  const info = await client.query(`
    select version() as server,
      (select count(*) from information_schema.tables where table_schema = 'public' and table_name not like 'sp_%') as tables,
      (select count(*) from information_schema.views where table_schema = 'public') as views,
      (select count(*) from pg_policies where schemaname = 'public') as policies
  `);
  console.log(info.rows[0]);
  const tables = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `);
  console.log(tables.rows.map(r => r.table_name).join('\n'));
  await client.end();
  process.exit(0);
}

// Books kept in `public` so Supabase's REST and Realtime endpoints serve them without
// extra configuration; `app` holds only the migration ledger, which nothing may read.
await client.query(`
  create schema if not exists app;
  create table if not exists app.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
`);

const applied = new Set(
  (await client.query('select name from app.schema_migrations')).rows.map(r => r.name),
);

const files = readdirSync(SQL_DIR)
  .filter(f => f.endsWith('.sql'))
  .filter(f => filters.length === 0 || filters.some(p => f.startsWith(p)))
  .sort();

for (const file of files) {
  if (applied.has(file) && !force) {
    console.log('skip  ', file);
    continue;
  }
  const sql = readFileSync(join(SQL_DIR, file), 'utf8');
  process.stdout.write(`apply ${file} `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query(
      'insert into app.schema_migrations (name) values ($1) on conflict (name) do nothing',
      [file],
    );
    await client.query('commit');
    console.log('ok');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.log('FAILED');
    console.error(err.message);
    if (err.position) console.error('near:', sql.slice(Math.max(0, err.position - 120), err.position + 60));
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log('done');
