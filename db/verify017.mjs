/**
 * Proves 017 without leaving a trace: the migration runs inside a transaction, the four backup
 * verbs are inserted against the real table, and the whole run is rolled back so the live schema
 * never changes.
 *
 * The inserts run as the migration role, which owns the tables. That is deliberate: 017 changes a
 * CHECK and nothing else, so RLS is not what is under test here — and RLS on this table is already
 * answered by the 100-odd CREATE/UPDATE/DELETE rows the app itself has written. The forged-JWT
 * path in verify015 is the one to use for a policy change, not for a verb list.
 *
 *   node --env-file=.env db/verify017.mjs
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const MIGRATION = new URL('./supabase/017_backup_audit_actions.sql', import.meta.url);
const sql = await readFile(MIGRATION, 'utf8');

const u = new URL(process.env.POSTGRES_URL_NON_POOLING.replace(/^postgres:/, 'postgresql:'));
const c = new pg.Client({
  host: u.hostname, port: Number(u.port), user: u.username, password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: { rejectUnauthorized: false },
});
await c.connect();

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
};

await c.query('begin');
await c.query(sql);
console.log('  · 017 applied inside the transaction');

const seed = await c.query(`select company_id, by_user_id from public.audit
  where company_id is not null and by_user_id is not null order by "at" desc limit 1`);
const { company_id: COMPANY, by_user_id: USER } = seed.rows[0];
console.log(`  · probing as ${USER} of ${COMPANY}`);

/** Each insert runs to a savepoint and is rolled back: a probe must not become farm history. */
async function insert(action, entity) {
  await c.query('savepoint probe');
  try {
    const r = await c.query(
      `insert into public.audit (id, company_id, entity, entity_id, action, new_value, by_user_id)
       values (gen_random_uuid()::text, $1, $2, $3, $4, to_jsonb('017 probe'::text), $5) returning action`,
      [COMPANY, entity, 'probe-1', action, USER],
    );
    await c.query('rollback to savepoint probe');
    return { row: r.rows[0] };
  } catch (e) {
    await c.query('rollback to savepoint probe');
    return { error: `${e.code || ''} ${e.message}`.trim() };
  }
}

for (const a of ['BACKUP_CREATED', 'RESTORE_STARTED', 'RESTORE_COMPLETED', 'RESTORE_FAILED']) {
  const r = await insert(a, 'Backup');
  ok(`${a} is accepted`, !r.error, r.error || '');
}
for (const a of ['CREATE', 'UPDATE', 'DELETE']) {
  const r = await insert(a, 'Shed');
  ok(`${a} still works`, !r.error, r.error || '');
}
const bogus = await insert('DROP TABLE', 'Backup');
ok('an invented verb is still refused', !!bogus.error, JSON.stringify(bogus));

await c.query('rollback');
console.log(fails ? `\n${fails} FAILED — database unchanged` : '\nall assertions passed, database unchanged');
await c.end();
process.exit(fails ? 1 : 0);
