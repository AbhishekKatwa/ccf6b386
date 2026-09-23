import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, HandCoins, PackageSearch, RotateCcw, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { Card, EmptyState, IconTile, Row, Skeleton, StatusBadge, type Tone } from '@/components/ui/Card';
import { Button, SearchField, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtDate, fmtIN, fmtMoney } from '@/lib/format';
import { dayGroupLabel } from '@/lib/movements';
import { LedgerDayHeader } from '@/components/godown/StockLedger';
import { EXPIRY_LABELS, MEDICINE_KIND_LABELS } from '@/lib/medicines';
import { usePurchaseLookup } from '@/hooks/usePaymentPositions';
import { UNSUPPLIED } from '@/lib/purchasing';
import type { MedicineItem, MedicineStockEntry, MedicineStockKind } from '@/types';
import type { GodownValuation } from '@/lib/valuation';
import {
  entryIncoming, entryValue, groupByDay, kindMetaFor, ledgerOrder, ledgerTotals, signedQty, unitQty,
} from './medicineMeta';

/**
 * The medicine store's history, on the godown's own ledger surface: day groups, hairline
 * dividers, a row that opens into the full transaction. Every figure is the row's own or
 * comes from the weighted-average replay that priced it — nothing is re-costed here (§9).
 *
 * Quantities are never summed across items: one product counts vials, another litres (§4).
 * Only rows and money — both unit-agnostic — are totalled.
 */

export type MedicineRefs = {
  shedName: (shedId?: string) => string | undefined;
  batchCode: (batchId?: string) => string | undefined;
  nameOf: (userId?: string) => string | undefined;
  /** Where a usage went, stated the way the batch and shed name it. */
  itemOf: (medicineId: string) => MedicineItem | undefined;
  itemPath?: (medicineId: string) => string | undefined;
};

const KINDS: MedicineStockKind[] = ['OPENING', 'RECEIPT', 'USAGE', 'ADJUSTMENT'];

export function MedicineEntryRow({ entry, item, refs, valuation, canFinance, today, onOpen }: {
  entry: MedicineStockEntry;
  item: MedicineItem | undefined;
  refs: MedicineRefs;
  valuation: GodownValuation;
  canFinance: boolean;
  today: string;
  onOpen: () => void;
}) {
  const { tone, Icon } = kindMetaFor(entry, item);
  const unit = item?.unit ?? 'units';
  const value = entryValue(entry, valuation);
  const place = valuation.positions(entry.id);
  const rel = dayGroupLabel(entry.date, today);
  const where = entry.kind === 'USAGE'
    ? [refs.shedName(entry.shedId), refs.batchCode(entry.batchId)].filter(Boolean).join(' / ')
    : entry.kind === 'RECEIPT' ? entry.supplier ?? UNSUPPLIED : '';
  const detail = entry.reason ?? entry.remarks ?? where;
  const by = refs.nameOf(entry.createdBy);

  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${item?.name ?? 'Medicine'} ${MEDICINE_KIND_LABELS[entry.kind]} on ${fmtDate(entry.date)} — open details`}
      className="group flex items-start gap-3 px-4 py-3.5 text-left cursor-pointer transition-colors hover:bg-sunk/60 focus-visible:bg-sunk/60 ring-focus">
      <IconTile tone={tone} size={36}><Icon size={17} strokeWidth={1.9} /></IconTile>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-ink truncate">{item?.name ?? 'Removed item'}</p>
        <p className="mt-0.5 text-[11.5px] text-muted tnum truncate">
          {fmtDate(entry.date)}{rel ? ` · ${rel}` : ''} · {MEDICINE_KIND_LABELS[entry.kind]}
        </p>
        {detail && <p className="mt-0.5 text-[11px] text-faint truncate">{detail}</p>}
        <p className="mt-0.5 text-[10.5px] text-faint tnum truncate">
          {[
            entry.purchaseRef ? `Ref ${entry.purchaseRef}` : null,
            where && entry.kind !== 'RECEIPT' ? where : null,
            entry.lotNumber ? `Lot ${entry.lotNumber}` : null,
            by ? `Booked by ${by}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        <div className="text-right">
          <p className={clsx('font-mono text-[12.5px] font-bold tnum', entryIncoming(entry) ? 'text-success' : 'text-danger')}>
            {signedQty(entry, unit)}
          </p>
          {canFinance && (
            <p className="mt-0.5 font-mono text-[10px] tnum text-muted max-w-[132px] truncate">
              {value === null ? 'no rate on record'
                : `${fmtMoney(value)}${entry.ratePerUnit ? ` · ${fmtMoney(entry.ratePerUnit, 2)}/${unit}` : ''}`}
            </p>
          )}
          {!canFinance && place && (
            <p className="mt-0.5 font-mono text-[10px] tnum text-faint">Stock after {unitQty(place.after.kg, unit)}</p>
          )}
        </div>
        <ChevronRight size={16} className="text-faint transition-colors group-hover:text-muted" />
      </div>
    </div>
  );
}

/** Rows already in ledger order, folded into their days on one ledger surface. */
export function MedicineLedgerSurface({ entries, refs, valuation, canFinance, today }: {
  entries: MedicineStockEntry[];
  refs: MedicineRefs;
  valuation: GodownValuation;
  canFinance: boolean;
  today: string;
}) {
  const [open, setOpen] = useState<MedicineStockEntry | null>(null);
  const groups = useMemo(() => groupByDay(entries), [entries]);

  return (
    <>
      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        {groups.map(g => (
          <div key={g.date}>
            <LedgerDayHeader date={g.date} today={today} count={g.rows.length} />
            <div className="divide-y divide-line-2">
              {g.rows.map(e => (
                <MedicineEntryRow key={e.id} entry={e} item={refs.itemOf(e.medicineId)} refs={refs} valuation={valuation}
                  canFinance={canFinance} today={today} onOpen={() => setOpen(e)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <MedicineEntryDetail entry={open} onClose={() => setOpen(null)} refs={refs}
        valuation={valuation} canFinance={canFinance} />
    </>
  );
}

/**
 * The whole ledger as a tab: the store's own header, the figures it can honestly report,
 * filters, and the day-grouped rows.
 */
export function MedicineLedger({ entries, refs, valuation, canFinance, actions, focusEntryId, today }: {
  entries: MedicineStockEntry[];
  refs: MedicineRefs;
  valuation: GodownValuation;
  canFinance: boolean;
  actions?: ReactNode;
  /** A receipt someone asked to see — opened from Finance's payables row. */
  focusEntryId?: string | null;
  today: string;
}) {
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(true); }, []);
  const [kind, setKind] = useState<'ALL' | MedicineStockKind>('ALL');
  const [medicineId, setMedicineId] = useState('ALL');
  const [month, setMonth] = useState<'ALL' | string>('ALL');
  const [q, setQ] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [open, setOpen] = useState<MedicineStockEntry | null>(null);

  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusEntryId || askedFor.current === focusEntryId) return;
    const hit = entries.find(e => e.id === focusEntryId);
    if (!hit) return;
    askedFor.current = focusEntryId;
    setOpen(hit);
  }, [focusEntryId, entries]);

  const ordered = useMemo(() => [...entries].sort(ledgerOrder), [entries]);

  const itemOptions = useMemo(() => Array.from(new Set(entries.map(e => e.medicineId)))
    .map(id => ({ value: id, label: refs.itemOf(id)?.name ?? 'Removed item' }))
    .sort((a, b) => a.label.localeCompare(b.label)), [entries, refs]);

  const monthOptions = useMemo(() => Array.from(new Set(entries
    .filter(e => /^\d{4}-\d{2}/.test(e.date)).map(e => e.date.slice(0, 7))))
    .sort((a, b) => b.localeCompare(a)), [entries]);

  const kinds = useMemo(() => {
    const present = new Set(entries.map(e => e.kind));
    return KINDS.filter(k => present.has(k));
  }, [entries]);

  const totals = useMemo(() => ledgerTotals(entries, valuation), [entries, valuation]);
  const itemsTouched = useMemo(() => new Set(entries.map(e => e.medicineId)).size, [entries]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => ordered.filter(e => {
    if (kind !== 'ALL' && e.kind !== kind) return false;
    if (medicineId !== 'ALL' && e.medicineId !== medicineId) return false;
    if (month !== 'ALL' && !e.date.startsWith(month)) return false;
    if (!needle) return true;
    const item = refs.itemOf(e.medicineId);
    const hay = [item?.name, MEDICINE_KIND_LABELS[e.kind], item?.category, e.supplier, e.purchaseRef,
      e.lotNumber, e.reason, e.remarks, refs.shedName(e.shedId), refs.batchCode(e.batchId)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  }), [ordered, kind, medicineId, month, needle, refs]);

  const activeFilters = [kind !== 'ALL', medicineId !== 'ALL', month !== 'ALL', needle !== ''].filter(Boolean).length;
  const clearFilters = () => { setKind('ALL'); setMedicineId('ALL'); setMonth('ALL'); setQ(''); };

  const selects = (
    <>
      <SelectField aria-label="Medicine or vaccine" value={medicineId} onChange={e => setMedicineId(e.target.value)}
        options={[{ value: 'ALL', label: medicineId === 'ALL' ? 'All items' : refs.itemOf(medicineId)?.name ?? 'Item' }, ...itemOptions]} />
      <SelectField aria-label="Date" value={month} onChange={e => setMonth(e.target.value as 'ALL' | string)}
        options={[{ value: 'ALL', label: 'All dates' }, ...monthOptions.map(mo => ({ value: mo, label: monthLabel(mo) }))]} />
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[21px] leading-tight font-semibold text-ink tracking-tight">Stock Ledger</h2>
          <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
            Every movement behind Current Stock — receipts, shed and batch usage, and counted corrections.
          </p>
          <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint tnum">
            {fmtIN(totals.OPENING.count + totals.RECEIPT.count + totals.USAGE.count + totals.ADJUSTMENT.count)} movements
            {' · '}{fmtIN(itemsTouched)} items
          </p>
        </div>
        {actions && <div className="hidden sm:flex items-center gap-2 shrink-0 pt-1">{actions}</div>}
      </div>

      {actions && <div className="grid grid-cols-2 gap-2 sm:hidden">{actions}</div>}

      {ordered.length > 0 && (
        <Card padded={false} className="px-4 py-3.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4">
            <Cell label="Total movements" value={fmtIN(ordered.length)} sub={`${itemsTouched} items touched`} />
            <Cell label="Received" value={fmtIN(totals.RECEIPT.count)}
              sub={totals.RECEIPT.value === null ? 'no rate on record' : `${fmtMoney(totals.RECEIPT.value)} in`} dot="success" />
            <Cell label="Used" value={fmtIN(totals.USAGE.count)}
              sub={totals.USAGE.value === null ? 'not yet priced' : `${fmtMoney(totals.USAGE.value)} charged to flocks`} dot="accent" />
            <Cell label="Corrections" value={fmtIN(totals.ADJUSTMENT.count)}
              sub={totals.OPENING.count ? `${totals.OPENING.count} opening entr${totals.OPENING.count === 1 ? 'y' : 'ies'}` : 'no opening entries'}
              dot="neutral" className="col-span-2 sm:col-span-1" />
          </div>
        </Card>
      )}

      {ordered.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5" role="group" aria-label="Transaction type">
            {(['ALL', ...kinds] as const).map(k => {
              const active = kind === k;
              return (
                <button key={k} type="button" onClick={() => setKind(k as 'ALL' | MedicineStockKind)} aria-pressed={active}
                  className={clsx('shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold press',
                    active ? 'bg-brand text-white shadow-card' : 'bg-sunk text-ink hover:bg-brand-soft hover:text-brand')}>
                  {k === 'ALL' ? 'All' : MEDICINE_KIND_LABELS[k]}
                </button>
              );
            })}
          </div>
          <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1.2fr] gap-2 items-end">
            {selects}
            <SearchField value={q} onChange={setQ} placeholder="Search item, supplier, lot or reference" />
          </div>
          <div className="sm:hidden flex items-center gap-2">
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSheetOpen(true)}
              icon={<SlidersHorizontal size={14} />}>
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
            </Button>
            <SearchField value={q} onChange={setQ} placeholder="Search ledger" className="flex-1" />
          </div>
        </>
      )}

      {!settled ? (
        <Card padded={false} className="divide-y divide-line-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5">
              <Skeleton className="w-9 h-9 rounded-[12px] shrink-0" />
              <div className="flex-1 space-y-1.5 pt-0.5">
                <Skeleton className="h-3 w-[46%]" />
                <Skeleton className="h-2.5 w-[62%]" />
              </div>
              <Skeleton className="h-3 w-[18%] mt-1" />
            </div>
          ))}
        </Card>
      ) : ordered.length === 0 ? (
        <EmptyState icon={<PackageSearch size={20} />} title="No medicine movements yet"
          description="Every receipt, usage and correction of the medicine store will appear here, in the order it was booked." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal size={20} />} title="Nothing matches these filters"
          description="No movement in the ledger fits the current selection."
          action={<Button variant="outline" size="sm" onClick={clearFilters} icon={<RotateCcw size={14} />}>Clear filters</Button>} />
      ) : (
        <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
          {groupByDay(filtered).map(g => (
            <div key={g.date}>
              <LedgerDayHeader date={g.date} today={today} count={g.rows.length} />
              <div className="divide-y divide-line-2">
                {g.rows.map(e => (
                  <MedicineEntryRow key={e.id} entry={e} item={refs.itemOf(e.medicineId)} refs={refs}
                    valuation={valuation} canFinance={canFinance} today={today} onOpen={() => setOpen(e)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter the ledger"
        subtitle={`${fmtIN(filtered.length)} of ${fmtIN(ordered.length)} movements shown`}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={clearFilters} disabled={activeFilters === 0}>Clear</Button>
          <Button block onClick={() => setSheetOpen(false)}>Show</Button>
        </div>}>
        <div className="space-y-3">{selects}</div>
      </Dialog>

      <MedicineEntryDetail entry={open} onClose={() => setOpen(null)} refs={refs}
        valuation={valuation} canFinance={canFinance} />
    </div>
  );
}

/* ============================= ONE MOVEMENT, INSPECTED ============================= */

const HEADING: Record<MedicineStockKind, string> = {
  OPENING: 'Opening stock', RECEIPT: 'Purchase / receive', USAGE: 'Shed or batch usage', ADJUSTMENT: 'Counted correction',
};

const HEADING_TONE: Record<MedicineStockKind, Tone> = {
  OPENING: 'brand', RECEIPT: 'success', USAGE: 'accent', ADJUSTMENT: 'neutral',
};

const panel: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-ink', accent: 'bg-accent-soft text-accent-ink',
  success: 'bg-success-soft text-success', danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn', neutral: 'bg-sunk text-ink',
};

/**
 * One medicine row read in full, including the money question it raises: a receipt shows
 * what it is worth, what Finance has paid against it and what is still owed — and hands the
 * payment itself to the common Finance screen (§13). A usage shows the cost it charged the
 * flock at the average in force the day it was booked.
 */
export function MedicineEntryDetail({ entry, onClose, refs, valuation, canFinance }: {
  entry: MedicineStockEntry | null;
  onClose: () => void;
  refs: MedicineRefs;
  valuation: GodownValuation;
  canFinance: boolean;
}) {
  const nav = useNavigate();
  const purchaseOf = usePurchaseLookup();
  if (!entry) return null;
  const item = refs.itemOf(entry.medicineId);
  const unit = item?.unit ?? 'units';
  const value = entryValue(entry, valuation);
  const place = valuation.positions(entry.id);
  const purchase = canFinance && entry.kind === 'RECEIPT' ? purchaseOf(entry.id) : null;
  const payable = purchase !== null && (purchase.outstanding ?? 0) > 0;
  const path = refs.itemPath?.(entry.medicineId);

  return (
    <Dialog open onClose={onClose} title={HEADING[entry.kind]}
      subtitle={`${item?.name ?? 'Removed item'} · ${fmtDate(entry.date)}`}
      footer={purchase && payable ? (
        <div className="flex gap-2">
          <Button block variant="outline" onClick={onClose}>Close</Button>
          <Button block icon={<HandCoins size={14} />} onClick={() => nav(`/finance?pay=${entry.id}`)}>Record payment</Button>
        </div>
      ) : <Button block variant="outline" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className={clsx('rounded-[16px] px-4 py-3.5', panel[HEADING_TONE[entry.kind]])}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-70">
                {MEDICINE_KIND_LABELS[entry.kind]}
              </p>
              <p className="mt-1 font-display text-[24px] leading-7 font-semibold tnum truncate">
                {signedQty(entry, unit)}
              </p>
              <p className="mt-1 font-mono text-[11px] opacity-75 tnum">{fmtDate(entry.date)}</p>
            </div>
            {canFinance && (
              <div className="text-right shrink-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] opacity-70">
                  {entryIncoming(entry) ? 'Value in' : 'Value out'}
                </p>
                <p className="mt-1 font-display text-[18px] leading-6 font-semibold tnum">
                  {value === null ? 'No rate' : fmtMoney(value)}
                </p>
                {entry.ratePerUnit !== undefined && (
                  <p className="mt-1 font-mono text-[10px] opacity-75 tnum">{fmtMoney(entry.ratePerUnit, 2)}/{unit}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <Label>Transaction</Label>
          <div className="rounded-[16px] border border-line bg-card px-4 py-1">
            <Row label="Item" mono={false} value={path ? (
              <button type="button" onClick={() => nav(path)}
                className="inline-flex items-center gap-1 text-brand hover:underline">
                {item?.name ?? 'Removed item'}<ChevronRight size={13} className="shrink-0" />
              </button>
            ) : item?.name ?? 'Removed item'} />
            {item && <Row label="Category" value={item.category === 'VACCINE' ? 'Vaccine' : 'Medicine'} mono={false} />}
            {item?.specifications && <Row label="Pack" value={item.specifications} mono={false} />}
            <Row label="Transaction" value={MEDICINE_KIND_LABELS[entry.kind]} mono={false} />
            <Row label="Date" value={fmtDate(entry.date)} mono={false} />
            <Row label="Quantity" value={unitQty(entry.qty, unit)} mono={false} />
            {entry.ratePerUnit !== undefined && (
              <Row label={entry.kind === 'USAGE' ? 'Valued at' : 'Rate'} value={`${fmtMoney(entry.ratePerUnit, 2)}/${unit}`} />
            )}
            {canFinance && value !== null && (
              <Row label={entry.kind === 'USAGE' ? 'Charged to the flock' : 'Value'} value={fmtMoney(value)} success />
            )}
            {entry.purchaseRef && <Row label="Reference" value={entry.purchaseRef} mono={false} />}
            {entry.lotNumber && <Row label="Lot" value={entry.lotNumber} mono={false} />}
            {entry.expiryDate && (
              <Row label="Expiry" value={fmtDate(entry.expiryDate)} mono={false}
                danger={entry.expiryDate < today()} />
            )}
            {refs.shedName(entry.shedId) && <Row label="Shed" value={refs.shedName(entry.shedId)!} mono={false} />}
            {refs.batchCode(entry.batchId) && <Row label="Batch" value={refs.batchCode(entry.batchId)!} mono={false} />}
            {entry.reason && <Row label="Reason" value={entry.reason} mono={false} />}
            {entry.usedBy && <Row label="Used by" value={entry.usedBy} mono={false} />}
            {refs.nameOf(entry.createdBy) && <Row label="Created by" value={refs.nameOf(entry.createdBy)!} mono={false} />}
            {entry.remarks && <Row label="Remarks" value={entry.remarks} mono={false} />}
          </div>
        </div>

        {place && (
          <div>
            <Label>Effect on the shelf</Label>
            <div className="rounded-[16px] border border-line bg-card px-4 py-1">
              <Row label="Stock before" value={unitQty(place.before.kg, unit)} />
              <Row label="Stock after" value={unitQty(place.after.kg, unit)}
                success={entryIncoming(entry)} danger={!entryIncoming(entry)} />
              {canFinance && (
                <Row label="Average after" value={place.after.avg === null ? 'Not priced yet' : `${fmtMoney(place.after.avg, 2)}/${unit}`} />
              )}
            </div>
          </div>
        )}

        {purchase && (
          <div>
            <Label>Purchase &amp; payments</Label>
            <div className="rounded-[16px] border border-line bg-card px-4 py-1">
              <Row label="Purchase no." value={purchase.entry.purchaseRef ?? 'Not numbered'} mono={false} />
              <Row label="Supplier" value={purchase.supplier ?? UNSUPPLIED} mono={false} />
              <Row label="Quantity taken in" value={unitQty(purchase.qtyKg, unit)} />
              <Row label="Purchase value" value={purchase.value === null ? 'No receipt rate' : fmtMoney(purchase.value)} success />
              <Row label="Amount paid" value={fmtMoney(purchase.paid)} />
              <Row label="Outstanding" value={purchase.outstanding === null ? '—' : fmtMoney(Math.max(0, purchase.outstanding))}
                danger={payable} />
            </div>
            <div className="mt-2 flex items-center gap-2 px-1">
              {purchase.status && <StatusBadge status={purchase.status} />}
              <p className="text-[11.5px] text-muted leading-relaxed min-w-0">
                {purchase.value === null
                  ? 'This receipt carries no rate, so there is no amount to pay against it yet.'
                  : payable
                    ? `${fmtMoney(Math.max(0, purchase.outstanding ?? 0))} is still owed. Receiving stock never moves money — Finance records the payment.`
                    : 'Every rupee of this receipt has been paid. The receipt itself was never restated to say so.'}
              </p>
            </div>
            {purchase.payments.length > 0 && (
              <div className="mt-3">
                <Label>Payment history</Label>
                <div className="rounded-[16px] border border-line bg-card overflow-hidden divide-y divide-line-2">
                  {purchase.payments.map(p => (
                    <div key={p.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                      <p className="min-w-0 text-[13px] text-ink truncate">
                        {fmtDate(p.date)}{p.reference ? ` · ${p.reference}` : ''}
                      </p>
                      <p className="font-mono text-[12.5px] font-semibold text-danger tnum shrink-0">−{fmtMoney(p.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {entry.kind === 'USAGE' && (
          <div className="rounded-[16px] bg-sunk px-4 py-3">
            <p className="text-[11.5px] text-muted leading-relaxed">
              {value === null
                ? 'This item has never been priced by a receipt, so the quantity left the shelf without a cost. Nothing was invented to fill the gap.'
                : 'The cost is the average in force the moment it was booked, frozen on this row. A later purchase at a different rate cannot restate it — and the same figure is what the flock’s P&L and Finance carry.'}
            </p>
            {entry.vaccinationId && (
              <p className="mt-1.5 font-mono text-[10.5px] text-brand-ink">
                Deducted by a completed vaccination — this dose is off the shelf once, never twice.
              </p>
            )}
          </div>
        )}

        {!canFinance && (
          <p className="text-[11.5px] text-muted leading-relaxed px-1">
            This role sees quantities only — rates and values stay with the accounts team.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</p>;
}

function Cell({ label, value, sub, dot, className }: {
  label: string; value: string; sub?: string; dot?: Tone; className?: string;
}) {
  const dotClass = ({ brand: 'bg-brand', accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger', warn: 'bg-warn', neutral: 'bg-line' })[dot ?? 'neutral'];
  return (
    <div className={clsx('min-w-0', className)}>
      <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted truncate">
        {dot && <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', dotClass)} />}
        {label}
      </p>
      <p className="mt-1 font-display text-[16px] leading-5 font-semibold text-ink tnum truncate">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-faint tnum truncate">{sub}</p>}
    </div>
  );
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Math.max(0, Math.min(11, (m || 1) - 1))]} ${y}`;
}

function today(): string { return new Date().toISOString().slice(0, 10); }

/** Expiry of the earliest lot still on the shelf, phrased the way the store reports it. */
export function expiryLine(state: keyof typeof EXPIRY_LABELS, date: string | null): string {
  return date ? `${EXPIRY_LABELS[state]} · ${fmtDate(date)}` : EXPIRY_LABELS[state];
}
