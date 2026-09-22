import { useParams, useNavigate } from 'react-router-dom';
import { Building2, ChevronRight } from 'lucide-react';
import { useApp } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, Row, StatusBadge, EmptyState, IconTile } from '@/components/ui/Card';
import { fmtIN, fmtPct } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';

export function ShedDetailScreen() {
  const { shedId } = useParams();
  const nav = useNavigate();
  const sheds = useApp(s => s.sheds);
  const farms = useApp(s => s.farms);
  const batches = useApp(s => s.batches);
  const shed = sheds.find(x => x.id === shedId);
  const farm = farms.find(f => f.id === shed?.farmId);
  const live = batches.find(b => b.shedId === shedId && b.status === 'LIVE');
  const m = useBatchMetrics(live?.id);

  if (!shed) return <Page><Header title="Shed" /><div className="px-4 sm:px-0"><EmptyState title="Shed not found" /></div></Page>;

  return (
    <Page withNav>
      <Header title={shed.name} subtitle={farm?.name} />
      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <IconTile tone="brand" size={42}><Building2 size={19} /></IconTile>
            <div className="flex-1 min-w-0">
              <p className="font-display text-[16px] font-semibold text-ink">Shed info</p>
              <p className="font-mono text-[11px] text-muted mt-0.5">{farm?.name ?? '—'}</p>
            </div>
            <StatusBadge status={shed.status} />
          </div>
          <Row label="Capacity" value={`${fmtIN(shed.capacity)} birds`} />
          <Row label="Live batch" value={live?.code ?? 'None'} mono={false} />
        </Card>

        {live && m && (
          <>
            <Card>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-1">Current batch · {live.code}</p>
              <Row label="Bird type" value={live.birdType} mono={false} />
              <Row label="Breed" value={live.breed} mono={false} />
              <Row label="Age" value={`${m.age.label} · ${m.age.dayLabel}`} />
              <Row label="Live birds" value={fmtIN(m.live)} success />
              <Row label="Cumulative mortality" value={`${fmtIN(m.cumMort)} (${fmtPct(m.mortPct, 2)})`} danger />
              {live.birdType === 'LAYER' && (
                <>
                  <Row label="Today's eggs" value={fmtIN(m.todaysEggs.total)} />
                  <Row label="Production" value={fmtPct(m.prodPct, 1)} />
                </>
              )}
              <Row label="Feed (30d)" value={`${fmtIN(m.feed30.bags)} bags · ${fmtIN(m.feed30.kg)} kg`} />
            </Card>
            <button onClick={() => nav(`/batches/${live.id}`)}
              className="w-full bg-brand text-white rounded-[14px] py-3.5 font-display text-[15px] font-semibold flex items-center justify-center gap-2 press hover:bg-brand-2 shadow-card">
              Open batch detail <ChevronRight size={16} />
            </button>
          </>
        )}

        {!live && (
          <EmptyState icon={<Building2 size={22} />} title="No live batch" description="This shed is currently idle. Assign a batch to begin tracking." />
        )}
      </div>
    </Page>
  );
}
