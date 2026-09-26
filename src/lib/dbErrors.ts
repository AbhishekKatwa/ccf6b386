/**
 * dbErrors.ts — the one place a database refusal becomes a sentence the farm can read.
 *
 * Postgres answers a rejected write in constraint names, table names and SQL verbs
 * (`duplicate key value violates unique constraint "traders_company_id_name_key"`). Screens
 * answer a person in one line of toast and, at best, one instruction. This file is the
 * translation between the two: every seam that holds a Supabase/Postgres error hands it here,
 * and gets back what happened, what to do next, and whether trying again is safe.
 *
 * It is a presenter, not an authority. Nothing in it decides whether an action is allowed —
 * RLS, membership and the role matrix still do that, and refuse exactly as loudly as before.
 * Only the sentence changes.
 *
 * The technical sentence is kept on the normalized error and logged in development, so a bug
 * stays debuggable without becoming the user's problem. Constraint meanings are mapped only
 * where the schema actually states them (db/supabase/*.sql); anything unrecognised gets a safe
 * line rather than a guess.
 */

export type DatabaseErrorKind =
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'not_null_violation'
  | 'check_violation'
  | 'permission_denied'
  | 'session_expired'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'unknown';

export interface DatabaseErrorContext {
  /** What the app was trying to do, in the user's words: 'save the egg sale'. */
  operation?: string;
  /** The table the write targeted, when the caller knows it. */
  table?: string;
  /** A person waiting on an answer, or the queue working behind them (§21). */
  origin?: 'foreground' | 'background';
}

/** §4 — the shape the whole app shares once a database error has been read. */
export interface NormalizedDatabaseError {
  kind: DatabaseErrorKind;
  /** Postgres SQLSTATE or PostgREST code; '' when the error carried none. */
  code: string;
  /** The constraint the database named, if it named one. Never shown to a user. */
  constraint: string;
  table: string;
  /** The column the error names, when it names one. */
  column: string;
  /** What the database said, for the log and the queue. */
  technicalMessage: string;
  /** The line the user sees. */
  userMessage: string;
  /** What the user should do about it; '' when there is nothing useful to say. */
  actionMessage: string;
  /** Trying again can fix this without the user changing anything. */
  retryable: boolean;
  /** The user must change something (input, selection, permissions) first. */
  requiresUserAction: boolean;
}

/** The error the sync layer throws: normalized on the way out, technical on the wire. */
export class DatabaseError extends Error {
  readonly normalized: NormalizedDatabaseError;
  readonly original: unknown;

  constructor(normalized: NormalizedDatabaseError, original?: unknown) {
    super(normalized.technicalMessage);
    this.name = 'DatabaseError';
    this.normalized = normalized;
    this.original = original;
  }
}

/* ============================== reading an unknown shape ==============================
 * A PostgREST error, a fetch TypeError, an AbortError and a bare string all arrive here. None of
 * them is guaranteed to carry the fields the others do, so every read is guarded — an error
 * handler that throws is the worst kind of error handler. */

function textOf(error: unknown, key: string): string {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return '';
  const v = (error as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function statusOf(error: unknown): number {
  const raw = textOf(error, 'status');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return textOf(error, 'message');
}

const SQLSTATE: Record<string, DatabaseErrorKind> = {
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23502': 'not_null_violation',
  '23514': 'check_violation',
  '42501': 'permission_denied',
};

const NETWORK = /failed to fetch|networkerror|network request|load (?:the )?failed|fetch failed|econn|enotfound|econnrefused|socket hang ?up|client is offline|offline/i;
const TIMEOUT = /timeout|timed out|deadline exceeded|etimedout/i;
const ABORTED = /aborterror|aborted by the user|signal driven an abort|request was cancelled/i;
const DENIED = /row-level security|insufficient privilege|permission denied|new row violates|not authorized to access|you do not have permission/i;
const SESSION = /jwt expired|invalid claim|jwt not supported|jwSError|token requires audience|invalid api key|session has expired/i;
const NEVER_SERIALIZED = /could not serialize|deadlock|40001|40p01/i;

/** The quoted identifier a Postgres sentence names — a constraint, a column, a table. */
function quoted(message: string, lead: string): string {
  const m = new RegExp(`${lead}[^(]*?"([^"]+)"`).exec(message);
  return m ? m[1] : '';
}

/**
 * The first pass: what kind of refusal is this, and what did the database name in it?
 *
 * The code is trusted when it is there; the message is read only when it is not, because
 * PostgREST wraps some refusals in a generic code and a plain `Error` carries no code at all.
 */
export function classifyDatabaseError(
  error: unknown, context: DatabaseErrorContext = {},
): Pick<NormalizedDatabaseError, 'kind' | 'code' | 'constraint' | 'table' | 'column' | 'technicalMessage'> {
  const code = textOf(error, 'code');
  const message = messageOf(error) || 'Unknown database error';
  const name = textOf(error, 'name');
  const status = statusOf(error);
  const kind: DatabaseErrorKind =
    SQLSTATE[code]
    // A transport failure and a refused write look the same to a caller that only checks
    // `error`: the difference is whether trying again can ever work.
    || (NETWORK.test(message) || name === 'TypeError' ? 'network'
      : TIMEOUT.test(message) || status === 408 || status === 504 || code === '08P01' ? 'timeout'
        : name === 'AbortError' || ABORTED.test(message) ? 'aborted'
          : SESSION.test(message) || status === 401 ? 'session_expired'
            : DENIED.test(message) || status === 403 || code?.startsWith('PGRST') && /security|privilege|permission/i.test(message) ? 'permission_denied'
              : /duplicate key|unique constraint|unique violation/i.test(message) ? 'unique_violation'
                : /foreign key/i.test(message) ? 'foreign_key_violation'
                  : /not-null|null value in column/i.test(message) ? 'not_null_violation'
                    : /check constraint/i.test(message) ? 'check_violation'
                      : NEVER_SERIALIZED.test(message) ? 'timeout'
                        : 'unknown');

  return {
    kind,
    code,
    constraint: kind === 'unique_violation' || kind === 'foreign_key_violation' || kind === 'check_violation'
      ? quoted(message, 'constraint')
      : '',
    table: context.table || quoted(message, 'table'),
    column: kind === 'not_null_violation' ? quoted(message, 'column') : '',
    technicalMessage: message,
  };
}

/* ============================== the constraint map ==============================
 * Built off the live schema (`pg_constraint` + the unique indexes, 26-Sep), not off examples:
 * these are the constraints this database actually holds. A name absent from this map gets the
 * safe line below — the schema states no meaning for it, so neither does the app. */

interface UserFacing { userMessage: string; actionMessage: string }

const UNIQUE: Record<string, UserFacing> = {
  traders_company_id_name_key: {
    userMessage: 'This trader already exists.',
    actionMessage: 'Use a different name or update the existing trader.',
  },
  profiles_mobile_key: {
    userMessage: 'This mobile number is already registered.',
    actionMessage: 'Check the existing user before creating another one.',
  },
  profiles_legacy_id_key: {
    userMessage: 'This person is already registered under another account.',
    actionMessage: 'Search the user list before adding them again.',
  },
  company_users_pkey: {
    userMessage: 'This person is already part of that company.',
    actionMessage: 'Change their existing access instead of adding them again.',
  },
  batches_company_id_code_key: {
    userMessage: 'That batch code is already used in this company.',
    actionMessage: 'Enter a different batch code.',
  },
  batch_assignments_batch_id_user_id_role_key: {
    userMessage: 'This person already has that access to the batch.',
    actionMessage: 'They are already listed on this batch.',
  },
  feed_formulas_family_id_version_key: {
    userMessage: 'That formula version already exists.',
    actionMessage: 'Save it as a new version instead.',
  },
  feed_round_logs_company_id_shed_id_date_round_key: {
    userMessage: 'That feed round is already recorded for this shed on this date.',
    actionMessage: 'Edit the existing round instead of adding another.',
  },
  cash_counts_company_id_date_key: {
    userMessage: 'A cash count for that date is already recorded.',
    actionMessage: 'Edit the existing count instead of adding another.',
  },
  medicine_items_company_id_name_category_key: {
    userMessage: 'This medicine or vaccine is already in the store.',
    actionMessage: 'Open the existing item and update it.',
  },
  medicine_stock_company_id_vaccination_id_key: {
    userMessage: 'This stock entry is already linked to that vaccination.',
    actionMessage: 'Edit the existing entry instead of adding another.',
  },
  feed_stock_purchase_ref_uq: {
    userMessage: 'This purchase reference has already been used.',
    actionMessage: 'Enter a different reference, or edit the receipt that already holds it.',
  },
  medicine_stock_purchase_ref_uq: {
    userMessage: 'This purchase reference has already been used.',
    actionMessage: 'Enter a different reference, or edit the receipt that already holds it.',
  },
  ingredients_pkey: {
    userMessage: 'This ingredient is already in the catalogue.',
    actionMessage: 'Choose it from the list instead of adding it again.',
  },
  receipt_counters_pkey: {
    userMessage: 'That receipt number is already used.',
    actionMessage: 'Please enter a different receipt number.',
  },
};

/** A constraint whose name says what it guards, said in the user's words. */
const CONSTRAINT_PATTERNS: ({ test: RegExp } & UserFacing)[] = [
  // Any receipt-number uniqueness the schema carries or later adds: the name says `receipt`.
  {
    test: /receipt/i,
    userMessage: 'Receipt number already used.',
    actionMessage: 'Please enter a different receipt number.',
  },
  { test: /purchase_ref/i, userMessage: 'This purchase reference has already been used.', actionMessage: 'Enter a different reference.' },
  { test: /_mobile|mobile_/i, userMessage: 'This mobile number is already registered.', actionMessage: 'Check the existing user before creating another one.' },
  { test: /_code|code_/i, userMessage: 'That code is already used in this company.', actionMessage: 'Please enter a different code.' },
  // A primary-key clash means the row is already there: nothing the user typed is wrong.
  { test: /_pkey$/, userMessage: 'This record already exists.', actionMessage: 'Please refresh the page to see the current data.' },
];

/** The person a foreign key points at, for the tables that name people at all. */
const PERSON_COLUMNS = new Set([
  'user_id', 'assigned_by', 'authorized_by', 'by_user_id', 'cancelled_by', 'cash_handled_by',
  'closed_by', 'completed_by', 'created_by', 'handled_by', 'from_user_id', 'to_user_id', 'used_by',
]);

const COLUMN_LABELS: Record<string, string> = {
  assigned_by: 'person', authorized_by: 'person', by_user_id: 'person', cancelled_by: 'person',
  cash_handled_by: 'person', closed_by: 'person', completed_by: 'person', created_by: 'person',
  handled_by: 'person', from_user_id: 'person', to_user_id: 'person', used_by: 'person', user_id: 'person',
  batch_id: 'batch', company_id: 'company', consumption_id: 'feed record', farm_id: 'farm',
  formula_id: 'formula', medicine_id: 'medicine or vaccine', ref_id: 'record', sale_entry_id: 'sale entry',
  shed_id: 'shed', template_id: 'vaccination template', trader_id: 'trader', vaccination_id: 'vaccination',
};

/** Column names a NOT NULL or FK error can carry, said the way the form says them. */
const FIELD_LABELS: Record<string, string> = {
  action: 'the action', amount: 'the amount', at: 'the time', batch_id: 'the batch',
  bird_type: 'the bird type', breed: 'the breed', by_user_id: 'the person who recorded it',
  category: 'the category', code: 'the batch code', column: 'the entry', company_id: 'the company',
  count: 'the count', date: 'the date', double_trays: 'the double tray count', entity: 'the record',
  entity_id: 'the record it belongs to', farm_id: 'the farm', final_birds: 'the closing bird count',
  good_trays: 'the good tray count', grade: 'the grade', ingredient: 'the ingredient',
  kind: 'the type', kg: 'the quantity', kg_per_tonne: 'the quantity per tonne', location: 'the location',
  message: 'the message', mobile: 'the mobile number', name: 'the name', planned_trays: 'the planned trays',
  position: 'the line', physical_cash: 'the physical cash', reason: 'the reason', relative_day: 'the day',
  reminder_days_before: 'the reminder days', role: 'the role', round: 'the round', shed_id: 'the shed',
  small_trays: 'the small tray count', start_date: 'the start date', status: 'the status',
  title: 'the title', tonnes: 'the quantity in tonnes', trays: 'the tray count',
  vaccine_name: 'the vaccine name', broken_trays: 'the broken tray count',
  medicine_id: 'the medicine or vaccine',
  vaccination_id: 'the vaccination', sale_entry_id: 'the sale entry', template_id: 'the template',
  consumption_id: 'the feed record', formula_id: 'the formula', assigned_by: 'the person who assigned it',
  closed_by: 'the person who closed it', cash_handled_by: 'the cash handler', advance: 'the advance',
  cash: 'the cash amount', phonepe: 'the PhonePe amount', labor_charge: 'the labour charge',
  rate_good: 'the good-egg rate', rate_broken: 'the broken-egg rate', rate_double: 'the double-egg rate',
  rate_small: 'the small-egg rate', low_stock_threshold: 'the low stock level', unit: 'the unit',
};

/**
 * Check constraints whose meaning the schema states, in business words. The name is the
 * database's; the sentence is the app's. Anything not listed here is not guessed at.
 */
const CHECKS: Record<string, UserFacing> = {
  batches_initial_birds_check: { userMessage: 'Place at least one bird.', actionMessage: 'Enter how many birds came in with this batch.' },
  batch_closings_final_birds_check: { userMessage: 'The closing bird count cannot be negative.', actionMessage: 'Enter the birds left in the shed.' },
  egg_wastages_not_empty: { userMessage: 'Enter at least one wasted tray.', actionMessage: 'A wastage with no trays in it has nothing to record.' },
  egg_collections_good_trays_check: { userMessage: 'Tray counts cannot be negative.', actionMessage: 'Please check the tray counts and try again.' },
  egg_collections_broken_trays_check: { userMessage: 'Tray counts cannot be negative.', actionMessage: 'Please check the tray counts and try again.' },
  egg_collections_double_trays_check: { userMessage: 'Tray counts cannot be negative.', actionMessage: 'Please check the tray counts and try again.' },
  egg_collections_small_trays_check: { userMessage: 'Tray counts cannot be negative.', actionMessage: 'Please check the tray counts and try again.' },
  sale_entry_lines_check: { userMessage: 'Enter at least one tray in the load.', actionMessage: 'A load with no trays in it cannot be booked.' },
  sale_entries_amount_check: { userMessage: 'Money values cannot be negative.', actionMessage: 'Please check the amounts entered and try again.' },
  sale_entries_cash_check: { userMessage: 'Money values cannot be negative.', actionMessage: 'Please check the cash received and try again.' },
  sale_entries_phonepe_check: { userMessage: 'Money values cannot be negative.', actionMessage: 'Please check the online amount and try again.' },
  sale_entries_advance_check: { userMessage: 'Money values cannot be negative.', actionMessage: 'Please check the advance and try again.' },
  sale_entries_labor_charge_check: { userMessage: 'Money values cannot be negative.', actionMessage: 'Please check the labour charge and try again.' },
  feed_consumption_tonnes_check: { userMessage: 'Quantity must be greater than zero.', actionMessage: 'Enter how much feed the shed actually took.' },
  feed_consumption_deductions_kg_check: { userMessage: 'Quantity cannot be negative.', actionMessage: 'Please check the feed used and try again.' },
  feed_formula_items_kg_per_tonne_check: { userMessage: 'Quantity cannot be negative.', actionMessage: 'Please check the ingredient mix and try again.' },
  feed_stock_qty_kg_check: { userMessage: 'Quantity must be greater than zero.', actionMessage: 'A stock entry of zero kg records nothing.' },
  feed_stock_rate_per_kg_check: { userMessage: 'Rate cannot be negative.', actionMessage: 'Please check the rate per kg and try again.' },
  medicine_stock_qty_check: { userMessage: 'Quantity must be greater than zero.', actionMessage: 'A stock entry of zero units records nothing.' },
  medicine_stock_amount_check: { userMessage: 'Amount cannot be negative.', actionMessage: 'Please check the amount and try again.' },
  medicine_stock_rate_per_unit_check: { userMessage: 'Rate cannot be negative.', actionMessage: 'Please check the rate per unit and try again.' },
  medicine_items_low_stock_threshold_check: { userMessage: 'The low stock level cannot be negative.', actionMessage: 'Enter the quantity that should raise an alert.' },
  mortality_count_check: { userMessage: 'The count cannot be negative.', actionMessage: 'Enter how many birds died.' },
  sheds_capacity_check: { userMessage: 'Capacity must be greater than zero.', actionMessage: 'Enter how many birds this shed holds.' },
  sale_logs_trays_check: { userMessage: 'Quantity must be greater than zero.', actionMessage: 'Enter the trays that left the shed.' },
  egg_sale_bookings_planned_trays_check: { userMessage: 'Quantity must be greater than zero.', actionMessage: 'Enter the trays planned for this sale.' },
  cash_handovers_amount_check: { userMessage: 'Amount must be greater than zero.', actionMessage: 'Enter the money handed over.' },
  cash_handovers_check: { userMessage: 'The two people in a handover must be different.', actionMessage: 'Choose who receives the cash.' },
  cash_counts_physical_cash_check: { userMessage: 'The counted cash cannot be negative.', actionMessage: 'Enter what was actually in the box.' },
  finance_txns_amount_check: { userMessage: 'Amount cannot be negative.', actionMessage: 'Enter the amount for this entry.' },
  vaccinations_check: { userMessage: 'Enter the date the vaccine was given.', actionMessage: 'A completed vaccination needs its date.' },
  vaccinations_check1: { userMessage: 'Enter a reason for cancelling.', actionMessage: 'The reason stays on the record.' },
  vaccinations_relative_day_check: { userMessage: 'The vaccination day cannot be negative.', actionMessage: 'Enter the number of days after placement.' },
  vaccination_template_items_relative_day_check: { userMessage: 'The vaccination day cannot be negative.', actionMessage: 'Enter the number of days after placement.' },
  egg_sale_bookings_check: { userMessage: 'This plan needs its sale before it can be marked fulfilled.', actionMessage: 'Record the sale entry that closes it.' },
  egg_sale_bookings_check1: { userMessage: 'Enter a reason for cancelling.', actionMessage: 'The reason stays on the plan.' },
  sale_logs_check: { userMessage: 'An acknowledged dispatch needs its acknowledgement time.', actionMessage: 'Please acknowledge the dispatch again.' },
  feed_round_logs_check: { userMessage: 'Enter the time the feed was given.', actionMessage: 'A round marked as given needs its clock time.' },
  feed_formulas_version_check: { userMessage: 'The formula version is invalid.', actionMessage: 'Please reopen the formula and save again.' },
  trader_txns_trays_check: { userMessage: 'The tray count cannot be negative.', actionMessage: 'Please check the trays and try again.' },
  trader_txns_rate_check: { userMessage: 'The rate cannot be negative.', actionMessage: 'Please check the rate and try again.' },
};

/** A column the schema guards with `length(btrim(x)) > 0` really is required. */
const REQUIRED_BY_CHECK = /_name_check$|_title_check$|_category_check$|_ingredient_check$|_code_check$|_vaccine_name_check$/;

const GENERIC: UserFacing = {
  userMessage: 'Something went wrong.',
  actionMessage: "We couldn't complete this action. Please try again.",
};

const SAFE_RECORD: UserFacing = {
  userMessage: 'Could not save this record.',
  actionMessage: 'Please check the entered information and try again.',
};

function labelFor(column: string): string {
  if (!column) return '';
  return FIELD_LABELS[column] ?? COLUMN_LABELS[column]?.replace(/^the /, '') ?? '';
}

/** `sale_entries_trader_id_fkey` on `sale_entries` → `trader_id`: the auto-name is table + column. */
function columnOfForeignKey(constraint: string, table: string): string {
  const body = constraint.replace(/_fkey$/, '');
  if (table && body.startsWith(`${table}_`)) return body.slice(table.length + 1);
  const m = /_((?:[a-z]+_)*id)$/.exec(body);
  return m ? m[1] : '';
}

/** §2 — the second half of the pipeline: a classified error, and this user's two lines. */
export function createUserFacingError(
  classified: Pick<NormalizedDatabaseError, 'kind' | 'code' | 'constraint' | 'table' | 'column'>,
  context: DatabaseErrorContext = {},
): Pick<NormalizedDatabaseError, 'userMessage' | 'actionMessage' | 'retryable' | 'requiresUserAction'> {
  const refused = (m: string, a: string, userAction = true): ReturnType<typeof createUserFacingError> =>
    ({ userMessage: m, actionMessage: a, retryable: false, requiresUserAction: userAction });
  /** §19 — trying again is the answer, so long as nothing but the wire has changed. */
  const retry = (m: string, a: string): ReturnType<typeof createUserFacingError> =>
    ({ userMessage: m, actionMessage: a, retryable: true, requiresUserAction: false });

  switch (classified.kind) {
    case 'unique_violation': {
      const named = UNIQUE[classified.constraint];
      if (named) return refused(named.userMessage, named.actionMessage);
      const pattern = CONSTRAINT_PATTERNS.find(p => p.test.test(classified.constraint));
      if (pattern) return refused(pattern.userMessage, pattern.actionMessage);
      // An index the map does not know: the record is already there, which is all we can say.
      return refused(SAFE_RECORD.userMessage, 'This entry seems to already exist. Please check the list before adding it again.');
    }

    case 'foreign_key_violation': {
      const column = columnOfForeignKey(classified.constraint, classified.table);
      const target = PERSON_COLUMNS.has(column) ? 'person' : COLUMN_LABELS[column] ?? '';
      // With no column to read the pointer off, all the database actually said is: this row has
      // no place here. Say that, and say nothing about whose place it is (§11).
      if (!target || column === 'company_id') {
        return refused('This record is not available in your active company.',
          'Please choose another record, or switch to the company that holds it.');
      }
      if (target === 'person') {
        return refused('That person is not available.',
          'Their account may have been removed. Please choose another person.');
      }
      return refused(`${cap(target)} not available.`,
        `The selected ${target} may have been removed, or is no longer available in your active company. Please refresh and choose it again.`);
    }

    case 'not_null_violation': {
      const label = labelFor(classified.column);
      if (!label) return refused('Required information is missing.', 'Please complete the required fields and try again.');
      return refused(`${cap(label.replace(/^the /, ''))} is required.`, 'Please complete the required fields and try again.');
    }

    case 'check_violation': {
      const named = CHECKS[classified.constraint];
      if (named) return refused(named.userMessage, named.actionMessage);
      if (REQUIRED_BY_CHECK.test(classified.constraint)) {
        return refused('A required value is empty.', 'Please fill it in and try again.');
      }
      return refused(SAFE_RECORD.userMessage, 'Please check the entered value and try again.');
    }

    /* §10 — the refusal stands; only its sentence changes. This handler authorises nothing. */
    case 'permission_denied':
      return refused('Access denied.', "You don't have permission to perform this action.");

    case 'session_expired':
      return refused('Your session has expired.', 'Please sign in again to continue.');

    /* §12 — the queue really does still hold the change, and nothing says it was saved twice. */
    case 'network':
      return retry('Connection problem.',
        'Your change could not be synced. Check your internet connection and try again.');

    case 'timeout':
      return retry('The server is taking too long to respond.', 'Please try again.');

    case 'aborted':
      return retry('The request was cancelled.', 'Please try again.');

    default: {
      // §16: an operation gives the generic line its own words; without one it stays generic.
      if (context.operation) return retry(`Could not ${context.operation}.`, 'Please try again.');
      return retry(GENERIC.userMessage, GENERIC.actionMessage);
    }
  }
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * §2 — the whole pipeline. Safe on anything: null, a string, a half-built object, or an error
 * this file already normalized (which comes back unchanged, so one failure never gets
 * re-worded as it travels from the wire to the badge).
 */
export function normalizeDatabaseError(error: unknown, context: DatabaseErrorContext = {}): NormalizedDatabaseError {
  if (error instanceof DatabaseError) return error.normalized;
  const classified = classifyDatabaseError(error, context);
  const face = createUserFacingError(classified, context);
  return { ...classified, ...face };
}

/** One line for the existing `Result.error` / toast string: what happened, then what to do. */
export function describeDatabaseError(error: unknown, context: DatabaseErrorContext = {}): string {
  const n = normalizeDatabaseError(error, context);
  return n.actionMessage ? `${n.userMessage} ${n.actionMessage}` : n.userMessage;
}

/** The queue's own record of a refusal: technical, so the badge and the logs can still say why. */
export function technicalLineOf(n: NormalizedDatabaseError, extra = ''): string {
  return `${n.table || 'database'}${extra ? ` ${extra}` : ''}: ${n.technicalMessage}`;
}

/**
 * §15/§23 — the database's sentence belongs in the console, not the toast. The original object is
 * kept so a developer can see the details and hint Postgres sent; nothing here is written to the
 * UI, and the payload carries only what the error itself already held.
 */
export function logDatabaseError(n: NormalizedDatabaseError, original?: unknown): void {
  if (!import.meta.env?.DEV) return;
  console.error('[amrut] database error', {
    normalizedError: n,
    originalError: original ?? null,
    at: new Date().toISOString(),
  });
}

/** A refusal the app raised itself (not the database) still gets the same shape. */
export function appNotice(userMessage: string, actionMessage = ''): NormalizedDatabaseError {
  return {
    kind: 'unknown', code: '', constraint: '', table: '', column: '',
    technicalMessage: actionMessage ? `${userMessage} ${actionMessage}` : userMessage,
    userMessage, actionMessage, retryable: false, requiresUserAction: true,
  };
}

/** Human words for the tables the sync queue names in its own notices — plurals, so a count
 *  can sit straight in front of them. */
export const TABLE_LABELS: Record<string, string> = {
  audit: 'audit entries', batch_assignments: 'batch access rows', batch_closings: 'batch closings',
  batches: 'batches', cash_counts: 'cash counts', cash_handovers: 'cash handovers',
  companies: 'companies', company_users: 'membership rows', egg_collections: 'egg collections',
  egg_sale_bookings: 'sale plans', egg_wastages: 'egg wastages', farms: 'farms',
  feed_consumption: 'feed records', feed_consumption_deductions: 'feed usage rows',
  feed_formula_items: 'formula lines', feed_formulas: 'formulas', feed_round_logs: 'feed rounds',
  feed_stock: 'godown stock entries', finance_txns: 'finance entries', ingredients: 'ingredients',
  medicine_items: 'medicines', medicine_stock: 'medicine stock entries', mortality: 'mortality entries',
  profiles: 'people', receipt_counters: 'receipt counters', sale_entries: 'sale entries',
  sale_entry_lines: 'sale lines', sale_logs: 'dispatch logs', sheds: 'sheds',
  support_messages: 'support messages', tasks: 'tasks', trader_txns: 'trader ledger rows',
  traders: 'traders', vaccination_template_items: 'vaccination schedule lines',
  vaccination_templates: 'vaccination templates', vaccinations: 'vaccinations',
};

export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? 'records';
}
