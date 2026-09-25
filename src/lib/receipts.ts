/**
 * receipts.ts — the arithmetic behind the three receipt series this farm numbers.
 *
 * Every reference reads `SCOPE-YYYY-MM-DD-NNN` and is numbered inside one company for one day:
 * `CR` for money received (shared by the finance ledger, the trader ledger, sale vouchers and
 * cash handovers exactly so one collection cannot be given two numbers), `PUR` for feed bought
 * into the godown, `MED` for medicine received. The strings are load-bearing — migrateSaved()
 * reads `PUR-{date}-` back off a stored value — so this is the same format the database
 * counter issues through `app.next_receipt_no`, written down once rather than four times.
 */
export type ReceiptScope = 'CR' | 'PUR' | 'MED';

/** The reference for a series and position: `PUR-2026-09-25-007`. */
export function receiptNo(scope: ReceiptScope, date: string, seq: number): string {
  return `${scope}-${date}-${String(seq).padStart(3, '0')}`;
}

/** The highest number already standing in this company-and-day series, or 0 when none does. */
export function receiptHighWater(refs: Iterable<string | undefined>, scope: ReceiptScope, date: string): number {
  const prefix = `${scope}-${date}-`;
  let high = 0;
  for (const ref of refs) {
    if (!ref?.startsWith(prefix)) continue;
    const n = Number.parseInt(ref.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > high) high = n;
  }
  return high;
}
