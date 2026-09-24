import { useEffect, useMemo, useState } from 'react';
import {
  Wallet, Plus, TrendingUp, TrendingDown, ShieldAlert, ArrowUpRight, ArrowDownLeft,
  ShoppingCart, HandCoins, ChevronRight, ChevronDown, Search, Warehouse, Boxes, Layers, Scale, AlertTriangle,
  LayoutDashboard, Activity, ScrollText, Banknote, Landmark, ArrowLeftRight, ClipboardCheck, UserRound, Pill,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp, useCan, useCompanyData, type PurchasePaymentInput, type SalePaymentInput } from '@/store/app';
import { Header, Page, ScreenTitle } from '@/components/ui/Header';
import { Card, EmptyState, IconTile, GroupList, ListRow, Badge, Row, SectionTitle } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, SearchField, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { LedgerDayHeader } from '@/components/godown/StockLedger';
import { GraphCard, GraphRange } from '@/components/charts/GraphCard';
import { axisNum, BarSeries, DonutChart, HBarList, PairedBars, SERIES_COLORS, type HRow } from '@/components/charts/DataViz';
import {
  AccountabilityDetail, EMPTY_PAYMENT, PaymentChips, PaymentFields, paymentDraftOf, paymentPatch,
  UnclassifiedNote, type PaymentDraft,
} from '@/components/finance/PaymentFields';
import { RecordPaymentDialog, type PaymentTarget, type Receivable } from '@/components/finance/RecordPaymentDialog';
import { usePurchasePositions, useSalePositions } from '@/hooks/usePaymentPositions';
import { payableTotals, UNSUPPLIED, unlinkedPurchasePayments, type PurchasePosition } from '@/lib/purchasing';
import { saleReceivableTotal } from '@/lib/calc';
import { fmtMoney, fmtIN, fmtDate, fmtDateShort, todayISO } from '@/lib/format';
import { latestFirst } from '@/lib/order';
import { feedCostByShed, feedExpenseTraces, revenueBreakdown, pnlTrend, type FeedTrace, type PnlMode, type Range } from '@/lib/analytics';
import {
  allocateShortage, computeFarmPnl, FINANCE_CATEGORIES, godownLedger, INVENTORY_CATEGORIES, isInventoryPurchase, isInflow, shortageRows,
  type ShedPnl,
} from '@/lib/accounting';
import {
  carriesChannel, cashFlowOf, cashPositionOf, custodyOf, isClassified, methodSummary, reconcileCash,
  type ChannelKey,
} from '@/lib/cashflow';
import { useMedicineValuation } from '@/hooks/useMedicineValuation';
import { MEDICINE_ROLES } from '@/lib/permissions';
import type { FinanceTxn, TxnKind } from '@/types';

const KINDS: TxnKind[] = ['INCOME', 'EXPENSE', 'PURCHASE', 'SALE', 'PAYMENT_IN', 'PAYMENT_OUT'];

/* ============================= PERIOD ============================= */

type PeriodKey = 'ALL' | '7D' | '30D' | '90D' | 'MONTH';
const PERIODS: readonly { value: PeriodKey; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: '7D', label: '7d' },
  { value: '30D', label: '30d' },
  { value: '90D', label: '90d' },
  { value: 'MONTH', label: 'This month' },
];

/** Resolve a period to a date window; 'ALL' spans every recorded date. */
function periodRange(key: PeriodKey): Range | null {
  const today = todayISO();
  const shift = (days: number) => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  if (key === 'ALL') return null;
  if (key === 'MONTH') return { key: '30D', from: today.slice(0, 8) + '01', to: today, days: 0 };
  const days = key === '7D' ? 7 : key === '90D' ? 90 : 30;
  return { key: '30D', from: shift(days - 1), to: today, days };
}

const periodLabel: Record<PeriodKey, string> = {
  ALL: 'All time', '7D': 'Last 7 days', '30D': 'Last 30 days', '90D': 'Last 90 days', MONTH: 'This month',
};

/* ============================= TRANSACTION VISUALS ============================= */

const KIND_META: Record<TxnKind, { label: string; short: string; icon: typeof TrendingUp; inflow: boolean }> = {
  INCOME: { label: 'Income', short: 'Income', icon: TrendingUp, inflow: true },
  SALE: { label: 'Sale', short: 'Sale', icon: HandCoins, inflow: true },
  PAYMENT_IN: { label: 'Payment in', short: 'Payment in', icon: ArrowDownLeft, inflow: true },
  EXPENSE: { label: 'Expense', short: 'Expense', icon: TrendingDown, inflow: false },
  PURCHASE: { label: 'Purchase', short: 'Purchase', icon: ShoppingCart, inflow: false },
  PAYMENT_OUT: { label: 'Payment out', short: 'Payment out', icon: ArrowUpRight, inflow: false },
};

const GODOWN_KEY = '__godown';
const UNMAPPED_KEY = '__unmapped';

/** §16 — filter the ledger by how the money physically moved. */
const CHANNEL_FILTERS: readonly { value: ChannelKey | 'all'; label: string }[] = [
  { value: 'all', label: 'Any method' },
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'advance', label: 'Advance' },
  { value: 'unrecorded', label: 'Not recorded' },
];

const DIRECTION_FILTERS = [
  { value: 'all', label: 'In & out' },
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
] as const;

/* ============================= TABS ============================= */

type FinTab = 'overview' | 'activity' | 'ledger';

/* ============================= KPI CARD ============================= */

function KpiCard({ label, value, foot, tone, icon }: {
  label: string; value: string; foot: string; tone: 'success' | 'danger' | 'brand'; icon: React.ReactNode;
}) {
  const toneText = { success: 'text-success', danger: 'text-danger', brand: 'text-brand' }[tone];
  const tileTone = { success: 'success', danger: 'danger', brand: 'brand' }[tone] as 'success' | 'danger' | 'brand';
  return (
    <div className="rounded-[18px] border border-line bg-card shadow-card px-4 py-4 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted truncate">{label}</p>
        <IconTile tone={tileTone} size={28}>{icon}</IconTile>
      </div>
      <p className={clsx('font-display text-[22px] leading-8 font-semibold tnum tracking-tight mt-1.5 truncate', toneText)}>{value}</p>
      <p className="mt-0.5 font-mono text-[10px] text-muted tnum truncate">{foot}</p>
    </div>
  );
}

/** Names which book a row of figures belongs to, and what it does not overlap with. */
function Band({ label, note, right }: { label: string; note: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-x-3 gap-y-1 flex-wrap px-0.5">
      <div className="min-w-0">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-brand-ink">{label}</p>
        <p className="text-[11.5px] text-muted leading-snug mt-1 max-w-[68ch]">{note}</p>
      </div>
      {right}
    </div>
  );
}

/** A stat block used inside the summary and godown panels. */
function Stat({ label, value, foot, tone }: { label: string; value: string; foot?: React.ReactNode; tone?: 'ink' | 'brand' | 'danger' | 'success' | 'warn' | 'accent' }) {
  const toneText = {
    ink: 'text-ink', brand: 'text-brand', danger: 'text-danger', success: 'text-success', warn: 'text-warn', accent: 'text-accent-ink',
  }[tone ?? 'ink'];
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-2">{label}</p>
      <p className={clsx('font-display text-[18px] font-semibold tnum mt-0.5 leading-6 break-words', toneText)}>{value}</p>
      {foot && <p className="font-mono text-[10px] text-muted mt-0.5 leading-snug">{foot}</p>}
    </div>
  );
}

/* ============================= SCREEN ============================= */

export function FinanceScreen() {
  const { finance, batches, sheds, feed, feedStock, medicineItems, medicineStock, feedFormulas, users, traders, cashHandovers, cashCounts } = useCompanyData();
  const addFinance = useApp(s => s.addFinance);
  const assignFinance = useApp(s => s.assignFinance);
  const updateFinance = useApp(s => s.updateFinance);
  const addCashHandover = useApp(s => s.addCashHandover);
  const recordCashCount = useApp(s => s.recordCashCount);
  const nextCashReceiptNo = useApp(s => s.nextCashReceiptNo);
  const recordPurchasePayment = useApp(s => s.recordPurchasePayment);
  const recordSalePayment = useApp(s => s.recordSalePayment);
  const cashPeople = useApp(s => s.cashPeople);
  const sessionUser = useApp(s => s.session?.userId);
  const pushToast = useApp(s => s.pushToast);
  const canView = useCan('viewFinance');
  const canCreate = useCan('create');

  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<PeriodKey>('ALL');
  const [tab, setTab] = useState<FinTab>('overview');
  const [filter, setFilter] = useState<'all' | TxnKind>('all');
  const [channel, setChannel] = useState<ChannelKey | 'all'>('all');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [shedFilter, setShedFilter] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  /** The payment workflow, with the purchase or load already chosen when arriving from a ledger. */
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<PaymentTarget | undefined>(undefined);
  const [pnlMode, setPnlMode] = useState<PnlMode>('MONTH');
  const [form, setForm] = useState({
    date: todayISO(), kind: 'EXPENSE' as TxnKind, amount: '',
    category: 'Feed Purchase', target: '', counterparty: '', remarks: '',
  });
  /** How the money in the new entry moved — method, time and whose hands held it. */
  const [pay, setPay] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [mapTxn, setMapTxn] = useState<FinanceTxn | null>(null);
  const [mapTarget, setMapTarget] = useState('');
  const [txnDetail, setTxnDetail] = useState<FinanceTxn | null>(null);
  /** Correcting a payment: the row being fixed, its new payment block and the reason. */
  const [fixTxn, setFixTxn] = useState<FinanceTxn | null>(null);
  const [fixPay, setFixPay] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [fixAmt, setFixAmt] = useState('');
  const [fixParty, setFixParty] = useState('');
  const [fixReason, setFixReason] = useState('');
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [handover, setHandover] = useState({ date: todayISO(), time: '', amount: '', fromUserId: '', toUserId: '', reason: '', reference: '' });
  const [count, setCount] = useState({ date: todayISO(), physicalCash: '', remarks: '' });
  const [shedDetail, setShedDetail] = useState<string | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);

  /* ---- accounting layer: the P&L, the godown position and their checks ---- */

  const range = useMemo(() => periodRange(period), [period]);

  /** The window everything derived uses — the selected period, or every recorded date. */
  const periodAll = useMemo(
    () => finance.filter(t => isDay(t.date)),
    [finance],
  );
  const dataRange = useMemo<Range>(() => {
    if (range) return range;
    const dates = [
      ...periodAll.map(t => t.date), ...feed.map(f => f.date), ...feedStock.map(e => e.date),
      ...medicineStock.map(e => e.date),
    ].filter(isDay).sort();
    return { key: '90D', from: dates[0] ?? todayISO(), to: todayISO(), days: 0 };
  }, [range, periodAll, feed, feedStock, medicineStock]);

  const acct = useMemo(() => computeFarmPnl({
    finance, batches, sheds, feed, feedStock, medicineStock, feedFormulas, range: dataRange,
  }), [finance, batches, sheds, feed, feedStock, medicineStock, feedFormulas, dataRange]);

  const gLedger = useMemo(() => godownLedger(feedStock, dataRange), [feedStock, dataRange]);
  const feedCost = useMemo(() => feedCostByShed(feed, feedStock, feedFormulas, dataRange), [feed, feedStock, feedFormulas, dataRange]);
  /** Every feeding unwound line by line at the average each draw was booked at — the shed's trace. */
  const traces = useMemo(() => feedExpenseTraces(feed, feedStock, feedFormulas, dataRange), [feed, feedStock, feedFormulas, dataRange]);
  const shortage = useMemo(() => allocateShortage(acct.shortageExpense, feedCost.rows, new Map(sheds.map(s => [s.id, s.name]))), [acct.shortageExpense, feedCost.rows, sheds]);
  const shortages = useMemo(() => shortageRows(feedStock, dataRange), [feedStock, dataRange]);

  /** The medicine store as an asset on the same basis as the godown: quantities stay per item. */
  const { valuation: medValuation } = useMedicineValuation();
  const medTotals = useMemo(() => medValuation.totals(todayISO()), [medValuation]);
  const role = users.find(u => u.id === sessionUser)?.role;
  const canOpenStore = !!role && MEDICINE_ROLES.includes(role);

  /* ---- payment layer: the very same ledger money, re-classified by how it moved ---- */

  /** Money in / money out split into cash, online, cheque, advance and "not recorded". */
  const flow = useMemo(() => cashFlowOf(finance, dataRange), [finance, dataRange]);
  /** The period's money grouped by the method named on each row. */
  const methods = useMemo(() => methodSummary(finance, dataRange), [finance, dataRange]);
  /** Who is holding the cash right now, derived from every row plus every handover. */
  const custody = useMemo(() => custodyOf(finance, cashHandovers, users), [finance, cashHandovers, users]);
  /** Expected cash for the period against the last physical count actually taken. */
  const recon = useMemo(() => reconcileCash(finance, dataRange, cashCounts), [finance, dataRange, cashCounts]);
  const nameOf = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users]);
  const people = useMemo(() => cashPeople(), [cashPeople, users]);
  /** Period entries that never said how the money moved — reported, never assumed. */
  const unrecorded = useMemo(() => acct.periodTxns.filter(t => !isClassified(t)), [acct.periodTxns]);
  const unrecordedSum = sum(unrecorded, t => t.amount);

  /* ---- payables and receivables: what the two ledgers are still owed ---- */

  const positions = usePurchasePositions();
  /** Receipts still owed — the only things a payment out may be linked to. */
  const openBuys = useMemo(() => positions.filter(p => p.status === 'PENDING' || p.status === 'PARTIAL'), [positions]);
  const payables = useMemo(() => payableTotals(positions), [positions]);
  /** What the credit bought and has not yet been consumed: both stores valued at their own averages. */
  const stockOnHand = (gLedger.asOfValue || 0) + (medTotals.value || 0);
  /** Money that left as a purchase payment but answers to no receipt on this farm. */
  const strays = useMemo(() => unlinkedPurchasePayments(finance, feedStock, medicineStock), [finance, feedStock, medicineStock]);
  const dues = useSalePositions();
  /** Billed to traders and still unpaid — the gap between income booked and money received. */
  const receivableTotal = useMemo(() => saleReceivableTotal(dues), [dues]);
  const openDues = useMemo(() => dues.filter(p => p.outstanding > 0).length, [dues]);
  const receivables = useMemo<Receivable[]>(() => {
    const traderName = new Map(traders.map(t => [t.id, t.name]));
    return dues.map(p => ({ position: p, traderName: traderName.get(p.entry.traderId) ?? 'Trader no longer on file' }));
  }, [dues, traders]);
  const recordedBy = (sessionUser ? nameOf.get(sessionUser) : undefined) ?? 'you';

  /** §8/§15 — a godown receipt or a trader load can arrive here already chosen. */
  useEffect(() => {
    const purchaseId = params.get('pay');
    const saleId = params.get('receive');
    if (!purchaseId && !saleId) return;
    setPayTarget(purchaseId
      ? { direction: 'pay_purchase', purchaseId }
      : { direction: 'receive_sale', saleId: saleId ?? undefined });
    setPayOpen(true);
    const rest = new URLSearchParams(params);
    rest.delete('pay');
    rest.delete('receive');
    setParams(rest, { replace: true });
  }, [params, setParams]);

  /** Batch Detail opens straight on that batch's own money, in one direction if asked. */
  useEffect(() => {
    const batchParam = params.get('batch');
    if (!batchParam) return;
    setBatchFilter(batchParam);
    setShedFilter('');
    setTab('ledger');
    const dir = params.get('dir');
    if (dir === 'in' || dir === 'out') setDirection(dir);
    const rest = new URLSearchParams(params);
    rest.delete('batch');
    rest.delete('dir');
    setParams(rest, { replace: true });
  }, [params, setParams]);

  function payPurchase(input: PurchasePaymentInput) {
    const r = recordPurchasePayment(input);
    if (r.ok) pushToast('success', `${fmtMoney(input.amount)} paid — the purchase it settles is unchanged`);
    return r;
  }

  function receiveSale(input: SalePaymentInput) {
    const r = recordSalePayment(input);
    if (r.ok) pushToast('success', `${fmtMoney(input.amount)} received — booked against that load, its billing untouched`);
    return r;
  }

  /** What the count sheet previews: the ledger's own cash at the date being counted. */
  const countExpected = cashPositionOf(finance, count.date || todayISO());
  const countDiff = Number(((parseFloat(count.physicalCash) || 0) - countExpected).toFixed(2));

  const batchShed = useMemo(() => new Map(batches.map(b => [b.id, b.shedId])), [batches]);
  const shedName = useMemo(() => new Map(sheds.map(s => [s.id, s.name])), [sheds]);
  const batchName = useMemo(() => new Map(batches.map(b => [b.id, b.code])), [batches]);

  /** Shared "Belongs to" choices for the add and map dialogs. */
  const targetOptions = useMemo(() => [
    { value: '', label: '— Pick a shed batch or the godown —' },
    { value: GODOWN_KEY, label: 'Godown — farm-wide stock & charges' },
    ...batches.map(b => ({ value: b.id, label: `${b.code} · ${shedName.get(batchShed.get(b.id) ?? '') ?? 'no shed'}` })),
  ], [batches, shedName, batchShed]);

  /** §5 expense breakdown: recorded operating categories plus the two derived costs. */
  const expenseRows = useMemo<HRow[]>(() => {
    const byCat = new Map<string, number>();
    for (const t of acct.periodTxns) {
      if (isInflow(t.kind) || isInventoryPurchase(t)) continue;
      byCat.set(t.category || 'Uncategorised', (byCat.get(t.category || 'Uncategorised') ?? 0) + t.amount);
    }
    const rows: HRow[] = [...byCat.entries()]
      .map(([label, value]) => ({ id: label, label, value, tone: 'danger' as const }));
    if (acct.feedExpense > 0) rows.push({
      id: 'feed', label: 'Feed consumed (from godown)', value: acct.feedExpense,
      sub: `derived from ${fmtIN(feedCost.rows.reduce((s, r) => s + r.tonnes, 0), 2)} t eaten — not a ledger row`,
      tone: 'danger',
    });
    if (acct.medicineExpense > 0) rows.push({
      id: 'medicine', label: 'Medicine drawn (from store)', value: acct.medicineExpense,
      sub: 'derived from the stock issued to the sheds, each row at the rate booked on it — not a ledger row',
      tone: 'danger',
    });
    if ((acct.shortageExpense ?? 0) > 0) rows.push({
      id: 'shortage', label: 'Shared godown shortage', value: acct.shortageExpense ?? 0,
      sub: 'stock loss spread over the sheds that ate', tone: 'warn',
    });
    const total = acct.totalExpense;
    const sorted = rows.sort((a, b) => b.value - a.value);
    return sorted.map(r => ({
      ...r,
      sub: r.sub ?? `${total > 0 ? Math.round((r.value / total) * 100) : 0}% of total expense`,
    }));
  }, [acct, feedCost.rows]);

  const revBreak = useMemo(() => revenueBreakdown(acct.periodTxns, dataRange), [acct.periodTxns, dataRange]);
  const trend = useMemo(() => pnlTrend(acct.periodTxns, pnlMode), [acct.periodTxns, pnlMode]);

  const activity = useMemo(() => {
    const counts = new Map<TxnKind, number>();
    for (const t of acct.periodTxns) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
    return KINDS.filter(k => (counts.get(k) ?? 0) > 0)
      .map(k => ({ kind: k, count: counts.get(k)!, sum: acct.periodTxns.filter(t => t.kind === k).reduce((s, t) => s + t.amount, 0) }));
  }, [acct.periodTxns]);

  /** §4 · the period's money entries, newest first — the raw material of the activity tab. */
  const recent = useMemo(() => latestFirst(acct.periodTxns), [acct.periodTxns]);

  /** Same rows, grouped by day so the activity tab reads as a statement, not a list. */
  const activityDays = useMemo(() => {
    const out: { date: string; rows: FinanceTxn[] }[] = [];
    for (const t of recent.slice(0, 40)) {
      const last = out[out.length - 1];
      if (last && last.date === t.date) last.rows.push(t);
      else out.push({ date: t.date, rows: [t] });
    }
    return out;
  }, [recent]);

  /** Profit bars: the shed comparison, red only ever meaning a loss. */
  const profitBars = acct.sheds.map(s => ({
    id: s.shedId, label: s.shedName, value: Number(s.profit.toFixed(2)),
    hint: `income ${short(s.income)} · expense ${short(s.totalExpense)}`,
    color: s.profit >= 0 ? SERIES_COLORS[0] : SERIES_COLORS[3],
  }));

  /* ---- ledger layer: the detailed list, its own filters ---- */

  const filtered = useMemo(() => {
    let l = latestFirst(finance);
    if (filter !== 'all') l = l.filter(x => x.kind === filter);
    if (direction !== 'all') l = l.filter(x => (direction === 'in' ? isInflow(x.kind) : !isInflow(x.kind)));
    if (channel !== 'all') l = l.filter(x => carriesChannel(x, channel));
    if (batchFilter === GODOWN_KEY) l = l.filter(x => x.godown);
    else if (batchFilter === UNMAPPED_KEY) l = l.filter(x => !x.batchId && !x.godown);
    else if (batchFilter) l = l.filter(x => x.batchId === batchFilter);
    if (shedFilter) l = l.filter(x => x.batchId && batchShed.get(x.batchId) === shedFilter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      l = l.filter(x => x.category.toLowerCase().includes(s)
        || (x.counterparty ?? '').toLowerCase().includes(s)
        || (x.remarks ?? '').toLowerCase().includes(s)
        || (x.reference ?? '').toLowerCase().includes(s));
    }
    return l;
  }, [finance, filter, direction, channel, batchFilter, shedFilter, q, batchShed]);

  if (!canView) {
    return (
      <Page withNav>
        <Header title="Finance" />
        <div className="px-4 sm:px-0 mt-3">
          <Card>
            <div className="flex items-start gap-3">
              <IconTile tone="danger"><ShieldAlert size={18} /></IconTile>
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-ink">Restricted access</p>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                  Financial data is hidden for your role. Contact the farm <strong className="text-ink-2">OWNER</strong> to request explicit finance permission.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </Page>
    );
  }

  function submit() {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return pushToast('error', 'Enter a valid amount');
    const isGodown = form.target === GODOWN_KEY;
    const r = addFinance({
      date: form.date, kind: form.kind, amount: amt, category: form.category,
      batchId: isGodown ? undefined : form.target || undefined,
      godown: isGodown ? true : undefined,
      counterparty: form.counterparty || undefined,
      remarks: form.remarks || undefined,
      ...paymentPatch(pay),
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Transaction recorded');
    setOpen(false);
    setForm({ date: todayISO(), kind: 'EXPENSE', amount: '', category: 'Feed Purchase', target: '', counterparty: '', remarks: '' });
    setPay(EMPTY_PAYMENT);
  }

  /** §12 — a payment correction is only kept with the reason that explains it. */
  function openFix(t: FinanceTxn) {
    setFixReason('');
    setFixPay(paymentDraftOf(t));
    setFixAmt(String(t.amount));
    setFixParty(t.counterparty ?? '');
    setFixTxn(t);
    setTxnDetail(null);
  }

  function saveFix() {
    if (!fixTxn) return;
    const amount = parseFloat(fixAmt);
    if (!amount || amount <= 0) return pushToast('error', 'Enter a valid amount');
    const r = updateFinance(fixTxn.id, {
      ...paymentPatch(fixPay),
      amount,
      counterparty: fixParty.trim() || undefined,
    }, fixReason);
    if (!r.ok) return pushToast('error', r.error ?? 'Could not correct this entry');
    pushToast('success', 'Entry corrected · audit written');
    setFixTxn(null);
  }

  /** §9 — cash moving between two people inside the farm; no ledger row, no money created. */
  function saveHandover() {
    const amt = parseFloat(handover.amount);
    if (!amt || amt <= 0) return pushToast('error', 'Enter the amount handed over');
    const r = addCashHandover({
      date: handover.date, time: handover.time || undefined, amount: amt,
      fromUserId: handover.fromUserId, toUserId: handover.toUserId,
      reason: handover.reason || undefined, reference: handover.reference.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not record the handover');
    pushToast('success', 'Cash handover recorded');
    setHandoverOpen(false);
    setHandover({ date: todayISO(), time: '', amount: '', fromUserId: '', toUserId: '', reason: '', reference: '' });
  }

  /** §10/§11 — the drawer's physical count. Expected comes from the ledger; the difference stands. */
  function saveCount() {
    const physical = parseFloat(count.physicalCash);
    const r = recordCashCount({ date: count.date, physicalCash: physical, remarks: count.remarks || undefined });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not record the count');
    pushToast('success', 'Cash count recorded');
    setCountOpen(false);
    setCount({ date: todayISO(), physicalCash: '', remarks: '' });
  }

  /** Re-points an existing ledger row at a shed (via its batch) or the godown. Amount untouched. */
  function saveMap() {
    if (!mapTxn) return;
    if (!mapTarget) return pushToast('error', 'Pick a shed batch or the godown');
    const isGodown = mapTarget === GODOWN_KEY;
    const r = assignFinance(mapTxn.id, isGodown ? { godown: true } : { batchId: mapTarget });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not map this entry');
    pushToast('success', isGodown ? 'Mapped to Godown' : 'Mapped to shed');
    setMapTxn(null);
  }

  const revDonut = revBreak.donut && revBreak.rows.length >= 2;
  /** Buys stock or livestock in — the ledger records the cash, the P&L does not expense it. */
  const isStockBuy = form.kind === 'PURCHASE' || INVENTORY_CATEGORIES.has(form.category);

  /** A shed row opens the ledger tab filtered to that shed's money. */
  const openShedLedger = (shedId: string) => {
    setShedFilter(shedId); setBatchFilter(''); setTab('ledger');
  };

  /** The one place a payment is written — optional target pre-selects the purchase or load. */
  const openPay = (target?: PaymentTarget) => { setPayTarget(target); setPayOpen(true); };

  /** The status of one receipt, said in the words the rest of the app uses. */
  const payableTone = (p: PurchasePosition) => (p.status === 'PAID' ? 'success' : p.status === 'PARTIAL' ? 'accent' : 'warn');

  /** The receipt a payment row settles, by its ledger id. */
  const buyById = new Map(positions.map(p => [p.entry.id, p]));

  /** A receipt opens in the store that raised it — the godown's ledger or the medicine ledger. */
  const openPurchaseRow = (entryId: string) => {
    const store = buyById.get(entryId)?.source === 'medicine' ? 'medicines' : 'feed';
    nav(`/${store}?tab=ledger&movement=${encodeURIComponent(entryId)}`);
  };

  /** The load a receipt row settles, named by the day it went out. */
  const linkedSaleDate = (saleId: string) => {
    const found = dues.find(d => d.entry.id === saleId);
    return found ? fmtDate(found.entry.date) : 'the sale voucher';
  };

  /** Where a row truly belongs: its shed via the batch, the godown, or honestly unmapped. */
  const linkOf = (t: FinanceTxn) => {
    if (t.batchId) {
      const shed = shedName.get(batchShed.get(t.batchId) ?? '');
      const batch = batchName.get(t.batchId);
      return [shed, batch].filter(Boolean).join(' / ') || 'Removed batch';
    }
    return t.godown ? 'Godown' : 'Unmapped';
  };

  /** Unmapped rows are the ones that still need a home — tap opens the mapping dialog. */
  const needsMap = (t: FinanceTxn) => canCreate && !t.batchId && !t.godown;
  const openMap = (t: FinanceTxn) => { setMapTarget(''); setMapTxn(t); };

  const detail = shedDetail ? acct.sheds.find(s => s.shedId === shedDetail) ?? null : null;
  const majorStock = gLedger.perIngredient.filter(r => r.closingKg > 0).slice(0, 4);
  const today = todayISO();

  const tabs = (
    <SegmentedTabs<FinTab> value={tab} onChange={setTab} options={[
      { value: 'overview', label: 'Overview', icon: <LayoutDashboard size={13} /> },
      { value: 'activity', label: 'Recent Activity', icon: <Activity size={13} /> },
      { value: 'ledger', label: 'Ledger', icon: <ScrollText size={13} /> },
    ]} scroll />
  );

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Commerce" title="Finance" subtitle="Farm P&L, shed performance and godown accounting"
        action={canView ? (
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<HandCoins size={14} />} onClick={() => openPay()}>Record Payment</Button>
            {canCreate && <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add</Button>}
          </div>
        ) : undefined} />

      <div className="px-4 sm:px-0 mt-3 space-y-5">
        {tabs}

        {tab !== 'ledger' && (
          /* period context row */
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Period</span>
              <span className="font-display text-[13px] font-semibold text-ink">{periodLabel[period]}</span>
              <span className="font-mono text-[11px] text-muted-2 tnum">{fmtDateShort(dataRange.from)}–{fmtDateShort(dataRange.to)}</span>
            </div>
            <GraphRange value={period} onChange={setPeriod} options={PERIODS} label="Period" />
          </div>
        )}

        {tab === 'overview' && (<>
        {/* 1 · FARM FINANCIAL SUMMARY — the accrual view, reconciled line by line */}
        <div className="space-y-3">
          <Band
            label="Realised in this period"
            note="What has actually happened between the dates above: money received, and expense the farm has carried. Feed and medicine count here the day a shed consumes them — buying a load is not spending it."
            right={<span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2 shrink-0">follows the period above</span>}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard label="Total income" value={money(acct.income)} foot={`${acct.periodTxns.filter(t => isInflow(t.kind)).length} credit ${acct.periodTxns.filter(t => isInflow(t.kind)).length === 1 ? 'entry' : 'entries'}`} tone="success" icon={<TrendingUp size={15} />} />
            <KpiCard label="Total expense" value={money(acct.totalExpense)} foot="Operating + feed consumed + shared godown" tone="danger" icon={<TrendingDown size={15} />} />
            <KpiCard label="Net profit" value={money(acct.net)} foot={acct.net >= 0 ? 'Surplus for this period' : 'Deficit for this period'} tone={acct.net >= 0 ? 'brand' : 'danger'} icon={<Scale size={15} />} />
          </div>

        {/* 1a · BALANCES — the two positions still open on the farm, in both directions.
            These are every open bill, so they deliberately ignore the period filter. */}
        <div className="rounded-[18px] border border-brand/25 bg-brand-soft/50 px-3.5 py-3.5 sm:px-4 sm:py-4 space-y-3 min-w-0">
          <Band
            label="Balances · still open"
            note="Not income and not expense — these are goods and money that have crossed but not settled. What suppliers are owed already sits in the godown and the medicine store as stock; what traders owe is loads already delivered. Nothing here repeats a figure from the row above."
            right={<span className="font-mono text-[9px] uppercase tracking-[0.12em] text-brand-ink shrink-0">all time · ignores the period</span>}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard label="Receivables outstanding" value={money(receivableTotal)}
              foot={`${openDues} of ${dues.length} ${dues.length === 1 ? 'bill' : 'bills'} owed to the farm`}
              tone={receivableTotal > 0 ? 'brand' : 'success'} icon={<ArrowDownLeft size={15} />} />
            <KpiCard label="Payables outstanding" value={money(payables.outstanding)}
              foot={`${payables.unpaidPurchases} of ${payables.purchases} ${payables.purchases === 1 ? 'receipt' : 'receipts'} unpaid${payables.unpriced ? ` · ${payables.unpriced} unpriced` : ''}`}
              tone={payables.outstanding > 0 ? 'danger' : 'success'} icon={<ArrowUpRight size={15} />} />
            <KpiCard label="Net position" value={money(receivableTotal - payables.outstanding)}
              foot={receivableTotal - payables.outstanding >= 0 ? 'Settles in the farm’s favour' : 'Settles against the farm'}
              tone={receivableTotal - payables.outstanding >= 0 ? 'brand' : 'danger'} icon={<ArrowLeftRight size={15} />} />
          </div>
          <p className="text-[11.5px] text-ink-2 leading-relaxed px-0.5">
            {payables.outstanding > 0
              ? <>The {money(payables.outstanding)} owed to suppliers is not a loss: {stockOnHand >= payables.outstanding
                  ? `${money(stockOnHand)} of feed and medicine stands on the shelves against it`
                  : `${money(stockOnHand)} still stands on the shelves, and the balance has already left as feed and medicine the sheds consumed`}.
                {' '}It enters the P&amp;L above only when a shed draws it, and paying it here moves cash without changing that P&amp;L again.
              </>
              : <>No supplier is waiting on the farm — every stock receipt on record is settled. </>}
            {receivableTotal > 0 && <>{' '}The {money(receivableTotal)} traders owe joins Total income only when its receipt is booked.</>}
          </p>
        </div>

          {/* 1b · MONEY IN / MONEY OUT BY HOW IT MOVED — same ledger money, never a second set of rows */}
          <Card>
            <SectionTitle right={<span className="font-mono text-[10px] text-muted">by method, not by guesswork</span>}>
              <span className="inline-flex items-center gap-1.5"><Banknote size={14} className="text-brand -mt-[1px]" />Cash &amp; online</span>
            </SectionTitle>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-[14px] border border-success/25 bg-success-soft/40 px-3.5 py-3 min-w-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-success">Money in · received</p>
                <div className="mt-2 space-y-1.5">
                  <ChannelRow inflow label="Cash received" hint="notes taken in hand" value={flow.in.cash} />
                  <ChannelRow inflow label="Online received" hint="UPI · PhonePe · NEFT · RTGS · bank" value={flow.in.online} />
                  <ChannelRow inflow label="Cheque received" value={flow.in.cheque} />
                  <ChannelRow inflow label="Advance adjusted" hint="money received earlier, adjusted now" value={flow.in.advance} />
                  <ChannelRow inflow label="Other method" value={flow.in.other} />
                  <ChannelRow inflow muted={flow.in.unrecorded === 0} label="Not recorded" hint="method never captured" value={flow.in.unrecorded} />
                </div>
                <div className="mt-2.5 pt-2 border-t border-success/25 flex items-baseline justify-between gap-2">
                  <span className="font-display text-[13.5px] font-semibold text-ink">Total received</span>
                  <span className="font-mono text-[17px] font-bold text-success tnum shrink-0">{money(flow.in.total)}</span>
                </div>
              </div>
              <div className="rounded-[14px] border border-danger/20 bg-danger-soft/35 px-3.5 py-3 min-w-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-danger">Money out · paid</p>
                <div className="mt-2 space-y-1.5">
                  <ChannelRow label="Cash paid" hint="notes handed over" value={flow.out.cash} />
                  <ChannelRow label="Online paid" hint="UPI · PhonePe · NEFT · RTGS · bank" value={flow.out.online} />
                  <ChannelRow label="Cheque paid" value={flow.out.cheque} />
                  <ChannelRow label="Advance adjusted" hint="adjustment against money paid earlier" value={flow.out.advance} />
                  <ChannelRow label="Other method" value={flow.out.other} />
                  <ChannelRow muted={flow.out.unrecorded === 0} label="Not recorded" hint="method never captured" value={flow.out.unrecorded} />
                </div>
                <div className="mt-2.5 pt-2 border-t border-danger/25 flex items-baseline justify-between gap-2">
                  <span className="font-display text-[13.5px] font-semibold text-ink">Total paid</span>
                  <span className="font-mono text-[17px] font-bold text-danger tnum shrink-0">{money(flow.out.total)}</span>
                </div>
              </div>
            </div>
            <p className="mt-2.5 font-mono text-[10px] text-muted leading-relaxed tnum">
              Every channel adds back to the ledger total — {money(flow.in.total)} in, {money(flow.out.total)} out — so splitting money by
              how it moved never changes what was earned or spent. Nothing is read out of remarks or a category: an entry that never said
              how it was paid sits under Not recorded.
            </p>
            <div className="mt-2.5">
              <UnclassifiedNote
                count={unrecorded.length}
                amount={unrecordedSum}
                onShow={canCreate ? () => { setChannel('unrecorded'); setTab('ledger'); } : undefined}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle right={<span className="font-mono text-[10px] text-muted">every number below comes from a record</span>}>
              <span className="inline-flex items-center gap-1.5"><Layers size={14} className="text-brand -mt-[1px]" />How the expense is built</span>
            </SectionTitle>
            <div className="mt-2.5 space-y-2">
              <AcctLine label="Direct shed expenses" hint={`operating money mapped to a shed · ${acct.sheds.reduce((s, r) => s + r.directCount, 0)} entries`} value={acct.sheds.reduce((s, r) => s + r.directExpense, 0)} />
              <AcctLine label="Feed consumed by sheds" hint="derived from godown issues — the stock actually eaten" value={acct.feedExpense} derived />
              <AcctLine label="Medicine drawn by sheds" hint="derived from store issues — valued at the shelf average of the day it left" value={acct.medicineExpense} derived />
              <AcctLine label="Shared godown expenses" hint={shortage.basis === 'feed' ? 'godown shortage + farm-level charges, spread to sheds' : 'godown charges held at farm level'} value={acct.godownOperatingExpense + acct.allocatedShortage} />
              {(acct.shortageExpense ?? 0) > 0 && shortage.basis === 'none' && (
                <AcctLine label="Godown shortage (unspread)" hint="no feed consumed to spread it against" value={acct.unallocatedShortage} />
              )}
              {acct.unallocatedExpense > 0 && (
                <AcctLine label="Not yet mapped" hint={`${acct.unallocatedCount} ${acct.unallocatedCount === 1 ? 'entry needs' : 'entries need'} a shed or the godown`} value={acct.unallocatedExpense} warn />
              )}
              <div className="h-px bg-line-2" />
              <AcctLine label="Total expense" hint="the figure in the summary above" value={acct.totalExpense} strong />
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <p className="text-[11px] text-muted leading-relaxed">
                Feed and chick purchases are <strong className="text-ink-2">stock, not expense</strong>: {money(acct.inventoryPurchase)} of purchases in this period sits in the godown
                (or in the birds) and is only expensed as the shed eats feed or the flock is sold. Buying it twice — once as purchase, once as consumption — would double-count.
              </p>
              <div className="rounded-[12px] bg-sunk px-3 py-2.5 min-w-0">
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-2">Money by payment method</p>
                {methods.length === 0 ? (
                  <p className="font-mono text-[10.5px] text-muted mt-1 leading-relaxed">Nothing in this period says how it was paid.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {methods.slice(0, 4).map(m => (
                      <div key={`${m.channel}:${m.method ?? '-'}`} className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-[11.5px] text-ink-2 truncate">{m.label}</span>
                        <span className="font-mono text-[11px] tnum shrink-0">
                          {m.received > 0 && <span className="text-success">+{short(m.received)}</span>}
                          {m.paid > 0 && <span className="text-danger ml-1.5">−{short(m.paid)}</span>}
                        </span>
                      </div>
                    ))}
                    {methods.length > 4 && <p className="font-mono text-[10px] text-muted">{methods.length - 4} more methods in the period.</p>}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* 2 · GODOWN CURRENT INVENTORY — an asset, never an expense */}
        <div className="rounded-[18px] border border-accent/35 bg-accent-soft/45 shadow-card overflow-hidden">
          <div className="px-4 py-3.5 border-b border-accent/25 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-accent-ink">Godown inventory · current stock value</p>
              <p className="font-display text-[26px] leading-9 font-semibold text-ink tnum tracking-tight mt-1">
                {gLedger.asOfValue > 0 ? money(gLedger.asOfValue) : 'Rates not on record'}
              </p>
              <p className="font-mono text-[10.5px] text-muted mt-0.5 tnum">
                {fmtIN(gLedger.asOfKg / 1000, 1)} MT across {gLedger.inStock} ingredient{gLedger.inStock === 1 ? '' : 's'} · an asset on the balance sheet, not a period expense
              </p>
            </div>
            <IconTile tone="accent" size={34}><Boxes size={17} /></IconTile>
          </div>
          <div className="px-4 py-3.5">
            {majorStock.length === 0 ? (
              <p className="text-[12px] text-muted">Nothing is standing in the godown right now.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                {majorStock.map(r => (
                  <div key={r.ingredient} className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-ink truncate">{r.ingredient}</p>
                    <p className="font-mono text-[11px] text-ink-2 tnum mt-0.5">{fmtIN(r.closingKg)} kg</p>
                    <p className="font-mono text-[10px] text-muted tnum">{r.avg === null ? 'no rate on record' : `${fmtMoney(r.avg, 2)}/kg · ${short(r.closingValue)}`}</p>
                  </div>
                ))}
              </div>
            )}
            {gLedger.unpricedKg > 0 && (
              <p className="mt-3 font-mono text-[10px] text-warn">{fmtIN(gLedger.unpricedKg)} kg carry no rate and are left out of the value, never priced at zero.</p>
            )}
            <div className="mt-3.5 pt-3 border-t border-accent/25 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2 inline-flex items-center gap-1">
                  <Pill size={11} />Medicine & vaccine store
                </p>
                <p className="font-mono text-[11.5px] text-ink-2 tnum mt-1">
                  {medTotals.value > 0 ? money(medTotals.value) : 'Rates not on record'}
                  {' · '}{medTotals.inStock} item{medTotals.inStock === 1 ? '' : 's'} held, each counted in its own unit
                </p>
                <p className="text-[10.5px] text-muted mt-0.5 leading-relaxed">
                  Valued the same weighted-average way as feed. It stands as stock until a shed draws it, so buying it
                  never reads as spending it.
                </p>
              </div>
              {canOpenStore && <Button size="sm" variant="outline" onClick={() => nav('/medicines')}>Open store</Button>}
            </div>
          </div>
        </div>

        {/* 2b · OUTSTANDING PAYABLES — stock already in the godown whose money has not gone out */}
        <Card>
          <SectionTitle right={<span className="font-mono text-[10px] text-muted">payments are recorded here, never in the godown</span>}>
            <span className="inline-flex items-center gap-1.5"><HandCoins size={14} className="text-brand -mt-[1px]" />Outstanding payables</span>
          </SectionTitle>

          {positions.length === 0 ? (
            <p className="text-[12px] text-muted mt-2.5">Nothing has been bought on credit yet — no godown or medicine receipt is open with a supplier.</p>
          ) : (
            <>
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                <Stat label="Purchases taken in" value={payables.value > 0 ? money(payables.value) : 'No rate on record'}
                  foot={`${payables.purchases} receipt${payables.purchases === 1 ? '' : 's'} — godown and medicine`} />
                <Stat label="Paid so far" value={money(payables.paid)} tone="success" foot="money that actually left" />
                <Stat label="Still outstanding" value={money(payables.outstanding)} tone={payables.outstanding > 0 ? 'danger' : 'ink'}
                  foot={`${payables.unpaidPurchases} ${payables.unpaidPurchases === 1 ? 'purchase' : 'purchases'} not settled`} />
                <Stat label="Suppliers owed" value={String(new Set(openBuys.map(p => p.supplier ?? UNSUPPLIED)).size)}
                  foot={openBuys.length ? 'tap a row to pay it down' : 'every purchase is settled'} />
              </div>

              {openBuys.length > 0 ? (
                <div className="mt-3 overflow-x-auto no-scrollbar -mx-1">
                  <table className="w-full min-w-[600px] text-[12.5px]">
                    <thead>
                      <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                        <th className="px-2 py-2 font-semibold">Supplier</th>
                        <th className="px-2 py-2 font-semibold">Purchase</th>
                        <th className="px-2 py-2 font-semibold text-right">Paid</th>
                        <th className="px-2 py-2 font-semibold text-right">Outstanding</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-2">
                      {openBuys.map(p => (
                        <tr key={p.entry.id} className="hover:bg-sunk/60 transition-colors">
                          <td className="px-2 py-2.5 min-w-0">
                            <span className="block font-semibold text-ink truncate">{p.supplier ?? UNSUPPLIED}</span>
                            <span className="block font-mono text-[9.5px] text-muted mt-0.5">
                              <button type="button" onClick={() => openPurchaseRow(p.entry.id)} className="underline press">
                                {p.entry.purchaseRef ?? 'open its ledger row'}
                              </button>
                              {' · '}{fmtDateShort(p.entry.date)}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 min-w-0">
                            <span className="block text-ink-2 truncate">{p.title} · {fmtIN(p.qtyKg)} {p.unit}</span>
                            <span className="block font-mono text-[9.5px] text-muted mt-0.5 tnum">
                              {p.value === null ? 'no receipt rate' : `${money(p.value)} purchase value`}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right font-mono tnum text-success">{p.paid ? short(p.paid) : '—'}</td>
                          <td className="px-2 py-2 text-right">
                            <span className="block font-mono tnum font-semibold text-danger">{p.outstanding === null ? '—' : short(p.outstanding)}</span>
                            <Badge tone={payableTone(p)} className="mt-0.5 !px-1.5 !py-0 !text-[8.5px]">
                              {p.status === 'PARTIAL' ? 'Part paid' : p.status === 'PENDING' ? 'Unpaid' : 'Paid'}
                            </Badge>
                          </td>
                          <td className="px-1 py-2.5 text-right whitespace-nowrap">
                            <button type="button" onClick={() => openPay({ direction: 'pay_purchase', purchaseId: p.entry.id })}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand press">
                              Pay <ChevronRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-[12px] text-muted">Every purchase on record is settled in full — no payment is waiting to be recorded.</p>
              )}

              <p className="mt-2.5 text-[11px] text-muted leading-relaxed">
                A purchase puts stock on the shelf; only a payment here moves money, and until one is recorded no cash or bank balance is
                reduced. {payables.unpriced > 0 && <span className="text-warn">{payables.unpriced} {payables.unpriced === 1 ? 'receipt carries' : 'receipts carry'} no rate, so they are counted in quantity and left out of these totals.</span>}
              </p>

              {strays.length > 0 && (
                <div className="mt-2 rounded-[12px] bg-warn-soft px-3 py-2.5">
                  <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-warn">Payments not linked to a purchase</p>
                  <p className="text-[11px] text-ink-2 mt-1 leading-relaxed">
                    {strays.length} {strays.length === 1 ? 'entry is' : 'entries are'} money out for stock that names no receipt on this farm
                    ({money(sum(strays, t => t.amount))} in this list). They reduce cash as recorded, but they settle no payable — open them in the
                    ledger to see what they were paid against.
                    <button type="button" onClick={() => { setFilter('PAYMENT_OUT'); setTab('ledger'); }} className="ml-1 font-semibold text-brand press underline">Show them</button>
                  </p>
                </div>
              )}
            </>
          )}
        </Card>

        {/* 3 · GODOWN LEDGER — how that position arose */}
        <Card>
          <SectionTitle right={<span className="font-mono text-[10px] text-muted">kg · physical movement</span>}>
            <span className="inline-flex items-center gap-1.5"><Warehouse size={14} className="text-brand -mt-[1px]" />Godown ledger</span>
          </SectionTitle>
          {gLedger.perIngredient.length === 0 ? (
            <p className="text-[12px] text-muted mt-2.5">No godown movements recorded for this period.</p>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto no-scrollbar -mx-1">
                <table className="w-full min-w-[620px] text-[12.5px]">
                  <thead>
                    <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                      <th className="px-2 py-2 font-semibold">Ingredient</th>
                      <th className="px-2 py-2 font-semibold text-right">Opening</th>
                      <th className="px-2 py-2 font-semibold text-right">In</th>
                      <th className="px-2 py-2 font-semibold text-right">Eaten</th>
                      <th className="px-2 py-2 font-semibold text-right">Out</th>
                      <th className="px-2 py-2 font-semibold text-right">Short</th>
                      <th className="px-2 py-2 font-semibold text-right">Closing</th>
                      <th className="px-2 py-2 font-semibold text-right">Avg ₹/kg</th>
                      <th className="px-2 py-2 font-semibold text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-2">
                    {gLedger.perIngredient.map(r => (
                      <tr key={r.ingredient}>
                        <td className="px-2 py-2 font-semibold text-ink truncate">{r.ingredient}</td>
                        <KgCell v={r.openingKg} /><KgCell v={r.receivedKg} /><KgCell v={r.consumedKg} /><KgCell v={r.feedOutKg} /><KgCell v={r.shortageKg} warn />
                        <td className={clsx('px-2 py-2 text-right font-mono tnum font-semibold', r.closingKg < 0 ? 'text-danger' : 'text-ink')}>{fmtIN(r.closingKg)}</td>
                        <td className="px-2 py-2 text-right font-mono tnum text-muted">{r.avg === null ? '—' : fmtMoney(r.avg, 2)}</td>
                        <td className="px-2 py-2 text-right font-mono tnum text-muted">{r.avg === null ? '—' : short(r.closingValue)}</td>
                      </tr>
                    ))}
                    <tr className="bg-sunk/60 font-semibold">
                      <td className="px-2 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">Total</td>
                      <KgCell v={gLedger.totals.openingKg} bold /><KgCell v={gLedger.totals.receivedKg} bold /><KgCell v={gLedger.totals.consumedKg} bold /><KgCell v={gLedger.totals.feedOutKg} bold /><KgCell v={gLedger.totals.shortageKg} bold warn />
                      <td className="px-2 py-2 text-right font-mono tnum font-bold text-ink">{fmtIN(gLedger.totals.closingKg)}</td>
                      <td />
                      <td className="px-2 py-2 text-right font-mono tnum font-bold text-brand">{short(gLedger.totals.closingValue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-muted leading-relaxed">
                Opening + in − eaten − out − short equals the closing stock on every row, so the shelf position is traceable line by line.
                Each eaten row is the same quantity that left the shelves and became that shed&rsquo;s feed expense below — one movement, recorded once.
                <strong className="text-ink-2"> Avg ₹/kg is the godown&rsquo;s weighted average</strong>: receipts re-weight it, stock leaving on top of it never does.
              </p>
            </>
          )}
        </Card>

        {/* 4 · INCOME & EXPENSE TREND (money ledger, cash timing) */}
        <GraphCard
          title="Income vs expense over time"
          subtitle={`${periodLabel[period]} · ${pnlMode === 'WEEK' ? 'weekly' : pnlMode === 'QUARTER' ? 'quarterly' : 'monthly'} money in against money out, as recorded`}
          height={220}
          actions={<GraphRange value={pnlMode} onChange={setPnlMode} options={[{ value: 'WEEK', label: 'Weekly' }, { value: 'MONTH', label: 'Monthly' }, { value: 'QUARTER', label: 'Quarterly' }]} label="Grouping" />}
          warnings={trend.warnings}
          empty={!trend.available ? {
            title: 'No financial data available for this period.',
            description: 'A bucket needs both money in and money out recorded before a net figure is honest. Nothing here is assumed.',
          } : undefined}
        >
          <PairedBars buckets={trend.buckets} format={v => `₹${axisNum(v)}`} height={200} />
        </GraphCard>

        {/* 5 · EXPENSE BREAKDOWN — reconciles to the farm total expense */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GraphCard
            title="Expense breakdown" height={170}
            subtitle="Categories recorded, plus the two costs derived from the godown"
            empty={expenseRows.length === 0 ? { title: 'No expenses in this period', description: 'Once expenses are recorded they are grouped here by category.' } : undefined}
          >
            <HBarList rows={expenseRows} format={v => `₹${axisNum(v)}`} caption={`Adds up to the total expense: ${money(acct.totalExpense)}`} />
          </GraphCard>

          <GraphCard
            title="Income breakdown" height={170}
            subtitle="Where the money came from · categories actually recorded"
            empty={revBreak.rows.length === 0 ? { title: 'No income in this period', description: 'Once money is received it is grouped here by category.' } : undefined}
          >
            {revDonut
              ? <DonutChart slices={revBreak.rows.map((r, i) => ({ label: r.label, value: r.value, color: SERIES_COLORS[i % SERIES_COLORS.length] }))} format={v => `₹${axisNum(v)}`} centerLabel="Income" />
              : <HBarList rows={revBreak.rows.map(r => ({ id: r.label, label: r.label, value: r.value, sub: r.share !== null ? `${Math.round(r.share * 100)}% of income` : undefined, tone: 'success' as const }))} format={v => `₹${axisNum(v)}`} caption={`Income: ${money(acct.income)}`} />}
          </GraphCard>
        </div>

        {/* 6 · SHED-WISE P&L — the comparison and the drill-down */}
        <Card>
          <SectionTitle right={<span className="font-mono text-[10px] text-muted">tap a shed for its P&amp;L and entries</span>}>Shed-wise profit and loss</SectionTitle>
          {acct.sheds.length === 0 ? (
            <p className="text-[12px] text-muted mt-2.5">No financial data available for this period.</p>
          ) : (
            <>
              <p className="text-[11px] text-muted mt-1 mb-3 leading-relaxed">
                Profit = shed income − its direct expenses − the feed its birds ate − its share of shared godown cost.
                Feed purchases stay in the godown, so a shed is never charged for stock still on the shelf.
              </p>
              {profitBars.length > 0 && (
                <div className="mb-3">
                  <BarSeries bars={profitBars} height={128} format={v => `₹${axisNum(v)}`} onPick={id => setShedDetail(id)} />
                </div>
              )}
              <div className="overflow-x-auto no-scrollbar -mx-1">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead>
                    <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                      <th className="px-2 py-2 font-semibold">Shed</th>
                      <th className="px-2 py-2 font-semibold text-right">Income</th>
                      <th className="px-2 py-2 font-semibold text-right">Direct</th>
                      <th className="px-2 py-2 font-semibold text-right">Feed</th>
                      <th className="px-2 py-2 font-semibold text-right">Shared</th>
                      <th className="px-2 py-2 font-semibold text-right">Profit</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-2">
                    {acct.sheds.map(s => (
                      <tr key={s.shedId} onClick={() => setShedDetail(s.shedId)} className="cursor-pointer hover:bg-sunk/60 transition-colors">
                        <td className="px-2 py-2.5 min-w-0">
                          <span className="block font-semibold text-ink truncate">{s.shedName}</span>
                          {s.hasFeed && <span className="block font-mono text-[9.5px] text-muted mt-0.5 tnum">{fmtIN(s.feedTonnes, 2)} t eaten{s.unpricedFeedKg > 0 ? ` · ${fmtIN(s.unpricedFeedKg)} kg unpriced` : ''}</span>}
                        </td>
                        <NumCell v={s.income} tone="success" /><NumCell v={s.directExpense} /><NumCell v={s.feedExpense} /><NumCell v={s.sharedExpense} />
                        <td className={clsx('px-2 py-2.5 text-right font-mono tnum font-semibold', s.profit >= 0 ? 'text-ink' : 'text-danger')}>{short(s.profit)}</td>
                        <td className="px-1 py-2.5"><ChevronRight size={14} className="text-faint" /></td>
                      </tr>
                    ))}
                    <tr className="bg-sunk/60">
                      <td className="px-2 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">All sheds</td>
                      <NumCell v={sum(acct.sheds, s => s.income)} tone="success" bold /><NumCell v={sum(acct.sheds, s => s.directExpense)} bold />
                      <NumCell v={sum(acct.sheds, s => s.feedExpense)} bold /><NumCell v={sum(acct.sheds, s => s.sharedExpense)} bold />
                      <td className="px-2 py-2 text-right font-mono tnum font-bold text-ink">{short(sum(acct.sheds, s => s.profit))}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-3 space-y-1.5">
                {acct.godownOperatingExpense > 0 && (
                  <p className="text-[11px] text-muted">
                    <strong className="text-ink-2">Held at godown / farm level:</strong> {money(acct.godownOperatingExpense)} of charges belong to the godown itself, so they are not pushed onto one shed.
                  </p>
                )}
                {acct.unallocatedCount > 0 && (
                  <p className="text-[11px] text-warn">
                    <strong>{money(acct.unallocatedExpense + acct.unallocatedIncome)}</strong> across {acct.unallocatedCount} {acct.unallocatedCount === 1 ? 'entry is' : 'entries are'} not mapped to a shed or the godown yet — they sit outside every shed figure below rather than being guessed in.
                    {canCreate && <button type="button" onClick={() => { setBatchFilter(UNMAPPED_KEY); setShedFilter(''); setTab('ledger'); }} className="ml-1 font-semibold text-brand press underline">Show them</button>}
                  </p>
                )}
                {acct.missingFormula && <p className="text-[11px] text-warn">Formula version unavailable for some feed — those days are left out of the feed expense.</p>}
              </div>
            </>
          )}
        </Card>

        {/* 7 · SHARED GODOWN EXPENSES — the shortage, visible and allocated exactly */}
        <Card>
          <SectionTitle right={(acct.shortageExpense ?? 0) > 0 ? <Badge tone="warn">Allocated to sheds</Badge> : <Badge tone="neutral">Nothing to share</Badge>}>
            <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} className="text-warn -mt-[1px]" />Godown stock shortage</span>
          </SectionTitle>
          {(acct.shortageExpense ?? 0) <= 0 && shortages.length === 0 ? (
            <p className="text-[12px] text-muted mt-2.5">No shortage was booked in this period — nothing is hidden inside a generic adjustment.</p>
          ) : (
            <>
              <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                <Badge tone="danger">Type · Shortage</Badge>
                <Badge tone="neutral">Location · Central godown</Badge>
                <Badge tone="warn">Direction · Expense</Badge>
              </p>
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                <Stat label="Shortage value" value={(acct.shortageExpense ?? 0) > 0 ? money(acct.shortageExpense ?? 0) : 'No rate on record'} tone="warn" foot={`${fmtIN(sum(shortages, r => r.kg))} kg across ${shortages.length} ${shortages.length === 1 ? 'booking' : 'bookings'}`} />
                <Stat label="Allocated to sheds" value={money(shortage.allocated)} foot={shortage.basis === 'feed' ? `spread over ${shortage.shares.length} shed${shortage.shares.length === 1 ? '' : 's'}` : 'cannot be spread honestly'} />
                <Stat label="Left at farm level" value={money(acct.unallocatedShortage)} tone={acct.unallocatedShortage > 0 ? 'warn' : 'ink'} foot={shortage.basis === 'none' ? 'no feed consumed as a basis' : 'nothing — the split is complete'} />
              </div>

              {shortages.length > 0 && (
                <div className="mt-3 overflow-x-auto no-scrollbar -mx-1">
                  <table className="w-full min-w-[480px] text-[12.5px]">
                    <thead>
                      <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                        <th className="px-2 py-2 font-semibold">Date</th>
                        <th className="px-2 py-2 font-semibold">Ingredient</th>
                        <th className="px-2 py-2 font-semibold text-right">Shortage</th>
                        <th className="px-2 py-2 font-semibold text-right">Avg ₹/kg</th>
                        <th className="px-2 py-2 font-semibold text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-2">
                      {shortages.map(r => (
                        <tr key={r.id}>
                          <td className="px-2 py-2 font-mono text-[11px] text-muted tnum whitespace-nowrap">{fmtDateShort(r.date)}</td>
                          <td className="px-2 py-2 font-semibold text-ink truncate">{r.ingredient}</td>
                          <td className="px-2 py-2 text-right font-mono tnum text-warn">{fmtIN(r.kg)} kg</td>
                          <td className="px-2 py-2 text-right font-mono tnum text-muted">{r.avg === null ? '—' : fmtMoney(r.avg, 2)}</td>
                          <td className="px-2 py-2 text-right font-mono tnum text-ink-2">{r.value === null ? 'no rate' : money(r.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-[10.5px] text-muted">A shortage is what the physical count came up short of the book — booked in the godown ledger as its own transaction type, out at that day&rsquo;s godown average, and never counted as any shed&rsquo;s feed.</p>
                </div>
              )}
              {acct.shortageUnpricedKg > 0 && (
                <p className="mt-2 text-[11px] text-warn">{fmtIN(acct.shortageUnpricedKg)} kg of shortage carry no rate — counted, excluded from the money total.</p>
              )}

              {shortage.shares.length > 0 && (
                <div className="mt-3 rounded-[12px] bg-sunk px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">Allocation basis · feed consumed</p>
                    <button type="button" onClick={() => setAllocOpen(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand press">View allocation <ChevronRight size={13} /></button>
                  </div>
                  <p className="text-[11px] text-muted mt-1 leading-relaxed tnum">
                    {money(shortage.allocated)} spread over {shortage.shares.length} {shortage.shares.length === 1 ? 'shed' : 'sheds'} in proportion to the feed each one ate —
                    equal to the shortage to the cent, nothing lost and nothing counted twice.
                  </p>
                </div>
              )}
            </>
          )}
        </Card>

        {/* financial flow + activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <SectionTitle right={<span className="font-mono text-[10px] text-muted">{periodLabel[period]}</span>}>
              <span className="inline-flex items-center gap-1.5"><ArrowLeftRight size={14} className="text-brand -mt-[1px]" />Money flow</span>
            </SectionTitle>
            <div className="mt-2.5 space-y-3">
              <div className="space-y-2">
                <FlowHeading icon={<Banknote size={12} />}>Cash flow</FlowHeading>
                <FlowRow label="Cash received" hint="notes taken in hand" value={flow.in.cash} tone="success" />
                <FlowRow label="Cash paid" hint="notes handed over" value={-flow.out.cash} tone="danger" />
                <FlowRow label="Cash net" hint="received − paid, in notes" value={flow.in.cash - flow.out.cash} tone={flow.in.cash - flow.out.cash >= 0 ? 'brand' : 'danger'} strong />
              </div>
              <div className="space-y-2">
                <FlowHeading icon={<Landmark size={12} />}>Online flow</FlowHeading>
                <FlowRow label="Online received" hint="UPI · PhonePe · bank transfers" value={flow.in.online} tone="success" />
                <FlowRow label="Online paid" hint="money that left an account" value={-flow.out.online} tone="danger" />
                <FlowRow label="Online net" hint="received − paid, in the bank" value={flow.in.online - flow.out.online} tone={flow.in.online - flow.out.online >= 0 ? 'brand' : 'danger'} strong />
              </div>
              <div className="space-y-2">
                <FlowHeading icon={<Scale size={12} />}>Total money flow</FlowHeading>
                <FlowRow label="Money in" hint="every credit entry in the period" value={flow.in.total} tone="success" />
                <FlowRow label="Money out" hint="every debit entry in the period" value={-flow.out.total} tone="danger" />
                <FlowRow label="Net movement" hint="the ledger's own cash position" value={acct.cashNet} tone={acct.cashNet >= 0 ? 'brand' : 'danger'} strong />
                <p className="text-[11px] text-muted pt-0.5">{money(acct.inventoryPurchase)} of that went into godown stock or chicks — an asset, so the P&amp;L above does not treat it as spend.</p>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle right={<span className="font-mono text-[11px] text-muted tnum">{acct.periodTxns.length} in period</span>}>Transaction activity</SectionTitle>
            {activity.length === 0 ? (
              <p className="text-[12px] text-muted mt-2.5">No transactions recorded for this period.</p>
            ) : (
              <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                {activity.map(a => {
                  const meta = KIND_META[a.kind];
                  const Icon = meta.icon;
                  return (
                    <div key={a.kind} className="flex items-center gap-2.5 min-w-0">
                      <IconTile tone={meta.inflow ? 'success' : 'danger'} size={28}><Icon size={14} /></IconTile>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-ink truncate">{meta.label}</p>
                        <p className="font-mono text-[10px] text-muted tnum">{a.count} · {money(a.sum)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* 8 · CASH IN HAND — who holds the notes, and how a day closes against the count */}
        <Card>
          <SectionTitle right={<span className="font-mono text-[10px] text-muted">derived, never typed in</span>}>
            <span className="inline-flex items-center gap-1.5"><UserRound size={14} className="text-brand -mt-[1px]" />Cash in hand &amp; custody</span>
          </SectionTitle>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <Stat label="Cash position" value={amt(custody.total)} tone={custody.total < 0 ? 'danger' : 'ink'} foot="every cash entry, all time" />
            <Stat label="With our people" value={amt(custody.total - custody.unassigned)} foot={`${custody.byCustodian.length} named ${custody.byCustodian.length === 1 ? 'custodian' : 'custodians'}`} />
            <Stat label="No custodian on record" value={amt(custody.unassigned)} tone={custody.unassigned === 0 ? 'ink' : 'warn'} foot="part of the position above" />
            <Stat label="Expected now" value={amt(recon.expected)} foot="opening + cash in − cash out" />
          </div>

          {custody.byCustodian.length === 0 ? (
            <p className="mt-3 text-[12px] text-muted leading-relaxed">
              Nobody has been named against a cash movement yet, so the whole position above stands unassigned. Recording who received or paid
              each cash entry is what answers a dispute later.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto no-scrollbar -mx-1">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead>
                  <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                    <th className="px-2 py-2 font-semibold">Person</th>
                    <th className="px-2 py-2 font-semibold text-right">Cash taken in</th>
                    <th className="px-2 py-2 font-semibold text-right">Cash paid out</th>
                    <th className="px-2 py-2 font-semibold text-right">Handed on</th>
                    <th className="px-2 py-2 font-semibold text-right">Took over</th>
                    <th className="px-2 py-2 font-semibold text-right">In hand</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {custody.byCustodian.map(c => (
                    <tr key={c.userId}>
                      <td className="px-2 py-2 font-semibold text-ink truncate">{c.name}</td>
                      <td className="px-2 py-2 text-right font-mono tnum text-success">{c.received ? short(c.received) : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono tnum text-danger">{c.paidOut ? short(c.paidOut) : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono tnum text-muted">{c.handedAway ? short(c.handedAway) : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono tnum text-muted">{c.handedIn ? short(c.handedIn) : '—'}</td>
                      <td className={clsx('px-2 py-2 text-right font-mono tnum font-semibold', c.inHand < 0 ? 'text-danger' : 'text-ink')}>{amt(c.inHand)}</td>
                    </tr>
                  ))}
                  {custody.unassigned !== 0 && (
                    <tr className="bg-sunk/60">
                      <td className="px-2 py-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">No custodian recorded</td>
                      <td className="px-2 py-2 text-right font-mono tnum text-muted">{custody.unassignedReceived ? short(custody.unassignedReceived) : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono tnum text-muted">{custody.unassignedPaid ? short(custody.unassignedPaid) : '—'}</td>
                      <td colSpan={2} />
                      <td className="px-2 py-2 text-right font-mono tnum font-bold text-warn">{amt(custody.unassigned)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="mt-1.5 text-[10.5px] text-muted">
                A negative balance beside a person means cash left their hands that was never handed to them on record — the missing handover
                below, not a smoothed-over number. Named custodians plus the unrecorded remainder equal the position above.
              </p>
            </div>
          )}

          {/* the reconciliation: expected against what was actually counted */}
          <div className="mt-3 rounded-[12px] bg-sunk px-3 py-2.5">
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">
              Cash reconciliation · {fmtDateShort(recon.from)}–{fmtDateShort(recon.to)}
            </p>
            <div className="mt-1">
              <Row label="Opening cash before this period" value={amt(recon.opening)} />
              <Row label="Cash received in this period" value={`+ ${money(recon.received)}`} success />
              <Row label="Cash paid out in this period" value={`− ${money(recon.paid)}`} danger />
              <Row label="Expected in hand" value={amt(recon.expected)} valueClass="text-[15px] font-bold text-ink" />
              <Row
                label={recon.count ? `Counted on ${fmtDateShort(recon.count.date)}` : 'Physically counted'}
                value={recon.count ? `${amt(recon.count.physicalCash)} by ${nameOf.get(recon.count.closedById) ?? 'removed user'}` : 'No count on record'}
                mono={false}
              />
              {recon.count && (
                <Row
                  label={recon.count.difference === 0 ? 'Difference' : 'Difference to explain'}
                  value={amt(recon.count.difference)}
                  valueClass={recon.count.difference === 0 ? 'text-success' : 'text-warn text-[15px] font-bold'}
                />
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted leading-relaxed">
              A count only records what was in hand. A difference stays on record until the transaction that explains it is booked —
              the balance is never adjusted to match the count.
              {recon.unrecorded !== 0 && <span className="text-warn"> {amt(recon.unrecorded)} of this period&rsquo;s money has no channel on record, so the expected figure is a cash-only floor.</span>}
            </p>
            {recon.openDifferences.length > 1 && (
              <p className="mt-1.5 font-mono text-[10px] text-warn">
                {recon.openDifferences.length} counts still differ from the book · latest {fmtDateShort(recon.openDifferences[0].date)}.
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon={<ClipboardCheck size={13} />} onClick={() => setCountOpen(true)}>Count the cash</Button>
              <Button size="sm" variant="ghost" icon={<ArrowLeftRight size={13} />} onClick={() => setHandoverOpen(true)}>Hand cash over</Button>
            </div>
          </div>

          {cashHandovers.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">Cash passed between our people</p>
              <p className="text-[10.5px] text-muted mt-0.5 mb-1.5">Custody only — these move no money and never appear in the P&amp;L.</p>
              <GroupList>
                {latestFirst(cashHandovers).slice(0, 5).map(h => (
                  <ListRow
                    key={h.id}
                    leading={<IconTile tone="neutral" size={30}><HandCoins size={14} /></IconTile>}
                    title={`${nameOf.get(h.fromUserId) ?? 'Removed user'} → ${nameOf.get(h.toUserId) ?? 'Removed user'}`}
                    subtitle={<span className="font-mono text-[10.5px]">{fmtDate(h.date)}{h.time ? ` · ${h.time}` : ''}{h.reason ? ` · ${h.reason}` : ''}</span>}
                    trailing={<span className="font-mono tnum font-semibold text-ink shrink-0">{money(h.amount)}</span>}
                  />
                ))}
              </GroupList>
              {cashHandovers.length > 5 && <p className="mt-1 font-mono text-[10px] text-muted">{cashHandovers.length - 5} earlier handovers on record.</p>}
            </div>
          )}
        </Card>

        </>)}

        {/* RECENT ACTIVITY · the period's entries, newest day first, one tap opens the entry */}
        {tab === 'activity' && (
          <div className="space-y-3">
            <SectionTitle right={<span className="font-mono text-[11px] text-muted tnum">{recent.length} in this period</span>}>
              Recent activity
            </SectionTitle>
            {activityDays.length === 0 ? (
              <EmptyState icon={<Wallet size={22} />} title="No activity in this period"
                description="Money entries recorded in the selected period appear here, newest day first." />
            ) : (
              <>
                <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
                  {activityDays.map(g => (
                    <div key={g.date}>
                      <LedgerDayHeader date={g.date} today={today} count={g.rows.length} />
                      <div className="divide-y divide-line-2">
                        {g.rows.map(t => <TxnRow key={t.id} t={t} dense link={linkOf(t)} onOpen={() => setTxnDetail(t)} />)}
                      </div>
                    </div>
                  ))}
                </div>
                {recent.length > 40 && (
                  <p className="text-[11px] text-muted px-1">
                    The 40 newest of {recent.length} entries in this period.
                    <button type="button" onClick={() => setTab('ledger')} className="ml-1 font-semibold text-brand press underline">Open the ledger for all of them</button>
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* LEDGER · every money entry, searched and filtered, each one openable */}
        {tab === 'ledger' && (
          <div className="space-y-3">
            <SectionTitle right={<span className="font-mono text-[11px] text-muted tnum">{filtered.length} shown</span>}>Financial ledger</SectionTitle>
            <SearchField value={q} onChange={setQ} placeholder="Search category, party, receipt no. or remarks" />
            <ChipRow
              label="Type"
              value={filter}
              onChange={v => setFilter(v as typeof filter)}
              options={[{ value: 'all', label: 'All' }, ...KINDS.map(k => ({ value: k as string, label: KIND_META[k].short }))]}
            />
            {/* §16 — the money-movement filters, scrollable so a phone never widens the page */}
            <ChipRow label="Method" value={channel} onChange={v => setChannel(v as typeof channel)} options={CHANNEL_FILTERS} />
            <ChipRow label="Direction" value={direction} onChange={v => setDirection(v as typeof direction)} options={DIRECTION_FILTERS} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <SelectField value={shedFilter} onChange={e => setShedFilter(e.target.value)}
                options={[{ value: '', label: 'All sheds' }, ...sheds.map(s => ({ value: s.id, label: s.name }))]} />
              <SelectField value={batchFilter} onChange={e => setBatchFilter(e.target.value)}
                options={[
                  { value: '', label: 'All batches' },
                  { value: GODOWN_KEY, label: 'Godown rows' },
                  { value: UNMAPPED_KEY, label: 'Unmapped rows' },
                  ...batches.map(b => ({ value: b.id, label: b.code })),
                ]} />
            </div>
            {(shedFilter || batchFilter || filter !== 'all' || channel !== 'all' || direction !== 'all' || q.trim()) && (
              <button type="button" onClick={() => { setShedFilter(''); setBatchFilter(''); setFilter('all'); setChannel('all'); setDirection('all'); setQ(''); }}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand press">
                <Search size={13} /> Clear filters
              </button>
            )}

            {filtered.length === 0 ? (
              <EmptyState icon={<Wallet size={22} />} title="No transactions" description="Finance entries matching these filters will appear here." />
            ) : (
              <GroupList>
                {filtered.slice(0, 50).map(t => <TxnRow key={t.id} t={t} dense link={linkOf(t)} onOpen={() => setTxnDetail(t)} />)}
              </GroupList>
            )}
            {filtered.length > 50 && <p className="text-[11px] text-muted px-1">Showing the 50 most recent of {filtered.length}. Narrow the filters to see more.</p>}
          </div>
        )}
      </div>

      {/* shed drill-down */}
      <Dialog open={detail !== null} onClose={() => setShedDetail(null)} title={detail ? `Shed P&L · ${detail.shedName}` : 'Shed P&L'}
        subtitle={detail ? `${periodLabel[period]} · income ${money(detail.income)} · profit ${money(detail.profit)}` : undefined}
        footer={<Button block variant="outline" onClick={() => { if (detail) openShedLedger(detail.shedId); setShedDetail(null); }}>Open its ledger entries</Button>}>
        {detail && <ShedDetail detail={detail} txns={acct.periodTxns.filter(t => t.batchId && batchShed.get(t.batchId) === detail.shedId)} feedRows={traces.filter(t => t.shedId === detail.shedId)} />}
      </Dialog>

      {/* shortage allocation */}
      <Dialog open={allocOpen} onClose={() => setAllocOpen(false)} title="Shortage allocation"
        subtitle={acct.shortageExpense ? `${money(acct.shortageExpense)} spread by feed consumed` : undefined}
        footer={<Button block variant="outline" onClick={() => setAllocOpen(false)}>Close</Button>}>
        <div className="space-y-2.5">
          <p className="text-[11.5px] text-muted leading-relaxed">
            The basis is the feed each shed actually consumed in this period, valued at godown rates. Nothing else is invented,
            and the shares add back to the shortage exactly — the last shed absorbs the rounding residual.
          </p>
          {shortage.shares.map(s => (
            <div key={s.shedId} className="rounded-[12px] bg-sunk px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink truncate">{s.shedName}</p>
                <p className="font-mono text-[10px] text-muted tnum mt-0.5">{Math.round(s.weight * 1000) / 10}% of the feed eaten</p>
              </div>
              <span className="font-mono text-[14px] font-semibold text-ink tnum shrink-0">{money(s.amount)}</span>
            </div>
          ))}
          <div className="h-px bg-line-2" />
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Allocated total</span>
            <span className="font-mono text-[14px] font-bold text-brand tnum">{money(shortage.allocated)}</span>
          </div>
        </div>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add Transaction" subtitle="Record income or expense, and how its money moved"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as TxnKind }))}
            options={KINDS.map(k => ({ value: k, label: k.replace('_', ' ') }))} />
          <div className="flex items-center gap-2">
            <Badge tone={isInflow(form.kind) ? 'success' : 'danger'}>{isInflow(form.kind) ? 'Money in' : 'Money out'}</Badge>
            {isStockBuy && <Badge tone="accent">Stock · not a period expense</Badge>}
          </div>
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Field label="Amount (₹)" type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="font-mono" />
          <SelectField label="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            options={FINANCE_CATEGORIES.map(c => ({ value: c, label: c }))} />
          <SelectField label="Belongs to" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
            options={targetOptions} />
          <p className="-mt-2 text-[11px] text-muted">Every expense and income should land on a shed (via its batch) or on the godown itself. Anything left unmapped is shown as Unmapped and stays out of the shed figures.</p>
          <Field label="Counterparty" value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} placeholder="Trader / supplier name" />
          <PaymentFields
            draft={pay}
            onChange={patch => setPay(d => ({ ...d, ...patch }))}
            inflow={isInflow(form.kind)}
            people={people}
            onReceiptNo={() => setPay(d => ({ ...d, reference: nextCashReceiptNo(form.date) }))}
          />
          <p className="text-[11px] text-muted leading-relaxed">
            Recorded by <strong className="text-ink-2">{nameOf.get(sessionUser ?? '') ?? 'you'}</strong> — the person who physically held
            the cash is asked for separately above, because the two are often different people.
          </p>
          <TextArea label="Remarks" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>

      <Dialog open={mapTxn !== null} onClose={() => setMapTxn(null)} title="Map transaction"
        subtitle={mapTxn ? `${mapTxn.category} · ${money(mapTxn.amount)} · ${fmtDate(mapTxn.date)}` : undefined}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setMapTxn(null)}>Cancel</Button><Button block onClick={saveMap}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Belongs to" value={mapTarget} onChange={e => setMapTarget(e.target.value)} options={targetOptions} />
          <p className="text-[11px] text-muted">Mapping only records where this entry belongs — the amount is never changed.</p>
        </div>
      </Dialog>
      {/* §12 — a correction to money or custody is kept together with the reason for it */}
      <Dialog open={fixTxn !== null} onClose={() => setFixTxn(null)} title="Correct this entry"
        subtitle={fixTxn ? `${fixTxn.category} · ${money(fixTxn.amount)} · ${fmtDate(fixTxn.date)}` : undefined}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setFixTxn(null)}>Cancel</Button><Button block onClick={saveFix}>Save correction</Button></div>}>
        {fixTxn && (
          <div className="space-y-3">
            <p className="text-[11.5px] text-muted leading-relaxed">
              Who held the cash, how it was paid and its reference are what a dispute turns on. Each of those — and the amount or
              counterparty, if they change too — is written to the audit trail with old value, new value, who changed it and why.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Amount (₹)" type="number" inputMode="decimal" value={fixAmt} onChange={e => setFixAmt(e.target.value)} className="font-mono" />
              <Field label="Counterparty" value={fixParty} onChange={e => setFixParty(e.target.value)} placeholder="Trader / supplier name" />
            </div>
            <PaymentFields
              draft={fixPay}
              onChange={patch => setFixPay(d => ({ ...d, ...patch }))}
              inflow={isInflow(fixTxn.kind)}
              people={people}
              heading="Payment & custody"
              onReceiptNo={() => setFixPay(d => ({ ...d, reference: nextCashReceiptNo(fixTxn.date) }))}
            />
            <TextArea label="Reason for the correction" rows={2} value={fixReason} onChange={e => setFixReason(e.target.value)}
              placeholder="e.g. the cash was held by the supervisor, not the manager" />
          </div>
        )}
      </Dialog>

      {/* §9 — custody passes between two people; no money moves, so no ledger row is written */}
      <Dialog open={handoverOpen} onClose={() => setHandoverOpen(false)} title="Hand cash over"
        subtitle="Who holds the money now — not a transaction"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setHandoverOpen(false)}>Cancel</Button><Button block onClick={saveHandover}>Record handover</Button></div>}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date" type="date" value={handover.date} onChange={e => setHandover(h => ({ ...h, date: e.target.value }))} />
            <Field label="Time" type="time" value={handover.time} onChange={e => setHandover(h => ({ ...h, time: e.target.value }))} />
          </div>
          <Field label="Amount handed over (₹)" type="number" inputMode="decimal" value={handover.amount}
            onChange={e => setHandover(h => ({ ...h, amount: e.target.value }))} placeholder="0.00" className="font-mono" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label="From" value={handover.fromUserId} onChange={e => setHandover(h => ({ ...h, fromUserId: e.target.value }))}
              options={[{ value: '', label: '— Who gave the cash —' }, ...people.map(p => ({ value: p.id, label: p.name }))]} />
            <SelectField label="To" value={handover.toUserId} onChange={e => setHandover(h => ({ ...h, toUserId: e.target.value }))}
              options={[{ value: '', label: '— Who took it —' }, ...people.map(p => ({ value: p.id, label: p.name }))]} />
          </div>
          <Field label="Reason" value={handover.reason} onChange={e => setHandover(h => ({ ...h, reason: e.target.value }))}
            placeholder="Collection deposit, change float, wage payout" />
          <Field label="Reference" value={handover.reference} onChange={e => setHandover(h => ({ ...h, reference: e.target.value }))}
            placeholder="Optional slip or note number" className="font-mono text-[13px]"
            suffix={<button type="button" onClick={() => setHandover(h => ({ ...h, reference: nextCashReceiptNo(h.date) }))}
              className="text-[11px] font-semibold text-brand press whitespace-nowrap">Next no.</button>} />
          <p className="text-[11.5px] text-muted leading-relaxed">
            A handover changes custody, never the cash position: the money was already the farm&rsquo;s. That is why it does not appear in
            the P&amp;L or the ledger above — it only says whose drawer it is sitting in.
          </p>
        </div>
      </Dialog>

      {/* §10/§11 — the drawer is counted; the expected figure is read off the ledger, never typed */}
      <Dialog open={countOpen} onClose={() => setCountOpen(false)} title="Count the cash"
        subtitle="What is physically in hand on a date"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setCountOpen(false)}>Cancel</Button><Button block onClick={saveCount}>Save count</Button></div>}>
        <div className="space-y-3">
          <Field label="Date counted" type="date" value={count.date} onChange={e => setCount(c => ({ ...c, date: e.target.value }))} />
          <Field label="Cash counted (₹)" type="number" inputMode="decimal" value={count.physicalCash}
            onChange={e => setCount(c => ({ ...c, physicalCash: e.target.value }))} placeholder="0.00" className="font-mono"
            hint="Enter exactly what is in hand, including notes in a safe. Zero is a valid count." />
          <div className="rounded-[12px] bg-sunk px-3 py-2.5">
            <Row label="Expected from the ledger" value={amt(countExpected)} />
            <Row label="Difference" value={amt(countDiff)} mono danger={countDiff !== 0} />
          </div>
          <TextArea label="Remarks" rows={2} value={count.remarks} onChange={e => setCount(c => ({ ...c, remarks: e.target.value }))}
            placeholder="What explains the difference, if there is one" />
          <p className="text-[11.5px] text-muted leading-relaxed">
            The balance is never adjusted to match a count. A difference stands on record until the entry that explains it is booked,
            and re-counting a locked day takes the Owner&rsquo;s unlock.
          </p>
        </div>
      </Dialog>

      {/* one entry, opened: what it was, where it belongs and what it did to the money */}
      {/* the payment workflow — Finance's own, entered from here or from a ledger row */}
      {payOpen && (
        <RecordPaymentDialog open onClose={() => setPayOpen(false)} target={payTarget}
          purchases={positions} receivables={receivables} people={people} recordedBy={recordedBy}
          nextReceiptNo={(d) => nextCashReceiptNo(d)}
          onPayPurchase={payPurchase} onReceiveSale={receiveSale} />
      )}

      <Dialog open={txnDetail !== null} onClose={() => setTxnDetail(null)} title={txnDetail?.category ?? 'Transaction'}
        subtitle={txnDetail ? `${KIND_META[txnDetail.kind].label} · ${fmtDate(txnDetail.date)}` : undefined}
        footer={txnDetail && needsMap(txnDetail) ? (
          <div className="flex gap-2">
            <Button variant="outline" block onClick={() => setTxnDetail(null)}>Close</Button>
            <Button block onClick={() => { const t = txnDetail; setTxnDetail(null); openMap(t); }}>Map to shed or godown</Button>
          </div>
        ) : txnDetail && canCreate && !txnDetail.refId ? (
          <div className="flex gap-2">
            <Button variant="outline" block onClick={() => setTxnDetail(null)}>Close</Button>
            <Button block variant="ghost" onClick={() => openFix(txnDetail)}>Correct payment</Button>
          </div>
        ) : <Button block variant="outline" onClick={() => setTxnDetail(null)}>Close</Button>}>
        {txnDetail && (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 rounded-[14px] bg-sunk px-3 py-2.5 mb-2">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">
                {isInflow(txnDetail.kind) ? 'Money in' : 'Money out'}
              </p>
              <p className={clsx('font-display text-[22px] leading-7 font-semibold tnum', isInflow(txnDetail.kind) ? 'text-success' : 'text-danger')}>
                {isInflow(txnDetail.kind) ? '+' : '−'}{money(txnDetail.amount)}
              </p>
            </div>
            <Row label="Type" value={KIND_META[txnDetail.kind].label} mono={false} />
            <Row label="Date" value={fmtDate(txnDetail.date)} />
            <Row label="Category" value={txnDetail.category} mono={false} />
            <Row label="Counterparty" value={txnDetail.counterparty || '—'} mono={false} />
            <Row label="Belongs to" value={linkOf(txnDetail)} mono={false} />
            {txnDetail.purchaseId && (
              <Row label="Settles purchase" mono={false} value={(
                <button type="button" onClick={() => openPurchaseRow(txnDetail.purchaseId!)} className="text-brand press underline">
                  {buyById.get(txnDetail.purchaseId)?.entry.purchaseRef ?? 'the stock receipt'}
                </button>
              )} />
            )}
            {txnDetail.saleId && (
              <Row label="Receipt for load" mono={false} value={(
                <button type="button" onClick={() => nav(`/sales/entry/${txnDetail.saleId}`)} className="text-brand press underline">
                  {linkedSaleDate(txnDetail.saleId)}
                </button>
              )} />
            )}
            <div className="py-1.5">
              <AccountabilityDetail row={txnDetail} inflow={isInflow(txnDetail.kind)} nameOf={id => (id ? nameOf.get(id) : undefined) ?? '—'} />
            </div>
            <Row label="Remarks" value={txnDetail.remarks || '—'} mono={false} />
            {txnDetail.refId && <Row label="Voucher" value={txnDetail.refId} />}
            <Row label="Ledger id" value={txnDetail.id} />
            <Row label="Recorded" value={`${fmtDate(txnDetail.createdAt.slice(0, 10))}, ${txnDetail.createdAt.slice(11, 16)}`} mono={false} />
            {txnDetail.refId && (
              <p className="pt-2 text-[11.5px] text-muted leading-relaxed">
                This row was written by a sale voucher, so its payment details are corrected on that voucher — not here.
              </p>
            )}
            {txnDetail.purchaseId && (
              <p className="pt-2 text-[12px] text-muted leading-relaxed">
                This row is only the money: the stock was already on the shelf when the godown booked it, so the purchase is never expensed twice
                and its value stays as it was recorded.
              </p>
            )}
            {!txnDetail.purchaseId && isInventoryPurchase(txnDetail) && (
              <p className="pt-2 text-[12px] text-muted leading-relaxed">
                This bought stock or birds, so it is an asset: the money left the farm, the P&amp;L waits until the shed eats it or the flock is sold.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </Page>
  );
}

/* ============================= HELPERS ============================= */

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

const money = (v: number) => fmtMoney(v);
const short = (v: number) => `₹${axisNum(v)}`;
/** Money that may be negative — a minus always leads the rupee, never sits inside it. */
const amt = (v: number) => (v < 0 ? `−${fmtMoney(Math.abs(v))}` : fmtMoney(v));

/** One channel's share of the period's money in or out. Zero rows stay quiet but counted. */
function ChannelRow({ label, hint, value, inflow, muted }: {
  label: string; hint?: string; value: number; inflow?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <p className={clsx('text-[12.5px] font-semibold truncate', muted ? 'text-muted' : 'text-ink')}>{label}</p>
        {hint && <p className="font-mono text-[9.5px] text-muted-2 truncate">{hint}</p>}
      </div>
      <span className={clsx('font-mono text-[13.5px] font-semibold tnum shrink-0',
        muted || !value ? 'text-muted-2' : inflow ? 'text-success' : 'text-danger')}>
        {value ? amt(value) : '—'}
      </span>
    </div>
  );
}

/** A channel's own heading inside the money-flow card — distinct by label, not by colour. */
function FlowHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-2">
      <span className="text-brand">{icon}</span>{children}
    </p>
  );
}

/** A horizontally scrollable filter row: a phone scrolls it, the page never widens. */
function ChipRow<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5" role="group" aria-label={label}>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2">{label}</span>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={active}
            className={clsx('shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold press',
              active ? 'bg-brand text-white shadow-card' : 'bg-sunk text-ink hover:bg-brand-soft hover:text-brand')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function sum<T>(rows: T[], pick: (r: T) => number): number {
  let s = 0;
  for (const r of rows) s += pick(r);
  return Number(s.toFixed(2));
}

function KgCell({ v, bold, warn }: { v: number; bold?: boolean; warn?: boolean }) {
  return (
    <td className={clsx('px-2 py-2 text-right font-mono tnum',
      bold ? 'font-bold text-ink' : 'text-ink-2',
      warn && v !== 0 ? 'text-warn' : v < 0 ? 'text-danger' : '')}>
      {v === 0 ? '—' : fmtIN(v)}
    </td>
  );
}

function NumCell({ v, tone, bold }: { v: number; tone?: 'success' | 'ink'; bold?: boolean }) {
  return (
    <td className={clsx('px-2 py-2.5 text-right font-mono tnum', bold ? 'font-bold' : '',
      tone === 'success' ? 'text-success' : 'text-ink-2')}>
      {v ? `₹${axisNum(v)}` : '—'}
    </td>
  );
}

function AcctLine({ label, hint, value, strong, derived, warn }: {
  label: string; hint: string; value: number; strong?: boolean; derived?: boolean; warn?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <p className={clsx('font-display font-semibold text-ink truncate', strong ? 'text-[15px]' : 'text-[13px]')}>
          {label}
          {derived && <span className="ml-1.5 align-middle font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">derived</span>}
        </p>
        <p className="font-mono text-[10px] text-muted truncate">{hint}</p>
      </div>
      <span className={clsx('font-mono tnum font-semibold shrink-0', strong ? 'text-[17px] text-ink' : 'text-[14px]', warn ? 'text-warn' : strong ? '' : 'text-danger')}>
        {fmtMoney(value)}
      </span>
    </div>
  );
}

/** The shed drill-down: the four expense components, the ledger entries behind them, and the feed eaten. */
function ShedDetail({ detail, txns, feedRows }: {
  detail: ShedPnl; txns: FinanceTxn[]; feedRows: FeedTrace[];
}) {
  const ledger = latestFirst(txns);
  const eaten = [...feedRows].sort((a, b) => b.date.localeCompare(a.date) || b.consumptionId.localeCompare(a.consumptionId));
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const toggleDay = (id: string) => setOpenDays(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Stat label="Income" value={money(detail.income)} tone="success" foot={`${detail.incomeCount} ${detail.incomeCount === 1 ? 'entry' : 'entries'}`} />
        <Stat label="Direct expenses" value={money(detail.directExpense)} tone="danger" foot={`${detail.directCount} mapped ${detail.directCount === 1 ? 'entry' : 'entries'}`} />
        <Stat label="Feed consumed" value={money(detail.feedExpense)} tone="danger" foot={`${fmtIN(detail.feedTonnes, 2)} t eaten${detail.unpricedFeedKg > 0 ? ` · ${fmtIN(detail.unpricedFeedKg)} kg unpriced` : ''}`} />
        <Stat label="Shared godown" value={money(detail.sharedExpense)} tone="warn" foot={detail.sharedExpense > 0 ? 'its share of the stock shortage' : 'no shortage fell in this period'} />
      </div>
      <div className="rounded-[12px] bg-sunk px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">Total expense</p>
          <p className="font-mono text-[10px] text-muted mt-0.5">direct + feed + shared, purchases excluded</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-[14px] font-bold text-danger tnum">{money(detail.totalExpense)}</p>
          <p className={clsx('font-mono text-[11px] tnum', detail.profit >= 0 ? 'text-success' : 'text-danger')}>profit {money(detail.profit)}</p>
        </div>
      </div>

      {eaten.length > 0 && (
        <div>
          <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">
            Feed this shed ate · priced at godown averages
          </p>
          <div className="mt-1.5 space-y-1.5">
            {eaten.slice(0, 5).map(f => {
              const open = openDays.has(f.consumptionId);
              return (
                <div key={f.consumptionId} className="rounded-[12px] border border-line bg-card overflow-hidden">
                  <button type="button" onClick={() => toggleDay(f.consumptionId)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left press hover:bg-sunk/60">
                    <span className="font-mono text-[11px] text-muted tnum shrink-0">{fmtDateShort(f.date)}</span>
                    <span className="flex-1 min-w-0 text-[12px] text-ink-2 truncate">
                      {f.formulaName ? `${f.formulaName}${f.formulaVersion ? ` V${f.formulaVersion}` : ''}` : 'no formula on record'}
                    </span>
                    <span className="font-mono text-[11px] text-muted tnum shrink-0">{fmtIN(f.tonnes, 2)} t</span>
                    <span className="font-mono text-[12px] font-semibold text-danger tnum shrink-0">{money(f.cost)}</span>
                    {open
                      ? <ChevronDown size={14} className="text-muted shrink-0" />
                      : <ChevronRight size={14} className="text-faint shrink-0" />}
                  </button>
                  {open && (
                    <div className="px-3 pb-2.5 pt-1 bg-sunk/40 border-t border-line-2">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted mb-1">
                        KG drawn × the average it was drawn at
                      </p>
                      <div className="divide-y divide-line-2">
                        {f.lines.map((l, i) => (
                          <div key={`${l.ingredient}-${i}`} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2.5 items-baseline py-1 text-[11.5px]">
                            <span className="text-ink-2 truncate">{l.ingredient}</span>
                            <span className="font-mono tnum text-ink text-right whitespace-nowrap">{fmtIN(l.kg, 2)} kg</span>
                            <span className="font-mono tnum text-muted text-right whitespace-nowrap">× {l.avg === null ? '—' : fmtMoney(l.avg, 2)}</span>
                            <span className="font-mono tnum font-semibold text-danger text-right whitespace-nowrap">{l.cost === null ? '—' : money(l.cost)}</span>
                          </div>
                        ))}
                      </div>
                      {f.missingFormula && (
                        <p className="mt-1.5 font-mono text-[10px] text-warn">No formula version was in force — nothing is charged for this day.</p>
                      )}
                      {f.unpricedKg > 0 && (
                        <p className="mt-1.5 font-mono text-[10px] text-warn">{fmtIN(f.unpricedKg, 2)} kg had no godown average behind it, so it is counted but not costed.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {eaten.length > 5 && <p className="mt-1 font-mono text-[10px] text-muted">{eaten.length - 5} more days in the same period.</p>}
        </div>
      )}

      <div>
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">Ledger entries of this shed</p>
        {ledger.length === 0 ? (
          <p className="text-[12px] text-muted mt-1.5">No money entries were made against this shed in the period — its figures come from the godown movements alone.</p>
        ) : (
          <div className="mt-1.5">
            <GroupList>
              {ledger.slice(0, 6).map(t => <TxnRow key={t.id} t={t} dense />)}
            </GroupList>
            {ledger.length > 6 && <p className="mt-1.5 font-mono text-[10px] text-muted">{ledger.length - 6} more — open the ledger below to see all of them.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function FlowRow({ label, hint, value, tone, strong }: { label: string; hint: string; value: number; tone: 'success' | 'danger' | 'brand'; strong?: boolean }) {
  const toneText = { success: 'text-success', danger: 'text-danger', brand: 'text-brand' }[tone];
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className={clsx('font-display font-semibold text-ink truncate', strong ? 'text-[15px]' : 'text-[13px]')}>{label}</p>
        <p className="font-mono text-[10px] text-muted truncate">{hint}</p>
      </div>
      <span className={clsx('font-mono tnum font-semibold shrink-0', strong ? 'text-[18px]' : 'text-[15px]', toneText)}>
        {value < 0 ? `−${fmtMoney(Math.abs(value))}` : fmtMoney(value)}
      </span>
    </div>
  );
}

/* ============================= TRANSACTION ROW ============================= */

function TxnRow({ t, dense, link, onOpen }: { t: FinanceTxn; dense?: boolean; link?: string; onOpen?: () => void }) {
  const inFlow = isInflow(t.kind);
  const meta = KIND_META[t.kind];
  const Icon = meta.icon;
  return (
    <ListRow
      onClick={onOpen}
      leading={<IconTile tone={inFlow ? 'success' : 'danger'} size={dense ? 30 : 34}><Icon size={15} /></IconTile>}
      title={t.category}
      subtitle={
        <span className="font-mono text-[10.5px]">
          {fmtDate(t.date)} · {meta.label}
          {t.counterparty ? ` · ${t.counterparty}` : ''}
          {link ? ` · ${link}` : ''}
          {onOpen ? ' · tap for details' : ''}
        </span>
      }
      /* §14 — how the money moved is a field on the row, not something to dig out later */
      chips={<PaymentChips row={t} compact />}
      trailing={
        <span className={clsx('font-mono tnum font-display font-bold shrink-0', inFlow ? 'text-success' : 'text-danger', dense ? 'text-[13px]' : 'text-sm')}>
          {inFlow ? '+' : '−'}{fmtMoney(t.amount)}
        </span>
      }
    />
  );
}
