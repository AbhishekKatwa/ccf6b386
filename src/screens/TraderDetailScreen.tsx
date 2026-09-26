import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Phone, MapPin, Wallet, MoreHorizontal, TrendingUp, TrendingDown, Egg, ChevronRight,
  Link2Off, Info, FileText,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, Row, Avatar, StatusBadge, GroupList, SectionTitle } from '@/components/ui/Card';
import { Button, Field, IconButton, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { GraphCard, GraphRange } from '@/components/charts/GraphCard';
import { axisNum, ChartLegend, TrendChart, type VSeries } from '@/components/charts/DataViz';
import { CHART } from '@/components/ui/Charts';
import { EASE, MOTION, Presence, StaggerContainer, StaggerItem, useReducedMotion } from '@/components/motion';
import { motion } from 'motion/react';
import { fmtMoney, fmtIN, fmtDate, fmtDateShort, fmtDateTime, todayISO } from '@/lib/format';
import { batchOfShedOn, entryTrays, loadBilled, txnSignedAmount, traderBalance, TRADER_TXN_LABEL, traderLedger } from '@/lib/calc';
import { fin, rangeOf, traderCollections, type Point, type RangeKey } from '@/lib/analytics';
import { movesMoney } from '@/lib/cashflow';
import {
  AccountabilityDetail, EMPTY_PAYMENT, PaymentChips, PaymentFields,
  paymentDraftOf, paymentPatch, type PaymentDraft,
} from '@/components/finance/PaymentFields';
import type { SaleEntry, TraderTxn } from '@/types';

const RANGES = [
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
] as const;

/** A one-point series is a guess, not a trend, so that line is left out. */
const worthPlotting = (points: Point[]) => points.filter(p => p.value !== null).length >= 2;

const KIND_LABEL = TRADER_TXN_LABEL;

function LedgerCell({ label, value, sub, tone = 'ink' }: { label: string; value: string; sub?: string; tone?: 'ink' | 'success' | 'danger' }) {
  const cls = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`font-mono text-[14px] font-semibold tnum mt-0.5 truncate ${cls}`}>{value}</p>
      {sub && <p className="font-mono text-[10px] text-muted-2 tnum truncate">{sub}</p>}
    </div>
  );
}

export function TraderDetailScreen() {
  const { traderId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const traders = data.traders;
  const txns = data.traderTxns;
  const addTxn = useApp(s => s.addTraderTxn);
  const updateTxn = useApp(s => s.updateTraderTxn);
  const pushToast = useApp(s => s.pushToast);
  const cashPeople = useApp(s => s.cashPeople);
  const takeReceiptNo = useApp(s => s.takeReceiptNo);
  const canFinance = useCan('viewFinance');
  const canManage = useCan('manageTraders');
  const [sheet, setSheet] = useState<'payment' | 'rate' | 'actions' | null>(null);
  const [detail, setDetail] = useState<TraderTxn | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>('30D');
  const [form, setForm] = useState({ date: todayISO(), amount: '', rate: '', remarks: '' });
  const [pay, setPay] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [fix, setFix] = useState<{ txn: TraderTxn; amount: string; reason: string; pay: PaymentDraft } | null>(null);
  const reduced = useReducedMotion();

  /** The people who may stand recorded as having held this cash. */
  const people = useMemo(() => cashPeople(), [cashPeople, data.users]);

  const trader = traders.find(t => t.id === traderId);
  /** The statement: newest day first, newest booking within a day on top. */
  const ledger = useMemo(
    () => traderLedger(trader?.openingBalance ?? 0, txns.filter(t => t.traderId === traderId)),
    [txns, traderId, trader],
  );
  const list = useMemo(() => ledger.map(l => l.txn), [ledger]);
  /** The one running-balance replay — the same rows `traderBalance` adds up. */
  const running = useMemo(() => new Map(ledger.map(l => [l.txn.id, l.running])), [ledger]);

  const today = todayISO();
  const range = useMemo(() => rangeOf(rangeKey, today), [rangeKey, today]);
  /** The dashboard's own collections slice, narrowed to this trader and grouped to fit its data. */
  const flow = useMemo(() => (trader ? traderCollections([trader], txns, range, 'AUTO') : null), [trader, txns, range]);

  /** Date → balance at the end of that day; the first row of a day is its last booking. */
  const trend = useMemo<Point[]>(() => {
    const byDate = new Map<string, number>();
    for (const l of ledger) if (!byDate.has(l.txn.date)) byDate.set(l.txn.date, l.running);
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
  }, [ledger]);

  if (!trader) return <Page><Header title="Trader" /><div className="px-4 sm:px-0"><EmptyState title="Trader not found" /></div></Page>;

  const totals = list.reduce((acc, t) => {
    const v = fin(t.amount) ?? 0;
    if (t.kind === 'EGG_SALE') { acc.sales += v; acc.trays += t.trays ?? 0; acc.loads += 1; }
    if (t.kind === 'PAYMENT_OUT') acc.extra += v;
    if (t.kind === 'PAYMENT_IN') {
      acc.payments += v; acc.paymentsIn += 1;
      if (t.date > acc.lastPayment) acc.lastPayment = t.date;
    }
    return acc;
  }, { sales: 0, extra: 0, payments: 0, trays: 0, loads: 0, paymentsIn: 0, lastPayment: '' });
  const balance = traderBalance(trader.openingBalance, list);
  const latestRate = list.find(t => t.rate !== undefined)?.rate;

  /** A credit balance is money the farm is holding, so it reads as a minus, not a “₹-”. */
  const m = (v: number | null | undefined, decimals = 0) => !canFinance ? '₹ •••••'
    : v === null || v === undefined ? 'Unavailable'
    : v < 0 ? `−${fmtMoney(Math.abs(v), decimals)}` : fmtMoney(v, decimals);
  const chartMoney = (v: number) => canFinance ? `₹${axisNum(v)}` : '••';

  /** Only a line with two recorded slots is plotted; a lone point would be a guess. */
  const series: VSeries[] = (flow ? [
    { id: 'billed', label: 'Sales billed', color: CHART.accent, points: flow.billed, area: true },
    { id: 'paid', label: 'Payments received', color: CHART.success, points: flow.received, dashed: true },
  ] : []).filter(s => worthPlotting(s.points));

  const rateHistory = list.filter(t => t.kind === 'RATE_UPDATE' || t.kind === 'EGG_SALE').slice(0, 8);

  /** The sale voucher that booked a ledger row, when it still exists in this company. */
  const saleOf = (t: TraderTxn): SaleEntry | undefined => (t.refId ? data.saleEntries.find(e => e.id === t.refId) : undefined);
  const userName = (id: string) => data.users.find(u => u.id === id)?.name ?? (id === 'system' ? 'System' : id);
  /** The sheds the load left, and the batch that was laying in each of them that day. */
  const shedsOf = (entry: SaleEntry) => entry.lines.map(l => data.sheds.find(s => s.id === l.shedId)?.name).filter(Boolean) as string[];
  const batchesOf = (entry: SaleEntry) => Array.from(new Set(entry.lines
    .map(l => batchOfShedOn(data.batches, l.shedId, entry.date)?.code)
    .filter(Boolean) as string[]));

  /** How a row moved the dues, in the ledger's own sign convention. */
  function effectOf(t: TraderTxn) {
    const signed = txnSignedAmount(t);
    if (t.kind === 'OPENING') return `Opens the account at ${fmtMoney(t.amount)}`;
    if (signed === 0) return 'No effect on balance';
    return signed > 0 ? `+${fmtMoney(signed)} added to dues` : `−${fmtMoney(Math.abs(signed))} cleared off dues`;
  }

  /**
   * A row always points at its source record rather than a copy of it, so opening a
   * payment never duplicates anything. Payments typed straight onto the ledger have no
   * source and open their own details instead of a sale that does not exist.
   */
  function openTxn(t: TraderTxn) {
    const sale = saleOf(t);
    if (sale) {
      nav(t.kind === 'PAYMENT_IN' ? `/sales/entry/${sale.id}?payment=${t.id}` : `/sales/entry/${sale.id}`);
      return;
    }
    setDetail(t);
  }

  function save(kind: 'PAYMENT_IN' | 'RATE_UPDATE') {
    const amt = parseFloat(form.amount) || 0;
    const rate = parseFloat(form.rate) || 0;
    if (kind === 'PAYMENT_IN' && amt <= 0) return pushToast('error', 'Enter amount');
    if (kind === 'RATE_UPDATE' && rate <= 0) return pushToast('error', 'Enter the new rate');
    const r = addTxn({
      traderId: trader!.id, date: form.date, kind,
      rate: kind === 'RATE_UPDATE' ? rate : undefined,
      amount: kind === 'PAYMENT_IN' ? amt : 0,
      remarks: form.remarks || undefined,
      // Money that arrived has to say how it arrived and whose hands it went through.
      ...(kind === 'PAYMENT_IN' ? paymentPatch(pay) : {}),
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Transaction saved');
    setSheet(null);
    setForm({ date: todayISO(), amount: '', rate: '', remarks: '' });
    setPay(EMPTY_PAYMENT);
  }

  /**
   * Only a row with no source voucher is correctable here; a voucher-owned row belongs to
   * its sale entry, and the store refuses to let it drift away from that record.
   */
  function openFix(t: TraderTxn) {
    setFix({ txn: t, amount: String(t.amount), reason: '', pay: paymentDraftOf(t) });
  }

  const patchFix = (p: Partial<{ amount: string; reason: string }>) =>
    setFix(f => f && { ...f, ...p });
  const patchFixPay = (p: Partial<PaymentDraft>) =>
    setFix(f => f && { ...f, pay: { ...f.pay, ...p } });

  function saveFix() {
    if (!fix) return;
    const amt = parseFloat(fix.amount);
    if (!isFinite(amt) || amt <= 0) return pushToast('error', 'Enter the corrected amount');
    const r = updateTxn(fix.txn.id, { ...paymentPatch(fix.pay), amount: amt }, fix.reason);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Correction saved with its audit trail');
    setDetail(null);
    setFix(null);
  }

  const detailSale = detail ? saleOf(detail) : undefined;

  return (
    <Page withNav>
      <Header title={trader.name} subtitle={`+91 ${trader.mobile}`}
        action={canManage ? <Button size="sm" icon={<Wallet size={14} />} onClick={() => setSheet('payment')}>Record payment</Button> : undefined} />

      <StaggerContainer className="px-4 sm:px-0 mt-3 space-y-4">
        <StaggerItem>
        <Card>
          <div className="flex items-center gap-3">
            <Avatar name={trader.name} size={52} tone="accent" />
            <div className="flex-1 min-w-0">
              <p className="font-display text-[17px] font-semibold text-ink truncate">{trader.name}</p>
              <p className="font-mono text-[12px] text-muted flex items-center gap-1 mt-1 tnum"><Phone size={11} /> +91 {trader.mobile}</p>
              {trader.address && <p className="text-[12px] text-muted flex items-center gap-1 mt-0.5"><MapPin size={11} /> <span className="truncate">{trader.address}</span></p>}
            </div>
            <StatusBadge status={trader.active ? 'ACTIVE' : 'CLOSED'} />
          </div>
          {trader.gstin && <div className="mt-3 pt-3 border-t border-line-2"><Row label="GSTIN" value={trader.gstin} /></div>}
        </Card>
        </StaggerItem>

        {canFinance && (
          <StaggerItem>
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Current balance</p>
                <p className={clsx('font-display text-[34px] sm:text-[40px] leading-10 font-semibold tnum tracking-tight mt-1',
                  balance > 0 ? 'text-danger' : 'text-ink')}>
                  {fmtMoney(Math.abs(balance))}
                </p>
                <p className="text-[12px] text-muted mt-1.5">
                  {balance > 0 ? 'Outstanding — to collect from this trader'
                    : balance < 0 ? 'Advance held for the trader' : 'Settled to the rupee'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-[10px] text-muted tnum">
                  {totals.lastPayment ? `last payment ${fmtDate(totals.lastPayment)}` : 'no payment received yet'}
                </p>
                <p className="font-mono text-[10px] text-muted-2 tnum mt-0.5">{fmtIN(list.length)} ledger {list.length === 1 ? 'row' : 'rows'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3.5 mt-4 pt-3.5 border-t border-line-2">
              <LedgerCell label="Opening balance" value={fmtMoney(trader.openingBalance)} sub="typed when the trader was added" />
              <LedgerCell label="Total sales billed" value={fmtMoney(totals.sales)} sub={`${fmtIN(totals.trays)} trays · ${fmtIN(totals.loads)} ${totals.loads === 1 ? 'load' : 'loads'}`} />
              <LedgerCell label="Payments received" value={fmtMoney(totals.payments)} tone="success"
                sub={totals.paymentsIn ? `${fmtIN(totals.paymentsIn)} ${totals.paymentsIn === 1 ? 'booking' : 'bookings'}` : 'nothing received yet'} />
              <LedgerCell label="Additional billed" value={fmtMoney(totals.extra)}
                sub={totals.extra ? 'charged back on the ledger' : 'nothing charged back'} />
              <LedgerCell label="Latest rate" value={latestRate === undefined ? 'Not recorded' : fmtMoney(latestRate, 2)}
                sub="per egg, from the ledger" />
              <LedgerCell label="Current balance" value={fmtMoney(balance)} tone={balance > 0 ? 'danger' : 'ink'}
                sub="opening + billed − received" />
            </div>
          </Card>
          </StaggerItem>
        )}

        {canManage && (
          <StaggerItem>
          <div className="flex gap-2">
            <Button block icon={<Wallet size={15} />} onClick={() => setSheet('payment')}>Record payment</Button>
            <Button variant="outline" icon={<MoreHorizontal size={15} />} aria-label="More ledger actions"
              onClick={() => setSheet('actions')}>More</Button>
          </div>
          </StaggerItem>
        )}

        {canFinance && flow && series.length > 0 && (
          <StaggerItem>
          <GraphCard
            title="Money flow" height={200}
            subtitle={`${fmtDateShort(range.from)} – ${fmtDateShort(range.to)} · ${flow.groupUsed === 'MONTH' ? 'grouped by calendar month' : 'day by day'}, from this trader’s rows`}
            actions={<GraphRange value={rangeKey} onChange={setRangeKey} options={RANGES} label="Period" />}
            warnings={flow.warnings}
            stats={[
              { label: 'Billed', value: m(flow.totalBilled) },
              { label: 'Received', value: m(flow.totalReceived), tone: 'success' },
              { label: 'Still due', value: m(balance > 0 ? balance : 0) },
            ]}
            detail={`${trader.name} · ${rangeKey} · ${flow.groupUsed}`}
          >
            <TrendChart series={series} height={190} format={chartMoney} />
            <ChartLegend items={series.map(s => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
          </GraphCard>
          </StaggerItem>
        )}

        {canFinance && worthPlotting(trend) && (
          <StaggerItem>
          <GraphCard
            title="Balance trend" height={200}
            subtitle="Running balance after every ledger row, from the same replay as the balance above"
            detail={`${trader.name} · ${trend.length} recorded dates`}
          >
            <TrendChart
              series={[{ id: 'balance', label: 'Balance', color: CHART.brand, points: trend, area: true }]}
              height={190} format={chartMoney} zeroBase={false}
            />
            <p className="mt-2 text-[11px] text-muted leading-snug">
              Below the line means the farm is holding money for this trader rather than waiting to collect it.
            </p>
          </GraphCard>
          </StaggerItem>
        )}

        <StaggerItem>
        <div>
          <SectionTitle>Rate history</SectionTitle>
          <Presence mode="wait">
            <motion.div
              key={rateHistory.length === 0 ? 'empty' : 'rows'}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: MOTION.micro.duration } }}
              transition={reduced ? { duration: 0 } : { duration: MOTION.component.duration, ease: EASE }}
            >
          {rateHistory.length === 0 ? (
            <EmptyState title="No rate history" description="A rate appears here when a load is billed or revised." />
          ) : (
            <GroupList>
              {rateHistory.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="font-mono text-[12px] text-muted tnum shrink-0">{fmtDate(t.date)}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2 truncate">{KIND_LABEL[t.kind]}</span>
                  <span className="font-display text-[15px] font-semibold text-ink tnum shrink-0">{canFinance ? fmtMoney(t.rate ?? 0, 2) : '₹••'}</span>
                </div>
              ))}
            </GroupList>
          )}
            </motion.div>
          </Presence>
        </div>
        </StaggerItem>

        <StaggerItem>
        <div>
          <SectionTitle>Transaction history</SectionTitle>
          <Presence mode="wait">
            <motion.div
              key={list.length === 0 ? 'empty' : 'rows'}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: MOTION.micro.duration } }}
              transition={reduced ? { duration: 0 } : { duration: MOTION.component.duration, ease: EASE }}
            >
          {list.length === 0 ? (
            <EmptyState icon={<Egg size={22} />} title="No transactions"
              description="Egg sales appear here once a sale entry is recorded. Use Record payment for money that arrives against the account." />
          ) : (
            <>
              <div className="hidden sm:flex sm:items-end gap-3 px-4 pb-1.5">
                <p className="w-8 shrink-0" />
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2 w-[96px] shrink-0">Date</p>
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2 flex-1 min-w-0">Type · reference</p>
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2 w-[104px] shrink-0 text-right">Effect</p>
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2 w-[88px] shrink-0 text-right">Balance</p>
                <p className="w-8 shrink-0 sr-only">Details</p>
              </div>
              <GroupList>
                {list.map(t => {
                  const isIn = t.kind === 'PAYMENT_IN';
                  const Icon = isIn ? TrendingDown : t.kind === 'EGG_SALE' ? Egg : TrendingUp;
                  const sale = saleOf(t);
                  const signed = txnSignedAmount(t);
                  const effect = !canFinance ? '₹••' : t.kind === 'OPENING' ? 'base'
                    : signed === 0 ? 'no effect'
                    : `${signed > 0 ? '+' : '−'}${fmtMoney(Math.abs(signed))}`;
                  const after = running.get(t.id) ?? 0;
                  return (
                    <div key={t.id}
                      role="button" tabIndex={0}
                      onClick={() => openTxn(t)}
                      onKeyDown={e => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTxn(t); }
                      }}
                      className={clsx('flex items-center gap-3 px-4 py-2.5 press hover:bg-sunk/60 cursor-pointer')}
                    >
                      <span className={clsx('w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0',
                        isIn ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent-ink')}>
                        <Icon size={14} />
                      </span>
                      <span className="font-mono text-[11.5px] text-muted tnum w-[96px] shrink-0 hidden sm:block">{fmtDate(t.date)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-ink truncate">
                          {KIND_LABEL[t.kind]}{isIn && !sale ? ' · unlinked' : ''}
                        </p>
                        <p className="font-mono text-[10.5px] text-muted truncate mt-0.5 tnum">
                          <span className="sm:hidden">{fmtDate(t.date)} · </span>
                          {canFinance && `${signed > 0 ? '+' : signed < 0 ? '−' : ''}${fmtMoney(t.amount)} · `}
                          {sale ? `${shedsOf(sale).join(' / ') || 'Sale entry'} · ${sale.id}`
                            : t.trays ? `${fmtIN(t.trays)} trays @ ${fmtMoney(t.rate ?? 0, 2)}/egg`
                            : t.remarks || (t.kind === 'RATE_UPDATE' ? `${fmtMoney(t.rate ?? 0, 2)} per egg` : 'no reference')}
                        </p>
                        {/* How the money moved is a field on the row, not something to dig out later. */}
                        {canFinance && movesMoney(t.kind) && <PaymentChips row={t} compact className="mt-1.5" />}
                      </div>
                      <div className="hidden sm:block w-[104px] shrink-0 text-right">
                        <p className={clsx('font-mono text-[12.5px] font-semibold tnum', isIn ? 'text-success' : signed > 0 ? 'text-ink' : 'text-muted-2')}>{effect}</p>
                        {t.kind === 'RATE_UPDATE' && <p className="font-mono text-[9.5px] text-muted-2">rate only</p>}
                      </div>
                      <div className="hidden sm:block w-[88px] shrink-0 text-right">
                        <p className={clsx('font-mono text-[12px] font-semibold tnum', after < 0 ? 'text-success' : 'text-ink')}>{canFinance ? m(after) : '₹••'}</p>
                        <p className="font-mono text-[9.5px] text-muted-2">running</p>
                      </div>
                      <div className="sm:hidden text-right shrink-0">
                        <p className={clsx('font-mono text-[11.5px] font-semibold tnum', after < 0 ? 'text-success' : 'text-ink')}>{canFinance ? m(after) : '₹••'}</p>
                        <p className="font-mono text-[9px] text-muted-2">balance</p>
                      </div>
                      {sale && <ChevronRight size={14} className="hidden lg:block text-faint shrink-0" />}
                      {/* The row itself opens the source record, so this button must not bubble. */}
                      <span className="shrink-0" onClick={e => e.stopPropagation()}>
                        <IconButton label={`Details of the ${KIND_LABEL[t.kind].toLowerCase()} row`} onClick={() => setDetail(t)} className="w-8 h-8">
                          <Info size={14} />
                        </IconButton>
                      </span>
                    </div>
                  );
                })}
              </GroupList>
              <p className="mt-2 text-[11px] text-muted leading-snug px-1">
                Tap a row to open the record behind it; the ⓘ button opens the row’s own details.
              </p>
            </>
          )}
            </motion.div>
          </Presence>
        </div>
        </StaggerItem>
      </StaggerContainer>

      <Dialog open={sheet === 'actions'} onClose={() => setSheet(null)} title="Ledger actions" subtitle={trader.name}>
        <div className="space-y-2.5">
          <Button block variant="outline" icon={<Wallet size={15} />} onClick={() => setSheet('payment')}>Record payment received</Button>
          <Button block variant="outline" icon={<TrendingUp size={15} />} onClick={() => setSheet('rate')}>Record rate revision</Button>
          <p className="text-[12px] text-muted leading-snug px-1">
            Egg sales are billed by Accounts on a sale entry, and the load writes its own ledger row. Discounts, advances
            and adjustments are not ledger types in this accounting model, so they are not offered here.
          </p>
          <Button block variant="ghost" onClick={() => setSheet(null)}>Close</Button>
        </div>
      </Dialog>

      <Dialog open={sheet === 'payment' || sheet === 'rate'} onClose={() => { setSheet(null); setPay(EMPTY_PAYMENT); }}
        title={sheet === 'payment' ? 'Record payment' : 'Record rate revision'}
        subtitle={sheet === 'payment' ? `${trader.name} · and how its money arrived` : trader.name}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => { setSheet(null); setPay(EMPTY_PAYMENT); }}>Cancel</Button>
          <Button block onClick={() => save(sheet === 'payment' ? 'PAYMENT_IN' : 'RATE_UPDATE')}>Save</Button>
        </div>}>
        <div className="space-y-3">
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          {sheet === 'payment' && (
            <>
              <Field label="Amount received (₹)" type="number" inputMode="decimal" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="font-mono"
                hint="Reduces the outstanding balance by this amount" />
              <PaymentFields draft={pay} onChange={p => setPay(d => ({ ...d, ...p }))}
                inflow people={people} heading="Payment"
                onReceiptNo={() => { void takeReceiptNo('CR', form.date).then(no => { if (no) setPay(d => ({ ...d, reference: no })); }); }} />
              <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
              <p className="text-[11.5px] text-muted leading-snug px-1">
                Record this against {trader.name} — you may be typing it for someone else’s collection, so the person who
                physically took the cash is asked for separately above.
              </p>
            </>
          )}
          {sheet === 'rate' && (
            <>
              <Field label="New rate (₹/egg)" type="number" inputMode="decimal" step="0.01" value={form.rate}
                onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} className="font-mono"
                hint="Kept for history — it does not move the balance" />
              <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
            </>
          )}
        </div>
      </Dialog>

      <Dialog open={!!detail && !fix} onClose={() => setDetail(null)} title="Transaction details"
        subtitle={detail ? `${KIND_LABEL[detail.kind]} · ${fmtDate(detail.date)}` : undefined}>
        {detail && (
          <div className="space-y-3">
            {detail.kind === 'PAYMENT_IN' && !detailSale && (
              <div className="flex items-start gap-2 rounded-[14px] bg-warn-soft px-3.5 py-3">
                <Link2Off size={15} className="text-warn shrink-0 mt-0.5" />
                <p className="text-[12px] font-medium text-warn leading-snug">
                  Not linked to a sale entry — this was entered straight on the ledger. It still counts against the outstanding balance.
                </p>
              </div>
            )}
            <Card>
              <Row label="Date" value={fmtDate(detail.date)} />
              <Row label="Type" value={KIND_LABEL[detail.kind]} mono={false} />
              <Row label="Reference" mono={false}
                value={detailSale ? `Sale entry ${detailSale.id}` : detail.refId ?? (detail.kind === 'OPENING' ? 'Opening balance' : 'Entered on the ledger')} />
              <Row label="Amount" value={m(detail.amount)} />
              <Row label="Effect on balance" mono={false} value={canFinance ? effectOf(detail) : 'hidden for your role'} />
              <Row label="Running balance" value={m(running.get(detail.id) ?? 0)} />
              {detail.rate !== undefined && <Row label="Rate" value={m(detail.rate, 2)} />}
              {detail.trays !== undefined && <Row label="Trays" value={fmtIN(detail.trays)} />}
              {canFinance && movesMoney(detail.kind) && (
                <AccountabilityDetail row={detail} inflow={detail.kind === 'PAYMENT_IN'}
                  nameOf={id => (id ? userName(id) : '—')} />
              )}
              {detailSale && <Row label="Shed" mono={false} value={shedsOf(detailSale).join(' / ') || '—'} />}
              {detailSale && (
                <Row label="Batch" mono={false} value={batchesOf(detailSale).join(' / ') || 'No open batch on that date'} />
              )}
              {detailSale && canFinance && (
                <Row label="Egg sale billed" value={`${fmtIN(entryTrays(detailSale))} trays · ${fmtMoney(loadBilled(detailSale.amount, detailSale.laborCharge))}`} />
              )}
              <Row label="Remarks" mono={false} value={detail.remarks || '—'} />
              <Row label="Created by" mono={false} value={userName(detail.createdBy)} />
              <Row label="Created at" value={fmtDateTime(detail.createdAt)} />
              {detailSale && canFinance && movesMoney(detail.kind) && (
                <p className="pt-2.5 text-[11px] text-muted leading-snug">
                  This row was written by a sale voucher, so its amount and payment details are corrected on that
                  voucher — not here.
                </p>
              )}
            </Card>
            <div className="flex gap-2">
              {detailSale && (
                <Button block variant="outline" icon={<FileText size={14} />}
                  onClick={() => nav(`/sales/entry/${detailSale.id}${detail.kind === 'PAYMENT_IN' ? `?payment=${detail.id}` : ''}`)}>
                  Open sale entry
                </Button>
              )}
              {!detailSale && canManage && movesMoney(detail.kind) && (
                <Button block variant="outline" onClick={() => openFix(detail)}>Correct payment</Button>
              )}
              <Button block variant={detailSale ? 'ghost' : 'primary'} onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* §12 — an amount, method or custodian never changes hands silently: the reason is required and audited. */}
      <Dialog open={!!fix} onClose={() => setFix(null)} title="Correct this payment"
        subtitle={fix ? `${trader.name} · ${KIND_LABEL[fix.txn.kind]} · ${fmtDate(fix.txn.date)}` : undefined}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => setFix(null)}>Cancel</Button>
          <Button block onClick={saveFix}>Save correction</Button>
        </div>}>
        {fix && (
          <div className="space-y-3">
            <Card>
              <Row label="Recorded amount" value={m(fix.txn.amount)} />
              <Row label="Running balance now" value={m(running.get(fix.txn.id) ?? 0)} />
            </Card>
            <Field label="Corrected amount (₹)" type="number" inputMode="decimal" value={fix.amount}
              onChange={e => patchFix({ amount: e.target.value })} className="font-mono"
              hint="The ledger re-derives the outstanding balance from this figure" />
            <PaymentFields draft={fix.pay} heading="Payment" inflow={fix.txn.kind === 'PAYMENT_IN'} people={people}
              onChange={patchFixPay}
              onReceiptNo={() => { void takeReceiptNo('CR', fix.txn.date).then(no => { if (no) setFix(f => f && { ...f, pay: { ...f.pay, reference: no } }); }); }} />
            <TextArea label="Reason for the correction" rows={2} value={fix.reason}
              onChange={e => patchFix({ reason: e.target.value })}
              placeholder="e.g. the cashier's name was recorded against the wrong person" />
            <p className="text-[11.5px] text-muted leading-snug px-1">
              The amount, payment method, counterparty and every name behind the cash are kept on record with what they
              were before, who changed them and why.
            </p>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
