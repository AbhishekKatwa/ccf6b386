/**
 * tests/dbErrors.test.mjs — the focused normalizer tests the error-handling spec asks for (§26).
 *
 * No test runner is installed and none is added: Node runs the TypeScript module directly by
 * stripping its types, so this file exercises `src/lib/dbErrors.ts` exactly as the app imports it.
 *
 *   node --test tests/
 *
 * Every case asserts the same four things: the sentence the user gets, whether trying again can
 * fix it, that no raw database text reaches the user, and that the raw text is still there for
 * a developer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DatabaseError, classifyDatabaseError, createUserFacingError, normalizeDatabaseError,
  describeDatabaseError, technicalLineOf,
} from '../src/lib/dbErrors.ts';

/** A PostgREST-shaped refusal: code, message, details, hint — the shape Supabase actually sends. */
const pg = (code, message, extra = {}) => ({ code, message, ...extra });

/** Nothing may appear in the user's line that smells like the database speaking. */
const RAW = /duplicate key|violates|unique constraint|foreign key|not-null|row-level security|check constraint|SQLSTATE|\b235\d\d\b|\b42501\b|_fkey|_key\b|_check\b|public\.|Postgres|Supabase:|PGRST/i;

/** A unique-violation refusal over a named constraint, in the shape Supabase sends. */
const sqlstate = (code, constraint) => pg(code,
  `duplicate key value violates unique constraint "${constraint}"`,
  { details: 'Key (receipt_no)=(CR-2026-09-26-001) already exists.', hint: 'Use another value.' });

function assertNoRawLine(n, label) {
  assert.doesNotMatch(n.userMessage, RAW, `${label}: userMessage leaks database language`);
  assert.doesNotMatch(n.actionMessage, RAW, `${label}: actionMessage leaks database language`);
}

test('unique_violation on a known constraint becomes its business meaning', () => {
  const n = normalizeDatabaseError(
    pg('23505', 'duplicate key value violates unique constraint "traders_company_id_name_key"'),
    { table: 'traders', origin: 'background' },
  );
  assert.equal(n.kind, 'unique_violation');
  assert.equal(n.constraint, 'traders_company_id_name_key');
  assert.equal(n.userMessage, 'This trader already exists.');
  assert.match(n.actionMessage, /different name|update the existing/);
  assert.equal(n.retryable, false);
  assert.equal(n.requiresUserAction, true);
  assertNoRawLine(n, 'trader duplicate');
  // §15: the database's own sentence is still there for the log.
  assert.match(n.technicalMessage, /duplicate key value/);
});

test('duplicate receipt number says so, and never tells the user to retry blindly', () => {
  const n = normalizeDatabaseError(sqlstate('23505', 'uq_sale_receipt_company_day'), { table: 'sale_entries' });
  assert.equal(n.userMessage, 'Receipt number already used.');
  assert.match(n.actionMessage, /different receipt number/);
  assert.equal(n.retryable, false);
  assert.doesNotMatch(`${n.userMessage} ${n.actionMessage}`, /try again/i);
  assertNoRawLine(n, 'duplicate receipt');
});

test('mobile and purchase-reference clashes carry their own words', () => {
  const mobile = normalizeDatabaseError(sqlstate('23505', 'profiles_mobile_key'), { table: 'profiles' });
  assert.equal(mobile.userMessage, 'This mobile number is already registered.');
  assert.equal(mobile.requiresUserAction, true);

  const ref = normalizeDatabaseError(sqlstate('23505', 'feed_stock_purchase_ref_uq'), { table: 'feed_stock' });
  assert.equal(ref.userMessage, 'This purchase reference has already been used.');
  assertNoRawLine(mobile, 'mobile duplicate');
  assertNoRawLine(ref, 'purchase ref');
});

test('a unique constraint nobody mapped gets a safe line, not an invented meaning', () => {
  const n = normalizeDatabaseError(sqlstate('23505', 'some_future_index_key'), { table: 'tasks' });
  assert.equal(n.kind, 'unique_violation');
  assert.equal(n.retryable, false);
  assert.match(n.userMessage, /could not save|already exist/i);
  assertNoRawLine(n, 'unmapped unique');
  assert.match(n.technicalMessage, /duplicate key/);
});

test('foreign_key_violation names the thing that is missing, not the SQL', () => {
  const n = normalizeDatabaseError(pg('23503',
    'insert or update on table "sale_entries" violates foreign key constraint "sale_entries_trader_id_fkey"'),
  { origin: 'foreground' });
  assert.equal(n.kind, 'foreign_key_violation');
  assert.equal(n.table, 'sale_entries', 'the table is read off the sentence itself');
  assert.equal(n.constraint, 'sale_entries_trader_id_fkey');
  assert.equal(n.userMessage, 'Trader not available.');
  assert.match(n.actionMessage, /selected trader may have been removed/);
  assertNoRawLine(n, 'fk');
});

test('a batch/shed pointer and a person pointer read differently', () => {
  const egg = normalizeDatabaseError(pg('23503',
    'insert or update on table "egg_collections" violates foreign key constraint "egg_collections_batch_id_fkey"'));
  assert.equal(egg.userMessage, 'Batch not available.');
  assert.match(egg.actionMessage, /refresh/i);

  const person = normalizeDatabaseError(pg('23503',
    'insert or update on table "batch_assignments" violates foreign key constraint "batch_assignments_user_id_fkey"'));
  assert.equal(person.userMessage, 'That person is not available.');
  assertNoRawLine(egg, 'batch fk');
  assertNoRawLine(person, 'person fk');
});

test('company isolation never speaks of another company', () => {
  const n = normalizeDatabaseError(pg('23503',
    'insert or update on table "traders" violates foreign key constraint "traders_company_id_fkey"'),
  { table: 'traders' });
  assert.equal(n.userMessage, 'This record is not available in your active company.');
  assert.doesNotMatch(`${n.userMessage} ${n.actionMessage}`, /company b|c_sunrise|belongs to/i);
  assertNoRawLine(n, 'company isolation');
});

test('not_null_violation reads as a required field when the column has a name', () => {
  const known = normalizeDatabaseError(pg('23502', 'null value in column "mobile" violates not-null constraint'));
  assert.equal(known.kind, 'not_null_violation');
  assert.equal(known.column, 'mobile');
  assert.equal(known.userMessage, 'Mobile number is required.');
  assert.equal(known.requiresUserAction, true);
  assertNoRawLine(known, 'not null known column');

  const unknown = normalizeDatabaseError(pg('23502', 'null value in column "obscure_code" violates not-null constraint'));
  assert.equal(unknown.userMessage, 'Required information is missing.');
  assertNoRawLine(unknown, 'not null unknown column');
});

test('check_violation speaks business only where the schema states the meaning', () => {
  const mapped = normalizeDatabaseError(pg('23514',
    'new row violates check constraint "feed_consumption_tonnes_check" for relation "feed_consumption"'));
  assert.equal(mapped.kind, 'check_violation');
  assert.equal(mapped.userMessage, 'Quantity must be greater than zero.');
  assertNoRawLine(mapped, 'check mapped');

  const negative = normalizeDatabaseError(pg('23514',
    'new row violates check constraint "mortality_count_check" for relation "mortality"'));
  assert.equal(negative.userMessage, 'The count cannot be negative.');

  const unknown = normalizeDatabaseError(pg('23514',
    'new row violates check constraint "mystery_check" for relation "sheds"'));
  assert.equal(unknown.userMessage, 'Could not save this record.');
  assertNoRawLine(unknown, 'check unmapped');
});

test('an RLS refusal becomes Access denied, and nothing else', () => {
  const n = normalizeDatabaseError(pg('42501',
    'new row violates row-level security policy for table "finance_txns"'), { table: 'finance_txns' });
  assert.equal(n.kind, 'permission_denied');
  assert.equal(n.userMessage, 'Access denied.');
  assert.equal(n.actionMessage, "You don't have permission to perform this action.");
  assert.equal(n.retryable, false);
  assertNoRawLine(n, 'rls');

  // The same policy refusal can arrive with no code at all.
  const bare = normalizeDatabaseError(new Error('new row violates row-level security policy for table "traders"'));
  assert.equal(bare.kind, 'permission_denied');
  assert.equal(bare.userMessage, 'Access denied.');
});

test('a network failure never claims the change was lost or saved twice', () => {
  const fetchFailed = normalizeDatabaseError(
    Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }), { origin: 'background' });
  assert.equal(fetchFailed.kind, 'network');
  assert.equal(fetchFailed.userMessage, 'Connection problem.');
  assert.match(fetchFailed.actionMessage, /could not be synced/);
  assert.doesNotMatch(`${fetchFailed.userMessage} ${fetchFailed.actionMessage}`, /saved locally|stored offline/i);
  assert.equal(fetchFailed.retryable, true);
  assertNoRawLine(fetchFailed, 'network');

  const offline = normalizeDatabaseError(pg('', 'fetch failed'));
  assert.equal(offline.kind, 'network');
});

test('a timeout asks for a retry; a cancellation says so honestly', () => {
  const slow = normalizeDatabaseError(pg('', 'The server took too long to respond, request timed out'));
  assert.equal(slow.kind, 'timeout');
  assert.equal(slow.userMessage, 'The server is taking too long to respond.');
  assert.equal(slow.retryable, true);

  const gate = normalizeDatabaseError(pg('55006', 'canceling statement due to lock timeout'));
  assert.equal(gate.kind, 'timeout');

  const gone = normalizeDatabaseError(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
  assert.equal(gone.kind, 'aborted');
  assert.equal(gone.userMessage, 'The request was cancelled.');
  assertNoRawLine(slow, 'timeout');
  assertNoRawLine(gone, 'abort');
});

test('an unknown error gets the safe fallback, and keeps its detail for the log', () => {
  const n = normalizeDatabaseError(pg('PGRST999', 'something the client has never seen'));
  assert.equal(n.kind, 'unknown');
  assert.equal(n.userMessage, 'Something went wrong.');
  assert.equal(n.actionMessage, "We couldn't complete this action. Please try again.");
  assert.equal(n.retryable, true);
  assert.equal(n.code, 'PGRST999', 'the code is kept, just not shown');
  assertNoRawLine(n, 'unknown');
});

test('operation context replaces the generic line with the action that failed', () => {
  const n = normalizeDatabaseError(pg('PGRST999', 'unexpected'), { operation: 'save the egg sale' });
  assert.equal(n.userMessage, 'Could not save the egg sale.');
  assertNoRawLine(n, 'operation context');
});

test('malformed and absent errors are answered, not thrown', () => {
  for (const bad of [null, undefined, 'a plain string', 42, {}, { message: null }, { code: 23505, message: 7 },
    [], { code: null, message: undefined, details: null }]) {
    const n = normalizeDatabaseError(bad, { table: 'traders' });
    assert.ok(n.userMessage.length > 0, `no sentence for ${JSON.stringify(bad)}`);
    assert.equal(typeof n.retryable, 'boolean');
    assert.doesNotMatch(`${n.userMessage} ${n.actionMessage}`, /undefined|null|\[object/i);
    assertNoRawLine(n, `malformed ${JSON.stringify(bad) ?? 'nullish'}`);
  }
  // A numeric SQLSTATE is still a code; a number is still an error worth a line.
  assert.equal(normalizeDatabaseError({ code: 23505, message: 'duplicate key value violates unique constraint "x_key"' }).kind, 'unique_violation');
});

test('a company_users clash and a batch code clash each read as their own problem', () => {
  const membership = normalizeDatabaseError(sqlstate('23505', 'company_users_pkey'), { table: 'company_users' });
  assert.equal(membership.userMessage, 'This person is already part of that company.');

  const code = normalizeDatabaseError(sqlstate('23505', 'batches_company_id_code_key'), { table: 'batches' });
  assert.equal(code.userMessage, 'That batch code is already used in this company.');
  assertNoRawLine(membership, 'membership duplicate');
  assertNoRawLine(code, 'batch code duplicate');
});

test('the sync pipeline: one refusal, read once, still says why on the queue line', () => {
  const raw = pg('42501', 'new row violates row-level security policy for table "traders"');
  const thrown = new DatabaseError(normalizeDatabaseError(raw, { table: 'traders', origin: 'background' }), raw);

  // Walking up the stack must not re-word it or lose the code.
  const again = normalizeDatabaseError(thrown, { origin: 'background' });
  assert.deepEqual(again, thrown.normalized);
  assert.equal(again.userMessage, 'Access denied.');

  // The badge's own line keeps the database's sentence, which is what the toast must not show.
  assert.match(technicalLineOf(again, '(2 rows)'), /row-level security/);
  assert.equal(thrown.message, again.technicalMessage);
});

test('background sync failures arrive as sentences, never as a raw wall', () => {
  const raws = [
    pg('42501', 'new row violates row-level security policy for table "traders"'),
    pg('42501', 'new row violates row-level security policy for table "finance_txns"'),
    pg('23505', 'duplicate key value violates unique constraint "cash_counts_company_id_date_key"'),
  ];
  const lines = raws.map((e, i) => normalizeDatabaseError(e, {
    table: ['traders', 'finance_txns', 'cash_counts'][i], origin: 'background',
  }));
  for (const n of lines) assertNoRawLine(n, 'background sync');
  assert.deepEqual([...new Set(lines.map(n => n.userMessage))].sort(),
    ['A cash count for that date is already recorded.', 'Access denied.']);
  assert.ok(lines.every(n => n.technicalMessage.includes('violates') || n.technicalMessage.includes('duplicate')));
});

test('classify and createUserFacingError are usable on their own, as the pipeline describes', () => {
  const classified = classifyDatabaseError(pg('23505',
    'duplicate key value violates unique constraint "ingredients_pkey"'), { table: 'ingredients' });
  const face = createUserFacingError(classified, { origin: 'background' });
  assert.equal(face.userMessage, 'This ingredient is already in the catalogue.');
  assert.equal(face.retryable, false);
  assert.equal(describeDatabaseError(pg('23505',
    'duplicate key value violates unique constraint "ingredients_pkey"'), { table: 'ingredients' }),
  'This ingredient is already in the catalogue. Choose it from the list instead of adding it again.');
});

test('an expired JWT is a sign-in problem, not a mystery', () => {
  const n = normalizeDatabaseError(pg('PGRST301', 'JWT expired'), { operation: 'sign in' });
  assert.equal(n.kind, 'session_expired');
  assert.equal(n.userMessage, 'Your session has expired.');
  assert.match(n.actionMessage, /sign in again/);
  assert.equal(n.retryable, false);
  assert.equal(n.requiresUserAction, true);
  assertNoRawLine(n, 'session expired');
});

test('a guarded function that refuses says what failed, never its SQL', () => {
  // The shape `create_login` / `set_person_access` answer with when the schema blocks the call.
  const missing = normalizeDatabaseError(
    pg('PGRST202', 'Could not find the function app.create_login(p_user uuid) in the schema cache'),
    { operation: 'create user', table: 'profiles', origin: 'foreground' },
  );
  assert.equal(missing.kind, 'unknown');
  assert.equal(missing.userMessage, 'Could not create user.');
  assert.match(missing.technicalMessage, /schema cache/);
  assertNoRawLine(missing, 'rpc schema cache');

  // A refusal inside the function keeps its own meaning; the operation never overrides a known kind.
  const denied = normalizeDatabaseError(pg('42501',
    'new row violates row-level security policy for table "company_users"'),
  { operation: 'change this person’s access', table: 'company_users' });
  assert.equal(denied.userMessage, 'Access denied.');

  // Neither does a wire failure: retrying a call that never landed is the honest advice.
  assert.match(describeDatabaseError(Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' }),
    { operation: 'create user' }), /Connection problem/);
});

test('the receipt counter’s own clash is a receipt number problem', () => {
  const n = normalizeDatabaseError(sqlstate('23505', 'receipt_counters_pkey'), { table: 'receipt_counters' });
  assert.equal(n.userMessage, 'That receipt number is already used.');
  assert.match(n.actionMessage, /different receipt number/);
  assert.equal(n.retryable, false, 'a second claim of the same number cannot fix this');
  assertNoRawLine(n, 'receipt counter');
});
