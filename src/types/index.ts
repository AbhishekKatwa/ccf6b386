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
  | 'lockDay'
  | 'unlockDay'
  | 'manageUsers'
  | 'manageCompanies'
  | 'manageTraders'
  | 'manageFormulas'
  | 'acknowledgeSales'
  | 'closeBatch'
  | 'exportReports';

export type PermissionSet = Record<PermissionKey, boolean>;

export const NO_PERMISSIONS: PermissionSet = {
  create: false, createDailyOps: false, update: false, delete: false,
  viewFinance: false, viewRates: false,
  lockDay: false, unlockDay: false,
  manageUsers: false, manageCompanies: false,
  manageTraders: false, manageFormulas: false, acknowledgeSales: false,
  closeBatch: false, exportReports: false,
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
  amount?: number;
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

export interface DeadBirdDisposal {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  date: string;
  count: number;
  method?: string;
  workerName?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
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

export type SaleLogStatus = 'PENDING' | 'ACKNOWLEDGED';

/**
 * Shed-level dispatch/hand-over log created by Farm Manager/Labor/Supervisor.
 * Immediately reduces that grade's physical egg stock. Becomes a Trader Sale only
 * after a financial user acknowledges it and confirms the trader.
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
  eggSaleId?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'PENDING';

/** Final trader sale, collated from one or more acknowledged sale logs of one grade. */
export interface EggSale {
  id: string;
  companyId: string;
  traderId: string;
  date: string;
  trays: number;
  grade: EggGrade;
  ratePerTray: number;
  amount: number;
  paymentStatus: PaymentStatus;
  /** Sale logs collated into this sale (inventory already deducted at log time). */
  saleLogIds: string[];
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/* ============================= FEED / GODOWN (KG) ============================= */

export type FeedIngredient =
  | 'Maize' | 'Soya DOC' | 'DDGS' | 'Groundnut DOC' | 'DORB'
  | 'Stone' | 'MCP' | 'DLM' | 'Lysine' | 'Mixiblend' | 'Salt' | 'DCP';

export type FeedStockKind = 'OPENING' | 'FEED_IN' | 'FEED_OUT' | 'CONSUMPTION' | 'ADJUSTMENT';

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

export interface FeedFormulaItem {
  ingredient: string;
  kgPerTonne: number;
  costPerKg?: number;
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

/* ============================= FINANCE & TRADERS ============================= */

export type TxnKind = 'INCOME' | 'EXPENSE' | 'PURCHASE' | 'SALE' | 'PAYMENT_IN' | 'PAYMENT_OUT';

export interface FinanceTxn {
  id: string;
  companyId: string;
  batchId?: string;
  date: string;
  kind: TxnKind;
  amount: number;
  category: string;
  counterparty?: string;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
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

export interface TraderTxn {
  id: string;
  companyId: string;
  traderId: string;
  date: string;
  kind: TraderTxnKind;
  trays?: number;
  rate?: number;
  amount: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

/* ============================= TASKS, LOCKS, AUDIT ============================= */

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

export interface DayLock {
  id: string;
  companyId: string;
  batchId: string;
  shedId: string;
  date: string;
  lockedBy: string;
  lockedAt: string;
  reason?: string;
}

export interface AuditEntry {
  id: string;
  companyId?: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOCK' | 'UNLOCK';
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  byUserId: string;
  at: string;
}
