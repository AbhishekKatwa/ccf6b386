/**
 * Applies one of db/supabase/*.sql files to the project, in a single transaction.
 *
 *   node --env-file=.env db/apply.mjs db/supabase/006_egg_wastages.sql
 *
 * The import script's own route: the migration role over postgres, service-role never needed,
 * and nothing is printed but the file name and the row count the server reports.
 */
import fs from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node --env-file=.env db/apply.mjs <file.sql> [...]');
  process.exit(2);
}

const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const c = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1) || 'postgres',
  ssl: process.env.SUPABASE_DB_CA
    ? { ca: fs.readFileSync(process.env.SUPABASE_DB_CA, 'utf8') }
    : { rejectUnauthorized: false },
});
await c.connect();

for (const f of process.argv.slice(2)) {
  await c.query('begin');
  try {
    await c.query(fs.readFileSync(f, 'utf8'));
    await c.query('commit');
    console.log(`applied ${f}`);
  } catch (e) {
    await c.query('rollback');
    console.error(`FAILED ${f}: ${e.message}`);
    process.exitCode = 1;
    break;
  }
}
await c.end();
