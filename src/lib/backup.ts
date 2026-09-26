/**
 * backup.ts — the company data backup format, its validation and its restore plan.
 *
 * This module is deliberately pure: no store, no Supabase client, no `import.meta.env`. It
 * reads the slices it is handed and answers with plain data, so the whole safety story —
 * what a backup may contain, what a restore file must survive before it is believed, and what
 * "restore" would actually change — is testable with `node --test` the way `dbErrors.ts` is.
 * For the same reason it takes the permission question as a callback (`canRead`) rather than
 * importing the role matrix: the caller is the one who knows who is asking.
 *
 * Two rules shape everything below.
 *
 * 1. The registry is the single description of what a company's data is. A slice appears here
 *    because `services/supabase/registry.ts` says it is a table with a company column, and the
 *    rows are the client records exactly as the sync sends them. A backup is therefore the same
 *    set of objects the database already holds, which is what makes a restore an upsert by id
 *    rather than a second copy of a sale. The registry arrives as a `profile` rather than an
 *    import: that keeps this file free of runtime dependencies, which is how `dbErrors.ts` stays
 *    testable under `node --test`, and it makes the caller state who is asking.
 *
 * 2. A restore is additive by id and never a wipe. Rows the file does not mention stay exactly
 *    where they are, and the preview says how many. An overwrite-everything restore would delete
 *    whatever a teammate logged after the export, and no preview count can make that safe.
 */
import type { SliceDef } from '../services/supabase/registry';
// Only the `Role` name is needed, and as a type — so nothing here drags in the runtime graph.
import type { Role } from '@/types';

/**
 * What this module needs from the sync layer to do its job, handed over by the caller:
 * the slices, the live column types, each table's key columns, and how a row names itself.
 */
export interface BackupProfile {
  /** The registry's slice definitions, already narrowed to a company's own data. */
  slices: readonly SliceDef[];
  /** Postgres type per column, in the database's own snake_case spelling. */
  columns: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Primary key column(s) per table. */
  primaryKeys: Readonly<Record<string, readonly string[]>>;
  /** A row's own id, exactly as the sync matches rows by it. */
  idOf: (row: unknown) => string;
}

export const BACKUP_FORMAT = 'amrut-company-backup';
/** Bumped only when an old file can no longer be read without a migration step. */
export const BACKUP_SCHEMA_VERSION = 1;
/** Files written by a newer schema are refused outright: this app cannot know its shape. */
export const MAX_SUPPORTED_SCHEMA = BACKUP_SCHEMA_VERSION;

/** A file with a person's credential in it is not a backup, it is a leak. Users are not an
 *  exported slice at all (their record is `passwordHash`), so this is the belt on the braces:
 *  any such key that turns up anywhere is dropped from the file and reported. */
const SECRET_KEY_RE = /^(password|passwordhash|passhash|token|refreshtoken|accesstoken|apikey|api_?key|secret|service_?role_?key|anon_?key|credential|connection_?string)/i;

/**
 * Platform-wide slices, which the caller filters out of the profile. `supportMessages` is a
 * farm's note to the platform, not its books, and `ingredientCatalog` is shared by every
 * company, so restoring either into one company would speak for data that company does not own.
 */
export const NOT_COMPANY_DATA: ReadonlySet<string> = new Set(['supportMessages', 'ingredientCatalog']);

export interface BackupCompany { id: string; name: string }
export interface BackupAuthor { id: string; name: string; role: Role | undefined }

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  /** The Zustand persist version the writer was running, so a reader knows how far apart we are. */
  storeVersion: number;
  exportedAt: string;
  company: BackupCompany;
  exportedBy: BackupAuthor;
  recordCounts: Record<string, number>;
  /** slice → client records, in the shapes the sync engine itself sends. */
  records: Record<string, Record<string, unknown>[]>;
  /** Keys dropped by the secret guard, so the file admits to what it does not carry. */
  strippedKeys?: string[];
}

export interface BackupSource {
  companyId: string;
  companyName: string;
  userId: string;
  userName: string;
  role: Role | undefined;
  appVersion: string;
  storeVersion: number;
  /** ISO timestamp, passed in so a test can pin it. */
  nowIso: string;
  state: Record<string, unknown[]>;
  /** The sync layer's own description of what a company's data is. */
  profile: BackupProfile;
  /** The registry's own SELECT verb for a slice, answered by the caller's role matrix. */
  canRead: (def: SliceDef) => boolean;
}

export interface BuiltBackup { file: BackupFile; omitted: { slice: string; reason: string }[] }

const companyOf = (def: SliceDef, row: Record<string, unknown>) =>
  String(def.companyOf ? def.companyOf(row) : (row as { companyId?: unknown }).companyId ?? '');

function jsonClone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

/**
 * The backup of one company, as far as this session is allowed to see it.
 *
 * Rows outside the working company are dropped rather than refused: the cache legitimately
 * holds other companies' seed rows, and they are not this company's to export. A slice this
 * role cannot read is left out entirely for the same reason the sync leaves it alone — the
 * database would never have handed it over, and a file that carries money a reader may not see
 * is a leak through the side door.
 */
export function buildBackup(src: BackupSource): BuiltBackup {
  const records: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  const omitted: BuiltBackup['omitted'] = [];
  const stripped = new Set<string>();

  for (const def of src.profile.slices) {
    const rows = (src.state[def.slice] ?? []) as Record<string, unknown>[];
    if (!Array.isArray(rows)) { omitted.push({ slice: def.slice, reason: 'not a list in this store' }); continue; }
    if (!src.canRead(def)) { omitted.push({ slice: def.slice, reason: 'this role may not read it' }); continue; }
    const mine = rows.filter(r => companyOf(def, r) === src.companyId);
    if (!mine.length) continue;
    const clone = jsonClone(mine);
    for (const row of clone) for (const k of Object.keys(row)) if (SECRET_KEY_RE.test(k)) { delete row[k]; stripped.add(`${def.slice}.${k}`); }
    records[def.slice] = clone;
    counts[def.slice] = clone.length;
  }

  return {
    file: {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: src.appVersion,
      storeVersion: src.storeVersion,
      exportedAt: src.nowIso,
      company: { id: src.companyId, name: src.companyName },
      exportedBy: { id: src.userId, name: src.userName, role: src.role },
      recordCounts: counts,
      records,
      ...(stripped.size ? { strippedKeys: [...stripped].sort() } : {}),
    },
    omitted,
  };
}

export const backupFileName = (companyId: string, iso: string) =>
  `amrut-${companyId}-${iso.slice(0, 10)}.json`;

/** Parse only. Everything that decides whether the file may be believed lives in `validateBackup`. */
export function parseBackup(text: string): { ok: true; json: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: false, error: 'The file is empty.' };
  try { return { ok: true, json: JSON.parse(text) }; }
  catch { return { ok: false, error: 'This is not a readable JSON file.' }; }
}

/* ============================= VALIDATION ============================= */

export type IssueLevel = 'error' | 'warning';
export interface Issue {
  code: 'FORMAT' | 'SCHEMA' | 'STORE_VERSION' | 'COMPANY' | 'FOREIGN_ROW' | 'MISSING_ID'
  | 'DUPLICATE_ID' | 'INVALID_VALUE' | 'BROKEN_REFERENCE' | 'DUPLICATE_RECEIPT' | 'SECRET_KEY'
  | 'UNREADABLE_SLICE' | 'EMPTY_SLICE' | 'UNKNOWN_SLICE';
  level: IssueLevel;
  message: string;
  slice?: string;
}

/** How many rows of a slice the file would add, change or leave alone. */
export interface SlicePlan {
  slice: string;
  table: string;
  label: string;
  fileRows: number;
  liveRows: number;
  add: number;
  change: number;
  same: number;
  /** Live rows the file does not mention. A restore keeps every one of them. */
  kept: number;
  money: boolean;
}

export interface Validation {
  ok: boolean;
  company: BackupCompany | null;
  meta: Pick<BackupFile, 'schemaVersion' | 'appVersion' | 'storeVersion' | 'exportedAt'> | null;
  issues: Issue[];
  plans: SlicePlan[];
  totals: { fileRows: number; add: number; change: number; same: number; kept: number };
  /** Only set when the file is sound enough to restore from. */
  restore?: RestorePlan;
}

export interface RestorePlan {
  companyId: string;
  /**
   * slice → only the rows this restore writes (the new ones and the changed ones), in file
   * order. The rows the company already has identical are left out, so applying the plan is a
   * write-by-id against whatever the store holds at that moment rather than a replacement of
   * whole slices — a row a pull or a colleague added between the preview and the confirmation
   * survives, and a row that has not changed is not needlessly marked unsynced.
   */
  writes: Record<string, unknown[]>;
  counts: Record<string, { add: number; change: number }>;
}

/** Human names for the registry's slices, so a preview reads as data rather than as JSON keys. */
export const SLICE_LABELS: Record<string, string> = {
  companies: 'Company', farms: 'Farms', sheds: 'Sheds', batches: 'Batches',
  assignments: 'Shed assignments', mortality: 'Mortality', feed: 'Feed consumption',
  feedRounds: 'Feed rounds', eggs: 'Egg collections', eggWastages: 'Egg wastage',
  saleLogs: 'Shed dispatch logs', saleEntries: 'Egg sales', eggSaleBookings: 'Planner bookings',
  feedStock: 'Feed purchases & movements', medicineItems: 'Medicine catalogue',
  medicineStock: 'Medicine stock & usage', feedFormulas: 'Feed formulas', finance: 'Finance records',
  traders: 'Traders', traderTxns: 'Trader transactions', tasks: 'Tasks',
  vaccinations: 'Vaccination schedule', vaccinationTemplates: 'Vaccination templates',
  cashHandovers: 'Cash handovers', cashCounts: 'Cash counts', audit: 'Audit trail',
};

/** Slices whose rows carry money, so a preview can say where the risk sits. */
const MONEY_SLICES = new Set(['finance', 'traders', 'traderTxns', 'saleEntries', 'feedStock', 'medicineStock', 'cashHandovers', 'cashCounts']);

/**
 * Client field → the slice it must point at. Derived references are checked against the file
 * plus the live cache, because a partial export is still a valid restore: a batch whose shed is
 * already in the company is not broken just because this file carried batches only.
 */
const REFERENCES: Record<string, string> = {
  companyId: 'companies', farmId: 'farms', shedId: 'sheds', batchId: 'batches',
  traderId: 'traders', formulaId: 'feedFormulas', medicineId: 'medicineItems',
  itemId: 'medicineItems', templateId: 'vaccinationTemplates', saleEntryId: 'saleEntries',
  saleId: 'saleLogs', consumptionId: 'feed', bookingId: 'eggSaleBookings',
};

/**
 * Person pointers. A backup never carries people (their record is a password hash), so a name
 * this file cannot resolve is expected — it is checked against the live roster and reported as
 * a warning at most. `refId` and `entityId` are polymorphic and left to their own modules.
 */
const PERSON_FIELDS = new Set([
  'userId', 'byUserId', 'createdBy', 'updatedBy', 'assignedUserId', 'assignedTo',
  'fromUserId', 'toUserId', 'handledById', 'authorizedById', 'cashHandledById', 'closedById',
  'supervisorId', 'managerId', 'farmSupervisorId', 'financialSupervisorId',
]);

const isFiniteNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/**
 * A slice's receipt-number field, and whether the app promises it is unique within the company.
 * `strict` mirrors what the store already enforces when it mints the number.
 */
const RECEIPT_FIELD: Record<string, { field: string; label: string; strict: boolean }> = {
  finance: { field: 'reference', label: 'Receipt / UTR reference', strict: false },
  traderTxns: { field: 'reference', label: 'Receipt / UTR reference', strict: false },
  feedStock: { field: 'purchaseRef', label: 'Stock receipt', strict: true },
  medicineStock: { field: 'purchaseRef', label: 'Stock receipt', strict: true },
  saleEntries: { field: 'cashReference', label: 'Cash receipt', strict: true },
};

/** Whether a value can become the Postgres type this column is. The client speaks camelCase. */
function valueMatchesColumn(type: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;   // nullability is the database's call, not ours
  if (type === 'boolean') return typeof value === 'boolean';
  // jsonb takes any JSON value, and a bare string is one: the audit trail writes its summary
  // into a jsonb column as text, which Postgres stores as a JSON string.
  if (type === 'jsonb') return typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'object' || (typeof value === 'number' && Number.isFinite(value));
  if (/^(numeric|integer|bigint|smallint|real|double precision)$/.test(type))
    return isFiniteNumber(value) || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
  if (/^timestamp/.test(type) || type === 'date')
    return !Number.isNaN(Date.parse(String(value)));
  if (type === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
  if (/^(text|character varying)/.test(type)) return typeof value === 'string' || typeof value === 'number';
  return true;                                            // a type this app does not know is not a reason to refuse
}

/** A row's own declared columns, in client spelling — the only fields typed checking looks at. */
function columnTypes(columns: BackupProfile['columns'], table: string): Record<string, string> | null {
  const cols = columns[table];
  if (!cols) return null;
  const out: Record<string, string> = {};
  for (const [col, type] of Object.entries(cols)) out[camelOf(col)] = type;
  return out;
}
const CAMEL_CACHE = new Map<string, string>();
const camelOf = (k: string) => CAMEL_CACHE.get(k) ?? (() => {
  const v = k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  CAMEL_CACHE.set(k, v); return v;
})();

const canonRow = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.keys(val).sort().reduce<Record<string, unknown>>((acc, key) => { acc[key] = (val as Record<string, unknown>)[key]; return acc; }, {})
    : val);

/** A row is "the same" when every field except the sync flag matches — the flag is this device's own business. */
const withoutSynced = (row: Record<string, unknown>) => { const { synced, ...rest } = row; void synced; return rest; };

export interface ValidateContext {
  /** the company this session is standing in */
  companyId: string;
  /** live slices, used for the diff and for reference checks against data the file omits */
  state: Record<string, unknown[]>;
  canRead: (def: SliceDef) => boolean;
  storeVersion: number;
  profile: BackupProfile;
}

/**
 * Everything a restore file must survive before a single row moves. Ordered so the answers that
 * decide "is this even this company's file" come first — a mismatch there ends the reading, and
 * the caller never sees a half-built plan.
 */
export function validateBackup(json: unknown, ctx: ValidateContext): Validation {
  const { profile } = ctx;
  /** The same identity the sync engine uses, so a file's row matches exactly one live row. */
  const rowId = profile.idOf;
  const issues: Issue[] = [];
  const empty: Validation = {
    ok: false, company: null, meta: null, issues, plans: [],
    totals: { fileRows: 0, add: 0, change: 0, same: 0, kept: 0 },
  };

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    issues.push({ code: 'FORMAT', level: 'error', message: 'A backup file must be a single JSON object.' });
    return empty;
  }
  const file = json as Partial<BackupFile>;

  if (file.format !== BACKUP_FORMAT) {
    issues.push({ code: 'FORMAT', level: 'error', message: `This is not an Amrut backup file (format says ${JSON.stringify(file.format ?? null)}).` });
    return empty;
  }
  const meta = {
    schemaVersion: Number(file.schemaVersion),
    appVersion: typeof file.appVersion === 'string' ? file.appVersion : 'unknown',
    storeVersion: Number(file.storeVersion),
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
  };
  if (!Number.isFinite(meta.schemaVersion)) {
    issues.push({ code: 'SCHEMA', level: 'error', message: 'The file does not say which backup schema it is, so nothing in it can be trusted.' });
    return { ...empty, meta };
  }
  if (meta.schemaVersion > MAX_SUPPORTED_SCHEMA) {
    issues.push({ code: 'SCHEMA', level: 'error', message: `This file is backup schema ${meta.schemaVersion}; this app reads up to ${MAX_SUPPORTED_SCHEMA}. Update the app before restoring it.` });
    return { ...empty, meta, company: file.company ?? null };
  }
  if (meta.schemaVersion < BACKUP_SCHEMA_VERSION) {
    issues.push({ code: 'SCHEMA', level: 'error', message: `Backup schema ${meta.schemaVersion} is older than this app's ${BACKUP_SCHEMA_VERSION}, and no upgrade path for it is built in. Restore it from the app version that wrote it.` });
    return { ...empty, meta, company: file.company ?? null };
  }
  if (meta.storeVersion !== ctx.storeVersion) {
    issues.push({ code: 'STORE_VERSION', level: 'warning', message: `Written by data-store version ${meta.storeVersion || 'unknown'}; this app is on ${ctx.storeVersion}. The restore keeps to fields both know.` });
  }

  const company = file.company && typeof file.company.id === 'string' ? file.company : null;
  if (!company) {
    issues.push({ code: 'COMPANY', level: 'error', message: 'The file names no company, so there is nothing to check it against.' });
    return { ...empty, meta };
  }
  // The isolation rule, stated once and answered before any row is read: a file for another
  // company must not even reveal what it holds.
  if (company.id !== ctx.companyId) {
    issues.push({
      code: 'COMPANY', level: 'error',
      message: `This backup belongs to ${company.name || company.id}. You are working in ${ctx.companyId}. Nothing was read from it.`,
    });
    return { ...empty, meta, company };
  }

  const records = file.records;
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    issues.push({ code: 'FORMAT', level: 'error', message: 'The file has no records section.' });
    return { ...empty, meta, company };
  }

  const fileOf = (slice: string) => {
    const rows = (records as Record<string, unknown>)[slice];
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  };
  const liveOf = (slice: string) => {
    const rows = ctx.state[slice];
    return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
  };

  const plans: SlicePlan[] = [];
  const writes: RestorePlan['writes'] = {};
  const counts: RestorePlan['counts'] = {};
  const totals = { fileRows: 0, add: 0, change: 0, same: 0, kept: 0 };
  /** ids this restore may point at: the file's own rows plus everything the company already has. */
  const knownIds = new Map<string, Set<string>>();
  const idsFor = (slice: string) => {
    const cached = knownIds.get(slice);
    if (cached) return cached;
    const set = new Set<string>([...liveOf(slice), ...fileOf(slice)].map(r => String(rowId(r))));
    knownIds.set(slice, set);
    return set;
  };

  for (const key of Object.keys(records)) {
    if (!profile.slices.some(s => s.slice === key)) {
      issues.push({ code: 'UNKNOWN_SLICE', level: 'warning', slice: key, message: `The file carries "${key}", which this app does not store — it will be ignored.` });
    }
  }

  for (const def of profile.slices) {
    const label = SLICE_LABELS[def.slice] ?? def.slice;
    const raw = (records as Record<string, unknown>)[def.slice];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      issues.push({ code: 'FORMAT', level: 'error', slice: def.slice, message: `${label} is not a list of records in this file.` });
      continue;
    }
    const rows = raw as Record<string, unknown>[];
    // The cache legitimately holds other companies' rows, so "what the company already has" is
    // read company by company: a receipt number is unique per company (two farms may both book
    // CR-1), and the diff must not compare a file against a neighbour's books.
    const live = liveOf(def.slice).filter(r => companyOf(def, r) === company.id);
    if (!ctx.canRead(def)) {
      issues.push({ code: 'UNREADABLE_SLICE', level: 'error', slice: def.slice, message: `${label} is in this file, but your role may not read it, so it cannot be restored.` });
      continue;
    }

    const types = columnTypes(profile.columns, def.table);
    const seen = new Map<string, Record<string, unknown>>();
    const addIds: string[] = []; const changeIds: string[] = [];
    let same = 0;
    const liveById = new Map(live.map(r => [String(rowId(r)), r]));

    for (const row of rows) {
      totals.fileRows++;
      if (!row || typeof row !== 'object') { issues.push({ code: 'FORMAT', level: 'error', slice: def.slice, message: `${label}: a record is not an object.` }); continue; }
      const id = String(rowId(row) ?? '');
      if (!id || id === 'undefined') {
        issues.push({ code: 'MISSING_ID', level: 'error', slice: def.slice, message: `${label}: a record has no id, so it cannot be matched to the row it belongs to.` });
        continue;
      }
      if (seen.has(id)) {
        issues.push({ code: 'DUPLICATE_ID', level: 'error', slice: def.slice, message: `${label}: id ${id} appears twice in this file.` });
        continue;
      }
      if (companyOf(def, row) !== company.id) {
        // A row that is not this company's never enters the plan, so a rejected record cannot be
        // patched in by a later slice of the same loop.
        issues.push({ code: 'FOREIGN_ROW', level: 'error', slice: def.slice, message: `${label} ${id} belongs to ${companyOf(def, row) || 'no company'}, not to this company.` });
        continue;
      }
      seen.set(id, row);
      for (const key of Object.keys(row)) {
        if (SECRET_KEY_RE.test(key)) issues.push({ code: 'SECRET_KEY', level: 'error', slice: def.slice, message: `${label} ${id} carries "${key}", which no backup may hold.` });
      }
      const pk = profile.primaryKeys[def.table];
      if (pk && pk.length === 1 && !valueMatchesColumn(types?.[camelOf(pk[0])] ?? 'text', row[pk[0] === 'id' ? 'id' : camelOf(pk[0])])) {
        issues.push({ code: 'INVALID_VALUE', level: 'error', slice: def.slice, message: `${label}: id ${id} is not usable as this table's key.` });
      }
      if (types) for (const [field, value] of Object.entries(row)) {
        const type = types[field];
        if (type && !valueMatchesColumn(type, value)) {
          issues.push({ code: 'INVALID_VALUE', level: 'error', slice: def.slice, message: `${label} ${id}: "${field}" is not a valid ${type}.` });
        }
      }

      const existing = liveById.get(id);
      if (!existing) { addIds.push(id); totals.add++; }
      else if (canonRow(withoutSynced(existing)) !== canonRow(withoutSynced(row))) { changeIds.push(id); totals.change++; }
      else { same++; totals.same++; }
    }

    // Duplicates only make sense across whole slices: two finance rows with different ids and
    // the same receipt number are the same money written twice. The three numbered receipts are
    // unique within a company by the app's own rule, so reusing one refuses the restore; a free
    // text UTR/cheque reference may legitimately repeat, so it only raises an eyebrow.
    const receipt = RECEIPT_FIELD[def.slice];
    if (receipt) {
      const numberOn = (row: Record<string, unknown>) => {
        const value = row[receipt.field];
        return typeof value === 'string' && value ? value : null;
      };
      // Who holds each number once this restore has run: the file's copy wins for an id it
      // carries, because that is the row that will exist afterwards.
      const holders = new Map<string, string[]>();
      const hold = (value: string, id: string) => {
        const list = holders.get(value);
        if (list) list.push(id); else holders.set(value, [id]);
      };
      for (const row of live) {
        const id = String(rowId(row));
        if (seen.has(id)) continue;
        const value = numberOn(row);
        if (value) hold(value, id);
      }
      for (const [id, row] of seen) {
        const value = numberOn(row);
        if (value) hold(value, id);
      }
      // Only the file's own rows are blamed, and only those that bring the number new: a pair the
      // company already holds is its existing book, not a fault in this file, and refusing over it
      // would leave a farm with dirty data unable to restore even its own clean backup.
      for (const [id, row] of seen) {
        const value = numberOn(row);
        if (!value) continue;
        const onRecord = liveById.get(id);
        if (onRecord && numberOn(onRecord) === value) continue;
        const other = (holders.get(value) ?? []).find(h => h !== id);
        if (!other) continue;
        issues.push({
          code: 'DUPLICATE_RECEIPT', level: receipt.strict ? 'error' : 'warning', slice: def.slice,
          message: `${receipt.label} ${value} is already on record ${other}; this file would book it again on ${id}. Money is never written twice${receipt.strict ? ' — correct the number before restoring' : ''}.`,
        });
      }
    }

    // References and people are grouped, because one unbacked id repeated over fifty rows is
    // one fact about the file, not fifty faults in it.
    const missingRefs = new Map<string, number>();
    const missingPeople = new Set<string>();
    for (const row of seen.values()) {
      const id = String(rowId(row));
      for (const [field, target] of Object.entries(REFERENCES)) {
        const value = row[field];
        if (value === undefined || value === null || value === '') continue;
        if (target === 'companies' && String(value) === company.id) continue;
        if (idsFor(target).has(String(value))) continue;
        const carried = target in records;
        const key = `${target}\u0000${String(value)}\u0000${carried}`;
        missingRefs.set(key, (missingRefs.get(key) ?? 0) + 1);
      }
      for (const field of PERSON_FIELDS) {
        const value = row[field];
        if (typeof value !== 'string' || !value || value === 'system') continue;
        if (!idsFor('users').has(value)) missingPeople.add(value);
      }
    }
    for (const [key, count] of missingRefs) {
      const [target, value, carriedText] = key.split('\u0000');
      const carried = carriedText === 'true';
      issues.push({
        code: 'BROKEN_REFERENCE', level: carried ? 'error' : 'warning', slice: def.slice,
        message: `${label} ${count > 1 ? `${count} records` : `record ${value}`} point at ${SLICE_LABELS[target] ?? target} "${value}", which ${carried ? 'is not in this file' : 'this company does not have yet'}.`,
      });
    }
    if (missingPeople.size) {
      issues.push({
        code: 'BROKEN_REFERENCE', level: 'warning', slice: def.slice,
        message: `${label} names ${missingPeople.size} person${missingPeople.size > 1 ? 's' : ''} (${[...missingPeople].slice(0, 3).join(', ')}${missingPeople.size > 3 ? ', …' : ''}) who ${missingPeople.size > 1 ? 'are' : 'is'} not on this company's roster. Backups never carry people, so the row keeps the name and nobody is invented for it.`,
      });
    }

    const kept = live.filter(r => !seen.has(String(rowId(r)))).length;
    totals.kept += kept;
    plans.push({
      slice: def.slice, table: def.table, label,
      fileRows: rows.length, liveRows: live.length,
      add: addIds.length, change: changeIds.length, same, kept,
      money: MONEY_SLICES.has(def.slice),
    });

    if (addIds.length || changeIds.length) {
      // Only the writes, never the whole slice: the caller merges these by id against the live
      // store, so nothing that arrived after this reading is overwritten by it.
      const toWrite = [...addIds, ...changeIds].map(id => ({ ...seen.get(id)!, synced: false }));
      const prior = writes[def.slice];
      if (prior) prior.push(...toWrite); else writes[def.slice] = toWrite;
      counts[def.slice] = { add: addIds.length, change: changeIds.length };
    }
  }

  if (!plans.length) issues.push({ code: 'EMPTY_SLICE', level: 'error', message: 'The file holds no company records, so there is nothing to restore.' });
  else if (!totals.add && !totals.change) {
    issues.push({ code: 'EMPTY_SLICE', level: 'warning', message: 'Every record in this file already matches the company exactly. Restoring it would change nothing.' });
  }
  const errors = issues.filter(i => i.level === 'error');
  const ok = plans.length > 0 && errors.length === 0 && (totals.add + totals.change > 0);

  return {
    ok, company, meta, issues, plans, totals,
    ...(ok ? { restore: { companyId: company.id, writes, counts } } : {}),
  };
}

/* ============================= CSV ============================= */

/**
 * A spreadsheet of one record group, for an accountant who wants rows rather than a report.
 *
 * CSV is a reading format only — it is never restorable, and the screen says so. Cells that
 * begin like a formula are neutralised because the file is opened in Excel, where `=…` and
 * `@…` execute: a remark typed on a farm must not become a formula on someone's desktop.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function recordsCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return '';
  const keys = columns ?? [...new Set(rows.flatMap(r => Object.keys(r)))].sort();
  return [keys.join(','), ...rows.map(r => keys.map(k => csvCell(r[k])).join(','))].join('\r\n');
}

/** The columns worth a spreadsheet for each money/stock group — the reading list, not the dump. */
export const CSV_GROUPS: { slice: string; title: string; columns: string[] }[] = [
  { slice: 'finance', title: 'Finance ledger', columns: ['date', 'kind', 'category', 'amount', 'paymentMethod', 'reference', 'counterparty', 'godown', 'batchId', 'remarks'] },
  { slice: 'traders', title: 'Traders', columns: ['name', 'mobile', 'gstin', 'openingBalance', 'outstandingAmount', 'active'] },
  { slice: 'traderTxns', title: 'Trader transactions', columns: ['date', 'kind', 'traderId', 'trays', 'rate', 'amount', 'paymentMethod', 'reference', 'remarks'] },
  { slice: 'saleEntries', title: 'Egg sales', columns: ['date', 'traderId', 'pricing', 'amount', 'cash', 'phonepe', 'advance', 'laborCharge', 'credit', 'cashReference', 'remarks'] },
  { slice: 'eggSaleBookings', title: 'Planner bookings', columns: ['date', 'traderId', 'shedId', 'batchId', 'grade', 'plannedTrays', 'status', 'saleEntryId', 'cancelReason', 'remarks'] },
  { slice: 'saleLogs', title: 'Shed dispatch logs', columns: ['date', 'shedId', 'batchId', 'grade', 'trays', 'status', 'workerName', 'acknowledgedBy', 'remarks'] },
  { slice: 'feedStock', title: 'Feed purchases & movements', columns: ['date', 'kind', 'ingredient', 'qtyKg', 'ratePerKg', 'supplier', 'purchaseRef', 'shedId', 'batchId', 'remarks'] },
  { slice: 'medicineStock', title: 'Medicine stock & usage', columns: ['date', 'kind', 'medicineId', 'qty', 'ratePerUnit', 'amount', 'supplier', 'purchaseRef', 'lotNumber', 'expiryDate', 'batchId', 'shedId', 'reason', 'remarks'] },
  { slice: 'eggs', title: 'Egg collections', columns: ['date', 'batchId', 'shedId', 'goodTrays', 'brokenTrays', 'doubleTrays', 'smallTrays', 'workerName', 'remarks'] },
  { slice: 'mortality', title: 'Mortality', columns: ['date', 'batchId', 'shedId', 'count', 'workerName', 'remarks'] },
  { slice: 'feed', title: 'Feed consumption', columns: ['date', 'batchId', 'shedId', 'tonnes', 'formulaName', 'formulaVersion', 'remarks'] },
];

export const csvFileName = (companyId: string, slice: string, iso: string) =>
  `amrut-${companyId}-${slice}-${iso.slice(0, 10)}.csv`;
