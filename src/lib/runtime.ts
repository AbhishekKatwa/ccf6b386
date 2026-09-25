/**
 * Shared runtime switches the store may read without importing a service (which would
 * import the store back). Set once at boot, read anywhere.
 */
export const runtime = {
  /** True when Supabase is configured AND the app signed in through it for this session. */
  cloud: false,
};
