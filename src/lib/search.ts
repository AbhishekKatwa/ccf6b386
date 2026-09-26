import type {
  Batch, FeedFormula, FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry,
  MortalityEntry, PaymentMethod, SaleEntry, SaleLog, Shed, Trader, TraderTxn,
} from '@/types';
import { PAYMENT_METHOD_LABEL } from '@/types';
import { liveBirdsOn } from '@/lib/calc';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';

/* ============================== GLOBAL SEARCH ==============================
 * One pure index over the records the store already holds, plus one scoring pass.
 * It reads nothing: the caller hands in company-filtered slices and the role flags
 * that decide which groups exist at all, so a record that has no permission to be
 * listed never reaches the matcher (§5, §14).
 */

export type SearchKind =
  | 'shed' | 'batch' | 'trader' | 'sale' | 'dispatch' | 'purchase' | 'payment'
  | 'feed' | 'formula' | 'medicine' | 'report' | 'page';

export interface SearchItem {
  /** kind + record id — stable across rebuilds so keyboard focus survives a re-index. */
  key: string;
  kind: SearchKind;
  group: string;
  title: string;
  subtitle?: string;
  /** Right-aligned figure: a count, a weight or a rupee amount. */
  meta?: string;
  href: string;
  /** What the row says the result opens, e.g. "Open shed". */
  action: string;
  /** Pre-lowercased title so the scorer never re-slices on a keystroke. */
  t: string;
  /** Pre-lowercased everything searchable, joined once at build time. */
  hay: string;
  /** Position within its group — newer and larger records answer first. */
  rank: number;
  icon?: unknown;
}

/** A report as far as search cares: title, words, and whether it carries money. */
export interface ReportEntry {
  id: string;
  title: string;
  desc: string;
  financeOnly?: boolean;
}

export interface SearchInput {
  sheds: Shed[];
  batches: Batch[];
  mortality: MortalityEntry[];
  traders: Trader[];
  saleEntries: SaleEntry[];
  saleLogs: SaleLog[];
  feedStock: FeedStockEntry[];
  feedFormulas: FeedFormula[];
  medicineItems: MedicineItem[];
  medicineStock: MedicineStockEntry[];
  finance: FinanceTxn[];
  traderTxns: TraderTxn[];
  reports: ReportEntry[];
}

/** Which modules this person may open. A false flag drops the whole group. */
export interface SearchAccess {
  ops: boolean;
  commerce: boolean;
  godown: boolean;
  medicine: boolean;
  reports: boolean;
  finance: boolean;
  formulas: boolean;
}

export const EMPTY_INPUT: SearchInput = {
  sheds: [], batches: [], mortality: [], traders: [], saleEntries: [], saleLogs: [],
  feedStock: [], feedFormulas: [], medicineItems: [], medicineStock: [],
  finance: [], traderTxns: [], reports: [],
};

/** Fixed reading order: the farm first, then its stock, then its money. */
export const GROUP_ORDER = [
  'Pages', 'Sheds', 'Batches', 'Feed', 'Medicines', 'Purchases', 'Egg sales', 'Traders', 'Payments', 'Reports',
];

/** Dates fall newest-first so "yesterday's maize" beats a receipt from last year. */
function byDateDesc(a: { date: string; createdAt?: string }, b: { date: string; createdAt?: string }): number {
  return b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

const num = (n: number | undefined) => (Number.isFinite(n) ? String(Math.round(n ?? 0)) : '');
const kg = (n: number) => `${Math.round(n)} kg`;
const method = (m?: PaymentMethod) => (m ? PAYMENT_METHOD_LABEL[m] : '');

interface Draft {
  kind: SearchKind; group: string; title: string; subtitle?: string; meta?: string;
  href: string; action: string; words: string[]; rank: number;
  /** The record's own id where several records share one destination. */
  rid?: string;
  icon?: unknown;
}

function finalize(d: Draft): SearchItem {
  const t = d.title.toLowerCase();
  const hay = [t, d.subtitle?.toLowerCase() ?? '', d.words.join(' ').toLowerCase()].join(' ');
  return {
    key: `${d.kind}:${d.rid ?? d.href}`, kind: d.kind, group: d.group, title: d.title,
    subtitle: d.subtitle, meta: d.meta, href: d.href, action: d.action,
    t, hay, rank: d.rank, icon: d.icon,
  };
}

/* Each ledger is capped before it is indexed: a person types a name, not a scan
 * request, and the newest few hundred rows of any ledger hold every real answer. */
const LEDGER_CAP = 300;

/**
 * Build the searchable index for one company context. Cheap enough to rerun when a
 * slice changes (a few hundred rows) and pure, so a test can call it directly.
 */
export function buildSearchIndex(i: SearchInput, a: SearchAccess): SearchItem[] {
  const out: Draft[] = [];
  const today = todayISO();

  if (a.ops) {
    i.sheds.forEach((s, rank) => {
      const batch = i.batches.find(b => b.shedId === s.id && b.status === 'ACTIVE');
      const birds = batch ? liveBirdsOn(batch, today, i.mortality) : 0;
      out.push({
        kind: 'shed', group: 'Sheds', title: s.name, action: 'Open shed', href: `/sheds/${s.id}`, rank,
        subtitle: [`${birds ? birds.toLocaleString('en-IN') : s.capacity.toLocaleString('en-IN')} birds`,
          `capacity ${s.capacity.toLocaleString('en-IN')}`, s.status.toLowerCase()].join(' · '),
        words: [s.id, s.status, String(birds), String(s.capacity), 'shed',
          ...i.batches.filter(b => b.shedId === s.id).map(b => b.code)],
      });
    });

    [...i.batches].sort((x, y) => y.placementDate.localeCompare(x.placementDate)).forEach((b, rank) => {
      const shed = i.sheds.find(s => s.id === b.shedId);
      const birds = b.status === 'ACTIVE' ? liveBirdsOn(b, today, i.mortality) : b.closing?.finalBirds ?? b.initialBirds;
      out.push({
        kind: 'batch', group: 'Batches', title: b.code, action: 'Open batch', href: `/batches/${b.id}`, rank,
        subtitle: `${shed?.name ?? 'Unassigned shed'} · ${birds.toLocaleString('en-IN')} birds · ${b.status.toLowerCase()}`,
        words: [b.id, b.breed, b.birdType, b.status, shed?.name ?? '', String(birds), fmtDate(b.placementDate), 'batch'],
      });
    });
  }

  if (a.godown) {
    // One entry per ingredient: the godown's own screen already aggregates the ledger,
    // and searching every consumption row would only repeat the same names.
    const byIngredient = new Map<string, { kg: number; supplier?: string; date: string }>();
    [...i.feedStock].sort(byDateDesc).forEach(e => {
      const cur = byIngredient.get(e.ingredient);
      if (cur) { cur.kg += e.qtyKg; if (!cur.supplier && e.supplier) cur.supplier = e.supplier; }
      else byIngredient.set(e.ingredient, { kg: e.qtyKg, supplier: e.supplier, date: e.date });
    });
    [...byIngredient.entries()]
      .sort((x, y) => y[1].kg - x[1].kg)
      .forEach(([ingredient, v], rank) => out.push({
        kind: 'feed', group: 'Feed', title: ingredient, action: 'Open in godown', rank,
        href: `/feed?q=${encodeURIComponent(ingredient)}`,
        subtitle: `godown stock · ${kg(v.kg)}${v.supplier ? ` · ${v.supplier}` : ''}`,
        words: [ingredient.toLowerCase(), 'feed', 'godown', 'ingredient', num(v.kg)],
      }));

    i.feedStock.filter(e => e.purchaseRef).sort(byDateDesc).slice(0, LEDGER_CAP).forEach((e, rank) => out.push({
      kind: 'purchase', group: 'Purchases', title: e.purchaseRef!, action: 'Open purchase', rank,
      href: `/feed?tab=ledger&movement=${e.id}`,
      subtitle: `${e.ingredient} · ${kg(Math.abs(e.qtyKg))}${e.supplier ? ` · ${e.supplier}` : ''} · ${fmtDate(e.date)}`,
      meta: e.ratePerKg ? fmtMoney(Math.abs(e.qtyKg) * e.ratePerKg) : undefined,
      words: [e.purchaseRef!, e.ingredient.toLowerCase(), e.supplier ?? '', e.kind.toLowerCase(),
        fmtDate(e.date), e.remarks ?? '', num(e.qtyKg), 'purchase', 'feed in'],
    }));
  }

  if (a.formulas) {
    [...i.feedFormulas].sort((x, y) => y.version - x.version || y.effectiveFrom.localeCompare(x.effectiveFrom))
      .forEach((f, rank) => out.push({
        kind: 'formula', group: 'Feed', title: f.name, action: 'Open formula', href: `/feed/formulas/${f.id}`, rank,
        subtitle: `v${f.version} · ${i.sheds.find(s => s.id === f.shedId)?.name ?? 'all sheds'} · ${f.status.toLowerCase()}`,
        words: [f.name.toLowerCase(), f.id, f.familyId, f.status, f.changeReason ?? '',
          i.sheds.find(s => s.id === f.shedId)?.name ?? '', 'formula', `v${f.version}`],
      }));
  }

  if (a.medicine) {
    [...i.medicineItems].sort((x, y) => x.name.localeCompare(y.name)).forEach((m, rank) => out.push({
      kind: 'medicine', group: 'Medicines', title: m.name, action: 'Open medicine', href: `/medicines/item/${m.id}`, rank,
      subtitle: `${m.category.toLowerCase()} · ${m.unit}${m.specifications ? ` · ${m.specifications}` : ''}`,
      words: [m.name.toLowerCase(), m.category.toLowerCase(), m.unit, m.specifications ?? '', m.id,
        'medicine', 'drug', 'vaccine'],
    }));
    i.medicineStock.filter(e => e.purchaseRef).sort(byDateDesc).slice(0, LEDGER_CAP).forEach((e, rank) => out.push({
      kind: 'purchase', group: 'Purchases', title: e.purchaseRef!, action: 'Open purchase', rank,
      href: `/medicines?tab=ledger&movement=${e.id}`,
      subtitle: `${i.medicineItems.find(m => m.id === e.medicineId)?.name ?? 'Medicine'} · ${Math.abs(e.qty)} ${e.kind === 'RECEIPT' ? 'received' : e.kind.toLowerCase()} · ${fmtDate(e.date)}`,
      meta: e.amount ? fmtMoney(e.amount) : undefined,
      words: [e.purchaseRef!, i.medicineItems.find(m => m.id === e.medicineId)?.name.toLowerCase() ?? '',
        e.supplier ?? '', e.lotNumber ?? '', fmtDate(e.date), e.remarks ?? '', num(e.qty), 'purchase'],
    }));
  }

  if (a.commerce) {
    [...i.traders].sort((x, y) => y.outstandingAmount - x.outstandingAmount || x.name.localeCompare(y.name))
      .forEach((t, rank) => out.push({
        kind: 'trader', group: 'Traders', title: t.name, action: 'Open trader', href: `/traders/${t.id}`, rank,
        subtitle: `${t.mobile}${t.active ? '' : ' · inactive'}${a.finance ? ` · outstanding ${fmtMoney(t.outstandingAmount)}` : ''}`,
        words: [t.name.toLowerCase(), t.mobile, t.gstin ?? '', t.address ?? '', t.id, 'trader', 'buyer',
          num(t.outstandingAmount)],
      }));
  }

  if (a.ops) {
    [...i.saleEntries].sort(byDateDesc).slice(0, LEDGER_CAP).forEach((e, rank) => {
      const trader = i.traders.find(t => t.id === e.traderId);
      const trays = e.lines.reduce((n, l) => n + Object.values(l.byGrade).reduce((k, v) => k + v, 0), 0);
      out.push({
        kind: 'sale', group: 'Egg sales', title: e.cashReference || `${trader?.name ?? 'Trader'} · ${fmtDate(e.date)}`,
        action: 'Open sale', href: `/sales/entry/${e.id}`, rank,
        subtitle: `${trader?.name ?? 'Trader'} · ${trays} trays · ${fmtDate(e.date)}`,
        meta: a.finance ? fmtMoney(e.amount) : undefined,
        words: [e.cashReference ?? '', trader?.name.toLowerCase() ?? '', e.remarks ?? '', fmtDate(e.date),
          e.pricing.toLowerCase(), String(trays), num(e.amount), 'sale', 'eggs'],
      });
    });
    [...i.saleLogs].sort(byDateDesc).slice(0, LEDGER_CAP).forEach((l, rank) => {
      const shed = i.sheds.find(s => s.id === l.shedId);
      out.push({
        kind: 'dispatch', group: 'Egg sales', title: `Dispatch · ${shed?.name ?? 'Shed'} · ${fmtDate(l.date)}`,
        action: 'Open dispatch log', href: '/sales?tab=logs', rid: l.id, rank,
        subtitle: `${l.trays} trays ${l.grade.toLowerCase()} · ${l.status === 'PENDING' ? 'awaiting accounts' : 'acknowledged'}`,
        words: [shed?.name.toLowerCase() ?? '', l.grade.toLowerCase(), l.workerName ?? '', fmtDate(l.date),
          String(l.trays), l.status.toLowerCase(), 'dispatch', 'log'],
      });
    });
  }

  if (a.finance) {
    [...i.finance].sort(byDateDesc).slice(0, LEDGER_CAP).forEach((t, rank) => {
      const paidFor = t.purchaseId
        ? i.feedStock.find(e => e.id === t.purchaseId)?.purchaseRef ?? i.medicineStock.find(e => e.id === t.purchaseId)?.purchaseRef
        : undefined;
      out.push({
        kind: 'payment', group: 'Payments', title: t.reference || paidFor || t.category,
        action: 'Open payment', rid: t.id, rank,
        href: t.saleId ? `/sales/entry/${t.saleId}?payment=${t.id}`
          : t.purchaseId ? `/finance?pay=${t.purchaseId}`
            : `/finance?dir=${t.kind === 'INCOME' || t.kind === 'PAYMENT_IN' ? 'in' : 'out'}`,
        subtitle: [t.category, t.counterparty, fmtDate(t.date), method(t.paymentMethod), t.godown ? 'godown' : '']
          .filter(Boolean).join(' · '),
        meta: fmtMoney(t.amount),
        words: [t.reference ?? '', paidFor ?? '', t.category.toLowerCase(), t.counterparty ?? '', t.remarks ?? '',
          fmtDate(t.date), method(t.paymentMethod), t.kind.toLowerCase(), num(t.amount), 'payment', 'receipt'],
      });
    });
    [...i.traderTxns].filter(t => t.kind === 'PAYMENT_IN' || t.kind === 'PAYMENT_OUT')
      .sort(byDateDesc).slice(0, LEDGER_CAP).forEach((t, rank) => {
        const trader = i.traders.find(x => x.id === t.traderId);
        out.push({
          kind: 'payment', group: 'Payments', title: t.reference || `${trader?.name ?? 'Trader'} payment`,
          action: 'Open payment', rid: t.id, rank,
          href: t.refId && t.kind === 'PAYMENT_IN' ? `/sales/entry/${t.refId}?payment=${t.id}` : `/traders/${t.traderId}`,
          subtitle: `${trader?.name ?? 'Trader'} · ${t.kind === 'PAYMENT_IN' ? 'received' : 'paid out'} · ${fmtDate(t.date)}${t.paymentMethod ? ` · ${method(t.paymentMethod)}` : ''}`,
          meta: fmtMoney(t.amount),
          words: [t.reference ?? '', trader?.name.toLowerCase() ?? '', t.remarks ?? '', fmtDate(t.date),
            method(t.paymentMethod), num(t.amount), 'payment'],
        });
      });
  }

  if (a.reports) {
    i.reports.filter(r => !r.financeOnly || a.finance).forEach((r, rank) => out.push({
      kind: 'report', group: 'Reports', title: r.title, action: 'Open report', href: `/reports/${r.id}`, rank,
      subtitle: r.desc,
      words: [r.title.toLowerCase(), r.desc.toLowerCase(), r.id.replace(/_/g, ' '), 'report'],
    }));
  }

  return out.map(finalize);
}

/* ============================== matching ============================== */

export const PER_GROUP_CAP = 6;
export const TOTAL_CAP = 40;

/**
 * Every term must appear somewhere on the record, and a hit at the start of the title
 * is worth more than one buried in the remarks. Ties break inside the group's own order,
 * so an unqualified "Shed" still lists them the way the shed screen does.
 */
export function scoreItem(item: SearchItem, terms: string[], title: string): number | null {
  let s = 0;
  for (const t of terms) {
    if (!item.hay.includes(t)) return null;
    const at = title.indexOf(t);
    if (at === 0) s += 100;
    else if (at > 0 && /[\s(/·,-]/.test(title[at - 1])) s += 70;
    else if (at > 0) s += 45;
    else if (t.length >= 3 && item.hay.includes(` ${t}`)) s += 14;
    else s += 5;
  }
  if (title === terms.join(' ')) s += 400;
  return s - item.rank * 0.5;
}

export interface SearchResult { group: string; items: SearchItem[] }

/** Run one query over the index. Returns groups in GROUP_ORDER, each within its cap. */
export function runSearch(items: SearchItem[], query: string, perGroup = PER_GROUP_CAP, total = TOTAL_CAP): SearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of items) {
    const score = scoreItem(item, terms, item.t);
    if (score !== null) scored.push({ item, score });
  }
  const byGroup = new Map<string, SearchItem[]>();
  for (const { item, score } of scored.sort((a, b) => b.score - a.score || a.item.rank - b.item.rank)) {
    const list = byGroup.get(item.group) ?? [];
    if (list.length < perGroup) list.push(item);
    byGroup.set(item.group, list);
  }
  const out: SearchResult[] = [];
  let taken = 0;
  for (const group of GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list?.length) continue;
    const room = Math.max(0, total - taken);
    if (!room) break;
    const cut = list.slice(0, room);
    taken += cut.length;
    out.push({ group, items: cut });
  }
  return out;
}

/** The single row a bare Enter should open: the best match across every group. */
export function topResult(results: SearchResult[]): SearchItem | null {
  return results[0]?.items[0] ?? null;
}
