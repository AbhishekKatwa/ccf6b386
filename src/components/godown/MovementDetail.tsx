import { AlertTriangle, ChevronRight, HandCoins } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Row, StatusBadge, type Tone } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtDate, fmtIN, fmtMoney } from '@/lib/format';
import { MOVEMENT_LABEL, plainRemarks, type Movement, type MovementKind } from '@/lib/movements';
import type { ShortageShare } from '@/lib/accounting';
import { usePurchaseLookup } from '@/hooks/usePaymentPositions';
import { UNSUPPLIED } from '@/lib/purchasing';
import { PAYMENT_METHOD_LABEL } from '@/types';

/** What the existing accounting rule spread a shortage across, per shed. */
export type ShortageAllocation = { shares: ShortageShare[]; allocated: number; basis: 'feed' | 'none' };

const HEADING: Record<MovementKind, string> = {
  FEED_IN: 'Stock receipt',
  OPENING: 'Opening stock',
  CONSUMPTION: 'Feed consumption',
  FEED_OUT: 'Stock issue',
  ADJUSTMENT: 'Stock adjustment',
  SHORTAGE: 'Stock shortage',
};

const TONE: Record<MovementKind, Tone> = {
  FEED_IN: 'success', OPENING: 'brand', CONSUMPTION: 'accent',
  FEED_OUT: 'warn', ADJUSTMENT: 'neutral', SHORTAGE: 'danger',
};

function kg(n: number): string { return `${fmtIN(n, Number.isInteger(n) ? 0 : 2)} kg`; }

function formulaLabel(m: Movement): string {
  return `${m.formulaName}${m.formulaVersion ? ` V${m.formulaVersion}` : ''}`;
}

/**
 * One movement, fully inspected. Every field comes off the ledger row itself or the
 * valuation basis it was booked at — nothing here is a second calculation. A receipt also
 * shows the money side of itself: what the purchase was worth, what has been paid against
 * it and what is still owed, read from the finance rows linked to it.
 */
export function MovementDetail({ movement, onClose, canFinance, allocate, formulaPath }: {
  movement: Movement | null;
  onClose: () => void;
  canFinance: boolean;
  allocate: (m: Movement) => ShortageAllocation | null;
  /** Route of the formula behind a feeding, when that formula still exists. */
  formulaPath?: string | null;
}) {
  const nav = useNavigate();
  const purchaseOf = usePurchaseLookup();
  if (!movement) return null;
  const m = movement;
  const line = m.lines[0];
  const single = m.lines.length === 1 ? line : null;
  const alloc = canFinance && m.kind === 'SHORTAGE' ? allocate(m) : null;
  const purchase = canFinance && m.kind === 'FEED_IN' && single ? purchaseOf(single.entryId) : null;
  const payable = purchase !== null && (purchase.outstanding ?? 0) > 0;

  return (
    <Dialog open onClose={onClose} title={HEADING[m.kind]}
      subtitle={`${m.title} · ${fmtDate(m.date)}`}
      footer={purchase && payable ? (
        <div className="flex gap-2">
          <Button block variant="outline" onClick={onClose}>Close</Button>
          {/* §15: the shortcut sits here, the payment workflow itself belongs to Finance. */}
          <Button block icon={<HandCoins size={14} />} onClick={() => nav(`/finance?pay=${purchase.entry.id}`)}>Record payment</Button>
        </div>
      ) : <Button block variant="outline" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        {/* the movement, stated once and large */}
        <div className={clsx('rounded-[16px] px-4 py-3.5', panel[TONE[m.kind]])}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-70">
                {MOVEMENT_LABEL[m.kind]}
              </p>
              <p className="mt-1 font-display text-[24px] leading-7 font-semibold tnum truncate">
                {m.incoming ? '+' : '−'}{kg(m.totalKg)}
              </p>
              <p className="mt-1 font-mono text-[11px] opacity-75 tnum">
                {m.lines.length} ingredient{m.lines.length === 1 ? '' : 's'} · {fmtDate(m.date)}
              </p>
            </div>
            {canFinance && (
              <div className="text-right shrink-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-70">
                  {m.incoming ? 'Value in' : 'Value out'}
                </p>
                <p className="mt-1 font-display text-[18px] leading-6 font-semibold tnum">
                  {m.value === null ? 'No rate' : fmtMoney(m.value)}
                </p>
                {m.unpricedKg > 0 && (
                  <p className="mt-1 font-mono text-[10px] opacity-75 tnum">{fmtIN(m.unpricedKg)} kg unpriced</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <SectionLabel>Type</SectionLabel>
          <div className="rounded-[16px] border border-line bg-card px-4 py-1">
            <Row label="Transaction" value={MOVEMENT_LABEL[m.kind]} mono={false} />
            <Row label="Date" value={fmtDate(m.date)} mono={false} />
            {single && <Row label="Ingredient" value={single.ingredient} mono={false} />}
            {m.shedName && <Row label="Shed" value={m.shedName} mono={false} />}
            {m.batchCode && <Row label="Batch" value={m.batchCode} mono={false} />}
            {m.tonnes !== undefined && m.tonnes > 0 && <Row label="Mix given" value={`${fmtIN(m.tonnes, 2)} t`} />}
            {m.formulaName && (
              <Row label="Formula" mono={false} value={formulaPath ? (
                <Link to={formulaPath} className="inline-flex items-center gap-1 text-brand hover:underline">
                  {formulaLabel(m)}
                  <ChevronRight size={13} className="shrink-0" />
                </Link>
              ) : formulaLabel(m)} />
            )}
            {single?.ratePerKg && <Row label="Receipt rate" value={`${fmtMoney(single.ratePerKg, 2)}/kg`} />}
            {single && single.avg !== null && !single.ratePerKg && (
              <Row label={m.incoming ? 'Average entered at' : 'Average it left at'} value={`${fmtMoney(single.avg, 2)}/kg`} />
            )}
            {m.kind === 'SHORTAGE' && single?.place && (
              <>
                <Row label="Booked before" value={kg(single.place.before.kg)} />
                <Row label="Counted at" value={kg(single.place.after.kg)} />
                <Row label="Short by" value={kg(m.totalKg)} danger />
              </>
            )}
            {single?.place && m.kind !== 'SHORTAGE' && (
              <Row label="Stock after" value={kg(single.place.after.kg)} />
            )}
            {m.by && <Row label="Booked by" value={m.by} mono={false} />}
            {plainRemarks(m.remarks) && <Row label="Remarks" value={plainRemarks(m.remarks)!} mono={false} />}
            {m.remarks?.startsWith('reverse ref:') && <Row label="Remarks" value="Reversal of a shed feeding" mono={false} />}
          </div>
        </div>

        {m.lines.length > 0 && (
          <div>
            <SectionLabel>
              {m.kind === 'CONSUMPTION' ? 'Inventory impact' : 'What moved'}
            </SectionLabel>
            <div className="rounded-[16px] border border-line bg-card overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-4 py-2 bg-sunk/70 border-b border-line-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Ingredient</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted text-right w-[86px]">Quantity</span>
                {canFinance && <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted text-right w-[80px]">Value</span>}
              </div>
              <div className="divide-y divide-line-2">
                {m.lines.map(l => (
                  <div key={l.entryId} className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink truncate">{l.ingredient}</span>
                      {canFinance && l.avg !== null && (
                        <span className="block font-mono text-[10.5px] text-faint tnum">{fmtMoney(l.avg, 2)}/kg</span>
                      )}
                    </span>
                    <span className={clsx('w-[86px] text-right font-mono text-[12.5px] font-semibold tnum', m.incoming ? 'text-success' : 'text-danger')}>
                      {m.incoming ? '+' : '−'}{kg(l.qtyKg)}
                    </span>
                    {canFinance && (
                      <span className="w-[80px] text-right font-mono text-[12px] tnum text-ink-2">
                        {l.cost === null ? <span className="text-faint">no rate</span> : fmtMoney(l.cost)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {canFinance && m.value !== null && (
              <p className="mt-2 text-right font-mono text-[11.5px] tnum text-muted">
                Inventory value impact{' '}
                <span className={clsx('font-semibold', m.incoming ? 'text-success' : 'text-danger')}>
                  {m.incoming ? '+' : '−'}{fmtMoney(m.value)}
                </span>
              </p>
            )}
          </div>
        )}

        {/* a receipt states the shelf state it produced — the average the whole farm prices from */}
        {single?.place && (single.ratePerKg || m.kind === 'OPENING' || m.kind === 'FEED_IN') && (
          <div>
            <SectionLabel>Effect on the godown average</SectionLabel>
            <div className="rounded-[16px] border border-line bg-card px-4 py-1">
              <Row label="Stock before" value={kg(single.place.before.kg)} />
              <Row label="Average before" value={single.place.before.avg === null ? 'Not priced yet' : `${fmtMoney(single.place.before.avg, 2)}/kg`} />
              <Row label="Stock after" value={kg(single.place.after.kg)} />
              <Row label="Average after" value={single.place.after.avg === null ? 'Not priced yet' : `${fmtMoney(single.place.after.avg, 2)}/kg`} success />
            </div>
            <p className="mt-2 text-[11.5px] text-muted leading-relaxed">
              The receipt&rsquo;s own rate is what re-weighted this average. Nothing on the godown holds a price of its own.
            </p>
          </div>
        )}

        {purchase && (
          <div>
            <SectionLabel>Purchase &amp; payments</SectionLabel>
            <div className="rounded-[16px] border border-line bg-card px-4 py-1">
              <Row label="Purchase no." value={purchase.entry.purchaseRef ?? 'Not numbered'} mono={false} />
              <Row label="Supplier" value={purchase.supplier ?? UNSUPPLIED} mono={false} />
              <Row label="Quantity taken in" value={kg(purchase.qtyKg)} />
              <Row label="Purchase value" value={purchase.value === null ? 'No receipt rate' : fmtMoney(purchase.value)} success />
              <Row label="Amount paid" value={fmtMoney(purchase.paid)} />
              <Row label="Outstanding" value={purchase.outstanding === null ? '—' : fmtMoney(Math.max(0, purchase.outstanding))}
                danger={payable} />
            </div>

            <div className="mt-2 flex items-center gap-2 px-1">
              {purchase.status && <StatusBadge status={purchase.status} />}
              <p className="text-[11.5px] text-muted leading-relaxed min-w-0">
                {purchase.value === null
                  ? 'This receipt carries no rate, so there is no amount to pay against it yet.'
                  : payable
                    ? `${fmtMoney(Math.max(0, purchase.outstanding ?? 0))} is still owed. Booking stock never moves money — a payment is recorded separately by Finance.`
                    : 'Every rupee of this receipt has been paid. The purchase itself was never restated to say so.'}
              </p>
            </div>

            <div className="mt-3">
              <p className="mb-1.5 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-2">Payment history</p>
              {purchase.payments.length === 0 ? (
                <p className="rounded-[16px] border border-dashed border-line bg-card px-4 py-3 text-[12px] text-muted leading-relaxed">
                  No payment has been recorded against this purchase. Nothing has left the cash or bank account for it.
                </p>
              ) : (
                <div className="rounded-[16px] border border-line bg-card overflow-hidden divide-y divide-line-2">
                  {purchase.payments.map(p => (
                    <div key={p.id} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-[13px] text-ink truncate">
                          {p.paymentMethod ? PAYMENT_METHOD_LABEL[p.paymentMethod] : 'Method not recorded'}
                        </p>
                        <p className="font-mono text-[12.5px] font-semibold text-danger tnum shrink-0">−{fmtMoney(p.amount)}</p>
                      </div>
                      <p className="mt-0.5 font-mono text-[10.5px] text-muted tnum truncate">
                        {fmtDate(p.date)}{p.reference ? ` · ${p.reference}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {m.kind === 'CONSUMPTION' && (
          <div className="rounded-[16px] bg-sunk px-4 py-3">
            <p className="text-[11.5px] text-muted leading-relaxed">
              Each line is priced at the average in force the moment it left the shelf, so this is the cost the shed
              carries in its P&amp;L — and the same number Finance shows.
            </p>
            {m.tonnes === undefined && !plainRemarks(m.remarks) && (
              <p className="mt-1.5 font-mono text-[10.5px] text-warn">No feeding record behind these rows.</p>
            )}
          </div>
        )}

        {alloc && (
          alloc.basis === 'feed' ? (
            <div>
              <SectionLabel>Shared farm expense</SectionLabel>
              <div className="rounded-[16px] border border-line bg-card overflow-hidden">
                {alloc.shares.map(s => (
                  <div key={s.shedId} className="flex items-center gap-2 px-4 py-2.5 border-b border-line-2 last:border-0">
                    <ChevronRight size={13} className="text-faint shrink-0" />
                    <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{s.shedName}</span>
                    <span className="font-mono text-[12.5px] font-semibold text-ink tnum shrink-0">{fmtMoney(s.amount)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-muted leading-relaxed">
                {fmtMoney(alloc.allocated)} spread over {alloc.shares.length} {alloc.shares.length === 1 ? 'shed' : 'sheds'} in
                proportion to the feed each one ate in {monthOf(m.date)} — the same rule Finance books it under.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-[16px] bg-warn-soft px-4 py-3">
              <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-warn leading-relaxed">
                Nothing can be spread honestly for this shortage — no shed feed cost sits in its period, so it stays a
                farm-level cost.
              </p>
            </div>
          )
        )}

        {!canFinance && (
          <p className="text-[11.5px] text-muted leading-relaxed px-1">
            This role sees quantities only — rates and values stay with the accounts team.
          </p>
        )}
      </div>
    </Dialog>
  );
}

const panel: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  accent: 'bg-accent-soft text-accent-ink',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-sunk text-ink',
};

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</p>;
}

function monthOf(iso: string): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const m = Number(iso.slice(5, 7));
  return `${names[Math.max(0, Math.min(11, m - 1))]} ${iso.slice(0, 4)}`;
}
