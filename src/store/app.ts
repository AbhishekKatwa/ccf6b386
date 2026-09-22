import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AuditEntry, Batch, BatchAssignment, DayLock, EggCollection, EggSale,
  Farm, FarmTask, FeedConsumption, FeedFormula, FeedStockEntry, FinanceTxn,
  MortalityEntry, PermissionKey, PermissionSet, Role, Session, Shed, Trader,
  TraderTxn, User, WeightEntry,
} from '@/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';
import { nowISO, todayISO, uid } from '@/lib/format';
import {
  seedAssignments, seedAudit, seedBatches, seedDayLocks, seedEggSales,
  seedEggs, seedFarms, seedFeed, seedFeedFormulas, seedFeedStock, seedFinance,
  seedMortality, seedSheds, seedTasks, seedTraderTxns, seedTraders,
  seedUsers, seedWeights,
} from '@/data/seed';

interface Toast { id: string; kind: 'success' | 'error' | 'info'; message: string }

interface AppState {
  users: User[];
  farms: Farm[];
  sheds: Shed[];
  batches: Batch[];
  assignments: BatchAssignment[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  eggs: EggCollection[];
  weights: WeightEntry[];
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

  signIn: (mobile: string) => { ok: boolean; error?: string };
  signOut: () => void;
  setOnline: (v: boolean) => void;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;

  addFarm: (f: Omit<Farm, 'id' | 'createdAt' | 'updatedAt'>) => Farm;
  updateFarm: (id: string, patch: Partial<Farm>) => void;
  addShed: (s: Omit<Shed, 'id' | 'createdAt' | 'updatedAt'>) => Shed;
  updateShed: (id: string, patch: Partial<Shed>) => void;

  addBatch: (b: Omit<Batch, 'id' | 'createdAt' | 'updatedAt'>) => Batch;
  updateBatch: (id: string, patch: Partial<Batch>) => void;

  assignUser: (input: {
    batchId: string; mobile: string; role: Role;
    perms: Pick<PermissionSet, 'create' | 'update' | 'delete'>;
    comments?: string;
  }) => { ok: boolean; error?: string };
  revokeAssignment: (id: string) => void;

  addMortality: (m: Omit<MortalityEntry, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };
  addFeed: (f: Omit<FeedConsumption, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };
  addWeight: (w: Omit<WeightEntry, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };
  addEggCollection: (e: Omit<EggCollection, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };
  addEggSale: (s: Omit<EggSale, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };
  deleteEggSale: (id: string) => { ok: boolean; error?: string };

  addFeedStock: (e: Omit<FeedStockEntry, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };
  addFeedFormula: (f: Omit<FeedFormula, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => FeedFormula;

  addFinance: (t: Omit<FinanceTxn, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };

  addTrader: (t: Omit<Trader, 'id' | 'createdAt' | 'updatedAt'>) => Trader;
  updateTrader: (id: string, patch: Partial<Trader>) => void;
  addTraderTxn: (t: Omit<TraderTxn, 'id' | 'createdAt' | 'createdBy' | 'synced'>) => { ok: boolean; error?: string };

  addTask: (t: Omit<FarmTask, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'synced'>) => FarmTask;
  updateTask: (id: string, patch: Partial<FarmTask>) => void;
  deleteTask: (id: string) => void;

  lockDay: (batchId: string, date: string, reason?: string) => { ok: boolean; error?: string };
  unlockDay: (batchId: string, date: string) => { ok: boolean; error?: string };
  isLocked: (batchId: string, date: string) => boolean;

  syncPending: () => void;
  resetDemo: () => void;
}

function audit(
  state: AppState,
  entity: string, entityId: string,
  action: AuditEntry['action'],
  field?: string, oldValue?: unknown, newValue?: unknown,
): AuditEntry[] {
  const entry: AuditEntry = {
    id: uid('au'), entity, entityId, action, field, oldValue, newValue,
    byUserId: state.session?.userId ?? 'system', at: nowISO(),
  };
  return [entry, ...state.audit].slice(0, 500);
}

export const useApp = create<AppState>()(persist(
  (set, get) => ({
    users: seedUsers,
    farms: seedFarms,
    sheds: seedSheds,
    batches: seedBatches,
    assignments: seedAssignments,
    mortality: seedMortality,
    feed: seedFeed,
    eggs: seedEggs,
    weights: seedWeights,
    eggSales: seedEggSales,
    feedStock: seedFeedStock,
    feedFormulas: seedFeedFormulas,
    finance: seedFinance,
    traders: seedTraders,
    traderTxns: seedTraderTxns,
    tasks: seedTasks,
    dayLocks: seedDayLocks,
    audit: seedAudit,
    session: null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    toasts: [],

    signIn: (mobile) => {
      const m = mobile.replace(/\D/g, '');
      if (m.length !== 10) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
      const user = get().users.find(u => u.mobile === m);
      if (!user) return { ok: false, error: 'No user found for this mobile number' };
      if (!user.active) return { ok: false, error: 'This account is inactive' };
      set(s => ({
        session: { userId: user.id, signedInAt: nowISO() },
        audit: audit(s, 'Session', user.id, 'CREATE'),
      }));
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

    addFarm: (f) => {
      const farm: Farm = { ...f, id: uid('farm'), createdAt: nowISO(), updatedAt: nowISO() };
      set(s => ({ farms: [...s.farms, farm], audit: audit(s, 'Farm', farm.id, 'CREATE') }));
      return farm;
    },
    updateFarm: (id, patch) => set(s => ({
      farms: s.farms.map(f => f.id === id ? { ...f, ...patch, updatedAt: nowISO() } : f),
    })),
    addShed: (sh) => {
      const shed: Shed = { ...sh, id: uid('shed'), createdAt: nowISO(), updatedAt: nowISO() };
      set(s => ({ sheds: [...s.sheds, shed], audit: audit(s, 'Shed', shed.id, 'CREATE') }));
      return shed;
    },
    updateShed: (id, patch) => set(s => ({
      sheds: s.sheds.map(x => x.id === id ? { ...x, ...patch, updatedAt: nowISO() } : x),
    })),

    addBatch: (b) => {
      const batch: Batch = { ...b, id: uid('batch'), createdAt: nowISO(), updatedAt: nowISO() };
      set(s => ({ batches: [...s.batches, batch], audit: audit(s, 'Batch', batch.id, 'CREATE') }));
      return batch;
    },
    updateBatch: (id, patch) => set(s => ({
      batches: s.batches.map(b => b.id === id ? { ...b, ...patch, updatedAt: nowISO() } : b),
    })),

    assignUser: ({ batchId, mobile, role, perms, comments }) => {
      const m = mobile.replace(/\D/g, '');
      if (m.length !== 10) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
      const u = get().users.find(x => x.mobile === m);
      if (!u) return { ok: false, error: `No user found for ${m}` };
      const existing = get().assignments.find(a => a.batchId === batchId && a.userId === u.id);
      if (existing) return { ok: false, error: `${u.name} already has access to this batch` };
      if (!perms.create && !perms.update && !perms.delete) {
        return { ok: false, error: 'Select at least one permission' };
      }
      const permissions: PermissionSet = {
        ...DEFAULT_ROLE_PERMISSIONS[role],
        create: perms.create, update: perms.update, delete: perms.delete,
      };
      const a: BatchAssignment = {
        id: uid('asg'), batchId, userId: u.id, role, permissions, comments,
        assignedBy: get().session?.userId ?? 'u_owner', assignedAt: nowISO(),
      };
      set(s => ({
        assignments: [...s.assignments, a],
        audit: audit(s, 'Assignment', a.id, 'CREATE', undefined, undefined, { batchId, userId: u.id, role }),
      }));
      return { ok: true };
    },
    revokeAssignment: (id) => set(s => ({
      assignments: s.assignments.filter(a => a.id !== id),
      audit: audit(s, 'Assignment', id, 'DELETE'),
    })),

    addMortality: (m) => {
      const locked = get().isLocked(m.batchId, m.date);
      if (locked) return { ok: false, error: 'Day is locked — contact owner' };
      if (m.count <= 0) return { ok: false, error: 'Count must be greater than 0' };
      const entry: MortalityEntry = {
        ...m, id: uid('mort'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({ mortality: [...s.mortality, entry], audit: audit(s, 'Mortality', entry.id, 'CREATE') }));
      return { ok: true };
    },
    addFeed: (f) => {
      const locked = get().isLocked(f.batchId, f.date);
      if (locked) return { ok: false, error: 'Day is locked — contact owner' };
      if (f.bags <= 0 || f.bagWeightKg <= 0) return { ok: false, error: 'Bags and bag weight must be > 0' };
      const entry: FeedConsumption = {
        ...f, id: uid('feed'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({ feed: [...s.feed, entry], audit: audit(s, 'Feed', entry.id, 'CREATE') }));
      return { ok: true };
    },
    addWeight: (w) => {
      const entry: WeightEntry = {
        ...w, id: uid('wt'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({ weights: [...s.weights, entry] }));
      return { ok: true };
    },
    addEggCollection: (e) => {
      const locked = get().isLocked(e.batchId, e.date);
      if (locked) return { ok: false, error: 'Day is locked — contact owner' };
      if (e.good < 0 || e.damaged < 0 || e.cracked < 0) return { ok: false, error: 'Negative counts not allowed' };
      if (e.good + e.damaged + e.cracked === 0) return { ok: false, error: 'Enter at least one egg count' };
      const entry: EggCollection = {
        ...e, id: uid('egg'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({ eggs: [...s.eggs, entry], audit: audit(s, 'EggCollection', entry.id, 'CREATE') }));
      return { ok: true };
    },
    addEggSale: (sale) => {
      if (sale.trays <= 0) return { ok: false, error: 'Trays must be greater than 0' };
      if (sale.ratePerEgg <= 0) return { ok: false, error: 'Rate must be greater than 0' };
      const entry: EggSale = {
        ...sale, id: uid('sale'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      const amount = sale.trays * sale.eggsPerTray * sale.ratePerEgg;
      set(s => ({
        eggSales: [...s.eggSales, entry],
        finance: [...s.finance, {
          id: uid('fx'), batchId: sale.batchId, date: sale.date, kind: 'SALE',
          amount, category: 'Egg Sale', counterparty: sale.buyerName,
          createdBy: s.session?.userId ?? 'u_owner', createdAt: nowISO(), synced: s.online,
        }],
        audit: audit(s, 'EggSale', entry.id, 'CREATE'),
      }));
      return { ok: true };
    },
    deleteEggSale: (id) => {
      const sale = get().eggSales.find(s => s.id === id);
      if (!sale) return { ok: false, error: 'Sale not found' };
      set(s => ({
        eggSales: s.eggSales.filter(x => x.id !== id),
        finance: s.finance.filter(f => !(f.category === 'Egg Sale' && f.date === sale.date && f.amount === sale.trays * sale.eggsPerTray * sale.ratePerEgg && f.counterparty === sale.buyerName)),
        audit: audit(s, 'EggSale', id, 'DELETE'),
      }));
      return { ok: true };
    },

    addFeedStock: (e) => {
      if (e.qtyKg <= 0 && e.kind !== 'CONSUMPTION') return { ok: false, error: 'Quantity must be > 0' };
      const entry: FeedStockEntry = {
        ...e, id: uid('fs'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({ feedStock: [...s.feedStock, entry], audit: audit(s, 'FeedStock', entry.id, 'CREATE') }));
      return { ok: true };
    },
    addFeedFormula: (f) => {
      const formula: FeedFormula = {
        ...f, id: uid('ff'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), updatedAt: nowISO(),
      };
      set(s => ({ feedFormulas: [...s.feedFormulas, formula], audit: audit(s, 'FeedFormula', formula.id, 'CREATE') }));
      return formula;
    },

    addFinance: (t) => {
      if (t.amount === 0) return { ok: false, error: 'Amount cannot be zero' };
      const entry: FinanceTxn = {
        ...t, id: uid('fx'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({ finance: [...s.finance, entry], audit: audit(s, 'Finance', entry.id, 'CREATE') }));
      return { ok: true };
    },

    addTrader: (t) => {
      const trader: Trader = { ...t, id: uid('tr'), createdAt: nowISO(), updatedAt: nowISO() };
      set(s => ({ traders: [...s.traders, trader], audit: audit(s, 'Trader', trader.id, 'CREATE') }));
      return trader;
    },
    updateTrader: (id, patch) => set(s => ({
      traders: s.traders.map(t => t.id === id ? { ...t, ...patch, updatedAt: nowISO() } : t),
    })),
    addTraderTxn: (t) => {
      const entry: TraderTxn = {
        ...t, id: uid('tt'), createdBy: get().session?.userId ?? 'u_owner',
        createdAt: nowISO(), synced: get().online,
      };
      set(s => ({
        traderTxns: [...s.traderTxns, entry],
        traders: s.traders.map(tr => tr.id === t.traderId
          ? {
              ...tr,
              outstandingAmount: t.kind === 'EGG_SALE'
                ? tr.outstandingAmount + t.amount
                : t.kind === 'PAYMENT_IN'
                  ? Math.max(0, tr.outstandingAmount - t.amount)
                  : tr.outstandingAmount,
            }
          : tr),
      }));
      return { ok: true };
    },

    addTask: (t) => {
      const task: FarmTask = {
        ...t, id: uid('tk'), createdBy: get().session?.userId ?? 'u_owner',
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

    lockDay: (batchId, date, reason) => {
      const session = get().session;
      const user = get().users.find(u => u.id === session?.userId);
      if (!user) return { ok: false, error: 'Not signed in' };
      if (!DEFAULT_ROLE_PERMISSIONS[user.role].lockDay) return { ok: false, error: 'You do not have permission to lock a day' };
      if (get().dayLocks.some(l => l.batchId === batchId && l.date === date)) return { ok: false, error: 'Already locked' };
      set(s => ({
        dayLocks: [...s.dayLocks, { batchId, date, lockedBy: user.id, lockedAt: nowISO(), reason }],
        audit: audit(s, 'DayLock', `${batchId}:${date}`, 'LOCK', date, false, true),
      }));
      return { ok: true };
    },
    unlockDay: (batchId, date) => {
      const session = get().session;
      const user = get().users.find(u => u.id === session?.userId);
      if (!user) return { ok: false, error: 'Not signed in' };
      if (!DEFAULT_ROLE_PERMISSIONS[user.role].unlockDay) return { ok: false, error: 'Only OWNER can unlock a day' };
      set(s => ({
        dayLocks: s.dayLocks.filter(l => !(l.batchId === batchId && l.date === date)),
        audit: audit(s, 'DayLock', `${batchId}:${date}`, 'UNLOCK', date, true, false),
      }));
      return { ok: true };
    },
    isLocked: (batchId, date) => get().dayLocks.some(l => l.batchId === batchId && l.date === date),

    syncPending: () => {
      set(s => ({
        mortality: s.mortality.map(m => ({ ...m, synced: true })),
        feed: s.feed.map(f => ({ ...f, synced: true })),
        eggs: s.eggs.map(e => ({ ...e, synced: true })),
        weights: s.weights.map(w => ({ ...w, synced: true })),
        eggSales: s.eggSales.map(x => ({ ...x, synced: true })),
        feedStock: s.feedStock.map(x => ({ ...x, synced: true })),
        finance: s.finance.map(x => ({ ...x, synced: true })),
        traderTxns: s.traderTxns.map(x => ({ ...x, synced: true })),
        tasks: s.tasks.map(x => ({ ...x, synced: true })),
      }));
    },

    resetDemo: () => set({
      users: seedUsers, farms: seedFarms, sheds: seedSheds, batches: seedBatches,
      assignments: seedAssignments, mortality: seedMortality, feed: seedFeed,
      eggs: seedEggs, weights: seedWeights, eggSales: seedEggSales,
      feedStock: seedFeedStock, feedFormulas: seedFeedFormulas, finance: seedFinance,
      traders: seedTraders, traderTxns: seedTraderTxns, tasks: seedTasks,
      dayLocks: seedDayLocks, audit: seedAudit,
    }),
  }),
  {
    name: 'amrut-poultry-v1',
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => {
      const { toasts, online, ...rest } = s;
      return rest as unknown as AppState;
    },
  },
));

export function useCurrentUser(): User | null {
  const userId = useApp(s => s.session?.userId);
  const users = useApp(s => s.users);
  return users.find(u => u.id === userId) ?? null;
}

export function useCan(key: PermissionKey): boolean {
  const user = useCurrentUser();
  if (!user) return false;
  return DEFAULT_ROLE_PERMISSIONS[user.role]?.[key] ?? false;
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
