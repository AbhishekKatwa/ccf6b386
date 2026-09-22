import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronRight, Egg, Scale, BarChart3, Users, Wallet, ClipboardList,
  FileText, Skull, Truck, Info,
} from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, StatusBadge, EmptyState, GroupList, ListRow, IconTile, StatStrip, StatCell, Stat, Badge } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { fmtIN, fmtMoney, fmtPct, fmtDate } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import type { Tone } from '@/components/ui/Card';

export function BatchDetailScreen() {
  const { batchId } = useParams();
  const nav = useNavigate();
  const batches = useApp(s => s.batches);
  const farms = useApp(s => s.farms);
  const sheds = useApp(s => s.sheds);
  const batch = batches.find(b => b.id === batchId);
  const m = useBatchMetrics(batchId);
  const canFinance = useCan('viewFinance');

  if (!batch || !m) return <Page><Header title="Batch" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  const farm = farms.find(f => f.id === batch.farmId);
  const shed = sheds.find(s => s.id === batch.shedId);
  const isLayer = batch.birdType === 'LAYER';

  const modules: { to: string; icon: typeof Egg; label: string; sub: string; tone: Tone }[] = [
    { to: `/batches/${batch.id}/eggs`, icon: Egg, label: 'Eggs', sub: isLayer ? `${fmtIN(m.todaysEggs.total)} today` : 'Not applicable', tone: 'accent' },
    { to: `/batches/${batch.id}/mortality`, icon: Skull, label: 'Mortality', sub: `${fmtIN(m.cumMort)} cum · ${fmtPct(m.mortPct, 2)}`, tone: 'danger' },
    { to: `/batches/${batch.id}/fcr`, icon: Scale, label: 'FCR', sub: m.fcr.fcr ? m.fcr.fcr.toFixed(2) : 'Not calculated', tone: 'brand' },
    { to: `/batches/${batch.id}/analytics`, icon: BarChart3, label: 'Analytics', sub: 'Trends & charts', tone: 'brand' },
    { to: `/batches/${batch.id}/daily-report`, icon: FileText, label: 'Daily report', sub: 'Printable summary', tone: 'brand' },
    { to: `/batches/${batch.id}/users`, icon: Users, label: 'Assigned users', sub: 'Roles & permissions', tone: 'neutral' },
    { to: '/finance', icon: Wallet, label: 'Finance', sub: canFinance ? fmtMoney(m.balance) : 'Restricted', tone: canFinance ? 'success' : 'neutral' },
    { to: '/tasks', icon: ClipboardList, label: 'Tasks', sub: 'Daily operations', tone: 'accent' },
  ];
  const visible = modules.filter(mod => !(mod.label === 'Eggs' && !isLayer));

  return (
    <Page withNav>
      <Header title={batch.code} subtitle={`${farm?.name ?? '—'} · ${shed?.name ?? '—'}`} action={<StatusBadge status={batch.status} />} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        {/* hero metrics */}
        <Card padded={false} className="overflow-hidden">
          <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <Badge tone={isLayer ? 'accent' : 'brand'}>{isLayer ? <Egg size={12} /> : <WheatIcon />}{batch.birdType}</Badge>
            <span className="font-mono text-[11px] text-muted tnum">{m.age.label} · {m.age.dayLabel}</span>
          </div>
          <StatStrip className="border-t border-line-2">
            <StatCell><Stat label="Live birds" value={fmtIN(m.live)} sub={`of ${fmtIN(batch.initialBirds)}`} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Mortality" value={fmtPct(m.mortPct, 2)} sub={`${fmtIN(m.cumMort)} cum`} tone="danger" size="md" /></StatCell>
            {isLayer
              ? <StatCell><Stat label="Eggs today" value={fmtIN(m.todaysEggs.total)} sub={`${fmtPct(m.prodPct, 1)} prod`} tone="accent" size="md" /></StatCell>
              : <StatCell><Stat label="FCR" value={m.fcr.fcr ? m.fcr.fcr.toFixed(2) : '—'} sub="latest" tone="success" size="md" /></StatCell>}
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
          {canFinance && <Row label="Net balance" value={fmtMoney(m.balance)} success={m.balance >= 0} danger={m.balance < 0} />}
        </Card>

        {/* modules */}
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2 px-0.5">Modules</p>
          <GroupList>
            {visible.map(mod => (
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

        {isLayer && (
          <Button variant="outline" block icon={<Truck size={15} />} onClick={() => nav(`/batches/${batch.id}/eggs/new-sale`)}>
            Record egg sale
          </Button>
        )}
      </div>
    </Page>
  );
}

function WheatIcon() {
  return <span className="w-3 h-3 rounded-full bg-current opacity-70 inline-block" />;
}
