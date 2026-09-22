import { useMemo, useState } from 'react';
import { Wallet, Plus, TrendingUp, TrendingDown, ShieldAlert } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page, ScreenTitle } from '@/components/ui/Header';
import { Card, EmptyState, StatStrip, StatCell, Stat, IconTile, GroupList, ListRow, Badge } from '@/components/ui/Card';
import { Button, Field, SelectField, TextArea, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtMoney, fmtDate, todayISO } from '@/lib/format';
import type { TxnKind } from '@/types';

const KINDS: TxnKind[] = ['INCOME', 'EXPENSE', 'PURCHASE', 'SALE', 'PAYMENT_IN', 'PAYMENT_OUT'];
const CATEGORIES = ['Egg Sale', 'Bird Sale', 'Manure Sale', 'Feed Purchase', 'Chick Purchase', 'Medicine', 'Labour', 'Electricity', 'Transport', 'Maintenance', 'Other'];

const isInflow = (k: TxnKind) => k === 'INCOME' || k === 'SALE' || k === 'PAYMENT_IN';

export function FinanceScreen() {
  const { finance, batches } = useCompanyData();
  const addFinance = useApp(s => s.addFinance);
  const pushToast = useApp(s => s.pushToast);
  const canView = useCan('viewFinance');
  const canCreate = useCan('create');
  const [filter, setFilter] = useState<'all' | TxnKind>('all');
  const [batchFilter, setBatchFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: todayISO(), kind: 'EXPENSE' as TxnKind, amount: '',
    category: 'Feed Purchase', batchId: '', counterparty: '', remarks: '',
  });

  const filtered = useMemo(() => {
    let l = [...finance].sort((a, b) => b.date.localeCompare(a.date));
    if (filter !== 'all') l = l.filter(x => x.kind === filter);
    if (batchFilter) l = l.filter(x => x.batchId === batchFilter);
    return l;
  }, [finance, filter, batchFilter]);

  const totals = useMemo(() => {
    const income = finance.filter(f => isInflow(f.kind)).reduce((s, f) => s + f.amount, 0);
    const expense = finance.filter(f => !isInflow(f.kind)).reduce((s, f) => s + f.amount, 0);
    return { income, expense, balance: income - expense };
  }, [finance]);

  if (!canView) {
    return (
      <Page withNav>
        <Header title="Finance" />
        <div className="px-4 sm:px-0 mt-3">
          <Card>
            <div className="flex items-start gap-3">
              <IconTile tone="danger"><ShieldAlert size={18} /></IconTile>
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-ink">Restricted access</p>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                  Financial data is hidden for your role. Contact the farm <strong className="text-ink-2">OWNER</strong> to request explicit finance permission.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </Page>
    );
  }

  function submit() {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return pushToast('error', 'Enter a valid amount');
    const r = addFinance({
      date: form.date, kind: form.kind, amount: amt, category: form.category,
      batchId: form.batchId || undefined, counterparty: form.counterparty || undefined,
      remarks: form.remarks || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', 'Transaction recorded');
    setOpen(false);
    setForm({ date: todayISO(), kind: 'EXPENSE', amount: '', category: 'Feed Purchase', batchId: '', counterparty: '', remarks: '' });
  }

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Commerce" title="Finance" subtitle="Income · Expense · Balance"
        action={canCreate ? <Button size="sm" variant="accent" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add</Button> : undefined} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card padded={false}>
          <StatStrip>
            <StatCell><Stat label="Income" value={fmtMoney(totals.income)} tone="success" size="sm" /></StatCell>
            <StatCell><Stat label="Expense" value={fmtMoney(totals.expense)} tone="danger" size="sm" /></StatCell>
            <StatCell><Stat label="Balance" value={fmtMoney(totals.balance)} tone={totals.balance >= 0 ? 'brand' : 'danger'} size="sm" /></StatCell>
          </StatStrip>
        </Card>

        <SegmentedTabs value={filter} onChange={v => setFilter(v as typeof filter)} scroll
          options={[{ value: 'all', label: 'All' }, ...KINDS.map(k => ({ value: k, label: k.replace('_', ' ') }))]} />

        <SelectField value={batchFilter} onChange={e => setBatchFilter(e.target.value)}
          options={[{ value: '', label: 'All batches' }, ...batches.map(b => ({ value: b.id, label: b.code }))]} />

        {filtered.length === 0 ? (
          <EmptyState icon={<Wallet size={22} />} title="No transactions" description="Finance entries will appear here." />
        ) : (
          <GroupList>
            {filtered.slice(0, 50).map(t => {
              const inFlow = isInflow(t.kind);
              return (
                <ListRow key={t.id}
                  leading={<IconTile tone={inFlow ? 'success' : 'danger'}>{inFlow ? <TrendingUp size={16} /> : <TrendingDown size={16} />}</IconTile>}
                  title={<span className="flex items-center gap-2">{t.category}</span>}
                  subtitle={`${fmtDate(t.date)} · ${t.kind.replace('_', ' ')}${t.counterparty ? ` · ${t.counterparty}` : ''}`}
                  trailing={<span className={`font-mono tnum font-display font-bold text-sm ${inFlow ? 'text-success' : 'text-danger'}`}>{inFlow ? '+' : '−'}{fmtMoney(t.amount)}</span>} />
              );
            })}
          </GroupList>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add Transaction" subtitle="Record income or expense"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as TxnKind }))}
            options={KINDS.map(k => ({ value: k, label: k.replace('_', ' ') }))} />
          <div className="flex items-center gap-2">
            <Badge tone={isInflow(form.kind) ? 'success' : 'danger'}>{isInflow(form.kind) ? 'Money in' : 'Money out'}</Badge>
          </div>
          <Field label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Field label="Amount (₹)" type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className="font-mono" />
          <SelectField label="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            options={CATEGORIES.map(c => ({ value: c, label: c }))} />
          <SelectField label="Batch (optional)" value={form.batchId} onChange={e => setForm(f => ({ ...f, batchId: e.target.value }))}
            options={[{ value: '', label: '— None —' }, ...batches.map(b => ({ value: b.id, label: b.code }))]} />
          <Field label="Counterparty" value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} placeholder="Trader / supplier name" />
          <TextArea label="Remarks" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
        </div>
      </Dialog>
    </Page>
  );
}
