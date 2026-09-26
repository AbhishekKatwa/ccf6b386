/**
 * team.ts — who works in this company, and what this browser may do about it.
 *
 * Nothing here is stored. A person's sheds are the sheds the batches they hold access to stand
 * on, their last activity is the last thing the audit trail recorded them doing here, and their
 * access is the same navigation the app would show them. Every one of those is read off slices
 * the store already holds, so managing the team cannot disagree with operating the farm — and a
 * second copy of a person's rights is never created to fall out of date (§7, §9, §12).
 */
import { GROUPS, allowed, itemVisible } from '@/components/layout/nav';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_LABELS, type AuditEntry, type Batch, type BatchAssignment, type PermissionKey, type Role, type Shed, type User } from '@/types';

/**
 * What an owner may hand out. OWNER is deliberately absent: an owner lowers access and never
 * raises it into ownership, and a platform account is the platform's to create (§2, §9).
 */
export const MANAGEABLE_ROLES: readonly Role[] = ['FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR'];

/** The rights worth naming to a person who runs the farm, in the order they matter. */
const RIGHTS: { key: PermissionKey; label: string }[] = [
  { key: 'createDailyOps', label: "Records the day's work" },
  { key: 'create', label: 'Adds new records' },
  { key: 'update', label: 'Corrects a saved record' },
  { key: 'delete', label: 'Deletes a record' },
  { key: 'viewFinance', label: 'Sees money and rates' },
  { key: 'manageTraders', label: 'Manages traders' },
  { key: 'createSaleEntries', label: 'Creates egg sales' },
  { key: 'manageFormulas', label: 'Edits feed formulas' },
  { key: 'manageVaccination', label: 'Plans vaccination' },
  { key: 'completeVaccination', label: 'Marks vaccination done' },
  { key: 'closeBatch', label: 'Closes a batch' },
  { key: 'exportReports', label: 'Opens reports' },
  { key: 'manageUsers', label: 'Manages people and access' },
];

export interface TeamRow {
  user: User;
  /** Shed names this person works, derived from their batch access and shed roles. */
  sheds: Shed[];
  /** Their live batches. A closed one is history, not an assignment to act on. */
  liveBatches: Batch[];
  /** The last thing they did here, from the audit trail. Not a login time: nothing in this
   *  schema records one, and an absent figure is better than an invented one. */
  lastActivity: string | null;
  /** Batches whose grant set gives them more than their role alone. */
  grantedBatches: number;
  /** False with a `blockReason` beside it: the person is visible but out of this owner's reach. */
  manageable: boolean;
  blockReason: string | null;
  /** Somebody else's employee as well as this company's — the reason a shared person is platform work. */
  sharedElsewhere: boolean;
}

export interface TeamScope {
  users: User[];
  sheds: Shed[];
  batches: Batch[];
  assignments: BatchAssignment[];
  audit: AuditEntry[];
  companyId: string | null;
  caller: User | null;
  /** A platform session administers people everywhere; a company session only within it. */
  platform: boolean;
}

/**
 * The roster of one company. `users` is expected to be the active company's already — the caller
 * is `useCompanyData()`, whose filter is the same membership the database answers with.
 */
export function buildTeam(scope: TeamScope): TeamRow[] {
  const { users, sheds, batches, assignments, audit, companyId, caller, platform } = scope;
  const shedById = new Map(sheds.map(s => [s.id, s]));
  const batchById = new Map(batches.map(b => [b.id, b]));
  const theirs = new Map<string, BatchAssignment[]>();
  for (const a of assignments) {
    const list = theirs.get(a.userId);
    if (list) list.push(a); else theirs.set(a.userId, [a]);
  }
  const lastByUser = new Map<string, string>();
  for (const entry of audit) {
    if (!entry.byUserId) continue;
    if (companyId && entry.companyId !== companyId) continue;
    if ((lastByUser.get(entry.byUserId) ?? '') < entry.at) lastByUser.set(entry.byUserId, entry.at);
  }

  return users
    .map(user => {
      const assigned = theirs.get(user.id) ?? [];
      const assignedBatches = assigned
        .map(a => batchById.get(a.batchId))
        .filter((b): b is Batch => !!b);
      const shedIds = new Set(assignedBatches.map(b => b.shedId));
      for (const shed of sheds) {
        if (shed.farmSupervisorId === user.id || shed.financialSupervisorId === user.id) shedIds.add(shed.id);
      }
      const blocked = personBlock(user, caller, platform);
      return {
        user,
        sheds: [...shedIds].map(id => shedById.get(id)).filter((s): s is Shed => !!s)
          .sort((a, b) => a.name.localeCompare(b.name)),
        liveBatches: assignedBatches.filter(b => b.status === 'ACTIVE'),
        lastActivity: lastByUser.get(user.id) ?? null,
        grantedBatches: assigned.filter(a => Object.values(a.permissions).some(Boolean)).length,
        manageable: blocked === null,
        blockReason: blocked,
        sharedElsewhere: user.companyIds.length > 1,
      };
    })
    .sort((a, b) => Number(b.user.active) - Number(a.user.active)
      || a.user.name.localeCompare(b.user.name));
}

/**
 * Why this person is not this session's to change, or null when they are. The one rule the
 * screen, the store and the database all read, so a row can never look editable here and be
 * refused there (§6, §9).
 */
export function personBlock(user: User, caller: User | null, platform: boolean): string | null {
  if (caller && user.id === caller.id) {
    return 'This is your own account. Another owner or the platform admin has to change it.';
  }
  if (user.role === 'MASTER_ADMIN') return 'A platform account is managed from the platform panel.';
  if (platform) return null;
  // Their role and their active flag are one fact for the whole platform. Moving them would
  // move them somewhere this owner has no standing, so a shared person stays platform work (§6).
  if (user.companyIds.length > 1) {
    return 'They belong to more than one company, so only the platform admin can change their access.';
  }
  return null;
}

/** The guard on a role change, read by the form, the store and the database in the same words. */
export function roleChangeError(target: User, next: Role): string | null {
  if (next === target.role) return null;
  if (!MANAGEABLE_ROLES.includes(next)) return 'Choose an operational role for this person.';
  return null;
}

/**
 * What a role opens, in the words the app already uses: the navigation that person would see,
 * and the rights the matrix gives them. It is the same function both the router and the sidebar
 * consult, so this list cannot drift away from what the person finds on screen (§12).
 * Internal keys never appear here.
 */
export function accessOf(role: Role): { title: string; items: { label: string; on: boolean }[] }[] {
  const modules = GROUPS
    // The platform panel is not a company module; a company person never holds it either way.
    .filter(g => g.title !== 'Platform')
    .map(g => ({
      title: g.title,
      items: g.items.map(item => ({ label: item.label, on: allowed(g, role) && itemVisible(item, role) })),
    }));
  const rights = RIGHTS.map(({ key, label }) => ({
    label, on: !!DEFAULT_ROLE_PERMISSIONS[role]?.[key],
  }));
  return [...modules, { title: 'What they may do', items: rights }];
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}
