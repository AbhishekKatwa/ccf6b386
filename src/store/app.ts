import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AuditAction, AuditEntry, Batch, BatchAssignment, BatchClosing, CashCount, CashHandover, Company,
  EggCollection, EggGradeCounts, Farm, FarmTask, FeedConsumption,
  EggSaleBooking, EggSaleBookingDraft,
  FeedFormula, FeedFormulaItem, FeedRoundLog, FeedStockEntry, FinanceTxn, FormulaInput, EggGrade,
  MortalityEntry, NewBatchInput, OpeningEntry, PaymentMethod, PermissionKey, PaymentSplit, PermissionSet, Role,
  EggWastage, EggWastageDraft,
  SaleEntry, SaleEntryDraft, SaleEntryLine, SaleLog, Session, Shed, SupportMessage, Trader, TraderTxn, User,
  BirdType, VaccinationDraft, VaccinationItem, VaccinationStatus, VaccinationTemplate, VaccinationTemplateItem,
  MedicineItem, MedicineItemDraft, MedicineReceiptDraft, MedicineStockEntry, MedicineUsageDraft, MedicineAdjustmentDraft,
} from '@/types';
import { EGG_GRADE_LABELS, EGG_GRADES, EGGS_PER_TRAY, EMPTY_GRADE_COUNTS, FEED_INGREDIENTS, FEED_ROUNDS, MEDICINE_UNITS } from '@/types';
import { DEFAULT_ROLE_PERMISSIONS, effectiveCan, roleReadable } from '@/lib/permissions';
import { personBlock, roleChangeError } from '@/lib/team';
import { generateOtp, hashPassword, isOtpValid, normalizeMobile, validateUserDraft, verifyPassword } from '@/lib/auth';
import { accountabilityError, cashPositionOf, openingEntryError } from '@/lib/cashflow';
import { companyAccessOf, contextIntact, isPlatformAdmin, operableCompanyId, operableCompanies, type CompanyAccess } from '@/lib/companyAccess';
import { runtime } from '@/lib/runtime';
import { FEED_PURCHASE_CATEGORY, MEDICINE_PURCHASE_CATEGORY } from '@/lib/accounting';
import {
  batchOfShedOn, eggStockByGrade, entryAmount, entryTrays, ensureWalkInTraders, formulaDeduction, formulaForDate,
  formulaTotalKg, formulaUsage, gradeTotal, linesByGrade, loadBilled, loadCredit, loadPaid, ratePerEgg, saleOutstanding,
  traderBalance, walkInTrader,
} from '@/lib/calc';
import { daysBetween, fmtIN, fmtMoney, newUuid, nowISO, todayISO, uid } from '@/lib/format';
import { nextPurchaseRef, purchasePosition, purchaseReceiptHighWater } from '@/lib/purchasing';
import { isUuid } from '@/services/supabase/rows';
import { asLedgerRow, medicineBasis, medicineReceiptHighWater, nextMedicineRef } from '@/lib/medicines';
import { receiptHighWater, receiptNo, type ReceiptScope } from '@/lib/receipts';
import { allocateReceiptNo } from '@/services/supabase/receipts';
import { COLUMNS, PRIMARY_KEYS } from '@/services/supabase/columns.gen';
import { SLICES, rowId, type SliceDef } from '@/services/supabase/registry';
import {
  NOT_COMPANY_DATA, SLICE_LABELS, buildBackup, validateBackup,
  type BackupFile, type BackupProfile, type RestorePlan, type Validation,
} from '@/lib/backup';
import { bookingError, PLANNER_HORIZON, plannerWindow } from '@/lib/planner';
import {
  seedAssignments, seedAudit, seedBatches, seedCompanies,
  seedEggs, seedFarms, seedFeed, seedFeedFormulas,
  seedFeedRounds, seedFeedStock, seedFinance, seedMedicineItems, seedMedicineStock, seedMortality, seedSaleEntries, seedSaleLogs, seedSheds, seedTasks,
  seedTraderTxns, seedTraders, seedUsers, seedVaccinations, seedVaccinationTemplates,
} from '@/data/seed';

/**
 * A notice reads as a title and, when there is something to do about it, one line under it —
 * the shape every normalized database error already carries (§17).
 */
interface Toast { id: string; kind: 'success' | 'error' | 'info'; message: string; detail?: string }
/** How long a toast stands before it removes itself. The host draws its progress line from this. */
export const TOAST_TTL_MS = 3200;
/** What every guarded write action answers with: the row landed, or the reason it did not. */
export type Result = { ok: boolean; error?: string };
/** Formula writes report the saved version id so the UI can route to it. */
type FormulaResult = Result & { id?: string; version?: number };

/**
 * What it takes to state that money moved: the amount, when, by which channel, and the
 * people whose hands it went through. Nothing here says what the money was for — the
 * purchase or sale being settled carries that, and is never re-typed on the payment.
 */
export type PaymentRecording = {
  amount: number;
  date: string;
  paymentMethod: PaymentMethod;
  time?: string;
  /** Our person who handled the money — the one who paid out, or took it in. */
  handledById?: string;
  /** The other side's person, for cash handed over in person. */
  handedTo?: string;
  authorizedById?: string;
  /** Cash receipt number, UTR, cheque number: the proof on paper. */
  reference?: string;
  remarks?: string;
};

export type PurchasePaymentInput = PaymentRecording & { purchaseId: string };
export type SalePaymentInput = PaymentRecording & { saleId: string };

/**
 * What completing a vaccination supplies. The scheduled date is never among these:
 * a late dose is recorded as late, with both days standing on the record (§7, §8).
 *
 * The two medicine fields are what the dose came out of. Giving a dose from the central
 * inventory is what takes stock off the shelf and charges the flock, so a completion that
 * names its product and quantity writes exactly one linked usage (§11) — and one only,
 * because the same dose can never be deducted twice (§12).
 *
 * labourAmount and vaccinatorAmount are FinanceTxn EXPENSE rows for the human cost of
 * administering the vaccine. They are separate from the medicine stock cost and appear
 * in the Finance ledger under 'Vaccine Labour' and 'Vaccinator' categories respectively.
 */
export type VaccinationCompletion = {
  completedDate: string;
  completedBy: string;
  actualDose?: string;
  completionRemarks?: string;
  medicineId?: string;
  medicineQty?: number;
  /** Direct vaccine cost when the dose was not drawn from the medicine store. */
  vaccineAmount?: number;
  /** Labour cost for the vaccination team (category: 'Vaccine Labour'). */
  labourAmount?: number;
  /** External vaccinator charges (category: 'Vaccinator'). */
  vaccinatorAmount?: number;
  /** Who the labour/vaccinator was paid to (counterparty on those Finance rows). */
  labourCounterparty?: string;
};

/** A schedule template as the Owner edits it; company, id and audit fields are derived. */
export type VaccinationTemplateDraft = {
  name: string;
  birdType?: BirdType;
  items: VaccinationTemplateItem[];
};

interface AppState {
  companies: Company[];
  users: User[];
  farms: Farm[];
  sheds: Shed[];
  batches: Batch[];
  assignments: BatchAssignment[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  feedRounds: FeedRoundLog[];
  eggs: EggCollection[];
  saleLogs: SaleLog[];
  saleEntries: SaleEntry[];
  /** Promised trays for the days ahead — a plan, never a ledger row. */
  eggSaleBookings: EggSaleBooking[];
  /** Trays thrown away, per grade. A stock event with no money in it. */
  eggWastages: EggWastage[];
  feedStock: FeedStockEntry[];
  /** The medicine & vaccine catalogue. Stock rows point at these ids, never at a typed name. */
  medicineItems: MedicineItem[];
  /** Central medicine ledger — the only record of what stands, what it cost and where it went. */
  medicineStock: MedicineStockEntry[];
  feedFormulas: FeedFormula[];
  finance: FinanceTxn[];
  traders: Trader[];
  traderTxns: TraderTxn[];
  tasks: FarmTask[];
  /** Each batch's own vaccination schedule — copied from a template at placement, then independent. */
  vaccinations: VaccinationItem[];
  vaccinationTemplates: VaccinationTemplate[];
  /** Global feed-ingredient catalogue, shared across every company. */
  ingredientCatalog: string[];
  /** Support messages from any user, platform-wide — read by the Master Admin panel. */
  supportMessages: SupportMessage[];
  /** Cash passed between people inside a company. Moves possession, never money. */
  cashHandovers: CashHandover[];
  /** Physical cash counts, kept beside — never folded into — the ledger's own position. */
  cashCounts: CashCount[];
  audit: AuditEntry[];
  session: Session | null;
  /** Why the working company context was taken away, once. Derived again on every read, so
   *  it is a notice rather than a fact — and it is never persisted. */
  accessNotice: CompanyAccess | null;
  online: boolean;
  toasts: Toast[];

  /* auth */
  signInWithPassword: (mobile: string, password: string) => Result;
  requestOtp: (mobile: string) => { ok: boolean; error?: string; code?: string };
  signInWithOtp: (mobile: string, code: string) => Result;
  selectCompany: (companyId: string) => Result;
  signOut: () => void;
  /** Re-read the three things a cached save cannot be trusted for — the person still exists,
   *  still holds this membership, and this company still stands — and drop the context if not.
   *  Run after every pull, so a deactivation made elsewhere reaches a browser that is open. */
  revalidateCompanyAccess: () => void;
  clearAccessNotice: () => void;

  setOnline: (v: boolean) => void;
  pushToast: (kind: Toast['kind'], message: string, detail?: string) => void;
  dismissToast: (id: string) => void;

  /* master admin — companies & users */
  addCompany: (name: string) => Company;
  toggleCompanyActive: (id: string) => void;
  createUser: (input: {
    name: string; mobile: string; password: string; role: Role; companyIds: string[];
    /** Supabase mode pre-mints the id (a uuid, because profiles.id IS auth.users.id). */
    id?: string;
  }) => { ok: boolean; error?: string; user?: User };
  /** The platform roster's on/off switch. Refused for the account this session signed in with. */
  toggleUserActive: (id: string) => Result;
  updateUserCompanies: (id: string, companyIds: string[]) => void;
  /** Change one person's role inside the active company. Guarded, audited, never self-applied. */
  updateUserRole: (id: string, role: Role) => Result;
  /** Switch a person's access to this company off or back on. Their records stand either way. */
  setUserActive: (id: string, active: boolean) => Result;
  /** Whether this session may change this person, and which company the change belongs to. */
  personOf: (id: string) => { error: string } | { user: User; companyId: string };

  /* company structure */
  addFarm: (f: Omit<Farm, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Farm | null;
  updateFarm: (id: string, patch: Partial<Farm>) => void;
  addShed: (s: Omit<Shed, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Shed | null;
  updateShed: (id: string, patch: Partial<Shed>) => void;
  /** Remove a shed. The database refuses while a batch points at it, so the store does too. */
  deleteShed: (id: string) => Result;

  /**
   * Place a batch, optionally with the vaccination schedule it starts on. The schedule is
   * stored as this batch's own rows, so editing a template afterwards never reaches back
   * into a placed flock (§1).
   */
  addBatch: (input: NewBatchInput, schedule?: VaccinationDraft[], opening?: OpeningEntry[]) => Result;
  nextBatchCode: (shedId: string) => string;
  updateBatch: (id: string, patch: Partial<Batch>) => void;
  setBatchFeedIntake: (id: string, tonnesPerDay: number | null) => Result;
  closeBatch: (batchId: string, closing: Omit<BatchClosing, 'closedBy' | 'closedAt'>) => Result;

  assignUser: (input: {
    batchId: string; userId: string; role: Role;
    perms?: Pick<PermissionSet, 'create' | 'update' | 'delete'>;
    comments?: string;
  }) => Result;
  revokeAssignment: (id: string) => void;

  /* vaccination schedule — the batch's own plan, complete it / move it / cancel it */
  addVaccination: (input: VaccinationDraft & { batchId: string }) => Result & { id?: string };
  /** Move or correct an unfinished item. A date change is an audited reschedule, with a reason (§9). */
  updateVaccination: (id: string, patch: Partial<VaccinationDraft>, reason?: string) => Result;
  /** Record the dose as given. The scheduled date is never overwritten (§7, §8). */
  completeVaccination: (id: string, input: VaccinationCompletion) => Result & { expense?: number | null; usageId?: string };
  /** Cancel leaves the record standing with its reason — history is never deleted (§10). */
  cancelVaccination: (id: string, reason: string) => Result;

  /* vaccination templates — a starting point the Owner controls, never a live link */
  addVaccinationTemplate: (input: VaccinationTemplateDraft) => Result & { id?: string };
  updateVaccinationTemplate: (id: string, input: VaccinationTemplateDraft) => Result;
  setVaccinationTemplateActive: (id: string, active: boolean) => Result;

  /* daily operations */
  addMortality: (m: Omit<MortalityEntry, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  updateMortality: (id: string, patch: Pick<MortalityEntry, 'count' | 'remarks' | 'workerName'>) => Result;
  addEggCollection: (e: Omit<EggCollection, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  updateEggCollection: (id: string, patch: Pick<EggCollection, 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays' | 'workerName' | 'remarks'>) => Result;
  addFeedConsumption: (f: Omit<FeedConsumption, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>, opts?: { allowNegative?: boolean }) => Result;
  updateFeedConsumption: (id: string, patch: Pick<FeedConsumption, 'tonnes' | 'remarks'>, opts?: { allowNegative?: boolean }) => Result;

  /* feed round log — labor records the clock time feed went to the birds, or a skip */
  logFeedRound: (r: Omit<FeedRoundLog, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  updateFeedRound: (id: string, patch: Partial<Pick<FeedRoundLog, 'status' | 'at' | 'workerName' | 'remarks'>>) => Result;

  /* shed dispatch logs — accounts marks them seen */
  addSaleLog: (l: Omit<SaleLog, 'id' | 'companyId' | 'status' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  acknowledgeSaleLog: (id: string) => Result;

  /* final sale entry — the voucher that moves stock and books the money */
  addSaleEntry: (draft: SaleEntryDraft) => Result & { id?: string };
  updateSaleEntry: (id: string, patch: SaleEntryDraft) => Result;
  deleteSaleEntry: (id: string) => Result;

  /* egg sale planner — promises of trays for the days ahead. Planning a load never
   * moves stock, books income, changes a trader balance or records a payment. */
  addEggSalePlannerBooking: (draft: EggSaleBookingDraft) => Result & { id?: string };
  updateEggSalePlannerBooking: (id: string, patch: EggSaleBookingDraft, reason?: string) => Result;
  cancelEggSalePlannerBooking: (id: string, reason: string) => Result;
  /** Called only after the real sale entry has saved, so a booking can never be
   * marked sold by a form that failed. */
  fulfillEggSalePlannerBooking: (id: string, saleEntryId: string) => Result;

  /* egg wastage — trays thrown away. It takes stock out and books nothing: no finance row,
   * no trader ledger row, no expense. What it costs is stated as lost sale value, as a read. */
  addEggWastage: (draft: EggWastageDraft) => Result & { id?: string };
  updateEggWastage: (id: string, patch: Partial<EggWastageDraft>) => Result;

  /* godown ledger */
  addFeedStock: (e: Omit<FeedStockEntry, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>, opts?: { allowNegative?: boolean; purchaseRef?: string }) => Result;

  /* global feed-ingredient catalogue — any signed-in user may register a new type */
  addIngredientType: (name: string) => Result & { added?: boolean };

  /* medicines & vaccines — the same inventory pattern as the godown, on its own ledger */
  addMedicineItem: (draft: MedicineItemDraft) => Result & { id?: string };
  updateMedicineItem: (id: string, patch: Partial<MedicineItemDraft>) => Result;
  setMedicineItemActive: (id: string, active: boolean) => Result;
  /**
   * Book stock in. This raises inventory and a supplier payable and nothing else: no cash
   * leaves, no expense is written, and the average re-weights only because a rate came with it.
   */
  receiveMedicine: (draft: MedicineReceiptDraft, opts?: { purchaseRef?: string }) => Result & { id?: string; purchaseRef?: string };
  /**
   * Take stock out for a shed. One event, two consequences: inventory falls and the flock
   * carries the cost, valued at the average in force on that day and frozen on the row.
   */
  useMedicine: (draft: MedicineUsageDraft) => Result & { id?: string; expense?: number | null };
  /** A counted correction, signed. It stands in the ledger beside the rows it fixes. */
  adjustMedicine: (draft: MedicineAdjustmentDraft) => Result & { id?: string };

  /* support — persisted so the Master Admin panel can act on them */
  sendSupportMessage: (input: { name: string; mobile?: string; subject?: string; message: string }) => Result;
  markSupportHandled: (id: string) => Result;

  /* feed formulas — per shed, KG per tonne, versioned (never edited in place once used) */
  canManageFormula: (shedId: string) => boolean;
  formulaHasConsumption: (formulaId: string) => boolean;
  createFeedFormula: (input: FormulaInput) => FormulaResult;
  reviseFeedFormula: (id: string, input: FormulaInput) => FormulaResult;
  duplicateFeedFormula: (id: string, input: { name: string; shedId?: string }) => FormulaResult;
  setFormulaActive: (id: string, active: boolean) => Result;

  addFinance: (t: Omit<FinanceTxn, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  /** Maps an existing ledger row to a batch (→ its shed) or to the godown. Amounts never change. */
  assignFinance: (id: string, target: { batchId?: string; godown?: boolean }) => Result;
  /**
   * Correct a ledger row. Every protected figure — amount, method, counterparty and the
   * people who handled the money — writes its own audit entry, so a dispute can be
   * answered with what changed, from what, to what, by whom and why.
   */
  updateFinance: (id: string, patch: Partial<Omit<FinanceTxn, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced' | 'refId'>>, reason?: string) => Result;
  /**
   * The next reference in a receipt series (`CR` cash received, `PUR` feed bought in, `MED`
   * medicine received) for one company and one day, claimed from the database counter so two
   * devices raising a receipt at the same moment cannot be handed the same number. Ask when a
   * record is being raised, or when someone deliberately takes a number for one — never while a
   * screen renders, previews or hydrates. `''` means the counter refused; the reason is already
   * on screen, and nothing may be booked against a made-up number.
   */
  takeReceiptNo: (scope: ReceiptScope, date: string) => Promise<string>;
  /**
   * Pay a godown receipt. This books the money that left and nothing else: the purchase keeps
   * its own quantity and rate, and several payments can settle it one after another.
   */
  recordPurchasePayment: (input: PurchasePaymentInput) => Result;
  /**
   * Receive money against a billed load. Books the money in Finance and the settlement on the
   * trader's ledger — the sale itself is never re-billed.
   */
  recordSalePayment: (input: SalePaymentInput) => Result;
  /** The people whose names may stand behind a money movement in this company. */
  cashPeople: () => User[];
  addCashHandover: (h: Omit<CashHandover, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  /** Record what the drawer actually held. A difference stands on record; the balance is never adjusted to it. */
  recordCashCount: (c: { date: string; physicalCash: number; remarks?: string }) => Result;

  /* traders */
  addTrader: (t: Omit<Trader, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Trader | null;
  updateTrader: (id: string, patch: Partial<Trader>) => void;
  addTraderTxn: (t: Omit<TraderTxn, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  /** Correct a payment on a trader's ledger, auditing every protected field it changes. */
  updateTraderTxn: (id: string, patch: Partial<Omit<TraderTxn, 'id' | 'companyId' | 'traderId' | 'kind' | 'refId' | 'createdAt' | 'createdBy' | 'synced'>>, reason?: string) => Result;

  /* tasks */
  addTask: (t: Omit<FarmTask, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'synced'>) => FarmTask | null;
  updateTask: (id: string, patch: Partial<FarmTask>) => void;
  deleteTask: (id: string) => void;

  /* backup — one company's records, out as a file and back in under explicit confirmation */
  /**
   * The whole of this company's data as one JSON file, as far as this role may see it. Money a
   * role cannot read is left out rather than refused, and no credential is ever carried: a
   * person's record is not part of a company's books.
   */
  exportCompanyBackup: () => { ok: true; file: BackupFile; omitted: { slice: string; reason: string }[] } | Result;
  /**
   * What restoring a candidate file would do, said before anything is written. The file is read
   * against the live company: identity, schema, references, duplicates and the row-by-row diff.
   */
  checkBackupFile: (json: unknown) => Validation;
  /** Apply a plan the person has already seen and confirmed. Nothing is deleted to make room. */
  restoreCompanyBackup: (plan: RestorePlan, summary: string) => Result;

  syncPending: () => void;
  resetDemo: () => void;
}

/* ============================= HELPERS ============================= */

function audit(
  state: AppState,
  entity: string, entityId: string,
  action: AuditEntry['action'],
  field?: string, oldValue?: unknown, newValue?: unknown,
  reason?: string,
): AuditEntry[] {
  const entry: AuditEntry = {
    id: uid('au'), companyId: state.session?.companyId ?? undefined,
    entity, entityId, action, field, oldValue, newValue, reason,
    byUserId: state.session?.userId ?? 'system', at: nowISO(),
  };
  return [entry, ...state.audit].slice(0, 500);
}

/**
 * One audit entry per field a correction touched, all stamped with the reason given for
 * the change. Silent overwrites are what makes a money dispute unanswerable, so nothing
 * in here collapses several edits into a single vague row.
 */
/** One CREATE row on its own, for a step that writes a second entity in the same action. */
function auditRow(state: AppState, entity: string, entityId: string, summary: string): AuditEntry {
  return {
    id: uid('au'), companyId: state.session?.companyId ?? undefined,
    entity, entityId, action: 'CREATE', newValue: summary,
    byUserId: state.session?.userId ?? 'system', at: nowISO(),
  };
}

/**
 * One row for a step rather than a record: a backup leaving the company, a restore starting,
 * ending or failing. The trail is the same table with the same authorship, so an export is
 * answered in exactly the place an edit is.
 */
function auditStep(
  state: AppState, action: AuditAction, entity: string, entityId: string,
  summary: string, reason?: string,
): AuditEntry {
  return {
    id: uid('au'), companyId: state.session?.companyId ?? undefined,
    entity, entityId, action, newValue: summary, reason,
    byUserId: state.session?.userId ?? 'system', at: nowISO(),
  };
}
/**
 * The store's persist version, in one place: a backup has to say which shape it was written in,
 * and the reader compares against the same number.
 */
export const PERSIST_VERSION = 21;

/**
 * What a company's data is, taken straight from the sync registry rather than described again.
 *
 * `SLICES` is already the list the database and this browser agree on, so a backup that rides it
 * can never drift from what syncs. Two entries are dropped: `supportMessages` is a conversation
 * with the vendor rather than the farm's books, and `ingredientCatalog` is global to the
 * platform with no company on it at all.
 */
const BACKUP_PROFILE: BackupProfile = {
  slices: SLICES.filter(s => !NOT_COMPANY_DATA.has(s.slice)),
  columns: COLUMNS,
  primaryKeys: PRIMARY_KEYS,
  idOf: rowId,
};

function auditChanges(
  state: AppState,
  entity: string, entityId: string,
  changes: { field: string; oldValue: unknown; newValue: unknown }[],
  reason?: string,
): AuditEntry[] {
  if (!changes.length) return state.audit;
  const entries: AuditEntry[] = changes.map(c => ({
    id: uid('au'), companyId: state.session?.companyId ?? undefined,
    entity, entityId, action: 'UPDATE' as const, ...c, reason,
    byUserId: state.session?.userId ?? 'system', at: nowISO(),
  }));
  return [...entries, ...state.audit].slice(0, 500);
}

/**
 * What a booking is allowed to point at: this company's own sheds and traders, plus
 * the rolling planner window. Resolving it from the store rather than the caller is
 * what stops one farm planning a load off another farm's shed.
 */
function plannerScope(state: AppState, companyId: string) {
  return {
    window: plannerWindow(todayISO(), PLANNER_HORIZON),
    shedIds: state.sheds.filter(s => s.companyId === companyId).map(s => s.id),
    traderIds: state.traders.filter(t => t.companyId === companyId).map(t => t.id),
  };
}

/** Exactly one formula version is in force per shed; the rest keep their history. */
function deactivateOther(list: FeedFormula[], shedId: string, exceptId?: string): FeedFormula[] {
  return list.map(f => f.shedId === shedId && f.status === 'ACTIVE' && f.id !== exceptId
    ? { ...f, status: 'INACTIVE' as const, supersededAt: f.supersededAt ?? nowISO(), updatedAt: nowISO() }
    : f);
}

/** 24-hour clock string as produced by `<input type="time">`. */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The fields a money dispute turns on. Any of them moving on a saved row is an audited
 * correction with a stated reason — never a silent overwrite (spec §12).
 */
const PROTECTED_FINANCE: (keyof FinanceTxn)[] = [
  'amount', 'date', 'kind', 'category', 'counterparty', 'purchaseId', 'saleId',
  'paymentMethod', 'split', 'handledById', 'handedTo', 'authorizedById', 'reference', 'time',
];

const PROTECTED_TRADER_TXN: (keyof TraderTxn)[] = [
  'amount', 'date', 'paymentMethod', 'split', 'saleId', 'handledById', 'handedTo', 'authorizedById', 'reference', 'time',
];

function protectedChanges<T extends object>(prev: T, next: T, fields: (keyof T)[]) {
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  for (const field of fields) {
    const before = prev[field];
    const after = next[field];
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
    changes.push({ field: String(field), oldValue: before, newValue: after });
  }
  return changes;
}

/* ============================= VACCINATION HELPERS ============================= */

/** The schedule fields whose change must be visible on the audit trail (§9). */
const PROTECTED_VACCINATION: (keyof VaccinationItem)[] = [
  'vaccineName', 'scheduledDate', 'reminderDaysBefore', 'dose', 'route', 'remarks',
];

/** Schedule changes are the Owner's, unless the batch names someone else for them (§12). */
const SCHEDULE_DENIED = 'Only the Owner can change a vaccination schedule';
const COMPLETE_DENIED = 'You are not permitted to record a vaccination for this batch';
const TEMPLATE_DENIED = 'Only the Owner can change the vaccination templates';

/** A line is worth storing once it names a vaccine and the day it falls on. */
function vaccinationDraftError(draft: VaccinationDraft): string | null {
  if (!draft.vaccineName.trim()) return 'Enter the vaccine name';
  if (!draft.scheduledDate) return 'Choose the scheduled date';
  const r = draft.reminderDaysBefore;
  if (!Number.isInteger(r) || r < 0) return 'Remind 0 or more days before the date';
  return null;
}

function vaccinationTemplateError(input: VaccinationTemplateDraft): string | null {
  if (!input.name.trim()) return 'Enter the template name';
  if (!input.items.length) return 'Add at least one vaccination to the template';
  for (const item of input.items) {
    if (!item.vaccineName.trim()) return 'Every line needs a vaccine name';
    if (!Number.isInteger(item.relativeDay) || item.relativeDay < 0) return 'Day must be 0 or more after placement';
    if (!Number.isInteger(item.reminderDaysBefore) || item.reminderDaysBefore < 0) return 'Remind 0 or more days before the date';
  }
  return null;
}

/** The trimming one write path would otherwise repeat four times over. */
function vaccinationDraftOf(input: VaccinationDraft): VaccinationDraft {
  return {
    vaccineName: input.vaccineName.trim(),
    scheduledDate: input.scheduledDate,
    reminderDaysBefore: input.reminderDaysBefore,
    dose: input.dose?.trim() || undefined,
    route: input.route?.trim() || undefined,
    remarks: input.remarks?.trim() || undefined,
  };
}

/** Templates read as a schedule, so the lines are stored in the order the flock meets them. */
function sortTemplateItems(items: VaccinationTemplateItem[]): VaccinationTemplateItem[] {
  return [...items]
    .sort((a, b) => a.relativeDay - b.relativeDay || a.vaccineName.localeCompare(b.vaccineName))
    .map(i => ({
      ...i,
      vaccineName: i.vaccineName.trim(),
      dose: i.dose?.trim() || undefined,
      route: i.route?.trim() || undefined,
      remarks: i.remarks?.trim() || undefined,
    }));
}

/**
 * One draft becomes one stored row. The flock-day is read off the batch's own placement date
 * here and nowhere else, so a copied template line and a hand-typed one say the same thing —
 * and a later change to any batch field cannot move a date already on the schedule (§1).
 */
function vaccinationRow(draft: VaccinationDraft, batch: Batch, createdBy: string, synced: boolean): VaccinationItem {
  const now = nowISO();
  return {
    ...vaccinationDraftOf(draft),
    id: uid('vac'), companyId: batch.companyId, batchId: batch.id, shedId: batch.shedId,
    relativeDay: daysBetween(batch.placementDate, draft.scheduledDate),
    status: 'SCHEDULED',
    createdBy, createdAt: now, updatedAt: now, synced,
  };
}
function baseSeed() {
  return {
    companies: seedCompanies, users: seedUsers, farms: seedFarms, sheds: seedSheds,
    batches: seedBatches, assignments: seedAssignments, mortality: seedMortality,
    feed: seedFeed, feedRounds: seedFeedRounds, eggs: seedEggs,
    saleLogs: seedSaleLogs, saleEntries: seedSaleEntries, feedStock: seedFeedStock,
    medicineItems: seedMedicineItems, medicineStock: seedMedicineStock,
    eggSaleBookings: [] as EggSaleBooking[],
    eggWastages: [] as EggWastage[],
    feedFormulas: seedFeedFormulas, finance: seedFinance,
    traders: ensureWalkInTraders(seedTraders, seedCompanies),
    traderTxns: seedTraderTxns, tasks: seedTasks, ingredientCatalog: [...FEED_INGREDIENTS],
    vaccinations: seedVaccinations, vaccinationTemplates: seedVaccinationTemplates,
    supportMessages: [] as SupportMessage[],
    audit: seedAudit,
    cashHandovers: [] as CashHandover[], cashCounts: [] as CashCount[],
  };
}

const numOf = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const gradeOf = (v: unknown): EggGrade => (EGG_GRADES.includes(v as EggGrade) ? (v as EggGrade) : 'GOOD');

/** A trader sale as booked before the sale-entry voucher replaced it. */
interface LegacyEggSale {
  id: string; companyId: string; traderId: string; date: string;
  trays: number; grade: unknown; ratePerTray: number; amount: number;
  paymentStatus: unknown; saleLogIds?: string[]; remarks?: string;
  createdBy: string; createdAt: string; synced: boolean;
}

/**
 * v5 kept money and stock apart: dispatch logs deducted stock, trader sales only
 * booked the amount. A sale entry does both, so each legacy sale is rebuilt as one —
 * its shed lines come from the dispatch logs it was collated from, which were the
 * trays that had already left those sheds.
 */
function upgradeLegacySales(legacy: LegacyEggSale[], logs: SaleLog[]): SaleEntry[] {
  return legacy.map(s => {
    // The dispatch logs it was collated from are what took trays out of each shed.
    const own = logs.filter(l => s.saleLogIds?.includes(l.id));
    const lines: SaleEntryLine[] = [...new Set(own.map(l => l.shedId))].map(shedId => {
      const byGrade = { ...EMPTY_GRADE_COUNTS };
      for (const l of own) if (l.shedId === shedId) byGrade[gradeOf(l.grade)] += numOf(l.trays);
      return { shedId, byGrade };
    });
    const paid = s.paymentStatus === 'PAID';
    return {
      id: s.id, companyId: s.companyId, traderId: s.traderId, date: s.date,
      lines, rates: {}, pricing: 'AGREED' as const, amount: numOf(s.amount),
      cash: paid ? numOf(s.amount) : 0, phonepe: 0, advance: 0, credit: paid ? 0 : numOf(s.amount),
      laborCharge: 0, remarks: s.remarks ?? `From trader sale @ ₹${numOf(s.ratePerTray)}/tray`,
      createdBy: s.createdBy, createdAt: s.createdAt, synced: s.synced,
    };
  });
}

/** Ledger rows a voucher owns: editing or deleting the voucher replaces exactly these. */
function replaceLedger<T extends { refId?: string }>(list: T[], refId: string, rows: T[]): T[] {
  return [...list.filter(x => x.refId !== refId), ...rows];
}

/**
 * The highest number this device has been shown for a company, series and day since it booted,
 * keyed `company|scope|day`. A reference is claimed when a form displays it and only becomes a
 * fact when the row saves, so two receipts written on one offline afternoon would otherwise be
 * handed the same number from the saved high water alone. Gaps are the price, exactly as they
 * are at the counter. Nothing persists here: a reload's floor is the saved rows themselves.
 */
const receiptClaims = new Map<string, number>();

/**
 * Recompute every trader's balance from the ledger it belongs to. Called after any change
 * to either side, so the stored figure is a cache of the sum rather than a running total
 * that drifts the moment one write path disagrees with another.
 *
 * `stamp` is false when the caller is only healing the cache after a cloud merge: the
 * database row did not change, so `updatedAt` must keep its own value — stamping it would
 * offer the database a write nobody asked for and two signed-in devices would echo it.
 */
export function rebalanceTraders(traders: Trader[], txns: TraderTxn[], stamp = true): Trader[] {
  const byTrader = new Map<string, TraderTxn[]>();
  for (const t of txns) {
    const own = byTrader.get(t.traderId);
    if (own) own.push(t); else byTrader.set(t.traderId, [t]);
  }
  return traders.map(t => {
    const balance = traderBalance(t.openingBalance, byTrader.get(t.id) ?? []);
    if (balance === t.outstandingAmount) return t;
    return stamp
      ? { ...t, outstandingAmount: balance, updatedAt: nowISO() }
      : { ...t, outstandingAmount: balance };
  });
}

/** Drop sheds with nothing sold and clamp trays to whole trays. */
function normalizeLines(lines: SaleEntryLine[]): SaleEntryLine[] {  return lines
    .map(l => {
      const byGrade = { ...EMPTY_GRADE_COUNTS };
      for (const g of EGG_GRADES) byGrade[g] = Math.max(0, Math.floor(numOf(l.byGrade?.[g])));
      return { shedId: l.shedId, byGrade };
    })
    .filter(l => l.shedId && gradeTotal(l.byGrade) > 0);
}

/** Whole trays per grade, never negative, never left unstated. */
function normalizeWasteGrades(byGrade: EggGradeCounts): EggGradeCounts {
  const out = { ...EMPTY_GRADE_COUNTS };
  for (const g of EGG_GRADES) out[g] = Math.max(0, Math.floor(numOf(byGrade?.[g])));
  return out;
}

const money = (n: number) => Number(n.toFixed(2));

/**
 * How a voucher's money arrived, spoken in the ledger's own language instead of in
 * remarks prose: one payment method when the whole amount came one way, and the channel
 * split itself when it did not. An advance is its own channel — that money was already
 * with us, so it must not read as cash collected today.
 */
function paymentChannels(cash: number, online: number, advance: number): Pick<FinanceTxn, 'paymentMethod' | 'split'> {
  const split: PaymentSplit = {};
  if (cash > 0) split.cash = money(cash);
  if (online > 0) split.online = money(online);
  if (advance > 0) split.advance = money(advance);
  const single: PaymentMethod | undefined = cash > 0 && !online && !advance
    ? 'CASH'
    : online > 0 && !cash && !advance ? 'PHONEPE' : undefined;
  return {
    ...(single ? { paymentMethod: single } : {}),
    ...(Object.keys(split).length ? { split } : {}),
  };
}

/**
 * Finance rows for a voucher, one per shed line so each batch is credited with the trays
 * that left it: only the money that actually changed hands. What stays with the trader is
 * not finance yet — it sits on their ledger. The loading labour recovered on a load arrives
 * inside that money and is income to the shed; the wage is the farm's own Finance expense,
 * booked on the day it is paid.
 */
function financeRows(entry: SaleEntry, batches: Batch[], counterparty?: string): FinanceTxn[] {
  const total = entryTrays(entry);
  const received = loadPaid(entry.cash, entry.phonepe, entry.advance);
  const rows: FinanceTxn[] = [];
  let seen = { received: 0, cash: 0, phonepe: 0 };
  entry.lines.forEach((line, i) => {
    const last = i === entry.lines.length - 1;
    const share = total > 0 ? entryTrays({ ...entry, lines: [line] }) / total : 0;
    const part = (whole: number, used: number) => (last ? whole - used : money(whole * share));
    const cash = part(entry.cash, seen.cash);
    const phonepe = part(entry.phonepe, seen.phonepe);
    const paid = part(received, seen.received);
    seen = { received: seen.received + paid, cash: seen.cash + cash, phonepe: seen.phonepe + phonepe };
    const base = {
      companyId: entry.companyId, batchId: batchOfShedOn(batches, line.shedId, entry.date)?.id,
      date: entry.date, counterparty, refId: entry.id,
      createdBy: entry.createdBy, createdAt: nowISO(), synced: entry.synced,
    };
    if (paid > 0) rows.push({
      ...base, ...paymentChannels(cash, phonepe, money(paid - cash - phonepe)),
      id: uid('fx'), kind: 'INCOME', amount: paid, category: 'Egg Sale',
      // Who physically took the cash is a fact about the money, not about who typed the voucher in.
      handledById: entry.cashHandledById, time: entry.cashTime, reference: entry.cashReference,
    });
  });
  return rows;
}

/** The trader is billed for the whole load — eggs plus loading labour — and credited for what they handed over. */
function traderRows(entry: SaleEntry): TraderTxn[] {
  const trays = entryTrays(entry);
  const billed = loadBilled(entry.amount, entry.laborCharge);
  const rows: TraderTxn[] = [{
    id: uid('tt'), companyId: entry.companyId, traderId: entry.traderId, date: entry.date,
    kind: 'EGG_SALE', trays, amount: billed,
    // The price a load settled at is its egg money per egg; loading labour is recovered
    // on the same voucher but it is never part of a price.
    rate: ratePerEgg(entry.amount, trays) ?? undefined,
    refId: entry.id, remarks: entry.remarks,
    createdBy: entry.createdBy, createdAt: nowISO(), synced: entry.synced,
  }];
  const received = loadPaid(entry.cash, entry.phonepe, entry.advance);
  if (received > 0) {
    rows.push({
      ...rows[0], ...paymentChannels(entry.cash, entry.phonepe, entry.advance),
      id: uid('tt'), kind: 'PAYMENT_IN', amount: received,
      trays: undefined, rate: undefined, remarks: undefined,
      handledById: entry.cashHandledById, time: entry.cashTime, reference: entry.cashReference,
    });
  }
  return rows;
}

/** A real Supabase identity: only these ids can be carried to the database. */
const CLOUD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Replace every string in a save that is exactly one of `map`'s keys, returning copies so a
 * slice still shared with the seed is never rewritten in place. Whole values only: a field
 * holding a person's name, or an id that merely begins with a retired one, is left alone.
 */
function repointIds<T>(node: T, map: Map<string, string>): T {
  if (Array.isArray(node)) return node.map(item => repointIds(item, map)) as unknown as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = typeof v === 'string' ? map.get(v) ?? v : repointIds(v, map);
    }
    return out as unknown as T;
  }
  if (typeof node === 'string') return (map.get(node) ?? node) as unknown as T;
  return node;
}

/**
 * Upgrade a save written before the current store version without discarding it:
 * unknown or missing slices fall back to the seed, v5 fields (the four egg-grade
 * pools, graded sale logs, the feed round log) are backfilled per record, and a
 * session is kept only while its user and company still exist.
 */
function migrateSaved(saved: unknown, fromVersion = 0): AppState {
  const raw = saved as Record<string, unknown>;
  const seed = baseSeed() as unknown as Record<string, unknown>;
  const merged = { ...seed, ...raw } as unknown as AppState;
  // Persist only calls this when the saved version differs from the current one, so a
  // one-time move of stored data belongs here — and reaching an already-upgraded save
  // means bumping `version`.
  const repriceCredit = fromVersion < 7;
  // v10 writes how a voucher's money physically arrived onto the ledger rows it owns, so
  // the cash/online view reads numbers rather than remarks prose. Amounts do not move, and
  // a row that cannot prove its channel stays 'Not recorded' instead of being guessed.
  const reclassifyPayments = fromVersion < 10;
  // v15 prices a load in the unit the trade uses: ₹ per egg, off its egg money alone.
  // The rate a sale row carried was billed money over trays, so the rows a voucher owns
  // are rewritten from that voucher — the amounts on them do not move, only the price read.
  const reratePerEgg = fromVersion < 15;
  // v11 separates a purchase from the money that settles it. Old receipts are given their
  // purchase numbers so a payment has something to point at; no payment is ever inferred
  // for them, and an old purchase payment simply stays what it always was — money that left.
  const numberPurchases = fromVersion < 11;
  for (const key of Object.keys(seed)) {
    const slice = merged[key as keyof AppState] as unknown;
    if (!Array.isArray(slice)) (merged as unknown as Record<string, unknown>)[key] = seed[key];
  }

  merged.eggs = merged.eggs.map(e => ({
    ...e,
    goodTrays: numOf(e.goodTrays, numOf((e as { trays?: unknown }).trays)),
    brokenTrays: numOf(e.brokenTrays),
    doubleTrays: numOf(e.doubleTrays),
    smallTrays: numOf(e.smallTrays),
  }));
  merged.saleLogs = merged.saleLogs.map(l => ({ ...l, grade: gradeOf(l.grade) }));
  const legacy = Array.isArray(raw.eggSales) ? raw.eggSales as LegacyEggSale[] : [];
  const own = Array.isArray(raw.saleEntries) ? raw.saleEntries as SaleEntry[] : [];
  // v7 bills the loading labour on the load and lets an advance be adjusted against it,
  // so the credit a load leaves behind is always re-derived from its own money fields.
  merged.saleEntries = [...upgradeLegacySales(legacy, merged.saleLogs), ...own].map(e => {
    const entry = { ...e, advance: numOf(e.advance) };
    return { ...entry, credit: loadCredit(entry) };
  });
  if (repriceCredit || reclassifyPayments || reratePerEgg) {
    // The old model's ledger rows are still in this save and no longer describe the
    // entries that own them, so rebuild them the way an edit would.
    const traderNames = new Map(merged.traders.map(t => [t.id, t.name]));
    for (const entry of merged.saleEntries) {
      merged.finance = replaceLedger(merged.finance, entry.id, financeRows(entry, merged.batches, traderNames.get(entry.traderId)));
      merged.traderTxns = replaceLedger(merged.traderTxns, entry.id, traderRows(entry));
    }
    if (reratePerEgg) {
      // A manually noted rate was typed against the tray label it was entered under. It is
      // the same price the trader gave, stated in eggs, so the figure is converted, not guessed.
      merged.traderTxns = merged.traderTxns.map(t => t.kind === 'RATE_UPDATE' && t.rate !== undefined
        ? { ...t, rate: money(t.rate / EGGS_PER_TRAY) } : t);
    }
  }
  // v18 takes the loading labour back out of the day of the sale. A voucher's recovered
  // labour is part of the money the shed took in, so the expense row the old model wrote
  // beside it is dropped — a wage the farm pays is entered in Finance on its own date.
  // Only rows a voucher owns are touched; a labour payment typed by the farm stays.
  if (fromVersion < 18) {
    const vouchers = new Set(merged.saleEntries.map(e => e.id));
    merged.finance = merged.finance.filter(f => !(
      f.kind === 'EXPENSE' && f.category === 'Labour' && f.refId !== undefined && vouchers.has(f.refId)
    ));
  }
  // Read every balance back off its ledger, which also heals a save whose stored
  // totals had drifted away from the rows under them.
  merged.traders = rebalanceTraders(ensureWalkInTraders(merged.traders, merged.companies), merged.traderTxns);
  delete (merged as unknown as Record<string, unknown>).eggSales;
  // The day-lock concept is gone; drop any locked-day rows an older save still carries,
  // along with the trail rows that only recorded a lock or an unlock.
  delete (merged as unknown as Record<string, unknown>).dayLocks;
  const lockVerbs = new Set(['LOCK', 'UNLOCK']);
  merged.audit = merged.audit.filter(a => !lockVerbs.has(a.action) && a.entity !== 'DayLock');
  merged.feedRounds = merged.feedRounds.filter(
    r => FEED_ROUNDS.includes(r.round) && (r.status === 'GIVEN' || r.status === 'SKIPPED'),
  );
  // Approximate intake is a planning field, so an older save simply has none of it; a
  // stored zero or unusable value means the same thing — that batch stays out of the
  // forecast rather than having an intake assumed for it.
  merged.batches = merged.batches.map(b => ({
    ...b,
    approximateFeedTonnesPerDay: numOf(b.approximateFeedTonnesPerDay) > 0
      ? numOf(b.approximateFeedTonnesPerDay) : null,
  }));

  if (numberPurchases) {
    // Number the receipts that predate purchase records, oldest first, continuing from the
    // highest number already on that day so a re-run never hands out a used number twice.
    const used = new Map<string, number>();
    const dayKey = (e: FeedStockEntry) => `${e.companyId}|${e.date}`;
    for (const e of merged.feedStock) {
      const n = Number.parseInt(e.purchaseRef?.slice(`PUR-${e.date}-`.length) ?? '', 10);
      if (Number.isFinite(n)) used.set(dayKey(e), Math.max(used.get(dayKey(e)) ?? 0, n));
    }
    const pending = merged.feedStock
      .filter(e => e.kind === 'FEED_IN' && !e.purchaseRef)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const numbered = new Map(pending.map(e => {
      const next = (used.get(dayKey(e)) ?? 0) + 1;
      used.set(dayKey(e), next);
      return [e.id, `PUR-${e.date}-${String(next).padStart(3, '0')}`];
    }));
    merged.feedStock = merged.feedStock.map(e => {
      const ref = numbered.get(e.id);
      return ref ? { ...e, purchaseRef: ref } : e;
    });
  }

  // v20 — one record per person. The seed shipped its people under `u_*` ids; Supabase gave the
  // same person a uuid id, and the hydrate merge keeps both, so an owner saw Mohan Lal twice and
  // could easily edit the copy that can never sync (pushUsers has to refuse a non-uuid id, the
  // profiles key is a uuid column). Mobile is unique on both sides, so it is the join: the cloud
  // row wins, and every reference this save holds to the retired id follows it. A seed person
  // with no cloud twin is left exactly as it was — there is nothing here to fold it into.
  const retired = new Map<string, string>();
  const cloudByMobile = new Map<string, string>();
  for (const u of merged.users) if (CLOUD_ID_RE.test(u.id)) cloudByMobile.set(u.mobile, u.id);
  for (const u of merged.users) {
    if (CLOUD_ID_RE.test(u.id)) continue;
    const twin = cloudByMobile.get(u.mobile);
    if (twin) retired.set(u.id, twin);
  }
  if (retired.size) {
    merged.users = merged.users.filter(u => !retired.has(u.id));
    for (const key of Object.keys(merged)) {
      (merged as unknown as Record<string, unknown>)[key] =
        repointIds((merged as unknown as Record<string, unknown>)[key], retired);
    }
  }

  // v21 — the "ibd" dose logged on 25-Sep-2026 while proving the owner's create-login flow was a
  // test entry, not farm history, so its ₹1,000 of vaccine money leaves every book. The rows are
  // named by id: nothing here filters a record the farm actually entered.
  if (fromVersion < 21) {
    const testVac = 'vac_muh9hudojpzb5a';
    const testRows = [`vac-vaccine-${testVac}`, `vac-labour-${testVac}`, `vac-vaccinator-${testVac}`];
    merged.vaccinations = merged.vaccinations.filter(v => v.id !== testVac);
    merged.finance = merged.finance.filter(f => !testRows.includes(f.refId ?? ''));
    merged.audit = merged.audit.filter(a => a.entityId !== testVac);
  }

  // A saved company context is a claim, never a fact. The company may have been deactivated
  // and this person may have been detached from it while the browser was closed, so both are
  // re-read off the slices this save itself carries. A context that no longer stands is
  // dropped — the person stays signed in, and the notice says why on the way out. No data is
  // cleared here: the cache is left intact for the day the company stands again.
  const session = merged.session;
  const sessionUser = session ? merged.users.find(u => u.id === session.userId) ?? null : null;
  merged.accessNotice = null;
  if (!session || !sessionUser) merged.session = null;
  else {
    const a = companyAccessOf(session, sessionUser, merged.companies);
    if (contextIntact(a)) {
      if (a.reason === 'NO_CONTEXT' && isPlatformAdmin(sessionUser) === false
        && operableCompanies(sessionUser, merged.companies).length === 1) {
        merged.session = { ...session, companyId: operableCompanies(sessionUser, merged.companies)[0].id };
      }
    } else {
      merged.session = { ...session, companyId: null };
      merged.accessNotice = a;
    }
  }

  return merged;
}

export const useApp = create<AppState>()(persist(
  (set, get) => {
    /** The company a new record may bear: the working context only while it still stands. A
     *  context a pull found dead — or one pointing at a company this browser has no record of —
     *  stamps nothing, so a stale id cannot brand a record mid-session (§3, §6). */
    const cid = () => operableCompanyId(access());
    const me = () => get().users.find(u => u.id === get().session?.userId) ?? null;
    /** The one company-access read: the context this browser is holding, against the company
     *  and membership slices the last pull refreshed. Screens and guards ask this; RLS decides. */
    const access = (): CompanyAccess =>
      companyAccessOf(get().session, me(), get().companies);
    const can = (key: PermissionKey) => {
      const u = me();
      if (!u) return false;
      // A dead membership or a deactivated company ends operational work at once, whatever the
      // role still says — the same gate app.member_of()/app.role_in() apply to every policy.
      if (!contextIntact(access())) return false;
      return DEFAULT_ROLE_PERMISSIONS[u.role]?.[key] ?? false;
    };
    /** Daily operational entries are gated in the data layer, not just the UI (§4, §5). */
    const dailyOpsGuard = (): Result | null =>
      can('createDailyOps') ? null : { ok: false, error: 'Your role cannot record daily operational entries' };

    /** §4/§6: correcting an existing record needs the update permission, not just create. */
    const editGuard = (): Result | null =>
      can('update') ? null : { ok: false, error: 'Only your supervisor or the owner can change a saved record' };

    /**
     * A vaccination permission is read on the flock: the role's own standing, or what the
     * assignment on this batch grants. That is how a supervisor or manager may complete a
     * dose they are named for, while a money role stays out of farm work unless granted (§13).
     */
    const canOnBatch = (key: PermissionKey, batchId: string): boolean => {
      const u = me();
      if (!u || !contextIntact(access())) return false;
      const a = get().assignments.find(x => x.batchId === batchId && x.userId === u.id);
      return effectiveCan(u.role, a?.permissions, key);
    };

    /**
     * The gate every schedule write passes through: the same company, a live batch, and the
     * right to be writing on it. A closed batch keeps its plan as history and stops asking for
     * action, so nothing here touches it — and nothing here deletes it either (§16, §17).
     */
    const vaccinationAccess = (batchId: string, key: PermissionKey, denied: string):
      { batch: Batch } | { error: string } => {
      const companyId = cid();
      if (!companyId) return { error: 'No company selected' };
      const batch = get().batches.find(b => b.id === batchId && b.companyId === companyId);
      if (!batch) return { error: 'Batch does not belong to this company' };
      if (batch.status !== 'ACTIVE') return { error: 'This batch is closed — its vaccination schedule stands as history' };
      if (!canOnBatch(key, batchId)) return { error: denied };
      return { batch };
    };

    /** A schedule row inside the active company, so one farm cannot write on another's flock. */
    const vaccinationOf = (id: string): VaccinationItem | null => {
      const companyId = cid();
      return get().vaccinations.find(v => v.id === id && v.companyId === companyId) ?? null;
    };

    /** Finish sign-in: pick company context when unambiguous. Only a company that stands is a
     *  context — a deactivated one is never entered from a login, however it is listed. */
    function startSession(user: User): Session {
      const open = operableCompanies(user, get().companies);
      return { userId: user.id, companyId: open.length === 1 ? open[0].id : null, signedInAt: nowISO() };
    }

    /** Godown balance check across a set of deductions (KG). */
    function wouldGoNegative(deductions: { ingredient: string; kg: number }[], companyId: string): string | null {
      const entries = get().feedStock.filter(e => e.companyId === companyId);
      for (const d of deductions) {
        const bal = entries
          .filter(e => e.ingredient === d.ingredient)
          .reduce((s, e) => s + (
            e.kind === 'OPENING' || e.kind === 'FEED_IN' ? e.qtyKg
              : e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION' ? -e.qtyKg
                : e.qtyKg), 0);
        if (bal - d.kg < 0) return `${d.ingredient} would go negative (have ${Math.round(bal)} kg, need ${Math.round(d.kg)} kg)`;
      }
      return null;
    }

    /** A product inside the active company. Stock from another farm is never reachable here. */
    const medicineItemOf = (id: string | undefined): MedicineItem | null => {
      const companyId = cid();
      if (!companyId || !id) return null;
      return get().medicineItems.find(i => i.id === id && i.companyId === companyId) ?? null;
    };

    const medicineIssueSummary = (item: MedicineItem, entry: MedicineStockEntry, expense: number | null) => {
      const shed = get().sheds.find(s => s.id === entry.shedId)?.name ?? '—';
      return `${item.name} ${fmtIN(entry.qty)} ${item.unit} → ${shed} · ${expense === null ? 'no cost basis' : fmtMoney(expense)}`;
    };

    /**
     * Validate a usage and build its ledger row without writing anything, so a dose
     * recorded from the vaccination sheet can have its row and its status land in one
     * step. The row carries the average that was in force on the day and the money it
     * came to: history keeps its own price whatever later purchases do to the average (§9).
     */
    function medicineIssueRow(draft: MedicineUsageDraft):
      { ok: true; item: MedicineItem; entry: MedicineStockEntry; expense: number | null }
      | { ok: false; error: string } {
      const companyId = cid();
      if (!companyId) return { ok: false, error: 'No company selected' };
      const item = medicineItemOf(draft.medicineId);
      if (!item) return { ok: false, error: 'Choose the medicine or vaccine in this store' };
      if (!draft.date) return { ok: false, error: 'Choose the date it was used' };
      const qty = numOf(draft.qty);
      if (!(qty > 0)) return { ok: false, error: 'Quantity must be greater than 0' };
      const reason = draft.reason.trim();
      if (!reason) return { ok: false, error: 'Say what it was used for' };
      const usedBy = draft.usedBy.trim();
      if (!usedBy) return { ok: false, error: 'Enter who used it' };
      const shed = get().sheds.find(s => s.id === draft.shedId && s.companyId === companyId);
      if (!shed) return { ok: false, error: 'Choose the shed this went into' };
      const batch = draft.batchId
        ? get().batches.find(b => b.id === draft.batchId && b.companyId === companyId) : null;
      if (draft.batchId && !batch) return { ok: false, error: 'Batch does not belong to this company' };
      if (batch && batch.shedId !== shed.id) return { ok: false, error: `${batch.code} is not in ${shed.name}` };

      const { avg, stock } = medicineBasis(
        get().medicineStock.filter(m => m.companyId === companyId), item.id, draft.date,
      );
      if (stock < qty) return { ok: false, error: `Only ${fmtIN(stock)} ${item.unit} of ${item.name} in stock` };
      const expense = avg === null ? null : Number((qty * avg).toFixed(2));
      return {
        ok: true,
        item,
        expense,
        entry: {
          id: uid('ms'), companyId, medicineId: item.id, date: draft.date, kind: 'USAGE', qty,
          ratePerUnit: avg ?? undefined, amount: expense ?? undefined,
          shedId: shed.id, batchId: batch?.id,
          reason, usedBy, vaccinationId: draft.vaccinationId,
          remarks: draft.remarks?.trim() || undefined,
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), synced: get().online,
        },
      };
    }

    /**
     * A sale entry takes physical trays out of several sheds and books money against
     * one trader, so it is checked as a whole: same company, shed still open for that
     * date, grade actually in stock, and the settlement split exact. `ignoreId` skips
     * the entry being edited so its own trays are not counted against it twice.
     */
    function saleEntryError(draft: SaleEntryDraft, amount: number, companyId: string, ignoreId?: string): string | null {
      const s = get();
      if (!s.traders.some(t => t.id === draft.traderId && t.companyId === companyId)) return 'Select the trader this sale is against';
      if (!draft.date) return 'Select the sale date';
      if (draft.lines.length === 0) return 'Enter the trays sold from at least one shed';
      if (draft.cash < 0 || draft.phonepe < 0 || draft.advance < 0 || draft.laborCharge < 0) return 'Amounts cannot be negative';
      // Cash is held by a person, so it names one. The one typing the voucher is never assumed to be them.
      if (draft.cash > 0 && !draft.cashHandledById) return 'Record who received the cash on this load';
      if (amount <= 0) {
        return draft.pricing === 'AGREED' ? 'Enter the amount collected for this sale' : 'Enter the per-egg rate for each grade you sold';
      }
      const byGrade: EggGradeCounts = linesByGrade(draft.lines);
      const unrated = EGG_GRADES.filter(g => byGrade[g] > 0 && !((draft.rates[g] ?? 0) > 0));
      if (draft.pricing === 'RATE' && unrated.length > 0) {
        return `Set a per-egg rate for the ${unrated.map(g => EGG_GRADE_LABELS[g].toLowerCase()).join(', ')} trays`;
      }
      // Every rupee lands in one of the three buckets: cash, PhonePe, or advance adjusted.
      // Whatever the load still owes after them is derived as the trader's credit.
      for (const line of draft.lines) {
        const shed = s.sheds.find(x => x.id === line.shedId && x.companyId === companyId);
        if (!shed) return 'A shed on this entry does not belong to this company';
        const stock = eggStockByGrade(shed.id, s.eggs, s.saleEntries.filter(x => x.id !== ignoreId), s.eggWastages);
        for (const g of EGG_GRADES) {
          if (line.byGrade[g] > stock[g].balance) {
            return `${shed.name} has only ${stock[g].balance} ${EGG_GRADE_LABELS[g].toLowerCase()} trays left in stock`;
          }
        }
      }
      return null;
    }

    /**
     * Wastage is the one way out of a grade's stock that carries no money, so it is held to
     * the same physical limit as a sale: a shed cannot throw away trays it does not hold.
     * `ignoreId` keeps the record being edited out of its own stock check.
     */
    function wastageError(draft: EggWastageDraft, companyId: string, ignoreId?: string): string | null {
      const s = get();
      if (!draft.date) return 'Select the date';
      if (!draft.reason?.trim()) return 'Say why these eggs went out';
      const batch = s.batches.find(b => b.id === draft.batchId && b.companyId === companyId);
      if (!batch) return 'Batch does not belong to this company';
      if (batch.shedId !== draft.shedId) return 'This flock is not in that shed';
      const trays = normalizeWasteGrades(draft.byGrade);
      if (gradeTotal(trays) <= 0) return 'Enter at least one tray to discard';
      const stock = eggStockByGrade(draft.shedId, s.eggs, s.saleEntries,
        s.eggWastages.filter(w => w.id !== ignoreId), draft.date);
      for (const g of EGG_GRADES) {
        if (trays[g] > stock[g].balance) {
          return `${EGG_GRADE_LABELS[g]} has only ${stock[g].balance} trays left in that shed`;
        }
      }
      return null;
    }

    /** Shed scope for formula editing: Owner anywhere, supervisors their sheds, others by grant. */
    const canManageFormula = (shedId: string): boolean => {
      const companyId = cid();
      const user = me();
      if (!companyId || !user) return false;
      const shed = get().sheds.find(s => s.id === shedId && s.companyId === companyId);
      if (!shed) return false;
      if (user.role === 'OWNER') return true;
      const shedBatchIds = new Set(get().batches.filter(b => b.shedId === shedId).map(b => b.id));
      const myAssignments = get().assignments.filter(a => a.userId === user.id && shedBatchIds.has(a.batchId));
      if (myAssignments.some(a => a.permissions.manageFormulas)) return true;
      if (!DEFAULT_ROLE_PERMISSIONS[user.role]?.manageFormulas) return false;
      if (user.role === 'FARM_SUPERVISOR') {
        return shed.farmSupervisorId === user.id || myAssignments.length > 0;
      }
      return myAssignments.length > 0;
    };

    function normalizeItems(items: FeedFormulaItem[]): FeedFormulaItem[] {
      return items
        .map(i => ({
          ingredient: i.ingredient.trim(),
          kgPerTonne: Number((i.kgPerTonne || 0).toFixed(2)),
        }))
        .filter(i => i.ingredient && i.kgPerTonne > 0);
    }

    function formulaError(input: FormulaInput): string | null {
      if (!input.name.trim()) return 'Formula name is required';
      if (!input.shedId) return 'Select a shed';
      const items = normalizeItems(input.items);
      if (items.length === 0) return 'Add at least one ingredient with a quantity';
      const seen = new Set<string>();
      for (const i of items) {
        const key = i.ingredient.toLowerCase();
        if (seen.has(key)) return `${i.ingredient} appears twice in the mix`;
        seen.add(key);
      }
      return null;
    }

    /**
     * True once consumption has been calculated against a version. Used formulas are
     * never edited in place, so September's numbers survive a November revision.
     */
    function hasConsumption(formula: FeedFormula): boolean {
      return formulaUsage(formula, get().feed, get().feedFormulas).length > 0;
    }

    /** Godown CONSUMPTION rows for an entry, from the formula version in force on its date. */
    function consumptionLedger(
      originId: string, shedId: string, tonnes: number, date: string, companyId: string,
      pinFormulaId?: string,
    ) {
      const formulas = get().feedFormulas.filter(f => f.companyId === companyId);
      const formula = (pinFormulaId ? formulas.find(f => f.id === pinFormulaId) : null)
        ?? formulaForDate(shedId, date, formulas);
      const deduction = formula ? formulaDeduction(formula, tonnes).filter(d => d.kg > 0) : [];
      const rows: FeedStockEntry[] = deduction.map(d => ({
        id: uid('fs'), companyId, ingredient: d.ingredient, date, kind: 'CONSUMPTION' as const,
        qtyKg: d.kg, shedId, remarks: `ref:${originId}`,
        createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online,
      }));
      // Snapshot the version onto the entry so a later edit cannot rewrite history.
      const snapshot = formula
        ? { formulaId: formula.id, formulaVersion: formula.version, formulaName: formula.name, deduction }
        : {};
      return { rows, deduction, snapshot };
    }

    return {
      ...baseSeed(),
      session: null,
      accessNotice: null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      toasts: [],

      /* ============================= AUTH ============================= */

      signInWithPassword: (mobile, password) => {
        const m = normalizeMobile(mobile);
        if (m.length !== 10) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
        const user = get().users.find(u => u.mobile === m);
        if (!user) return { ok: false, error: 'No account found for this number' };
        if (!user.active) return { ok: false, error: 'This account is deactivated' };
        if (!verifyPassword(password, user.passwordHash)) return { ok: false, error: 'Incorrect password' };
        set(s => ({ session: startSession(user), accessNotice: null, audit: audit(s, 'Session', user.id, 'CREATE') }));
        return { ok: true };
      },

      requestOtp: (mobile) => {
        const m = normalizeMobile(mobile);
        if (m.length !== 10) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
        const user = get().users.find(u => u.mobile === m);
        if (!user) return { ok: false, error: 'No account found for this number' };
        if (!user.active) return { ok: false, error: 'This account is deactivated' };
        // Demo: no SMS gateway — return the code so the UI can surface it.
        return { ok: true, code: generateOtp(m) };
      },

      signInWithOtp: (mobile, code) => {
        const m = normalizeMobile(mobile);
        const user = get().users.find(u => u.mobile === m);
        if (!user) return { ok: false, error: 'No account found for this number' };
        if (!user.active) return { ok: false, error: 'This account is deactivated' };
        if (!isOtpValid(m, code)) return { ok: false, error: 'Incorrect or expired OTP' };
        set(s => ({ session: startSession(user), accessNotice: null, audit: audit(s, 'Session', user.id, 'CREATE') }));
        return { ok: true };
      },

      selectCompany: (companyId) => {
        const user = me();
        const sess = get().session;
        if (!user || !sess) return { ok: false, error: 'Not signed in' };
        // The same refusal sign-in makes, for the person who was already signed in when it
        // happened: switching companies is not a way back in.
        if (!user.active) return { ok: false, error: 'This account is deactivated' };
        const company = get().companies.find(c => c.id === companyId);
        if (!company || !company.active) return { ok: false, error: 'Company unavailable' };
        if (!isPlatformAdmin(user) && !user.companyIds.includes(companyId)) {
          return { ok: false, error: 'You do not have access to this company' };
        }
        // Entering a company is a fresh context: a notice left over from the one just
        // dropped must not be read against this one.
        set({ session: { ...sess, companyId }, accessNotice: null });
        return { ok: true };
      },

      signOut: () => set(s => ({
        session: null, accessNotice: null,
        audit: audit(s, 'Session', s.session?.userId ?? '', 'DELETE'),
      })),

      revalidateCompanyAccess: () => {
        const a = access();
        // An entered company settles the matter; dropping out to choose another one does not
        // answer for the company just lost, so the notice is kept until one of those happens.
        if (a.reason === 'USABLE') { if (get().accessNotice) set({ accessNotice: null }); return; }
        if (a.reason === 'NO_CONTEXT') {
          // A revocation whose cause has gone away is not a reason to keep anybody out. When
          // the farm that came back is the only one they hold, walk them into it rather than
          // leaving a stale "Company inactive" up over a company that now stands; with more
          // than one, the picker is the honest answer and the notice has nothing left to say.
          const open = operableCompanies(me(), get().companies);
          if (get().accessNotice && open.length === 1 && get().session) {
            set(s => ({ session: s.session ? { ...s.session, companyId: open[0].id } : null, accessNotice: null }));
          }
          return;
        }
        // Only write when this is news. The check runs from an effect keyed on the very session
        // it rewrites, so re-stamping it each pass would re-render it forever.
        const { session, accessNotice } = get();
        if (!session?.companyId && accessNotice?.reason === a.reason) return;
        // The person stays signed in — their other memberships are still valid — but the
        // working context goes, so no screen can read or stamp a company it no longer holds.
        set(s => ({
          accessNotice: a,
          session: s.session ? { ...s.session, companyId: null } : null,
        }));
      },
      clearAccessNotice: () => set({ accessNotice: null }),

      setOnline: (v) => set({ online: v }),
      pushToast: (kind, message, detail) => {
        const id = uid('t');
        set(s => ({ toasts: [...s.toasts, { id, kind, message, detail }] }));
        setTimeout(() => get().dismissToast(id), TOAST_TTL_MS);
      },
      dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

      /* ============================= MASTER ADMIN ============================= */

      addCompany: (name) => {
        const company: Company = { id: uid('c'), name, active: true, createdAt: nowISO(), updatedAt: nowISO() };
        // A company is born able to sell at the gate, so its walk-in account comes with it.
        set(s => ({
          companies: [...s.companies, company],
          traders: [...s.traders, walkInTrader(company.id)],
          audit: audit(s, 'Company', company.id, 'CREATE'),
        }));
        return company;
      },
      toggleCompanyActive: (id) => {
        // The lifecycle switch is the platform's, not a screen's: refused here as well as in
        // the routes, and in the database (003 lets only a Master Admin write `companies`).
        if (!can('manageCompanies')) return;
        set(s => {
        const c = s.companies.find(x => x.id === id);
        return {
          companies: s.companies.map(x => x.id === id ? { ...x, active: !x.active, updatedAt: nowISO() } : x),
          // The lifecycle change itself is the audited event: who switched this company off
          // or back on. Its records are left exactly where they are (§13).
          audit: audit(s, 'Company', id, 'UPDATE', 'active', c?.active, !c?.active,
            c?.active ? 'Company deactivated' : 'Company reactivated'),
        };
      });
      },

      createUser: ({ name, mobile, password, role, companyIds, id }) => {
        if (!can('manageUsers')) return { ok: false, error: 'You cannot manage users' };
        // A company manager places a person where they themselves belong: a companyId typed into
        // a request buys nothing, here or in create_login's gate (010).
        const caller = me();
        if (!isPlatformAdmin(caller)) {
          if (role === 'MASTER_ADMIN') {
            return { ok: false, error: 'Only the platform admin can create a platform account' };
          }
          const mine = new Set(caller?.companyIds ?? []);
          if (companyIds.some(c => !mine.has(c))) {
            return { ok: false, error: 'You can only add people to a company you belong to' };
          }
        }
        const { mobile: m, error } = validateUserDraft(
          { name, mobile, password, role, companyIds },
          mm => get().users.some(u => u.mobile === mm),
        );
        if (error) return { ok: false, error };
        const user: User = {
          id: id ?? (runtime.cloud ? newUuid() : uid('u')),
          name: name.trim(), mobile: m, passwordHash: hashPassword(password),
          role, companyIds: role === 'MASTER_ADMIN' ? [] : companyIds,
          initials: name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?',
          active: true, createdAt: nowISO(), updatedAt: nowISO(),
        };
        set(s => ({ users: [...s.users, user], audit: audit(s, 'User', user.id, 'CREATE') }));
        return { ok: true, user };
      },
      /** The platform roster's on/off switch. Never for the account this browser is signed in
       *  with: a deactivated profile has no identity under RLS (015 narrows `app.uid()` exactly
       *  there), so that click would leave the session reading an empty database with nobody on
       *  the device left who could click it back. */
      toggleUserActive: (id) => {
        if (get().session?.userId === id) {
          return { ok: false, error: 'You cannot switch off the account you are signed in with' };
        }
        set(s => ({
          users: s.users.map(u => u.id === id ? { ...u, active: !u.active, updatedAt: nowISO() } : u),
          audit: audit(s, 'User', id, 'UPDATE', 'active'),
        }));
        return { ok: true };
      },
      updateUserCompanies: (id, companyIds) => set(s => ({
        users: s.users.map(u => u.id === id ? { ...u, companyIds, updatedAt: nowISO() } : u),
        audit: audit(s, 'User', id, 'UPDATE', 'companyIds'),
      })),

      /**
       * The person this session may change right now: inside the standing company, not
       * themselves, not a platform account, and — unless they hold only this company — not
       * somebody else's employee. The same sentence lib/team writes for the screen, so a row is
       * never offered here that the store would refuse. RLS decides the last word (015).
       */
      personOf: (id) => {
        const companyId = cid();
        if (!companyId) return { error: 'No company selected' } as const;
        if (!can('manageUsers')) return { error: 'You cannot manage users' } as const;
        const user = get().users.find(u => u.id === id);
        if (!user) return { error: 'User not found' } as const;
        const caller = me();
        const platform = isPlatformAdmin(caller);
        if (!platform && !user.companyIds.includes(companyId)) {
          return { error: 'This user does not belong to the company you are working in' } as const;
        }
        const block = personBlock(user, caller, platform);
        if (block) return { error: block } as const;
        return { user, companyId } as const;
      },

      updateUserRole: (id, role) => {
        const found = get().personOf(id);
        if ('error' in found) return { ok: false, error: found.error };
        const { user, companyId } = found;
        const caller = me();
        if (!isPlatformAdmin(caller)) {
          if (role === 'MASTER_ADMIN') return { ok: false, error: 'Only the platform admin can change a platform account' };
          const wrong = roleChangeError(user, role);
          if (wrong) return { ok: false, error: wrong };
        }
        if (user.role === role) return { ok: true };
        const company = get().companies.find(c => c.id === companyId);
        set(s => ({
          users: s.users.map(u => u.id === id ? { ...u, role, updatedAt: nowISO() } : u),
          audit: audit(s, 'User', id, 'UPDATE', 'role',
            user.role, role, `Role changed in ${company?.name ?? 'the company'}`),
        }));
        return { ok: true };
      },

      /** Off, or back on. Nothing here deletes a record: a switched-off person keeps their whole history. */
      setUserActive: (id, active) => {
        const found = get().personOf(id);
        if ('error' in found) return { ok: false, error: found.error };
        const { user, companyId } = found;
        if (user.active === active) return { ok: true };
        const company = get().companies.find(c => c.id === companyId);
        set(s => ({
          users: s.users.map(u => u.id === id ? { ...u, active, updatedAt: nowISO() } : u),
          audit: audit(s, 'User', id, 'UPDATE', 'active', user.active, active,
            `${active ? 'Activated' : 'Deactivated'} in ${company?.name ?? 'the company'}`),
        }));
        return { ok: true };
      },

      /* ============================= COMPANY STRUCTURE ============================= */

      addFarm: (f) => {
        const companyId = cid();
        if (!companyId) return null;
        const farm: Farm = { ...f, companyId, id: uid('farm'), createdAt: nowISO(), updatedAt: nowISO() };
        set(s => ({ farms: [...s.farms, farm], audit: audit(s, 'Farm', farm.id, 'CREATE') }));
        return farm;
      },
      updateFarm: (id, patch) => {
        const companyId = cid();
        set(s => ({ farms: s.farms.map(f => f.id === id && f.companyId === companyId ? { ...f, ...patch, updatedAt: nowISO() } : f) }));
      },
      addShed: (sh) => {
        const companyId = cid();
        if (!companyId) return null;
        const shed: Shed = { ...sh, companyId, id: uid('shed'), createdAt: nowISO(), updatedAt: nowISO() };
        set(s => ({ sheds: [...s.sheds, shed], audit: audit(s, 'Shed', shed.id, 'CREATE') }));
        return shed;
      },
      updateShed: (id, patch) => {
        const companyId = cid();
        set(s => ({ sheds: s.sheds.map(x => x.id === id && x.companyId === companyId ? { ...x, ...patch, updatedAt: nowISO() } : x) }));
      },
      deleteShed: (id) => {
        const companyId = cid();
        const shed = get().sheds.find(s => s.id === id);
        if (!companyId || !shed || shed.companyId !== companyId) return { ok: false, error: 'Shed not found' };
        if (get().batches.some(b => b.shedId === id)) {
          return { ok: false, error: `${shed.name} has batches on it. Close or move those first.` };
        }
        set(s => ({
          sheds: s.sheds.filter(x => x.id !== id),
          audit: audit(s, 'Shed', id, 'DELETE'),
        }));
        return { ok: true };
      },

      nextBatchCode: (shedId) => {
        const shed = get().sheds.find(s => s.id === shedId);
        const base = (shed?.name ?? 'BATCH').replace(/[^A-Za-z0-9]/g, '');
        const used = new Set(get().batches.filter(b => b.shedId === shedId).map(b => b.code));
        let i = 0;
        while (used.has(`${base}-${String.fromCharCode(65 + i)}`)) i++;
        return `${base}-${String.fromCharCode(65 + i)}`;
      },
      addBatch: (input, schedule, opening) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const role = me()?.role;
        if (role !== 'OWNER' && role !== 'FARM_SUPERVISOR') {
          return { ok: false, error: 'Only the Owner or Farm Supervisor can place a batch' };
        }
        const shed = get().sheds.find(s => s.id === input.shedId && s.companyId === companyId);
        if (!shed) return { ok: false, error: 'Shed does not belong to this company' };
        if (get().batches.some(b => b.shedId === shed.id && b.status === 'ACTIVE')) {
          return { ok: false, error: 'This shed already has an active batch' };
        }
        if (!input.breed.trim()) return { ok: false, error: 'Breed is required' };
        if (!input.placementDate) return { ok: false, error: 'Placement date is required' };
        if (input.initialBirds <= 0) return { ok: false, error: 'Place at least one bird' };
        // Shed capacity is a planning figure, not a ceiling: a real placement can exceed it.
        // Opening money is booked into the Finance ledger as part of this one decision, so it
        // answers to the finance permission and the accountability questions —
        // and a rejected line stops the placement rather than half-booking a flock.
        if (opening?.length) {
          if (!can('viewFinance')) return { ok: false, error: 'Only roles that record finance can add opening entries' };
          for (const entry of opening) {
            const invalid = openingEntryError(entry);
            if (invalid) return { ok: false, error: invalid };
          }
        }
        // The plan is part of placing the flock: a half-filled line stops the placement rather
        // than leaving a batch whose schedule silently lost a dose.
        for (const draft of schedule ?? []) {
          const invalid = vaccinationDraftError(draft);
          if (invalid) return { ok: false, error: invalid };
        }
        const batch: Batch = {
          ...input,
          breed: input.breed.trim(),
          supervisorId: input.supervisorId ?? (role === 'FARM_SUPERVISOR' ? me()?.id : undefined),
          code: get().nextBatchCode(shed.id),
          startDate: input.placementDate,
          status: 'ACTIVE',
          id: uid('batch'), companyId,
          createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), updatedAt: nowISO(),
        };
        // Copied, not referenced: from here the batch owns these dates and no template edit
        // can reach them (§11).
        const rows = (schedule ?? []).map(d => vaccinationRow(
          d, batch, batch.createdBy, get().online,
        ));
        // Booked as ordinary ledger rows tagged to the batch: from here the ledger, the cash
        // position and every report treat them like any hand-typed entry, and Finance can
        // correct them the same way.
        const openingRows: FinanceTxn[] = (opening ?? []).map(e => ({
          ...e, id: uid('fx'), companyId, batchId: batch.id,
          createdBy: batch.createdBy, createdAt: nowISO(), synced: get().online,
        }));
        set(s => {
          // One audit row for the placement and one for the plan it carried in: the copies
          // are the decision taken here, and a later dispute reads them as such.
          const entries = [...audit(s, 'Batch', batch.id, 'CREATE')];
          if (rows.length) {
            entries.unshift({
              id: uid('au'), companyId, entity: 'Vaccination', entityId: batch.id,
              action: 'CREATE', field: 'schedule', newValue: `${rows.length} scheduled`,
              byUserId: batch.createdBy, at: nowISO(),
            });
          }
          if (openingRows.length) {
            entries.unshift({
              id: uid('au'), companyId, entity: 'Batch', entityId: batch.id,
              action: 'CREATE', field: 'openingEntries',
              newValue: `${openingRows.length} opening entr${openingRows.length === 1 ? 'y' : 'ies'} · ${fmtMoney(openingRows.reduce((t, r) => t + r.amount, 0))}`,
              byUserId: batch.createdBy, at: nowISO(),
            });
          }
          return {
            batches: [...s.batches, batch],
            sheds: s.sheds.map(x => x.id === shed.id ? { ...x, status: 'ACTIVE', updatedAt: nowISO() } : x),
            vaccinations: [...s.vaccinations, ...rows],
            finance: openingRows.length ? [...s.finance, ...openingRows] : s.finance,
            audit: entries.slice(0, 500),
          };
        });
        return { ok: true };
      },
      updateBatch: (id, patch) => {
        const companyId = cid();
        set(s => ({ batches: s.batches.map(b => b.id === id && b.companyId === companyId ? { ...b, ...patch, updatedAt: nowISO() } : b) }));
      },
      /**
       * The planning intake behind the coverage forecast — a figure the owner sets, never a
       * ledger event. A clearing (null) or zero intake leaves the batch out of the forecast
       * rather than assuming what it eats; nothing here touches stock, money or history.
       */
      setBatchFeedIntake: (id, tonnesPerDay) => {
        if (!can('update')) return { ok: false, error: 'Not permitted to edit batch details' };
        const batch = get().batches.find(b => b.id === id && b.companyId === cid());
        if (!batch) return { ok: false, error: 'Batch not found' };
        if (tonnesPerDay !== null && (!Number.isFinite(tonnesPerDay) || tonnesPerDay < 0)) {
          return { ok: false, error: 'Feed intake must be 0 tonnes a day or more' };
        }
        const next = !tonnesPerDay ? null : Number(tonnesPerDay.toFixed(2));
        if (next === (batch.approximateFeedTonnesPerDay ?? null)) return { ok: true };
        set(s => ({
          batches: s.batches.map(b => b.id === id
            ? { ...b, approximateFeedTonnesPerDay: next, updatedAt: nowISO() } : b),
          audit: audit(s, 'Batch', id, 'UPDATE', 'approximateFeedTonnesPerDay',
            batch.approximateFeedTonnesPerDay ?? null, next),
        }));
        return { ok: true };
      },
      closeBatch: (batchId, closing) => {
        if (!can('closeBatch')) return { ok: false, error: 'Only the Owner can close a batch' };
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const batch = get().batches.find(b => b.id === batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch not found' };
        if (batch.status === 'CLOSED') return { ok: false, error: 'Batch is already closed' };
        const full: BatchClosing = { ...closing, closedBy: get().session?.userId ?? 'system', closedAt: nowISO() };
        // Bird sale income is a real financial transaction — it must flow through the Finance
        // ledger so it appears in shed income, batch P&L and farm P&L exactly like any
        // other income entry. Storing the amount on BatchClosing alone is a display note,
        // not the financial record.
        const saleRow: FinanceTxn | null =
          closing.saleAmount && closing.saleAmount > 0
            ? {
                id: uid('fx'), companyId, batchId,
                date: closing.date,
                kind: 'INCOME',
                amount: closing.saleAmount,
                category: 'Bird Sale',
                counterparty: closing.buyer || undefined,
                remarks: closing.remarks || undefined,
                // Payment accountability fields from the closing form
                paymentMethod: closing.paymentMethod ?? undefined,
                split: closing.split ?? undefined,
                reference: closing.reference || undefined,
                createdBy: get().session?.userId ?? 'system',
                createdAt: nowISO(),
                synced: get().online,
              }
            : null;
        set(s => ({
          batches: s.batches.map(b => b.id === batchId ? { ...b, status: 'CLOSED', closing: full, updatedAt: nowISO() } : b),
          sheds: s.sheds.map(sh => sh.id === batch.shedId ? { ...sh, status: 'IDLE', updatedAt: nowISO() } : sh),
          finance: saleRow ? [...s.finance, saleRow] : s.finance,
          audit: [
            ...(saleRow ? [auditRow(s, 'Finance', saleRow.id, `Bird Sale income ${fmtMoney(saleRow.amount)} on batch close`)] : []),
            ...audit(s, 'Batch', batchId, 'UPDATE', 'status', batch.status, 'CLOSED'),
          ].slice(0, 500),
        }));
        return { ok: true };
      },

      assignUser: ({ batchId, userId, role, perms, comments }) => {
        const batch = get().batches.find(b => b.id === batchId);
        if (!batch) return { ok: false, error: 'Batch not found' };
        const u = get().users.find(x => x.id === userId);
        if (!u) return { ok: false, error: 'User not found' };
        // batch_assignments.user_id is a foreign key on profiles, so access can only be granted
        // to a person the login table actually has. The demo seed still ships records keyed `u_*`
        // beside their cloud twins, and a row naming one of those can never leave this browser.
        if (runtime.cloud && !isUuid(u.id)) {
          return { ok: false, error: `${u.name} has no login yet — create one to grant access` };
        }
        if (!u.companyIds.includes(batch.companyId)) return { ok: false, error: `${u.name} is not part of this company` };
        if (get().assignments.some(a => a.batchId === batchId && a.userId === userId)) {
          return { ok: false, error: `${u.name} already has access to this batch` };
        }
        const base = DEFAULT_ROLE_PERMISSIONS[role];
        const permissions: PermissionSet = perms
          ? { ...base, create: perms.create, update: perms.update, delete: perms.delete }
          : base;
        const a: BatchAssignment = {
          id: uid('asg'), companyId: batch.companyId, batchId, userId, role, permissions, comments,
          assignedBy: get().session?.userId ?? 'system', assignedAt: nowISO(),
        };
        set(s => ({
          assignments: [...s.assignments, a],
          audit: audit(s, 'Assignment', a.id, 'CREATE', undefined, undefined, { batchId, userId, role }),
        }));
        return { ok: true };
      },
      revokeAssignment: (id) => {
        const companyId = cid();
        set(s => ({
          assignments: s.assignments.filter(a => !(a.id === id && a.companyId === companyId)),
          audit: audit(s, 'Assignment', id, 'DELETE'),
        }));
      },

      /* ============================= VACCINATION ============================= */

      addVaccination: (input) => {
        const access = vaccinationAccess(input.batchId, 'manageVaccination', SCHEDULE_DENIED);
        if ('error' in access) return { ok: false, error: access.error };
        const draft = vaccinationDraftOf(input);
        const invalid = vaccinationDraftError(draft);
        if (invalid) return { ok: false, error: invalid };
        const item = vaccinationRow(draft, access.batch, get().session?.userId ?? 'system', get().online);
        set(s => ({
          vaccinations: [...s.vaccinations, item],
          audit: audit(s, 'Vaccination', item.id, 'CREATE', undefined, undefined,
            { batchId: item.batchId, vaccineName: item.vaccineName, scheduledDate: item.scheduledDate }),
        }));
        return { ok: true, id: item.id };
      },

      /**
       * Correct a pending line. When the date moves it is a reschedule, and a reschedule is
       * worth nothing unless the reason stands beside it: the audit row carries the old date,
       * the new one, who moved it, when, and why (§9).
       */
      updateVaccination: (id, patch, reason) => {
        const item = vaccinationOf(id);
        if (!item) return { ok: false, error: 'Vaccination not found' };
        if (item.status !== 'SCHEDULED') {
          return { ok: false, error: 'Only a pending vaccination can be changed' };
        }
        const access = vaccinationAccess(item.batchId, 'manageVaccination', SCHEDULE_DENIED);
        if ('error' in access) return { ok: false, error: access.error };
        const draft = vaccinationDraftOf({
          vaccineName: patch.vaccineName ?? item.vaccineName,
          scheduledDate: patch.scheduledDate ?? item.scheduledDate,
          reminderDaysBefore: patch.reminderDaysBefore ?? item.reminderDaysBefore,
          dose: patch.dose ?? item.dose,
          route: patch.route ?? item.route,
          remarks: patch.remarks ?? item.remarks,
        });
        const invalid = vaccinationDraftError(draft);
        if (invalid) return { ok: false, error: invalid };
        const moved = draft.scheduledDate !== item.scheduledDate;
        const why = reason?.trim();
        if (moved && !why) return { ok: false, error: 'Enter a reason for moving the date' };
        const next: VaccinationItem = {
          ...item, ...draft,
          relativeDay: moved
            ? daysBetween(access.batch.placementDate, draft.scheduledDate) : item.relativeDay,
          updatedAt: nowISO(),
        };
        const changes = protectedChanges(item, next, PROTECTED_VACCINATION);
        if (!changes.length) return { ok: true };
        set(s => ({
          vaccinations: s.vaccinations.map(v => v.id === id
            ? { ...next, synced: s.online && v.synced } : v),
          audit: auditChanges(s, 'Vaccination', id, changes, why),
        }));
        return { ok: true };
      },

      /**
       * Record the dose as given. `scheduledDate` is not among the fields this writes: a dose
       * given late keeps both days on the record and reads as late, and the moment the status
       * flips the derived reminder states fall away on their own (§7, §8).
       *
       * When the dose came out of the medicine store, the same step books the one usage that
       * takes it off the shelf and charges the flock. Planning a vaccination never moves
       * stock — only giving it does (§11) — and a dose that already has its usage never
       * gets a second one (§12).
       */
      completeVaccination: (id, input) => {
        const item = vaccinationOf(id);
        if (!item) return { ok: false, error: 'Vaccination not found' };
        if (item.status === 'COMPLETED') return { ok: false, error: 'This vaccination is already recorded' };
        if (item.status === 'CANCELLED') return { ok: false, error: 'This vaccination was cancelled' };
        const access = vaccinationAccess(item.batchId, 'completeVaccination', COMPLETE_DENIED);
        if ('error' in access) return { ok: false, error: access.error };
        const date = input.completedDate;
        const by = input.completedBy.trim();
        if (!date) return { ok: false, error: 'Choose the date it was given' };
        if (date > todayISO()) return { ok: false, error: 'A vaccination cannot be given on a future date' };
        if (!by) return { ok: false, error: 'Enter who administered it' };

        const companyId = cid();
        // A dose is deducted once. If this vaccination already stands behind a usage, editing
        // or reopening the record cannot take a second lot off the shelf (§12).
        const alreadyIssued = companyId
          ? get().medicineStock.some(m => m.vaccinationId === id && m.companyId === companyId)
          : false;
        let issue: { entry: MedicineStockEntry; expense: number | null; summary: string } | null = null;
        if (input.medicineId && !alreadyIssued) {
          const built = medicineIssueRow({
            medicineId: input.medicineId, date, qty: numOf(input.medicineQty),
            shedId: item.shedId, batchId: item.batchId,
            reason: 'Vaccination', usedBy: by, remarks: input.completionRemarks,
            vaccinationId: id,
          });
          if (!built.ok) return built;
          issue = {
            entry: built.entry,
            expense: built.expense,
            summary: medicineIssueSummary(built.item, built.entry, built.expense),
          };
        }
        const done: VaccinationItem = {
          ...item, status: 'COMPLETED',
          completedDate: date, completedAt: nowISO(), completedBy: by,
          actualDose: input.actualDose?.trim() || undefined,
          completionRemarks: input.completionRemarks?.trim() || undefined,
          updatedAt: nowISO(),
        };
        const lateBy = daysBetween(item.scheduledDate, date);
        const issued = issue;
        const changes = [
          { field: 'status', oldValue: item.status, newValue: 'COMPLETED' },
          { field: 'completedDate', oldValue: null, newValue: date },
        ];
        const why = `Given by ${by}${lateBy ? ` · ${Math.abs(lateBy)} ${Math.abs(lateBy) === 1 ? 'day' : 'days'} ${lateBy > 0 ? 'late' : 'early'}` : ''}${issued ? ` · ${issued.entry.qty} drawn from the medicine store` : ''}`;

        // Charges are persisted as ordinary finance rows linked to this vaccination;
        // medicine not drawn from the store is also recorded here as a direct expense.
        const labourCompanyId = cid() ?? item.companyId;
        const createdBy = get().session?.userId ?? 'system';
        const labourRows: FinanceTxn[] = [];
        const linkedRows = get().finance.filter(t => t.refId === `vac-vaccine-${id}` || t.refId === `vac-labour-${id}` || t.refId === `vac-vaccinator-${id}`);
        const vaccineAmount = numOf(input.vaccineAmount);
        if (vaccineAmount > 0 && !issue) {
          labourRows.push({
            id: uid('fx'), companyId: labourCompanyId, batchId: item.batchId,
            date, kind: 'EXPENSE', amount: money(vaccineAmount), category: 'Vaccine',
            remarks: `Vaccine – ${item.vaccineName}`, refId: `vac-vaccine-${id}`,
            createdBy, createdAt: nowISO(), synced: get().online,
          });
        }
        if (input.labourAmount && input.labourAmount > 0) {
          labourRows.push({
            id: uid('fx'), companyId: labourCompanyId, batchId: item.batchId,
            date,
            kind: 'EXPENSE',
            amount: money(input.labourAmount),
            category: 'Vaccine Labour',
            counterparty: input.labourCounterparty?.trim() || undefined,
            remarks: `Vaccine labour – ${item.vaccineName}`,
            refId: `vac-labour-${id}`,
            createdBy, createdAt: nowISO(), synced: get().online,
          });
        }
        if (input.vaccinatorAmount && input.vaccinatorAmount > 0) {
          labourRows.push({
            id: uid('fx'), companyId: labourCompanyId, batchId: item.batchId,
            date,
            kind: 'EXPENSE',
            amount: money(input.vaccinatorAmount),
            category: 'Vaccinator',
            counterparty: input.labourCounterparty?.trim() || undefined,
            remarks: `Vaccinator charges – ${item.vaccineName}`,
            refId: `vac-vaccinator-${id}`,
            createdBy, createdAt: nowISO(), synced: get().online,
          });
        }

        set(s => ({
          vaccinations: s.vaccinations.map(v => v.id === id ? { ...done, synced: s.online && v.synced } : v),
          medicineStock: issued ? [...s.medicineStock, issued.entry] : s.medicineStock,
          finance: [...s.finance.filter(t => !linkedRows.some(linked => linked.id === t.id)), ...labourRows],
          // Both days stand on the row; the audit says which one was written, and names the
          // gap between them so a late dose reads as late in the history too (§8). The usage
          // is written down beside it as its own record, so a shelf count and a flock charge
          // stay readable apart even though one step booked both.
          audit: [
            ...(issued ? [auditRow(s, 'MedicineStock', issued.entry.id, issued.summary)] : []),
            ...labourRows.map(r => auditRow(s, 'Finance', r.id, `${r.category} ${fmtMoney(r.amount)} – ${item.vaccineName}`)),
            ...auditChanges(s, 'Vaccination', id, changes, why),
          ].slice(0, 500),
        }));
        return { ok: true, expense: issued ? issued.expense : null, usageId: issued?.entry.id };
      },

      /**
       * Call a vaccination off. The row stays with its reason, who called it off and when —
       * a cancelled dose is part of the flock's history, not a mistake to be erased (§10).
       */
      cancelVaccination: (id, reason) => {
        const item = vaccinationOf(id);
        if (!item) return { ok: false, error: 'Vaccination not found' };
        if (item.status === 'COMPLETED') return { ok: false, error: 'A completed vaccination cannot be cancelled' };
        if (item.status === 'CANCELLED') return { ok: false, error: 'Already cancelled' };
        const access = vaccinationAccess(item.batchId, 'manageVaccination', SCHEDULE_DENIED);
        if ('error' in access) return { ok: false, error: access.error };
        const why = reason.trim();
        if (!why) return { ok: false, error: 'Enter the reason for cancelling' };
        set(s => ({
          vaccinations: s.vaccinations.map(v => v.id === id ? {
            ...v, status: 'CANCELLED' as const,
            cancelledAt: nowISO(), cancelledBy: s.session?.userId ?? 'system', cancellationReason: why,
            updatedAt: nowISO(), synced: s.online && v.synced,
          } : v),
          audit: auditChanges(s, 'Vaccination', id, [{
            field: 'status', oldValue: item.status, newValue: 'CANCELLED',
          }], why),
        }));
        return { ok: true };
      },

      /* ---- templates: a starting point the Owner controls, copied and never referenced ---- */

      /**
       * Templates are company configuration rather than flock records, so the Owner role
       * alone edits them; a batch assignment has no meaning here.
       */
      addVaccinationTemplate: (input) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('manageVaccination')) return { ok: false, error: TEMPLATE_DENIED };
        const invalid = vaccinationTemplateError(input);
        if (invalid) return { ok: false, error: invalid };
        const now = nowISO();
        const template: VaccinationTemplate = {
          id: uid('vact'), companyId, name: input.name.trim(), birdType: input.birdType,
          active: true, items: sortTemplateItems(input.items),
          createdBy: get().session?.userId ?? 'system', createdAt: now, updatedAt: now,
        };
        set(s => ({
          vaccinationTemplates: [...s.vaccinationTemplates, template],
          audit: audit(s, 'VaccinationTemplate', template.id, 'CREATE', undefined, undefined,
            { name: template.name, items: template.items.length }),
        }));
        return { ok: true, id: template.id };
      },

      /**
       * Saving a template changes the template. A schedule already placed on a batch was
       * copied from it and holds its own dates, so nothing below reaches into `vaccinations`
       * and no placed flock is ever repriced by an edit here (§11).
       */
      updateVaccinationTemplate: (id, input) => {
        if (!can('manageVaccination')) return { ok: false, error: TEMPLATE_DENIED };
        const companyId = cid();
        const prev = get().vaccinationTemplates.find(t => t.id === id && t.companyId === companyId);
        if (!prev) return { ok: false, error: 'Template not found' };
        const invalid = vaccinationTemplateError(input);
        if (invalid) return { ok: false, error: invalid };
        const next: VaccinationTemplate = {
          ...prev, name: input.name.trim(), birdType: input.birdType,
          items: sortTemplateItems(input.items), updatedAt: nowISO(),
        };
        set(s => ({
          vaccinationTemplates: s.vaccinationTemplates.map(t => t.id === id ? next : t),
          audit: auditChanges(s, 'VaccinationTemplate', id,
            protectedChanges(prev, next, ['name', 'birdType', 'items'])),
        }));
        return { ok: true };
      },

      /**
       * Retiring a template takes it out of the choice list for new batches; it says nothing
       * about the batches already placed on it, so those schedules carry on untouched.
       */
      setVaccinationTemplateActive: (id, active) => {
        if (!can('manageVaccination')) return { ok: false, error: TEMPLATE_DENIED };
        const companyId = cid();
        const prev = get().vaccinationTemplates.find(t => t.id === id && t.companyId === companyId);
        if (!prev) return { ok: false, error: 'Template not found' };
        if (prev.active === active) return { ok: true };
        set(s => ({
          vaccinationTemplates: s.vaccinationTemplates.map(t => t.id === id
            ? { ...t, active, updatedAt: nowISO() } : t),
          audit: audit(s, 'VaccinationTemplate', id, 'UPDATE', 'active', prev.active, active),
        }));
        return { ok: true };
      },

      /* ============================= DAILY OPERATIONS ============================= */

      addMortality: (m) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === m.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (m.count <= 0) return { ok: false, error: 'Count must be greater than 0' };
        const entry: MortalityEntry = {
          ...m, companyId, id: uid('mort'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ mortality: [...s.mortality, entry], audit: audit(s, 'Mortality', entry.id, 'CREATE') }));
        return { ok: true };
      },
      updateMortality: (id, patch) => {
        const denied = editGuard(); if (denied) return denied;
        const existing = get().mortality.find(m => m.id === id && m.companyId === cid());
        if (!existing) return { ok: false, error: 'Entry not found' };
        set(s => ({
          mortality: s.mortality.map(m => m.id === id ? { ...m, ...patch, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() } : m),
          audit: audit(s, 'Mortality', id, 'UPDATE', 'count', existing.count, patch.count ?? existing.count),
        }));
        return { ok: true };
      },
      addEggCollection: (e) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === e.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (e.goodTrays < 0 || e.brokenTrays < 0 || e.doubleTrays < 0 || e.smallTrays < 0) {
          return { ok: false, error: 'Negative trays not allowed' };
        }
        if (e.goodTrays + e.brokenTrays + e.doubleTrays + e.smallTrays === 0) {
          return { ok: false, error: 'Enter at least one tray count' };
        }
        const entry: EggCollection = {
          ...e, companyId, id: uid('egg'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ eggs: [...s.eggs, entry], audit: audit(s, 'EggCollection', entry.id, 'CREATE') }));
        return { ok: true };
      },
      updateEggCollection: (id, patch) => {
        const denied = editGuard(); if (denied) return denied;
        const existing = get().eggs.find(e => e.id === id && e.companyId === cid());
        if (!existing) return { ok: false, error: 'Entry not found' };
        const next = { ...existing, ...patch };
        const trays = [next.goodTrays, next.brokenTrays, next.doubleTrays, next.smallTrays];
        if (trays.some(v => v < 0)) return { ok: false, error: 'Negative trays not allowed' };
        const before = existing.goodTrays + existing.brokenTrays + existing.doubleTrays + existing.smallTrays;
        const after = trays.reduce((s, v) => s + v, 0);
        if (after === 0) return { ok: false, error: 'Keep at least one tray count' };
        set(s => ({
          eggs: s.eggs.map(e => e.id === id ? { ...e, ...patch, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() } : e),
          audit: audit(s, 'EggCollection', id, 'UPDATE', 'totalTrays', before, after),
        }));
        return { ok: true };
      },

      /* ============================== EGG WASTAGE ============================== */

      addEggWastage: (draft) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const problem = wastageError(draft, companyId);
        if (problem) return { ok: false, error: problem };
        const entry: EggWastage = {
          ...draft, byGrade: normalizeWasteGrades(draft.byGrade), reason: draft.reason.trim(),
          companyId, id: uid('ew'),
          createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ eggWastages: [...s.eggWastages, entry], audit: audit(s, 'EggWastage', entry.id, 'CREATE') }));
        return { ok: true, id: entry.id };
      },
      updateEggWastage: (id, patch) => {
        const denied = editGuard(); if (denied) return denied;
        const existing = get().eggWastages.find(w => w.id === id && w.companyId === cid());
        if (!existing) return { ok: false, error: 'Entry not found' };
        const next: EggWastage = {
          ...existing, ...patch,
          byGrade: normalizeWasteGrades({ ...existing.byGrade, ...(patch.byGrade ?? {}) }),
        };
        const problem = wastageError(next, existing.companyId, id);
        if (problem) return { ok: false, error: problem };
        const before = gradeTotal(existing.byGrade);
        const after = gradeTotal(next.byGrade);
        set(s => ({
          eggWastages: s.eggWastages.map(w => w.id === id
            ? { ...w, ...patch, byGrade: next.byGrade, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() }
            : w),
          audit: audit(s, 'EggWastage', id, 'UPDATE', 'totalTrays', before, after),
        }));
        return { ok: true };
      },
      addFeedConsumption: (f, opts) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === f.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (f.tonnes <= 0) return { ok: false, error: 'Tonnes must be greater than 0' };
        const id = uid('fc');
        const { rows, deduction, snapshot } = consumptionLedger(id, f.shedId, f.tonnes, f.date, companyId);
        if (!opts?.allowNegative) {
          const neg = wouldGoNegative(deduction, companyId);
          if (neg) return { ok: false, error: `Insufficient godown stock: ${neg}` };
        }
        const entry: FeedConsumption = {
          ...f, companyId, id, ...snapshot, createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({
          feed: [...s.feed, entry],
          feedStock: [...s.feedStock, ...rows],
          audit: audit(s, 'FeedConsumption', entry.id, 'CREATE'),
        }));
        return { ok: true };
      },
      updateFeedConsumption: (id, patch, opts) => {
        const denied = editGuard(); if (denied) return denied;
        const companyId = cid();
        const existing = get().feed.find(f => f.id === id && f.companyId === companyId);
        if (!existing || !companyId) return { ok: false, error: 'Entry not found' };
        // Reverse this consumption's prior ledger deductions, then apply the new ones.
        const priorLedger = get().feedStock.filter(e => e.remarks === `ref:${id}`);
        const reversed: FeedStockEntry[] = priorLedger.map(e => ({
          ...e, qtyKg: -e.qtyKg, kind: 'ADJUSTMENT' as const, id: uid('fs'), remarks: `reverse ref:${id}`,
        }));
        const newTonnes = patch.tonnes ?? existing.tonnes;
        // Re-deduct against the SAME version this entry was recorded with.
        const { rows: deductions, deduction } = consumptionLedger(
          id, existing.shedId, newTonnes, existing.date, companyId, existing.formulaId,
        );
        if (!opts?.allowNegative) {
          const neg = wouldGoNegative(deduction, companyId);
          if (neg) return { ok: false, error: `Insufficient godown stock: ${neg}` };
        }
        set(s => ({
          feed: s.feed.map(f => f.id === id
            ? { ...f, ...patch, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() }
            : f),
          feedStock: [...s.feedStock.filter(e => !priorLedger.some(p => p.id === e.id)), ...reversed, ...deductions],
          audit: audit(s, 'FeedConsumption', id, 'UPDATE', 'tonnes', existing.tonnes, newTonnes),
        }));
        return { ok: true };
      },

      /* ============================= FEED ROUND LOG (TIMING ONLY) ============================= */

      /** A round is logged once per shed per day; recording it again corrects the time. */
      logFeedRound: (r) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === r.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        const at = r.status === 'GIVEN' ? r.at : '';
        if (r.status === 'GIVEN' && !CLOCK_TIME.test(at)) return { ok: false, error: 'Enter the time feed was given' };
        const by = get().session?.userId ?? 'system';
        const existing = get().feedRounds.find(x =>
          x.companyId === companyId && x.shedId === r.shedId && x.date === r.date && x.round === r.round);
        if (existing) {
          const updated: FeedRoundLog = { ...existing, ...r, at, updatedBy: by, updatedAt: nowISO() };
          set(s => ({
            feedRounds: s.feedRounds.map(x => x.id === existing.id ? updated : x),
            audit: audit(s, 'FeedRound', existing.id, 'UPDATE', 'at', existing.at || existing.status, at || updated.status),
          }));
          return { ok: true };
        }
        const entry: FeedRoundLog = {
          ...r, at, companyId, id: uid('fr'), createdBy: by, createdAt: nowISO(), synced: get().online,
        };
        set(s => ({
          feedRounds: [...s.feedRounds, entry],
          audit: audit(s, 'FeedRound', entry.id, 'CREATE'),
        }));
        return { ok: true };
      },
      updateFeedRound: (id, patch) => {
        const denied = editGuard(); if (denied) return denied;
        const existing = get().feedRounds.find(x => x.id === id && x.companyId === cid());
        if (!existing) return { ok: false, error: 'Entry not found' };
        const status = patch.status ?? existing.status;
        const at = status === 'GIVEN' ? (patch.at ?? existing.at) : '';
        if (status === 'GIVEN' && !CLOCK_TIME.test(at)) return { ok: false, error: 'Enter the time feed was given' };
        set(s => ({
          feedRounds: s.feedRounds.map(x => x.id === id
            ? { ...x, ...patch, status, at, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() }
            : x),
          audit: audit(s, 'FeedRound', id, 'UPDATE', 'status', existing.status, status),
        }));
        return { ok: true };
      },

      /* ============================= SHED DISPATCH LOGS ============================= */

      addSaleLog: (l) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('create')) return { ok: false, error: 'Your role cannot create dispatch logs' };
        const batch = get().batches.find(b => b.id === l.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (l.trays <= 0) return { ok: false, error: 'Trays must be greater than 0' };
        // A shed never dispatches more of a grade than it still holds.
        const available = eggStockByGrade(l.shedId, get().eggs, get().saleEntries, get().eggWastages)[l.grade].balance;
        if (l.trays > available) {
          return { ok: false, error: `Only ${available} ${EGG_GRADE_LABELS[l.grade].toLowerCase()} trays in stock for this shed` };
        }
        const entry: SaleLog = {
          ...l, companyId, id: uid('sl'), status: 'PENDING',
          createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ saleLogs: [...s.saleLogs, entry], audit: audit(s, 'SaleLog', entry.id, 'CREATE') }));
        return { ok: true };
      },
      acknowledgeSaleLog: (id) => {
        if (!can('acknowledgeSales')) return { ok: false, error: 'Only Finance or the Owner can confirm a dispatch' };
        const log = get().saleLogs.find(l => l.id === id && l.companyId === cid());
        if (!log) return { ok: false, error: 'Dispatch log not found' };
        if (log.status === 'ACKNOWLEDGED') return { ok: false, error: 'Already confirmed' };
        set(s => ({
          saleLogs: s.saleLogs.map(l => l.id === id ? { ...l, status: 'ACKNOWLEDGED', acknowledgedBy: s.session?.userId ?? 'system', acknowledgedAt: nowISO() } : l),
          audit: audit(s, 'SaleLog', id, 'UPDATE', 'status', 'PENDING', 'ACKNOWLEDGED'),
        }));
        return { ok: true };
      },
      /* ============================= SALE ENTRIES (trader settlement) =============================
       * The one record that takes trays out of shed stock and books money. Saved by
       * Finance/Owner against a trader once the load has gone, editable until the day locks. */

      addSaleEntry: (draft) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('createSaleEntries')) return { ok: false, error: 'Only Finance or the Owner can record a sale entry' };
        const lines = normalizeLines(draft.lines);
        const amount = entryAmount(lines, draft.rates, draft.pricing, draft.amount);
        const error = saleEntryError({ ...draft, lines }, amount, companyId);
        if (error) return { ok: false, error };
        const entry: SaleEntry = {
          ...draft, lines, amount, credit: loadCredit({ ...draft, amount }),
          id: uid('se'), companyId,
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        const traderName = get().traders.find(t => t.id === entry.traderId)?.name;
        set(s => {
          const traderTxns = replaceLedger(s.traderTxns, entry.id, traderRows(entry));
          return {
            saleEntries: [...s.saleEntries, entry],
            finance: replaceLedger(s.finance, entry.id, financeRows(entry, s.batches, traderName)),
            traderTxns,
            traders: rebalanceTraders(s.traders, traderTxns),
            audit: audit(s, 'SaleEntry', entry.id, 'CREATE', undefined, undefined, { traderId: entry.traderId, amount }),
          };
        });
        // The saved id lets a planner booking be marked sold against this voucher — and
        // only after this point, so a failed form never fulfils a plan.
        return { ok: true, id: entry.id };
      },

      updateSaleEntry: (id, patch) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('createSaleEntries')) return { ok: false, error: 'Only Finance or the Owner can record a sale entry' };
        const prev = get().saleEntries.find(e => e.id === id && e.companyId === companyId);
        if (!prev) return { ok: false, error: 'Sale entry not found' };
        const lines = normalizeLines(patch.lines);
        const amount = entryAmount(lines, patch.rates, patch.pricing, patch.amount);
        const error = saleEntryError({ ...patch, lines }, amount, companyId, id);
        if (error) return { ok: false, error };
        const entry: SaleEntry = {
          ...prev, ...patch, lines, amount, credit: loadCredit({ ...patch, amount }), id, companyId,
          synced: get().online && prev.synced,
          updatedBy: me()?.id ?? 'system', updatedAt: nowISO(),
        };
        const traderName = get().traders.find(t => t.id === entry.traderId)?.name;
        set(s => {
          // The voucher owns its ledger rows, so rewriting them cannot double-book.
          const traderTxns = replaceLedger(s.traderTxns, id, traderRows(entry));
          return {
            saleEntries: s.saleEntries.map(e => e.id === id ? entry : e),
            finance: replaceLedger(s.finance, id, financeRows(entry, s.batches, traderName)),
            traderTxns,
            traders: rebalanceTraders(s.traders, traderTxns),
            audit: audit(s, 'SaleEntry', id, 'UPDATE', 'amount', prev.amount, amount),
          };
        });
        return { ok: true };
      },

      deleteSaleEntry: (id) => {
        if (!can('delete')) return { ok: false, error: 'Only the Owner can delete a sale entry' };
        const entry = get().saleEntries.find(e => e.id === id && e.companyId === cid());
        if (!entry) return { ok: false, error: 'Sale entry not found' };
        set(s => {
          const traderTxns = replaceLedger(s.traderTxns, id, []);
          return {
            saleEntries: s.saleEntries.filter(e => e.id !== id),
            finance: replaceLedger(s.finance, id, []),
            traderTxns,
            traders: rebalanceTraders(s.traders, traderTxns),
            audit: audit(s, 'SaleEntry', id, 'DELETE', 'amount', entry.amount, undefined),
          };
        });
        return { ok: true };
      },

      /* ============================= EGG SALE PLANNER =============================
       * Trays promised to a trader for a shed on a day ahead. This block writes ONE
       * record type and nothing else: no shed stock moves, no finance row, no trader
       * ledger row, no payment. The sale entry above stays the only thing that turns a
       * plan into stock and money, and it marks the booking fulfilled once it saves. */

      addEggSalePlannerBooking: (draft) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('createSaleEntries')) return { ok: false, error: 'Only Finance or the Owner can plan a sale' };
        if (!EGG_GRADES.includes(draft.grade)) return { ok: false, error: 'Choose the grade to promise' };
        // Trays are counted whole; a fraction would plan a load nobody can dispatch.
        const plannedTrays = Math.floor(draft.plannedTrays);
        const error = bookingError(
          { date: draft.date, shedId: draft.shedId, traderId: draft.traderId, plannedTrays },
          plannerScope(get(), companyId),
        );
        // Note what is NOT checked here: how many trays the shed is expected to have.
        // Over-booking is a warning on the board, never a refusal — a promise can be
        // made against eggs still to be laid.
        if (error) return { ok: false, error };
        if (draft.batchId && !get().batches.some(b => b.id === draft.batchId && b.companyId === companyId)) {
          return { ok: false, error: 'That batch does not belong to this company' };
        }
        const booking: EggSaleBooking = {
          ...draft, plannedTrays, batchId: draft.batchId ?? batchOfShedOn(get().batches, draft.shedId, draft.date)?.id,
          companyId, id: uid('esb'), status: 'PLANNED',
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        set(s => ({
          eggSaleBookings: [...s.eggSaleBookings, booking],
          audit: audit(s, 'EggSaleBooking', booking.id, 'CREATE', undefined, undefined,
            { shedId: booking.shedId, traderId: booking.traderId, date: booking.date, plannedTrays }),
        }));
        return { ok: true, id: booking.id };
      },

      updateEggSalePlannerBooking: (id, patch, reason) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('createSaleEntries')) return { ok: false, error: 'Only Finance or the Owner can plan a sale' };
        const prev = get().eggSaleBookings.find(b => b.id === id && b.companyId === companyId);
        if (!prev) return { ok: false, error: 'Booking not found' };
        // A sold load is a fact, not a plan; changing the promise after the eggs went
        // would leave the booking describing something other than the sale it funded.
        if (prev.status === 'FULFILLED') return { ok: false, error: 'This booking has already been sold' };
        if (!EGG_GRADES.includes(patch.grade)) return { ok: false, error: 'Choose the grade to promise' };
        const plannedTrays = Math.floor(patch.plannedTrays);
        const error = bookingError(
          { date: patch.date, shedId: patch.shedId, traderId: patch.traderId, plannedTrays },
          { ...plannerScope(get(), companyId), existing: { date: prev.date } },
        );
        if (error) return { ok: false, error };
        const next: EggSaleBooking = {
          ...prev, ...patch, plannedTrays, companyId, id, status: prev.status,
          synced: get().online && prev.synced,
          updatedBy: me()?.id ?? 'system', updatedAt: nowISO(),
        };
        set(s => ({
          eggSaleBookings: s.eggSaleBookings.map(b => b.id === id ? next : b),
          audit: auditChanges(s, 'EggSaleBooking', id, [
            { field: 'date', oldValue: prev.date, newValue: next.date },
            { field: 'shedId', oldValue: prev.shedId, newValue: next.shedId },
            { field: 'traderId', oldValue: prev.traderId, newValue: next.traderId },
            { field: 'grade', oldValue: prev.grade, newValue: next.grade },
            { field: 'plannedTrays', oldValue: prev.plannedTrays, newValue: next.plannedTrays },
            { field: 'remarks', oldValue: prev.remarks, newValue: next.remarks },
          ].filter(c => c.oldValue !== c.newValue), reason),
        }));
        return { ok: true };
      },

      cancelEggSalePlannerBooking: (id, reason) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('createSaleEntries')) return { ok: false, error: 'Only Finance or the Owner can plan a sale' };
        const prev = get().eggSaleBookings.find(b => b.id === id && b.companyId === companyId);
        if (!prev) return { ok: false, error: 'Booking not found' };
        if (prev.status === 'FULFILLED') return { ok: false, error: 'This booking has already been sold' };
        if (prev.status === 'CANCELLED') return { ok: false, error: 'Already cancelled' };
        const trimmed = reason?.trim();
        if (!trimmed) return { ok: false, error: 'Say why the plan is being dropped' };
        const note = `Cancelled: ${trimmed}`;
        set(s => ({
          // Cancelled rows stay in the list. A dropped plan is still a decision someone
          // made, and the history of promises is what the board is judged against later.
          eggSaleBookings: s.eggSaleBookings.map(b => b.id === id
            ? { ...b, status: 'CANCELLED' as const, cancelReason: trimmed, remarks: b.remarks ? `${b.remarks}\n${note}` : note, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() }
            : b),
          audit: audit(s, 'EggSaleBooking', id, 'UPDATE', 'status', prev.status, 'CANCELLED', trimmed),
        }));
        return { ok: true };
      },

      fulfillEggSalePlannerBooking: (id, saleEntryId) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const prev = get().eggSaleBookings.find(b => b.id === id && b.companyId === companyId);
        if (!prev) return { ok: false, error: 'Booking not found' };
        if (prev.status === 'FULFILLED') return { ok: true };
        if (prev.status === 'CANCELLED') return { ok: false, error: 'A cancelled booking cannot be sold' };
        // The voucher has to exist in this company before the plan can call itself sold.
        const entry = get().saleEntries.find(e => e.id === saleEntryId && e.companyId === companyId);
        if (!entry) return { ok: false, error: 'Save the actual sale entry first' };
        set(s => ({
          eggSaleBookings: s.eggSaleBookings.map(b => b.id === id
            ? { ...b, status: 'FULFILLED' as const, saleEntryId, fulfilledAt: nowISO(), updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() }
            : b),
          audit: audit(s, 'EggSaleBooking', id, 'UPDATE', 'status', prev.status, 'FULFILLED'),
        }));
        return { ok: true };
      },

      /* ============================= GODOWN ============================= */

      addFeedStock: (e, opts) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const outgoing = e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION';
        // A shortage is an outflow: it is booked as negative KG however the quantity is typed.
        const qtyKg = e.kind === 'SHORTAGE' ? -Math.abs(e.qtyKg) : e.qtyKg;
        if (!outgoing && e.kind !== 'ADJUSTMENT' && e.kind !== 'SHORTAGE' && qtyKg <= 0) return { ok: false, error: 'Quantity must be greater than 0' };
        if (e.kind === 'SHORTAGE' && qtyKg === 0) return { ok: false, error: 'Enter the quantity found short' };
        if (outgoing && !opts?.allowNegative) {
          const neg = wouldGoNegative([{ ingredient: e.ingredient, kg: e.qtyKg }], companyId);
          if (neg) return { ok: false, error: `Insufficient stock: ${neg}` };
        }
        // A purchase is a payable, so it names the supplier it is owed to. The receipt number is
        // issued here rather than typed: two farms must not raise the same purchase number. The
        // form passes the one the counter gave it; without that, this device numbers the row.
        const namedSupplier = e.kind === 'FEED_IN' ? e.supplier?.trim() ?? '' : null;
        if (e.kind === 'FEED_IN' && !namedSupplier) return { ok: false, error: 'Record the supplier this stock was bought from' };
        const receipt: Partial<Pick<FeedStockEntry, 'supplier' | 'purchaseRef'>> = namedSupplier === null ? {}
          : {
            supplier: namedSupplier,
            purchaseRef: opts?.purchaseRef || nextPurchaseRef(get().feedStock, companyId, e.date),
          };
        const entry: FeedStockEntry = {
          ...e, ...receipt, qtyKg, companyId, id: uid('fs'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ feedStock: [...s.feedStock, entry], audit: audit(s, 'FeedStock', entry.id, 'CREATE') }));
        return { ok: true };
      },
      addIngredientType: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, error: 'Enter an ingredient name' };
        if (get().ingredientCatalog.some(i => i.toLowerCase() === trimmed.toLowerCase())) return { ok: true, added: false };
        set(s => ({ ingredientCatalog: [...s.ingredientCatalog, trimmed] }));
        return { ok: true, added: true };
      },

      /* ============================= MEDICINES & VACCINES =============================
       * The godown's pattern, on its own ledger: a receipt raises stock and a supplier
       * payable, an issue takes stock off the shelf and charges the flock, and the money
       * that settles a receipt is written by Finance alone. No row here does two jobs.
       */

      addMedicineItem: (draft) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('create')) return { ok: false, error: 'Your role cannot add items to the medicine store' };
        const name = draft.name.trim();
        if (!name) return { ok: false, error: 'Enter the medicine or vaccine name' };
        if (!MEDICINE_UNITS.includes(draft.unit)) return { ok: false, error: 'Choose the unit this is counted in' };
        // A stock row is keyed by id, so a name is only ever a label — but two products
        // called the same thing in one store is how a dose ends up on the wrong shelf.
        if (get().medicineItems.some(i => i.companyId === companyId && i.name.toLowerCase() === name.toLowerCase())) {
          return { ok: false, error: `${name} is already in this store` };
        }
        const id = uid('mi');
        const item: MedicineItem = {
          id, companyId, name, category: draft.category, unit: draft.unit,
          active: draft.active !== false,
          lowStockThreshold: Math.max(0, numOf(draft.lowStockThreshold)),
          specifications: draft.specifications?.trim() || undefined,
          remarks: draft.remarks?.trim() || undefined,
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), updatedAt: nowISO(),
        };
        set(s => ({
          medicineItems: [...s.medicineItems, item],
          audit: audit(s, 'MedicineItem', id, 'CREATE', undefined, undefined, `${name} (${item.unit})`),
        }));
        return { ok: true, id };
      },

      updateMedicineItem: (id, patch) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const guard = editGuard();
        if (guard) return guard;
        const prev = get().medicineItems.find(i => i.id === id && i.companyId === companyId);
        if (!prev) return { ok: false, error: 'Item not found' };
        const name = patch.name === undefined ? prev.name : patch.name.trim();
        if (!name) return { ok: false, error: 'Enter the medicine or vaccine name' };
        if (get().medicineItems.some(i => i.companyId === companyId && i.id !== id && i.name.toLowerCase() === name.toLowerCase())) {
          return { ok: false, error: `${name} is already in this store` };
        }
        const next: MedicineItem = {
          ...prev, name,
          category: patch.category ?? prev.category,
          unit: patch.unit && MEDICINE_UNITS.includes(patch.unit) ? patch.unit : prev.unit,
          active: patch.active ?? prev.active,
          lowStockThreshold: patch.lowStockThreshold === undefined
            ? prev.lowStockThreshold : Math.max(0, numOf(patch.lowStockThreshold)),
          specifications: patch.specifications === undefined ? prev.specifications : patch.specifications.trim() || undefined,
          remarks: patch.remarks === undefined ? prev.remarks : patch.remarks.trim() || undefined,
          updatedAt: nowISO(),
        };
        const changes = protectedChanges(prev, next,
          ['name', 'category', 'unit', 'active', 'lowStockThreshold', 'specifications', 'remarks']);
        if (!changes.length) return { ok: true };
        set(s => ({
          medicineItems: s.medicineItems.map(i => i.id === id ? next : i),
          audit: auditChanges(s, 'MedicineItem', id, changes),
        }));
        return { ok: true };
      },

      /** Retire a product. Its ledger rows stand, so a settled cupboard still reads its own history. */
      setMedicineItemActive: (id, active) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const guard = editGuard();
        if (guard) return guard;
        const prev = get().medicineItems.find(i => i.id === id && i.companyId === companyId);
        if (!prev) return { ok: false, error: 'Item not found' };
        if (prev.active === active) return { ok: true };
        set(s => ({
          medicineItems: s.medicineItems.map(i => i.id === id ? { ...i, active, updatedAt: nowISO() } : i),
          audit: auditChanges(s, 'MedicineItem', id, [{ field: 'active', oldValue: prev.active, newValue: active }]),
        }));
        return { ok: true };
      },

      receiveMedicine: (draft, opts) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('create')) return { ok: false, error: 'Your role cannot receive stock' };
        const item = medicineItemOf(draft.medicineId);
        if (!item) return { ok: false, error: 'Choose the medicine or vaccine' };
        if (!draft.date) return { ok: false, error: 'Choose the date it arrived' };
        const qty = numOf(draft.qty);
        if (!(qty > 0)) return { ok: false, error: 'Quantity must be greater than 0' };
        // A rate of zero is not a free purchase, it is a rate nobody wrote down.
        const rate = numOf(draft.ratePerUnit) > 0 ? numOf(draft.ratePerUnit) : null;
        const supplier = draft.supplier.trim();
        if (!supplier) return { ok: false, error: 'Record the supplier this stock was bought from' };
        if (draft.expiryDate && draft.expiryDate < draft.date) {
          return { ok: false, error: 'The expiry date is before the day it arrived' };
        }
        const purchaseRef = opts?.purchaseRef || nextMedicineRef(get().medicineStock, companyId, draft.date);
        const entry: MedicineStockEntry = {
          id: uid('ms'), companyId, medicineId: item.id, date: draft.date, kind: 'RECEIPT', qty,
          ratePerUnit: rate ?? undefined, supplier, purchaseRef,
          lotNumber: draft.lotNumber?.trim() || undefined,
          expiryDate: draft.expiryDate || undefined,
          remarks: draft.remarks?.trim() || undefined,
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        // Stock and the payable only. Cash, bank and every expense total are untouched,
        // because buying something and paying for it are two events on this farm.
        set(s => ({
          medicineStock: [...s.medicineStock, entry],
          audit: audit(s, 'MedicineStock', entry.id, 'CREATE', undefined, undefined,
            `${item.name} ${fmtIN(qty)} ${item.unit} from ${supplier}`),
        }));
        return { ok: true, id: entry.id, purchaseRef };
      },

      /**
       * Stock off the shelf and onto the flock's account. The cost is derived here and
       * nowhere else: nothing from this write reaches the Finance ledger, so a medicine
       * usage cannot be counted twice — once as stock and once as a typed expense.
       */
      useMedicine: (draft) => {
        if (!can('create')) return { ok: false, error: 'Your role cannot record medicine usage' };
        const built = medicineIssueRow(draft);
        if (!built.ok) return built;
        const { entry, expense, item } = built;
        set(s => ({
          medicineStock: [...s.medicineStock, entry],
          audit: audit(s, 'MedicineStock', entry.id, 'CREATE', undefined, undefined, medicineIssueSummary(item, entry, expense)),
        }));
        return { ok: true, id: entry.id, expense };
      },

      adjustMedicine: (draft) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('create')) return { ok: false, error: 'Your role cannot adjust medicine stock' };
        const item = medicineItemOf(draft.medicineId);
        if (!item) return { ok: false, error: 'Choose the medicine or vaccine' };
        if (!draft.date) return { ok: false, error: 'Choose the date of the correction' };
        const qty = numOf(draft.qty);
        if (!qty) return { ok: false, error: 'Enter the correction, positive or negative' };
        const reason = draft.reason.trim();
        if (!reason) return { ok: false, error: 'Say why the count is being corrected' };
        const balance = medicineBasis(get().medicineStock.filter(m => m.companyId === companyId), item.id, draft.date).stock;
        if (balance + qty < 0) {
          return { ok: false, error: `Only ${fmtIN(balance)} ${item.unit} in stock — this correction would take the shelf below zero` };
        }
        const entry: MedicineStockEntry = {
          id: uid('ms'), companyId, medicineId: item.id, date: draft.date, kind: 'ADJUSTMENT', qty,
          reason, remarks: draft.remarks?.trim() || undefined,
          usedBy: me()?.name, createdBy: me()?.id ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        set(s => ({
          medicineStock: [...s.medicineStock, entry],
          audit: audit(s, 'MedicineStock', entry.id, 'CREATE', undefined, undefined,
            `${item.name} ${qty > 0 ? '+' : '−'}${fmtIN(Math.abs(qty))} ${item.unit} · ${reason}`),
        }));
        return { ok: true, id: entry.id };
      },

      sendSupportMessage: (input) => {
        const message = input.message.trim();
        if (!input.name.trim() || !message) return { ok: false, error: 'Name and message required' };
        const { session, users } = get();
        const sender = users.find(u => u.id === session?.userId);
        const msg: SupportMessage = {
          id: uid('msg'),
          name: input.name.trim(),
          mobile: input.mobile?.trim() || undefined,
          subject: input.subject?.trim() || undefined,
          message,
          userId: sender?.id,
          companyId: session?.companyId ?? undefined,
          role: sender?.role,
          at: nowISO(),
        };
        set(s => ({ supportMessages: [msg, ...s.supportMessages] }));
        return { ok: true };
      },
      markSupportHandled: (id) => {
        const msg = get().supportMessages.find(m => m.id === id);
        if (!msg) return { ok: false, error: 'Message not found' };
        const by = get().users.find(u => u.id === get().session?.userId);
        set(s => ({
          supportMessages: s.supportMessages.map(m =>
            m.id === id ? { ...m, handledAt: nowISO(), handledBy: by?.name ?? 'Platform team' } : m),
        }));
        return { ok: true };
      },
      canManageFormula,
      formulaHasConsumption: (id: string) => {
        const f = get().feedFormulas.find(x => x.id === id);
        return f ? hasConsumption(f) : false;
      },
      createFeedFormula: (input) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!canManageFormula(input.shedId)) return { ok: false, error: 'You cannot manage formulas for this shed' };
        const invalid = formulaError(input);
        if (invalid) return { ok: false, error: invalid };
        const id = uid('ff');
        const formula: FeedFormula = {
          id, companyId, shedId: input.shedId, name: input.name.trim(),
          familyId: id, version: 1, effectiveFrom: input.effectiveFrom || todayISO(),
          status: 'ACTIVE', items: normalizeItems(input.items), changeReason: input.changeReason,
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), updatedAt: nowISO(),
        };
        set(s => ({
          feedFormulas: [
            ...deactivateOther(s.feedFormulas, input.shedId),
            formula,
          ],
          audit: audit(s, 'FeedFormula', id, 'CREATE', undefined, undefined, { name: formula.name, shedId: formula.shedId, totalKg: formulaTotalKg(formula.items) }),
        }));
        return { ok: true, id, version: 1 };
      },

      reviseFeedFormula: (formulaId, input) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const existing = get().feedFormulas.find(f => f.id === formulaId && f.companyId === companyId);
        if (!existing) return { ok: false, error: 'Formula not found' };
        // A version that already fed is tied to its shed for history; an unused one may move.
        const used = hasConsumption(existing);
        const shedId = used ? existing.shedId : (input.shedId || existing.shedId);
        if (!canManageFormula(shedId)) return { ok: false, error: 'You cannot manage formulas for this shed' };
        const invalid = formulaError({ ...input, shedId });
        if (invalid) return { ok: false, error: invalid };
        const items = normalizeItems(input.items);
        const name = input.name.trim() || existing.name;

        if (!used) {
          // Nothing has consumed this version yet, so a plain correction is safe.
          set(s => ({
            feedFormulas: s.feedFormulas.map(f => f.id === formulaId
              ? { ...f, name, shedId, items, effectiveFrom: input.effectiveFrom || f.effectiveFrom, changeReason: input.changeReason ?? f.changeReason, updatedAt: nowISO() }
              : f),
            audit: audit(s, 'FeedFormula', formulaId, 'UPDATE', 'items', existing.items, items),
          }));
          return { ok: true, id: formulaId, version: existing.version };
        }

        const family = get().feedFormulas.filter(f => f.familyId === existing.familyId);
        const version = Math.max(...family.map(f => f.version)) + 1;
        // An ACTIVE formula is replaced by the new version; a superseded one is amended alongside.
        const status: FeedFormula['status'] = existing.status;
        const next: FeedFormula = {
          ...existing, id: uid('ff'), name, items, version, status,
          effectiveFrom: input.effectiveFrom || todayISO(), changeReason: input.changeReason,
          supersededAt: undefined, createdBy: me()?.id ?? 'system', createdAt: nowISO(), updatedAt: nowISO(),
        };
        set(s => ({
          feedFormulas: [
            ...(status === 'ACTIVE' ? deactivateOther(s.feedFormulas, shedId) : s.feedFormulas),
            next,
          ],
          audit: audit(s, 'FeedFormula', next.id, 'CREATE', undefined, existing.items, next.items),
        }));
        return { ok: true, id: next.id, version };
      },

      duplicateFeedFormula: (formulaId, { name, shedId }) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const existing = get().feedFormulas.find(f => f.id === formulaId && f.companyId === companyId);
        if (!existing) return { ok: false, error: 'Formula not found' };
        const target = shedId ?? existing.shedId;
        if (!canManageFormula(target)) return { ok: false, error: 'You cannot manage formulas for this shed' };
        const id = uid('ff');
        const copy: FeedFormula = {
          ...existing, id, familyId: id, companyId, shedId: target,
          name: name.trim() || `${existing.name} (copy)`,
          version: 1, status: 'INACTIVE', effectiveFrom: todayISO(), supersededAt: undefined,
          items: existing.items.map(i => ({ ...i })),
          changeReason: `Duplicated from ${existing.name} V${existing.version}`,
          createdBy: me()?.id ?? 'system', createdAt: nowISO(), updatedAt: nowISO(),
        };
        set(s => ({
          feedFormulas: [...s.feedFormulas, copy],
          audit: audit(s, 'FeedFormula', id, 'CREATE', undefined, undefined, { from: existing.id }),
        }));
        return { ok: true, id, version: 1 };
      },

      setFormulaActive: (formulaId, active) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const existing = get().feedFormulas.find(f => f.id === formulaId && f.companyId === companyId);
        if (!existing) return { ok: false, error: 'Formula not found' };
        if (!canManageFormula(existing.shedId)) return { ok: false, error: 'You cannot manage formulas for this shed' };
        set(s => ({
          feedFormulas: (active ? deactivateOther(s.feedFormulas, existing.shedId, formulaId) : s.feedFormulas).map(f =>
            f.id === formulaId
              ? { ...f, status: active ? 'ACTIVE' as const : 'INACTIVE' as const, updatedAt: nowISO() }
              : f),
          audit: audit(s, 'FeedFormula', formulaId, 'UPDATE', 'status', existing.status, active ? 'ACTIVE' : 'INACTIVE'),
        }));
        return { ok: true };
      },

      addFinance: (t) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance')) return { ok: false, error: 'You cannot record finance entries' };
        if (t.amount === 0) return { ok: false, error: 'Amount cannot be zero' };
        const problem = accountabilityError(t);
        if (problem) return { ok: false, error: problem };
        const entry: FinanceTxn = {
          ...t, companyId, id: uid('fx'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ finance: [...s.finance, entry], audit: audit(s, 'Finance', entry.id, 'CREATE') }));
        return { ok: true };
      },

      updateFinance: (id, patch, reason) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance')) return { ok: false, error: 'You cannot change finance entries' };
        const prev = get().finance.find(t => t.id === id && t.companyId === companyId);
        if (!prev) return { ok: false, error: 'Transaction not found' };
        if (prev.refId) return { ok: false, error: 'This row belongs to a sale entry — correct it from the sale' };
        const next: FinanceTxn = { ...prev, ...patch, id: prev.id, companyId: prev.companyId };
        const problem = accountabilityError(next);
        if (problem) return { ok: false, error: problem };
        const changes = protectedChanges(prev, next, PROTECTED_FINANCE);
        if (changes.length && !reason?.trim()) return { ok: false, error: 'Give the reason for this correction' };
        set(s => ({
          finance: s.finance.map(t => t.id === id ? { ...next, synced: s.online ? prev.synced : false } : t),
          audit: auditChanges(s, 'Finance', id, changes, reason?.trim()),
        }));
        return { ok: true };
      },

      assignFinance: (id, target) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance')) return { ok: false, error: 'You cannot map finance entries' };
        const existing = get().finance.find(t => t.id === id && t.companyId === companyId);
        if (!existing) return { ok: false, error: 'Transaction not found' };
        const mapped = { batchId: target.batchId, godown: target.godown ? true : undefined };
        set(s => ({
          finance: s.finance.map(t => t.id === id ? { ...t, ...mapped, synced: s.online ? t.synced : false } : t),
          audit: audit(s, 'Finance', id, 'UPDATE', 'mapping'),
        }));
        return { ok: true };
      },

      /**
       * The next reference in a receipt series, claimed from the database counter while it can be
       * reached. Offline, the store numbers from its own high water instead — unique on this
       * device and nothing more, which the caller is told rather than quietly assumed.
       */
      takeReceiptNo: async (scope, date) => {
        const companyId = cid();
        if (!companyId || !date) return '';
        // The store's own fallback: the highest reference this device holds for the series. It
        // also goes to the counter as a floor, so records numbered before the counter existed —
        // or while this device was offline — are never numbered over.
        const taken = scope === 'PUR' ? purchaseReceiptHighWater(get().feedStock, companyId, date)
          : scope === 'MED' ? medicineReceiptHighWater(get().medicineStock, companyId, date)
            // One CR series across the four tables a cash receipt can stand in, exactly so one
            // collection cannot be handed two numbers by the screen that recorded it.
            : receiptHighWater([
              ...get().finance.filter(t => t.companyId === companyId).map(t => t.reference),
              ...get().traderTxns.filter(t => t.companyId === companyId).map(t => t.reference),
              ...get().saleEntries.filter(e => e.companyId === companyId).map(e => e.cashReference),
              ...get().cashHandovers.filter(h => h.companyId === companyId).map(h => h.reference),
            ], 'CR', date);
        const local = () => {
          const key = `${companyId}|${scope}|${date}`;
          const shown = Math.max(taken, receiptClaims.get(key) ?? 0) + 1;
          receiptClaims.set(key, shown);
          return receiptNo(scope, date, shown);
        };
        if (!get().online) return local();
        const a = await allocateReceiptNo(companyId, scope, date, taken);
        if (a.kind === 'numbered') {
          // Remember what the counter handed this device too: if the wire drops before the row
          // saves, the number it falls back to must still sit past the one already in the form.
          const seq = Number.parseInt(a.ref.slice(`${scope}-${date}-`.length), 10);
          if (Number.isFinite(seq)) {
            const key = `${companyId}|${scope}|${date}`;
            receiptClaims.set(key, Math.max(receiptClaims.get(key) ?? 0, seq));
          }
          return a.ref;
        }
        if (a.kind === 'local') {
          if (a.note) get().pushToast('info', a.note);
          return local();
        }
        // §20: the counter said no, so nothing is booked and no number is invented. The reason
        // and what to do about it come from the normalizer — never from a blind "save again",
        // which would mint a second reference for the same money.
        get().pushToast('error', a.error, a.detail);
        return '';
      },

      recordPurchasePayment: (input) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance')) return { ok: false, error: 'Only Finance/Owner can record a payment' };
        // A payable is a payable whichever store raised it: the money row is written the same
        // way, and the receipt it settles is never restated by the payment.
        const feedEntry = get().feedStock.find(e => e.id === input.purchaseId && e.companyId === companyId);
        const medEntry = get().medicineStock.find(e => e.id === input.purchaseId && e.companyId === companyId);
        if (!feedEntry && !medEntry) return { ok: false, error: 'Select the purchase this payment settles' };
        const entry = medEntry ? asLedgerRow(medEntry) : feedEntry!;
        if (entry.kind !== 'FEED_IN') return { ok: false, error: 'Only a stock purchase carries a payable' };
        const position = purchasePosition(entry, get().finance.filter(t => t.companyId === companyId));
        // No rate means no purchase value, and a value we cannot state is not a payable to pay.
        if (position.value === null) return { ok: false, error: 'This purchase carries no receipt rate, so there is no amount to pay' };
        const amount = numOf(input.amount);
        if (!(amount > 0)) return { ok: false, error: 'Enter the amount paid' };
        if ((position.outstanding ?? 0) > 0 && amount > (position.outstanding ?? 0)) {
          return { ok: false, error: `Only ${fmtMoney(position.outstanding ?? 0)} is still due on this purchase` };
        }
        const row: FinanceTxn = {
          id: uid('fx'), companyId, date: input.date, kind: 'PAYMENT_OUT',
          amount: money(amount),
          category: medEntry ? MEDICINE_PURCHASE_CATEGORY : FEED_PURCHASE_CATEGORY, godown: true,
          counterparty: entry.supplier || undefined,
          purchaseId: entry.id,
          paymentMethod: input.paymentMethod, time: input.time,
          handledById: input.handledById, handedTo: input.handedTo,
          authorizedById: input.authorizedById, reference: input.reference,
          remarks: input.remarks,
          createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        const problem = accountabilityError(row);
        if (problem) return { ok: false, error: problem };
        // Stock, the purchase value and the P&L are all untouched: this row is only the money
        // that left, and the payable it closes is read back off the ledger.
        set(s => ({
          finance: [...s.finance, row],
          audit: audit(s, 'Finance', row.id, 'CREATE', 'purchaseId', undefined, entry.purchaseRef ?? row.purchaseId),
        }));
        return { ok: true };
      },

      recordSalePayment: (input) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance') || !can('manageTraders')) return { ok: false, error: 'Only Finance/Owner can record a receipt against a sale' };
        const entry = get().saleEntries.find(e => e.id === input.saleId && e.companyId === companyId);
        if (!entry) return { ok: false, error: 'Select the sale this money was received against' };
        const trader = get().traders.find(t => t.id === entry.traderId && t.companyId === companyId);
        if (!trader) return { ok: false, error: 'The trader on this sale is no longer in this company' };
        const txns = get().traderTxns.filter(t => t.companyId === companyId);
        const amount = numOf(input.amount);
        if (!(amount > 0)) return { ok: false, error: 'Enter the amount received' };
        const due = saleOutstanding(entry, txns);
        if (due > 0 && amount > due) return { ok: false, error: `Only ${fmtMoney(due)} is still due on this sale` };
        const by = get().session?.userId ?? 'system';
        const accountability = {
          date: input.date, amount: money(amount), paymentMethod: input.paymentMethod, time: input.time,
          handledById: input.handledById, handedTo: input.handedTo,
          authorizedById: input.authorizedById, reference: input.reference, remarks: input.remarks,
        };
        // Money in Finance, settlement on the trader's ledger — one receipt, two books, no
        // re-billing of the load it settles.
        const txn: TraderTxn = {
          ...accountability, id: uid('tt'), companyId, traderId: trader.id,
          kind: 'PAYMENT_IN', saleId: entry.id, createdBy: by, createdAt: nowISO(), synced: get().online,
        };
        const fin: FinanceTxn = {
          ...accountability, id: uid('fx'), companyId, kind: 'PAYMENT_IN',
          category: 'Egg Sale', counterparty: trader.name, saleId: entry.id,
          createdBy: by, createdAt: nowISO(), synced: get().online,
        };
        const problem = accountabilityError(txn) ?? accountabilityError(fin);
        if (problem) return { ok: false, error: problem };
        set(s => {
          const traderTxns = [...s.traderTxns, txn];
          return {
            finance: [...s.finance, fin],
            traderTxns,
            traders: rebalanceTraders(s.traders, traderTxns),
            audit: audit(s, 'Finance', fin.id, 'CREATE', 'saleId', undefined, entry.id),
          };
        });
        return { ok: true };
      },

      cashPeople: () => {
        const companyId = cid();
        if (!companyId) return [];
        return get().users
          .filter(u => u.active && u.companyIds.includes(companyId))
          .sort((a, b) => a.name.localeCompare(b.name));
      },

      addCashHandover: (h) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance')) return { ok: false, error: 'You cannot record a cash handover' };
        const amount = numOf(h.amount);
        if (!(amount > 0)) return { ok: false, error: 'Enter the amount handed over' };
        if (!h.fromUserId || !h.toUserId) return { ok: false, error: 'Record who gave the cash and who took it' };
        if (h.fromUserId === h.toUserId) return { ok: false, error: 'The cash has to go to a different person' };
        const row: CashHandover = {
          ...h, amount: money(amount), companyId, id: uid('ch'),
          createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        set(s => ({
          cashHandovers: [...s.cashHandovers, row],
          audit: audit(s, 'CashHandover', row.id, 'CREATE', 'amount', undefined, row.amount),
        }));
        return { ok: true };
      },

      recordCashCount: ({ date, physicalCash, remarks }) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('viewFinance')) return { ok: false, error: 'You cannot close off the cash for the day' };
        if (!date) return { ok: false, error: 'Enter the date being counted' };
        if (!Number.isFinite(physicalCash) || physicalCash < 0) return { ok: false, error: 'Enter the cash counted, or 0' };
        // Expected is read off the ledger, never typed: the count only says what was in hand.
        const expected = cashPositionOf(get().finance.filter(t => t.companyId === companyId), date);
        const difference = money(physicalCash - expected);
        const by = get().session?.userId ?? 'system';
        set(s => {
          const prev = s.cashCounts.find(c => c.companyId === companyId && c.date === date);
          if (prev) {
            return {
              cashCounts: s.cashCounts.map(c => c.id === prev.id
                ? { ...c, physicalCash, expectedCash: expected, difference, closedById: by, remarks, updatedAt: nowISO(), synced: s.online ? c.synced : false }
                : c),
              audit: auditChanges(s, 'CashCount', prev.id, protectedChanges(prev, { ...prev, physicalCash, difference }, ['physicalCash', 'difference']), remarks?.trim()),
            };
          }
          const row: CashCount = {
            id: uid('cc'), companyId, date, physicalCash, expectedCash: expected, difference,
            closedById: by, remarks, createdBy: by, createdAt: nowISO(), synced: s.online,
          };
          return {
            cashCounts: [...s.cashCounts, row],
            audit: audit(s, 'CashCount', row.id, 'CREATE', 'difference', undefined, row.difference),
          };
        });
        return { ok: true };
      },

      /* ============================= TRADERS ============================= */

      addTrader: (t) => {
        const companyId = cid();
        if (!companyId) return null;
        if (!can('manageTraders')) return null;
        const trader: Trader = { ...t, companyId, id: uid('tr'), createdAt: nowISO(), updatedAt: nowISO() };
        const txns: TraderTxn[] = trader.openingBalance
          ? [{ id: uid('tt'), companyId, traderId: trader.id, date: todayISO(), kind: 'OPENING', amount: trader.openingBalance, remarks: 'Opening balance', createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online }]
          : [];
        set(s => {
          const traderTxns = [...s.traderTxns, ...txns];
          return {
            traders: rebalanceTraders([...s.traders, trader], traderTxns),
            traderTxns,
            audit: audit(s, 'Trader', trader.id, 'CREATE'),
          };
        });
        return trader;
      },
      updateTrader: (id, patch) => {
        const companyId = cid();
        set(s => ({
          traders: rebalanceTraders(s.traders.map(t => t.id === id && t.companyId === companyId ? { ...t, ...patch, updatedAt: nowISO() } : t), s.traderTxns),
        }));
      },
      addTraderTxn: (t) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('manageTraders')) return { ok: false, error: 'Only Finance/Owner manage traders' };
        const problem = accountabilityError(t);
        if (problem) return { ok: false, error: problem };
        // A ledger row is only ever about a trader this farm trades with: writing one against
        // another company's id would rebalance that trader's balance from the wrong terminal.
        if (!get().traders.some(x => x.id === t.traderId && x.companyId === companyId)) {
          return { ok: false, error: 'Select the trader this entry is for' };
        }
        const entry: TraderTxn = {
          ...t, companyId, id: uid('tt'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => {
          const traderTxns = [...s.traderTxns, entry];
          return {
            traderTxns,
            traders: rebalanceTraders(s.traders, traderTxns),
            audit: audit(s, 'TraderTxn', entry.id, 'CREATE'),
          };
        });
        return { ok: true };
      },

      updateTraderTxn: (id, patch, reason) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('manageTraders')) return { ok: false, error: 'Only Finance/Owner manage traders' };
        const prev = get().traderTxns.find(t => t.id === id && t.companyId === companyId);
        if (!prev) return { ok: false, error: 'Transaction not found' };
        if (prev.refId) return { ok: false, error: 'This row belongs to a sale entry — correct it from the sale' };
        const next: TraderTxn = { ...prev, ...patch, id: prev.id, companyId: prev.companyId, traderId: prev.traderId, kind: prev.kind };
        const problem = accountabilityError(next);
        if (problem) return { ok: false, error: problem };
        const changes = protectedChanges(prev, next, PROTECTED_TRADER_TXN);
        if (changes.length && !reason?.trim()) return { ok: false, error: 'Give the reason for this correction' };
        set(s => {
          // The balance is read back off the ledger, so a corrected payment rebalances the trader on its own.
          const traderTxns = s.traderTxns.map(t => t.id === id ? { ...next, synced: s.online ? prev.synced : false } : t);
          return {
            traderTxns,
            traders: rebalanceTraders(s.traders, traderTxns),
            audit: auditChanges(s, 'TraderTxn', id, changes, reason?.trim()),
          };
        });
        return { ok: true };
      },

      /* ============================= TASKS ============================= */

      addTask: (t) => {
        const companyId = cid();
        if (!companyId) return null;
        if (!can('createDailyOps')) return null;
        const task: FarmTask = {
          ...t, companyId, id: uid('tk'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), updatedAt: nowISO(), synced: get().online,
        };
        set(s => ({ tasks: [...s.tasks, task], audit: audit(s, 'Task', task.id, 'CREATE') }));
        return task;
      },
      updateTask: (id, patch) => {
        const companyId = cid();
        set(s => ({
          tasks: s.tasks.map(t => t.id === id && t.companyId === companyId ? { ...t, ...patch, updatedAt: nowISO(), synced: s.online && t.synced } : t),
        }));
      },
      deleteTask: (id) => {
        const companyId = cid();
        set(s => ({
          tasks: s.tasks.filter(t => !(t.id === id && t.companyId === companyId)),
          audit: audit(s, 'Task', id, 'DELETE'),
        }));
      },

      /* ============================= BACKUP ============================= */

      /**
       * Built from the live cache, which is already exactly this company's rows as the database
       * holds them — so the file and the sync can never disagree about what a record is. Money a
       * role may not read is left out and named in `omitted`, which is the same judgement the
       * push engine makes when it refuses to send such a slice.
       */
      exportCompanyBackup: () => {
        if (!can('exportReports')) return { ok: false, error: 'Your role cannot export company data.' };
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'Choose a company first.' };
        const user = me();
        const { file, omitted } = buildBackup({
          companyId,
          companyName: get().companies.find(c => c.id === companyId)?.name ?? companyId,
          userId: get().session?.userId ?? 'system',
          userName: user?.name ?? get().session?.userId ?? 'system',
          role: user?.role,
          appVersion: runtime.version,
          storeVersion: PERSIST_VERSION,
          nowIso: nowISO(),
          state: get() as unknown as Record<string, unknown[]>,
          profile: BACKUP_PROFILE,
          canRead: def => roleReadable(user?.role, def),
        });
        const records = Object.values(file.recordCounts).reduce((a, n) => a + n, 0);
        set(s => ({
          audit: [
            auditStep(s, 'BACKUP_CREATED', 'Backup', companyId,
              `${records} records across ${Object.keys(file.recordCounts).length} record types`,
              omitted.length ? `${omitted.length} record type(s) left out: ${omitted.map(o => `${o.slice} (${o.reason})`).join(', ')}` : undefined),
            ...s.audit,
          ].slice(0, 500),
        }));
        return { ok: true, file, omitted };
      },

      /** Reads a candidate file and says what restoring it would change. Writes nothing. */
      checkBackupFile: (json) => {
        const companyId = cid();
        const user = me();
        if (!companyId) {
          return {
            ok: false, company: null, meta: null, plans: [],
            issues: [{ code: 'COMPANY', level: 'error', message: 'Choose a company before checking a backup.' }],
            totals: { fileRows: 0, add: 0, change: 0, same: 0, kept: 0 },
          };
        }
        return validateBackup(json, {
          companyId,
          state: get() as unknown as Record<string, unknown[]>,
          canRead: def => roleReadable(user?.role, def),
          storeVersion: PERSIST_VERSION,
          profile: BACKUP_PROFILE,
        });
      },

      /**
       * The plan the person already watched being previewed, applied row by row. The company is
       * checked again here rather than trusted from the reading, because the context can move
       * between those two moments and a file for another farm must never land in this one's
       * books. Rows arrive unsynced, so the sync sends them and the other devices receive them.
       */
      restoreCompanyBackup: (plan, summary) => {
        if (!can('delete')) return { ok: false, error: 'Only an owner may restore company data.' };
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'Choose a company first.' };
        if (plan.companyId !== companyId) {
          return {
            ok: false,
            error: `This backup belongs to ${plan.companyId}, not the company you are working in (${companyId}). It was not restored.`,
          };
        }
        const written = Object.values(plan.writes).reduce((n, rows) => n + rows.length, 0);
        if (!written) return { ok: false, error: 'There is nothing left in this plan to write.' };

        set(s => ({
          audit: [auditStep(s, 'RESTORE_STARTED', 'Backup', companyId, summary), ...s.audit].slice(0, 500),
        }));

        try {
          const touched = new Set(Object.keys(plan.writes));
          set(s => {
            const patch: Record<string, unknown> = {};
            for (const [slice, rows] of Object.entries(plan.writes)) {
              const live = (s as unknown as Record<string, unknown[]>)[slice];
              const current = Array.isArray(live) ? live : [];
              const byId = new Map(rows.map(r => [rowId(r), r]));
              const ids = new Set(current.map(r => rowId(r)));
              // A row already here is replaced where it stands; a row the company does not have
              // is appended. Nothing is dropped to make room, so a colleague's later entry
              // — one the file never saw — survives its own backup's restore.
              patch[slice] = [
                ...current.map(r => { const f = byId.get(rowId(r)); return f ? { ...f, synced: false } : r; }),
                ...rows.filter(r => !ids.has(rowId(r))),
              ];
            }
            return patch as Partial<AppState>;
          });

          // A trader's balance has no column anywhere: it is a cache of that trader's ledger, so
          // a restore that moved money must rebuild it or the home screen reads the old dues off
          // a stale cache. The same call the pull makes, for the same reason.
          if (touched.has('traders') || touched.has('traderTxns')) {
            const next = get() as unknown as Record<string, unknown>;
            set({ traders: rebalanceTraders(next.traders as Trader[], next.traderTxns as TraderTxn[], false) } as Partial<AppState>);
          }

          const counts = Object.entries(plan.counts)
            .map(([slice, c]) => `${SLICE_LABELS[slice] ?? slice}: ${c.add} new, ${c.change} changed`)
            .join('; ');
          set(s => ({
            audit: [
              auditStep(s, 'RESTORE_COMPLETED', 'Backup', companyId,
                `${written} records restored — ${counts}`, summary),
              ...s.audit,
            ].slice(0, 500),
          }));
          return { ok: true };
        } catch (e) {
          // The failure is on the trail beside the attempt: a restore that stopped halfway is
          // exactly the thing a later reader needs to find.
          const reason = e instanceof Error ? e.message : String(e);
          set(s => ({
            audit: [
              auditStep(s, 'RESTORE_FAILED', 'Backup', companyId,
                `Restore stopped: ${reason}`, summary),
              ...s.audit,
            ].slice(0, 500),
          }));
          return { ok: false, error: reason };
        }
      },

      syncPending: () => set(s => ({
        mortality: s.mortality.map(m => ({ ...m, synced: true })),
        feed: s.feed.map(f => ({ ...f, synced: true })),
        feedRounds: s.feedRounds.map(f => ({ ...f, synced: true })),
        eggs: s.eggs.map(e => ({ ...e, synced: true })),
        saleLogs: s.saleLogs.map(e => ({ ...e, synced: true })),
        saleEntries: s.saleEntries.map(x => ({ ...x, synced: true })),
        eggSaleBookings: s.eggSaleBookings.map(x => ({ ...x, synced: true })),
        feedStock: s.feedStock.map(x => ({ ...x, synced: true })),
        medicineStock: s.medicineStock.map(x => ({ ...x, synced: true })),
        finance: s.finance.map(x => ({ ...x, synced: true })),
        traderTxns: s.traderTxns.map(x => ({ ...x, synced: true })),
        tasks: s.tasks.map(x => ({ ...x, synced: true })),
        vaccinations: s.vaccinations.map(x => ({ ...x, synced: true })),
      })),

      resetDemo: () => set({ ...baseSeed(), session: null }),
    };
  },
  {
    name: 'amrut-poultry-v1',
    // v7: a sale entry bills the loading labour on the load and can adjust a trader's
    // advance against it, so the credit left behind is derived, never typed.
    // v8: trader balances are read back off their ledger, which heals the saves where the
    // stored running total had drifted away from the rows beneath it.
    // v9: a batch gains the approximate daily intake the godown's coverage forecast reads.
    // v10: a voucher states on its own ledger rows how the money physically arrived — cash,
    // online, advance — and whose hands it went through, replacing the prose remarks the
    // split used to live in.
    // v11: a godown purchase is a stock event and its payment is a separate money event, so
    // existing receipts are issued purchase numbers to be paid against.
    // v12: each batch carries its own vaccination schedule, and the farm keeps templates to
    // start one from. Both arrive as new slices, so an older save simply gains them.
    // v13: the egg sale planner gains its own slice of promised trays. Nothing is migrated
    // out of an older save — a plan is never inferred from history.
    // v14: the medicine & vaccine store is a ledger of its own, so it arrives as two new
    // slices. An older save simply gains them; nothing on it is rewritten.
    // v15: a load's price is read as ₹ per egg off its egg money, so the sale rows a voucher
    // owns are rebuilt from that voucher. Billed and received amounts are untouched.
    // v16: every company gains its walk-in account, the trader a gate sale is booked against
    // when there is no regular buyer. Nothing existing is rewritten.
    // v17: egg wastage is a ledger of its own — trays that leave a grade with no money on
    // them. It arrives as one new slice; nothing already saved is rewritten.
    // v18: the loading labour a voucher recovers is money the shed took in, so the expense
    // row the old model wrote beside it is removed from existing saves. The wage itself is
    // the farm's own entry in Finance, dated the day the labour is paid.
    // v19: the day-lock concept is removed. Any locked-day rows an older save still holds
    // are dropped; no other data is affected and nothing is re-seeded.
    // v20: a seed person who also exists in the cloud is folded into the cloud record (joined
    // on their unique mobile) and every reference to the retired id is repointed, so an owner
    // edits the one copy that actually syncs. No financial or operational row is removed.
    version: PERSIST_VERSION,
    storage: createJSONStorage(() => localStorage),
    migrate: migrateSaved,
    partialize: (s) => {
      const { toasts, online, accessNotice, ...rest } = s;
      return rest as unknown as AppState;
    },
  },
));

/* ============================= SELECTORS / HOOKS ============================= */

export function useCurrentUser(): User | null {
  const userId = useApp(s => s.session?.userId);
  const users = useApp(s => s.users);
  return users.find(u => u.id === userId) ?? null;
}

export function useActiveCompanyId(): string | null {
  return useApp(s => s.session?.companyId ?? null);
}

/** The live answer to "may this person be working here?" — recomputed off the slices a pull
 *  refreshes, so a deactivation or a removed membership changes the app's shape immediately. */
export function useCompanyAccess(): CompanyAccess {
  const session = useApp(s => s.session);
  const user = useCurrentUser();
  const companies = useApp(s => s.companies);
  return useMemo(() => companyAccessOf(session, user, companies), [session, user, companies]);
}

/** The companies this person may enter to work, from the selector's point of view. */
export function useOperableCompanies(): Company[] {
  const user = useCurrentUser();
  const companies = useApp(s => s.companies);
  return useMemo(() => operableCompanies(user, companies), [user, companies]);
}

export function useCan(key: PermissionKey): boolean {
  const user = useCurrentUser();
  const access = useCompanyAccess();
  if (!user || !contextIntact(access)) return false;
  return DEFAULT_ROLE_PERMISSIONS[user.role]?.[key] ?? false;
}

/**
 * Company-scoped data access. Everything a screen renders should flow through
 * these so one company's data is never visible in another's context.
 *
 * The raw slices are subscribed by reference and filtered inside a memo:
 * selectors that returned freshly-built arrays broke zustand's snapshot
 * caching and made screens re-render forever.
 */
export function useCompanyData() {
  const companyId = useActiveCompanyId();
  const companies = useApp(s => s.companies);
  const farms = useApp(s => s.farms);
  const sheds = useApp(s => s.sheds);
  const batches = useApp(s => s.batches);
  const mortality = useApp(s => s.mortality);
  const eggs = useApp(s => s.eggs);
  const feed = useApp(s => s.feed);
  const feedRounds = useApp(s => s.feedRounds);
  const saleLogs = useApp(s => s.saleLogs);
  const saleEntries = useApp(s => s.saleEntries);
  const eggSaleBookings = useApp(s => s.eggSaleBookings);
  const eggWastages = useApp(s => s.eggWastages);
  const feedStock = useApp(s => s.feedStock);
  const medicineItems = useApp(s => s.medicineItems);
  const medicineStock = useApp(s => s.medicineStock);
  const feedFormulas = useApp(s => s.feedFormulas);
  const finance = useApp(s => s.finance);
  const traders = useApp(s => s.traders);
  const traderTxns = useApp(s => s.traderTxns);
  const tasks = useApp(s => s.tasks);
  const vaccinations = useApp(s => s.vaccinations);
  const vaccinationTemplates = useApp(s => s.vaccinationTemplates);
  const users = useApp(s => s.users);
  const assignments = useApp(s => s.assignments);
  const audit = useApp(s => s.audit);
  const cashHandovers = useApp(s => s.cashHandovers);
  const cashCounts = useApp(s => s.cashCounts);

  return useMemo(() => {
    const inCo = <T extends { companyId: string }>(list: T[]) =>
      list.filter(x => x.companyId === companyId);
    return {
      companyId,
      companies,
      farms: inCo(farms),
      sheds: inCo(sheds),
      batches: inCo(batches),
      mortality: inCo(mortality),
      eggs: inCo(eggs),
      feed: inCo(feed),
      feedRounds: inCo(feedRounds),
      saleLogs: inCo(saleLogs),
      saleEntries: inCo(saleEntries),
      eggSaleBookings: inCo(eggSaleBookings),
      eggWastages: inCo(eggWastages),
      feedStock: inCo(feedStock),
      medicineItems: inCo(medicineItems),
      medicineStock: inCo(medicineStock),
      feedFormulas: inCo(feedFormulas),
      finance: inCo(finance),
      traders: inCo(traders),
      traderTxns: inCo(traderTxns),
      tasks: inCo(tasks),
      vaccinations: inCo(vaccinations),
      vaccinationTemplates: inCo(vaccinationTemplates),
      assignments: inCo(assignments),
      cashHandovers: inCo(cashHandovers),
      cashCounts: inCo(cashCounts),
      audit: audit.filter(a => a.companyId === companyId),
      users: users.filter(u => u.companyIds.includes(companyId ?? '__none__')),
    };
  }, [
    companyId, companies, farms, sheds, batches, mortality, eggs, feed, feedRounds, saleLogs,
    saleEntries, eggSaleBookings, eggWastages, feedStock, medicineItems, medicineStock, feedFormulas,
    finance, traders, traderTxns, tasks,
    assignments, audit, users, cashHandovers, cashCounts,
    vaccinations, vaccinationTemplates,
  ]);
}

export function useBatchPermission(batchId: string, key: PermissionKey): boolean {
  const user = useCurrentUser();
  const assignments = useApp(s => s.assignments);
  if (!user) return false;
  if (user.role === 'OWNER') return true;
  const a = assignments.find(x => x.batchId === batchId && x.userId === user.id);
  if (a?.permissions[key]) return true;
  return DEFAULT_ROLE_PERMISSIONS[user.role]?.[key] ?? false;
}

/**
 * Sheds the signed-in user may see. A Farm Manager works only the sheds their
 * assignment places them in, so unassigned sheds never appear for them (§14);
 * every other role covers the whole company.
 */
export function useVisibleSheds(): Shed[] {
  const user = useCurrentUser();
  const { sheds, batches, assignments } = useCompanyData();
  return useMemo(() => {
    if (!user || user.role !== 'FARM_MANAGER') return sheds;
    const myBatches = new Set(assignments.filter(a => a.userId === user.id).map(a => a.batchId));
    const mySheds = new Set(batches.filter(b => myBatches.has(b.id)).map(b => b.shedId));
    return sheds.filter(s => mySheds.has(s.id));
  }, [user, sheds, batches, assignments]);
}

export function todayDate(): string { return todayISO(); }
