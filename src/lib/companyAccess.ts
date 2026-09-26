/**
 * companyAccess.ts — the one answer to "may this person be working in this company right now?".
 *
 * The store caches a session, a company context and a role, and every one of them can be a
 * day old: a company gets deactivated, a membership gets removed, a role changes while the
 * browser is closed. None of those are facts the cached copy may be trusted for, so each one
 * is re-read off the slices the pull just refreshed. This is the client's mirror of what
 * app.member_of()/app.role_in() decide in the database (000/003) — the RLS is the boundary,
 * this is what stops the app offering a write the boundary will refuse.
 */
import type { Company, Session, User } from '@/types';

export type AccessReason =
  | 'USABLE'
  | 'NO_SESSION'
  | 'NO_CONTEXT'
  /** The person's own account has been switched off since this session was taken. */
  | 'ACCOUNT_DEACTIVATED'
  /** The company exists and this person belongs to it; it is switched off. */
  | 'INACTIVE'
  /** The person is no longer attached to the company they were working in. */
  | 'MEMBERSHIP_REMOVED'
  /** The context names a company this browser has no record of. */
  | 'UNKNOWN_COMPANY';

export interface CompanyAccess {
  reason: AccessReason;
  companyId: string | null;
  /** The company's own name, for the message. No farm data is ever carried here. */
  companyName: string | null;
}

/** A platform admin belongs to no membership row and reaches every company from the platform
 *  side — the same carve-out app.member_of makes. '*' is how a cached save spells that role. */
export function isPlatformAdmin(user: User | null | undefined): boolean {
  return !!user && (user.role === 'MASTER_ADMIN' || user.companyIds.includes('*'));
}

function decide(
  reason: AccessReason, companyId: string | null, company?: Company,
): CompanyAccess {
  return { reason, companyId, companyName: company?.name ?? null };
}

export function companyAccessOf(
  session: Session | null,
  user: User | null | undefined,
  companies: Company[],
): CompanyAccess {
  if (!session || !user) return decide('NO_SESSION', session?.companyId ?? null);
  // Sign-in already refuses a switched-off account; this is the same refusal for the session
  // that was open when it happened. It is not a fact about one company, so no context is
  // carried into the message either.
  if (!user.active) return decide('ACCOUNT_DEACTIVATED', null);
  if (!session.companyId) {
    // No context chosen is normally just the picker. But when the person holds companies and
    // not one of them stands, there is nothing to pick — and calling that a blank slot hides
    // the reason and lets a reload drop it for good. Say what happened instead. A platform
    // admin is excluded: their management context is never a farm they operate (§16).
    const attached = isPlatformAdmin(user)
      ? companies : companies.filter(c => user.companyIds.includes(c.id));
    if (!isPlatformAdmin(user) && attached.length && operableCompanies(user, companies).length === 0) {
      return decide('INACTIVE', null);
    }
    return decide('NO_CONTEXT', null);
  }
  const company = companies.find(c => c.id === session.companyId);
  if (!company) return decide('UNKNOWN_COMPANY', session.companyId);
  // Inactive first: the state of the company is the answer whether or not the person still
  // holds a membership, and the message must not read as if their own access was revoked.
  if (!company.active) return decide('INACTIVE', company.id, company);
  if (!isPlatformAdmin(user) && !user.companyIds.includes(company.id)) {
    return decide('MEMBERSHIP_REMOVED', company.id, company);
  }
  return decide('USABLE', company.id, company);
}

/** The company this person may operate, or null. Every write path stamps this, never the raw
 *  session context, so a context that went stale mid-session cannot brand a new record. */
export function operableCompanyId(access: CompanyAccess): string | null {
  return access.reason === 'USABLE' ? access.companyId : null;
}

/** True when there is no company to work in, or the one there is stands. A null context is the
 *  platform's own screen, not a refusal, so it stays open for a Master Admin. */
export function contextIntact(access: CompanyAccess): boolean {
  return access.reason === 'USABLE' || access.reason === 'NO_CONTEXT';
}

/** The companies this person may enter to work. An inactive one is not offered at all — the
 *  platform panel is where a deactivated company stays visible, so it can be switched back on. */
export function operableCompanies(user: User | null | undefined, companies: Company[]): Company[] {
  if (!user || !user.active) return [];
  return companies.filter(c => c.active
    && (isPlatformAdmin(user) || user.companyIds.includes(c.id)));
}

/** The words the access screen shows. Deliberately without the company's name or any figure:
 *  a revoked context should not read back the tenant it was cut off from. */
export function accessMessage(access: CompanyAccess): { title: string; body: string } {
  switch (access.reason) {
    case 'ACCOUNT_DEACTIVATED':
      return {
        title: 'Account deactivated',
        body: 'Your account has been switched off, so no farm data can be opened or changed. Your records are kept. Contact your administrator to restore access.',
      };
    case 'INACTIVE':
      return {
        title: 'Company inactive',
        body: access.companyId
          ? 'This company has been deactivated. Its records are kept, but no farm data can be opened or changed until it is reactivated.'
          : 'Every company you belong to has been deactivated. Their records are kept, but no farm data can be opened or changed until one is reactivated.',
      };
    case 'MEMBERSHIP_REMOVED':
      return {
        title: 'Company access revoked',
        body: 'You are no longer a member of this company. Sign out, or choose another company you belong to.',
      };
    case 'UNKNOWN_COMPANY':
      return {
        title: 'Company unavailable',
        body: 'This session was left pointing at a company that is no longer available here. Choose a company to continue.',
      };
    default:
      return {
        title: 'Session expired',
        body: 'Your session is no longer valid here. Sign in again to continue.',
      };
  }
}
