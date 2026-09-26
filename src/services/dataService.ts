/**
 * dataService.ts — the seam between the store and wherever data actually lives.
 *
 * Screens read and write through the store exactly as they always did; the store stays the
 * browser's one copy of the world. What this file decides is who answers: when Supabase is
 * configured, sign-in goes through Supabase Auth and the store's contents are pulled from
 * (and pushed back to) Postgres under RLS; when it is not, every call lands on the store's
 * own simulated paths and `amrut-poultry-v1` remains the only database, unchanged.
 */
import { useApp, useVisibleSheds } from '@/store/app';
import type { Role, Shed, User } from '@/types';
import { supabase } from '@/lib/supabase';
import { runtime } from '@/lib/runtime';
import { newUuid } from '@/lib/format';
import { describeDatabaseError } from '@/lib/dbErrors';
import { validateUserDraft } from '@/lib/auth';
import { effectiveCan } from '@/lib/permissions';
import { isPlatformAdmin } from '@/lib/companyAccess';
import { emailFor, completeSignIn, startCloudSync, confirmLogin } from './supabase/engine';

interface Result { ok: boolean; error?: string }

/** What a screen supplies to create a shed; id, company and timestamps are stamped by the backend. */
export type ShedDraft = Omit<Shed, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>;

export interface ShedService {
  /** Reactive read: the sheds the signed-in user may see. */
  useList(): Shed[];
  /** Create a shed. `null` means the store refused it (no company selected). */
  create(draft: ShedDraft): Shed | null;
  /** Rename, re-dimension or re-place a shed. */
  update(id: string, patch: Partial<Shed>): void;
  /** Remove a shed. Refused while a batch is placed on it, exactly as the database would. */
  remove(id: string): Result;
}

export interface AuthService {
  /** True once Supabase is configured — sign-in then means Supabase Auth, not the demo store. */
  isCloud(): boolean;
  signInWithPassword(mobile: string, password: string): Promise<Result>;
  requestOtp(mobile: string): Promise<Result & { code?: string }>;
  signInWithOtp(mobile: string, code: string): Promise<Result>;
  /** Re-reads the database into the store after a sign-in made elsewhere (a link, a refresh). */
  restore(): Promise<void>;
  start(): void;
}

export interface UserService {
  create(input: {
    name: string; mobile: string; password: string; role: Role; companyIds: string[];
  }): Promise<Result & { user?: User }>;
  /** One person's role inside the standing company. */
  updateRole(id: string, role: Role): Promise<Result>;
  /** Switch an account off, or back on. Their records, membership and audit trail stay. */
  setActive(id: string, active: boolean): Promise<Result>;
}

export interface DataService {
  sheds: ShedService;
  auth: AuthService;
  users: UserService;
}

/**
 * Where a change to an existing person is written.
 *
 * The store is the browser's copy either way, and it is what audits. What differs is who else
 * has to hear: a platform admin's own browser pushes `profiles` and the memberships (push.ts ·
 * pushUsers runs for that session alone), so the store write is the whole edit. A company
 * session sends no people at all, so its edit must go in through `set_person_access` (015) —
 * and only once the database has accepted it may the store remember it, because a change RLS
 * refused would otherwise sit in localStorage as a fact and sync back the moment somebody with
 * the right to make it signs in on this device.
 *
 * `gate` is the store's own refusal of this person for this session, which also names the
 * company being acted for: the client never sends a companyId it invented.
 */
async function changePerson(
  id: string,
  patch: { role?: Role; active?: boolean },
  apply: () => Result,
): Promise<Result> {
  const st = useApp.getState();
  const gate = st.personOf(id);
  if ('error' in gate) return { ok: false, error: gate.error };
  const me = st.users.find(u => u.id === st.session?.userId);
  if (runtime.cloud && supabase && !isPlatformAdmin(me)) {
    const { error } = await supabase.rpc('set_person_access', {
      p_user: id,
      p_company: gate.companyId,
      p_role: patch.role ?? null,
      p_active: patch.active ?? null,
    });
    if (error) return { ok: false, error: describeDatabaseError(error, { operation: 'change this person’s access', table: 'company_users', origin: 'foreground' }) };
  }
  return apply();
}

export const dataService: DataService = {
  sheds: {
    useList: () => useVisibleSheds(),
    create: draft => useApp.getState().addShed(draft),
    update: (id, patch) => useApp.getState().updateShed(id, patch),
    remove: id => useApp.getState().deleteShed(id),
  },

  auth: {
    isCloud: () => !!supabase,

    async signInWithPassword(mobile, password) {
      if (!supabase) return useApp.getState().signInWithPassword(mobile, password);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailFor(mobile.replace(/\D/g, '').slice(-10)),
        password,
      });
      if (error) {
        return {
          ok: false,
          // the one credential refusal the app already had words for; everything else on the
          // normalizer's tongue, so a locked-out account never sees a PostgREST sentence.
          error: /invalid login credentials/i.test(error.message)
            ? 'No Supabase login for this number or the password is wrong'
            : describeDatabaseError(error, { operation: 'sign in', origin: 'foreground' }),
        };
      }
      await completeSignIn(data.user.id);
      return { ok: true };
    },

    async requestOtp(mobile) {
      if (!supabase) return useApp.getState().requestOtp(mobile);
      return { ok: false, error: 'One-time codes need an SMS provider on the Supabase project. Sign in with your password.' };
    },

    async signInWithOtp(mobile, code) {
      if (!supabase) return useApp.getState().signInWithOtp(mobile, code);
      return { ok: false, error: 'One-time codes need an SMS provider on the Supabase project. Sign in with your password.' };
    },

    async restore() {
      if (!supabase) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) await completeSignIn(session.user.id);
    },

    start: () => startCloudSync(),
  },

  users: {
    async create(input) {
      if (!runtime.cloud || !supabase) return useApp.getState().createUser(input);
      // Gate before the write: create_login writes auth.users first, so a draft the store would
      // reject has to be refused here too or the login outlives a person that never existed.
      const { mobile, error: draftError } = validateUserDraft(
        input, m => useApp.getState().users.some(u => u.mobile === m),
      );
      if (draftError) return { ok: false, error: draftError };
      // create_login (007+010) is the one door: SECURITY DEFINER, so it writes auth.users,
      // profiles and the membership in a single guarded transaction — an owner's browser never
      // pushes people (push.ts · opsDenied), and a refused draft leaves no half a person behind.
      // The client mirrors that gate so an obvious refusal says so before the wire: platform
      // admin anywhere, otherwise manageUsers for the company being entered.
      const st = useApp.getState();
      const me = st.users.find(u => u.id === st.session?.userId);
      const canPlace = (companyId: string) => !!me && (
        me.role === 'MASTER_ADMIN'
        || (me.companyIds.includes(companyId) && effectiveCan(me.role, undefined, 'manageUsers'))
      );
      if (me) {
        if (input.role === 'MASTER_ADMIN' && me.role !== 'MASTER_ADMIN') {
          return { ok: false, error: 'Only a platform admin can create a platform admin' };
        }
        if (input.role !== 'MASTER_ADMIN' && !input.companyIds.every(canPlace)) {
          return { ok: false, error: 'You can only create users in a company you manage' };
        }
      }
      // the auth row first: profiles.id IS auth.users.id, and the browser role can only
      // open that door through the one guarded function the schema exposes for it.
      const id = newUuid();
      const { error } = await supabase.rpc('create_login', {
        p_user: id, p_email: emailFor(mobile), p_password: input.password,
        p_company: input.companyIds[0] ?? '',
        p_name: input.name.trim(), p_mobile: mobile, p_role: input.role,
      });
      if (error) return { ok: false, error: describeDatabaseError(error, { operation: 'create user', table: 'profiles', origin: 'foreground' }) };
      // The row is the database's own now: tell the engine before the store speaks, so a batch
      // access granted in the next second is a sendable row rather than one held for a login
      // the pull has not had the chance to notice yet.
      confirmLogin(id);
      return useApp.getState().createUser({ ...input, mobile, id });
    },

    updateRole: (id, role) => changePerson(id, { role }, () => useApp.getState().updateUserRole(id, role)),

    setActive: (id, active) => changePerson(id, { active }, () => useApp.getState().setUserActive(id, active)),
  },
};

/** Called once at boot from main.tsx; a no-op when the env carries no Supabase.
 *  A wire that cannot be opened is a degraded app, not an empty one: on failure the store keeps
 *  running on its own localStorage cache and the sync badge stays in local mode. */
export function initDataService(): void {
  if (!supabase) return;
  runtime.cloud = true;
  try {
    startCloudSync();
  } catch (e) {
    runtime.cloud = false;
    console.error('[amrut] cloud sync could not start; continuing on local storage', e);
  }
}
