import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, type Variants } from 'motion/react';
import {
  ArrowDownToLine, ChevronRight, HandCoins, PackageSearch, Pill, Receipt, SlidersHorizontal, Syringe,
} from 'lucide-react';
import clsx from 'clsx';
import { useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Badge, Card, EmptyState, IconTile, KPI, SectionTitle, StatusBadge, type Tone } from '@/components/ui/Card';
import { Button, SegmentedTabs } from '@/components/ui/Form';
import { MOTION, PageReveal, Presence, StaggerContainer, StaggerItem, useReducedMotion } from '@/components/motion';
import { BarsMini, CHART, ChartCard } from '@/components/ui/Charts';
import {
  MedicineLedgerSurface, expiryLine,
} from '@/components/medicine/MedicineLedger';
import type { MedicineRefs } from '@/components/medicine/MedicineLedger';
import {
  MedicineAdjustSheet, MedicineItemSheet, MedicineReceiveSheet, MedicineUsageSheet,
} from '@/components/medicine/MedicineSheets';
import { EXPIRY_TONE, entryValue, ledgerOrder, signedQty, unitQty } from '@/components/medicine/medicineMeta';
import { useMedicineValuation } from '@/hooks/useMedicineValuation';
import { usePurchaseLookup } from '@/hooks/usePaymentPositions';
import { EXPIRY_LABELS, expiryOf, medicineStockBoard } from '@/lib/medicines';
import { UNSUPPLIED } from '@/lib/purchasing';
import { fmtDate, fmtIN, fmtMoney, todayISO } from '@/lib/format';
import type { MedicineStockKind } from '@/types';

/**
 * One medicine or vaccine's whole story, on the ingredient screen's pattern: how the stock
 * on the shelf came about, and where every unit that left actually went (§17, §18).
 *
 * A receipt here also carries its money question — what it was worth, what Finance has paid
 * and what is still owed — without ever holding a payment of its own (§13).
 */
type ItemTab = 'overview' | 'history';

const FLOW_TONE: Record<MedicineStockKind, Tone> = {
  OPENING: 'brand', RECEIPT: 'success', USAGE: 'accent', ADJUSTMENT: 'neutral',
};

const dotClass: Record<Tone, string> = {
  brand: 'bg-brand', accent: 'bg-accent', success: 'bg-success',
  danger: 'bg-danger', warn: 'bg-warn', neutral: 'bg-line',
};

/** The tab bodies take the stage one at a time: a quick lift out, a settled entrance in. */
const tabBodyVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: MOTION.component },
  exit: { opacity: 0, y: -6, transition: MOTION.micro },
};

export function MedicineItemScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const today = todayISO();
  const data = useCompanyData();
  const canCreate = useCan('create');
  const canEdit = useCan('update');
  const canFinance = useCan('viewFinance');
  const { valuation, entries, items } = useMedicineValuation();
  const purchaseOf = usePurchaseLookup();
  const [tab, setTab] = useState<ItemTab>('overview');
  const [sheet, setSheet] = useState<'receive' | 'usage' | 'adjust' | 'item' | null>(null);
  const reduced = useReducedMotion();

  const item = items.find(i => i.id === id);
  const own = useMemo(() => entries.filter(e => e.medicineId === id).sort(ledgerOrder), [entries, id]);
  const row = useMemo(() => medicineStockBoard(items, entries, today).rows.find(r => r.item.id === id), [items, entries, today, id]);
  const flow = useMemo(() => {
    const out: Record<MedicineStockKind, { qty: number; count: number; value: number | null }> = {
      OPENING: { qty: 0, count: 0, value: null }, RECEIPT: { qty: 0, count: 0, value: null },
      USAGE: { qty: 0, count: 0, value: null }, ADJUSTMENT: { qty: 0, count: 0, value: null },
    };
    for (const e of own) {
      const b = out[e.kind];
      b.count++;
      b.qty += e.kind === 'ADJUSTMENT' ? e.qty : Math.abs(e.qty) * (e.kind === 'USAGE' ? -1 : 1);
      const v = entryValue(e, valuation);
      if (v !== null) b.value = (b.value ?? 0) + v;
    }
    return out;
  }, [own, valuation]);

  const refs: MedicineRefs = useMemo(() => ({
    itemOf: mid => items.find(i => i.id === mid),
    shedName: sid => (sid ? data.sheds.find(s => s.id === sid)?.name : undefined),
    batchCode: bid => (bid ? data.batches.find(b => b.id === bid)?.code : undefined),
    nameOf: uid => (uid ? data.users.find(u => u.id === uid)?.name : undefined),
  }), [items, data.sheds, data.batches, data.users]);

  /** Where the doses actually went — the question the shelf page is asked. */
  const byShed = useMemo(() => {
    const m = new Map<string, { qty: number; cost: number; priced: boolean }>();
    for (const e of own) {
      if (e.kind !== 'USAGE') continue;
      const name = refs.shedName(e.shedId) ?? 'Shed';
      const cur = m.get(name) ?? { qty: 0, cost: 0, priced: false };
      cur.qty += e.qty;
      const v = entryValue(e, valuation);
      if (v !== null) { cur.cost += v; cur.priced = true; }
      m.set(name, cur);
    }
    return Array.from(m, ([label, v]) => ({ label, ...v })).sort((a, b) => b.qty - a.qty);
  }, [own, refs, valuation]);

  const receipts = useMemo(() => own.filter(e => e.kind === 'RECEIPT' || e.kind === 'OPENING'), [own]);
  const usages = useMemo(() => own.filter(e => e.kind === 'USAGE'), [own]);
  const expiry = useMemo(() => expiryOf(entries.filter(e => e.medicineId === id), today), [entries, id, today]);
  const positions = useMemo(() => own.map(e => ({
    date: e.date,
    qty: valuation.positions(e.id)?.after.kg ?? null,
    avg: valuation.positions(e.id)?.after.avg ?? null,
  })).reverse(), [own, valuation]);
  const stockSeries = positions.filter(p => p.qty !== null) as { date: string; qty: number }[];

  if (!item) {
    return (
      <Page withNav>
        <Header title="Medicine" subtitle="Stock history" backTo="/medicines" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState icon={<PackageSearch size={22} />} title="Item not found"
            description="This medicine or vaccine is no longer in the store, or belongs to another company." />
        </div>
      </Page>
    );
  }

  const Icon = item.category === 'VACCINE' ? Syringe : Pill;
  const unit = item.unit;
  const r = row;
  const kinds = (['OPENING', 'RECEIPT', 'USAGE', 'ADJUSTMENT'] as MedicineStockKind[]).filter(k => flow[k].count > 0);

  return (
    <Page withNav>
      <PageReveal>
      <Header title={item.name}
        subtitle={canFinance ? 'Stock history and valuation · medicine store' : 'Stock history · medicine store'}
        backTo="/medicines"
        action={canEdit ? <Button size="sm" variant="outline" onClick={() => setSheet('item')}>Change</Button> : undefined} />

      <StaggerContainer className="px-4 sm:px-0 mt-3 space-y-4">
        <StaggerItem>
        <div className="flex items-start gap-3">
          <IconTile tone={r && r.qty > 0 ? 'brand' : 'neutral'} size={44}><Icon size={20} /></IconTile>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {item.category === 'VACCINE' ? 'Vaccine' : 'Medicine'} · counted in {unit}
              {item.specifications ? ` · ${item.specifications}` : ''}
            </p>
            <p className="mt-1 text-[12.5px] text-muted leading-relaxed">
              {item.active ? 'In use — new receipts and usages may be booked against it.'
                : 'Retired. Its history stands, but no new entry may be booked against it.'}
            </p>
            {item.remarks && <p className="mt-1 text-[12px] text-ink-2 leading-relaxed">{item.remarks}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {r && r.qty > 0 && r.low && <Badge tone="danger">Low</Badge>}
            {r && (r.expiry.state === 'EXPIRING' || r.expiry.state === 'EXPIRED') && (
              <Badge tone={EXPIRY_TONE[r.expiry.state]}>{EXPIRY_LABELS[r.expiry.state]}</Badge>
            )}
            {r && r.qty <= 0 && <Badge tone="neutral">Out of stock</Badge>}
          </div>
        </div>
        </StaggerItem>

        {/* §15 · only figures the ledger can actually produce */}
        <StaggerItem>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <KPI label="Current stock" value={unitQty(r?.qty ?? 0, unit)} tone={r && r.low ? 'danger' : 'brand'}
            sub={`Reorder level ${unitQty(item.lowStockThreshold, unit)}`} />
          {canFinance && (
            <KPI label="Average cost" tone="neutral"
              value={r?.avg == null ? 'No rate' : `${fmtMoney(r.avg, 2)}/${unit}`} sub="Weighted from its receipts" />
          )}
          {canFinance && (
            <KPI label="Stock value" tone="accent" value={fmtMoney(r?.value ?? 0)}
              sub={r && r.unpricedQty > 0 ? `${unitQty(r.unpricedQty, unit)} without a rate` : `Across ${fmtIN(r?.movements ?? 0)} movements`} />
          )}
          <KPI label="Total received" tone="success" value={unitQty(Math.max(0, flow.RECEIPT.qty), unit)}
            sub={flow.RECEIPT.count ? `${flow.RECEIPT.count} receipt${flow.RECEIPT.count === 1 ? '' : 's'}${canFinance && flow.RECEIPT.value !== null ? ` · ${fmtMoney(flow.RECEIPT.value)}` : ''}` : 'No receipts yet'} />
          <KPI label="Total used" tone="neutral" value={unitQty(Math.abs(flow.USAGE.qty), unit)}
            sub={flow.USAGE.count ? `${flow.USAGE.count} usage${flow.USAGE.count === 1 ? '' : 's'}${canFinance && flow.USAGE.value !== null ? ` · ${fmtMoney(flow.USAGE.value)}` : ''}` : 'Never drawn'} />
          <KPI label="Earliest expiry" tone={expiry.state === 'EXPIRED' ? 'danger' : expiry.state === 'EXPIRING' ? 'warn' : 'neutral'}
            value={expiry.date ? fmtDate(expiry.date) : '—'} sub={expiryLine(expiry.state, expiry.date)} />
        </div>
        </StaggerItem>

        {canCreate && (
          <StaggerItem>
          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" block icon={<ArrowDownToLine size={15} />} onClick={() => setSheet('receive')}>Receive</Button>
            <Button size="sm" block variant="outline" icon={<Syringe size={15} />} onClick={() => setSheet('usage')}>Record usage</Button>
            <Button size="sm" block variant="outline" icon={<SlidersHorizontal size={15} />} onClick={() => setSheet('adjust')}>Correction</Button>
          </div>
          </StaggerItem>
        )}

        <StaggerItem>
        <SegmentedTabs<ItemTab> value={tab} onChange={setTab} options={[
          { value: 'overview', label: 'Overview', icon: <PackageSearch size={13} /> },
          { value: 'history', label: 'Stock History', icon: <Receipt size={13} /> },
        ]} />
        </StaggerItem>

        <StaggerItem>
        <Presence mode="wait">
          <motion.div key={tab} variants={tabBodyVariants}
            initial={reduced ? false : 'hidden'} animate="visible" exit={reduced ? undefined : 'exit'}>
          {tab === 'overview' && (<>
          {/* opening + received − used ± corrections = what stands today */}
          <Card>
            <SectionTitle>Stock movement</SectionTitle>
            <ol className="relative space-y-3.5 pl-5">
              <span className="absolute left-[5px] top-2 bottom-6 w-px bg-line" aria-hidden />
              {kinds.map(k => (
                <li key={k} className="relative">
                  <span className={clsx('absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full ring-[2.5px] ring-card', dotClass[FLOW_TONE[k]])} aria-hidden />
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-semibold text-ink">{kindLabel(k)}</p>
                    <p className={clsx('font-mono text-[13px] font-semibold tnum shrink-0', flow[k].qty >= 0 ? 'text-success' : 'text-danger')}>
                      {flow[k].qty >= 0 ? '+' : '−'}{unitQty(flow[k].qty, unit)}
                    </p>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-faint tnum">
                    {flow[k].count} movement{flow[k].count === 1 ? '' : 's'}
                    {canFinance && flow[k].value !== null && <> · {fmtMoney(flow[k].value)}</>}
                  </p>
                </li>
              ))}
              <li className="relative">
                <span className="absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full bg-brand ring-[2.5px] ring-card" aria-hidden />
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-[14px] font-semibold text-brand-ink">Current stock</p>
                  <p className="font-display text-[16px] font-semibold text-brand-ink tnum shrink-0">{unitQty(r?.qty ?? 0, unit)}</p>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-faint tnum">
                  {canFinance
                    ? (r?.avg == null ? 'No average on record' : `${fmtMoney(r.avg, 2)}/${unit} · ${fmtMoney(r.value ?? 0)} on the shelf`)
                    : `${own.length} movements traced`}
                </p>
              </li>
            </ol>
          </Card>

          {/* §18 — where did this stock go? */}
          <div className="grid gap-3 sm:grid-cols-2">
            <ChartCard title="Used by shed">
              {byShed.length ? (
                <BarsMini color={CHART.teal} items={byShed.map(s => ({ label: s.label, value: s.qty, display: unitQty(s.qty, unit) }))} />
              ) : (
                <p className="text-[11.5px] text-muted leading-relaxed">
                  No shed has drawn this item — every unit that left went out another way, or none has.
                </p>
              )}
            </ChartCard>
            <ChartCard title="Stock on the shelf over time">
              {stockSeries.length >= 2 ? (
                <BarsMini color={CHART.brand} items={stockSeries.map(p => ({ label: fmtDate(p.date), value: p.qty, display: unitQty(p.qty, unit) }))} />
              ) : (
                <p className="text-[11.5px] text-muted leading-relaxed">
                  {own.length ? 'One movement so far — the balance line appears once the ledger has another.' : 'Nothing has moved yet.'}
                </p>
              )}
            </ChartCard>
          </div>

          <div>
            <SectionTitle right={
              <span className="font-mono text-[10px] text-muted tnum">{usages.length}</span>
            }>Where the stock went</SectionTitle>
            {usages.length ? (
              <div className="bg-card border border-line rounded-[18px] shadow-card divide-y divide-line-2 overflow-hidden">
                {usages.map(e => {
                  const v = entryValue(e, valuation);
                  return (
                    <div key={e.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-ink truncate">
                            {refs.shedName(e.shedId) ?? 'Shed'}{refs.batchCode(e.batchId) ? ` / ${refs.batchCode(e.batchId)}` : ''}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted tnum truncate">{fmtDate(e.date)} · {e.reason ?? 'No reason recorded'}</p>
                          <p className="mt-0.5 text-[10.5px] text-faint truncate">
                            {[e.usedBy ? `Used by ${e.usedBy}` : null, e.remarks].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-[12.5px] font-semibold text-danger tnum">{signedQty(e, unit)}</p>
                          {canFinance && (
                            <p className="mt-0.5 font-mono text-[10.5px] text-muted tnum">{v === null ? 'no rate' : fmtMoney(v)}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-[16px] border border-dashed border-line bg-card px-4 py-3 text-[12px] text-muted leading-relaxed">
                Nothing of this item has been issued to a shed or a flock yet.
              </p>
            )}
          </div>

          <div>
            <SectionTitle>Purchase / receipt history</SectionTitle>
            {receipts.length ? (
              <div className="bg-card border border-line rounded-[18px] shadow-card divide-y divide-line-2 overflow-hidden">
                {receipts.map(e => {
                  const purchase = canFinance && e.kind === 'RECEIPT' ? purchaseOf(e.id) : null;
                  return (
                    <div key={e.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-ink truncate">
                            {fmtDate(e.date)} · {kindLabel(e.kind)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-faint truncate">
                            {e.kind === 'RECEIPT'
                              ? `${e.supplier ?? UNSUPPLIED}${e.purchaseRef ? ` · ${e.purchaseRef}` : ''}${e.lotNumber ? ` · Lot ${e.lotNumber}` : ''}`
                              : 'Opening balance on the shelf'}
                          </p>
                          {e.expiryDate && (
                            <p className="mt-0.5 text-[10.5px] text-faint tnum">Expires {fmtDate(e.expiryDate)}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-[12.5px] font-semibold text-success tnum">+{unitQty(e.qty, unit)}</p>
                          {canFinance && (
                            <p className="mt-0.5 font-mono text-[10.5px] text-muted tnum">
                              {e.ratePerUnit ? `${fmtMoney(e.ratePerUnit, 2)}/${unit}` : 'no rate'}
                              {entryValue(e, valuation) !== null && ` · ${fmtMoney(entryValue(e, valuation)!)}`}
                            </p>
                          )}
                        </div>
                      </div>
                      {purchase && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line-2 pt-2">
                          {purchase.status && <StatusBadge status={purchase.status} />}
                          <p className="text-[11px] text-muted tnum min-w-0">
                            {`${fmtMoney(purchase.paid)} paid of ${purchase.value === null ? 'no priced value' : fmtMoney(purchase.value)}`}
                            {(purchase.outstanding ?? 0) > 0 && ` · ${fmtMoney(Math.max(0, purchase.outstanding ?? 0))} still owed`}
                          </p>
                          {(purchase.outstanding ?? 0) > 0 && (
                            <Button size="sm" variant="outline" className="ml-auto" icon={<HandCoins size={13} />}
                              onClick={() => nav(`/finance?pay=${e.id}`)}>Record payment</Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-[16px] border border-dashed border-line bg-card px-4 py-3 text-[12px] text-muted leading-relaxed">
                This item has never been received as stock — what stands on the shelf came in another way.
              </p>
            )}
          </div>
        </>)}

        {tab === 'history' && (<>
          <p className="text-[12.5px] text-muted leading-relaxed px-1">
            Every movement of {item.name} in date order, each valued at the rate it was booked at.
            Tap a row for the complete transaction.
          </p>
          <MedicineLedgerSurface entries={own} refs={refs} valuation={valuation} canFinance={canFinance} today={today} />
        </>)}
          </motion.div>
        </Presence>
        </StaggerItem>
      </StaggerContainer>
      </PageReveal>

      {sheet === 'receive' && <MedicineReceiveSheet medicineId={item.id} onClose={() => setSheet(null)} />}
      {sheet === 'usage' && <MedicineUsageSheet medicineId={item.id} onClose={() => setSheet(null)} />}
      {sheet === 'adjust' && <MedicineAdjustSheet medicineId={item.id} onClose={() => setSheet(null)} />}
      {sheet === 'item' && <MedicineItemSheet item={item} onClose={() => setSheet(null)} />}
    </Page>
  );
}

function kindLabel(k: MedicineStockKind): string {
  return { OPENING: 'Opening stock', RECEIPT: 'Purchase / receive', USAGE: 'Usage', ADJUSTMENT: 'Adjustment' }[k];
}
