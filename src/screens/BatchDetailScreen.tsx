import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronRight, Egg, Skull, Users, Wallet, ClipboardList,
  FileText, Truck, Info, Wheat, Package, Lock, ArchiveX,
} from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, StatusBadge, EmptyState, GroupList, ListRow, IconTile, StatStrip, StatCell, Stat, Badge } from '@/components/ui/Card';
import { Button, Field, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { DayLockPanel } from '@/components/ui/DayLockPanel';
import { fmtIN, fmtMoney, fmtPct, fmtDate, todayISO } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import type { Tone } from '@/components/ui/Card';

export function BatchDetailScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { batches, farms, sheds, dayLocks } = data;
  const batch = batches.find(b => b.id === batchId);
  const m = useBatchMetrics(batchId);
  const closeBatch = useApp(s => s.closeBatch);
  const pushToast = useApp(s => s.pushToast);
  const users = data.users;
  const canFinance = useCan('viewFinance');
  const canClose = useCan('closeBatch');

  const [closeOpen, setCloseOpen] = useState(false);
  const [cf, setCf] = useState({ date: todayISO(), finalBirds: '', buyer: '', amount: '', remarks: '' });

  if (!batch || !m) return <Page><Header title="Batch" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  const farm = farms.find(f => f.id === batch.farmId);
  const shed = sheds.find(s => s.id === batch.shedId);
  const isLayer = batch.birdType === 'LAYER';
  const isActive = batch.status === 'ACTIVE';

  type Mod = { to: string; icon: typeof Egg; label: string; sub: string; tone: Tone; show: boolean };
  const allModules: Mod[] = [
    { to: `/batches/${batch.id}/eggs`, icon: Egg, label: 'Eggs', sub: isLayer ? `${fmtIN(m.todaysEggs.total)} trays today · ${fmtIN(m.eggStock.balance)} in stock` : 'Not applicable', tone: 'accent', show: isLayer },
    { to: `/batches/${batch.id}/mortality`, icon: Skull, label: 'Mortality', sub: `${fmtIN(m.cumMort)} cum · ${fmtPct(m.mortPct, 2)}`, tone: 'danger', show: true },
    { to: '/feed', icon: Wheat, label: 'Feed', sub: `${fmtIN(m.feed30.tonnes, 2)} t last 30 days`, tone: 'brand', show: true },
    { to: '/sales', icon: Truck, label: 'Sales', sub: isLayer ? `${fmtIN(m.sales.trays)} trays sold` : 'Trader sales', tone: 'accent', show: true },
    { to: `/batches/${batch.id}/daily-report`, icon: FileText, label: 'Daily report', sub: 'Printable summary', tone: 'brand', show: true },
    { to: `/batches/${batch.id}/users`, icon: Users, label: 'Assigned users', sub: 'Roles & permissions', tone: 'neutral', show: true },
    { to: '/finance', icon: Wallet, label: 'Finance', sub: canFinance ? fmtMoney(m.balance) : 'Restricted', tone: canFinance ? 'success' : 'neutral', show: true },
    { to: '/tasks', icon: ClipboardList, label: 'Tasks', sub: 'Daily operations', tone: 'accent', show: true },
  ];
  const modules = allModules.filter(x => x.show);

  function submitClose() {
    if (!batch) return;
    const finalBirds = parseInt(cf.finalBirds, 10);
    if (!cf.date) return pushToast('error', 'Date required');
    if (!finalBirds || finalBirds < 0) return pushToast('error', 'Closing bird count required');
    const r = closeBatch(batch.id, {
      date: cf.date, finalBirds,
      buyer: cf.buyer || undefined,
      amount: parseFloat(cf.amount) || undefined,
      remarks: cf.remarks || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    setCloseOpen(false);
  }

  return (
    <Page withNav>
      <Header title={batch.code} subtitle={`${farm?.name ?? '—'} · ${shed?.name ?? '—'}`} action={<StatusBadge status={batch.status} />} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        {/* hero metrics */}
        <Card padded={false} className="overflow-hidden">
          <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <Badge tone={isLayer ? 'accent' : 'brand'}>{isLayer ? <Egg size={12} /> : <Wheat size={12} />}{batch.birdType}</Badge>
            <span className="font-mono text-[11px] text-muted tnum">{m.age.label} · {m.age.dayLabel}</span>
          </div>
          <StatStrip className="border-t border-line-2">
            <StatCell><Stat label="Live birds" value={fmtIN(m.live)} sub={`of ${fmtIN(batch.initialBirds)}`} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Mortality" value={fmtPct(m.mortPct, 2)} sub={`${fmtIN(m.cumMort)} cum`} tone="danger" size="md" /></StatCell>
            {isLayer
              ? <StatCell><Stat label="Eggs today" value={fmtIN(m.todaysEggs.total)} sub="trays" tone="accent" size="md" /></StatCell>
              : <StatCell><Stat label="Feed 30d" value={`${fmtIN(m.feed30.tonnes, 2)} t`} sub={`${fmtIN(m.feed30.kg)} kg`} tone="success" size="md" /></StatCell>}
          </StatStrip>
        </Card>

        {/* batch info */}
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Info size={14} className="text-brand" />
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Batch details</p>
          </div>
          <Row label="Breed" value={batch.breed} mono={false} />
          <Row label="Hatch date" value={fmtDate(batch.hatchDate)} />
          <Row label="Placement" value={fmtDate(batch.placementDate)} />
          <Row label="Initial birds" value={fmtIN(batch.initialBirds)} />
          {shed && <Row label="Shed" value={shed.name} mono={false} />}
          {canFinance && <Row label="Net balance" value={fmtMoney(m.balance)} success={m.balance >= 0} danger={m.balance < 0} />}
        </Card>

        {/* closing record */}
        {batch.closing && (
          <Card>
            <div className="flex items-center gap-2 mb-1">
              <ArchiveX size={14} className="text-warn" />
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Closed · {fmtDate(batch.closing.date)}</p>
            </div>
            <Row label="Closing birds" value={fmtIN(batch.closing.finalBirds)} />
            {batch.closing.buyer && <Row label="Buyer" value={batch.closing.buyer} mono={false} />}
            {batch.closing.amount != null && <Row label="Sale amount" value={canFinance ? fmtMoney(batch.closing.amount) : '₹•••••'} />}
            {batch.closing.remarks && <Row label="Remarks" value={batch.closing.remarks} mono={false} />}
            <Row label="Closed by" value={users.find(u => u.id === batch.closing!.closedBy)?.name ?? '—'} mono={false} />
          </Card>
        )}

        {/* modules */}
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2 px-0.5">Modules</p>
          <GroupList>
            {modules.map(mod => (
              <ListRow
                key={mod.label}
                onClick={() => nav(mod.to)}
                leading={<IconTile tone={mod.tone} size={38}><mod.icon size={17} /></IconTile>}
                title={mod.label}
                subtitle={mod.sub}
                trailing={<ChevronRight size={17} className="text-muted-2 shrink-0" />}
              />
            ))}
          </GroupList>
        </div>

        {isLayer && isActive && (
          <Button variant="outline" block icon={<Truck size={15} />} onClick={() => nav('/sales')}>
            Sale logs & trader sales
          </Button>
        )}

        {isActive && dayLocks.some(l => l.shedId === batch.shedId && l.date === todayISO()) && (
          <div className="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3">
            <Lock size={16} className="text-warn flex-shrink-0" />
            <p className="text-xs text-warn font-semibold">Today is locked for this shed. Entries resume tomorrow.</p>
          </div>
        )}

        {isActive && <DayLockPanel batchId={batch.id} shedId={batch.shedId} />}

        {/* close / sell batch (§12) */}
        {isActive && canClose && (
          <Button variant="danger" block icon={<Package size={15} />} onClick={() => { setCf({ date: todayISO(), finalBirds: String(m.live), buyer: '', amount: '', remarks: '' }); setCloseOpen(true); }}>
            Close / sell batch
          </Button>
        )}
        {isActive && (
          <p className="text-[12px] text-muted leading-relaxed px-1">
            Closing stops daily entries for this batch, preserves all history, and frees the shed for the next batch.
          </p>
        )}
      </div>

      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title="Close / sell batch" subtitle={batch.code}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setCloseOpen(false)}>Cancel</Button><Button variant="danger" block onClick={submitClose}>Close batch</Button></div>}>
        <div className="space-y-3">
          <p className="text-[12px] text-muted leading-relaxed">Record how the batch ended. History stays intact and the shed becomes idle for the next placement.</p>
          <Field label="Closure date" type="date" value={cf.date} onChange={e => setCf(f => ({ ...f, date: e.target.value }))} />
          <Field label="Closing birds" type="number" inputMode="numeric" value={cf.finalBirds} onChange={e => setCf(f => ({ ...f, finalBirds: e.target.value }))} className="font-mono" />
          <Field label="Buyer (optional)" value={cf.buyer} onChange={e => setCf(f => ({ ...f, buyer: e.target.value }))} placeholder="e.g. Dhanraj Poultry" />
          <Field label="Sale amount (₹, optional)" type="number" inputMode="decimal" value={cf.amount} onChange={e => setCf(f => ({ ...f, amount: e.target.value }))} className="font-mono" />
          <TextArea label="Remarks (optional)" rows={2} value={cf.remarks} onChange={e => setCf(f => ({ ...f, remarks: e.target.value }))} placeholder="Flock sold standing, cleaned shed…" />
        </div>
      </Dialog>
    </Page>
  );
}
