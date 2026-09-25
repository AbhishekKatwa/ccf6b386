/**
 * The godown's Add Stock Entry sheet — the one place a KG movement is booked by hand.
 *
 * It lives here rather than on the Godown screen because the same booking is the answer
 * from several places: an ingredient whose shelf is empty, a coverage warning, a payable.
 * Every figure it shows is derived from the replayed weighted average, and a purchase
 * still books stock and a payable only — no money leaves until Finance records it.
 *
 * `presetIngredient` selects the ingredient for the caller. It never invents one: a name
 * that is not on the master list yet is put into the register box instead, so adding an
 * ingredient stays the deliberate act it is on the Godown screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp, useCompanyData } from '@/store/app';
import { Button, Field, SearchField, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { fmtIN, fmtMoney, todayISO } from '@/lib/format';
import { blendPrice } from '@/lib/valuation';
import type { FeedStockKind } from '@/types';

export function AddStockDialog({ open, onClose, presetIngredient }: {
  open: boolean;
  onClose: () => void;
  presetIngredient?: string | null;
}) {
  const data = useCompanyData();
  const stock = data.feedStock;
  const addStock = useApp(s => s.addFeedStock);
  const takeReceiptNo = useApp(s => s.takeReceiptNo);
  const catalog = useApp(s => s.ingredientCatalog);
  const addIngredientType = useApp(s => s.addIngredientType);
  const pushToast = useApp(s => s.pushToast);
  const { valuation } = useGodownPrices();

  const [form, setForm] = useState({
    ingredient: 'Maize' as string, date: todayISO(),
    kind: 'FEED_IN' as FeedStockKind,
    supplier: '', qtyKg: '', ratePerKg: '', remarks: '',
  });
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  /** The ingredient master: the global catalogue plus anything already in the ledger. */
  const knownIngredients = useMemo(() => {
    const set = new Set<string>(catalog);
    for (const e of stock) set.add(e.ingredient);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalog, stock]);

  useEffect(() => {
    if (!open) return;
    const preset = presetIngredient?.trim();
    if (!preset) return;
    const listed = knownIngredients.find(i => i.toLowerCase() === preset.toLowerCase());
    if (listed) setForm(f => ({ ...f, ingredient: listed }));
    else setNewName(preset);
  }, [open, presetIngredient, knownIngredients]);

  /* A new ingredient is a deliberate act: it is registered here, never as a side effect of a stock entry. */
  const trimmedNew = newName.trim();
  const nameTaken = knownIngredients.some(i => i.toLowerCase() === trimmedNew.toLowerCase());
  const nameMatches = trimmedNew
    ? knownIngredients.filter(i => i.toLowerCase().includes(trimmedNew.toLowerCase())).slice(0, 6)
    : [];

  function registerIngredient() {
    const r = addIngredientType(trimmedNew);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    setForm(f => ({ ...f, ingredient: trimmedNew }));
    setNewName('');
    pushToast('success', `“${trimmedNew}” added to the ingredient list and selected`);
  }

  /* ---- derived state for the live valuation preview ---- */

  const isOutgoing = form.kind === 'FEED_OUT' || form.kind === 'CONSUMPTION' || form.kind === 'SHORTAGE';
  const needsRate = form.kind === 'FEED_IN' || form.kind === 'OPENING';
  /** A purchase is a payable: it names a supplier, and its value is quantity × rate — never typed. */
  const isPurchase = form.kind === 'FEED_IN';
  const qtyEntered = parseFloat(form.qtyKg);
  const rateEntered = parseFloat(form.ratePerKg);
  const hasQty = Number.isFinite(qtyEntered) && qtyEntered !== 0;
  const hasRate = Number.isFinite(rateEntered) && rateEntered > 0;
  const receiving = !isOutgoing && qtyEntered > 0;
  const purchaseValue = isPurchase && qtyEntered > 0 && hasRate ? qtyEntered * rateEntered : null;

  const position = valuation.now(form.ingredient);
  const preview = receiving && hasQty && hasRate ? {
    stockKg: position.kg,
    stockAvg: position.avg,
    afterKg: position.kg + qtyEntered,
    afterValue: position.value + qtyEntered * rateEntered,
    newAvg: blendPrice(position.valuedKg, position.avg, qtyEntered, rateEntered),
    unpricedKg: Math.max(0, position.kg - position.valuedKg),
  } : null;
  const rateError = form.ratePerKg.trim() !== '' && !hasRate ? 'Enter a rate above ₹0, or leave it empty'
    : needsRate && hasQty && !hasRate ? 'Receipt rate needed — the godown average is built from it'
      : undefined;

  async function submit() {
    if (busy) return;
    const ingredient = form.ingredient.trim();
    if (!ingredient) return pushToast('error', 'Select an ingredient');
    if (!knownIngredients.some(i => i.toLowerCase() === ingredient.toLowerCase())) {
      return pushToast('error', 'This ingredient is not in the list yet — add it as a new ingredient first');
    }
    const qty = parseFloat(form.qtyKg);
    if (!Number.isFinite(qty) || qty === 0) return pushToast('error', 'Enter valid quantity');
    if (form.kind !== 'ADJUSTMENT' && form.kind !== 'SHORTAGE' && qty <= 0) return pushToast('error', 'Quantity must be greater than 0');
    const rate = parseFloat(form.ratePerKg);
    const rated = Number.isFinite(rate) && rate > 0;
    if (!isOutgoing && form.ratePerKg.trim() !== '' && !rated) return pushToast('error', 'Enter a rate above ₹0, or leave it empty');
    if (needsRate && !rated) return pushToast('error', 'Enter the receipt rate per kg — it is what prices this stock');
    if (isPurchase && !form.supplier.trim()) return pushToast('error', 'Record the supplier this stock was bought from');
    // A purchase takes its number from the receipt counter, asked for at the moment it is being
    // booked: two tablets buying feed on the same morning cannot be given the same one. The
    // store has already said why when the answer is no, and the form is left as it stands.
    let purchaseRef: string | undefined;
    if (isPurchase) {
      setBusy(true);
      const no = await takeReceiptNo('PUR', form.date);
      setBusy(false);
      if (!no) return;
      purchaseRef = no;
    }
    const r = addStock({
      ingredient, date: form.date, kind: form.kind,
      qtyKg: qty, ratePerKg: !isOutgoing && rated ? rate : undefined,
      supplier: isPurchase ? form.supplier.trim() : undefined,
      remarks: form.remarks || undefined,
    }, { purchaseRef });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', isPurchase && purchaseValue !== null
      ? `Purchase booked · ${fmtMoney(purchaseValue)} payable to ${form.supplier.trim()} — no money has left yet`
      : preview
        ? `Saved · ${ingredient} average is now ${fmtMoney(preview.newAvg, 2)}/kg`
        : form.kind === 'SHORTAGE'
          ? `Shortage booked · ${ingredient} deducted from the godown`
          : 'Stock entry saved');
    onClose();
    setForm(f => ({ ...f, qtyKg: '', ratePerKg: '', remarks: '', supplier: '' }));
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add Stock Entry" subtitle="Central godown movement (KG)"
      footer={<div className="flex gap-2"><Button variant="outline" block onClick={onClose}>Cancel</Button><Button block onClick={submit} disabled={busy}>Save</Button></div>}>
      <div className="space-y-3">
        <SelectField label="Ingredient" value={form.ingredient} onChange={e => setForm(f => ({ ...f, ingredient: e.target.value }))}
          options={knownIngredients.map(i => ({ value: i, label: i }))} />
        <p className="text-[12px] text-muted leading-relaxed">
          Chosen from the ingredient master, so the godown, the formulas and the sheds’ feed cost all speak the same name.
        </p>

        <div className="rounded-[14px] border border-line bg-sunk/50 px-3 py-2.5">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted mb-2">Need an ingredient that isn&rsquo;t listed?</p>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <SearchField value={newName} onChange={setNewName} placeholder="New ingredient name" />
            </div>
            <Button variant={trimmedNew && !nameTaken ? 'primary' : 'outline'} className="mt-0.5 shrink-0"
              onClick={registerIngredient} disabled={!trimmedNew || nameTaken}>
              <Plus size={14} /> Add
            </Button>
          </div>
          {nameMatches.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {nameMatches.map(i => (
                <button key={i} type="button" onClick={() => { setForm(f => ({ ...f, ingredient: i })); setNewName(''); }}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold press bg-card border border-line text-ink-2 hover:border-brand hover:text-brand">
                  {i} — already listed
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-faint mt-2 leading-relaxed">
            Adding here puts the name on the master list for every farm. A stock entry never creates one on its own.
          </p>
        </div>

        <SelectField label="Transaction type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as FeedStockKind }))}
          options={[
            { value: 'FEED_IN', label: 'Feed in (purchase)' },
            { value: 'FEED_OUT', label: 'Feed out (issue)' },
            { value: 'CONSUMPTION', label: 'Consumption (out)' },
            { value: 'SHORTAGE', label: 'Shortage (stock found short)' },
            { value: 'ADJUSTMENT', label: 'Adjustment (signed)' },
            { value: 'OPENING', label: 'Opening stock' },
          ]} />
        <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        {isPurchase && (
          <>
            <Field label="Supplier" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
              placeholder="Who the stock was bought from"
              hint="The payable is tracked against this name — a purchase on credit is owed to somebody" />
            <p className="text-[12px] text-muted leading-relaxed rounded-[12px] bg-sunk px-3 py-2.5">
              Booking this stock does not pay for it. No cash or bank money leaves until Finance records a payment
              against this purchase, and the amount is never re-typed on the stock entry.
            </p>
          </>
        )}
        <Field label={form.kind === 'SHORTAGE' ? 'Quantity found short (kg)'
          : form.kind === 'ADJUSTMENT' ? 'Quantity (kg, use − for shortage)' : 'Quantity (kg)'} type="number" inputMode="decimal" step="0.01" value={form.qtyKg} onChange={e => setForm(f => ({ ...f, qtyKg: e.target.value }))} placeholder="e.g. 5000" className="font-mono" error={hasQty || form.qtyKg === '' ? undefined : 'Enter a quantity in KG'} />
        {form.kind === 'SHORTAGE' && (
          <p className="text-[12px] text-muted leading-relaxed rounded-[12px] bg-sunk px-3 py-2.5">
            Booked as a godown shortage, not as any shed&rsquo;s feed. It leaves at the average in force and is
            shared out by the allocation rule the Finance screen reports under.
          </p>
        )}
        {!isOutgoing && (
          <Field label={needsRate ? 'Receipt rate (₹ per kg)' : 'Rate (₹ per kg, optional)'} type="number" inputMode="decimal" step="0.01" value={form.ratePerKg} onChange={e => setForm(f => ({ ...f, ratePerKg: e.target.value }))} placeholder="e.g. 25.50" className="font-mono"
            error={rateError}
            hint={needsRate ? 'Blends into this ingredient’s godown average' : 'Optional — without it the stock returns at the average in force'} />
        )}
        {isPurchase && (
          <Field label="Purchase value" readOnly value={purchaseValue === null ? '' : fmtMoney(purchaseValue, 2)}
            placeholder="Quantity × receipt rate" className="font-mono"
            hint="Calculated from the quantity and the receipt rate — this is what the supplier is owed, and it is not typed in" />
        )}
        {isOutgoing && (
          <p className="text-[12px] text-muted leading-relaxed rounded-[12px] bg-sunk px-3 py-2.5">
            {position.avg === null
              ? <>The godown has never priced {form.ingredient}, so this outflow is counted in KG without a value.</>
              : <>This leaves at the average in force — <span className="font-mono tnum">{fmtMoney(position.avg, 2)}/kg</span> — and the average itself does not move.</>}
          </p>
        )}

        {preview && (
          <div className="rounded-[14px] border border-brand/25 bg-brand-soft/60 px-3 py-2.5">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-brand-ink mb-2">Effect on the godown average</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {[
                { label: 'Current stock', value: `${fmtIN(preview.stockKg, 2)} kg` },
                { label: 'Current avg', value: preview.stockAvg === null ? '— not priced yet' : `${fmtMoney(preview.stockAvg, 2)}/kg` },
                { label: 'After receipt', value: `${fmtIN(preview.afterKg, 2)} kg` },
                { label: 'New avg', value: `${fmtMoney(preview.newAvg, 2)}/kg`, lead: true },
              ].map(c => (
                <div key={c.label}>
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">{c.label}</p>
                  <p className={clsx('font-mono tnum text-[13.5px] font-semibold mt-0.5', c.lead ? 'text-brand-ink' : 'text-ink')}>{c.value}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-2 leading-relaxed">
              Stock value goes to {fmtMoney(preview.afterValue)}
              {preview.stockKg === 0 ? ' — with empty shelves, this receipt sets the average.' : ' — the old stock keeps its cost and the new rate blends in.'}
              {preview.unpricedKg > 0 && <> {fmtIN(preview.unpricedKg)} kg on the shelf carry no price and stay outside the average.</>}
            </p>
          </div>
        )}

        <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Supplier, vehicle no, bags..." />
      </div>
    </Dialog>
  );
}
