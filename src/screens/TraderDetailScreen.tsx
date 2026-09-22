import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Phone, MapPin, Plus, TrendingUp, TrendingDown, Egg } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, Row, Avatar, StatusBadge, GroupList, SectionTitle, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { Button, Field, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtMoney, fmtIN, fmtDate, todayISO } from '@/lib/format';

export function TraderDetailScreen() {
  const { traderId } = useParams();
  const traders = useApp(s => s.traders);
  const txns = useApp(s => s.traderTxns);
  const addTxn = useApp(s => s.addTraderTxn);
  const pushToast = useApp(s => s.pushToast);
  const canFinance = useCan('viewFinance');
  const canCreate = useCan('create');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: todayISO(), kind: 'EGG_SALE' as 'EGG_SALE' | 'PAYMENT_IN' | 'RATE_UPDATE',
    qty: '', rate: '', amount: '', remarks: '',
  });

  const trader = traders.find(t => t.id === traderId);
  const list = useMemo(() => txns.filter(t => t.traderId === traderId).sort((a, b) => b.date.localeCompare(a.date)), [txns, traderId]);

  if (!trader) return <Page><Header title="Trader" /><div className="px-4 sm:px-0"><EmptyState title="Trader not found" /></div></Page>;

  const totals = list.reduce((acc, t) => {
    if (t.kind === 'EGG_SALE') { acc.sales += t.amount; acc.eggs += t.qty ?? 0; }
    if (t.kind === 'PAYMENT_IN') acc.payments += t.amount;
    return acc;
  }, { sales: 0, payments: 0, eggs: 0 });

  const rateHistory = list.filter(t => t.kind === 'RATE_UPDATE' || t.kind === 'EGG_SALE').slice(0, 8);

  function submit() {
    const amt = parseFloat(form.amount) || 0;
    const qty = parseFloat(form.qty) || 0;
    const rate = parseFloat(form.rate) || 0;
    if (form.kind === 'EGG_SALE' && (qty <= 0 || rate <= 0)) return pushToast('error', 'Enter qty and rate');
    if (form.kind === 'PAYMENT_IN' && amt <= 0) return pushToast('error', 'Enter amount');
    addTxn({
      traderId: trader!.id, date: form.date, kind: form.kind,
      qty: form.kind === 'EGG_SALE' ? qty : undefined,
      rate: form.kind !== 'PAYMENT_IN' ? rate : undefined,
      amount: form.kind === 'EGG_SALE' ? qty * rate : amt,
      remarks: form.remarks || undefined,
    });
    pushToast('success', 'Transaction saved');
    setOpen(false);
    setForm({ date: todayISO(), kind: 'EGG_SALE', qty: '', rate: '', amount: '', remarks: '' });
  }

  return (
    <Page withNav>
      <Header title={trader.name} subtitle={`+91 ${trader.mobile}`} />
      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <Avatar name={trader.name} size={52} tone="accent" />
            <div className="flex-1 min-w-0">
              <p className="font-display text-[17px] font-semibold text-ink truncate">{trader.name}</p>
              <p className="font-mono text-[12px] text-muted flex items-center gap-1 mt-1 tnum"><Phone size={11} /> {trader.mobile}</p>
              {trader.address && <p className="text-[12px] text-muted flex items-center gap-1 mt-0.5"><MapPin size={11} /> {trader.address}</p>}
            </div>
            <StatusBadge status={trader.active ? 'ACTIVE' : 'CLOSED'} />
          </div>
          {trader.gstin && <Row label="GSTIN" value={trader.gstin} />}
          <Row label="Total eggs" value={fmtIN(totals.eggs)} />
        </Card>

        {canFinance && (
          <Card padded={false} className="overflow-hidden">
            <StatStrip>
              <StatCell><Stat label="Total sales" value={fmtMoney(totals.sales)} tone="success" size="md" /></StatCell>
              <StatCell><Stat label="Received" value={fmtMoney(totals.payments)} tone="brand" size="md" /></StatCell>
              <StatCell><Stat label="Outstanding" value={fmtMoney(trader.outstandingAmount)} tone={trader.outstandingAmount > 0 ? 'danger' : 'neutral'} size="md" /></StatCell>
            </StatStrip>
          </Card>
        )}

        {canCreate && <Button block variant="accent" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Add transaction</Button>}

        <div>
          <SectionTitle>Rate history</SectionTitle>
          {rateHistory.length === 0 ? (
            <EmptyState title="No rate history" />
          ) : (
            <GroupList>
              {rateHistory.map(t => (
                <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-mono text-[12px] text-muted tnum">{fmtDate(t.date)}</span>
                  <span className="font-display text-[15px] font-semibold text-ink tnum">{canFinance ? fmtMoney(t.rate ?? 0, 2) : '₹••'}</span>
                </div>
              ))}
            </GroupList>
          )}
        </div>

        <div>
          <SectionTitle>Transactions</SectionTitle>
          {list.length === 0 ? (
            <EmptyState icon={<Egg size={22} />} title="No transactions" description="Record egg sales or payments to this trader." />
          ) : (
            <GroupList>
              {list.map(t => {
                const isIn = t.kind === 'PAYMENT_IN';
                const Icon = isIn ? TrendingDown : t.kind === 'EGG_SALE' ? Egg : TrendingUp;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 ${isIn ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent-ink'}`}>
                      <Icon size={15} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-ink">{t.kind.replace(/_/g, ' ')}</p>
                      <p className="font-mono text-[11px] text-muted truncate mt-0.5 tnum">
                        {fmtDate(t.date)}{t.qty ? ` · ${fmtIN(t.qty)} eggs` : ''}{t.rate ? ` @ ${canFinance ? fmtMoney(t.rate, 2) : '₹••'}` : ''}
                      </p>
                    </div>
                    <p className={`font-display text-[15px] font-semibold font-mono tnum shrink-0 ${isIn ? 'text-success' : 'text-ink'}`}>
                      {canFinance ? `${isIn ? '−' : '+'}${fmtMoney(t.amount)}` : '₹•••••'}
                    </p>
                  </div>
                );
              })}
            </GroupList>
          )}
        </div>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add transaction" subtitle={trader.name}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as typeof form.kind }))}
            options={[
              { value: 'EGG_SALE', label: 'Egg sale' },
              { value: 'PAYMENT_IN', label: 'Payment received' },
              { value: 'RATE_UPDATE', label: 'Rate update' },
            ]} />
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          {form.kind === 'EGG_SALE' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Eggs" type="number" inputMode="numeric" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} className="font-mono" />
              <Field label="Rate / egg (₹)" type="number" inputMode="decimal" step="0.01" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} className="font-mono" />
            </div>
          )}
          {form.kind === 'PAYMENT_IN' && (
            <Field label="Amount (₹)" type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="font-mono" />
          )}
          {form.kind === 'RATE_UPDATE' && (
            <Field label="New rate (₹/egg)" type="number" inputMode="decimal" step="0.01" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} className="font-mono" />
          )}
          <Field label="Remarks" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>
    </Page>
  );
}
