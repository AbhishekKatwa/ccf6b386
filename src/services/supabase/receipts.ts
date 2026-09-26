/**
 * services/supabase/receipts.ts — one question to the database: which number is next?
 *
 * `app.next_receipt_no` claims a value with a single upsert, so two devices numbering the same
 * company on the same day cannot be handed the same receipt — which a scan of this browser's
 * own store cannot promise. The function itself lives in the `app` schema with every other
 * stored routine, so 008 adds the thin `public` door PostgREST can see; the checks inside it
 * (the series whitelist, the company membership test) run exactly as they always did.
 *
 * This module only allocates. When to ask, and what to fall back to when the answer cannot be
 * reached, stays the store's decision — see takeReceiptNo().
 */
import { supabase } from '@/lib/supabase';
import { runtime } from '@/lib/runtime';
import { appNotice, logDatabaseError, normalizeDatabaseError, technicalLineOf } from '@/lib/dbErrors';
import type { ReceiptScope } from '@/lib/receipts';

export type ReceiptAllocation
  /** The database's own number for this company, day and series. */
  = { kind: 'numbered'; ref: string }
  /** No cloud for this session, or the request never arrived: this device must number itself. */
  | { kind: 'local'; note?: string }
  /** The server reached us and refused. A refused number is never replaced with a made-up one. */
  | { kind: 'failed'; error: string; detail?: string };

/** §20 — a clash with the counter is said in receipt words, not in constraint names. */
const NO_NUMBER = appNotice('Could not get a receipt number.', 'Nothing was saved. Please try again.');

/**
 * Claim the next reference in a series. `taken` is the highest number this device already sees
 * for that company and day: the counter folds it in with `greatest`, so a series that predates
 * the counter — or one another device extended while this one was offline — continues past the
 * records on it instead of re-minting them.
 */
export async function allocateReceiptNo(
  companyId: string, scope: ReceiptScope, day: string, taken: number,
): Promise<ReceiptAllocation> {
  if (!runtime.cloud || !supabase) return { kind: 'local' };

  // Two attempts, no more: a second claim on a serialisation fault is a fresh row in the
  // counter, and a third on a persistent fault is a hung form.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc('next_receipt_no', {
      p_company: companyId, p_scope: scope, p_day: day, p_taken: taken,
    });
    if (!error) {
      const ref = typeof data === 'string' && data ? data : null;
      return ref ? { kind: 'numbered', ref }
        : { kind: 'failed', error: NO_NUMBER.userMessage, detail: NO_NUMBER.actionMessage };
    }
    const n = normalizeDatabaseError(error, { table: 'receipt_counters', origin: 'foreground' });
    // A wire that never carried the request says nothing about what the counter holds, so this
    // device numbers itself and says so. A timeout is not that: the claim may have landed
    // server-side, so the answer stays a refusal rather than a possibly clashing local number.
    if (n.kind === 'network' || n.kind === 'aborted') {
      return {
        kind: 'local',
        note: 'No connection to the receipt counter — this number is only unique on this device',
      };
    }
    if (attempt === 1 || !/could not serialize|deadlock|40001|40p01/i.test(n.technicalMessage)) {
      logDatabaseError({ ...n, technicalMessage: technicalLineOf(n) }, error);
      return { kind: 'failed', error: n.userMessage, detail: n.actionMessage };
    }
  }
  return { kind: 'failed', error: NO_NUMBER.userMessage, detail: NO_NUMBER.actionMessage };
}
