import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine, ChevronDown, ChevronRight, Info, PackageSearch, Pill, Plus, SlidersHorizontal, Syringe,
} from 'lucide-react';
import clsx from 'clsx';
import { useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Badge, Card, EmptyState, GroupList, IconTile, ListRow, Stat, StatCell, StatStrip } from '@/components/ui/Card';
import { Button, SearchField, SegmentedTabs } from '@/components/ui/Form';
import { MedicineLedger } from '@/components/medicine/MedicineLedger';
import type { MedicineRefs } from '@/components/medicine/MedicineLedger';
import {
  MedicineAdjustSheet, MedicineItemSheet, MedicineReceiveSheet, MedicineUsageSheet,
} from '@/components/medicine/MedicineSheets';
import { EXPIRY_TONE, unitQty } from '@/components/medicine/medicineMeta';
import { useMedicineValuation } from '@/hooks/useMedicineValuation';
import { EXPIRING_WITHIN_DAYS, EXPIRY_LABELS, medicineStockBoard } from '@/lib/medicines';
import { fmtIN, fmtMoney, todayISO } from '@/lib/format';

/**
 * The medicine & vaccine store: central inventory first, exactly as the godown works.
 *
 * Current Stock is where each item stands; Stock Ledger is every movement that produced it.
 * Both read the same replayed ledger, so a quantity, an average and a value appear once and
 * come from the same rows. Nothing here prices anything by hand, and nothing here pays
 * for anything — a receipt raises a payable that Finance settles (§13).
 */
type MedTab = 'stock' | 'ledger';

export function MedicinesScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const data = useCompanyData();
  const canCreate = useCan('create');
  const canFinance = useCan('viewFinance');
  const { valuation, entries, items } = useMedicineValuation();
  const today = todayISO();

  const [q, setQ] = useState(params.get('q') ?? '');
  const [tab, setTab] = useState<MedTab>(params.get('tab') === 'ledger' ? 'ledger' : 'stock');
  const focusEntryId = params.get('movement');
  const [whyOpen, setWhyOpen] = useState(false);
  const [sheet, setSheet] = useState<'receive' | 'usage' | 'adjust' | 'item' | null>(null);
  const [forEntry, setForEntry] = useState<string | undefined>();

  const board = useMemo(() => medicineStockBoard(items, entries, today), [items, entries, today]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (needle
    ? board.rows.filter(r => [r.item.name, r.item.specifications, r.item.category, r.item.unit]
      .filter(Boolean).join(' ').toLowerCase().includes(needle))
    : board.rows), [board.rows, needle]);

  const open = (kind: 'receive' | 'usage' | 'adjust', medicineId?: string) => {
    setForEntry(medicineId);
    setSheet(kind);
  };

  const refs: MedicineRefs = useMemo(() => ({
    itemOf: id => items.find(i => i.id === id),
    shedName: id => (id ? data.sheds.find(s => s.id === id)?.name : undefined),
    batchCode: id => (id ? data.batches.find(b => b.id === id)?.code : undefined),
    nameOf: id => (id ? data.users.find(u => u.id === id)?.name : undefined),
    itemPath: id => `/medicines/item/${id}`,
  }), [items, data.sheds, data.batches, data.users]);

  const actions = canCreate && (
    <>
      <Button size="sm" icon={<ArrowDownToLine size={14} />} onClick={() => open('receive')}>Receive stock</Button>
      <Button size="sm" variant="outline" icon={<Syringe size={14} />} onClick={() => open('usage')}>Record usage</Button>
    </>
  );

  const t = board.totals;

  return (
    <Page withNav>
      <Header title="Medicines & Vaccines" subtitle="Central inventory · each item counted in its own unit"
        action={<div className="flex items-center gap-2">
          {canCreate && <Button size="sm" icon={<Plus size={14} />} onClick={() => setSheet('item')}>Add item</Button>}
        </div>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <SegmentedTabs<MedTab> value={tab} onChange={setTab} options={[
          { value: 'stock', label: 'Current Stock', icon: <Pill size={13} /> },
          { value: 'ledger', label: 'Stock Ledger', icon: <SlidersHorizontal size={13} /> },
        ]} />

        {tab === 'ledger' && (
          <MedicineLedger entries={entries} refs={refs} valuation={valuation} canFinance={canFinance}
            actions={actions} focusEntryId={focusEntryId} today={today} />
        )}

        {tab === 'stock' && (<>
          <Card padded={false}>
            <StatStrip>
              <StatCell><Stat label="Total items" value={fmtIN(t.items)}
                sub={`${fmtIN(t.inStock)} with stock on the shelf`} tone="brand" size="sm" /></StatCell>
              <StatCell><Stat label="At or below reorder level" value={fmtIN(t.low)}
                sub="plan the next receipt" tone={t.low > 0 ? 'danger' : 'neutral'} size="sm" /></StatCell>
              <StatCell>
                <Stat label="Stock value"
                  value={canFinance ? (t.value > 0 ? fmtMoney(t.value) : 'No prices on record') : '₹•••••'}
                  sub={canFinance
                    ? `Weighted average cost${t.unpricedItems > 0 ? ` · ${fmtIN(t.unpricedItems)} item${t.unpricedItems === 1 ? '' : 's'} without a rate` : ''}`
                    : 'Derived from the receipts, not typed in'}
                  tone="accent" size="sm" />
              </StatCell>
              <StatCell><Stat label="Expiring soon" value={fmtIN(t.expiring)}
                sub={t.expired ? `${fmtIN(t.expired)} already expired` : `inside ${EXPIRING_WITHIN_DAYS} days`}
                tone={t.expired ? 'danger' : t.expiring ? 'warn' : 'neutral'} size="sm" /></StatCell>
            </StatStrip>
          </Card>

          <div className="rounded-[18px] bg-brand-soft px-4 py-3">
            <button type="button" onClick={() => setWhyOpen(v => !v)} aria-expanded={whyOpen}
              className="w-full flex items-center gap-2 rounded-[10px] text-left ring-focus press">
              <Info size={15} className="text-brand shrink-0" />
              <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-brand-ink">
                One weighted average price per item
              </span>
              <ChevronDown size={16} className={clsx('text-brand shrink-0 transition-transform', whyOpen && 'rotate-180')} />
            </button>
            {whyOpen && (
              <p className="mt-2 text-[12.5px] text-brand-ink leading-relaxed">
                A receipt at a new rate re-weights that item&rsquo;s average. Stock leaving — a shed&rsquo;s
                treatment, a vaccination dose, a counted correction — goes out at the average in force and never
                moves it, so a usage keeps the cost it was booked at. Receiving stock never moves money: the
                supplier&rsquo;s payable is settled by Finance.
              </p>
            )}
          </div>

          <SearchField value={q} onChange={setQ} placeholder="Search medicine or vaccine" />

          {canCreate && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button size="sm" block icon={<ArrowDownToLine size={15} />} onClick={() => open('receive')}>Receive stock</Button>
              <Button size="sm" block variant="outline" icon={<Syringe size={15} />} onClick={() => open('usage')}>Record usage</Button>
              <Button size="sm" block variant="outline" icon={<SlidersHorizontal size={15} />} onClick={() => open('adjust')}>Correction</Button>
              <Button size="sm" block variant="outline" icon={<Plus size={15} />} onClick={() => setSheet('item')}>Add item</Button>
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState icon={<PackageSearch size={22} />} title="The medicine store is empty"
              description="Add the medicines and vaccines this farm keeps, then receive stock against them. Stock is counted in the unit each item is bought in."
              action={canCreate ? <Button icon={<Plus size={15} />} onClick={() => setSheet('item')}>Add item</Button> : undefined} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Pill size={22} />} title="No items found" description="Try a different search." />
          ) : (
            <>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint px-0.5">
                {`${rows.length} item${rows.length === 1 ? '' : 's'} · lowest stock first${canFinance ? ' · stock · avg · value' : ''}`}
              </p>
              <GroupList>
                {rows.map(r => {
                  const Icon = r.item.category === 'VACCINE' ? Syringe : Pill;
                  return (
                    <ListRow key={r.item.id}
                      onClick={() => nav(`/medicines/item/${r.item.id}`)}
                      leading={<IconTile tone={r.qty <= 0 ? 'neutral' : r.low ? 'danger' : 'brand'}><Icon size={18} /></IconTile>}
                      title={r.item.name}
                      subtitle={(
                        <span className="font-mono truncate">
                          {`${r.item.category === 'VACCINE' ? 'Vaccine' : 'Medicine'} · ${r.item.unit}${r.item.specifications ? ` · ${r.item.specifications}` : ''}`}
                        </span>
                      )}
                      chips={(
                        <>
                          {r.qty <= 0 && <Badge tone="neutral">Out of stock</Badge>}
                          {r.qty > 0 && r.low && <Badge tone="danger">Low</Badge>}
                          {r.expiry.state !== 'NONE' && r.expiry.state !== 'OK' && (
                            <Badge tone={EXPIRY_TONE[r.expiry.state]}>{EXPIRY_LABELS[r.expiry.state]}</Badge>
                          )}
                        </>
                      )}
                      trailing={(
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="text-right">
                            <p className="font-mono text-[12.5px] font-semibold text-ink tnum">{unitQty(r.qty, r.item.unit)}</p>
                            {canFinance && (
                              <p className="mt-0.5 font-mono text-[10px] text-muted tnum">
                                {r.avg === null ? 'no rate' : `${fmtMoney(r.avg, 2)}/${r.item.unit}`}
                                {r.avg !== null && r.qty > 0 && ` · ${fmtMoney(r.value)}`}
                              </p>
                            )}
                            {!canFinance && r.movements > 0 && (
                              <p className="mt-0.5 font-mono text-[10px] text-faint tnum">{fmtIN(r.movements)} movements</p>
                            )}
                          </div>
                          <ChevronRight size={16} className="text-faint" />
                        </div>
                      )} />
                  );
                })}
              </GroupList>
            </>
          )}
        </>)}
      </div>

      {sheet === 'receive' && <MedicineReceiveSheet medicineId={forEntry} onClose={() => setSheet(null)} />}
      {sheet === 'usage' && <MedicineUsageSheet medicineId={forEntry} onClose={() => setSheet(null)} />}
      {sheet === 'adjust' && <MedicineAdjustSheet medicineId={forEntry} onClose={() => setSheet(null)} />}
      {sheet === 'item' && <MedicineItemSheet onClose={() => setSheet(null)} />}
    </Page>
  );
}
