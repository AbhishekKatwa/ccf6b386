import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArchiveX, ChevronRight, Egg, FlaskConical, Package, Pill, Plus, Skull, Truck, Users, Wallet, Wheat,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp, useCan, useCompanyData, useCurrentUser } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, StatusBadge, EmptyState, Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtDate, fmtIN, fmtMoney, fmtPct, shiftDate, todayISO } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import { eggStockByGrade, formulaCostPerTonne, formulaForDate } from '@/lib/calc';
import { feedExpenseTraces } from '@/lib/analytics';
import { isInventoryPurchase } from '@/lib/accounting';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { useVaccinationSchedule } from '@/hooks/useVaccinations';
import { countsSummaryLine } from '@/lib/vaccination';
import { VaccinationBatchSection } from '@/components/vaccination/VaccinationBatchSection';
import { FeedGivenDialog } from '@/components/godown/FeedGivenDialog';
import { MedicineUsageSheet } from '@/components/medicine/MedicineSheets';
import { SaleEntryDialog } from '@/screens/SalesScreen';
import { BatchMoneyDialog, type MoneyKind } from '@/components/finance/BatchMoneyDialog';
import { usageExpenseOf } from '@/lib/medicines';
import { useMedicineValuation } from '@/hooks/useMedicineValuation';
import { MedicineLedgerSurface, type MedicineRefs } from '@/components/medicine/MedicineLedger';
import { unitQty } from '@/components/medicine/medicineMeta';
import { TrendChart, type VPoint } from '@/components/charts/DataViz';
import { CHART } from '@/components/ui/Charts';
import { MEDICINE_ROLES, FORMULA_VIEW_ROLES, VACCINATION_ROLES } from '@/lib/permissions';
import type { EggGrade, EggGradeCounts } from '@/types';

type TabId = 'overview' | 'pnl' | 'operations' | 'formula' | 'health' | 'trends';

/**
 * One shed carries one live flock, so this screen IS the shed's operating console:
 * the flock's numbers on top, then the work behind them in tabs. Nothing here invents
 * a figure — every number is derived from the records the modules already write.
 */
export function BatchDetailScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { batches, farms, sheds, feedFormulas } = data;
  const batch = batches.find(b => b.id === batchId);
  const m = useBatchMetrics(batchId);
  const closeBatch = useApp(s => s.closeBatch);
  const setFeedIntake = useApp(s => s.setBatchFeedIntake);
  const pushToast = useApp(s => s.pushToast);
  const users = data.users;
  const canFinance = useCan('viewFinance');
  const canClose = useCan('closeBatch');
  const canUpdate = useCan('update');
  const canManageFormula = useCan('manageFormulas');
  const canFeed = useCan('createDailyOps');
  const canCreate = useCan('create');
  const canSellEntry = useCan('createSaleEntries');
  const user = useCurrentUser();
  const { priceOf } = useGodownPrices();
  const vac = useVaccinationSchedule(batchId);

  /** An alert or a deep link may name the tab it wants to land on (`?tab=health`). */
  const [params] = useSearchParams();
  const wanted = params.get('tab') as TabId | null;
  const [tab, setTab] = useState<TabId>(wanted ?? 'overview');
  const [closeOpen, setCloseOpen] = useState(false);
  const [cf, setCf] = useState({
    date: todayISO(), finalBirds: '', buyer: '',
    saleQty: '', saleRatePerBird: '', saleAmount: '',
    paymentMethod: '', reference: '', remarks: '',
  });
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intake, setIntake] = useState('');
  const [medicineOpen, setMedicineOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  /** Which money entry the P&L tab is being asked for — the batch is already known here. */
  const [moneyKind, setMoneyKind] = useState<MoneyKind | null>(null);

  const canSeeMedicine = !!user && MEDICINE_ROLES.includes(user.role);
  const canSeeFormula = !!user && FORMULA_VIEW_ROLES.includes(user.role);
  const canVaccinate = !!user && VACCINATION_ROLES.includes(user.role);
  const { valuation, itemOf } = useMedicineValuation();
  const medicineRefs: MedicineRefs = {
    shedName: id => data.sheds.find(s => s.id === id)?.name,
    batchCode: id => data.batches.find(b => b.id === id)?.code,
    nameOf: id => data.users.find(u => u.id === id)?.name,
    itemOf,
    itemPath: id => `/medicines/item/${id}`,
  };

  /** Feed this flock actually ate, priced at the godown average of the day it left the shelf. */
  const feedCost = useMemo(() => {
    if (!batch) return { cost: 0, tonnes: 0, unpricedKg: 0 };
    const traces = feedExpenseTraces(data.feed, data.feedStock, data.feedFormulas)
      .filter(t => t.batchId === batch.id);
    return {
      cost: traces.reduce((s, t) => s + t.cost, 0),
      tonnes: traces.reduce((s, t) => s + t.tonnes, 0),
      unpricedKg: traces.reduce((s, t) => s + t.unpricedKg, 0),
    };
  }, [batch, data.feed, data.feedStock, data.feedFormulas]);

  /** Batch money, split the way the accounts read it: what the flock earned, what it cost to run. */
  const money = useMemo(() => {
    if (!batch) return null;
    const rows = data.finance.filter(f => f.batchId === batch.id);
    const inflows = rows.filter(f => f.kind === 'INCOME' || f.kind === 'SALE' || f.kind === 'PAYMENT_IN');
    const isEggSale = (f: typeof inflows[number]) => f.kind === 'SALE' || /egg/i.test(f.category ?? '');
    const eggSales = inflows.filter(isEggSale).reduce((s, f) => s + f.amount, 0);
    const otherIncome = inflows.filter(f => !isEggSale(f)).reduce((s, f) => s + f.amount, 0);
    // Inventory purchases and the payments that settle them are not this flock's expense.
    const direct = rows.filter(f => f.kind === 'EXPENSE' && !isInventoryPurchase(f)).reduce((s, f) => s + f.amount, 0);
    return { eggSales, otherIncome, income: eggSales + otherIncome, direct };
  }, [batch, data.finance]);

  if (!batch || !m || !money) {
    return <Page><Header title="Batch" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  }
  const farm = farms.find(f => f.id === batch.farmId);
  const shed = sheds.find(s => s.id === batch.shedId);
  const isLayer = batch.birdType === 'LAYER';
  const isActive = batch.status === 'ACTIVE';

  const formula = formulaForDate(batch.shedId, m.today, feedFormulas);
  const kgPerTonne = formula ? formula.items.reduce((s, i) => s + i.kgPerTonne, 0) : 0;
  const costPerTonne = formula ? formulaCostPerTonne(formula, priceOf) : 0;
  const plannedIntake = batch.approximateFeedTonnesPerDay;

  /** NORMAL eggs only — small, broken and double are their own pools and never join this figure. */
  const normalToday = m.todaysEggs.byGrade.GOOD;
  const normalStock = eggStockByGrade(batch.shedId, data.eggs, data.saleEntries, data.eggWastages, m.today).GOOD.balance;
  const todaysFeed = data.feed
    .filter(f => f.shedId === batch.shedId && f.date === m.today)
    .reduce((s, f) => s + f.tonnes, 0);

  const medicineExpense = m.medicine.expense;
  const totalExpense = money.direct + feedCost.cost + medicineExpense;
  const net = money.income - totalExpense;

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'pnl', label: 'P&L', show: canFinance },
    { id: 'operations', label: 'Operations', show: true },
    { id: 'formula', label: 'Formula', show: canSeeFormula },
    { id: 'health', label: 'Health', show: canVaccinate || canSeeMedicine },
    { id: 'trends', label: 'Trends', show: true },
  ];
  const shownTabs = tabs.filter(t => t.show);
  const active: TabId = shownTabs.some(t => t.id === tab) ? tab : 'overview';

  function submitClose() {
    if (!batch) return;
    const finalBirds = parseInt(cf.finalBirds, 10);
    if (!cf.date) return pushToast('error', 'Date required');
    if (!finalBirds || finalBirds < 0) return pushToast('error', 'Closing bird count required');
    // Calculate sale amount: explicit entry wins; if qty+rate supplied, derive it.
    const saleQty = parseInt(cf.saleQty, 10) || 0;
    const saleRatePerBird = parseFloat(cf.saleRatePerBird) || 0;
    const derived = saleQty > 0 && saleRatePerBird > 0 ? saleQty * saleRatePerBird : 0;
    const saleAmount = cf.saleAmount !== '' ? parseFloat(cf.saleAmount) || 0
      : derived > 0 ? derived : 0;
    const r = closeBatch(batch.id, {
      date: cf.date, finalBirds,
      buyer: cf.buyer || undefined,
      saleAmount: saleAmount > 0 ? saleAmount : undefined,
      saleQty: saleQty > 0 ? saleQty : undefined,
      saleRatePerBird: saleRatePerBird > 0 ? saleRatePerBird : undefined,
      paymentMethod: cf.paymentMethod as import('@/types').PaymentMethod | undefined || undefined,
      reference: cf.reference || undefined,
      remarks: cf.remarks || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    setCloseOpen(false);
  }

  /** Planning only: the forecast reads this figure, no stock or money moves because of it. */
  function openIntake() {
    if (!batch) return;
    setIntake(batch.approximateFeedTonnesPerDay != null ? String(batch.approximateFeedTonnesPerDay) : '');
    setIntakeOpen(true);
  }

  function submitIntake() {
    if (!batch) return;
    const tonnes = intake.trim() === '' ? null : Number(intake);
    if (tonnes !== null && !Number.isFinite(tonnes)) return pushToast('error', 'Enter a number of tonnes, or leave it empty');
    const r = setFeedIntake(batch.id, tonnes);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', tonnes
      ? `${batch.code} forecasted at ${tonnes.toFixed(2)} t/day`
      : `${batch.code} is out of the feed forecast`);
    setIntakeOpen(false);
  }

  return (
    <Page withNav>
      <Header
        title={batch.code}
        subtitle={`${isLayer ? 'Layer' : 'Broiler'} · ${batch.breed} · ${shed?.name ?? farm?.name ?? '—'} · ${m.age.dayLabel}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={batch.status} />
            {user?.role === 'OWNER' && (
              <Button size="sm" variant="outline" icon={<Users size={14} />}
                onClick={() => nav(`/batches/${batch.id}/users`)}>
                <span className="hidden sm:inline">Assigned users</span>
              </Button>
            )}
            {isActive && canClose && (
              <Button size="sm" variant="outline" icon={<Package size={14} />}
                onClick={() => { setCf({ date: todayISO(), finalBirds: String(m.live), buyer: '', saleQty: '', saleRatePerBird: '', saleAmount: '', paymentMethod: '', reference: '', remarks: '' }); setCloseOpen(true); }}>
                <span className="hidden sm:inline">Close / sell</span>
              </Button>
            )}
          </div>
        }
      />

      <div className="px-4 sm:px-0 mt-3 space-y-4 pb-6">
        {/* ===================== flock summary ===================== */}
        <Card padded={false} className="overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-line-2 divide-y sm:divide-y-0">
            <Metric label="Live birds" value={fmtIN(m.live)} sub={`of ${fmtIN(batch.initialBirds)}`} tone="brand" />
            <Metric label="Age" value={m.age.dayLabel} sub={`placed ${fmtDate(batch.placementDate)}`} />
            <Metric label="Cum. mortality" value={fmtIN(m.cumMort)} sub={fmtPct(m.mortPct, 2)} tone="danger" />
            {isLayer ? (
              <>
                <Metric label="Today's normal eggs" value={fmtIN(normalToday)} sub="trays" tone="accent" />
                <Metric label="Normal egg stock" value={fmtIN(normalStock)} sub="trays in hand" tone="accent" />
              </>
            ) : (
              <Metric label="Feed today" value={`${fmtIN(todaysFeed, 2)} t`} sub={`${fmtIN(m.feed30.tonnes, 2)} t in 30 days`} tone="success" />
            )}
            <Metric
              label="Approx. feed intake"
              value={plannedIntake == null ? 'Not set' : `${plannedIntake.toFixed(2)} t`}
              sub={plannedIntake == null ? 'planning value' : 'per day · planning'}
              action={canUpdate ? { label: plannedIntake == null ? 'Set' : 'Edit', onClick: openIntake } : undefined}
            />
          </div>
        </Card>

        {/* ===================== tab strip ===================== */}
        <div className="-mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto no-scrollbar">
          <div className="flex gap-1.5 min-w-max sm:min-w-0 sm:flex-wrap rounded-full bg-sunk p-1">
            {shownTabs.map(t => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={clsx(
                  'px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors press whitespace-nowrap',
                  active === t.id ? 'bg-card text-brand-ink shadow-card' : 'text-muted hover:text-ink',
                )}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ===================== OVERVIEW ===================== */}
        {active === 'overview' && (
          <div className="space-y-4">
            <Card>
              <SectionHead icon={<FlaskConical size={14} />} title="Feed plan" />
              {formula ? (
                <>
                  <Row label="Formula in force" mono={false}
                    value={
                      <button type="button" className="text-brand press hover:underline"
                        onClick={() => canSeeFormula && setTab('formula')}>
                        {formula.name} · v{formula.version}
                      </button>
                    } />
                  <Row label="Expected intake" value={plannedIntake == null ? 'Not set' : `${fmtIN(kgPerTonne * plannedIntake, 0)} kg/day`} />
                  {canFinance && <Row label="Expected feed cost" value={`${fmtMoney(costPerTonne * (plannedIntake ?? 0))}/day`} />}
                </>
              ) : (
                <p className="text-[12.5px] text-muted leading-relaxed">
                  No mix is in force for {shed?.name ?? 'this shed'} yet.
                  {canManageFormula && ' Create one from the Feed tab.'}
                </p>
              )}
            </Card>

            {canVaccinate && (
              <Card>
                <SectionHead icon={<Pill size={14} />} title="Flock health"
                  right={<button type="button" onClick={() => setTab('health')}
                    className="inline-flex items-center gap-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-brand press">
                    Open <ChevronRight size={12} />
                  </button>} />
                <Row label="Vaccine schedule" mono={false} value={countsSummaryLine(vac.counts)} />
                {vac.next && (
                  <Row label="Next dose" mono={false}
                    value={`${vac.next.item.vaccineName}${vac.next.item.dose ? ` · ${vac.next.item.dose}` : ''} · ${fmtDate(vac.next.item.scheduledDate)}`} />
                )}
                {canSeeMedicine && (
                  <Row label="Medicine drawn" value={canFinance ? fmtMoney(medicineExpense) : '₹•••••'}
                    danger={medicineExpense > 0} />
                )}
              </Card>
            )}

            <Card>
              <SectionHead icon={<ArchiveX size={14} />} title="Flock record" />
              <Row label="Breed" value={batch.breed} mono={false} />
              <Row label="Hatch date" value={fmtDate(batch.hatchDate)} />
              <Row label="Placement" value={fmtDate(batch.placementDate)} />
              <Row label="Initial birds" value={fmtIN(batch.initialBirds)} />
              <Row label="Shed" value={shed?.name ?? '—'} mono={false} />
              {batch.closing && (
                <>
                  <Row label="Closed" value={fmtDate(batch.closing.date)} />
                  <Row label="Closing birds" value={fmtIN(batch.closing.finalBirds)} />
                  {batch.closing.buyer && <Row label="Buyer" value={batch.closing.buyer} mono={false} />}
                  {(batch.closing.saleAmount ?? batch.closing.amount) != null && <Row label="Sale amount" value={canFinance ? fmtMoney((batch.closing.saleAmount ?? batch.closing.amount)!) : '₹•••••'} />}
                  <Row label="Closed by" value={users.find(u => u.id === batch.closing!.closedBy)?.name ?? '—'} mono={false} />
                </>
              )}
            </Card>
          </div>
        )}

        {/* ===================== P&L ===================== */}
        {active === 'pnl' && canFinance && (
          <div className="space-y-4">
            <Card padded={false} className="overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-line-2 divide-y sm:divide-y-0 sm:divide-x">
                <Money label="Total income" value={money.income} tone="success" />
                <Money label="Total expense" value={totalExpense} tone="danger" />
                <Money label="Net P&L" value={net} tone={net >= 0 ? 'brand' : 'danger'} strong />
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <SectionHead icon={<Wallet size={14} />} title="Income" />
                <Row label="Egg sales" value={fmtMoney(money.eggSales)} success={money.eggSales > 0} />
                <Row label="Extra income" value={fmtMoney(money.otherIncome)} success={money.otherIncome > 0} />
                <p className="mt-2 text-[11.5px] text-muted leading-relaxed">
                  Money booked against {batch.code} in the finance ledger.{' '}
                  <LedgerLink onClick={() => nav(`/finance?batch=${batch.id}&dir=in`)}>View income rows</LedgerLink>
                </p>
              </Card>
              <Card>
                <SectionHead icon={<Wheat size={14} />} title="Expenses" />
                <Row label="Feed consumed" value={fmtMoney(feedCost.cost)} danger={feedCost.cost > 0} />
                <Row label="Medicine drawn" value={fmtMoney(medicineExpense)} danger={medicineExpense > 0} />
                <Row label="Extra expenses" value={fmtMoney(money.direct)} danger={money.direct > 0} />
                <p className="mt-2 text-[11.5px] text-muted leading-relaxed">
                  Feed and medicine are what the godown and the store gave this flock, at the rate in
                  force on the day. Purchase vouchers and the payments that settle them stay out —
                  they are inventory, not this batch's expense.{' '}
                  <LedgerLink onClick={() => nav(`/finance?batch=${batch.id}&dir=out`)}>View expense rows</LedgerLink>
                </p>
              </Card>
            </div>

            {(feedCost.unpricedKg > 0 || m.medicine.unpriced > 0) && (
              <div className="rounded-[14px] bg-warn-soft px-4 py-3">
                <p className="text-[12px] text-warn leading-relaxed">
                  {feedCost.unpricedKg > 0 && <>{fmtIN(feedCost.unpricedKg, 0)} kg of feed had no godown average on the day it was drawn. </>}
                  {m.medicine.unpriced > 0 && <>{m.medicine.unpriced} medicine usage{m.medicine.unpriced === 1 ? '' : 's'} had no rate on the shelf. </>}
                  Those quantities are counted but left out of the money rather than priced at zero.
                </p>
              </div>
            )}

            {canCreate && (
              <Card>
                <SectionHead icon={<Plus size={14} />} title="Record against this flock" />
                <p className="mt-1 text-[11.5px] text-muted leading-relaxed">
                  Money this shed earned or spent that no other module wrote — a wage paid at month end, the
                  electricity bill, manure sold. Each entry lands on {batch.code} in the finance ledger, with how
                  it was paid and whose hands held the cash.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setMoneyKind('INCOME')}>Add income</Button>
                  <Button size="sm" variant="outline" onClick={() => setMoneyKind('EXPENSE')}>Add expense</Button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ===================== OPERATIONS ===================== */}
        {active === 'operations' && (
          <div className="space-y-3">
            {!isActive && (
              <div className="rounded-[14px] bg-sunk px-4 py-3">
                <p className="text-[12.5px] text-muted leading-relaxed">
                  This batch closed on {batch.closing ? fmtDate(batch.closing.date) : '—'} — its records stay readable,
                  daily entries are stopped.
                </p>
              </div>
            )}
            {isLayer && (
              <OpTile icon={<Egg size={17} />} tone="accent" title="Egg collection"
                figure={`${fmtIN(m.todaysEggs.total)} trays today`}
                hint={`${fmtIN(normalToday)} normal · ${fmtIN(m.todaysEggs.byGrade.BROKEN)} broken · ${fmtIN(m.todaysEggs.byGrade.DOUBLE)} double · ${fmtIN(m.todaysEggs.byGrade.SMALL)} small`}
                actionLabel={isActive ? 'Add / edit collection' : 'View collections'}
                onAction={() => nav(`/batches/${batch.id}/eggs`)} />
            )}
            <OpTile icon={<Truck size={17} />} tone="brand" title={isLayer ? 'Egg sale' : 'Sales'}
              figure={`${fmtIN(m.sales.trays)} trays dispatched`}
              hint={`${fmtIN(m.sales.count)} sale ${m.sales.count === 1 ? 'entry' : 'entries'} from this shed so far`}
              actionLabel="Sale entry" onAction={() => { if (canSellEntry) setSaleOpen(true); else nav('/sales'); }} />
            <OpTile icon={<Skull size={17} />} tone="danger" title="Mortality"
              figure={`${fmtIN(mortalityToday(data.mortality, batch.id, m.today))} birds today`}
              hint={`${fmtIN(m.cumMort)} cumulative · ${fmtPct(m.mortPct, 2)} of the flock`}
              actionLabel={isActive ? 'Record mortality' : 'View mortality'}
              onAction={() => nav(`/batches/${batch.id}/mortality`)} />
            <OpTile icon={<Wheat size={17} />} tone="success" title="Feeding"
              figure={todaysFeed ? `${fmtIN(todaysFeed, 2)} t given today` : 'Not fed today'}
              hint={`${fmtIN(m.feed30.tonnes, 2)} t in the last 30 days${canFinance ? ` · ${fmtMoney(feedCost.cost)} charged to this flock` : ''}`}
              actionLabel={isActive ? 'Record feeding' : 'View feed ledger'}
              onAction={() => { if (isActive && canFeed) setFeedOpen(true); else nav('/feed'); }} />
          </div>
        )}

        {/* ===================== FORMULA ===================== */}
        {active === 'formula' && canSeeFormula && (
          <div className="space-y-4">
            {formula ? (
              <Card>
                <SectionHead icon={<FlaskConical size={14} />} title={`${formula.name} · v${formula.version}`}
                  right={<Badge tone="brand">In force</Badge>} />
                <div className="mt-2 overflow-x-auto no-scrollbar">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead>
                      <tr className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-2">
                        <th className="text-left font-semibold pb-2">Ingredient</th>
                        <th className="text-right font-semibold pb-2">kg / tonne</th>
                        <th className="text-right font-semibold pb-2">Godown avg</th>
                        <th className="text-right font-semibold pb-2">Cost / tonne</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-2">
                      {formula.items.map(it => {
                        const avg = priceOf(it.ingredient);
                        return (
                          <tr key={it.ingredient}>
                            <td className="py-2 text-ink">{it.ingredient}</td>
                            <td className="py-2 text-right tnum text-ink-2">{fmtIN(it.kgPerTonne, 1)}</td>
                            <td className="py-2 text-right tnum text-ink-2">{avg === null ? 'no rate' : fmtMoney(avg)}</td>
                            <td className="py-2 text-right tnum text-ink-2">{avg === null ? '—' : fmtMoney(it.kgPerTonne * avg)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line">
                        <td className="pt-2 font-semibold text-ink">Total</td>
                        <td className="pt-2 text-right tnum font-semibold text-ink">{fmtIN(kgPerTonne, 1)}</td>
                        <td className="pt-2" />
                        <td className="pt-2 text-right tnum font-semibold text-ink">{canFinance ? fmtMoney(costPerTonne) : '₹•••••'}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {plannedIntake != null && (
                  <p className="mt-3 text-[12px] text-muted leading-relaxed tnum">
                    At {plannedIntake.toFixed(2)} t/day this flock is planned for {fmtIN(kgPerTonne * plannedIntake, 0)} kg of feed
                    {canFinance ? ` · ${fmtMoney(costPerTonne * plannedIntake)} a day` : ''}.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => nav(`/feed/formulas/${formula.id}`)}>Open formula</Button>
                  {canManageFormula && (
                    <Button size="sm" variant="outline" onClick={() => nav(`/feed/formulas/${formula.id}/edit`)}>New version</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => nav(`/feed/formulas/${formula.id}/history`)}>Version history</Button>
                </div>
              </Card>
            ) : (
              <EmptyState icon={<FlaskConical size={22} />} title="No formula in force"
                description={`Nothing is scheduled to feed ${shed?.name ?? 'this shed'} today.`}
                action={canManageFormula
                  ? <Button onClick={() => nav(`/feed/formulas/new?shedId=${batch.shedId}`)}>Create formula</Button>
                  : undefined} />
            )}

            <Card>
              <SectionHead icon={<Wheat size={14} />} title="Consumption on this flock" />
              <Row label="Feed eaten (lifetime)" value={`${fmtIN(feedCost.tonnes, 2)} t`} />
              {canFinance && <Row label="Charged to this batch" value={fmtMoney(feedCost.cost)} danger={feedCost.cost > 0} />}
              <Row label="Last 30 days" value={`${fmtIN(m.feed30.tonnes, 2)} t`} />
              <p className="mt-2 text-[11.5px] text-muted leading-relaxed">
                Each feeding keeps the formula version that drove it, so a new version never rewrites
                what an earlier day cost.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => nav('/feed')}>Godown stock</Button>
                <Button size="sm" variant="ghost" onClick={() => nav('/feed/formulas')}>All formulas</Button>
              </div>
            </Card>
          </div>
        )}

        {/* ===================== HEALTH ===================== */}
        {active === 'health' && (
          <div className="space-y-4">
            {canVaccinate && <VaccinationBatchSection batchId={batch.id} />}
            {canSeeMedicine && (
              <Card>
                <SectionHead icon={<Pill size={14} />} title="Medicine used on this flock"
                  right={
                    <button type="button" onClick={() => setMedicineOpen(true)}
                      disabled={!m.medicine.uses.length}
                      className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-brand press disabled:text-muted-2">
                      Full usage
                    </button>
                  } />
                {m.medicine.uses.length === 0 ? (
                  <p className="text-[12.5px] text-muted leading-relaxed">
                    Nothing drawn from the medicine store for this flock yet.
                  </p>
                ) : (
                  <div className="mt-1 divide-y divide-line-2">
                    {m.medicine.uses.slice(0, 6).map(u => {
                      const item = itemOf(u.medicineId);
                      const cost = usageExpenseOf(u, valuation);
                      return (
                        <div key={u.id} className="py-2.5 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13.5px] font-medium text-ink truncate">{item?.name ?? 'Medicine'}</p>
                            <p className="text-[11.5px] text-muted truncate">
                              {fmtDate(u.date)} · {unitQty(u.qty, item?.unit ?? '')}{u.reason ? ` · ${u.reason}` : ''}
                            </p>
                          </div>
                          <p className="shrink-0 font-mono text-[12.5px] tnum text-ink-2">
                            {canFinance ? (cost == null ? 'no rate' : fmtMoney(cost)) : '₹•••••'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { if (canCreate) setUsageOpen(true); else nav('/medicines'); }}>Record medicine usage</Button>
                  {canFinance && (
                    <span className="font-mono text-[11px] text-muted tnum">
                      {fmtMoney(medicineExpense)} charged to this flock
                    </span>
                  )}
                </div>
                {canFinance && m.medicine.unpriced > 0 && (
                  <p className="mt-2 text-[11.5px] text-warn leading-relaxed">
                    {m.medicine.unpriced} usage{m.medicine.unpriced === 1 ? '' : 's'} stand unvalued — the item had no
                    rate on the shelf that day.
                  </p>
                )}
              </Card>
            )}
            {!canVaccinate && !canSeeMedicine && (
              <EmptyState icon={<Pill size={22} />} title="Not available for your role"
                description="Vaccine schedules and medicine usage are handled by the owner, supervisors and farm staff." />
            )}
          </div>
        )}

        {/* ===================== TRENDS ===================== */}
        {active === 'trends' && (
          <BatchTrends batchId={batch.id} shedId={batch.shedId} isLayer={isLayer} today={m.today} />
        )}
      </div>

      <Dialog open={medicineOpen} onClose={() => setMedicineOpen(false)}
        title="Medicine used on this flock" subtitle={batch.code}
        footer={<Button block variant="outline" onClick={() => { setMedicineOpen(false); nav('/medicines'); }}>Open the medicine store</Button>}>
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">
            Each row is stock that left the store for this batch, valued at the shelf average of that day.
          </p>
          <MedicineLedgerSurface entries={m.medicine.uses} refs={medicineRefs} valuation={valuation}
            canFinance={canFinance} today={m.today} />
        </div>
      </Dialog>

      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title="Close / sell batch" subtitle={batch.code}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setCloseOpen(false)}>Cancel</Button><Button variant="danger" block onClick={submitClose}>Close batch</Button></div>}>
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">Record how the batch ended. History stays intact and the shed becomes idle for the next placement.</p>
          <Field label="Closure date" type="date" value={cf.date} onChange={e => setCf(f => ({ ...f, date: e.target.value }))} />
          <Field label="Closing birds" type="number" inputMode="numeric" value={cf.finalBirds} onChange={e => setCf(f => ({ ...f, finalBirds: e.target.value }))} className="font-mono" />
          <Field label="Buyer (optional)" value={cf.buyer} onChange={e => setCf(f => ({ ...f, buyer: e.target.value }))} placeholder="e.g. Dhanraj Poultry" />

          {/* Bird sale income — becomes a real Finance ledger row */}
          <div className="rounded-[16px] border border-line bg-card px-4 py-3.5 space-y-3">
            <div>
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">Bird sale income</p>
              <p className="text-[11.5px] text-muted leading-relaxed mt-0.5">
                Recorded as a Bird Sale income transaction in the Finance ledger — appears in shed income, batch P&amp;L and farm P&amp;L.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Birds sold (qty)" type="number" inputMode="numeric" value={cf.saleQty}
                onChange={e => {
                  const qty = parseInt(e.target.value, 10) || 0;
                  const rate = parseFloat(cf.saleRatePerBird) || 0;
                  setCf(f => ({ ...f, saleQty: e.target.value, saleAmount: qty > 0 && rate > 0 ? String(qty * rate) : f.saleAmount }));
                }}
                className="font-mono" placeholder="e.g. 10000" />
              <Field label="Rate per bird (₹)" type="number" inputMode="decimal" value={cf.saleRatePerBird}
                onChange={e => {
                  const rate = parseFloat(e.target.value) || 0;
                  const qty = parseInt(cf.saleQty, 10) || 0;
                  setCf(f => ({ ...f, saleRatePerBird: e.target.value, saleAmount: qty > 0 && rate > 0 ? String(qty * rate) : f.saleAmount }));
                }}
                className="font-mono" placeholder="e.g. 100" />
            </div>
            <Field label="Total sale amount (₹)" type="number" inputMode="decimal" value={cf.saleAmount}
              onChange={e => setCf(f => ({ ...f, saleAmount: e.target.value }))}
              className="font-mono"
              hint={
                (() => {
                  const qty = parseInt(cf.saleQty, 10) || 0;
                  const rate = parseFloat(cf.saleRatePerBird) || 0;
                  return qty > 0 && rate > 0 ? `${qty.toLocaleString('en-IN')} birds × ₹${rate}/bird = ₹${(qty * rate).toLocaleString('en-IN')}` : undefined;
                })()
              }
              placeholder="Leave blank if no sale" />
            {parseFloat(cf.saleAmount) > 0 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Payment method" value={cf.paymentMethod}
                    onChange={e => setCf(f => ({ ...f, paymentMethod: e.target.value }))}
                    options={[
                      { value: '', label: 'Not recorded' },
                      { value: 'CASH', label: 'Cash' },
                      { value: 'UPI', label: 'UPI' },
                      { value: 'PHONEPE', label: 'PhonePe' },
                      { value: 'NEFT', label: 'NEFT' },
                      { value: 'RTGS', label: 'RTGS' },
                      { value: 'BANK_TRANSFER', label: 'Bank transfer' },
                      { value: 'CHEQUE', label: 'Cheque' },
                    ]}
                  />
                  <Field label="Reference / UTR" value={cf.reference}
                    onChange={e => setCf(f => ({ ...f, reference: e.target.value }))}
                    placeholder="e.g. receipt no." />
                </div>
              </>
            )}
          </div>

          <TextArea label="Remarks (optional)" rows={2} value={cf.remarks} onChange={e => setCf(f => ({ ...f, remarks: e.target.value }))} placeholder="Flock sold standing, cleaned shed…" />
        </div>
      </Dialog>

      <Dialog open={intakeOpen} onClose={() => setIntakeOpen(false)}
        title="Approx. feed intake" subtitle={`${batch.code}${shed ? ` · ${shed.name}` : ''}`}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => setIntake('')} disabled={intake.trim() === ''}>Clear</Button>
          <Button block onClick={submitIntake}>Save</Button>
        </div>}>
        <Field label="Approx. feed intake" type="number" min="0" step="0.01" inputMode="decimal"
          value={intake} onChange={e => setIntake(e.target.value)} suffix="tonnes/day" className="font-mono"
          hint="Used to estimate future ingredient requirements and days of Godown stock remaining. Does not change actual feed consumption." />
        <p className="mt-2 text-[11.5px] text-muted leading-relaxed">
          Leave it empty to keep this batch out of the forecast — the godown assumes nothing for it.
        </p>
      </Dialog>

      {/* The same sheets the module screens use, opened on this flock. */}
      {feedOpen && <FeedGivenDialog onClose={() => setFeedOpen(false)} presetBatchId={batch.id} />}
      {usageOpen && <MedicineUsageSheet presetBatchId={batch.id} onClose={() => setUsageOpen(false)} />}
      {saleOpen && <SaleEntryDialog open onClose={() => setSaleOpen(false)} presetShedId={batch.shedId} />}
      {moneyKind && (
        <BatchMoneyDialog kind={moneyKind} batchId={batch.id} onClose={() => setMoneyKind(null)}
          subtitle={`${batch.code}${shed ? ` · ${shed.name}` : ''}`} />
      )}
    </Page>
  );
}

/* ============================= local pieces ============================= */

/** A quiet jump to the ledger rows behind a figure — the reading stays here, the rows are one tap away. */
function LedgerLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-brand press hover:underline">
      {children}
    </button>
  );
}

function SectionHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-brand shrink-0">{icon}</span>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted truncate">{title}</p>
      </div>
      {right}
    </div>
  );
}

const TONE: Record<string, string> = {
  brand: 'text-brand', accent: 'text-accent-ink', danger: 'text-danger', success: 'text-success', ink: 'text-ink',
};

function Metric({ label, value, sub, tone = 'ink', action, noTruncate }: {
  label: string; value: string; sub?: string; tone?: keyof typeof TONE | string;
  action?: { label: string; onClick: () => void };
  noTruncate?: boolean;
}) {
  return (
    <div className="px-3.5 py-3 min-w-0 sm:border-r sm:border-line-2 sm:last:border-r-0">
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-2 truncate">{label}</p>
      <p className={clsx('mt-1 font-display font-semibold tnum leading-none',
        noTruncate ? 'text-[17px] break-words' : 'text-[19px] truncate',
        TONE[tone] ?? 'text-ink')}>{value}</p>
      <div className="mt-1 flex items-center gap-1.5 min-w-0">
        {sub && <p className={clsx('text-[11px] text-muted tnum', noTruncate ? 'break-words' : 'truncate')}>{sub}</p>}
        {action && (
          <button type="button" onClick={action.onClick}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-brand press hover:underline">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Money({ label, value, tone, strong }: { label: string; value: number; tone: 'brand' | 'success' | 'danger'; strong?: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-2">{label}</p>
      <p className={clsx('mt-1 font-display tnum leading-none', strong ? 'text-[26px]' : 'text-[21px]',
        tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-brand')}>
        {fmtMoney(value)}
      </p>
    </div>
  );
}

function OpTile({ icon, tone, title, figure, hint, actionLabel, onAction }: {
  icon: ReactNode; tone: 'brand' | 'accent' | 'danger' | 'success';
  title: string; figure: string; hint: string; actionLabel: string; onAction: () => void;
}) {
  const bg = { brand: 'bg-brand-soft text-brand', accent: 'bg-accent-soft text-accent-ink', danger: 'bg-danger-soft text-danger', success: 'bg-success-soft text-success' }[tone];
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className={clsx('w-9 h-9 rounded-[11px] grid place-items-center shrink-0', bg)}>{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</p>
          <p className="mt-0.5 font-display text-[16px] font-semibold text-ink tnum leading-tight truncate">{figure}</p>
          <p className="mt-0.5 text-[11.5px] text-muted leading-snug tnum">{hint}</p>
        </div>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="outline" block onClick={onAction}>{actionLabel}</Button>
      </div>
    </Card>
  );
}

function mortalityToday(mortality: { batchId: string; date: string; count: number }[], batchId: string, today: string) {
  return mortality.filter(x => x.batchId === batchId && x.date === today).reduce((s, x) => s + x.count, 0);
}

/* ============================= trends ============================= */

const WINDOW = 30;

/** This flock's own 30 days, drawn from the records the modules already write. */
function BatchTrends({ batchId, shedId, isLayer, today }: { batchId: string; shedId: string; isLayer: boolean; today: string }) {
  const { eggs, saleEntries, eggWastages: wastages, mortality, feed } = useCompanyData();

  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = WINDOW - 1; i >= 0; i--) out.push(shiftDate(today, -i));
    return out;
  }, [today]);

  const series = useMemo(() => {
    const shedEggs = eggs.filter(e => e.shedId === shedId);
    const shedEntries = saleEntries.filter(e => e.lines.some(l => l.shedId === shedId));
    const batchMort = mortality.filter(x => x.batchId === batchId);
    const shedFeed = feed.filter(f => f.shedId === shedId);

    const per = <T,>(rows: T[], dateOf: (r: T) => string, valueOf: (r: T) => number): VPoint[] => {
      const byDay = new Map<string, number>();
      for (const r of rows) {
        const d = dateOf(r);
        byDay.set(d, (byDay.get(d) ?? 0) + valueOf(r));
      }
      return days.map(d => ({ date: d, value: byDay.get(d) ?? 0 }));
    };

    const lineTrays = (l: { byGrade: EggGradeCounts }, grade?: EggGrade) =>
      grade ? (l.byGrade[grade] || 0) : Object.values(l.byGrade).reduce((s, n) => s + n, 0);

    // Normal stock runs forward: what was in hand before the window, plus each day's movement.
    const opening = eggStockByGrade(shedId, eggs, saleEntries, wastages, shiftDate(days[0], -1)).GOOD.balance;
    const collected = per(shedEggs, e => e.date, e => e.goodTrays);
    const dispatched = per(
      shedEntries.flatMap(e => e.lines.filter(l => l.shedId === shedId).map(l => ({ date: e.date, trays: lineTrays(l, 'GOOD') }))),
      r => r.date, r => r.trays,
    );
    const wasted = per(wastages.filter(w => w.shedId === shedId).map(w => ({ date: w.date, trays: w.byGrade.GOOD || 0 })), r => r.date, r => r.trays);
    let running = opening;
    const stock = days.map((d, i) => {
      running += (collected[i].value ?? 0) - (dispatched[i].value ?? 0) - (wasted[i].value ?? 0);
      return { date: d, value: running };
    });

    return {
      production: collected,
      sales: per(shedEntries.flatMap(e => e.lines.filter(l => l.shedId === shedId).map(l => ({ date: e.date, trays: lineTrays(l) }))), r => r.date, r => r.trays),
      breakage: per(shedEggs, e => e.date, e => e.brokenTrays),
      mortality: per(batchMort, x => x.date, x => x.count),
      stock,
      feed: per(shedFeed, f => f.date, f => f.tonnes),
    };
  }, [eggs, saleEntries, wastages, mortality, feed, shedId, batchId, days]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {isLayer && (
        <ChartCard title="Egg production" sub="Normal trays collected each day"
          points={series.production} color={CHART.brand} />
      )}
      <ChartCard title={isLayer ? 'Egg sales' : 'Sales'} sub="Trays dispatched each day"
        points={series.sales} color={CHART.teal} />
      {isLayer && (
        <ChartCard title="Breakage" sub="Damaged trays collected each day"
          points={series.breakage} color={CHART.danger} />
      )}
      <ChartCard title="Mortality" sub="Birds lost each day"
        points={series.mortality} color={CHART.danger} />
      {isLayer && (
        <ChartCard title="Normal egg stock" sub="Trays in hand at the end of each day"
          points={series.stock} color={CHART.accent} />
      )}
      <ChartCard title="Feed consumption" sub="Tonnes given each day"
        points={series.feed} color={CHART.success} format={v => `${v.toFixed(2)} t`} />
    </div>
  );
}

function ChartCard({ title, sub, points, color, format }: {
  title: string; sub: string; points: VPoint[]; color: string;
  format?: (v: number) => string;
}) {
  const hasData = points.some(p => (p.value ?? 0) !== 0);
  return (
    <Card>
      <p className="font-display text-[14px] font-semibold text-ink leading-tight">{title}</p>
      <p className="text-[11.5px] text-muted mt-0.5">{sub}</p>
      <div className="mt-2">
        {hasData
          ? <TrendChart series={[{ id: title, label: title, color, points }]} height={150}
              format={format ? (v) => format(v) : undefined} />
          : <p className="py-6 text-center text-[12px] text-muted">No record in the last {WINDOW} days</p>}
      </div>
    </Card>
  );
}
