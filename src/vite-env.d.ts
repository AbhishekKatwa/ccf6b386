/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL; unset while the app runs on localStorage only. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key only — never the service-role key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
