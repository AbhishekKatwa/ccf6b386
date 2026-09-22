import type { PermissionKey, PermissionSet, Role } from '@/types';
import { NO_PERMISSIONS } from '@/types';

/**
 * Role-based permission matrix. Permissions are enforced at the data layer
 * (store actions + selectors), not merely hidden in the UI.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, PermissionSet> = {
  // Global platform administration. Manages companies + users; cannot touch a
  // company's farm data without explicitly entering that company context.
  MASTER_ADMIN: {
    ...NO_PERMISSIONS,
    manageCompanies: true, manageUsers: true,
  },

  // Full access to their own company.
  OWNER: {
    create: true, createDailyOps: true, update: true, delete: true,
    viewFinance: true, viewRates: true,
    lockDay: true, unlockDay: true,
    manageUsers: true, manageCompanies: false,
    manageTraders: true, manageFormulas: true, acknowledgeSales: true,
    closeBatch: true, exportReports: true,
  },

  // Operational supervisor: daily ops, feed, mortality, tasks, egg stock + sale logs.
  FARM_SUPERVISOR: {
    create: true, createDailyOps: true, update: true, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: true, unlockDay: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: false, manageFormulas: true, acknowledgeSales: false,
    closeBatch: false, exportReports: true,
  },

  // Financial + sales: traders, balances, acknowledge/collate sale logs, final sales.
  // Formulas are read-only unless a shed assignment explicitly grants it.
  FINANCIAL_SUPERVISOR: {
    create: false, createDailyOps: false, update: true, delete: false,
    viewFinance: true, viewRates: true,
    lockDay: false, unlockDay: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: true, manageFormulas: false, acknowledgeSales: true,
    closeBatch: false, exportReports: true,
  },

  // Operational only. Creates SHED SALE LOGS and nothing else (§5).
  FARM_MANAGER: {
    create: true, createDailyOps: false, update: false, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: false, unlockDay: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: false, manageFormulas: false, acknowledgeSales: false,
    closeBatch: false, exportReports: false,
  },

  // Extremely simple operator: today's entries + assigned tasks only.
  FARM_LABOR: {
    create: true, createDailyOps: true, update: false, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: false, unlockDay: false,
    manageUsers: false, manageCompanies: false,
    manageTraders: false, manageFormulas: false, acknowledgeSales: false,
    closeBatch: false, exportReports: false,
  },
};

export function roleCan(role: Role, key: PermissionKey): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.[key] ?? false;
}

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
