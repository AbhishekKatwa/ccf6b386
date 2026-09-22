import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AuditEntry, Batch, BatchAssignment, BatchClosing, Company, DayLock,
  DeadBirdDisposal, EggCollection, EggSale, Farm, FarmTask, FeedConsumption,
  FeedFormula, FeedFormulaItem, FeedRoundLog, FeedStockEntry, FinanceTxn, FormulaInput, EggGrade, MortalityEntry, NewBatchInput, PermissionKey,
  PermissionSet, Role, SaleLog, Session, Shed, Trader, TraderTxn, User,
} from '@/types';
import { EGG_GRADE_LABELS, EGG_GRADES, FEED_ROUNDS } from '@/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';
import { generateOtp, hashPassword, isOtpValid, normalizeMobile, verifyPassword } from '@/lib/auth';
import {
  FORMULA_TOLERANCE_KG, FORMULA_TONNE_KG, eggStockByGrade, formulaDeduction, formulaForDate,
  formulaTotalError, formulaTotalKg, formulaUsage,
} from '@/lib/calc';
import { nowISO, todayISO, uid } from '@/lib/format';
import {
  seedAssignments, seedAudit, seedBatches, seedCompanies, seedDayLocks,
  seedDisposals, seedEggSales, seedEggs, seedFarms, seedFeed, seedFeedFormulas,
  seedFeedRounds, seedFeedStock, seedFinance, seedMortality, seedSaleLogs, seedSheds, seedTasks,
  seedTraderTxns, seedTraders, seedUsers,
} from '@/data/seed';

interface Toast { id: string; kind: 'success' | 'error' | 'info'; message: string }
type Result = { ok: boolean; error?: string };
/** Formula writes report the saved version id so the UI can route to it. */
type FormulaResult = Result & { id?: string; version?: number };

interface AppState {
  companies: Company[];
  users: User[];
  farms: Farm[];
  sheds: Shed[];
  batches: Batch[];
  assignments: BatchAssignment[];
  mortality: MortalityEntry[];
  disposals: DeadBirdDisposal[];
  feed: FeedConsumption[];
  feedRounds: FeedRoundLog[];
  eggs: EggCollection[];
  saleLogs: SaleLog[];
  eggSales: EggSale[];
  feedStock: FeedStockEntry[];
  feedFormulas: FeedFormula[];
  finance: FinanceTxn[];
  traders: Trader[];
  traderTxns: TraderTxn[];
  tasks: FarmTask[];
  dayLocks: DayLock[];
  audit: AuditEntry[];
  session: Session | null;
  online: boolean;
  toasts: Toast[];

  /* auth */
  signInWithPassword: (mobile: string, password: string) => Result;
  requestOtp: (mobile: string) => { ok: boolean; error?: string; code?: string };
  signInWithOtp: (mobile: string, code: string) => Result;
  selectCompany: (companyId: string) => Result;
  signOut: () => void;

  setOnline: (v: boolean) => void;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;

  /* master admin — companies & users */
  addCompany: (name: string) => Company;
  toggleCompanyActive: (id: string) => void;
  createUser: (input: {
    name: string; mobile: string; password: string; role: Role; companyIds: string[];
  }) => { ok: boolean; error?: string; user?: User };
  toggleUserActive: (id: string) => void;
  updateUserCompanies: (id: string, companyIds: string[]) => void;

  /* company structure */
  addFarm: (f: Omit<Farm, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Farm | null;
  updateFarm: (id: string, patch: Partial<Farm>) => void;
  addShed: (s: Omit<Shed, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Shed | null;
  updateShed: (id: string, patch: Partial<Shed>) => void;

  addBatch: (input: NewBatchInput) => Result;
  nextBatchCode: (shedId: string) => string;
  updateBatch: (id: string, patch: Partial<Batch>) => void;
  closeBatch: (batchId: string, closing: Omit<BatchClosing, 'closedBy' | 'closedAt'>) => Result;

  assignUser: (input: {
    batchId: string; userId: string; role: Role;
    perms?: Pick<PermissionSet, 'create' | 'update' | 'delete'>;
    comments?: string;
  }) => Result;
  revokeAssignment: (id: string) => void;

  /* daily operations */
  addMortality: (m: Omit<MortalityEntry, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  updateMortality: (id: string, patch: Pick<MortalityEntry, 'count' | 'remarks' | 'workerName'>) => Result;
  addDisposal: (d: Omit<DeadBirdDisposal, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  addEggCollection: (e: Omit<EggCollection, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  updateEggCollection: (id: string, patch: Pick<EggCollection, 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays' | 'workerName' | 'remarks'>) => Result;
  addFeedConsumption: (f: Omit<FeedConsumption, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>, opts?: { allowNegative?: boolean }) => Result;
  updateFeedConsumption: (id: string, patch: Pick<FeedConsumption, 'tonnes' | 'remarks'>, opts?: { allowNegative?: boolean }) => Result;

  /* feed round log — labor records the clock time feed went to the birds, or a skip */
  logFeedRound: (r: Omit<FeedRoundLog, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  updateFeedRound: (id: string, patch: Partial<Pick<FeedRoundLog, 'status' | 'at' | 'workerName' | 'remarks'>>) => Result;

  /* egg sale logs → trader sales */
  addSaleLog: (l: Omit<SaleLog, 'id' | 'companyId' | 'status' | 'createdAt' | 'createdBy' | 'synced'>) => Result;
  acknowledgeSaleLog: (id: string) => Result;
  createTraderSale: (input: {
    traderId: string; saleLogIds: string[]; ratePerTray: number;
    paymentStatus: EggSale['paymentStatus']; date?: string; remarks?: string;
  }) => Result;

  /* godown ledger */
  addFeedStock: (e: Omit<FeedStockEntry, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>, opts?: { allowNegative?: boolean }) => Result;

  /* feed formulas — per shed, KG per tonne, versioned (never edited in place once used) */
  canManageFormula: (shedId: string) => boolean;
  formulaHasConsumption: (formulaId: string) => boolean;
  createFeedFormula: (input: FormulaInput) => FormulaResult;
  reviseFeedFormula: (id: string, input: FormulaInput) => FormulaResult;
  duplicateFeedFormula: (id: string, input: { name: string; shedId?: string }) => FormulaResult;
  setFormulaActive: (id: string, active: boolean) => Result;

  addFinance: (t: Omit<FinanceTxn, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;

  /* traders */
  addTrader: (t: Omit<Trader, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Trader | null;
  updateTrader: (id: string, patch: Partial<Trader>) => void;
  addTraderTxn: (t: Omit<TraderTxn, 'id' | 'companyId' | 'createdAt' | 'createdBy' | 'synced'>) => Result;

  /* tasks */
  addTask: (t: Omit<FarmTask, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'synced'>) => FarmTask | null;
  updateTask: (id: string, patch: Partial<FarmTask>) => void;
  deleteTask: (id: string) => void;

  /* day lock */
  lockDay: (batchId: string, shedId: string, date: string, reason?: string) => Result;
  unlockDay: (batchId: string, shedId: string, date: string) => Result;
  isLocked: (shedId: string, date: string) => boolean;

  syncPending: () => void;
  resetDemo: () => void;
}

/* ============================= HELPERS ============================= */

function audit(
  state: AppState,
  entity: string, entityId: string,
  action: AuditEntry['action'],
  field?: string, oldValue?: unknown, newValue?: unknown,
): AuditEntry[] {
  const entry: AuditEntry = {
    id: uid('au'), companyId: state.session?.companyId ?? undefined,
    entity, entityId, action, field, oldValue, newValue,
    byUserId: state.session?.userId ?? 'system', at: nowISO(),
  };
  return [entry, ...state.audit].slice(0, 500);
}

/** Exactly one formula version is in force per shed; the rest keep their history. */
function deactivateOther(list: FeedFormula[], shedId: string, exceptId?: string): FeedFormula[] {
  return list.map(f => f.shedId === shedId && f.status === 'ACTIVE' && f.id !== exceptId
    ? { ...f, status: 'INACTIVE' as const, supersededAt: f.supersededAt ?? nowISO(), updatedAt: nowISO() }
    : f);
}

/** 24-hour clock string as produced by `<input type="time">`. */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function baseSeed() {
  return {
    companies: seedCompanies, users: seedUsers, farms: seedFarms, sheds: seedSheds,
    batches: seedBatches, assignments: seedAssignments, mortality: seedMortality,
    disposals: seedDisposals, feed: seedFeed, feedRounds: seedFeedRounds, eggs: seedEggs,
    saleLogs: seedSaleLogs, eggSales: seedEggSales, feedStock: seedFeedStock,
    feedFormulas: seedFeedFormulas, finance: seedFinance, traders: seedTraders,
    traderTxns: seedTraderTxns, tasks: seedTasks, dayLocks: seedDayLocks, audit: seedAudit,
  };
}

const numOf = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const gradeOf = (v: unknown): EggGrade => (EGG_GRADES.includes(v as EggGrade) ? (v as EggGrade) : 'GOOD');

/**
 * Upgrade a save written before the current store version without discarding it:
 * unknown or missing slices fall back to the seed, v5 fields (the four egg-grade
 * pools, graded sale logs, the feed round log) are backfilled per record, and a
 * session is kept only while its user and company still exist.
 */
function migrateSaved(saved: unknown): AppState {
  const seed = baseSeed() as unknown as Record<string, unknown>;
  const merged = { ...seed, ...(saved as Record<string, unknown>) } as unknown as AppState;
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
  merged.eggSales = merged.eggSales.map(x => ({ ...x, grade: gradeOf(x.grade) }));
  merged.feedRounds = merged.feedRounds.filter(
    r => FEED_ROUNDS.includes(r.round) && (r.status === 'GIVEN' || r.status === 'SKIPPED'),
  );

  const session = merged.session;
  const sessionValid = !!session
    && merged.users.some(u => u.id === session.userId)
    && (session.companyId === null || merged.companies.some(c => c.id === session.companyId));
  if (!sessionValid) merged.session = null;

  return merged;
}

export const useApp = create<AppState>()(persist(
  (set, get) => {
    /** Active company id, or null. Used to stamp companyId on new records. */
    const cid = () => get().session?.companyId ?? null;
    const me = () => get().users.find(u => u.id === get().session?.userId) ?? null;
    const can = (key: PermissionKey) => {
      const u = me();
      if (!u) return false;
      return DEFAULT_ROLE_PERMISSIONS[u.role]?.[key] ?? false;
    };
    /** Daily operational entries are gated in the data layer, not just the UI (§4, §5). */
    const dailyOpsGuard = (): Result | null =>
      can('createDailyOps') ? null : { ok: false, error: 'Your role cannot record daily operational entries' };

    /** §4/§6: correcting an existing record needs the update permission, not just create. */
    const editGuard = (): Result | null =>
      can('update') ? null : { ok: false, error: 'Only your supervisor or the owner can change a saved record' };

    /** Finish sign-in: pick company context when unambiguous. */
    function startSession(user: User): Session {
      const single = user.companyIds.length === 1 ? user.companyIds[0] : null;
      return { userId: user.id, companyId: single, signedInAt: nowISO() };
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
          ...i,
          ingredient: i.ingredient.trim(),
          kgPerTonne: Number((i.kgPerTonne || 0).toFixed(2)),
          costPerKg: i.costPerKg == null ? undefined : Number(i.costPerKg.toFixed(2)),
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
      const total = formulaTotalKg(items);
      const err = formulaTotalError(total);
      return err ? `${err} — a formula must total ${FORMULA_TONNE_KG} kg (±${FORMULA_TOLERANCE_KG} kg)` : null;
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
        set(s => ({ session: startSession(user), audit: audit(s, 'Session', user.id, 'CREATE') }));
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
        set(s => ({ session: startSession(user), audit: audit(s, 'Session', user.id, 'CREATE') }));
        return { ok: true };
      },

      selectCompany: (companyId) => {
        const user = me();
        const sess = get().session;
        if (!user || !sess) return { ok: false, error: 'Not signed in' };
        const company = get().companies.find(c => c.id === companyId);
        if (!company || !company.active) return { ok: false, error: 'Company unavailable' };
        const isMaster = user.role === 'MASTER_ADMIN';
        if (!isMaster && !user.companyIds.includes(companyId)) {
          return { ok: false, error: 'You do not have access to this company' };
        }
        set({ session: { ...sess, companyId } });
        return { ok: true };
      },

      signOut: () => set(s => ({ session: null, audit: audit(s, 'Session', s.session?.userId ?? '', 'DELETE') })),

      setOnline: (v) => set({ online: v }),
      pushToast: (kind, message) => {
        const id = uid('t');
        set(s => ({ toasts: [...s.toasts, { id, kind, message }] }));
        setTimeout(() => get().dismissToast(id), 3200);
      },
      dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

      /* ============================= MASTER ADMIN ============================= */

      addCompany: (name) => {
        const company: Company = { id: uid('c'), name, active: true, createdAt: nowISO(), updatedAt: nowISO() };
        set(s => ({ companies: [...s.companies, company], audit: audit(s, 'Company', company.id, 'CREATE') }));
        return company;
      },
      toggleCompanyActive: (id) => set(s => ({
        companies: s.companies.map(c => c.id === id ? { ...c, active: !c.active, updatedAt: nowISO() } : c),
        audit: audit(s, 'Company', id, 'UPDATE', 'active'),
      })),

      createUser: ({ name, mobile, password, role, companyIds }) => {
        if (!can('manageUsers')) return { ok: false, error: 'You cannot manage users' };
        const m = normalizeMobile(mobile);
        if (m.length !== 10) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
        if (get().users.some(u => u.mobile === m)) return { ok: false, error: 'A user with this mobile already exists' };
        if (password.length < 4) return { ok: false, error: 'Password must be at least 4 characters' };
        if (role !== 'MASTER_ADMIN' && companyIds.length === 0) return { ok: false, error: 'Assign at least one company' };
        const user: User = {
          id: uid('u'), name: name.trim(), mobile: m, passwordHash: hashPassword(password),
          role, companyIds: role === 'MASTER_ADMIN' ? [] : companyIds,
          initials: name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?',
          active: true, createdAt: nowISO(), updatedAt: nowISO(),
        };
        set(s => ({ users: [...s.users, user], audit: audit(s, 'User', user.id, 'CREATE') }));
        return { ok: true, user };
      },
      toggleUserActive: (id) => set(s => ({
        users: s.users.map(u => u.id === id ? { ...u, active: !u.active, updatedAt: nowISO() } : u),
        audit: audit(s, 'User', id, 'UPDATE', 'active'),
      })),
      updateUserCompanies: (id, companyIds) => set(s => ({
        users: s.users.map(u => u.id === id ? { ...u, companyIds, updatedAt: nowISO() } : u),
        audit: audit(s, 'User', id, 'UPDATE', 'companyIds'),
      })),

      /* ============================= COMPANY STRUCTURE ============================= */

      addFarm: (f) => {
        const companyId = cid();
        if (!companyId) return null;
        const farm: Farm = { ...f, companyId, id: uid('farm'), createdAt: nowISO(), updatedAt: nowISO() };
        set(s => ({ farms: [...s.farms, farm], audit: audit(s, 'Farm', farm.id, 'CREATE') }));
        return farm;
      },
      updateFarm: (id, patch) => set(s => ({
        farms: s.farms.map(f => f.id === id ? { ...f, ...patch, updatedAt: nowISO() } : f),
      })),
      addShed: (sh) => {
        const companyId = cid();
        if (!companyId) return null;
        const shed: Shed = { ...sh, companyId, id: uid('shed'), createdAt: nowISO(), updatedAt: nowISO() };
        set(s => ({ sheds: [...s.sheds, shed], audit: audit(s, 'Shed', shed.id, 'CREATE') }));
        return shed;
      },
      updateShed: (id, patch) => set(s => ({
        sheds: s.sheds.map(x => x.id === id ? { ...x, ...patch, updatedAt: nowISO() } : x),
      })),

      nextBatchCode: (shedId) => {
        const shed = get().sheds.find(s => s.id === shedId);
        const base = (shed?.name ?? 'BATCH').replace(/[^A-Za-z0-9]/g, '');
        const used = new Set(get().batches.filter(b => b.shedId === shedId).map(b => b.code));
        let i = 0;
        while (used.has(`${base}-${String.fromCharCode(65 + i)}`)) i++;
        return `${base}-${String.fromCharCode(65 + i)}`;
      },
      addBatch: (input) => {
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
        if (input.initialBirds > shed.capacity) return { ok: false, error: `Shed capacity is ${shed.capacity} birds` };
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
        set(s => ({
          batches: [...s.batches, batch],
          sheds: s.sheds.map(x => x.id === shed.id ? { ...x, status: 'ACTIVE', updatedAt: nowISO() } : x),
          audit: audit(s, 'Batch', batch.id, 'CREATE'),
        }));
        return { ok: true };
      },
      updateBatch: (id, patch) => set(s => ({
        batches: s.batches.map(b => b.id === id ? { ...b, ...patch, updatedAt: nowISO() } : b),
      })),
      closeBatch: (batchId, closing) => {
        if (!can('closeBatch')) return { ok: false, error: 'Only the Owner can close a batch' };
        const batch = get().batches.find(b => b.id === batchId);
        if (!batch) return { ok: false, error: 'Batch not found' };
        if (batch.status === 'CLOSED') return { ok: false, error: 'Batch is already closed' };
        const full: BatchClosing = { ...closing, closedBy: get().session?.userId ?? 'system', closedAt: nowISO() };
        set(s => ({
          batches: s.batches.map(b => b.id === batchId ? { ...b, status: 'CLOSED', closing: full, updatedAt: nowISO() } : b),
          sheds: s.sheds.map(sh => sh.id === batch.shedId ? { ...sh, status: 'IDLE', updatedAt: nowISO() } : sh),
          audit: audit(s, 'Batch', batchId, 'UPDATE', 'status', batch.status, 'CLOSED'),
        }));
        return { ok: true };
      },

      assignUser: ({ batchId, userId, role, perms, comments }) => {
        const batch = get().batches.find(b => b.id === batchId);
        if (!batch) return { ok: false, error: 'Batch not found' };
        const u = get().users.find(x => x.id === userId);
        if (!u) return { ok: false, error: 'User not found' };
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
      revokeAssignment: (id) => set(s => ({
        assignments: s.assignments.filter(a => a.id !== id),
        audit: audit(s, 'Assignment', id, 'DELETE'),
      })),

      /* ============================= DAILY OPERATIONS ============================= */

      addMortality: (m) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === m.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (get().isLocked(m.shedId, m.date)) return { ok: false, error: 'Day is locked — contact owner' };
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
        const existing = get().mortality.find(m => m.id === id);
        if (!existing) return { ok: false, error: 'Entry not found' };
        if (get().isLocked(existing.shedId, existing.date)) return { ok: false, error: 'Day is locked — only Owner can edit after unlock' };
        set(s => ({
          mortality: s.mortality.map(m => m.id === id ? { ...m, ...patch, updatedBy: s.session?.userId ?? 'system', updatedAt: nowISO() } : m),
          audit: audit(s, 'Mortality', id, 'UPDATE', 'count', existing.count, patch.count ?? existing.count),
        }));
        return { ok: true };
      },
      addDisposal: (d) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        if (d.count <= 0) return { ok: false, error: 'Count must be greater than 0' };
        const entry: DeadBirdDisposal = {
          ...d, companyId, id: uid('dp'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ disposals: [...s.disposals, entry] }));
        return { ok: true };
      },
      addEggCollection: (e) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === e.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (get().isLocked(e.shedId, e.date)) return { ok: false, error: 'Day is locked — contact owner' };
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
        const existing = get().eggs.find(e => e.id === id);
        if (!existing) return { ok: false, error: 'Entry not found' };
        if (get().isLocked(existing.shedId, existing.date)) return { ok: false, error: 'Day is locked — only Owner can edit after unlock' };
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
      addFeedConsumption: (f, opts) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const denied = dailyOpsGuard(); if (denied) return denied;
        const batch = get().batches.find(b => b.id === f.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (get().isLocked(f.shedId, f.date)) return { ok: false, error: 'Day is locked — contact owner' };
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
        const existing = get().feed.find(f => f.id === id);
        if (!existing || !companyId) return { ok: false, error: 'Entry not found' };
        if (get().isLocked(existing.shedId, existing.date)) return { ok: false, error: 'Day is locked — only Owner can edit after unlock' };
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
        if (get().isLocked(r.shedId, r.date)) return { ok: false, error: 'Day is locked — contact owner' };
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
        const existing = get().feedRounds.find(x => x.id === id);
        if (!existing) return { ok: false, error: 'Entry not found' };
        if (get().isLocked(existing.shedId, existing.date)) return { ok: false, error: 'Day is locked — only Owner can edit after unlock' };
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

      /* ============================= SALE LOGS → TRADER SALES ============================= */

      addSaleLog: (l) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('create')) return { ok: false, error: 'Your role cannot create sale logs' };
        const batch = get().batches.find(b => b.id === l.batchId && b.companyId === companyId);
        if (!batch) return { ok: false, error: 'Batch does not belong to this company' };
        if (batch.status !== 'ACTIVE') return { ok: false, error: 'This shed has no active batch' };
        if (get().isLocked(l.shedId, l.date)) return { ok: false, error: 'Day is locked — contact owner' };
        if (l.trays <= 0) return { ok: false, error: 'Trays must be greater than 0' };
        // A sale log physically dispatches trays, so it can never draw a grade below zero.
        const available = eggStockByGrade(l.shedId, get().eggs, get().saleLogs)[l.grade].balance;
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
        if (!can('acknowledgeSales')) return { ok: false, error: 'Only Finance/Owner can acknowledge sale logs' };
        const log = get().saleLogs.find(l => l.id === id);
        if (!log) return { ok: false, error: 'Sale log not found' };
        if (log.status === 'ACKNOWLEDGED') return { ok: false, error: 'Already acknowledged' };
        set(s => ({
          saleLogs: s.saleLogs.map(l => l.id === id ? { ...l, status: 'ACKNOWLEDGED', acknowledgedBy: s.session?.userId ?? 'system', acknowledgedAt: nowISO() } : l),
          audit: audit(s, 'SaleLog', id, 'UPDATE', 'status', 'PENDING', 'ACKNOWLEDGED'),
        }));
        return { ok: true };
      },
      createTraderSale: ({ traderId, saleLogIds, ratePerTray, paymentStatus, date, remarks }) => {
        if (!can('manageTraders')) return { ok: false, error: 'Only Finance/Owner can create trader sales' };
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const logs = get().saleLogs.filter(l => saleLogIds.includes(l.id));
        if (logs.length === 0) return { ok: false, error: 'Select at least one acknowledged sale log' };
        if (logs.some(l => l.status !== 'ACKNOWLEDGED')) return { ok: false, error: 'All selected logs must be acknowledged first' };
        if (logs.some(l => l.eggSaleId)) return { ok: false, error: 'One or more logs are already converted to a sale' };
        if (ratePerTray <= 0) return { ok: false, error: 'Rate per tray must be greater than 0' };
        const grade = logs[0].grade;
        // Traders buy a grade at a rate, so one sale can never mix pools.
        if (logs.some(l => l.grade !== grade)) return { ok: false, error: 'A trader sale can only collate logs of one egg grade' };
        const trays = logs.reduce((s, l) => s + l.trays, 0);
        const amount = Number((trays * ratePerTray).toFixed(2));
        const saleDate = date ?? todayISO();
        const sale: EggSale = {
          id: uid('es'), companyId, traderId, date: saleDate, trays, grade, ratePerTray, amount,
          paymentStatus, saleLogIds, remarks,
          createdBy: get().session?.userId ?? 'system', createdAt: nowISO(), synced: get().online,
        };
        const trader = get().traders.find(t => t.id === traderId);
        set(s => ({
          eggSales: [...s.eggSales, sale],
          // Mark logs converted — inventory was already deducted at log time (no double-deduct).
          saleLogs: s.saleLogs.map(l => saleLogIds.includes(l.id) ? { ...l, eggSaleId: sale.id } : l),
          traderTxns: [...s.traderTxns, {
            id: uid('tt'), companyId, traderId, date: saleDate, kind: 'EGG_SALE', trays, rate: ratePerTray,
            amount, remarks, createdBy: s.session?.userId ?? 'system', createdAt: nowISO(), synced: s.online,
          }],
          traders: s.traders.map(t => t.id === traderId
            ? { ...t, outstandingAmount: paymentStatus === 'PAID' ? t.outstandingAmount : t.outstandingAmount + amount, updatedAt: nowISO() }
            : t),
          finance: [...s.finance, {
            id: uid('fx'), companyId, date: saleDate, kind: 'SALE', amount, category: 'Egg Sale',
            counterparty: trader?.name, createdBy: s.session?.userId ?? 'system', createdAt: nowISO(), synced: s.online,
          }],
          audit: audit(s, 'EggSale', sale.id, 'CREATE', undefined, undefined, { traderId, trays, amount }),
        }));
        return { ok: true };
      },

      /* ============================= GODOWN ============================= */

      addFeedStock: (e, opts) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        const outgoing = e.kind === 'FEED_OUT' || e.kind === 'CONSUMPTION';
        if (!outgoing && e.kind !== 'ADJUSTMENT' && e.qtyKg <= 0) return { ok: false, error: 'Quantity must be greater than 0' };
        if (outgoing && !opts?.allowNegative) {
          const neg = wouldGoNegative([{ ingredient: e.ingredient, kg: e.qtyKg }], companyId);
          if (neg) return { ok: false, error: `Insufficient stock: ${neg}` };
        }
        const entry: FeedStockEntry = {
          ...e, companyId, id: uid('fs'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ feedStock: [...s.feedStock, entry], audit: audit(s, 'FeedStock', entry.id, 'CREATE') }));
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
        const shedId = input.shedId || existing.shedId;
        if (!canManageFormula(shedId)) return { ok: false, error: 'You cannot manage formulas for this shed' };
        const invalid = formulaError({ ...input, shedId });
        if (invalid) return { ok: false, error: invalid };
        const items = normalizeItems(input.items);
        const name = input.name.trim() || existing.name;

        if (!hasConsumption(existing)) {
          // Nothing has consumed this version yet, so a plain correction is safe.
          set(s => ({
            feedFormulas: s.feedFormulas.map(f => f.id === formulaId
              ? { ...f, name, items, effectiveFrom: input.effectiveFrom || f.effectiveFrom, changeReason: input.changeReason ?? f.changeReason, updatedAt: nowISO() }
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
        const entry: FinanceTxn = {
          ...t, companyId, id: uid('fx'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({ finance: [...s.finance, entry], audit: audit(s, 'Finance', entry.id, 'CREATE') }));
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
        set(s => ({
          traders: [...s.traders, trader], traderTxns: [...s.traderTxns, ...txns],
          audit: audit(s, 'Trader', trader.id, 'CREATE'),
        }));
        return trader;
      },
      updateTrader: (id, patch) => set(s => ({
        traders: s.traders.map(t => t.id === id ? { ...t, ...patch, updatedAt: nowISO() } : t),
      })),
      addTraderTxn: (t) => {
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (!can('manageTraders')) return { ok: false, error: 'Only Finance/Owner manage traders' };
        const entry: TraderTxn = {
          ...t, companyId, id: uid('tt'), createdBy: get().session?.userId ?? 'system',
          createdAt: nowISO(), synced: get().online,
        };
        set(s => ({
          traderTxns: [...s.traderTxns, entry],
          traders: s.traders.map(tr => {
            if (tr.id !== t.traderId) return tr;
            const delta = t.kind === 'EGG_SALE' ? t.amount
              : t.kind === 'PAYMENT_IN' ? -t.amount
                : t.kind === 'PAYMENT_OUT' ? t.amount : 0;
            return { ...tr, outstandingAmount: Math.max(0, tr.outstandingAmount + delta), updatedAt: nowISO() };
          }),
          audit: audit(s, 'TraderTxn', entry.id, 'CREATE'),
        }));
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
      updateTask: (id, patch) => set(s => ({
        tasks: s.tasks.map(t => t.id === id ? { ...t, ...patch, updatedAt: nowISO(), synced: s.online && t.synced } : t),
      })),
      deleteTask: (id) => set(s => ({
        tasks: s.tasks.filter(t => t.id !== id),
        audit: audit(s, 'Task', id, 'DELETE'),
      })),

      /* ============================= DAY LOCK ============================= */

      lockDay: (batchId, shedId, date, reason) => {
        if (!can('lockDay')) return { ok: false, error: 'You do not have permission to lock a day' };
        const companyId = cid();
        if (!companyId) return { ok: false, error: 'No company selected' };
        if (get().dayLocks.some(l => l.shedId === shedId && l.date === date)) return { ok: false, error: 'Already locked' };
        set(s => ({
          dayLocks: [...s.dayLocks, { id: uid('dl'), companyId, batchId, shedId, date, lockedBy: s.session?.userId ?? 'system', lockedAt: nowISO(), reason }],
          audit: audit(s, 'DayLock', `${shedId}:${date}`, 'LOCK', date, false, true),
        }));
        return { ok: true };
      },
      unlockDay: (batchId, shedId, date) => {
        if (!can('unlockDay')) return { ok: false, error: 'Only the Owner can unlock a day' };
        set(s => ({
          dayLocks: s.dayLocks.filter(l => !(l.shedId === shedId && l.date === date)),
          audit: audit(s, 'DayLock', `${shedId}:${date}`, 'UNLOCK', date, true, false),
        }));
        return { ok: true };
      },
      isLocked: (shedId, date) => get().dayLocks.some(l => l.shedId === shedId && l.date === date),

      syncPending: () => set(s => ({
        mortality: s.mortality.map(m => ({ ...m, synced: true })),
        disposals: s.disposals.map(m => ({ ...m, synced: true })),
        feed: s.feed.map(f => ({ ...f, synced: true })),
        feedRounds: s.feedRounds.map(f => ({ ...f, synced: true })),
        eggs: s.eggs.map(e => ({ ...e, synced: true })),
        saleLogs: s.saleLogs.map(e => ({ ...e, synced: true })),
        eggSales: s.eggSales.map(x => ({ ...x, synced: true })),
        feedStock: s.feedStock.map(x => ({ ...x, synced: true })),
        finance: s.finance.map(x => ({ ...x, synced: true })),
        traderTxns: s.traderTxns.map(x => ({ ...x, synced: true })),
        tasks: s.tasks.map(x => ({ ...x, synced: true })),
      })),

      resetDemo: () => set({ ...baseSeed(), session: null }),
    };
  },
  {
    name: 'amrut-poultry-v1',
    // v5: egg grades became four stock pools (today/broken/double/small) and labor
    // logs feed rounds by clock time instead of tonnes. Older saves are patched
    // record by record so a worker's signed-in day survives the app updating.
    version: 5,
    storage: createJSONStorage(() => localStorage),
    migrate: migrateSaved,
    partialize: (s) => {
      const { toasts, online, ...rest } = s;
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

export function useCan(key: PermissionKey): boolean {
  const user = useCurrentUser();
  if (!user) return false;
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
  const eggSales = useApp(s => s.eggSales);
  const feedStock = useApp(s => s.feedStock);
  const feedFormulas = useApp(s => s.feedFormulas);
  const finance = useApp(s => s.finance);
  const traders = useApp(s => s.traders);
  const traderTxns = useApp(s => s.traderTxns);
  const tasks = useApp(s => s.tasks);
  const dayLocks = useApp(s => s.dayLocks);
  const disposals = useApp(s => s.disposals);
  const users = useApp(s => s.users);
  const assignments = useApp(s => s.assignments);
  const audit = useApp(s => s.audit);

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
      eggSales: inCo(eggSales),
      feedStock: inCo(feedStock),
      feedFormulas: inCo(feedFormulas),
      finance: inCo(finance),
      traders: inCo(traders),
      traderTxns: inCo(traderTxns),
      tasks: inCo(tasks),
      dayLocks: inCo(dayLocks),
      disposals: inCo(disposals),
      assignments: inCo(assignments),
      audit: audit.filter(a => a.companyId === companyId),
      users: users.filter(u => u.companyIds.includes(companyId ?? '__none__')),
    };
  }, [
    companyId, companies, farms, sheds, batches, mortality, eggs, feed, saleLogs,
    eggSales, feedStock, feedFormulas, finance, traders, traderTxns, tasks,
    dayLocks, disposals, assignments, audit, users,
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

export function todayDate(): string { return todayISO(); }
