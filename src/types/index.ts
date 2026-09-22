export type Role =
  | 'OWNER'
  | 'FARMER'
  | 'FARM_MANAGER'
  | 'FARM_SUPERVISOR'
  | 'FARM_EMPLOYEE'
  | 'COMPANY_MANAGER'
  | 'COMPANY_SUPERVISOR'
  | 'FINANCER'
  | 'OTHER';

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  FARMER: 'Farmer',
  FARM_MANAGER: 'Farm Manager',
  FARM_SUPERVISOR: 'Farm Supervisor',
  FARM_EMPLOYEE: 'Farm Employee',
  COMPANY_MANAGER: 'Company Manager',
  COMPANY_SUPERVISOR: 'Company Supervisor',
  FINANCER: 'Financer',
  OTHER: 'Other',
};

export type PermissionKey =
  | 'create'
  | 'update'
  | 'delete'
  | 'viewFinance'
  | 'viewRates'
  | 'lockDay'
  | 'unlockDay'
  | 'manageUsers'
  | 'exportReports';

export type PermissionSet = Record<PermissionKey, boolean>;

export const NO_PERMISSIONS: PermissionSet = {
  create: false, update: false, delete: false,
  viewFinance: false, viewRates: false,
  lockDay: false, unlockDay: false,
  manageUsers: false, exportReports: false,
};

export interface User {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  role: Role;
  permissions: PermissionSet;
  initials: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Farm {
  id: string;
  name: string;
  location: string;
  ownerUserId: string;
  contactMobile: string;
  createdAt: string;
  updatedAt: string;
}

export type ShedStatus = 'ACTIVE' | 'IDLE' | 'MAINTENANCE';

export interface Shed {
  id: string;
  farmId: string;
  name: string;
  capacity: number;
  status: ShedStatus;
  createdAt: string;
  updatedAt: string;
}

export type BirdType = 'LAYER' | 'BROILER';
export type BatchStatus = 'LIVE' | 'CLOSED' | 'PLANNED';

export interface Batch {
  id: string;
  code: string;
  farmId: string;
  shedId: string;
  birdType: BirdType;
  breed: string;
  hatchDate: string;
  placementDate: string;
  initialBirds: number;
  status: BatchStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BatchAssignment {
  id: string;
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
  batchId: string;
  date: string;
  count: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export interface FeedConsumption {
  id: string;
  batchId: string;
  date: string;
  bags: number;
  bagWeightKg: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export interface WeightEntry {
  id: string;
  batchId: string;
  date: string;
  sampleSize: number;
  avgWeightKg: number;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export interface EggCollection {
  id: string;
  batchId: string;
  date: string;
  good: number;
  damaged: number;
  cracked: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'PENDING';

export interface EggSale {
  id: string;
  batchId: string;
  traderId?: string;
  date: string;
  buyerName: string;
  trays: number;
  eggsPerTray: number;
  ratePerEgg: number;
  paymentStatus: PaymentStatus;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export type FeedIngredient =
  | 'Maize' | 'Soya DOC' | 'DDGS' | 'Groundnut DOC' | 'DORB'
  | 'Stone' | 'MCP' | 'DLM' | 'Lysine' | 'Mixiblend' | 'Salt' | 'DCP';

export interface FeedStockEntry {
  id: string;
  ingredient: FeedIngredient | string;
  date: string;
  kind: 'OPENING' | 'PURCHASE' | 'CONSUMPTION' | 'ADJUSTMENT';
  qtyKg: number;
  ratePerKg: number;
  unit: 'KG' | 'BAG';
  bagWeightKg?: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export interface FeedFormulaItem {
  ingredient: string;
  qtyKg: number;
  costPerKg: number;
}

export interface FeedFormula {
  id: string;
  name: string;
  birdType: BirdType;
  ageFromDays: number;
  ageToDays: number;
  items: FeedFormulaItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type TxnKind = 'INCOME' | 'EXPENSE' | 'PURCHASE' | 'SALE' | 'PAYMENT_IN' | 'PAYMENT_OUT';

export interface FinanceTxn {
  id: string;
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
  name: string;
  mobile: string;
  gstin?: string;
  address?: string;
  outstandingAmount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TraderTxn {
  id: string;
  traderId: string;
  date: string;
  kind: 'EGG_PURCHASE' | 'EGG_SALE' | 'PAYMENT_IN' | 'PAYMENT_OUT' | 'RATE_UPDATE';
  qty?: number;
  rate?: number;
  amount: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  synced: boolean;
}

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface FarmTask {
  id: string;
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
  batchId: string;
  date: string;
  lockedBy: string;
  lockedAt: string;
  reason?: string;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOCK' | 'UNLOCK';
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  byUserId: string;
  at: string;
}

export interface Session {
  userId: string;
  signedInAt: string;
}
