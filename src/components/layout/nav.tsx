import type { ReactNode } from 'react';
import {
  LayoutDashboard, Warehouse, Wheat, Handshake, Wallet, BarChart3, User, Phone,
  Receipt, History, Pill, Egg, Building2, GitCommitHorizontal, Users, DatabaseBackup,
} from 'lucide-react';
import type { PermissionKey, Role } from '@/types';
import { MEDICINE_ROLES, roleCan } from '@/lib/permissions';

/**
 * The navigation map, in one place so the shell and the command palette offer exactly the
 * same destinations to the same roles (§14). Icons stay as elements: a screen that draws a
 * row differently still reads the same list.
 */
export interface NavItem {
  to: string; label: string; icon: ReactNode; end?: boolean; roles?: Role[];
  /**
   * A module whose door is the permission rather than a name on a list. Anything carrying one
   * is offered precisely where `useCan()` says yes, so the tab, the route guard and the screen
   * cannot disagree about who runs it.
   */
  permission?: PermissionKey;
}
export interface NavGroup { title: string; items: NavItem[]; roles?: Role[] }
export interface MoreAction { icon: ReactNode; label: string; hint?: string; onClick: () => void; roles?: Role[] }

const M: Role = 'MASTER_ADMIN';

export const GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={17} />, end: true },
      { to: '/log', label: "Today's log", icon: <History size={17} />, roles: ['FARM_LABOR'] },
    ],
  },
  {
    title: 'Farm',
    roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', M],
    items: [
      { to: '/farms', label: 'Sheds', icon: <Warehouse size={17} /> },
      { to: '/feed', label: 'Godown', end: true, icon: <Wheat size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', M] },
      { to: '/medicines', label: 'Medicines & Vaccines', icon: <Pill size={17} />, roles: MEDICINE_ROLES },
      { to: '/timeline', label: 'Timeline', icon: <GitCommitHorizontal size={17} /> },
      { to: '/users', label: 'Users', icon: <Users size={17} />, permission: 'manageUsers' },
    ],
  },
  {
    title: 'Commerce',
    roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR', M],
    items: [
      { to: '/sales', label: 'Sales', end: true, icon: <Receipt size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR', M] },
      { to: '/eggs', label: 'Eggs', icon: <Egg size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR', M] },
      { to: '/traders', label: 'Traders', icon: <Handshake size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', M] },
      { to: '/finance', label: 'Finance', icon: <Wallet size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', M] },
    ],
  },
  {
    title: 'Insights',
    roles: ['OWNER', 'FINANCIAL_SUPERVISOR', M],
    items: [
      { to: '/reports', label: 'Reports', icon: <BarChart3 size={17} /> },
      { to: '/backup', label: 'Backup & Recovery', icon: <DatabaseBackup size={17} />, permission: 'exportReports' },
    ],
  },
  {
    title: 'Platform',
    roles: ['MASTER_ADMIN'],
    items: [
      { to: '/admin', label: 'Companies', icon: <Building2 size={17} /> },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/profile', label: 'Profile', icon: <User size={17} /> },
      { to: '/contact', label: 'Support', icon: <Phone size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', M] },
    ],
  },
];

export function allowed(item: { roles?: Role[] }, role: Role): boolean {
  return !item.roles || item.roles.includes(role);
}

/** Whether this destination stands open for a role: named for them, and holding the permission. */
export function itemVisible(item: NavItem, role: Role): boolean {
  return allowed(item, role) && (!item.permission || roleCan(role, item.permission));
}

export function visibleGroups(role: Role): NavGroup[] {
  return GROUPS
    .filter(g => allowed(g, role))
    .map(g => ({ ...g, items: g.items.filter(it => itemVisible(it, role)) }))
    .filter(g => g.items.length > 0);
}

/** Four thumb-reach destinations; everything else lives in the More sheet or the palette. */
export function mobileTabs(role: Role): NavItem[] {
  if (role === 'FARM_LABOR') {
    return [
      { to: '/', label: 'Today', icon: <LayoutDashboard size={20} />, end: true },
      { to: '/log', label: 'Log', icon: <History size={20} /> },
    ];
  }
  if (role === 'MASTER_ADMIN') {
    return [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} />, end: true },
      { to: '/admin', label: 'Companies', icon: <Building2 size={20} /> },
      { to: '/profile', label: 'Profile', icon: <User size={20} /> },
    ];
  }
  const base: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} />, end: true },
    { to: '/farms', label: 'Sheds', icon: <Warehouse size={20} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER'] },
    { to: '/sales', label: 'Sales', end: true, icon: <Receipt size={20} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR'] },
  ];
  return base.filter(t => allowed(t, role)).slice(0, 4);
}
