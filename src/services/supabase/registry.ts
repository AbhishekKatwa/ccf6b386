/**
 * registry.ts — the slice-to-table map the sync engine rides on, carrying exactly the
 * transforms db/import-localstorage.mjs applies, so the browser and the import can never
 * disagree about where a figure lives.
 *
 * Anything the schema has no column for (every `synced`, a voucher's derived `credit`, a
 * trader's cached `outstandingAmount`) is dropped by toRow on purpose: the database is the
 * fact, the client re-derives the read.
 */
import { toRow, fromRow, camel, isUuid } from './rows';
import type { PermissionKey, Role } from '@/types';

export interface ChildDef {
  table: string;
  /** the child's own foreign-key column */
  fk: string;
  /** the client field holding the list (or the single object when `single`) */
  field: string;
  single?: boolean;
  toDb?: (parentId: string, item: any, i: number) => Record<string, unknown>;
  fromDb?: (row: Record<string, unknown>) => any;
}

export interface SliceDef {
  slice: string;
  table: string;
  renames?: Record<string, string>;
  inverse?: Record<string, string>;
  prepare?: (o: any) => any;
  /** which company this client row belongs to — the sync never offers a row across the
   *  membership line RLS draws. Defaults to `companyId`; companies key on their own id. */
  companyOf?: (o: any) => string | undefined;
  /** runs after fromRow, with this row's children already grouped: kids[table] */
  finish?: (o: any, kids: Record<string, any[]>) => any;
  skip?: (o: any) => boolean;
  children?: ChildDef[];
  /**
   * This table's own SELECT verb in 003 — `readKey` is a permission key, `readRoles` the
   * literal role list, exactly as the migration states them.
   *
   * The engine's whole memory is built from the rows the database hands back, so a slice this
   * session cannot read can never be confirmed: every cached row of it looks new on every
   * pass, the queue can never drain, and RLS refuses the write anyway. Such a slice is left
   * alone entirely — not sent, not counted as owed, and above all not read as a delete.
   *
   * Several of these are narrower than the table's INSERT verb on purpose (a labour may book a
   * feed round's consumption but never open the consumption table). That asymmetry belongs to
   * 003; this is its mirror, not a second opinion. RLS stays the boundary.
   */
  readKey?: PermissionKey;
  readRoles?: Role[];
}

const colToDb = (table: string, fk: string) => (parentId: string, item: any, i: number) =>
  toRow(table, { ...item, [camel(fk)]: parentId, position: i });

export const SLICES: SliceDef[] = [
  { slice: 'companies', table: 'companies', companyOf: o => o.id },
  { slice: 'farms', table: 'farms' },
  { slice: 'sheds', table: 'sheds' },
  {
    slice: 'batches', table: 'batches',
    renames: { approximateFeedTonnesPerDay: 'approximate_feed_tpd' },
    inverse: { approximate_feed_tpd: 'approximateFeedTonnesPerDay' },
    children: [{
      table: 'batch_closings', fk: 'batch_id', field: 'closing', single: true,
      toDb: (id, c) => toRow('batch_closings', { ...c, batchId: id }),
      fromDb: r => fromRow('batch_closings', r),
    }],
    finish: (o, kids) => {
      const closing = kids.batch_closings?.[0];
      if (closing) o.closing = closing;
      return o;
    },
  },
  {
    slice: 'assignments', table: 'batch_assignments',
    // user_id is a foreign key on profiles, and the legacy cache keys its people `u_*`: a row
    // naming one has no uuid to offer, so it can never land any more than the person beside it
    // can. The import leaves the same rows out, and pushUsers refuses them for the same reason.
    skip: o => !isUuid(o.userId),
  },
  { slice: 'mortality', table: 'mortality' },
  {
    slice: 'feed', table: 'feed_consumption',
    // 003: the consumption snapshot is the ops roles' read; a labour's round books it but the
    // labour cannot open the table.
    readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'],
    children: [{
      table: 'feed_consumption_deductions', fk: 'consumption_id', field: 'deduction',
      toDb: colToDb('feed_consumption_deductions', 'consumption_id'),
      fromDb: r => fromRow('feed_consumption_deductions', r),
    }],
    finish: (o, kids) => ({ ...o, deduction: kids.feed_consumption_deductions ?? o.deduction }),
  },
  { slice: 'feedRounds', table: 'feed_round_logs' },
  { slice: 'eggs', table: 'egg_collections' },
  { slice: 'eggWastages', table: 'egg_wastages',
    prepare: ({ byGrade, ...r }) => ({
      ...r,
      goodTrays: byGrade?.GOOD ?? 0, brokenTrays: byGrade?.BROKEN ?? 0,
      doubleTrays: byGrade?.DOUBLE ?? 0, smallTrays: byGrade?.SMALL ?? 0,
    }),
    finish: ({ goodTrays, brokenTrays, doubleTrays, smallTrays, ...o }) => ({
      ...o,
      byGrade: { GOOD: goodTrays, BROKEN: brokenTrays, DOUBLE: doubleTrays, SMALL: smallTrays },
    }),
  },
  { slice: 'saleLogs', table: 'sale_logs' },
  {
    slice: 'saleEntries', table: 'sale_entries',
    readKey: 'viewFinance',
    renames: { cashHandledById: 'cash_handled_by' },
    inverse: { cash_handled_by: 'cashHandledById' },
    prepare: ({ rates, lines, credit, ...o }) => ({
      ...o,
      rateGood: rates?.GOOD, rateBroken: rates?.BROKEN,
      rateDouble: rates?.DOUBLE, rateSmall: rates?.SMALL,
    }),
    children: [{
      table: 'sale_entry_lines', fk: 'sale_entry_id', field: 'lines',
      toDb: (id, l: any, i: number) => toRow('sale_entry_lines', {
        shedId: l.shedId,
        goodTrays: l.byGrade?.GOOD, brokenTrays: l.byGrade?.BROKEN,
        doubleTrays: l.byGrade?.DOUBLE, smallTrays: l.byGrade?.SMALL,
        saleEntryId: id, position: i,
      }),
      // the database hands raw snake_case to every child mapper; fromRow is what speaks camel
      fromDb: (r: any) => {
        const c = fromRow('sale_entry_lines', r);
        return {
          shedId: c.shedId,
          byGrade: { GOOD: c.goodTrays, BROKEN: c.brokenTrays, DOUBLE: c.doubleTrays, SMALL: c.smallTrays },
        };
      },
    }],
    finish: (o, kids) => {
      const { rateGood, rateBroken, rateDouble, rateSmall, ...rest } = o;
      rest.lines = kids.sale_entry_lines ?? [];
      rest.rates = { GOOD: rateGood, BROKEN: rateBroken, DOUBLE: rateDouble, SMALL: rateSmall };
      // § the credit a load leaves behind is never stored — v_sale_entry_position derives it,
      // and so does this, off the same four money fields.
      rest.credit = (rest.amount ?? 0) + (rest.laborCharge ?? 0)
        - (rest.cash ?? 0) - (rest.phonepe ?? 0) - (rest.advance ?? 0);
      return rest;
    },
  },
  { slice: 'eggSaleBookings', table: 'egg_sale_bookings', readKey: 'viewFinance' },
  { slice: 'feedStock', table: 'feed_stock', readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'MASTER_ADMIN'] },
  { slice: 'medicineItems', table: 'medicine_items',
    readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR', 'MASTER_ADMIN'] },
  { slice: 'medicineStock', table: 'medicine_stock',
    readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR', 'MASTER_ADMIN'] },
  {
    slice: 'feedFormulas', table: 'feed_formulas',
    readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'],
    children: [{
      table: 'feed_formula_items', fk: 'formula_id', field: 'items',
      toDb: colToDb('feed_formula_items', 'formula_id'),
      fromDb: ({ formulaId, position, ...r }: any) => fromRow('feed_formula_items', r),
    }],
    finish: (o, kids) => ({ ...o, items: kids.feed_formula_items ?? o.items }),
  },
  { slice: 'finance', table: 'finance_txns',
    readKey: 'viewFinance',
    renames: { handledById: 'handled_by', authorizedById: 'authorized_by' },
    inverse: { handled_by: 'handledById', authorized_by: 'authorizedById' },
    // godown is NOT NULL DEFAULT false: absent means exactly that — the row is shed money,
    // not godown money. Stated as the boolean it is, so no row ever reaches the database
    // asking for a null there.
    prepare: o => ({ ...o, godown: o.godown === true }),
  },
  { slice: 'traders', table: 'traders', readKey: 'viewFinance',
    // the balance the list shows is replayed off the ledger by useTraderBalances; a pull
    // carries no cached figure, and none should be needed.
    finish: o => ({ ...o, outstandingAmount: 0 }),
  },
  { slice: 'traderTxns', table: 'trader_txns', readKey: 'viewFinance',
    renames: { handledById: 'handled_by', authorizedById: 'authorized_by' },
    inverse: { handled_by: 'handledById', authorized_by: 'authorizedById' },
  },
  { slice: 'tasks', table: 'tasks' },
  { slice: 'vaccinations', table: 'vaccinations',
    readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR'] },
  {
    slice: 'vaccinationTemplates', table: 'vaccination_templates',
    readRoles: ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR'],
    children: [{
      table: 'vaccination_template_items', fk: 'template_id', field: 'items',
      toDb: colToDb('vaccination_template_items', 'template_id'),
      fromDb: ({ templateId, position, ...r }: any) => fromRow('vaccination_template_items', r),
    }],
    finish: (o, kids) => ({ ...o, items: kids.vaccination_template_items ?? o.items }),
  },
  { slice: 'supportMessages', table: 'support_messages' },
  { slice: 'cashHandovers', table: 'cash_handovers', readKey: 'viewFinance' },
  { slice: 'cashCounts', table: 'cash_counts', readKey: 'viewFinance',
    renames: { closedById: 'closed_by' },
    inverse: { closed_by: 'closedById' },
  },
  {
    slice: 'audit', table: 'audit', readKey: 'manageUsers',
    // A pre-v19 cache still carries the day lock's trail; the table has no verbs for it,
    // and the import drops the same rows.
    skip: o => o.action === 'LOCK' || o.action === 'UNLOCK' || o.entity === 'DayLock',
  },
];

/** id of a client row for the diff — every synced slice is keyed by `id`. */
export const rowId = (o: any): string => String(o.id);

export const SLICE_BY_KEY = new Map(SLICES.map(s => [s.slice, s]));

/** The store keys the engine watches; everything else (session, toasts, online) is local. */
export const SYNCED_SLICES = SLICES.map(s => s.slice).concat(['users', 'ingredientCatalog']);
