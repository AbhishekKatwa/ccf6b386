/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL; unset while the app runs on localStorage only. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key only — never the service-role key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** `package.json`'s version, substituted by Vite. Read through `runtime.version`, which falls
 *  back to `'dev'` when the bundle was produced without the plugin config. */
declare const __APP_VERSION__: string | undefined;
