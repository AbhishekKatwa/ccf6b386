import type { PermissionKey, PermissionSet, Role } from '@/types';
import { NO_PERMISSIONS } from '@/types';

/**
 * Role-based permission matrix. Permissions are enforced at the data layer
 * (store actions + selectors), not merely hidden in the UI.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, PermissionSet> = {
  // Global platform administration. Manages companies + users; cannot touch a
  // company's farm data without explicitly entering that company context.
  // Once inside, every panel is visible and readable — money included.
  MASTER_ADMIN: {
    ...NO_PERMISSIONS,
    manageCompanies: true, manageUsers: true,
    viewFinance: true, viewRates: true,
  },

  // Full access to their own company.
  OWNER: {
    create: true, createDailyOps: true, update: true, delete: true,
    viewFinance: true, viewRates: true,
    manageUsers: true, manageCompanies: false,
    manageTraders: true, manageFormulas: true, acknowledgeSales: true,
    createSaleEntries: true,
    closeBatch: true, exportReports: true,
    manageVaccination: true, completeVaccination: true,
  },

  // Operational supervisor: daily ops, feed, mortality, tasks, egg stock + shed dispatch logs.
  // Reports belong to the Owner and Finance, not to operations.
  FARM_SUPERVISOR: {
    create: true, createDailyOps: true, update: true, delete: false,
    viewFinance: false, viewRates: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: false, manageFormulas: true, acknowledgeSales: false,
    createSaleEntries: false,
    closeBatch: false, exportReports: false,
    completeVaccination: true, manageVaccination: false,
  },

  // Financial + sales: traders, balances, and the final sale entry that actually
  // moves stock and books the money. Formulas are read-only unless a shed
  // assignment explicitly grants it.
  FINANCIAL_SUPERVISOR: {
    create: false, createDailyOps: false, update: true, delete: false,
    viewFinance: true, viewRates: true,
    manageUsers: false, manageCompanies: false,
    manageTraders: true, manageFormulas: false, acknowledgeSales: true,
    createSaleEntries: true,
    closeBatch: false, exportReports: true,
    // Vaccination is farm work, not money work: no access unless a batch grants it (§13).
    manageVaccination: false, completeVaccination: false,
  },

  // Operational only. Creates SHED DISPATCH LOGS and nothing else (§5).
  FARM_MANAGER: {
    create: true, createDailyOps: false, update: false, delete: false,
    viewFinance: false, viewRates: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: false, manageFormulas: false, acknowledgeSales: false,
    createSaleEntries: false,
    closeBatch: false, exportReports: false,
    completeVaccination: true, manageVaccination: false,
  },

  // Extremely simple operator: today's entries + assigned tasks only.
  FARM_LABOR: {
    create: true, createDailyOps: true, update: false, delete: false,
    viewFinance: false, viewRates: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: false, manageFormulas: false, acknowledgeSales: false,
    createSaleEntries: false,
    closeBatch: false, exportReports: false,
    completeVaccination: true, manageVaccination: false,
  },
};

export function roleCan(role: Role, key: PermissionKey): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.[key] ?? false;
}

/**
 * Whether a role may read a table at all — the SELECT verb a slice declares in the sync
 * registry, which mirrors migration 003's own read policy.
 *
 * One function answers it because three callers must never disagree: the sync engine (a slice
 * this session cannot read is left out of the queue entirely), the backup (what a person may
 * carry out of the company), and the restore preview (what may come back in). `verb` is taken
 * structurally so this file stays free of the sync layer.
 */
export function roleReadable(
  role: Role | undefined,
  verb: { readKey?: PermissionKey; readRoles?: readonly Role[] },
): boolean {
  if (!role) return false;
  if (!verb.readKey && !verb.readRoles) return true;
  return verb.readKey ? roleCan(role, verb.readKey) : verb.readRoles!.includes(role);
}

/* ============================= module role gates =============================
 * Shared by the router guards and the screens that list modules, so a module is
 * never offered where the user cannot open it (§14). */

/** Godown feed inventory in KG. */
export const GODOWN_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'MASTER_ADMIN'];
/** Traders, balances and final sales. */
export const COMMERCE_ROLES: Role[] = ['OWNER', 'FINANCIAL_SUPERVISOR', 'MASTER_ADMIN'];
/** Printable reports, including a batch's daily report. */
export const REPORT_ROLES: Role[] = ['OWNER', 'FINANCIAL_SUPERVISOR', 'MASTER_ADMIN'];
/** The batch workspace; farm labor stays on their own simple screens (§5). */
export const OPS_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'];
/**
 * Who lays out a company's farms and sheds. A Farm Manager is shown only the sheds an
 * assignment gives them, so a shed they created would never appear for them; the Master
 * Admin is included because a brand-new company has no Owner to sign in as yet.
 */
export const STRUCTURE_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'MASTER_ADMIN'];
/** Every role except farm labor may read formulas; only manageFormulas may edit. */
export const FORMULA_VIEW_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'];
/**
 * Who may open the vaccination module. It is flock work, so money roles stay out
 * unless a batch assignment grants it, and the Master Admin keeps to company administration.
 */
export const VACCINATION_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR'];
/**
 * Who may open the medicine & vaccine store. It is the inventory behind the same flock
 * work, so the operational roles plus the platform admin read it; money roles settle its
 * payables through Finance rather than browsing the shelf.
 */
export const MEDICINE_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR', 'MASTER_ADMIN'];

/** Formula modules are operational data: farm labor never sees them (§5). */
export function canViewFormulas(role: Role | undefined): boolean {
  return !!role && role !== 'FARM_LABOR';
}

/**
 * Resolve a permission for a user in a company context. An OWNER has every
 * company-scoped permission. A MASTER_ADMIN only holds management permissions
 * (company/user), never silent farm-data access.
 */
export function effectiveCan(
  role: Role,
  perms: PermissionSet | undefined,
  key: PermissionKey,
): boolean {
  if (role === 'OWNER') return true;
  if (perms && perms[key]) return true;
  return DEFAULT_ROLE_PERMISSIONS[role]?.[key] ?? false;
}

/** Money is masked for anyone without viewFinance. */
export function maskMoney(_amount: number): string {
  return '₹•••••';
}
