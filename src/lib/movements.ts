/**
 * Godown ledger movements — a read‑only view of the existing `FeedStockEntry` rows.
 *
 * The ledger stays the source of truth: this only groups rows the way the godown
 * thinks about them (one shed feeding is many ingredient rows behind one event) and
 * attaches the price each row was actually booked at, taken from `valuation.basis`.
 * No quantity, average or value is recalculated here.
 */
import type { Batch, FeedConsumption, FeedStockEntry, Shed } from '@/types';
import type { GodownValuation, MovementPositions } from './valuation';
import { stockDelta } from './calc';
import { shiftDate } from './format';
import { type Range } from './analytics';

/** Ledger entry types as the godown names them. A negative adjustment is a shortage. */
export type MovementKind = 'FEED_IN' | 'OPENING' | 'CONSUMPTION' | 'FEED_OUT' | 'ADJUSTMENT' | 'SHORTAGE';

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  FEED_IN: 'Feed in',
  OPENING: 'Opening',
  CONSUMPTION: 'Feed given',
  FEED_OUT: 'Feed out',
  ADJUSTMENT: 'Adjustment',
  SHORTAGE: 'Shortage',
};

/** One godown row, with the price and the shelf state it moved against. */
export type MovementLine = {
  entryId: string;
  ingredient: string;
  /** Magnitude of KG that moved; the direction is the movement's. */
  qtyKg: number;
  /** ₹/kg this row was booked at, or null when nothing priced it. */
  avg: number | null;
  /** ₹ this row added to or took out of the godown's value, or null when unpriced. */
  cost: number | null;
  unpricedKg: number;
  /** The receipt rate as written on the entry, when it carried one. */
  ratePerKg: number | null;
  /** The shelf immediately around this row; null when the replay never read it. */
  place: MovementPositions | null;
  remarks?: string;
};

export type Movement = {
  key: string;
  date: string;
  /** When the ledger row(s) were booked — the tie-break that keeps same-day entries newest-first. */
  createdAt?: string;
  kind: MovementKind;
  incoming: boolean;
  title: string;
  /** Context that belongs under the title: shed, batch, mix, remarks. */
  context: string;
  totalKg: number;
  lines: MovementLine[];
  /** ₹ across the priced lines; null when the movement carries no price at all. */
  value: number | null;
  unpricedKg: number;
  ingredient?: string;
  shedName?: string;
  batchCode?: string;
  formulaName?: string;
  formulaVersion?: number | null;
  formulaId?: string;
  tonnes?: number;
  remarks?: string;
  /** Who booked the ledger row(s), once they can be named. */
  by?: string;
  entries: FeedStockEntry[];
};

export type LedgerTotals = {
  movements: number;
  ingredients: number;
  byKind: Record<MovementKind, { count: number; kg: number }>;
};

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** A remark worth showing to a human — the ledger's internal `ref:` links are not. */
export function plainRemarks(r: string | undefined | null): string | null {
  if (!r) return null;
  if (r.startsWith('ref:') || r.startsWith('reverse ref:')) return null;
  return r;
}

/** Group, label and price the ledger without touching a single number in it. */
/** The calendar month a movement sits in, as the window the accounting selectors take. */
export function monthRangeOf(iso: string): Range | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const month = iso.slice(0, 7);
  // The accounting selectors read only `from`/`to`; this is a real calendar span.
  return { key: '30D', days: last, from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** 'Today' / 'Yesterday' for a day group; null when the date needs no relative label. */
export function dayGroupLabel(iso: string, today: string): string | null {
  if (iso === today) return 'Today';
  if (shiftDate(iso, 1) === today) return 'Yesterday';
  return null;
}

export function godownMovements(
  stock: FeedStockEntry[],
  valuation: GodownValuation,
  refs: { sheds: Shed[]; batches: Batch[]; feed: FeedConsumption[]; users?: { id: string; name: string }[] },
): Movement[] {
  const lineOf = (e: FeedStockEntry): MovementLine => {
    const b = valuation.basis(e.id);
    const rate = typeof e.ratePerKg === 'number' && Number.isFinite(e.ratePerKg) && e.ratePerKg > 0 ? e.ratePerKg : null;
    return {
      entryId: e.id,
      ingredient: e.ingredient,
      qtyKg: Math.abs(e.qtyKg),
      avg: b.avg,
      cost: b.value,
      unpricedKg: b.unpricedKg,
      ratePerKg: rate,
      place: valuation.positions(e.id),
      remarks: e.remarks,
    };
  };

  type Draft = Movement & { shedId?: string; batchId?: string; refId?: string };
  const drafts = new Map<string, Draft>();

  for (const e of stock) {
    // A shed feeding is booked as one row per ingredient sharing a `ref:<consumptionId>`.
    if (e.kind === 'CONSUMPTION' && e.shedId) {
      const key = `cons|${e.date}|${e.shedId}|${e.remarks ?? ''}`;
      let ev = drafts.get(key);
      if (!ev) {
        ev = {
          key, date: e.date, kind: 'CONSUMPTION', incoming: false, title: '', context: '',
          totalKg: 0, lines: [], value: null, unpricedKg: 0,
          shedId: e.shedId, batchId: e.batchId, entries: [],
          createdAt: e.createdAt,
          refId: e.remarks?.startsWith('ref:') ? e.remarks.slice(4) : undefined,
        };
        drafts.set(key, ev);
      }
      ev.totalKg += e.qtyKg;
      ev.lines.push(lineOf(e));
      ev.entries.push(e);
      if (!ev.createdAt || e.createdAt > ev.createdAt) ev.createdAt = e.createdAt;
      if (!ev.batchId && e.batchId) ev.batchId = e.batchId;
      continue;
    }

    const delta = stockDelta(e);
    // A booked shortage is its own type; a negative adjustment reads as one too.
    const kind: MovementKind = e.kind === 'SHORTAGE' ? 'SHORTAGE'
      : e.kind === 'ADJUSTMENT' ? (delta < 0 ? 'SHORTAGE' : 'ADJUSTMENT')
      : e.kind;
    drafts.set(e.id, {
      key: e.id, date: e.date, kind, incoming: delta > 0,
      title: e.ingredient, context: '',
      totalKg: Math.abs(e.qtyKg), lines: [lineOf(e)],
      value: null, unpricedKg: 0,
      createdAt: e.createdAt,
      ingredient: e.ingredient, shedId: e.shedId, batchId: e.batchId,
      remarks: e.remarks, entries: [e],
    });
  }

  const shedName = new Map(refs.sheds.map(s => [s.id, s.name]));
  const batchCode = new Map(refs.batches.map(b => [b.id, b.code]));
  const userName = new Map((refs.users ?? []).map(u => [u.id, u.name]));

  for (const ev of drafts.values()) {
    let cost = 0, unpricedKg = 0, priced = false;
    for (const l of ev.lines) {
      unpricedKg += l.unpricedKg;
      if (l.cost === null) continue;
      cost += l.cost;
      priced = true;
    }
    ev.value = priced ? round2(cost) : null;
    ev.unpricedKg = round2(unpricedKg);
    ev.totalKg = round2(ev.totalKg);
    ev.lines.sort((a, b) => b.qtyKg - a.qtyKg);

    const who = new Set(ev.entries.map(e => userName.get(e.createdBy)).filter(Boolean) as string[]);
    if (who.size === 1) ev.by = [...who][0];
    else if (who.size > 1) ev.by = 'Multiple';

    if (ev.kind === 'CONSUMPTION') {
      const fed = ev.refId ? refs.feed.find(f => f.id === ev.refId) : null;
      const shed = ev.shedId ? shedName.get(ev.shedId) : undefined;
      ev.title = `Feed given · ${shed ?? 'Shed'}`;
      ev.shedName = shed;
      ev.batchCode = (ev.batchId ? batchCode.get(ev.batchId) : undefined)
        ?? (fed ? batchCode.get(fed.batchId) : undefined);
      ev.formulaName = fed?.formulaName ?? undefined;
      ev.formulaVersion = fed?.formulaVersion ?? undefined;
      ev.formulaId = fed?.formulaId;
      ev.tonnes = typeof fed?.tonnes === 'number' && Number.isFinite(fed.tonnes) ? fed.tonnes : undefined;
      ev.remarks = fed?.remarks ?? ev.entries[0]?.remarks;
      const bits = [`${ev.lines.length} ingredient${ev.lines.length === 1 ? '' : 's'}`];
      if (ev.tonnes) bits.push(`${round2(ev.tonnes)} t given`);
      // The feeding's own formula if the record has one, else whatever the ledger row said.
      const noted = plainRemarks(ev.entries[0]?.remarks);
      if (ev.formulaName) bits.push(`${ev.formulaName}${ev.formulaVersion ? ` V${ev.formulaVersion}` : ''}`);
      else if (noted) bits.push(noted);
      else bits.push('no feeding record behind these rows');
      ev.context = bits.join(' · ');
      continue;
    }

    const bits: string[] = [];
    if (ev.kind === 'SHORTAGE') bits.push('Counted short');
    else if (ev.kind === 'ADJUSTMENT') bits.push(ev.incoming ? 'Stock returned' : 'Stock corrected');
    else if (ev.kind === 'FEED_IN') bits.push(ev.lines[0]?.ratePerKg ? 'Receipt · average re-weighted' : 'Receipt at no rate');
    else if (ev.kind === 'OPENING') bits.push('Opening balance');
    else if (ev.kind === 'FEED_OUT') bits.push('Issued out');
    else if (ev.kind === 'CONSUMPTION') bits.push('Consumed');
    if (ev.shedId) { const shed = shedName.get(ev.shedId); if (shed) bits.push(`Shed ${shed}`); }
    const noted = plainRemarks(ev.remarks);
    if (noted) bits.push(noted);
    ev.context = bits.join(' · ');
  }

  // Newest day first, then newest booking, then the key — a fresh row always leads its day.
  return [...drafts.values()]
    .sort((a, b) => b.date.localeCompare(a.date)
      || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      || b.key.localeCompare(a.key));
}

export const MOVEMENT_KINDS: MovementKind[] = ['OPENING', 'FEED_IN', 'CONSUMPTION', 'ADJUSTMENT', 'SHORTAGE', 'FEED_OUT'];

/** Counts and KG per entry type — every figure here is a sum of ledger rows. */
export function ledgerTotals(movements: Movement[]): LedgerTotals {
  const kinds = MOVEMENT_KINDS;
  const byKind = Object.fromEntries(kinds.map(k => [k, { count: 0, kg: 0 }])) as LedgerTotals['byKind'];
  const ingredients = new Set<string>();
  for (const m of movements) {
    const b = byKind[m.kind];
    b.count += 1;
    b.kg += m.totalKg;
    for (const l of m.lines) ingredients.add(l.ingredient);
  }
  for (const b of Object.values(byKind)) b.kg = round2(b.kg);
  return { movements: movements.length, ingredients: ingredients.size, byKind };
}

/** One movement seen from a single ingredient: the event, and this ingredient's line in it. */
export type IngredientEvent = { movement: Movement; line: MovementLine };

/** Every movement that touched this ingredient, newest first — its own traceable history. */
export function ingredientEvents(movements: Movement[], ingredient: string): IngredientEvent[] {
  const out: IngredientEvent[] = [];
  for (const m of movements) {
    const line = m.lines.find(l => l.ingredient === ingredient);
    if (line) out.push({ movement: m, line });
  }
  return out;
}

/** Signed KG and the ₹ magnitude each entry type contributed to one ingredient. */
export type IngredientFlow = Record<MovementKind, { count: number; kg: number; value: number }>;

/** Opening + in − out always lands on the current stock: these are the ledger's own lines. */
export function ingredientFlow(events: IngredientEvent[]): IngredientFlow {
  const flow = Object.fromEntries(MOVEMENT_KINDS.map(k => [k, { count: 0, kg: 0, value: 0 }])) as IngredientFlow;
  for (const { movement, line } of events) {
    const f = flow[movement.kind];
    f.count += 1;
    f.kg += line.qtyKg * (movement.incoming ? 1 : -1);
    f.value += line.cost ?? 0;
  }
  for (const f of Object.values(flow)) {
    f.kg = round2(f.kg);
    f.value = round2(f.value);
  }
  return flow;
}
