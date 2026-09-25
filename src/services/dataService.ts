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
import { validateUserDraft } from '@/lib/auth';
import { emailFor, completeSignIn, startCloudSync } from './supabase/engine';

interface Result { ok: boolean; error?: string }

/** What a screen supplies to create a shed; id, company and timestamps are stamped by the backend. */
export type ShedDraft = Omit<Shed, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>;

export interface ShedService {
  /** Reactive read: the sheds the signed-in user may see. */
  useList(): Shed[];
  /** Create a shed. `null` means the store refused it (no company selected). */
  create(draft: ShedDraft): Shed | null;
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
}

export interface DataService {
  sheds: ShedService;
  auth: AuthService;
  users: UserService;
}

export const dataService: DataService = {
  sheds: {
    useList: () => useVisibleSheds(),
    create: draft => useApp.getState().addShed(draft),
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
          error: /invalid login credentials/i.test(error.message)
            ? 'No Supabase login for this number or the password is wrong'
            : error.message,
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
      // create_login's gate is wider than the tables behind it: a company manager may open the
      // auth row, but profiles INSERT is platform-admin-only under RLS, which would leave a
      // login with no person. /admin already answers the company-manager case, so mirror the
      // policy that actually decides the write instead of half-creating someone.
      const me = useApp.getState().users.find(u => u.id === useApp.getState().session?.userId);
      if (me && me.role !== 'MASTER_ADMIN') return { ok: false, error: 'Only a platform admin can create users' };
      // the auth row first: profiles.id IS auth.users.id, and the browser role can only
      // open that door through the one guarded function the schema exposes for it.
      const id = newUuid();
      const { error } = await supabase.rpc('create_login', {
        p_user: id, p_email: emailFor(mobile), p_password: input.password,
        p_company: input.companyIds[0] ?? '',
      });
      if (error) return { ok: false, error: error.message };
      return useApp.getState().createUser({ ...input, mobile, id });
    },
  },
};

/** Called once at boot from main.tsx; a no-op when the env carries no Supabase. */
export function initDataService(): void {
  if (!supabase) return;
  runtime.cloud = true;
  startCloudSync();
}
