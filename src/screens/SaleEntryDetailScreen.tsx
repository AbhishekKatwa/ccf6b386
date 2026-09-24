import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, Egg, HandCoins, Link2Off, PenLine, ReceiptText, TrendingDown } from 'lucide-react';
import clsx from 'clsx';
import { latestFirst } from '@/lib/order';
import { useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import {
  Badge, Card, EmptyState, GroupList, ListRow, Row, SectionTitle,
  Stat, StatCell, StatStrip, StatusBadge,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { batchOfShedOn, entryTrays, gradeTotal, loadBilled, ratePerEgg, saleOutstanding, salePaid, saleStatus } from '@/lib/calc';
import { PaymentChips } from '@/components/finance/PaymentFields';
import { EGG_GRADES, EGG_GRADE_LABELS } from '@/types';
import { fmtDate, fmtIN, fmtMoney } from '@/lib/format';

/** One sale entry as the trader ledger sees it: the load, the money on it, and its payments. */
export function SaleEntryDetailScreen() {
  const { entryId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const nav = useNavigate();
  const data = useCompanyData();
  const canFinance = useCan('viewFinance');
  const canEdit = useCan('createSaleEntries');

  const entry = data.saleEntries.find(e => e.id === entryId);
  /** The payment row the ledger was opened from, when it belongs to this entry. */
  const focusId = params.get('payment');

  if (!entry) {
    return (
      <Page>
        <Header title="Sale entry" onBack={() => nav('/sales')} />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState icon={<Egg size={22} />} title="Sale entry not found"
            description="It belongs to another company or was removed. Nothing was booked or changed." />
        </div>
      </Page>
    );
  }

  const trader = data.traders.find(t => t.id === entry.traderId);
  const trays = entryTrays(entry);
  const billed = loadBilled(entry.amount, entry.laborCharge);
  /** The plan this voucher sold, if the planner raised it. The booking stays a plan record. */
  const booking = data.eggSaleBookings.find(b => b.saleEntryId === entry.id);
  /** Everything that arrived for this load: the money on the voucher plus later receipts. */
  const paid = salePaid(entry, data.traderTxns);
  const due = saleOutstanding(entry, data.traderTxns);
  const status = saleStatus(entry, data.traderTxns);
  /** Receipts Finance recorded against this load, after the voucher was saved. */
  const receipts = latestFirst(data.traderTxns.filter(t => t.saleId === entry.id && t.kind === 'PAYMENT_IN'));
  const payments = latestFirst(data.traderTxns
    .filter(t => (t.refId === entry.id || t.saleId === entry.id) && t.kind === 'PAYMENT_IN'));

  /** Straight back to whichever ledger or list opened this sale; a cold link lands on the list. */
  const back = () => {
    if (location.key === 'default') nav('/sales', { replace: true });
    else nav(-1);
  };
  const money = (n: number, decimals = 0) => canFinance ? fmtMoney(n, decimals) : '₹•••••';
  /** A name on record, or an em dash: nobody is inferred from the session. */
  const userName = (id?: string) => (!id ? '—'
    : data.users.find(u => u.id === id)?.name ?? (id === 'system' ? 'System' : id));

  return (
    <Page withNav>
      <Header title={trader?.name ?? 'Sale entry'} subtitle={`${fmtDate(entry.date)} · ${fmtIN(trays)} trays`} onBack={back} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        {canFinance && (
          <Card padded={false} className="overflow-hidden">
            <StatStrip>
              <StatCell><Stat label="Sale value" value={fmtMoney(billed)} tone="success" size="md" /></StatCell>
              <StatCell><Stat label="Received" value={fmtMoney(paid)} tone="brand" size="md" /></StatCell>
              <StatCell>
                <Stat label="Outstanding" size="md" tone={due > 0 ? 'danger' : 'neutral'}
                  value={due < 0 ? `${fmtMoney(Math.abs(due))} with us` : fmtMoney(due)} />
              </StatCell>
            </StatStrip>
            {/* §13 — the money for a load is recorded by Finance, against this sale. */}
            {due > 0 && (
              <div className="px-4 pb-4">
                <Button block variant="outline" icon={<HandCoins size={14} />}
                  onClick={() => nav(`/finance?receive=${encodeURIComponent(entry.id)}`)}>
                  Record payment
                </Button>
                <p className="mt-1.5 text-[11px] text-muted leading-relaxed">
                  Booking this receipt adds money to the load; it never re-bills it, and the sale above stays as it was saved.
                </p>
              </div>
            )}
          </Card>
        )}

        <div>
          <SectionTitle>The load</SectionTitle>
          <Card>
            <Row label="Sale date" value={fmtDate(entry.date)} />
            <Row label="Trader" value={trader?.name ?? '—'} mono={false} />
            <Row label="Total trays" value={fmtIN(trays)} />
            <Row label="Rate per egg" value={money(ratePerEgg(entry.amount, trays) ?? 0, 2)} />
            <Row label="Egg money" value={money(entry.amount)} />
            <Row label="Loading labour" value={money(entry.laborCharge)} />
            <Row label="Total sale amount" value={money(billed)} valueClass="text-[14px]" />
            <div className="flex items-center justify-between gap-4 pt-2.5">
              <span className="text-[13px] text-muted">Payment</span>
              <StatusBadge status={status} />
            </div>
            {/* §14 — the planner promised this load; this voucher is the sale, and the only one. */}
            {booking && (
              <div className="pt-2.5 mt-2.5 border-t border-line-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-muted">Egg Sale Planner</span>
                  <Badge tone="brand">Booking fulfilled</Badge>
                </div>
                <p className="text-[11px] text-muted leading-relaxed mt-1.5">
                  Raised from the plan for {fmtIN(booking.plannedTrays)} {EGG_GRADE_LABELS[booking.grade].toLowerCase()} trays on {fmtDate(booking.date)}.
                  The booking stays a plan — stock and money moved once, here.
                </p>
              </div>
            )}
            {/* The voucher's own accountability: which channel, whose hands, which receipt. */}
            {canFinance && (
              <div className="pt-2.5 mt-2.5 border-t border-line-2">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-2 mb-1.5">
                  How this load was paid
                </p>
                <Row label="Cash received" value={money(entry.cash)} />
                <Row label="Online payment" value={money(entry.phonepe)} />
                {/* A voucher no longer carries an advance; one saved under the old rule still
                    has to account for the money it was settled with. */}
                {entry.advance > 0 && <Row label="Advance adjusted earlier" value={money(entry.advance)} />}
                {receipts.length > 0 && (
                  <Row label="Recorded against it later" value={money(receipts.reduce((s, t) => s + t.amount, 0))} success />
                )}
                {entry.cash > 0 && (
                  <>
                    <Row label="Cash received by" value={userName(entry.cashHandledById)} mono={false} />
                    <Row label="Time" value={entry.cashTime ?? '—'} mono={false} />
                    <Row label="Receipt number" value={entry.cashReference ?? '—'} mono={false} />
                  </>
                )}
                <Row label="Voucher recorded by" value={userName(entry.createdBy)} mono={false} />
                {entry.updatedBy && <Row label="Last corrected by" value={userName(entry.updatedBy)} mono={false} />}
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionTitle>From the sheds</SectionTitle>
          <GroupList>
            {entry.lines.map(line => {
              const shed = data.sheds.find(s => s.id === line.shedId);
              const batch = batchOfShedOn(data.batches, line.shedId, entry.date);
              const lineTrays = gradeTotal(line.byGrade);
              const grades = EGG_GRADES.filter(g => line.byGrade[g] > 0)
                .map(g => `${fmtIN(line.byGrade[g])} ${EGG_GRADE_LABELS[g].toLowerCase()}`)
                .join(' · ');
              return (
                <ListRow key={line.shedId}
                  leading={<span className="w-9 h-9 rounded-[11px] bg-sunk text-ink-2 flex items-center justify-center shrink-0"><Egg size={15} /></span>}
                  title={shed?.name ?? 'Shed removed'}
                  subtitle={`${grades || 'no trays'} · ${fmtIN(lineTrays)} trays${batch ? ` · ${batch.code}` : ''}`}
                />
              );
            })}
          </GroupList>
          {entry.pricing === 'RATE' && EGG_GRADES.some(g => (entry.rates[g] ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {EGG_GRADES.filter(g => (entry.rates[g] ?? 0) > 0).map(g => (
                <Badge key={g} tone="neutral">{EGG_GRADE_LABELS[g]} {money(entry.rates[g] ?? 0, 2)}/egg</Badge>
              ))}
            </div>
          )}
          {entry.pricing === 'AGREED' && (
            <p className="text-[12px] text-muted mt-2">One figure agreed with the owner for the whole load.</p>
          )}
        </div>

        <div>
          <SectionTitle>Payments on this sale</SectionTitle>
          {payments.length === 0 ? (
            <EmptyState icon={<ReceiptText size={22} />} title="No payment booked yet"
              description="The whole load is still with the trader. Payments appear here when they are received against this sale." />
          ) : (
            <GroupList>
              {payments.map(t => {
                const focused = t.id === focusId;
                return (
                  <div key={t.id} className={clsx(focused && 'bg-brand-soft/60 shadow-[inset_3px_0_0_var(--color-brand)]')}>
                    <ListRow
                      leading={<span className="w-9 h-9 rounded-[11px] bg-success-soft text-success flex items-center justify-center shrink-0"><TrendingDown size={15} /></span>}
                      title={fmtDate(t.date)}
                      subtitle={t.remarks ?? (t.saleId ? 'Recorded by Finance against this load' : 'Money handed over with the load')}
                      chips={canFinance && <PaymentChips row={t} compact />}
                      trailing={<span className="font-mono text-[15px] font-semibold text-success tnum shrink-0">{money(t.amount)}</span>}
                    />
                    {focused && (
                      <p className="px-4 pb-3 -mt-1 text-[11px] font-medium text-brand-ink flex items-center gap-1.5">
                        <ReceiptText size={12} /> The payment you opened this sale from.
                      </p>
                    )}
                  </div>
                );
              })}
            </GroupList>
          )}
          {due > 0 && (
            <p className="text-[12px] text-muted mt-2 flex items-center gap-1.5">
              <Link2Off size={12} className="shrink-0" />
              {money(due)} is still with the trader. When it arrives, Finance records a payment in against this load — the billing above stays as saved.
            </p>
          )}
        </div>

        {entry.remarks && (
          <div>
            <SectionTitle>Remarks</SectionTitle>
            <Card><p className="text-[13px] text-ink-2 leading-relaxed">{entry.remarks}</p></Card>
          </div>
        )}

        <p className="font-mono text-[11px] text-faint tnum">
          Recorded {fmtDate(entry.createdAt)}{entry.updatedAt ? ` · last corrected ${fmtDate(entry.updatedAt)}` : ''}
        </p>

        {/* The voucher is edited by the same form that raised it, so no second editor exists. */}
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button variant="outline" icon={<PenLine size={14} />}
              onClick={() => nav(`/sales?edit=${encodeURIComponent(entry.id)}`)}>Edit sale</Button>
          )}
          <button type="button" onClick={() => nav('/sales?tab=entries')}
            className="flex items-center gap-1 text-[13px] font-semibold text-brand press ml-auto">
            All sale entries <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </Page>
  );
}
