import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, ChevronRight, CircleSlash, Handshake, Plus, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { ScreenTitle, Page } from '@/components/ui/Header';
import { Avatar, Badge, Card, EmptyState, GroupList, SectionTitle } from '@/components/ui/Card';
import { Button, ChipGroup, Field, SearchField, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { GraphCard } from '@/components/charts/GraphCard';
import { axisNum, ChartLegend, TrendChart, type VSeries } from '@/components/charts/DataViz';
import { CHART } from '@/components/ui/Charts';
import { PageReveal, StaggerContainer, StaggerItem, ScrollReveal, ChartReveal } from '@/components/motion';
import { EMPTY_PAYMENT, PaymentFields, paymentPatch, type PaymentDraft } from '@/components/finance/PaymentFields';
import { fmtDateShort, fmtIN, fmtMoney, todayISO } from '@/lib/format';
import { TRADER_TXN_LABEL, txnSignedAmount } from '@/lib/calc';
import { dayKeys, div, fin, rangeOf, traderCollections, traderOutstanding, type Point, type Range, type RangeKey } from '@/lib/analytics';
import { latestFirst } from '@/lib/order';
import type { SaleEntry, TraderTxn } from '@/types';

const RANGES = [
  { value: '7D', label: '7 days' },
  { value: '30D', label: '30 days' },
  { value: '90D', label: '90 days' },
  { value: 'CUSTOM', label: 'Custom' },
] as const;

type Status = 'ALL' | 'DUE' | 'SETTLED';

/** A line needs two recorded slots to be a trend; one point would be a guess. */
const plottable = (points: Point[]) => points.filter(p => p.value !== null).length >= 2;

const money = (v: number) => `₹${axisNum(v)}`;

/** Collected against billed on one hairline — forest green on warm gold. */
function Meter({ share, className }: { share: number | null; className?: string }) {
  const pct = share === null ? 0 : Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className={clsx('h-1.5 w-full rounded-full bg-accent-soft overflow-hidden', className)}
      role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={share === null ? undefined : Math.round(pct)}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One compact supporting figure beside the hero's outstanding amount. */
function Metric({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'success' | 'danger' }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2 truncate">{label}</p>
      <p className={clsx(
        'font-display text-[19px] font-semibold tnum tracking-tight mt-0.5 truncate',
        tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink',
      )}>{value}</p>
    </div>
  );
}

export function TradersScreen() {
  const nav = useNavigate();
  const data = useCompanyData();
  const traders = data.traders;
  const txns = data.traderTxns;
  const addTrader = useApp(s => s.addTrader);
  const addTxn = useApp(s => s.addTraderTxn);
  const pushToast = useApp(s => s.pushToast);
  const cashPeople = useApp(s => s.cashPeople);
  const nextCashReceiptNo = useApp(s => s.nextCashReceiptNo);
  const canManage = useCan('manageTraders');
  const canFinance = useCan('viewFinance');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [status, setStatus] = useState<Status>('ALL');
  const [traderId, setTraderId] = useState('ALL');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [rangeKey, setRangeKey] = useState<RangeKey>('30D');
  const [form, setForm] = useState({ name: '', mobile: '', gstin: '', address: '', openingBalance: '' });
  const [payForm, setPayForm] = useState({ traderId: '', date: todayISO(), amount: '', remarks: '' });
  const [pay, setPay] = useState<PaymentDraft>(EMPTY_PAYMENT);

  const today = todayISO();
  const people = useMemo(() => cashPeople(), [cashPeople, data.users]);

  /** The picker's own window; every preset still comes from `rangeOf`. */
  const range = useMemo<Range>(() => {
    if (rangeKey !== 'CUSTOM' || !custom.from || !custom.to) return rangeOf(rangeKey === 'CUSTOM' ? '30D' : rangeKey, today);
    const [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    return { key: 'CUSTOM', from, to, days: dayKeys(from, to).length };
  }, [rangeKey, custom, today]);
  const rangeLabel = rangeKey === 'CUSTOM' ? 'Selected period' : `Last ${range.days} days`;

  /**
   * Every trader with the money it owes, all of it derived: the balance comes from
   * `traderOutstanding` (opening + billed − received off the signed ledger) and the
   * sales and payments split comes from the same rows.
   */
  const rows = useMemo(() => {
    const own = new Map<string, { sales: number; paid: number; trays: number; lastSale: string; lastAny: string }>();
    for (const t of txns) {
      const v = fin(t.amount);
      if (v === null || t.kind === 'OPENING') continue;
      const acc = own.get(t.traderId) ?? { sales: 0, paid: 0, trays: 0, lastSale: '', lastAny: '' };
      if (t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT') acc.sales += v;
      if (t.kind === 'PAYMENT_IN') acc.paid += v;
      if (t.kind === 'EGG_SALE') acc.trays += t.trays ?? 0;
      if ((t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT') && t.date > acc.lastSale) acc.lastSale = t.date;
      if (t.date > acc.lastAny) acc.lastAny = t.date;
      own.set(t.traderId, acc);
    }
    return traderOutstanding(traders, txns).map(r => {
      const t = traders.find(x => x.id === r.traderId)!;
      const o = own.get(r.traderId) ?? { sales: 0, paid: 0, trays: 0, lastSale: '', lastAny: '' };
      return { ...r, ...o, mobile: t.mobile, gstin: t.gstin, share: div(o.paid, o.sales) };
    });
  }, [traders, txns]);

  const collections = useMemo(() => traderCollections(traders, txns, range, 'AUTO'), [traders, txns, range]);

  const m = (v: number | null) => !canFinance ? '₹ •••••' : v === null ? 'Unavailable' : fmtMoney(v);
  const chartMoney = (v: number) => canFinance ? money(v) : '••';

  const owedRows = rows.filter(r => r.balance > 0);
  const settledRows = rows.filter(r => r.balance <= 0);
  const collectedShare = div(collections.totalReceived, collections.totalBilled);
  const stillDue = collections.totalBilled === null ? null
    : Math.max(0, collections.totalBilled - (collections.totalReceived ?? 0));

  const series: VSeries[] = [
    { id: 'billed', label: 'Billed', color: CHART.accent, points: collections.billed, area: true },
    { id: 'paid', label: 'Collected', color: CHART.success, points: collections.received, dashed: true },
  ];
  const hasActivity = collections.billed.some(p => p.value !== null) || collections.received.some(p => p.value !== null);

  /** The list this page is really about: who owes money, largest first. */
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(r => {
      if (traderId !== 'ALL' && r.traderId !== traderId) return false;
      if (status === 'DUE' && r.balance <= 0) return false;
      if (status === 'SETTLED' && r.balance > 0) return false;
      if (!s) return true;
      return r.name.toLowerCase().includes(s) || r.mobile.includes(s) || (r.gstin ?? '').toLowerCase().includes(s);
    });
  }, [rows, q, status, traderId]);
  const visibleDue = visible.filter(r => r.balance > 0);
  const visibleSettled = visible.filter(r => r.balance <= 0);

  const activeFilters = [
    status !== 'ALL', traderId !== 'ALL', q.trim() !== '',
  ].filter(Boolean).length;

  const activityPool = traderId === 'ALL' ? txns : txns.filter(t => t.traderId === traderId);
  const recent = useMemo(() => latestFirst(activityPool).filter(t => t.kind !== 'OPENING').slice(0, 6), [activityPool]);
  const nameOf = (id: string) => traders.find(t => t.id === id)?.name ?? 'Trader';
  /** A movement points at the sale that raised it; a typed-in payment has no source to open. */
  const saleOf = (t: TraderTxn): SaleEntry | undefined => (t.refId ? data.saleEntries.find(e => e.id === t.refId) : undefined);

  function pickRange(key: RangeKey) {
    if (key === 'CUSTOM') return setFilters(true);
    setRangeKey(key);
  }

  function submit() {
    const digits = form.mobile.replace(/\D/g, '');
    if (!form.name.trim()) return pushToast('error', 'Name required');
    if (digits.length !== 10) return pushToast('error', 'Valid 10-digit mobile required');
    const opening = parseFloat(form.openingBalance) || 0;
    const t = addTrader({
      name: form.name.trim(), mobile: digits, gstin: form.gstin || undefined,
      address: form.address || undefined, openingBalance: opening, outstandingAmount: opening, active: true,
    });
    if (!t) return pushToast('error', 'Only Owner / Financial Supervisor can add traders');
    pushToast('success', 'Trader added');
    setOpen(false);
    setForm({ name: '', mobile: '', gstin: '', address: '', openingBalance: '' });
  }

  /** The same ledger write the trader's own screen makes — never a second payment flow. */
  function savePayment() {
    const target = payForm.traderId || owedRows[0]?.traderId;
    const amount = parseFloat(payForm.amount) || 0;
    if (!target) return pushToast('error', 'Add a trader to record a payment against');
    if (amount <= 0) return pushToast('error', 'Enter amount');
    const r = addTxn({
      traderId: target, date: payForm.date, kind: 'PAYMENT_IN', amount,
      remarks: payForm.remarks || undefined, ...paymentPatch(pay),
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Payment recorded');
    setPayOpen(false);
    setPay(EMPTY_PAYMENT);
    setPayForm({ traderId: '', date: todayISO(), amount: '', remarks: '' });
  }

  /** Clears the trader filters and the picked period, back to the rolling 30 days. */
  function clearFilters() {
    setQ(''); setStatus('ALL'); setTraderId('ALL'); setCustom({ from: '', to: '' }); setRangeKey('30D');
  }

  return (
    <Page withNav>
      <PageReveal>
      <ScreenTitle eyebrow="Trade & Finance" title="Trader Collections"
        subtitle="Money billed, collected and still due from traders."
        action={canManage ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon={<Banknote size={14} />} onClick={() => setPayOpen(true)}>Record payment</Button>
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add trader</Button>
          </div>
        ) : undefined} />

      <div className="px-4 sm:px-0 space-y-4">
        <ScrollReveal>
        <Card>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-10">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Outstanding</p>
              <p className="font-display text-[42px] sm:text-[52px] leading-[1.04] font-semibold text-ink tnum tracking-tight mt-2">
                {m(collections.outstanding)}
              </p>
              <p className="text-[12.5px] text-muted mt-2">
                {owedRows.length === 0 ? 'Every trader account is settled'
                  : `To collect from ${owedRows.length} of ${rows.length} traders`}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-x-6 sm:gap-x-9 sm:pl-6 sm:border-l sm:border-line-2">
              <Metric label={`Billed · ${range.days}d`} value={m(collections.totalBilled)} />
              <Metric label={`Collected · ${range.days}d`} value={m(collections.totalReceived)} tone="success" />
              <Metric label="Collection rate" value={collectedShare === null ? 'Unavailable' : `${Math.round(collectedShare * 100)}%`} />
            </div>
          </div>

          {canFinance && (
            <div className="mt-5 pt-4 border-t border-line-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Collection progress · {rangeLabel.toLowerCase()}
                </p>
                <p className="font-mono text-[11.5px] font-semibold text-ink tnum">
                  {collectedShare === null ? '—' : `${Math.round(Math.min(1, collectedShare) * 100)}%`}
                </p>
              </div>
              <Meter share={collectedShare} className="mt-2.5" />
              <div className="mt-2.5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-[12px] text-muted">
                  Collected <span className="font-mono font-semibold text-success tnum">{m(collections.totalReceived ?? 0)}</span>
                </p>
                <p className="text-[12px] text-muted">
                  Still due from this period <span className="font-mono font-semibold text-ink tnum">{m(stillDue)}</span>
                </p>
              </div>
            </div>
          )}
          <p className="mt-3.5 text-[11.5px] text-muted leading-snug">
            Outstanding covers every trader account to date; billed and collected cover the {rangeLabel.toLowerCase()}.
          </p>
        </Card>
        </ScrollReveal>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex gap-0.5 bg-sunk rounded-full p-0.5 shrink-0" role="group" aria-label="Period">
            {RANGES.map(o => (
              <button key={o.value} type="button" aria-pressed={rangeKey === o.value} onClick={() => pickRange(o.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-full font-mono text-[10px] font-semibold uppercase tracking-[0.08em] press transition-colors',
                  rangeKey === o.value ? 'bg-brand text-white shadow-card' : 'text-muted hover:text-ink',
                )}>{o.label}</button>
            ))}
          </div>
          <Button size="sm" variant="outline" icon={<SlidersHorizontal size={13} />} onClick={() => setFilters(true)}>
            Filters{activeFilters ? ` · ${activeFilters}` : ''}
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Handshake size={22} />} title="No traders yet"
            description="Add a trader to start billing egg sales and tracking what they owe."
            action={canManage ? <Button onClick={() => setOpen(true)} icon={<Plus size={14} />}>Add trader</Button> : undefined} />
        ) : visible.length === 0 ? (
          <EmptyState icon={<CircleSlash size={22} />} title="No trader matches these filters"
            description="Adjust the payment status, the search or the selected trader, or clear them all."
            action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>} />
        ) : (
          <section>
            <SectionTitle right={<p className="font-mono text-[11px] text-muted tnum">{visibleDue.length}</p>}>
              Outstanding by trader
            </SectionTitle>
            <p className="text-[12px] text-muted leading-snug mb-2 px-0.5 -mt-1">Traders with money still to collect, highest first.</p>
            {visibleDue.length === 0 ? (
              <Card><p className="text-[13px] text-muted">Nothing is outstanding on this list — every trader shown here is settled.</p></Card>
            ) : (
              <StaggerContainer>
                {visibleDue.map(r => (
                  <StaggerItem key={r.traderId} as="button">
                  <button onClick={() => nav(`/traders/${r.traderId}`)}
                    className="w-full px-4 py-3 text-left press hover:bg-sunk/60">
                    <div className="flex items-start gap-3">
                      <Avatar name={r.name} size={34} tone="accent" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[14.5px] font-semibold text-ink truncate">{r.name}</p>
                          <p className="font-mono text-[15px] font-semibold text-danger tnum shrink-0">{m(r.balance)}</p>
                        </div>
                        <p className="font-mono text-[11.5px] text-muted mt-0.5 truncate">
                          {r.sales > 0 ? `${fmtIN(r.trays)} trays billed · ${m(r.sales)}` : `${r.txns} ledger ${r.txns === 1 ? 'row' : 'rows'}`}
                          {r.lastSale && ` · last billed ${fmtDateShort(r.lastSale)}`}
                        </p>
                        {r.share !== null && (
                          <div className="mt-2 flex items-center gap-2.5">
                            <Meter share={r.share} className="max-w-[220px]" />
                            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted tnum shrink-0">
                              {Math.round(Math.min(1, r.share) * 100)}% collected
                            </p>
                          </div>
                        )}
                        {!r.active && <Badge tone="neutral" className="mt-2">Inactive</Badge>}
                      </div>
                      <ChevronRight size={16} className="text-muted-2 shrink-0 mt-1" />
                    </div>
                  </button>
                  </StaggerItem>
                ))}
              </StaggerContainer>
            )}

            {visibleSettled.length > 0 && (
              <>
                <SectionTitle right={<p className="font-mono text-[11px] text-muted tnum">{visibleSettled.length}</p>}>
                  Settled
                </SectionTitle>
                <StaggerContainer>
                  {visibleSettled.map(r => (
                    <StaggerItem key={r.traderId} as="button">
                    <button onClick={() => nav(`/traders/${r.traderId}`)}
                      className="w-full px-4 py-2.5 text-left press hover:bg-sunk/60">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} size={30} tone="brand" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-ink truncate">{r.name}</p>
                          <p className="font-mono text-[11.5px] text-muted mt-0.5 truncate">
                            {r.sales > 0 ? `${m(r.sales)} billed` : 'Nothing billed'}
                            {r.lastSale && ` · ${fmtDateShort(r.lastSale)}`}
                          </p>
                        </div>
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-success shrink-0">Paid</p>
                        <ChevronRight size={16} className="text-muted-2 shrink-0" />
                      </div>
                    </button>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </>
            )}
          </section>
        )}

        <ChartReveal>
        <GraphCard
          title="Billed vs collected" height={252}
          subtitle={`Daily sales billed and payments received · ${fmtDateShort(range.from)} – ${fmtDateShort(range.to)}${collections.groupUsed === 'MONTH' ? ', grouped by calendar month' : ''}`}
          warnings={collections.warnings}
          detail={`${rangeKey} · ${collections.groupUsed} · ${rows.length} traders`}
          empty={hasActivity ? undefined : {
            title: 'No billing or payment activity in this period.',
            description: 'Sales billed and payments received are drawn here as they are recorded.',
          }}
        >
          {(() => {
            const plotted = series.filter(s => plottable(s.points));
            return (
              <>
                <TrendChart series={plotted.length ? plotted : series} height={246} format={chartMoney} />
                <ChartLegend items={series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
              </>
            );
          })()}
        </GraphCard>
        </ChartReveal>

        {recent.length > 0 && (
          <section>
            <SectionTitle>Recent activity</SectionTitle>
            <GroupList>
              {recent.map(t => {
                const signed = txnSignedAmount(t);
                const sale = saleOf(t);
                const to = sale ? (t.kind === 'PAYMENT_IN' ? `/sales/entry/${sale.id}?payment=${t.id}` : `/sales/entry/${sale.id}`) : `/traders/${t.traderId}`;
                return (
                  <button key={t.id} onClick={() => nav(to)} className="w-full px-4 py-2.5 text-left press hover:bg-sunk/60">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-ink truncate">{nameOf(t.traderId)}</p>
                        <p className="font-mono text-[11px] text-muted mt-0.5 truncate">
                          {fmtDateShort(t.date)} · {TRADER_TXN_LABEL[t.kind]}
                        </p>
                      </div>
                      <p className={clsx(
                        'font-mono text-[13px] font-semibold tnum shrink-0',
                        !canFinance ? 'text-muted' : signed > 0 ? 'text-danger' : signed < 0 ? 'text-success' : 'text-muted',
                      )}>
                        {!canFinance ? '₹ •••••' : signed === 0 ? '—' : `${signed > 0 ? '+' : '−'}${fmtMoney(Math.abs(signed))}`}
                      </p>
                      <ChevronRight size={15} className="text-muted-2 shrink-0" />
                    </div>
                  </button>
                );
              })}
            </GroupList>
          </section>
        )}
      </div>

      <Dialog open={filters} onClose={() => setFilters(false)} title="Filter collections"
        subtitle="Narrow the trader list and the period it is measured over."
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={clearFilters}>Clear all</Button>
          <Button block onClick={() => setFilters(false)}>Show {fmtIN(visible.length)} {visible.length === 1 ? 'trader' : 'traders'}</Button>
        </div>}>
        <div className="space-y-3">
          <SearchField placeholder="Search name, mobile or GSTIN" value={q} onChange={setQ} />
          <div>
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Payment status</p>
            <ChipGroup value={status} onChange={setStatus} options={[
              { value: 'ALL', label: 'All traders' },
              { value: 'DUE', label: 'To collect' },
              { value: 'SETTLED', label: 'Settled' },
            ]} />
          </div>
          <SelectField label="Trader" value={traderId} onChange={e => setTraderId(e.target.value)}
            options={[{ value: 'ALL', label: 'All traders' }, ...rows.map(r => ({ value: r.traderId, label: r.name }))]} />
          <div>
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Custom period</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From" type="date" value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
              <Field label="To" type="date" value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
            </div>
            <Button size="sm" variant="outline" className="mt-2"
              disabled={!custom.from || !custom.to}
              onClick={() => { setRangeKey('CUSTOM'); pushToast('success', 'Custom period applied'); }}>
              Apply custom period
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={payOpen} onClose={() => { setPayOpen(false); setPay(EMPTY_PAYMENT); }}
        title="Record payment" subtitle="Money received from a trader, straight onto their account"
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => { setPayOpen(false); setPay(EMPTY_PAYMENT); }}>Cancel</Button>
          <Button block onClick={savePayment}>Save</Button>
        </div>}>
        <div className="space-y-3">
          <SelectField label="Trader" value={payForm.traderId || owedRows[0]?.traderId || ''}
            onChange={e => setPayForm(f => ({ ...f, traderId: e.target.value }))}
            options={owedRows.map(r => ({ value: r.traderId, label: `${r.name} · ${m(r.balance)} due` }))} />
          <Field label="Date" type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
          <Field label="Amount received (₹)" type="number" inputMode="decimal" value={payForm.amount}
            onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} className="font-mono"
            hint="Reduces the outstanding balance by this amount" />
          <PaymentFields draft={pay} onChange={p => setPay(d => ({ ...d, ...p }))}
            inflow people={people} heading="Payment"
            onReceiptNo={() => setPay(d => ({ ...d, reference: nextCashReceiptNo(payForm.date) }))} />
          <Field label="Remarks" value={payForm.remarks} onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add trader"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save trader</Button></div>}>
        <div className="space-y-3">
          <Field label="Trader name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rajesh Traders" />
          <Field label="Mobile number" type="tel" inputMode="numeric" maxLength={10} value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))} prefix="+91" placeholder="10-digit" className="font-mono" />
          <Field label="GSTIN (optional)" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="27AABCR1234F1Z5" className="font-mono" />
          <Field label="Address (optional)" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="City, State" />
          <Field label="Opening balance (₹, optional)" type="number" inputMode="decimal" value={form.openingBalance} onChange={e => setForm(f => ({ ...f, openingBalance: e.target.value }))} placeholder="e.g. 5000" className="font-mono" hint="Amount already owed by the trader" />
        </div>
      </Dialog>
      </PageReveal>
    </Page>
  );
}
