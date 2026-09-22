import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Handshake, Plus, Phone, ChevronRight } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { ScreenTitle, Page } from '@/components/ui/Header';
import { Card, EmptyState, GroupList, Avatar, Badge, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { Button, Field, SearchField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtIN, fmtMoney } from '@/lib/format';

export function TradersScreen() {
  const nav = useNavigate();
  const traders = useCompanyData().traders;
  const addTrader = useApp(s => s.addTrader);
  const pushToast = useApp(s => s.pushToast);
  const canManage = useCan('manageTraders');
  const canFinance = useCan('viewFinance');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', mobile: '', gstin: '', address: '', openingBalance: '' });

  const filtered = useMemo(() => {
    if (!q.trim()) return traders;
    const s = q.toLowerCase();
    return traders.filter(t => t.name.toLowerCase().includes(s) || t.mobile.includes(s));
  }, [traders, q]);

  const totalOutstanding = traders.reduce((s, t) => s + t.outstandingAmount, 0);
  const owed = traders.filter(t => t.outstandingAmount > 0).length;

  function submit() {
    const m = form.mobile.replace(/\D/g, '');
    if (!form.name.trim()) return pushToast('error', 'Name required');
    if (m.length !== 10) return pushToast('error', 'Valid 10-digit mobile required');
    const opening = parseFloat(form.openingBalance) || 0;
    const t = addTrader({ name: form.name.trim(), mobile: m, gstin: form.gstin || undefined, address: form.address || undefined, openingBalance: opening, outstandingAmount: opening, active: true });
    if (!t) return pushToast('error', 'Only Owner / Financial Supervisor can add traders');
    pushToast('success', 'Trader added');
    setOpen(false);
    setForm({ name: '', mobile: '', gstin: '', address: '', openingBalance: '' });
  }

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Commerce" title="Traders" subtitle={`${traders.length} in network`}
        action={canManage ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add</Button> : undefined} />

      <div className="px-4 sm:px-0 space-y-4">
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Traders" value={fmtIN(traders.length)} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Active" value={fmtIN(traders.filter(t => t.active).length)} tone="success" size="md" /></StatCell>
            <StatCell><Stat label="Outstanding" value={canFinance ? fmtMoney(totalOutstanding) : '₹•••••'} sub={canFinance ? `${owed} pending` : undefined} tone="danger" size="md" /></StatCell>
          </StatStrip>
        </Card>

        <SearchField placeholder="Search by name or mobile" value={q} onChange={setQ} />

        {filtered.length === 0 ? (
          <EmptyState icon={<Handshake size={22} />} title="No traders found"
            description={q ? 'Try a different search.' : 'Add your first trader to start tracking sales and outstanding.'}
            action={canManage ? <Button onClick={() => setOpen(true)} icon={<Plus size={14} />}>Add trader</Button> : undefined} />
        ) : (
          <GroupList>
            {filtered.map(t => (
              <button key={t.id} onClick={() => nav(`/traders/${t.id}`)} className="w-full flex items-center gap-3 px-4 py-3 text-left press hover:bg-sunk/60">
                <Avatar name={t.name} size={42} tone="accent" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-ink truncate">{t.name}</p>
                  <p className="font-mono text-[12px] text-muted flex items-center gap-1 mt-0.5 tnum"><Phone size={10} /> {t.mobile}</p>
                </div>
                {canFinance && t.outstandingAmount > 0 && <Badge tone="danger">{fmtMoney(t.outstandingAmount)}</Badge>}
                <ChevronRight size={17} className="text-muted-2 shrink-0" />
              </button>
            ))}
          </GroupList>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add trader"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Save trader</Button></div>}>
        <div className="space-y-3">
          <Field label="Trader name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Rajesh Traders" />
          <Field label="Mobile number" type="tel" inputMode="numeric" maxLength={10} value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))} prefix="+91" placeholder="10-digit" className="font-mono" />
          <Field label="GSTIN (optional)" value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="27AABCR1234F1Z5" className="font-mono" />
          <Field label="Address (optional)" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="City, State" />
          <Field label="Opening balance (₹, optional)" type="number" inputMode="decimal" value={form.openingBalance} onChange={e => setForm(f => ({ ...f, openingBalance: e.target.value }))} placeholder="e.g. 5000" className="font-mono" hint="Amount already owed by the trader" />
        </div>
      </Dialog>
    </Page>
  );
}
