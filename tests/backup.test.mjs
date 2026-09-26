/**
 * tests/backup.test.mjs — the safety story of the backup file, proved without a browser.
 *
 * `node --test tests/`
 *
 * What is asserted here is what the restore screen promises: a file holds one company's records
 * and nothing else, a restore refuses every file it cannot fully believe, and the plan it does
 * produce names the rows it writes rather than the slices it replaces. The module under test is
 * pure and takes its registry, columns and permission answer as data, which is why none of this
 * needs the app's runtime graph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, NOT_COMPANY_DATA, MAX_SUPPORTED_SCHEMA,
  CSV_GROUPS, SLICE_LABELS, backupFileName, buildBackup, csvFileName, parseBackup,
  recordsCsv, validateBackup,
} from '../src/lib/backup.ts';

/* ============================= THE PROFILE A CALLER WOULD HAND IN ============================= */

/** The subset of the sync registry a two-company farm needs to be tested. */
const PROFILE = {
  slices: [
    { slice: 'companies', table: 'companies', companyOf: (o) => o.id },
    { slice: 'sheds', table: 'sheds' },
    { slice: 'batches', table: 'batches' },
    { slice: 'traders', table: 'traders' },
    { slice: 'finance', table: 'finance_txns' },
    { slice: 'feedStock', table: 'feed_stock' },
    { slice: 'traderTxns', table: 'trader_txns' },
    { slice: 'saleEntries', table: 'sale_entries' },
    // a slice only a money role may read
    { slice: 'audit', table: 'audit_entries', readKey: 'manageUsers' },
  ],
  columns: {
    sheds: { id: 'text', company_id: 'text', name: 'character varying', capacity: 'integer' },
    batches: { id: 'text', company_id: 'text', shed_id: 'text', bird_count: 'integer', placed_on: 'date' },
    traders: { id: 'text', company_id: 'text', name: 'text', outstanding_amount: 'numeric' },
    finance_txns: { id: 'text', company_id: 'text', amount: 'numeric', date: 'timestamp with time zone', batch_id: 'text' },
    feed_stock: { id: 'text', company_id: 'text', purchase_ref: 'text', qty_kg: 'numeric' },
    trader_txns: { id: 'text', company_id: 'text', reference: 'text', trader_id: 'text', amount: 'numeric' },
    sale_entries: { id: 'text', company_id: 'text', cash_reference: 'text', trader_id: 'text', amount: 'numeric' },
    audit_entries: { id: 'text', company_id: 'text', entity: 'text' },
  },
  primaryKeys: {
    sheds: ['id'], batches: ['id'], traders: ['id'], finance_txns: ['id'],
    feed_stock: ['id'], trader_txns: ['id'], sale_entries: ['id'], audit_entries: ['id'],
  },
  idOf: (o) => String(o.id),
};

const OWNER = 'OWNER';
const LABOUR = 'FARM_LABOR';
/** The role matrix's answer, as the store hands it: `audit` needs manageUsers. */
const canReadFor = (role) => (def) => !def.readKey || def.readKey !== 'manageUsers' || role === OWNER;

const COMPANY = 'c_one';
const OTHER = 'c_two';

/** A live cache with two companies in it: the store legitimately holds both. */
function liveState() {
  return {
    companies: [
      { id: COMPANY, name: 'Farm One', active: true },
      { id: OTHER, name: 'Farm Two', active: true },
    ],
    sheds: [
      { id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 },
      { id: 'sh_2', companyId: COMPANY, name: 'Shed B', capacity: 800 },
      { id: 'sh_other', companyId: OTHER, name: 'Other farm shed', capacity: 100 },
    ],
    batches: [{ id: 'b_1', companyId: COMPANY, shedId: 'sh_1', birdCount: 400, placedOn: '2026-01-05' }],
    traders: [{ id: 'tr_1', companyId: COMPANY, name: 'Trader One', outstandingAmount: 250 }],
    finance: [{ id: 'fn_1', companyId: COMPANY, amount: 1000, date: '2026-02-01T00:00:00.000Z', batchId: 'b_1' }],
    feedStock: [{ id: 'fs_1', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 1000 }],
    traderTxns: [{ id: 'tt_1', companyId: COMPANY, reference: 'UTR-9', traderId: 'tr_1', amount: 250 }],
    saleEntries: [{ id: 'se_1', companyId: COMPANY, cashReference: 'CR-1', traderId: 'tr_1', amount: 500 }],
    audit: [{ id: 'au_1', companyId: COMPANY, entity: 'Shed' }],
  };
}

function exportAs(role = OWNER, over = {}) {
  return buildBackup({
    companyId: COMPANY,
    companyName: 'Farm One',
    userId: 'u_1',
    userName: 'Owner',
    role,
    appVersion: '1.2.3',
    storeVersion: 21,
    nowIso: '2026-03-04T10:00:00.000Z',
    state: liveState(),
    profile: PROFILE,
    canRead: canReadFor(role),
    ...over,
  });
}

/** The whole context `checkBackupFile` would pass on a restore day. */
function ctxFor(json, over = {}) {
  return validateBackup(json, {
    companyId: COMPANY,
    state: liveState(),
    canRead: canReadFor(over.role ?? OWNER),
    storeVersion: 21,
    profile: PROFILE,
    ...over,
  });
}

const hasIssue = (v, code, level) =>
  v.issues.some(i => i.code === code && (level === undefined || i.level === level));

/* ============================= EXPORT ============================= */

test('a backup carries exactly one company, with the metadata a restore reads', () => {
  const { file } = exportAs();
  assert.equal(file.format, BACKUP_FORMAT);
  assert.equal(file.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.equal(file.appVersion, '1.2.3');
  assert.equal(file.storeVersion, 21);
  assert.equal(file.company.id, COMPANY);
  assert.equal(file.exportedAt, '2026-03-04T10:00:00.000Z');
  assert.deepEqual(file.exportedBy, { id: 'u_1', name: 'Owner', role: OWNER });

  // every row of every slice belongs to this company, and the counts are the truth
  for (const [slice, rows] of Object.entries(file.records)) {
    assert.equal(file.recordCounts[slice], rows.length, `${slice} count`);
    for (const row of rows) {
      assert.equal(String(row.id === COMPANY ? row.id : row.companyId), COMPANY, `${slice} row ${row.id} left the company`);
    }
  }
  // the other company's shed is not in the file at all
  assert.deepEqual(file.records.sheds.map(s => s.id), ['sh_1', 'sh_2']);
  assert.ok(!JSON.stringify(file).includes(OTHER), 'another company appeared in the file');
});

test('a role cannot export money or people data it may not read', () => {
  const { file, omitted } = exportAs(LABOUR);
  assert.equal(file.records.audit, undefined, 'an unreadable slice was exported');
  assert.deepEqual(omitted, [{ slice: 'audit', reason: 'this role may not read it' }]);
  // what the role may see is still complete
  assert.equal(file.records.finance.length, 1);
});

test('a credential is never written, and the file admits what it dropped', () => {
  const state = liveState();
  // a password hash that somehow rode into a company slice
  state.traders = [{ id: 'tr_1', companyId: COMPANY, name: 'Trader One', outstandingAmount: 250, passwordHash: '$2b$secret' }];
  const { file } = exportAs(OWNER, { state });
  const text = JSON.stringify(file);
  assert.ok(!text.includes('$2b$'), 'a hash reached the file');
  assert.ok(!('passwordHash' in file.records.traders[0]));
  assert.deepEqual(file.strippedKeys, ['traders.passwordHash']);
});

test('the platform-wide slices are not company data', () => {
  // the store's own profile filter drops them, so a restore can never speak for them
  assert.ok(NOT_COMPANY_DATA.has('supportMessages') && NOT_COMPANY_DATA.has('ingredientCatalog'));
  const slices = PROFILE.slices.filter(s => !NOT_COMPANY_DATA.has(s.slice)).map(s => s.slice);
  assert.ok(!slices.includes('supportMessages') && !slices.includes('ingredientCatalog'));
});

test('the file name is dated and company-scoped', () => {
  assert.equal(backupFileName(COMPANY, '2026-03-04T10:00:00.000Z'), 'amrut-c_one-2026-03-04.json');
  assert.equal(csvFileName(COMPANY, 'finance', '2026-03-04T10:00:00.000Z'), 'amrut-c_one-finance-2026-03-04.csv');
});

/* ============================= ROUND TRIP ============================= */

test('a file written by the export is believed by the same company — and offers nothing to write', () => {
  const { file } = exportAs();
  const v = ctxFor(JSON.parse(JSON.stringify(file)));
  // the reading is sound: no error anywhere, only the note that it would change nothing
  assert.deepEqual(v.issues.filter(i => i.level === 'error'), []);
  assert.equal(v.company.id, COMPANY);
  assert.equal(v.totals.add, 0);
  assert.equal(v.totals.change, 0, 'nothing changed, so nothing should be written');
  assert.ok(hasIssue(v, 'EMPTY_SLICE', 'warning'));
  assert.equal(v.ok, false, 'a file with nothing to write is not offered as a restore');
  assert.equal(v.restore, undefined);
});

test('parseBackup refuses junk before anything else sees it', () => {
  assert.deepEqual(parseBackup(''), { ok: false, error: 'The file is empty.' });
  assert.equal(parseBackup('{not json').ok, false);
  assert.equal(parseBackup('{"a":1}').ok, true);
});

/* ============================= VALIDATION REFUSALS ============================= */

const skeleton = (records, over = {}) => ({
  format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, appVersion: '1.2.3',
  storeVersion: 21, exportedAt: '2026-03-04T10:00:00.000Z',
  company: { id: COMPANY, name: 'Farm One' },
  exportedBy: { id: 'u_1', name: 'Owner', role: OWNER },
  recordCounts: {}, records, ...over,
});

test('a file that is not an Amrut backup stops at the door', () => {
  const v = ctxFor({ hello: 'world' });
  assert.ok(!v.ok && hasIssue(v, 'FORMAT'));
  assert.equal(v.plans.length, 0);
  assert.equal(ctxFor(null).issues[0].code, 'FORMAT');
  assert.equal(ctxFor([1, 2]).issues[0].code, 'FORMAT');
});

test('a schema this app cannot read is refused, in either direction', () => {
  const future = ctxFor(skeleton({}, { schemaVersion: MAX_SUPPORTED_SCHEMA + 1 }));
  assert.ok(!future.ok && hasIssue(future, 'SCHEMA'));
  assert.equal(ctxFor(skeleton({}, { schemaVersion: 0 })).issues.find(i => i.level === 'error').code, 'SCHEMA');
  assert.ok(!ctxFor(skeleton({}, { schemaVersion: 'x' })).ok);
});

test('a backup for company A never restores into company B — and never reveals its rows', () => {
  const foreign = skeleton({ sheds: [{ id: 'sh_other', companyId: OTHER, name: 'Other', capacity: 1 }] },
    { company: { id: OTHER, name: 'Farm Two' } });
  const v = ctxFor(foreign);
  assert.ok(!v.ok);
  assert.equal(v.issues.find(i => i.level === 'error').code, 'COMPANY');
  assert.equal(v.plans.length, 0, 'the file was read anyway');
  assert.equal(v.totals.fileRows, 0, 'rows of another company were counted as this company\'s');
  assert.match(v.issues[0].message, /Nothing was read from it/);
});

test('a file that names no company is not restored', () => {
  const noCompany = { ...skeleton({ sheds: [] }), company: undefined };
  assert.ok(!ctxFor(noCompany).ok);
  assert.equal(ctxFor(noCompany).issues.find(i => i.level === 'error').code, 'COMPANY');
});

test('a row of another company inside a correct file is refused, not patched in', () => {
  const v = ctxFor(skeleton({
    sheds: [
      { id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 },
      { id: 'sh_other', companyId: OTHER, name: 'Snuck in', capacity: 9 },
    ],
  }));
  assert.ok(hasIssue(v, 'FOREIGN_ROW'));
  assert.ok(!v.ok);
  // the rejected row is not counted as a new record either, so it cannot reach the plan
  assert.equal(v.totals.add, 0, 'a foreign row was counted as this company\'s new record');
  assert.equal(v.restore?.writes.sheds?.find(r => r.id === 'sh_other'), undefined,
    'a foreign row entered the restore plan');
});

test('duplicate and missing ids are refused: a row must match exactly one live record', () => {
  const dup = ctxFor(skeleton({
    sheds: [
      { id: 'sh_1', companyId: COMPANY, name: 'Once', capacity: 1 },
      { id: 'sh_1', companyId: COMPANY, name: 'Twice', capacity: 2 },
    ],
  }));
  assert.ok(hasIssue(dup, 'DUPLICATE_ID') && !dup.ok);

  const missing = ctxFor(skeleton({ sheds: [{ companyId: COMPANY, name: 'No id', capacity: 1 }] }));
  assert.ok(hasIssue(missing, 'MISSING_ID') && !missing.ok);
});

test('a credential anywhere in the file refuses the restore', () => {
  const v = ctxFor(skeleton({
    sheds: [{ id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500, accessToken: 'eyJhbGciOi' }],
  }));
  assert.ok(hasIssue(v, 'SECRET_KEY') && !v.ok);
});

test('values are checked against the real column types', () => {
  const v = ctxFor(skeleton({
    sheds: [{ id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 'not a number' }],
    batches: [{ id: 'b_1', companyId: COMPANY, shedId: 'sh_1', birdCount: 400, placedOn: 'yesterday' }],
  }));
  assert.ok(hasIssue(v, 'INVALID_VALUE') && !v.ok);
  assert.match(v.issues.find(i => i.code === 'INVALID_VALUE').message, /capacity/);
});

test('a partial file may point at records the company already has; a broken pointer inside it is an error', () => {
  // batch pointing at a live shed, and at a shed that exists nowhere
  const v = ctxFor(skeleton({
    batches: [
      { id: 'b_1', companyId: COMPANY, shedId: 'sh_2', birdCount: 10, placedOn: '2026-02-01' },
      { id: 'b_2', companyId: COMPANY, shedId: 'sh_missing', birdCount: 10, placedOn: '2026-02-01' },
    ],
  }));
  const refs = v.issues.filter(i => i.code === 'BROKEN_REFERENCE');
  // sh_2 is live, so it is not reported at all
  assert.ok(!refs.some(i => i.message.includes('sh_2')), 'a live shed was called a broken reference');
  // sh_missing is neither in the file nor live — the file carries batches only, so this is a warning
  assert.ok(refs.some(i => i.message.includes('sh_missing') && i.level === 'warning'));

  // now the file does carry sheds, and still points at one it never had
  const carried = ctxFor(skeleton({
    sheds: [{ id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 }],
    batches: [{ id: 'b_9', companyId: COMPANY, shedId: 'sh_ghost', birdCount: 1, placedOn: '2026-02-01' }],
  }));
  const hard = carried.issues.find(i => i.code === 'BROKEN_REFERENCE' && i.message.includes('sh_ghost'));
  assert.equal(hard.level, 'error', 'a pointer to a record the file itself lacks must refuse the restore');
  assert.ok(!carried.ok);
});

test('money is never written twice: a numbered receipt that collides refuses the restore', () => {
  const v = ctxFor(skeleton({
    feedStock: [
      { id: 'fs_1', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 1000 },
      { id: 'fs_2', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 500 },
    ],
  }));
  assert.ok(hasIssue(v, 'DUPLICATE_RECEIPT', 'error') && !v.ok);
  assert.match(v.issues.find(i => i.code === 'DUPLICATE_RECEIPT').message, /GRN-1/);

  // a collision with a number already live, not just within the file
  const againstLive = ctxFor(skeleton({
    saleEntries: [
      { id: 'se_1', companyId: COMPANY, cashReference: 'CR-1', traderId: 'tr_1', amount: 500 },
      { id: 'se_2', companyId: COMPANY, cashReference: 'CR-1', traderId: 'tr_1', amount: 600 },
    ],
  }));
  assert.ok(hasIssue(againstLive, 'DUPLICATE_RECEIPT', 'error'));

  // a free-text UTR may legitimately repeat, so it is only noted
  const soft = ctxFor(skeleton({
    traderTxns: [
      { id: 'tt_1', companyId: COMPANY, reference: 'UTR-9', traderId: 'tr_1', amount: 250 },
      { id: 'tt_2', companyId: COMPANY, reference: 'UTR-9', traderId: 'tr_1', amount: 250 },
    ],
  }));
  assert.ok(hasIssue(soft, 'DUPLICATE_RECEIPT', 'warning'), 'a repeated UTR was treated as hard duplicate');
});

test('a number the company already holds twice is not blamed on the file', () => {
  // The live book has two feed rows sharing GRN-1 — the app's own rule says it should not, but
  // that is the farm's existing data, and a backup of it must still be restorable.
  const state = {
    ...liveState(),
    feedStock: [
      { id: 'fs_1', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 1000 },
      { id: 'fs_2', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 500 },
    ],
    saleEntries: [
      { id: 'se_1', companyId: COMPANY, cashReference: 'CR-1', traderId: 'tr_1', amount: 500 },
      { id: 'se_2', companyId: COMPANY, cashReference: 'CR-2', traderId: 'tr_1', amount: 700 },
    ],
  };

  // its own clean export, and an unrelated one, both pass
  const own = ctxFor(exportAs(OWNER, { state }).file, { state });
  assert.ok(!hasIssue(own, 'DUPLICATE_RECEIPT'), 'a live pair refused the export of that same pair');
  const unrelated = ctxFor(skeleton({ sheds: [{ id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 }] }), { state });
  assert.ok(!hasIssue(unrelated, 'DUPLICATE_RECEIPT'), 'an unrelated file was refused over live data');

  // but a third row on that number is the file's doing, and refuses the restore
  const third = ctxFor(skeleton({
    feedStock: [
      { id: 'fs_1', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 1000 },
      { id: 'fs_2', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 500 },
      { id: 'fs_3', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 250 },
    ],
  }), { state });
  assert.ok(hasIssue(third, 'DUPLICATE_RECEIPT', 'error'), 'a file-introduced third copy was let through');
  assert.match(third.issues.find(i => i.code === 'DUPLICATE_RECEIPT' && i.level === 'error').message, /fs_3/);

  // moving a row onto a number that is already taken is caught the same way
  const moved = ctxFor(skeleton({
    saleEntries: [{ id: 'se_2', companyId: COMPANY, cashReference: 'CR-1', traderId: 'tr_1', amount: 700 }],
  }), { state });
  assert.ok(hasIssue(moved, 'DUPLICATE_RECEIPT', 'error'), 'a row repriced onto a live receipt was let through');
});

test('a neighbour company holding the same receipt number is nobody else\'s business', () => {
  // The cache legitimately carries both farms' rows, and receipt numbers restart per company,
  // so Farm Two's CR-1 must neither blame Farm One's file nor shadow the diff.
  const state = {
    ...liveState(),
    feedStock: [
      { id: 'fs_1', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 1000 },
      { id: 'fs_other', companyId: OTHER, purchaseRef: 'GRN-1', qtyKg: 900 },
    ],
  };
  const v = ctxFor(skeleton({
    feedStock: [{ id: 'fs_2', companyId: COMPANY, purchaseRef: 'GRN-1', qtyKg: 400 }],
  }), { state });
  assert.ok(hasIssue(v, 'DUPLICATE_RECEIPT', 'error'), 'a same-numbered purchase in this company was let through');
  assert.match(v.issues.find(i => i.code === 'DUPLICATE_RECEIPT').message, /on record fs_1.*book it again on fs_2/);
  assert.ok(!v.issues.some(i => i.message.includes('fs_other')), 'another company\'s row was named in this company\'s plan');
  assert.deepEqual(v.plans.find(p => p.slice === 'feedStock')?.kept, 1);
});

test('a slice the role may not read blocks the restore rather than quietly writing it', () => {
  const { file } = exportAs(OWNER);
  const v = ctxFor(JSON.parse(JSON.stringify(file)), { role: LABOUR });
  assert.ok(hasIssue(v, 'UNREADABLE_SLICE') && !v.ok);
  assert.equal(v.restore?.writes.audit, undefined);
});

test('a store version apart is noted, not refused', () => {
  const v = ctxFor(skeleton({ sheds: [{ id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 }] }),
    { storeVersion: 22 });
  assert.ok(hasIssue(v, 'STORE_VERSION', 'warning'));
});

test('an empty file has nothing to restore', () => {
  const v = ctxFor(skeleton({}));
  assert.ok(!v.ok && hasIssue(v, 'EMPTY_SLICE', 'error'));
});

/* ============================= THE PLAN: WHAT A RESTORE WOULD DO ============================= */

test('the plan names the new rows, the changed rows, and keeps everything the file never mentions', () => {
  const input = skeleton({
    sheds: [
      { id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 },        // identical
      { id: 'sh_2', companyId: COMPANY, name: 'Shed B renamed', capacity: 800 }, // changed
      { id: 'sh_3', companyId: COMPANY, name: 'Shed C', capacity: 90 },          // new
    ],
    finance: [{ id: 'fn_9', companyId: COMPANY, amount: 200, date: '2026-03-01T00:00:00.000Z', batchId: 'b_1' }],
  });
  const v = ctxFor(input);
  assert.ok(v.ok, JSON.stringify(v.issues));
  // kept counts this company's live rows the file never mentions — its earlier ledger line, which
  // the restore must leave alone. The other company's shed in the cache is not this company's to keep.
  assert.deepEqual({ ...v.totals }, { fileRows: 4, add: 2, change: 1, same: 1, kept: 1 });

  const sheds = v.plans.find(p => p.slice === 'sheds');
  assert.deepEqual({ add: sheds.add, change: sheds.change, same: sheds.same, kept: sheds.kept },
    { add: 1, change: 1, same: 1, kept: 0 });
  assert.equal(sheds.money, false);
  assert.equal(v.plans.find(p => p.slice === 'finance').money, true);
  // a record type the file says nothing about gets no plan at all: it is simply untouched
  assert.equal(v.plans.find(p => p.slice === 'traders'), undefined);
  assert.equal(v.restore.writes.traders, undefined);

  // the writes carry only the rows that move, and never the identical one
  assert.deepEqual(v.restore.writes.sheds.map(r => r.id).sort(), ['sh_2', 'sh_3']);
  assert.deepEqual(v.restore.counts.sheds, { add: 1, change: 1 });
  assert.equal(v.restore.writes.sheds.find(r => r.id === 'sh_2').synced, false, 'a restored row must go back out to the database');
  assert.equal(v.restore.writes.finance.length, 1);
  assert.equal(v.restore.companyId, COMPANY);
});

test('a sync flag alone is not a change', () => {
  const v = ctxFor(skeleton({
    sheds: [
      { id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500, synced: true },
      { id: 'sh_2', companyId: COMPANY, name: 'Shed B', capacity: 800, synced: false },
    ],
  }));
  assert.equal(v.totals.change, 0);
  assert.equal(v.restore, undefined, 'a file that only re-states the cache is not a restore');
});

test('a restore is additive: rows the file never mention are counted as kept, and no slice is replaced', () => {
  const v = ctxFor(skeleton({
    batches: [{ id: 'b_1', companyId: COMPANY, shedId: 'sh_1', birdCount: 999, placedOn: '2026-01-05' }],
  }));
  assert.ok(v.ok, JSON.stringify(v.issues));
  // the whole file is one batch; every other record type stands untouched
  assert.equal(v.totals.change, 1);
  assert.equal(Object.keys(v.restore.writes).length, 1);
  assert.ok(!('sheds' in v.restore.writes));
  assert.ok(!('traders' in v.restore.writes));
  const batchSlice = v.plans.find(p => p.slice === 'batches');
  assert.equal(batchSlice.liveRows, 1);
});

test('an unknown record type in the file is noted and ignored', () => {
  const v = ctxFor(skeleton({
    sheds: [{ id: 'sh_1', companyId: COMPANY, name: 'Shed A', capacity: 500 }],
    widgets: [{ id: 'w_1' }],
  }));
  assert.ok(hasIssue(v, 'UNKNOWN_SLICE', 'warning'));
});

test('every exported slice has a human name, so a preview never reads as JSON keys', () => {
  for (const def of PROFILE.slices) assert.ok(SLICE_LABELS[def.slice], def.slice);
});

/* ============================= CSV ============================= */

test('a spreadsheet cell that looks like a formula is neutralised', () => {
  const csv = recordsCsv(
    [{ id: 'x_1', remark: '=1+1', other: '@SUM(A1)', plus: '+1', at: '-2', plain: 'ok, "quoted"' }],
    ['id', 'remark', 'other', 'plus', 'at', 'plain'],
  );
  const row = csv.split('\r\n')[1];
  assert.ok(row.includes("'=1+1"), row);
  assert.ok(row.includes("'@SUM(A1)"));
  assert.ok(row.includes("'+1"));
  assert.ok(row.includes("'-2"));
  assert.ok(row.includes('"ok, ""quoted"""'));
  assert.equal(csv.split('\r\n')[0], 'id,remark,other,plus,at,plain', 'the column order is the caller\'s');
});

test('csv groups point at record types a company actually owns', () => {
  for (const g of CSV_GROUPS) {
    assert.ok(!NOT_COMPANY_DATA.has(g.slice), `${g.slice} is platform data, not a company's`);
    assert.ok(SLICE_LABELS[g.slice], `${g.slice} has no name to show a person`);
    assert.ok(g.title.length > 0 && g.columns.length > 0, `${g.slice} is an empty group`);
  }
  // the export of a real company can feed the groups it shares with this profile
  const { file } = exportAs();
  for (const g of CSV_GROUPS.filter(x => PROFILE.slices.some(s => s.slice === x.slice))) {
    assert.ok(Array.isArray(file.records[g.slice] ?? []));
  }
});

test('a csv of nothing is empty rather than a stray header', () => {
  assert.equal(recordsCsv([]), '');
});

/* ============================= THE GATE THE STORE ENFORCES ============================= */

test('validation is read-only: the same file answered twice answers the same', () => {
  const { file } = exportAs();
  const json = JSON.parse(JSON.stringify(file));
  const a = ctxFor(json);
  const b = ctxFor(json);
  assert.deepEqual(a.totals, b.totals);
  assert.deepEqual(a.issues, b.issues);
  assert.deepEqual(a.restore, b.restore);
});
