import type {
  EggGrade, EggGradeCounts, FeedStockKind, MedicineStockKind, TxnKind,
} from '@/types';
import {
  EGG_GRADE_LABELS, FEED_ROUND_LABELS, PAYMENT_METHOD_LABEL,
} from '@/types';
import type {
  AuditEntry, Batch, CashHandover, EggCollection, EggWastage, FeedConsumption, FeedRoundLog,
  FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry, MortalityEntry, SaleEntry,
  SaleLog, Shed, Trader, User, VaccinationItem,
} from '@/types';
import { format } from 'date-fns';
import { entryTrays, gradeTotal, loadBilled } from '@/lib/calc';
import { fmtDate, fmtIN, fmtKg, fmtMoney, personName, safeDate, timeOf } from '@/lib/format';
import { plainRemarks } from '@/lib/movements';

/* ============================= WHAT THIS IS =============================
 * The farm's operational timeline: one chronological read of what already happened.
 *
 * Nothing is stored here. Every line is derived from a record that already exists — an egg
 * collection, a feed issue, a godown receipt, a medicine draw, a dispatch note, a sale
 * voucher, a money row, a batch placed or closed, a dose given — plus the audit trail, which
 * carries the edits and deletions those records do not keep a line for. There is no event
 * table and no second history.
 *
 * Two rules keep one fact from appearing twice:
 *  - a row that exists only to mirror another row is never its own event. The Finance and
 *    Trader lines a sale voucher writes (they carry its `refId`) are that voucher's own
 *    detail, and the per-ingredient `CONSUMPTION` rows in the godown are the shed's feed
 *    issue seen from the shelf.
 *  - a dose deducted while completing a vaccination rides on the vaccination line, in its own
 *    quantity and unit, instead of standing as a second movement of the same act.
 *
 * Money is read where money lives — `FinanceTxn` is the farm's one payment ledger — and a
 * figure only reaches a line when the reader's role may see it. No value is ever printed out
 * of the audit trail: an edit is reported as an edit, with the reason the farm gave for it.
 */

export type TimelineCategory = 'eggs' | 'feed' | 'medicine' | 'sales' | 'finance' | 'farm' | 'audit';

export const TIMELINE_CATEGORIES: TimelineCategory[] = [
  'eggs', 'feed', 'medicine', 'sales', 'finance', 'farm', 'audit',
];

export const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  eggs: 'Eggs', feed: 'Feed', medicine: 'Medicine', sales: 'Sales',
  finance: 'Finance', farm: 'Farm', audit: 'Audit',
};

/** One line of the timeline — a record, said once, with the screen that owns it. */
export interface TimelineEvent {
  /** `<source>:<record id>`, so the same record can never be listed twice. */
  id: string;
  /** The day the record says it happened, `yyyy-mm-dd`. */
  date: string;
  /** `HH:mm` — the record's own clock, else the moment it was booked. */
  clock: string | null;
  category: TimelineCategory;
  title: string;
  /** Quantities, counterparty and money, already worded. Never a raw value. */
  detail: string | null;
  shedId: string | null;
  batchId: string | null;
  /** That shed and that flock, already named, so a line reads without a lookup. */
  shedLabel: string | null;
  batchLabel: string | null;
  /** Set when the person on the record resolves to someone in this company. */
  userId: string | null;
  /** That person as a name, or the worker's typed name; null when unattributed. */
  by: string | null;
  /** The screen that owns the record, or null when nothing opens it. */
  to: string | null;
}

/**
 * Which modules the reader may open. The timeline carries only what the reader could also go
 * and check for themselves — a shelf line needs the godown, a draw needs the medicine store,
 * a dose needs the flock's Health tab, and money needs Finance.
 */
export interface TimelineAccess {
  money: boolean;
  godown: boolean;
  medicine: boolean;
  vaccination: boolean;
}

/** The category chips this reader is offered — a module they cannot open is never suggested. */
export function categoriesFor(access: TimelineAccess): TimelineCategory[] {
  return TIMELINE_CATEGORIES.filter(c =>
    (c !== 'finance' || access.money)
    && (c !== 'medicine' || access.medicine || access.vaccination));
}

export interface TimelineInput {
  eggs: EggCollection[];
  eggWastages: EggWastage[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  feedRounds: FeedRoundLog[];
  feedStock: FeedStockEntry[];
  medicineStock: MedicineStockEntry[];
  medicineItems: MedicineItem[];
  saleLogs: SaleLog[];
  saleEntries: SaleEntry[];
  finance: FinanceTxn[];
  cashHandovers: CashHandover[];
  batches: Batch[];
  vaccinations: VaccinationItem[];
  audit: AuditEntry[];
  sheds: Shed[];
  users: User[];
  traders: Trader[];
  access: TimelineAccess;
  /**
   * Only these days are read, so a year of history is never turned into lines nobody asked
   * for. Each record is judged by the day it reports, which is not always the day it was booked.
   */
  range?: { from?: string; to?: string };
}

/* ============================= WORDING ============================= */

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** The parts of a detail line, joined the same way everywhere. Empty bits drop out. */
function parts(bits: (string | null | undefined)[]): string | null {
  const have = bits.filter((b): b is string => typeof b === 'string' && b.trim() !== '');
  return have.length ? have.join(' · ') : null;
}

const trays = (n: number) => `${fmtIN(n)} trays`;

/** Only the grades that actually moved, so a collection reads as the four pools it is. */
function gradeBits(g: EggGradeCounts): string | null {
  const list = (Object.keys(g) as EggGrade[])
    .filter(k => (g[k] ?? 0) > 0)
    .map(k => `${fmtIN(g[k])} ${EGG_GRADE_LABELS[k].toLowerCase()}`);
  return list.length ? list.join(', ') : null;
}

const ofGrade = (e: EggCollection): EggGradeCounts => ({
  GOOD: e.goodTrays, BROKEN: e.brokenTrays, DOUBLE: e.doubleTrays, SMALL: e.smallTrays,
});

const STOCK_TITLE: Record<FeedStockKind, string> = {
  OPENING: 'Opening feed stock booked',
  FEED_IN: 'Feed purchase received',
  FEED_OUT: 'Feed issued out of the godown',
  CONSUMPTION: 'Feed consumed by a shed',
  ADJUSTMENT: 'Godown stock adjusted',
  SHORTAGE: 'Godown shortage recorded',
};

const MEDICINE_TITLE: Record<MedicineStockKind, string> = {
  OPENING: 'Opening medicine stock booked',
  RECEIPT: 'Medicine received',
  USAGE: 'Medicine usage recorded',
  ADJUSTMENT: 'Medicine stock adjusted',
};

/** One label per ledger kind; only the ones the ledger actually writes appear on the line. */
const FINANCE_TITLE: Record<TxnKind, string> = {
  INCOME: 'Income recorded',
  EXPENSE: 'Expense recorded',
  PURCHASE: 'Purchase booked',
  SALE: 'Sale booked',
  PAYMENT_IN: 'Payment received',
  PAYMENT_OUT: 'Payment made',
};

/** Entities whose own records already stand on the timeline — a CREATE row would repeat one. */
const SURFACED = new Set([
  'Mortality', 'EggCollection', 'EggWastage', 'FeedConsumption', 'FeedRound', 'SaleLog',
  'SaleEntry', 'FeedStock', 'MedicineStock', 'Finance', 'CashHandover', 'Batch', 'Vaccination',
]);

/** A sign-in is not farm work, and the trader's ledger mirrors a receipt Finance already shows. */
const NEVER = new Set(['Session', 'TraderTxn']);

/** Which module owns an audit row's privacy. A row whose module is closed never appears. */
const AUDIT_OWNER: Record<string, keyof TimelineAccess> = {
  Finance: 'money', Trader: 'money', CashHandover: 'money', CashCount: 'money',
  FeedStock: 'godown', FeedFormula: 'godown',
  MedicineStock: 'medicine', MedicineItem: 'medicine',
  Vaccination: 'vaccination', VaccinationTemplate: 'vaccination',
};

const AUDIT_NOUN: Record<string, string> = {
  Assignment: 'Assignment', Batch: 'Batch', CashCount: 'Cash count', CashHandover: 'Cash handover',
  Company: 'Company', EggCollection: 'Egg collection', EggSaleBooking: 'Sale booking',
  EggWastage: 'Egg wastage', Farm: 'Farm', FeedConsumption: 'Feed issue', FeedFormula: 'Feed formula',
  FeedRound: 'Feed round', FeedStock: 'Godown stock entry', Finance: 'Finance entry',
  MedicineItem: 'Medicine item', MedicineStock: 'Medicine stock entry', Mortality: 'Mortality entry',
  SaleEntry: 'Sale entry', SaleLog: 'Shed dispatch note', Shed: 'Shed', SupportMessage: 'Support message',
  Backup: 'Backup',
  Task: 'Task', Trader: 'Trader', User: 'User', Vaccination: 'Vaccination',
  VaccinationTemplate: 'Vaccination template',
};

const AUDIT_VERB: Record<AuditEntry['action'], string> = {
  CREATE: 'added', UPDATE: 'updated', DELETE: 'removed',
  BACKUP_CREATED: 'exported', RESTORE_STARTED: 'restore started',
  RESTORE_COMPLETED: 'restored', RESTORE_FAILED: 'restore failed',
};

/**
 * A record's own calendar day. Records that carry no date — an audit entry, a batch placement —
 * are dated from the instant they were written, and that instant is UTC: read as a UTC day it
 * would put a late-evening entry on the wrong shelf of an Indian farm's history.
 */
function localDay(iso?: string | null): string {
  const d = iso ? safeDate(iso) : null;
  return d ? format(d, 'yyyy-MM-dd') : iso?.slice(0, 10) ?? '';
}

/** A `snake_field` or `camelField` name as a reader would say it. */
function humanize(field: string): string {  const words = field.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ============================= BUILD ============================= */

interface Seed {
  /** Which source the line comes from, so its id names one record and never two. */
  from: string;
  id: string;
  date: string;
  /** A clock the record itself carries (`HH:mm`). */
  at?: string | null;
  /** The instant the record was booked — what the clock falls back to. */
  bookedAt?: string | null;
  category: TimelineCategory;
  title: string;
  detail?: (string | null | undefined)[];
  by?: string | null;
  userId?: string | null;
  shed?: string | null;
  batch?: string | null;
  to?: string | null;
}

/**
 * The chronological read, and the same rule every ledger follows: newest day first, and
 * inside a day the newest line first, so the latest thing that happened is the first thing
 * a person sees. A record with no clock of its own sits at the bottom of its day rather
 * than pretending to be the morning's work.
 */
export function timelineOrder(a: TimelineEvent, b: TimelineEvent): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const at = a.clock ?? '';
  const bt = b.clock ?? '';
  if (at !== bt) return at < bt ? 1 : -1;
  return b.id.localeCompare(a.id);
}

export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const {
    eggs, eggWastages, mortality, feed, feedRounds, feedStock, medicineStock, medicineItems,
    saleLogs, saleEntries, finance, cashHandovers, batches, vaccinations, audit,
    sheds, users, traders, access,
  } = input;
  const { money, godown, medicine, vaccination } = access;
  const out: TimelineEvent[] = [];

  const shedById = new Map(sheds.map(s => [s.id, s]));
  const batchById = new Map(batches.map(b => [b.id, b]));
  const traderById = new Map(traders.map(t => [t.id, t]));
  const itemById = new Map(medicineItems.map(m => [m.id, m]));

  const shedName = (id?: string | null) => (id ? shedById.get(id)?.name ?? null : null);
  const batchCode = (id?: string | null) => (id ? batchById.get(id)?.code ?? null : null);
  const traderName = (id?: string | null) => (id ? traderById.get(id)?.name ?? 'Trader' : null);
  const itemOf = (id: string) => itemById.get(id);

  /**
   * One line per record, and only inside the days being read. A record is judged by the day it
   * reports, so the window decides here rather than per source loop.
   */
  const keep = (day: string) =>
    (!input.range?.from || day >= input.range.from) && (!input.range?.to || day <= input.range.to);

  /** Where the person on a record stands: an id the filter can use, a name the row can show. */
  const who = (value?: string | null) => {
    const name = personName(users, value);
    return {
      by: name === '—' ? null : name,
      userId: value && users.some(u => u.id === value) ? value : null,
    };
  };

  /** What shed and batch a bare record id belongs to — so the audit trail filters and links too. */
  const scopes = new Map<string, { shed?: string | null; batch?: string | null; to?: string | null }>();
  const note = (entity: string, id: string, scope: { shed?: string | null; batch?: string | null; to?: string | null }) => {
    scopes.set(`${entity}:${id}`, scope);
  };
  mortality.forEach(m => note('Mortality', m.id, { shed: m.shedId, batch: m.batchId, to: `/batches/${m.batchId}/mortality` }));
  eggs.forEach(e => note('EggCollection', e.id, { shed: e.shedId, batch: e.batchId, to: `/batches/${e.batchId}/eggs` }));
  eggWastages.forEach(w => note('EggWastage', w.id, { shed: w.shedId, batch: w.batchId, to: '/eggs' }));
  feed.forEach(f => note('FeedConsumption', f.id, { shed: f.shedId, batch: f.batchId, to: `/sheds/${f.shedId}` }));
  feedRounds.forEach(r => note('FeedRound', r.id, { shed: r.shedId, batch: r.batchId, to: `/sheds/${r.shedId}` }));
  batches.forEach(b => note('Batch', b.id, { shed: b.shedId, batch: b.id, to: `/batches/${b.id}` }));
  saleLogs.forEach(l => note('SaleLog', l.id, { shed: l.shedId, batch: l.batchId, to: '/sales' }));
  saleEntries.forEach(e => note('SaleEntry', e.id, { shed: e.lines[0]?.shedId, to: '/sales' }));
  if (godown) {
    feedStock.forEach(s => note('FeedStock', s.id, { shed: s.shedId, batch: s.batchId, to: `/feed/ingredient/${encodeURIComponent(s.ingredient)}` }));
  }
  if (medicine) {
    medicineStock.forEach(s => note('MedicineStock', s.id, { shed: s.shedId, batch: s.batchId, to: `/medicines/item/${s.medicineId}` }));
  }
  if (money) {
    finance.forEach(f => note('Finance', f.id, { batch: f.batchId ?? null, to: '/finance' }));
  }
  if (vaccination) {
    vaccinations.forEach(v => note('Vaccination', v.id, { shed: v.shedId, batch: v.batchId, to: `/batches/${v.batchId}?tab=health` }));
  }

  const push = (s: Seed) => {
    if (!keep(s.date)) return;
    const clock = s.at && HHMM.test(s.at) ? s.at : (s.bookedAt ? timeOf(s.bookedAt) || null : null);
    out.push({
      id: `${s.from}:${s.id}`,
      date: s.date,
      clock,
      category: s.category,
      title: s.title,
      detail: parts(s.detail ?? []),
      shedId: s.shed ?? null,
      batchId: s.batch ?? null,
      shedLabel: shedName(s.shed),
      batchLabel: batchCode(s.batch),
      userId: s.userId ?? null,
      by: s.by ?? null,
      to: s.to ?? null,
    });
  };

  /* ---------- EGGS ---------- */
  for (const e of eggs) {
    const g = ofGrade(e);
    const w = who(e.createdBy);
    push({
      from: 'egg', id: e.id, date: e.date, bookedAt: e.createdAt, category: 'eggs',
      title: 'Egg collection recorded',
      detail: [trays(gradeTotal(g)), gradeBits(g), e.workerName ? `by ${e.workerName}` : null, plainRemarks(e.remarks)],
      ...w, shed: e.shedId, batch: e.batchId, to: `/batches/${e.batchId}/eggs`,
    });
  }
  for (const waste of eggWastages) {
    const w = who(waste.createdBy);
    push({
      from: 'waste', id: waste.id, date: waste.date, bookedAt: waste.createdAt, category: 'eggs',
      title: 'Eggs discarded',
      detail: [trays(gradeTotal(waste.byGrade)), gradeBits(waste.byGrade), waste.reason, plainRemarks(waste.remarks)],
      ...w, shed: waste.shedId, batch: waste.batchId, to: '/eggs',
    });
  }

  /* ---------- FEED ---------- */
  // The shed's own issue: one line per feeding. The godown's matching ingredient rows are the
  // same fact seen from the shelf, so they never stand as events of their own.
  for (const f of feed) {
    const w = who(f.createdBy);
    push({
      from: 'feed', id: f.id, date: f.date, bookedAt: f.createdAt, category: 'feed',
      title: 'Feed issued',
      detail: [
        `${fmtIN(f.tonnes, 2)} t`,
        f.formulaName ? `mix ${f.formulaName}` : null, plainRemarks(f.remarks),
      ],
      ...w, shed: f.shedId, batch: f.batchId, to: `/sheds/${f.shedId}`,
    });
  }
  for (const r of feedRounds) {
    const w = who(r.createdBy);
    const round = FEED_ROUND_LABELS[r.round];
    push({
      from: 'round', id: r.id, date: r.date, at: r.at, bookedAt: r.createdAt, category: 'feed',
      title: r.status === 'GIVEN' ? `${round} feed round given` : `${round} feed round skipped`,
      detail: [r.workerName ? `by ${r.workerName}` : null, plainRemarks(r.remarks)],
      ...w, shed: r.shedId, batch: r.batchId, to: `/sheds/${r.shedId}`,
    });
  }
  for (const s of godown ? feedStock : []) {
    if (s.kind === 'CONSUMPTION') continue;
    const w = who(s.createdBy);
    const kg = s.kind === 'ADJUSTMENT' || s.kind === 'SHORTAGE' ? fmtKg(s.qtyKg) : fmtKg(Math.abs(s.qtyKg));
    const value = money && s.ratePerKg ? fmtMoney(s.ratePerKg * Math.abs(s.qtyKg)) : null;
    push({
      from: 'stock', id: s.id, date: s.date, bookedAt: s.createdAt, category: 'feed',
      title: STOCK_TITLE[s.kind],
      detail: [
        s.ingredient, kg, s.supplier, s.purchaseRef, value,
        plainRemarks(s.remarks),
      ],
      ...w, shed: s.shedId, batch: s.batchId,
      to: `/feed/ingredient/${encodeURIComponent(s.ingredient)}`,
    });
  }

  /* ---------- MEDICINE AND VACCINES ---------- */
  /** What completing a dose drew, folded into that dose's own line instead of standing twice. */
  const drawn = new Map<string, string[]>();
  if (medicine) {
    for (const s of medicineStock) {
      if (!s.vaccinationId || s.kind !== 'USAGE') continue;
      const item = itemOf(s.medicineId);
      if (!item) continue;
      const bit = `${fmtIN(Math.abs(s.qty))} ${item.unit} ${item.name}`;
      const list = drawn.get(s.vaccinationId);
      if (list) list.push(bit);
      else drawn.set(s.vaccinationId, [bit]);
    }
  }
  for (const s of medicine ? medicineStock : []) {
    if (s.vaccinationId) continue;              // told by the dose that drew it
    const item = itemOf(s.medicineId);
    const w = who(s.createdBy);
    const value = money && s.amount ? fmtMoney(s.amount) : null;
    push({
      from: 'med', id: s.id, date: s.date, bookedAt: s.createdAt, category: 'medicine',
      title: item?.category === 'VACCINE' && s.kind === 'RECEIPT'
        ? 'Vaccine received'
        : item?.category === 'VACCINE' && s.kind === 'USAGE'
          ? 'Vaccine usage recorded'
          : MEDICINE_TITLE[s.kind],
      detail: [
        item?.name, item ? `${fmtIN(Math.abs(s.qty))} ${item.unit}` : null,
        s.supplier, s.purchaseRef, s.lotNumber ? `lot ${s.lotNumber}` : null,
        s.expiryDate ? `exp ${fmtDate(s.expiryDate)}` : null,
        s.reason, s.usedBy ? `used by ${s.usedBy}` : null, value,
        plainRemarks(s.remarks),
      ],
      ...w, shed: s.shedId, batch: s.batchId, to: `/medicines/item/${s.medicineId}`,
    });
  }
  for (const v of vaccination ? vaccinations : []) {
    const to = `/batches/${v.batchId}?tab=health`;
    const dose = drawn.get(v.id)?.join(', ');
    const scheduled = who(v.createdBy);
    push({
      from: 'vacc', id: `${v.id}:scheduled`, date: localDay(v.createdAt), bookedAt: v.createdAt,
      category: 'medicine', title: `Vaccination scheduled — ${v.vaccineName}`,
      detail: [`for ${fmtDate(v.scheduledDate)}`, v.dose, v.route],
      ...scheduled, shed: v.shedId, batch: v.batchId, to,
    });
    if (v.status === 'COMPLETED') {
      const done = who(v.completedBy);
      push({
        from: 'vacc', id: `${v.id}:done`,
        date: v.completedDate ?? localDay(v.completedAt ?? v.updatedAt),
        bookedAt: v.completedAt ?? v.updatedAt,
        category: 'medicine', title: `Vaccination given — ${v.vaccineName}`,
        detail: [
          dose ? `drew ${dose}` : null, v.actualDose ?? v.dose, v.route,
          plainRemarks(v.completionRemarks),
        ],
        ...done, shed: v.shedId, batch: v.batchId, to,
      });
    }
    if (v.status === 'CANCELLED' && v.cancelledAt) {
      const gone = who(v.cancelledBy);
      push({
        from: 'vacc', id: `${v.id}:cancelled`, date: localDay(v.cancelledAt), bookedAt: v.cancelledAt,
        category: 'medicine', title: `Vaccination cancelled — ${v.vaccineName}`,
        detail: [v.cancellationReason],
        ...gone, shed: v.shedId, batch: v.batchId, to,
      });
    }
  }

  /* ---------- SALES ---------- */
  for (const l of saleLogs) {
    const w = who(l.createdBy);
    push({
      from: 'dispatch', id: l.id, date: l.date, bookedAt: l.createdAt, category: 'sales',
      title: 'Shed dispatch note',
      detail: [
        trays(l.trays), EGG_GRADE_LABELS[l.grade],
        l.status === 'ACKNOWLEDGED' ? 'acknowledged' : 'awaiting accounts',
        l.workerName ? `by ${l.workerName}` : null, plainRemarks(l.remarks),
      ],
      ...w, shed: l.shedId, batch: l.batchId, to: '/sales',
    });
  }
  for (const e of saleEntries) {
    const w = who(e.createdBy);
    const shed = e.lines[0]?.shedId;
    push({
      from: 'sale', id: e.id, date: e.date, at: e.cashTime, bookedAt: e.createdAt, category: 'sales',
      title: 'Egg sale created',
      detail: [
        trays(entryTrays(e)), traderName(e.traderId),
        e.lines.length > 1 ? `${e.lines.length} sheds` : null,
        money ? fmtMoney(loadBilled(e.amount, e.laborCharge)) : null,
        money && e.credit > 0 ? `${fmtMoney(e.credit)} still due` : null,
        // a voucher's note quotes its own trade, so it follows the money it describes
        money ? plainRemarks(e.remarks) : null,
      ],
      ...w, shed: shed ?? null, to: `/sales/entry/${e.id}`,
    });
  }

  /* ---------- FINANCE ---------- */
  if (money) {
    // The rows a sale voucher writes carry that voucher's id as their `refId`: same day, same
    // money, already told by the sale line. Everything else here — including a receipt against
    // a sale, which arrives on its own day — is money the farm moved on its own.
    const voucher = new Set(saleEntries.map(e => e.id));
    for (const f of finance) {
      if (f.refId && voucher.has(f.refId)) continue;
      const w = who(f.createdBy);
      push({
        from: 'fin', id: f.id, date: f.date, at: f.time, bookedAt: f.createdAt, category: 'finance',
        title: FINANCE_TITLE[f.kind],
        detail: [
          fmtMoney(f.amount), f.category, f.counterparty,
          f.paymentMethod ? PAYMENT_METHOD_LABEL[f.paymentMethod] : null,
          f.godown ? 'godown' : batchCode(f.batchId), f.reference, plainRemarks(f.remarks),
        ],
        ...w, batch: f.batchId ?? null,
        to: f.saleId ? `/sales/entry/${f.saleId}` : '/finance',
      });
    }
    for (const h of cashHandovers) {
      const w = who(h.createdBy);
      push({
        from: 'cash', id: h.id, date: h.date, at: h.time, bookedAt: h.createdAt, category: 'finance',
        title: 'Cash handed over',
        detail: [
          fmtMoney(h.amount),
          `${personName(users, h.fromUserId)} → ${personName(users, h.toUserId)}`,
          h.reason, h.reference,
        ],
        ...w, to: '/finance',
      });
    }
  }

  /* ---------- FARM: the flock itself ---------- */
  for (const m of mortality) {
    const w = who(m.createdBy);
    push({
      from: 'mort', id: m.id, date: m.date, bookedAt: m.createdAt, category: 'farm',
      title: 'Mortality recorded',
      detail: [
        `${fmtIN(m.count)} ${m.count === 1 ? 'bird' : 'birds'}`,
        m.workerName ? `found by ${m.workerName}` : null, plainRemarks(m.remarks),
      ],
      ...w, shed: m.shedId, batch: m.batchId, to: `/batches/${m.batchId}/mortality`,
    });
  }
  for (const b of batches) {
    const w = who(b.createdBy);
    push({
      from: 'batch', id: `${b.id}:placed`, date: localDay(b.createdAt), bookedAt: b.createdAt,
      category: 'farm', title: 'Batch placed',
      detail: [
        `${fmtIN(b.initialBirds)} birds`, b.breed,
        b.placementDate !== localDay(b.createdAt) ? `placed ${fmtDate(b.placementDate)}` : null,
      ],
      ...w, shed: b.shedId, batch: b.id, to: `/batches/${b.id}`,
    });
    const c = b.closing;
    if (c) {
      const closed = who(c.closedBy);
      push({
        from: 'batch', id: `${b.id}:closed`, date: localDay(c.closedAt || c.date), bookedAt: c.closedAt,
        category: 'farm', title: 'Batch closed',
        detail: [
          `${fmtIN(c.finalBirds)} birds left`, c.buyer,
          money && c.saleAmount ? fmtMoney(c.saleAmount) : null,
          money ? plainRemarks(c.remarks) : null,
        ],
        ...closed, shed: b.shedId, batch: b.id, to: `/batches/${b.id}`,
      });
    }
  }

  /* ---------- AUDIT: what the records do not keep a line for ---------- */
  for (const a of audit) {
    if (NEVER.has(a.entity)) continue;
    if (a.action === 'CREATE' && SURFACED.has(a.entity)) continue;
    const owner = AUDIT_OWNER[a.entity];
    if (owner && !access[owner]) continue;
    const scope = scopes.get(`${a.entity}:${a.entityId}`);
    const w = who(a.byUserId);
    push({
      from: 'audit', id: a.id, date: localDay(a.at), bookedAt: a.at, category: 'audit',
      title: `${AUDIT_NOUN[a.entity] ?? a.entity} ${AUDIT_VERB[a.action]}`,
      detail: [a.field ? humanize(a.field) : null, a.reason],
      ...w, shed: scope?.shed ?? null, batch: scope?.batch ?? null, to: scope?.to ?? null,
    });
  }

  return out.sort(timelineOrder);
}
