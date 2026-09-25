/* ============================= TENANCY & AUTH ============================= */

export interface Company {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type Role =
  | 'MASTER_ADMIN'
  | 'OWNER'
  | 'FARM_SUPERVISOR'
  | 'FINANCIAL_SUPERVISOR'
  | 'FARM_MANAGER'
  | 'FARM_LABOR';

export const ROLE_LABELS: Record<Role, string> = {
  MASTER_ADMIN: 'Master Admin',
  OWNER: 'Owner',
  FARM_SUPERVISOR: 'Farm Supervisor',
  FINANCIAL_SUPERVISOR: 'Financial Supervisor',
  FARM_MANAGER: 'Farm Manager',
  FARM_LABOR: 'Farm Labor',
};

/** Roles a Company Owner may assign within their own company. */
export const COMPANY_ASSIGNABLE_ROLES: Role[] = [
  'OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR',
];

export type PermissionKey =
  | 'create'
  | 'createDailyOps'
  | 'update'
  | 'delete'
  | 'viewFinance'
  | 'viewRates'
  | 'manageUsers'
  | 'manageCompanies'
  | 'manageTraders'
  | 'manageFormulas'
  | 'acknowledgeSales'
  | 'createSaleEntries'
  | 'closeBatch'
  | 'exportReports'
  | 'manageVaccination'
  | 'completeVaccination';

export type PermissionSet = Record<PermissionKey, boolean>;

export const NO_PERMISSIONS: PermissionSet = {
  create: false, createDailyOps: false, update: false, delete: false,
  viewFinance: false, viewRates: false,
  manageUsers: false, manageCompanies: false,
  manageTraders: false, manageFormulas: false, acknowledgeSales: false,
  createSaleEntries: false,
  closeBatch: false, exportReports: false,
  manageVaccination: false, completeVaccination: false,
};

export interface User {
  id: string;
  name: string;
  mobile: string;
  /** Stored as a lightweight hash; demo-grade, never plaintext. */
  passwordHash: string;
  role: Role;
  /** Companies this user may access. MASTER_ADMIN may be empty (global). */
  companyIds: string[];
  initials: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  userId: string;
  /** Active company context. Null only for MASTER_ADMIN before selecting one. */
  companyId: string | null;
  signedInAt: string;
}

/* ============================= OPERATIONS ============================= */

export interface Farm {
  id: string;
  companyId: string;
  name: string;
  location: string;
  contactMobile: string;
  createdAt: string;
  updatedAt: string;
}

export type ShedStatus = 'ACTIVE' | 'IDLE' | 'MAINTENANCE';

export interface Shed {
  id: string;
  companyId: string;
  farmId: string;
  name: string;
  capacity: number;
  status: ShedStatus;
  farmSupervisorId?: string;
  financialSupervisorId?: string;
  createdAt: string;
  updatedAt: string;
}

export type BirdType = 'LAYER' | 'BROILER';
export type BatchStatus = 'ACTIVE' | 'CLOSED' | 'PLANNED';

export interface BatchClosing {
  date: string;
  finalBirds: number;
  buyer?: string;
  /** @deprecated Use saleAmount instead. Kept for migration compatibility. */
  amount?: number;
  /** The bird sale income amount — persisted as a FinanceTxn on close. */
  saleAmount?: number;
  /** Quantity of birds sold in this closure. */
  saleQty?: number;
  /** Rate per bird (₹). */
  saleRatePerBird?: number;
  /** How the sale proceeds were received. */
  paymentMethod?: PaymentMethod;
  split?: PaymentSplit;
  reference?: string;
  remarks?: string;
  closedBy: string;
  closedAt: string;
}

export interface Batch {
  id: string;
  companyId: string;
  farmId: string;
  shedId: string;
  code: string;
  birdType: BirdType;
  breed: string;
  hatchDate: string;
  placementDate: string;
  startDate: string;
  initialBirds: number;
  status: BatchStatus;
  /**
   * What the owner expects this batch to eat in tonnes a day. A planning figure for the
   * godown's days-of-stock forecast — never a record of feeding, and nothing deducts stock from it.
   */
  approximateFeedTonnesPerDay?: number | null;
  managerId?: string;
  supervisorId?: string;
  closing?: BatchClosing;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What a user supplies to place a new batch; code, status and audit fields are derived. */
export type NewBatchInput = Pick<Batch,
  'farmId' | 'shedId' | 'birdType' | 'breed' | 'hatchDate' | 'placementDate' | 'initialBirds' | 'managerId' | 'supervisorId'>;

export interface BatchAssignment {
  id: string;
  companyId: string;
  batchId: string;
  userId: string;
  role: Role;
  permissions: PermissionSet;
  comments?: string;
  assignedBy: string;
  assignedAt: string;
}

export interface MortalityEntry {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  date: string;
  count: number;
  /** Who actually found/recorded the birds — editable on the labor form. */
  workerName?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/* ============================= VACCINATION =============================
 * A vaccination schedule belongs to a batch. Only three states are stored; the
 * reminder states are read off `scheduledDate` each time the record is shown, so
 * a reminder needs no notification row of its own and stops by itself once the
 * item is completed or cancelled.
 */

export type VaccinationStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

/** The stored status plus the three derived ones — what every screen badges. */
export type VaccinationState = 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export interface VaccinationItem {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  /** Days from the batch's placement date this vaccine sits on, kept for history. */
  relativeDay: number;
  vaccineName: string;
  /** The date as scheduled. Rescheduling moves it with an audit row; completion never touches it. */
  scheduledDate: string;
  reminderDaysBefore: number;
  dose?: string;
  route?: string;
  remarks?: string;
  status: VaccinationStatus;
  /** The day the vaccine was actually given. Held beside `scheduledDate`, never in place of it. */
  completedDate?: string;
  completedAt?: string;
  completedBy?: string;
  actualDose?: string;
  completionRemarks?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

/**
 * What the schedule form supplies; company, id, the flock-day and audit fields are derived
 * by the store from the batch's own placement date, so one rule reads across every write.
 */
export interface VaccinationDraft {
  vaccineName: string;
  scheduledDate: string;
  reminderDaysBefore: number;
  dose?: string;
  route?: string;
  remarks?: string;
}

/** One line of a template. A template is a starting point, never a live link. */
export interface VaccinationTemplateItem {
  relativeDay: number;
  vaccineName: string;
  reminderDaysBefore: number;
  dose?: string;
  route?: string;
  remarks?: string;
}

export interface VaccinationTemplate {
  id: string;
  companyId: string;
  name: string;
  birdType?: BirdType;
  active: boolean;
  /** Copied into a batch at placement; editing this list afterwards changes no existing schedule. */
  items: VaccinationTemplateItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* ============================= EGGS (TRAYS) ============================= */

export const EGGS_PER_TRAY = 30;

/** Egg grades. Each grade holds its own stock pool and is sold separately. */
export type EggGrade = 'GOOD' | 'BROKEN' | 'DOUBLE' | 'SMALL';

export const EGG_GRADES: EggGrade[] = ['GOOD', 'BROKEN', 'DOUBLE', 'SMALL'];

export const EGG_GRADE_LABELS: Record<EggGrade, string> = {
  GOOD: 'Good',
  BROKEN: 'Broken',
  DOUBLE: 'Double',
  SMALL: 'Small',
};

export type EggGradeCounts = Record<EggGrade, number>;

export const EMPTY_GRADE_COUNTS: EggGradeCounts = { GOOD: 0, BROKEN: 0, DOUBLE: 0, SMALL: 0 };

/** Daily egg collection, recorded in TRAYS per grade. Adds to that grade's shed stock. */
export interface EggCollection {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  date: string;
  goodTrays: number;
  brokenTrays: number;
  doubleTrays: number;
  smallTrays: number;
  workerName?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/**
 * Eggs thrown away: a stock event with no money in it. Recorded per grade because each
 * pool is a different loss — a broken tray leaving is not the same fact as a small one.
 * It never enters the P&L: the feed that laid the egg was already expensed when the shed
 * drew it, so the only honest figure beside it is the sale value it cost the farm.
 */
export interface EggWastage {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  date: string;
  /** Trays discarded from each of the four sellable pools. */
  byGrade: EggGradeCounts;
  /** Why they went out — one of the farm's own reasons, or a free-text note. */
  reason: string;
  remarks?: string;
  workerName?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/** What the wastage form supplies. Identity, company and audit belong to the store. */
export type EggWastageDraft = Omit<EggWastage,
  'id' | 'companyId' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'synced'>;

/** The reasons the farm discards by. Anything else is typed as a note. */
export const EGG_WASTAGE_REASONS = [
  'Cracked in handling',
  'Rotten / spoiled',
  'Grade rejected by trader',
  'Heat damage',
  'Transport damage',
  'Other',
] as const;

export type SaleLogStatus = 'PENDING' | 'ACKNOWLEDGED';
/**
 * Shed dispatch note: what left the shed with the vehicle, written by the
 * Farm Manager/Labor/Supervisor. It does NOT change stock — the trader's stock
 * only drops when accounts saves the final SaleEntry for that shed and grade.
 * `status` records that accounts has seen the note.
 */
export interface SaleLog {
  id: string;
  companyId: string;
  shedId: string;
  batchId: string;
  date: string;
  trays: number;
  grade: EggGrade;
  status: SaleLogStatus;
  workerName?: string;
  remarks?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'PENDING';

/** Rate per egg for one grade — the figure a trader quotes for the day. */
export type GradeRates = Partial<Record<EggGrade, number>>;

/** How an entry's money was arrived at: quoted rates, or a figure agreed verbally. */
export type SalePricing = 'RATE' | 'AGREED';

/** One shed's contribution to a sale entry. These trays leave that shed's stock. */
export interface SaleEntryLine {
  shedId: string;
  byGrade: EggGradeCounts;
}

/**
 * The final sale of the day's eggs, made by accounts against a trader once the
 * vehicle is weighed out. This — not the shed dispatch log — is where stock
 * drops and money is booked.
 */
export interface SaleEntry {
  id: string;
  companyId: string;
  traderId: string;
  date: string;
  lines: SaleEntryLine[];
  /** Per-egg rates when pricing is 'RATE'. */
  rates: GradeRates;
  pricing: SalePricing;
  /** Money for the eggs alone: trays × 30 × rate, or the agreed figure. */
  amount: number;
  cash: number;
  phonepe: number;
  /** Part of an advance the trader already gave us, adjusted against this load. */
  advance: number;
  /**
   * Who physically took the cash on this load. Recorded by is `createdBy`, which is often
   * someone else — the manager who typed the voucher in later.
   */
  cashHandledById?: string;
  /** Clock time the cash was handed over, `HH:mm`. */
  cashTime?: string;
  /** Human-readable cash receipt number, unique within the company. */
  cashReference?: string;
  /** What this load leaves on the trader: eggs + labour − cash − PhonePe − advance. Derived by the store. */
  credit: number;
  /** Loading/casual labour for this dispatch, recovered from the trader on the same load. It arrives as part of that load's income; the wage is a separate Finance expense the farm books when it pays. */
  laborCharge: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/** What accounts fills in; the store derives `amount` from pricing and `credit` from the money in. */
export type SaleEntryDraft =
  Omit<SaleEntry, 'id' | 'companyId' | 'amount' | 'credit' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'synced'>
  & { amount?: number };

/* ========================= EGG SALE PLANNER (bookings only) ========================= */

export type EggBookingStatus = 'PLANNED' | 'FULFILLED' | 'CANCELLED';

/**
 * A promise made to a trader for trays from one shed on one day. It is a plan and
 * nothing more: it never reduces egg stock, never books income, never touches a
 * trader's balance and never creates a payment. Only the actual `SaleEntry` does
 * those things, and a booking is marked FULFILLED against the entry after it saves.
 */
export interface EggSaleBooking {
  id: string;
  companyId: string;
  shedId: string;
  /** The flock holding that shed on the planned date, when one does. Planning detail only. */
  batchId?: string;
  date: string;
  traderId: string;
  plannedTrays: number;
  /** Which of the four sellable pools the trays are promised from. */
  grade: EggGrade;
  status: EggBookingStatus;
  remarks?: string;
  /** Written only once the real sale for this booking has been saved. */
  saleEntryId?: string;
  fulfilledAt?: string;
  /** A cancelled booking keeps its record and its reason; plans are never deleted. */
  cancelReason?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/** What the planner form supplies. Identity, company, status and audit belong to the store. */
export type EggSaleBookingDraft = Omit<EggSaleBooking,
  'id' | 'companyId' | 'status' | 'saleEntryId' | 'fulfilledAt' | 'cancelReason'
  | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'synced'>;

/* ============================= FEED / GODOWN (KG) ============================= */

export type FeedIngredient =
  | 'Maize' | 'Soya DOC' | 'DDGS' | 'Groundnut DOC' | 'DORB'
  | 'Stone' | 'MCP' | 'DLM' | 'Lysine' | 'Mixiblend' | 'Salt' | 'DCP';

export type FeedStockKind = 'OPENING' | 'FEED_IN' | 'FEED_OUT' | 'CONSUMPTION' | 'ADJUSTMENT' | 'SHORTAGE';

/** Central godown stock ledger. All quantities in KG. Current stock is derived. */
export interface FeedStockEntry {
  id: string;
  companyId: string;
  ingredient: FeedIngredient | string;
  date: string;
  kind: FeedStockKind;
  qtyKg: number;
  ratePerKg?: number;
  shedId?: string;
  batchId?: string;
  /** Who the stock was bought from. A purchase's payable is tracked against this name. */
  supplier?: string;
  /**
   * Stock receipt number, unique within the company (`PUR-2026-09-23-001`). Issued by the
   * store when the receipt is booked — a purchase value is never typed, so neither is this.
   */
  purchaseRef?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/** Rounds shed feed is offered in. Labor only records the clock time of each round. */
export type FeedRound = 'MORNING' | 'AFTERNOON' | 'EVENING';

export const FEED_ROUNDS: FeedRound[] = ['MORNING', 'AFTERNOON', 'EVENING'];

export const FEED_ROUND_LABELS: Record<FeedRound, string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
};

export type FeedRoundStatus = 'GIVEN' | 'SKIPPED';

/**
 * Labor's feed round log — the clock time the feed actually went into the troughs,
 * or that a round was skipped. Intentionally carries no quantity: stock movement is
 * recorded separately as FeedConsumption by the supervisor.
 */
export interface FeedRoundLog {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  date: string;
  round: FeedRound;
  status: FeedRoundStatus;
  /** Local clock time, 'HH:mm'. Empty when the round was skipped. */
  at: string;
  workerName?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/** Daily feed consumed by a shed, recorded in TONNES. Drives ingredient deduction.
 * `formula*` fields snapshot the exact formula version used at entry time so
 * historical consumption never re-calculates against a later version. */
export interface FeedConsumption {
  id: string;
  companyId: string;
  shedId: string;
  batchId: string;
  date: string;
  tonnes: number;
  formulaId?: string;
  formulaVersion?: number;
  formulaName?: string;
  deduction?: { ingredient: string; kg: number }[];
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
  synced: boolean;
}

/**
 * One line of a feed mix. A formula carries NO price of its own: its cost per tonne
 * is derived from the godown's weighted average for each ingredient, so there is one
 * price chain and history cannot disagree with it.
 */
export interface FeedFormulaItem {
  ingredient: string;
  kgPerTonne: number;
}

export type FeedFormulaStatus = 'ACTIVE' | 'INACTIVE';

/** Common ingredient catalogue; a formula item may also use a custom name. */
export const FEED_INGREDIENTS: string[] = [
  'Maize', 'Soya DOC', 'DDGS', 'Groundnut DOC', 'DORB', 'Wheat Bran', 'CDE',
  'Stone', 'MCP', 'DCP', 'DLM', 'Lysine', 'Methionine', 'Mixiblend', 'Salt',
  'Vitamin Premix', 'Toxin Binder', 'Choline Chloride',
];

/**
 * Feed formula defined per Shed, expressed as KG per 1 TONNE (1,000 kg) of mix.
 * Versions of the same formula share `familyId`; editing a formula that already
 * drove consumption appends a new version instead of mutating history.
 */
export interface FeedFormula {
  id: string;
  companyId: string;
  shedId: string;
  name: string;
  familyId: string;
  version: number;
  effectiveFrom: string;
  status: FeedFormulaStatus;
  items: FeedFormulaItem[];
  changeReason?: string;
  supersededAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What a user supplies when creating or revising a formula; versioning is derived. */
export interface FormulaInput {
  shedId: string;
  name: string;
  items: FeedFormulaItem[];
  effectiveFrom?: string;
  changeReason?: string;
}

/* ============================= MEDICINES & VACCINES (CENTRAL INVENTORY) =============================
 * Deliberately the same shape as the godown: one ledger is the only record of stock,
 * current stock and average cost are replayed from it, and booking a receipt never
 * pays for it. Payments for medicine receipts use the common Finance payment system.
 */

export type MedicineCategory = 'MEDICINE' | 'VACCINE';

export const MEDICINE_CATEGORIES: MedicineCategory[] = ['MEDICINE', 'VACCINE'];

/** Stock is counted in the unit the product is bought and used in — not forced into KG. */
export const MEDICINE_UNITS = ['bottle', 'vial', 'dose', 'tablet', 'sachet', 'litre', 'KG', 'packet', 'piece'] as const;

export type MedicineUnit = (typeof MEDICINE_UNITS)[number];

export const MEDICINE_CATEGORY_LABELS: Record<MedicineCategory, string> = {
  MEDICINE: 'Medicine',
  VACCINE: 'Vaccine',
};

/** A catalogue product. Stock transactions point at `id`, never at a typed name. */
export interface MedicineItem {
  id: string;
  companyId: string;
  name: string;
  category: MedicineCategory;
  unit: MedicineUnit;
  active: boolean;
  /** Stock at or below this figure is reported as low. */
  lowStockThreshold: number;
  /** Pack size or strength, shown beside the name. */
  specifications?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What the item form supplies; identity, company and audit belong to the store. */
export type MedicineItemDraft = Omit<MedicineItem, 'id' | 'companyId' | 'createdBy' | 'createdAt' | 'updatedAt'>;

/**
 * Ledger rows, signed by kind the way feed rows are: OPENING/RECEIPT add, USAGE takes
 * away, ADJUSTMENT carries its own sign. `qty` is always the amount in the item's unit.
 */
export type MedicineStockKind = 'OPENING' | 'RECEIPT' | 'USAGE' | 'ADJUSTMENT';

export const MEDICINE_STOCK_KINDS: MedicineStockKind[] = ['OPENING', 'RECEIPT', 'USAGE', 'ADJUSTMENT'];

/**
 * The medicine and vaccine ledger. Nothing else holds stock: the current position, the
 * weighted average and the stock value are all read back from these rows.
 */
export interface MedicineStockEntry {
  id: string;
  companyId: string;
  medicineId: string;
  date: string;
  kind: MedicineStockKind;
  qty: number;
  /** Receipts carry the purchase rate; a usage carries the average that was in force when it was booked. */
  ratePerUnit?: number;
  /** Frozen on a usage row so a later, cheaper or dearer purchase cannot revalue history. */
  amount?: number;
  shedId?: string;
  batchId?: string;
  /** Who the stock was bought from; the payable is tracked against this name. */
  supplier?: string;
  /** Stock receipt number, unique within the company, issued by the store. */
  purchaseRef?: string;
  lotNumber?: string;
  expiryDate?: string;
  reason?: string;
  /** Who actually gave or put in the stock, as recorded. */
  usedBy?: string;
  /** Set when completing a vaccination created this usage, so a dose is never deducted twice. */
  vaccinationId?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/** What the receive form supplies. The receipt number, company and audit are the store's. */
export interface MedicineReceiptDraft {
  medicineId: string;
  date: string;
  qty: number;
  ratePerUnit?: number;
  supplier: string;
  lotNumber?: string;
  expiryDate?: string;
  remarks?: string;
}

/**
 * What the usage form supplies. The expense is never typed with it: the rate is the
 * average in force on that day and the amount is derived from it (§9).
 */
export interface MedicineUsageDraft {
  medicineId: string;
  date: string;
  qty: number;
  shedId: string;
  batchId?: string;
  reason: string;
  usedBy: string;
  remarks?: string;
  /** Set only when completing a vaccination books this usage alongside the dose. */
  vaccinationId?: string;
}

/** A counted correction — signed, because stock can be found as well as lost. */
export interface MedicineAdjustmentDraft {
  medicineId: string;
  date: string;
  qty: number;
  reason: string;
  remarks?: string;
}

/* ============================= PAYMENT ACCOUNTABILITY ============================= */

/**
 * How money physically moved. This is metadata on an existing ledger row: it never
 * stands as a second transaction for the same money.
 */
export type PaymentMethod =
  | 'CASH' | 'UPI' | 'PHONEPE' | 'NEFT' | 'RTGS' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';

export const PAYMENT_METHODS: PaymentMethod[] = [
  'CASH', 'UPI', 'PHONEPE', 'NEFT', 'RTGS', 'BANK_TRANSFER', 'CHEQUE', 'OTHER',
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash', UPI: 'UPI', PHONEPE: 'PhonePe', NEFT: 'NEFT', RTGS: 'RTGS',
  BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', OTHER: 'Other',
};

/** The four buckets a movement is reported under, plus the advance adjustment. */
export type MoneyChannel = 'cash' | 'online' | 'cheque' | 'other' | 'advance';

export const MONEY_CHANNELS: MoneyChannel[] = ['cash', 'online', 'cheque', 'other', 'advance'];

export const CHANNEL_LABEL: Record<MoneyChannel, string> = {
  cash: 'Cash', online: 'Online', cheque: 'Cheque', other: 'Other', advance: 'Advance adjusted',
};

/**
 * What one row's amount was made of, recorded when it was booked so the cash/online
 * view reads numbers instead of re-deriving them from remarks. A row with a single
 * `paymentMethod` needs no split — its whole amount is that channel.
 */
export interface PaymentSplit {
  cash?: number;
  online?: number;
  cheque?: number;
  other?: number;
  /** Already with us as a trader advance and adjusted against this load — not money that moved today. */
  advance?: number;
}

/**
 * Who stood behind a money movement. `createdBy` is always the person who typed it in;
 * the fields here are separate on purpose, because on a farm the two are often different
 * people and a dispute must be answerable from the record.
 */
export interface PaymentAccountability {
  paymentMethod?: PaymentMethod;
  split?: PaymentSplit;
  /** Clock time of the movement, `HH:mm`. */
  time?: string;
  /** Our person who physically handled the cash — took it in, handed it out — or initiated the transfer. */
  handledById?: string;
  /** The other side's person, who actually took the cash we handed over. Free text: they are not a user. */
  handedTo?: string;
  /** Who approved the movement. */
  authorizedById?: string;
  /** Human-readable proof: cash receipt number, UTR, cheque number. */
  reference?: string;
}

/**
 * Cash changing hands inside the company without any income or expense behind it —
 * a supervisor deposits the day's collection with the owner. This moves custody,
 * never money, so it is deliberately outside the finance ledger.
 */
export interface CashHandover {
  id: string;
  companyId: string;
  date: string;
  time?: string;
  amount: number;
  /** UserId giving up the cash, and the one taking it. */
  fromUserId: string;
  toUserId: string;
  reason?: string;
  reference?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/** One day's physical cash count against what the records expect. A difference stands until explained. */
export interface CashCount {
  id: string;
  companyId: string;
  date: string;
  /** What the drawer actually held, counted by hand. */
  physicalCash: number;
  /** Cash the records expected at the moment of counting, so a later edit cannot move it. */
  expectedCash: number | null;
  difference: number;
  closedById: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  synced: boolean;
}

/* ============================= FINANCE & TRADERS ============================= */

export type TxnKind = 'INCOME' | 'EXPENSE' | 'PURCHASE' | 'SALE' | 'PAYMENT_IN' | 'PAYMENT_OUT';

export interface FinanceTxn extends PaymentAccountability {
  id: string;
  companyId: string;
  batchId?: string;
  /** Set when the row belongs to the godown itself rather than a batch's shed. */
  godown?: boolean;
  date: string;
  kind: TxnKind;
  amount: number;
  category: string;
  counterparty?: string;
  /** Set when a voucher (a sale entry) generated this row, so editing it replaces the row. */
  refId?: string;
  /**
   * The godown stock receipt this row pays for. Entering a purchase books no money, so this
   * link is the only thing that closes a payable — and it never changes the purchase itself.
   */
  purchaseId?: string;
  /** The sale entry this receipt settles part of. Dues still live on the trader's ledger. */
  saleId?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/**
 * A money line a flock arrives with when it is onboarded mid-life — already paid out or
 * taken in before anyone tracked it here. It is not a special kind of record: placing the
 * batch turns each one into an ordinary dated Finance row tagged to that batch, so the
 * ledger, the cash position and every report see it exactly as they see a hand-typed entry.
 */
export interface OpeningEntry extends PaymentAccountability {
  kind: Extract<TxnKind, 'INCOME' | 'EXPENSE'>;
  category: string;
  amount: number;
  /** The day the money actually moved, which is usually before the placement date. */
  date: string;
  remarks?: string;
}

/* ============================= SUPPORT ============================= */

/** A message sent from Contact & help. Persisted so the Master Admin panel can see it. */
export interface SupportMessage {
  id: string;
  name: string;
  mobile?: string;
  subject?: string;
  message: string;
  /** Who sent it and from where, so the platform team can reply and route it. */
  userId?: string;
  companyId?: string;
  role?: Role;
  at: string;
  handledAt?: string;
  handledBy?: string;
}

export interface Trader {
  id: string;
  companyId: string;
  name: string;
  mobile: string;
  gstin?: string;
  address?: string;
  openingBalance: number;
  outstandingAmount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TraderTxnKind = 'OPENING' | 'EGG_SALE' | 'PAYMENT_IN' | 'PAYMENT_OUT' | 'RATE_UPDATE';

export interface TraderTxn extends PaymentAccountability {
  id: string;
  companyId: string;
  traderId: string;
  date: string;
  kind: TraderTxnKind;
  trays?: number;
  rate?: number;
  amount: number;
  /**
   * The sale entry this row was booked by, so editing the voucher replaces exactly its own
   * rows and the ledger can open the sale it belongs to. A payment typed straight onto a
   * trader's ledger carries no reference and stands on its own.
   */
  refId?: string;
  /**
   * The sale this payment was made against. A trader's dues are settled load by load, so a
   * receipt linked here counts towards that load's outstanding as well as the balance.
   */
  saleId?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/* ============================= TASKS, AUDIT ============================= */

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface FarmTask {
  id: string;
  companyId: string;
  title: string;
  date: string;
  time?: string;
  assignedUserId?: string;
  farmId?: string;
  shedId?: string;
  batchId?: string;
  priority: TaskPriority;
  status: TaskStatus;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  synced: boolean;
}

export interface AuditEntry {
  id: string;
  companyId?: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  /** Why a protected figure was changed. Required when money or custody details are corrected. */
  reason?: string;
  byUserId: string;
  at: string;
}
