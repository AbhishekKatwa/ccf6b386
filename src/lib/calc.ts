import type {
  Batch, Company, EggCollection, EggGrade, EggGradeCounts, FeedConsumption,
  FeedStockEntry, GradeRates, MortalityEntry, PaymentStatus, SaleEntry,
  SaleEntryLine, SalePricing, FeedFormula, Trader, TraderTxn, TraderTxnKind, EggWastage,
} from '@/types';
import { EGG_GRADES, EGGS_PER_TRAY, EMPTY_GRADE_COUNTS } from '@/types';
import { daysBetween, nowISO, todayISO } from './format';

/* ============================= BIRDS / MORTALITY ============================= */

export function liveBirdsOn(batch: Batch, date: string, mortality: MortalityEntry[]): number {
  const dead = mortality
    .filter(m => m.batchId === batch.id && m.date <= date)
    .reduce((s, m) => s + m.count, 0);
  return Math.max(0, batch.initialBirds - dead);
}

export function cumulativeMortality(batchId: string, mortality: MortalityEntry[], onDate = todayISO()) {
  return mortality
    .filter(m => m.batchId === batchId && m.date <= onDate)
    .reduce((s, m) => s + m.count, 0);
}

export function batchAgeDays(batch: Batch, onDate = todayISO()): number {
  return Math.max(0, daysBetween(batch.placementDate, onDate));
}

/** The batch that held this shed on a date, so income and feed land on the right batch. */
export function batchOfShedOn(batches: Batch[], shedId: string, date: string): Batch | undefined {
  return batches
    .filter(b => b.shedId === shedId && b.startDate <= date && (!b.closing?.date || date <= b.closing.date))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

/* ============================= EGGS (TRAYS) ============================= */

const GRADE_KEYS: (keyof Pick<EggCollection, 'goodTrays' | 'brokenTrays' | 'doubleTrays' | 'smallTrays'>)[] =
  ['goodTrays', 'brokenTrays', 'doubleTrays', 'smallTrays'];

function gradeOf(key: (typeof GRADE_KEYS)[number]): EggGrade {
  return { goodTrays: 'GOOD', brokenTrays: 'BROKEN', doubleTrays: 'DOUBLE', smallTrays: 'SMALL' }[key] as EggGrade;
}

/** Trays collected per grade across any set of collection entries. */
export function eggGradeTotals(items: EggCollection[]): EggGradeCounts {
  const out = { ...EMPTY_GRADE_COUNTS };
  for (const e of items) for (const k of GRADE_KEYS) out[gradeOf(k)] += e[k] || 0;
  return out;
}

export function gradeTotal(byGrade: EggGradeCounts): number {
  return EGG_GRADES.reduce((s, g) => s + byGrade[g], 0);
}

export function eggSummary(shedId: string, eggs: EggCollection[], onDate = todayISO()) {
  const byGrade = eggGradeTotals(eggs.filter(e => e.shedId === shedId && e.date === onDate));
  return { byGrade, total: gradeTotal(byGrade) };
}

export function eggTotalsRange(shedId: string, eggs: EggCollection[], from: string, to: string) {
  const byGrade = eggGradeTotals(eggs.filter(e => e.shedId === shedId && e.date >= from && e.date <= to));
  return { byGrade, total: gradeTotal(byGrade) };
}

export type GradeStock = { collected: number; dispatched: number; wasted: number; balance: number };

/** Trays discarded per grade across any set of wastage records, optionally for one shed only. */
export function wasteTraysByGrade(wastages: EggWastage[], shedId?: string): EggGradeCounts {
  const out = { ...EMPTY_GRADE_COUNTS };
  for (const w of wastages) {
    if (shedId && w.shedId !== shedId) continue;
    for (const g of EGG_GRADES) out[g] += w.byGrade?.[g] || 0;
  }
  return out;
}

/** Trays per grade across a set of sale-entry lines, optionally for one shed only. */
export function linesByGrade(lines: SaleEntryLine[], shedId?: string): EggGradeCounts {
  const out = { ...EMPTY_GRADE_COUNTS };
  for (const line of lines) {
    if (shedId && line.shedId !== shedId) continue;
    for (const g of EGG_GRADES) out[g] += line.byGrade[g] || 0;
  }
  return out;
}

/** Trays sold per grade across sale entries, optionally for one shed only. */
export function entryTraysByGrade(entries: SaleEntry[], shedId?: string): EggGradeCounts {
  return linesByGrade(entries.flatMap(e => e.lines), shedId);
}

/** Every tray in one entry, across sheds and grades. */
export function entryTrays(entry: SaleEntry): number {
  return gradeTotal(linesByGrade(entry.lines));
}

/**
 * Physical egg stock per grade for a shed in TRAYS, as of a date:
 *   collected − sold in a final sale entry − thrown away as wastage.
 * A shed dispatch log does not move stock; only the accounts entry and a recorded
 * wastage do, so a load that leaves the shed but is not yet billed still counts as unsold.
 */
export function eggStockByGrade(
  shedId: string,
  eggs: EggCollection[],
  entries: SaleEntry[],
  wastages: EggWastage[],
  asOf = todayISO(),
): Record<EggGrade, GradeStock> {
  const collected = eggGradeTotals(eggs.filter(e => e.shedId === shedId && e.date <= asOf));
  const sold = entryTraysByGrade(entries.filter(e => e.date <= asOf), shedId);
  const wasted = wasteTraysByGrade(wastages.filter(w => w.date <= asOf), shedId);
  const out = {} as Record<EggGrade, GradeStock>;
  for (const g of EGG_GRADES) {
    out[g] = {
      collected: collected[g], dispatched: sold[g], wasted: wasted[g],
      balance: collected[g] - sold[g] - wasted[g],
    };
  }
  return out;
}

/** All grades combined — used where a shed-level total is what matters. */
export function eggStockTrays(
  shedId: string,
  eggs: EggCollection[],
  entries: SaleEntry[],
  wastages: EggWastage[],
  asOf = todayISO(),
): GradeStock {
  const byGrade = eggStockByGrade(shedId, eggs, entries, wastages, asOf);
  return EGG_GRADES.reduce<GradeStock>(
    (acc, g) => ({
      collected: acc.collected + byGrade[g].collected,
      dispatched: acc.dispatched + byGrade[g].dispatched,
      wasted: acc.wasted + byGrade[g].wasted,
      balance: acc.balance + byGrade[g].balance,
    }),
    { collected: 0, dispatched: 0, wasted: 0, balance: 0 },
  );
}

/**
 * The last price each grade settled at, in ₹ per egg. Only a voucher priced by rate proves
 * a price for one grade — an agreed figure for a mixed load says nothing about any single
 * pool, so it is never read back as one.
 */
export function lastGradeRates(entries: SaleEntry[]): GradeRates {
  const out: GradeRates = {};
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))) {
    if (e.pricing !== 'RATE') continue;
    for (const g of EGG_GRADES) {
      const rate = e.rates?.[g];
      if (rate && rate > 0) out[g] = rate;
    }
  }
  return out;
}

export type WastageSummary = {
  byGrade: EggGradeCounts;
  trays: number;
  eggs: number;
  /** What those trays would have fetched at the last rate each grade sold at. */
  value: number;
  /** Grades thrown away with no rate on record anywhere — counted, never priced. */
  unpriced: EggGrade[];
};

/**
 * What the farm has thrown away, in trays per grade and in the sale value it gave up.
 * That value is a lost-turnover memo, never a cost: no money moved, and the feed behind
 * the egg was already expensed the day the shed drew it.
 */
export function summarizeWastage(wastages: EggWastage[], entries: SaleEntry[]): WastageSummary {
  const rates = lastGradeRates(entries);
  const byGrade = wasteTraysByGrade(wastages);
  const unpriced: EggGrade[] = [];
  let value = 0;
  for (const g of EGG_GRADES) {
    if (!byGrade[g]) continue;
    const rate = rates[g];
    if (rate) value += byGrade[g] * EGGS_PER_TRAY * rate;
    else unpriced.push(g);
  }
  const trays = gradeTotal(byGrade);
  return { byGrade, trays, eggs: trays * EGGS_PER_TRAY, value: round2(value), unpriced };
}

const round2 = (n: number) => Number(n.toFixed(2));
/**
 * Money for a sale entry in progress: trays × eggs-per-tray × the per-egg rate the
 * trader quoted, or the single figure accounts agreed with them for the whole load.
 * This is the egg value alone — loading labour is billed on top of it.
 */
export function entryAmount(lines: SaleEntryLine[], rates: GradeRates, pricing: SalePricing, agreed = 0): number {
  if (pricing === 'AGREED') return Math.max(0, round2(agreed));
  const byGrade = linesByGrade(lines);
  return round2(EGG_GRADES.reduce((s, g) => s + byGrade[g] * EGGS_PER_TRAY * (rates[g] ?? 0), 0));
}

/** What the trader is billed for a load: its eggs plus the loading labour recovered on it. */
export function loadBilled(amount: number, laborCharge: number): number {
  return round2(amount + laborCharge);
}

/**
 * The selling price of a load in the only unit the trade thinks in: ₹ per egg.
 * The numerator is egg money alone — loading labour is recovered on the same voucher
 * but it is not a price — and the denominator is the eggs those trays hold.
 */
export function ratePerEgg(eggsMoney: number | null, trays: number | null): number | null {
  if (eggsMoney === null || trays === null || !Number.isFinite(eggsMoney) || !Number.isFinite(trays)) return null;
  const eggs = trays * EGGS_PER_TRAY;
  return eggs > 0 ? round2(eggsMoney / eggs) : null;
}

/** Money applied to a load: cash and PhonePe handed over, plus advance adjusted. */
export function loadPaid(cash: number, phonepe: number, advance: number): number {
  return round2(cash + phonepe + advance);
}

/**
 * What one load leaves on the trader's balance:
 *   eggs + loading labour + old dues − cash − PhonePe − advance.
 * The old dues are the trader's own balance, so this is only the load's part of it.
 * Negative means the trader overpaid and money is held for them.
 */
export function loadCredit(load: { amount: number; laborCharge: number; cash: number; phonepe: number; advance: number }): number {
  return round2(loadBilled(load.amount, load.laborCharge) - loadPaid(load.cash, load.phonepe, load.advance));
}

export function paymentStatusOf(entry: SaleEntry): PaymentStatus {
  const credit = loadCredit(entry);
  if (credit <= 0) return 'PAID';
  return credit >= loadBilled(entry.amount, entry.laborCharge) ? 'PENDING' : 'PARTIAL';
}

/* ============================= SALE PAYMENTS ============================= */

/** Receipts handed in after the load left, booked against this sale. */
export function salePayments(entry: SaleEntry, txns: TraderTxn[]): TraderTxn[] {
  return txns.filter(t => t.saleId === entry.id && t.kind === 'PAYMENT_IN');
}

/** ₹ actually received for one load: the money on the voucher plus every later receipt against it. */
export function salePaid(entry: SaleEntry, txns: TraderTxn[]): number {
  return round2(loadPaid(entry.cash, entry.phonepe, entry.advance)
    + salePayments(entry, txns).reduce((s, t) => s + (t.amount || 0), 0));
}

/** What a load was billed for — eggs plus the loading labour recovered on it. */
export function saleBilled(entry: SaleEntry): number {
  return loadBilled(entry.amount, entry.laborCharge);
}

/** What the trader still owes for this load. Negative means they have overpaid. */
export function saleOutstanding(entry: SaleEntry, txns: TraderTxn[]): number {
  return round2(saleBilled(entry) - salePaid(entry, txns));
}

/** A load's standing, read the same way a purchase's is: billed against what arrived. */
export function saleStatus(entry: SaleEntry, txns: TraderTxn[]): PaymentStatus {
  const paid = salePaid(entry, txns);
  if (paid <= 0) return 'PENDING';
  return saleOutstanding(entry, txns) > 0 ? 'PARTIAL' : 'PAID';
}

export type SalePosition = {
  entry: SaleEntry;
  billed: number;
  paid: number;
  /** What the trader still owes on this load. Negative means they have overpaid. */
  outstanding: number;
  status: PaymentStatus;
  payments: TraderTxn[];
};

/**
 * Every load billed to a trader, next to the money that arrived against it — the sales mirror
 * of a godown purchase: the sale is the billing event, a receipt is a separate money event.
 */
export function salePositions(entries: SaleEntry[], txns: TraderTxn[]): SalePosition[] {
  return entries
    .map(entry => {
      const payments = txns.filter(t => t.saleId === entry.id && t.kind === 'PAYMENT_IN')
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
      const paid = salePaid(entry, payments);
      const billed = saleBilled(entry);
      return {
        entry, billed, paid,
        outstanding: round2(billed - paid),
        status: paid <= 0 ? 'PENDING' as const : billed - paid > 0 ? 'PARTIAL' as const : 'PAID' as const,
        payments,
      };
    })
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.entry.id.localeCompare(a.entry.id));
}

/** The dues a trader still has across every load — receivables, from the same positions. */
export function saleReceivableTotal(positions: SalePosition[]): number {
  return round2(positions.reduce((s, p) => s + Math.max(0, p.outstanding), 0));
}

/* ============================= TRADER LEDGER ============================= */

/** How one ledger row moves the balance it sits on. The opening row is the base, not a movement. */
export function txnSignedAmount(t: TraderTxn): number {
  if (t.kind === 'EGG_SALE' || t.kind === 'PAYMENT_OUT') return t.amount;
  if (t.kind === 'PAYMENT_IN') return -t.amount;
  return 0;
}

/**
 * A trader's balance read back off their ledger: opening dues, plus everything billed,
 * minus everything handed over. Kept derived rather than stored as a running total so it
 * can never disagree with the rows the trader page adds up. Negative means they have paid
 * ahead and the farm is holding their money.
 */
export function traderBalance(openingBalance: number, txns: TraderTxn[]): number {
  return round2(txns.reduce((n, t) => n + txnSignedAmount(t), openingBalance));
}

/**
 * The walk-in account. A load sold at the gate to someone who never comes back still has to
 * be booked against a name, so every company carries exactly one of these: no profile, the
 * placeholder number the gate never asks for, and the same ledger as any other trader — its
 * dues are real dues, they are just nobody's credit history.
 */
export const WALK_IN_NAME = 'Anonymous';
export const WALK_IN_MOBILE = '999999999';
export const walkInTraderId = (companyId: string) => `tr_anon_${companyId}`;

export function isWalkInTrader(t: Trader): boolean {
  return t.id === walkInTraderId(t.companyId);
}

export function walkInTrader(companyId: string): Trader {
  const at = nowISO();
  return {
    id: walkInTraderId(companyId), companyId, name: WALK_IN_NAME, mobile: WALK_IN_MOBILE,
    openingBalance: 0, outstandingAmount: 0, active: true, createdAt: at, updatedAt: at,
  };
}

/** Append the walk-in account to every company that does not already have one. */
export function ensureWalkInTraders(traders: Trader[], companies: Company[]): Trader[] {
  const held = new Set(traders.filter(isWalkInTrader).map(t => t.companyId));
  return [...traders, ...companies.filter(c => !held.has(c.id)).map(c => walkInTrader(c.id))];
}

/** How each ledger type is named wherever a trader's account is shown. */
export const TRADER_TXN_LABEL: Record<TraderTxnKind, string> = {
  OPENING: 'Opening balance',
  EGG_SALE: 'Egg sale billed',
  PAYMENT_IN: 'Payment received',
  PAYMENT_OUT: 'Additional billed',
  RATE_UPDATE: 'Rate revision',
};

/** Within one trading day the load is billed before the money that settles it. */
const BOOKED_FIRST: Record<TraderTxnKind, number> = {
  OPENING: 0, EGG_SALE: 1, PAYMENT_OUT: 1, RATE_UPDATE: 2, PAYMENT_IN: 3,
};

/** A ledger row, how it moved the dues, and the balance it left behind. */export type TraderLedgerRow = { txn: TraderTxn; effect: number; running: number };

/**
 * The trader's statement: newest day first, and within a day the newest booking on
 * top. The running column is the one replay every screen reads, so the last row
 * always lands on `traderBalance` — no second balance source exists.
 */
export function traderLedger(openingBalance: number, txns: TraderTxn[]): TraderLedgerRow[] {
  const booked = [...txns].sort((a, b) => a.date.localeCompare(b.date)
    || BOOKED_FIRST[a.kind] - BOOKED_FIRST[b.kind]
    || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    || a.id.localeCompare(b.id));
  let bal = openingBalance;
  return booked.map(txn => {
    const effect = txnSignedAmount(txn);
    bal = round2(bal + effect);
    return { txn, effect, running: bal };
  }).reverse();
}

/** Money and trays across a set of sale entries. `net` is cash in hand after labour. */
export function saleEntryTotals(entries: SaleEntry[]) {
  const trays = entries.reduce((s, e) => s + entryTrays(e), 0);
  const amount = entries.reduce((s, e) => s + e.amount, 0);
  const labor = entries.reduce((s, e) => s + e.laborCharge, 0);
  const credit = entries.reduce((s, e) => s + loadCredit(e), 0);
  const received = entries.reduce((s, e) => s + loadPaid(e.cash, e.phonepe, e.advance), 0);
  return {
    count: entries.length, trays, amount, labor, credit,
    billed: loadBilled(amount, labor), received, net: round2(received - labor),
  };
}

/* ============================= GODOWN (KG) ============================= */

/**
 * The godown's own reorder levels, in KG. No per-ingredient minimum is configured
 * anywhere in the app, so this single pair is what both the godown list and the
 * owner's stock graphs judge an ingredient against — the alternative would be
 * inventing thresholds the farm never set.
 */
export const GODOWN_LOW_KG = 1000;
export const GODOWN_CRITICAL_KG = 500;

export function stockStatus(kg: number): 'NORMAL' | 'LOW' | 'CRITICAL' {
  return kg < GODOWN_CRITICAL_KG ? 'CRITICAL' : kg < GODOWN_LOW_KG ? 'LOW' : 'NORMAL';
}

/** How one ledger row moves physical stock, in KG. The valuation replays these deltas. */
export function stockDelta(e: FeedStockEntry): number {
  switch (e.kind) {
    case 'OPENING':
    case 'FEED_IN':
      return e.qtyKg;
    case 'FEED_OUT':
    case 'CONSUMPTION':
      return -e.qtyKg;
    case 'ADJUSTMENT':
      return e.qtyKg; // signed quantity
    case 'SHORTAGE':
      return -Math.abs(e.qtyKg); // always takes stock out, however it was typed
    default:
      return 0;
  }
}

/** Derived current godown stock per ingredient (KG) from the ledger. */
export function godownBalances(entries: FeedStockEntry[], asOf = todayISO()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (e.date > asOf) continue;
    out[e.ingredient] = (out[e.ingredient] ?? 0) + stockDelta(e);
  }
  return out;
}

export function ingredientBalance(entries: FeedStockEntry[], ingredient: string, asOf = todayISO()): number {
  return entries
    .filter(e => e.ingredient === ingredient && e.date <= asOf)
    .reduce((s, e) => s + stockDelta(e), 0);
}

/* ============================= FEED FORMULAS =============================
 * A formula is simply the mix a shed is fed: each ingredient carries the KG it
 * contributes per tonne of that mix. The total is never policed — a farm's own
 * recipe may add up to anything. */

export function formulaTotalKg(items: { kgPerTonne: number }[]): number {
  return Number(items.reduce((s, i) => s + (i.kgPerTonne || 0), 0).toFixed(2));
}

/** An ingredient's share of the mix, as a percentage of whatever it totals. */
export function formulaPct(kgPerTonne: number, totalKg: number): number {
  return totalKg > 0 ? Number(((kgPerTonne / totalKg) * 100).toFixed(2)) : 0;
}

export function formulaDeduction(formula: FeedFormula, tonnes: number): { ingredient: string; kg: number }[] {
  return formula.items.map(it => ({
    ingredient: it.ingredient,
    kg: Number((it.kgPerTonne * tonnes).toFixed(2)),
  }));
}

/** The version currently applied to new consumption for a shed. */
export function currentFormula(shedId: string, formulas: FeedFormula[]): FeedFormula | null {
  return formulas
    .filter(f => f.shedId === shedId && f.status === 'ACTIVE')
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0] ?? null;
}

/**
 * The version in force on a date. The activated version drives entries from the newest
 * effective date in the family onward; anything older reads back through the family
 * timeline, so reactivating an old mix never rewrites the days a later version fed.
 */
export function formulaForDate(shedId: string, date: string, formulas: FeedFormula[]): FeedFormula | null {
  const byDate = (a: FeedFormula, b: FeedFormula) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom) || a.version - b.version;
  const current = currentFormula(shedId, formulas);
  const family = current
    ? formulas.filter(f => f.familyId === current.familyId)
    : formulas.filter(f => f.shedId === shedId);
  const newest = family.slice().sort(byDate).at(-1);
  if (current && date >= current.effectiveFrom && (!newest || date >= newest.effectiveFrom)) return current;
  return family.filter(f => f.effectiveFrom <= date).sort(byDate).at(-1) ?? null;
}

/** Entries fed by this exact version — pinned records first, date resolution for older ones. */
export function formulaUsage(formula: FeedFormula, feed: FeedConsumption[], formulas: FeedFormula[]): FeedConsumption[] {
  return feed.filter(x => x.companyId === formula.companyId && (
    x.formulaId
      ? x.formulaId === formula.id
      : x.shedId === formula.shedId && formulaForDate(x.shedId, x.date, formulas)?.id === formula.id
  ));
}

/** Snapshot first, so a later formula edit can never rewrite history. */
export function consumptionDeduction(entry: FeedConsumption, formulas: FeedFormula[]): { ingredient: string; kg: number }[] {
  if (entry.deduction?.length) return entry.deduction;
  const version = entry.formulaId
    ? formulas.find(f => f.id === entry.formulaId) ?? null
    : formulaForDate(entry.shedId, entry.date, formulas);
  return version ? formulaDeduction(version, entry.tonnes) : [];
}

/**
 * What one tonne of this mix costs right now. The price of every ingredient comes
 * from the godown's own weighted average — a formula carries no rates of its own, so
 * there is one price chain: godown average → formula cost → shed feed expense.
 * Ingredients the godown has never priced contribute kg but no money and are reported
 * by the caller through `priceOf` returning null.
 */
export function formulaCostPerTonne(formula: Pick<FeedFormula, 'items'>, priceOf: (ingredient: string) => number | null): number {
  return formula.items.reduce((s, it) => s + it.kgPerTonne * (priceOf(it.ingredient) ?? 0), 0);
}

export function feedSummary(shedId: string, feed: FeedConsumption[], from: string, to: string) {
  const items = feed.filter(f => f.shedId === shedId && f.date >= from && f.date <= to);
  return {
    tonnes: items.reduce((s, f) => s + f.tonnes, 0),
    kg: items.reduce((s, f) => s + f.tonnes * 1000, 0),
  };
}
