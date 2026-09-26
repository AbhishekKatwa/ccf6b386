import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The application's only Supabase client. Everything that eventually talks to
 * Postgres imports it from here — screens never instantiate their own.
 *
 * Publishable key only: the service-role key and the database password must
 * never appear in a VITE_* variable, because VITE_* values ship in the bundle.
 *
 * The app runs on this client only when both variables are set; without them
 * every DataService call falls back to the Zustand store and the
 * `amrut-poultry-v1` localStorage persistence, unchanged.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Built at module load, so a mistake in either variable would otherwise take the whole bundle
 *  down with it. A client that could not be built is the same "no Supabase configured" case the
 *  app already handles: everything falls back to the store's own cache. */
function build(): SupabaseClient | null {
  if (!url || !key) return null;
  try {
    return createClient(url, key);
  } catch (e) {
    console.error('[amrut] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not usable;', e);
    return null;
  }
}

export const supabase: SupabaseClient | null = build();
