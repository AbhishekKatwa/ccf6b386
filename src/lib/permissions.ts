import type { PermissionKey, PermissionSet, Role } from '@/types';

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, PermissionSet> = {
  OWNER: {
    create: true, update: true, delete: true,
    viewFinance: true, viewRates: true,
    lockDay: true, unlockDay: true,
    manageUsers: true, exportReports: true,
  },
  FARMER: {
    create: true, update: true, delete: false,
    viewFinance: true, viewRates: true,
    lockDay: false, unlockDay: false,
    manageUsers: false, exportReports: true,
  },
  FINANCER: {
    create: true, update: true, delete: false,
    viewFinance: true, viewRates: true,
    lockDay: false, unlockDay: false,
    manageUsers: false, exportReports: true,
  },
  COMPANY_MANAGER: {
    create: true, update: true, delete: false,
    viewFinance: true, viewRates: true,
    lockDay: true, unlockDay: false,
    manageUsers: true, exportReports: true,
  },
  COMPANY_SUPERVISOR: {
    create: true, update: true, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: false, unlockDay: false,
    manageUsers: false, exportReports: true,
  },
  FARM_MANAGER: {
    create: true, update: true, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: true, unlockDay: false,
    manageUsers: false, exportReports: true,
  },
  FARM_SUPERVISOR: {
    create: true, update: true, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: false, unlockDay: false,
    manageUsers: false, exportReports: false,
  },
  FARM_EMPLOYEE: {
    create: true, update: false, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: false, unlockDay: false,
    manageUsers: false, exportReports: false,
  },
  OTHER: {
    create: false, update: false, delete: false,
    viewFinance: false, viewRates: false,
    lockDay: false, unlockDay: false,
    manageUsers: false, exportReports: false,
  },
};

export function roleCan(role: Role, key: PermissionKey): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role]?.[key] ?? false;
}

export function effectiveCan(
  role: Role,
  perms: PermissionSet | undefined,
  key: PermissionKey,
): boolean {
  if (role === 'OWNER') return true;
  if (perms && perms[key]) return true;
  return DEFAULT_ROLE_PERMISSIONS[role]?.[key] ?? false;
}

export function maskMoney(amount: number): string {
  return '₹•••••';
}
