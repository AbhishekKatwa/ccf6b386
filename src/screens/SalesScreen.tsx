import { useMemo, useState } from 'react';
import { Receipt, Plus, CheckCheck, Handshake, Egg } from 'lucide-react';
import clsx from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Button, Field, SelectField, Stepper, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, StatusBadge, EmptyState, GroupList, ListRow, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { useApp, useCompanyData, useCan } from '@/store/app';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { eggStockByGrade } from '@/lib/calc';
import { EGG_GRADES, EGG_GRADE_LABELS, type EggGrade } from '@/types';

type Tab = 'logs' | 'sales';

export function SalesScreen() {
  const data = useCompanyData();
  const canCreate = useCan('create');
  const canAck = useCan('acknowledgeSales');
  const canTrade = useCan('manageTraders');
  const canFinance = useCan('viewFinance');
  const addSaleLog = useApp(s => s.addSaleLog);
  const acknowledgeSaleLog = useApp(s => s.acknowledgeSaleLog);
  const createTraderSale = useApp(s => s.createTraderSale);
  const pushToast = useApp(s => s.pushToast);

  const [tab, setTab] = useState<Tab>('logs');
  const [logDialog, setLogDialog] = useState(false);
  const [saleDialog, setSaleDialog] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeSheds = data.sheds.filter(sh => data.batches.some(b => b.shedId === sh.id && b.status === 'ACTIVE'));
  const [form, setForm] = useState({ shedId: activeSheds[0]?.id ?? '', trays: 10, grade: 'GOOD' as EggGrade, date: todayISO(), remarks: '' });
  const [saleForm, setSaleForm] = useState({ traderId: data.traders[0]?.id ?? '', ratePerTray: 150, paymentStatus: 'PENDING' as 'PAID' | 'PARTIAL' | 'PENDING', date: todayISO() });

  const logs = useMemo(() => [...data.saleLogs].sort((a, b) => b.date.localeCompare(a.date)), [data.saleLogs]);
  const pending = logs.filter(l => l.status === 'PENDING' && !l.eggSaleId);
  const acknowledged = logs.filter(l => l.status === 'ACKNOWLEDGED' && !l.eggSaleId);
  const selectedLogs = logs.filter(l => selected.includes(l.id));
  const selectedTrays = selectedLogs.reduce((s, l) => s + l.trays, 0);
  const selectedGrade = selectedLogs[0]?.grade;

  const shedName = (id: string) => data.sheds.find(s => s.id === id)?.name ?? '—';
  const traderName = (id: string) => data.traders.find(t => t.id === id)?.name ?? '—';

  function submitLog() {
    setError(null);
    const batch = data.batches.find(b => b.shedId === form.shedId && b.status === 'ACTIVE');
    if (!batch) { setError('This shed has no active batch'); return; }
    const r = addSaleLog({ shedId: form.shedId, batchId: batch.id, date: form.date, trays: form.trays, grade: form.grade, remarks: form.remarks || undefined });
    if (!r.ok) { setError(r.error ?? 'Failed'); return; }
    pushToast('success', `${form.trays} trays logged for ${shedName(form.shedId)}`);
    setLogDialog(false);
    setForm({ ...form, trays: 10, remarks: '' });
  }

  function submitSale() {
    setError(null);
    const r = createTraderSale({ traderId: saleForm.traderId, saleLogIds: selected, ratePerTray: saleForm.ratePerTray, paymentStatus: saleForm.paymentStatus, date: saleForm.date });
    if (!r.ok) { setError(r.error ?? 'Failed'); return; }
    pushToast('success', `Trader sale created for ${selectedTrays} trays`);
    setSaleDialog(false); setSelected([]);
  }

  function toggleSel(id: string) {
    setSelected(s => {
      if (s.includes(id)) return s.filter(x => x !== id);
      const grade = logs.find(l => l.id === id)?.grade;
      // One trader sale = one grade, so a mixed basket is refused here and in the store.
      const clash = s.some(x => logs.find(l => l.id === x)?.grade !== grade);
      if (clash) { pushToast('error', 'A trader sale can only hold one egg grade'); return s; }
      return [...s, id];
    });
  }

  const stockBalance = form.shedId ? eggStockByGrade(form.shedId, data.eggs, data.saleLogs)[form.grade].balance : 0;

  return (
    <Page withNav>
      <ScreenTitle
        eyebrow="Commerce" title="Sales"
        subtitle="Shed dispatch logs → acknowledged → final trader sales."
        action={canCreate ? <Button size="sm" icon={<Plus size={15} />} onClick={() => { setError(null); setLogDialog(true); }}>Sale log</Button> : undefined}
      />

      <div className="px-4 sm:px-0 mt-1 space-y-4">
        <StatStrip className="bg-card border border-line rounded-[16px] shadow-card">
          <StatCell><Stat label="Pending logs" value={pending.length} tone="accent" size="sm" /></StatCell>
          <StatCell><Stat label="To collate" value={acknowledged.length} tone="brand" size="sm" /></StatCell>
          <StatCell><Stat label="Trader sales" value={data.eggSales.length} size="sm" /></StatCell>
          {canFinance && <StatCell><Stat label="Sale value" value={fmtMoney(data.eggSales.reduce((s, e) => s + e.amount, 0))} tone="success" size="sm" /></StatCell>}
        </StatStrip>

        <SegmentedTabs value={tab} onChange={setTab}
          options={[{ value: 'logs', label: 'Sale logs', icon: <Receipt size={14} /> }, { value: 'sales', label: 'Trader sales', icon: <Handshake size={14} /> }]} />

        {tab === 'logs' && (
          <>
            {canAck && acknowledged.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-[14px] bg-brand-soft px-4 py-3">
                <p className="text-[13px] text-brand-ink font-medium">{selected.length} selected · {selectedTrays} trays{selectedGrade ? ` · ${EGG_GRADE_LABELS[selectedGrade]}` : ''}</p>
                <Button size="sm" disabled={selected.length === 0} icon={<Handshake size={14} />}
                  onClick={() => { setError(null); setSaleDialog(true); }}>Create trader sale</Button>
              </div>
            )}

            {logs.length === 0 && <EmptyState icon={<Receipt size={20} />} title="No sale logs yet" description="Farm managers record trays handed over from each shed here." />}

            <GroupList>
              {logs.map(l => {
                const selectable = canAck && l.status === 'ACKNOWLEDGED' && !l.eggSaleId;
                const isSel = selected.includes(l.id);
                return (
                  <ListRow
                    key={l.id}
                    leading={
                      selectable
                        ? <button onClick={() => toggleSel(l.id)} className={clsx('w-6 h-6 rounded-[7px] border flex items-center justify-center shrink-0 press', isSel ? 'bg-brand border-brand text-white' : 'border-line')}>{isSel && <CheckCheck size={14} />}</button>
                        : <span className="w-9 h-9 rounded-[10px] bg-sunk text-ink-2 flex items-center justify-center shrink-0"><Egg size={16} /></span>
                    }
                    title={<span className="flex items-center gap-2">{l.trays} trays · {shedName(l.shedId)}<Badge tone={l.grade === 'GOOD' ? 'brand' : 'warn'}>{EGG_GRADE_LABELS[l.grade]}</Badge></span>}
                    subtitle={`${fmtDate(l.date)} · ${l.trays * 30} eggs`}
                    trailing={
                      l.eggSaleId
                        ? <Badge tone="success">Sold</Badge>
                        : l.status === 'ACKNOWLEDGED'
                          ? <Badge tone="brand">Acknowledged</Badge>
                          : canAck
                            ? <Button size="sm" variant="outline" onClick={() => { const r = acknowledgeSaleLog(l.id); pushToast(r.ok ? 'success' : 'error', r.ok ? 'Acknowledged' : r.error ?? ''); }}>Acknowledge</Button>
                            : <StatusBadge status="PENDING" />
                    }
                  />
                );
              })}
            </GroupList>
          </>
        )}

        {tab === 'sales' && (
          <>
            {data.eggSales.length === 0 && <EmptyState icon={<Handshake size={20} />} title="No trader sales" description="Acknowledged sale logs are collated into trader sales here." />}
            <GroupList>
              {[...data.eggSales].sort((a, b) => b.date.localeCompare(a.date)).map(sale => (
                <ListRow key={sale.id}
                  leading={<span className="w-9 h-9 rounded-[10px] bg-brand-soft text-brand-ink flex items-center justify-center shrink-0"><Handshake size={16} /></span>}
                  title={traderName(sale.traderId)}
                  subtitle={`${fmtDate(sale.date)} · ${sale.trays} ${EGG_GRADE_LABELS[sale.grade].toLowerCase()} trays @ ${canFinance ? fmtMoney(sale.ratePerTray) : '₹•••'}/tray`}
                  trailing={
                    <div className="text-right">
                      {canFinance && <p className="font-mono text-[13px] font-semibold text-ink tnum">{fmtMoney(sale.amount)}</p>}
                      <StatusBadge status={sale.paymentStatus} />
                    </div>
                  }
                />
              ))}
            </GroupList>
          </>
        )}
      </div>

      {/* New sale log */}
      <Dialog open={logDialog} onClose={() => setLogDialog(false)} title="New sale log" subtitle="Records trays handed over from a shed. This reduces egg stock immediately."
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setLogDialog(false)}>Cancel</Button><Button block onClick={submitLog}>Save log</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Shed" value={form.shedId} onChange={e => setForm({ ...form, shedId: e.target.value })}
            options={activeSheds.map(s => ({ value: s.id, label: s.name }))} />
          {form.shedId && (
            <p className="text-[12px] text-muted bg-sunk rounded-[10px] px-3 py-2">{EGG_GRADE_LABELS[form.grade]} trays in stock: <span className="font-mono font-semibold text-ink tnum">{stockBalance}</span></p>
          )}
          <div>
            <p className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Trays</p>
            <Stepper value={form.trays} onChange={v => setForm({ ...form, trays: v })} min={1} step={1} suffix="trays" />
          </div>
          <SegmentedTabs value={form.grade} scroll onChange={g => setForm({ ...form, grade: g as EggGrade })}
            options={EGG_GRADES.map(g => ({ value: g, label: EGG_GRADE_LABELS[g] }))} />
          <Field label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Field label="Remarks (optional)" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} placeholder="Buyer / vehicle / notes" />
          {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        </div>
      </Dialog>

      {/* Create trader sale */}
      <Dialog open={saleDialog} onClose={() => setSaleDialog(false)} title="Create trader sale" subtitle={`${selected.length} ${EGG_GRADE_LABELS[selectedGrade ?? 'GOOD'].toLowerCase()} ${selected.length === 1 ? 'log' : 'logs'} · ${selectedTrays} trays`}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setSaleDialog(false)}>Cancel</Button><Button block onClick={submitSale}>Confirm sale</Button></div>}>
        <div className="space-y-3">
          <SelectField label="Trader" value={saleForm.traderId} onChange={e => setSaleForm({ ...saleForm, traderId: e.target.value })}
            options={data.traders.map(t => ({ value: t.id, label: t.name }))} />
          <Field label="Rate per tray (₹)" type="number" inputMode="decimal" value={String(saleForm.ratePerTray)}
            onChange={e => setSaleForm({ ...saleForm, ratePerTray: Number(e.target.value) })} />
          <div className="rounded-[12px] bg-sunk px-3 py-2.5 flex items-center justify-between">
            <span className="text-[13px] text-muted">Total</span>
            <span className="font-mono text-[16px] font-semibold text-ink tnum">{fmtMoney(selectedTrays * saleForm.ratePerTray)}</span>
          </div>
          <SegmentedTabs value={saleForm.paymentStatus} onChange={p => setSaleForm({ ...saleForm, paymentStatus: p })}
            options={[{ value: 'PENDING', label: 'Pending' }, { value: 'PARTIAL', label: 'Partial' }, { value: 'PAID', label: 'Paid' }]} />
          <Field label="Date" type="date" value={saleForm.date} onChange={e => setSaleForm({ ...saleForm, date: e.target.value })} />
          {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        </div>
      </Dialog>
    </Page>
  );
}
