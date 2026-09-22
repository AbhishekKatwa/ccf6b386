import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, EmptyState } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, Stepper } from '@/components/ui/Form';
import { fmtIN, fmtMoney, todayISO } from '@/lib/format';

const EGGS_PER_TRAY = 30;

export function EggSaleFormScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const batches = useApp(s => s.batches);
  const traders = useApp(s => s.traders);
  const addEggSale = useApp(s => s.addEggSale);
  const pushToast = useApp(s => s.pushToast);
  const batch = batches.find(b => b.id === batchId);

  const [form, setForm] = useState({
    date: todayISO(),
    traderId: '',
    buyerName: '',
    trays: '',
    ratePerEgg: '',
    paymentStatus: 'PENDING' as 'PAID' | 'PARTIAL' | 'PENDING',
    remarks: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!batch) return <Page><Header title="Egg sale" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;

  const trays = parseFloat(form.trays) || 0;
  const rate = parseFloat(form.ratePerEgg) || 0;
  const eggs = trays * EGGS_PER_TRAY;
  const amount = eggs * rate;

  function submit() {
    const e: Record<string, string> = {};
    if (!form.date) e.date = 'Required';
    if (!form.buyerName.trim()) e.buyerName = 'Required';
    if (trays <= 0) e.trays = 'Must be > 0';
    if (rate <= 0) e.ratePerEgg = 'Must be > 0';
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    setTimeout(() => {
      const r = addEggSale({
        batchId: batch!.id,
        traderId: form.traderId || undefined,
        date: form.date,
        buyerName: form.buyerName.trim(),
        trays,
        eggsPerTray: EGGS_PER_TRAY,
        ratePerEgg: rate,
        paymentStatus: form.paymentStatus,
        remarks: form.remarks || undefined,
      });
      setSaving(false);
      if (!r.ok) { pushToast('error', r.error ?? 'Failed'); return; }
      pushToast('success', `Sale recorded · ${fmtMoney(amount)}`);
      nav(`/batches/${batch!.id}/eggs`);
    }, 350);
  }

  return (
    <Page withNav>
      <Header title="Add egg sale" subtitle={batch.code} />
      <div className="px-4 sm:px-0 mt-3 space-y-4 pb-4">
        {/* live calculation */}
        <div className="rounded-[20px] bg-brand text-white p-5 shadow-card">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Total amount</p>
          <p className="font-display text-[38px] leading-none font-semibold tnum mt-2">{fmtMoney(amount, 2)}</p>
          <p className="font-mono text-[11px] text-white/60 mt-2.5 tnum">{fmtIN(trays)} trays × {EGGS_PER_TRAY} × {fmtMoney(rate, 2)} = {fmtIN(eggs)} eggs</p>
        </div>

        <Card>
          <div className="space-y-3.5">
            <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} error={errors.date} />
            <SelectField label="Trader (optional)" value={form.traderId}
              onChange={e => {
                const t = traders.find(x => x.id === e.target.value);
                setForm(f => ({ ...f, traderId: e.target.value, buyerName: t?.name ?? f.buyerName }));
              }}
              options={[{ value: '', label: '— Walk-in buyer —' }, ...traders.map(t => ({ value: t.id, label: t.name }))]} />
            <Field label="Buyer name" value={form.buyerName} onChange={e => setForm(f => ({ ...f, buyerName: e.target.value }))} placeholder="e.g. Rajesh Traders" error={errors.buyerName} />

            <div>
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Trays</span>
              <div className="flex items-center gap-3">
                <Stepper value={trays} onChange={v => setForm(f => ({ ...f, trays: String(v) }))} step={5} min={0} />
                <input
                  type="number" inputMode="numeric" value={form.trays} placeholder="or type"
                  onChange={e => setForm(f => ({ ...f, trays: e.target.value }))}
                  className={`flex-1 min-w-0 bg-card border rounded-[12px] px-3 py-2.5 text-[14px] font-mono tnum outline-none transition-colors ${errors.trays ? 'border-danger' : 'border-line focus:border-brand'}`}
                />
              </div>
              {errors.trays && <span className="block text-[12px] text-danger mt-1.5 font-medium">{errors.trays}</span>}
            </div>

            <Field label="Rate per egg (₹)" type="number" inputMode="decimal" step="0.01" value={form.ratePerEgg} onChange={e => setForm(f => ({ ...f, ratePerEgg: e.target.value }))} placeholder="e.g. 5.00" className="font-mono" error={errors.ratePerEgg} />
            <SelectField label="Payment status" value={form.paymentStatus}
              onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value as 'PAID' | 'PARTIAL' | 'PENDING' }))}
              options={[{ value: 'PENDING', label: 'Pending' }, { value: 'PARTIAL', label: 'Partial' }, { value: 'PAID', label: 'Paid' }]} />
            <TextArea label="Remarks (optional)" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Vehicle no, payment mode…" />
          </div>
        </Card>

        <Card className="bg-sunk border-line">
          <Row label="Formula" value="Trays × 30 × Rate" mono={false} />
          <Row label="Total eggs" value={fmtIN(eggs)} />
          <Row label="Total amount" value={fmtMoney(amount, 2)} valueClass="text-brand text-[15px]" />
        </Card>

        <Button block size="lg" variant="success" loading={saving} onClick={submit}>Save sale entry</Button>
      </div>
    </Page>
  );
}
