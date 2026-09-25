import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ChevronRight, Egg, Wheat } from 'lucide-react';
import { useCompanyData, useCurrentUser } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, StatusBadge, EmptyState, IconTile } from '@/components/ui/Card';
import { Button, SearchField, SegmentedTabs } from '@/components/ui/Form';
import { fmtIN, fmtPct, todayISO } from '@/lib/format';
import { cumulativeMortality, liveBirdsOn } from '@/lib/calc';
import { PageReveal, StaggerContainer, StaggerItem } from '@/components/motion';

function BatchRow({ batchId }: { batchId: string }) {
  const nav = useNavigate();
  const { batches, farms, mortality } = useCompanyData();
  const batch = batches.find(b => b.id === batchId);
  if (!batch) return null;
  const farm = farms.find(f => f.id === batch.farmId);
  const live = liveBirdsOn(batch, todayISO(), mortality);
  const cum = cumulativeMortality(batch.id, mortality);
  const pct = batch.initialBirds > 0 ? (cum / batch.initialBirds) * 100 : 0;
  const isLayer = batch.birdType === 'LAYER';

  return (
    <button onClick={() => nav(`/batches/${batch.id}`)} className="w-full text-left press">
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 flex items-start gap-3">
            <IconTile tone={isLayer ? 'accent' : 'brand'} size={40}>{isLayer ? <Egg size={18} /> : <Wheat size={18} />}</IconTile>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-display text-[16px] font-semibold text-ink">{batch.code}</p>
                <StatusBadge status={batch.status} />
              </div>
              <p className="text-[12px] text-muted mt-1 truncate">{farm?.name} · {batch.breed}</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-muted-2 shrink-0 mt-1" />
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3.5">
          {[
            ['Initial', fmtIN(batch.initialBirds)],
            ['Live', fmtIN(live)],
            ['Mortality', fmtPct(pct, 2)],
            ['Placed', batch.placementDate.slice(8) + '/' + batch.placementDate.slice(5, 7)],
          ].map(([l, v]) => (
            <div key={l} className="bg-sunk rounded-[12px] py-2 px-1 text-center">
              <p className="font-mono text-[12px] font-semibold text-ink tnum">{v}</p>
              <p className="font-mono text-[9px] uppercase tracking-wide text-muted mt-0.5">{l}</p>
            </div>
          ))}
        </div>
      </Card>
    </button>
  );
}

export function BatchListScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { batches, assignments } = useCompanyData();
  const user = useCurrentUser();
  const [filter, setFilter] = useState<'all' | 'live' | 'closed' | 'assigned'>(
    (params.get('filter') as 'all' | 'live' | 'closed' | 'assigned' | null) ?? 'live');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    let l = batches;
    if (filter === 'live') l = l.filter(b => b.status === 'ACTIVE');
    if (filter === 'closed') l = l.filter(b => b.status === 'CLOSED');
    if (filter === 'assigned' && user) {
      const ids = assignments.filter(a => a.userId === user.id).map(a => a.batchId);
      l = l.filter(b => ids.includes(b.id));
    }
    if (q.trim()) l = l.filter(b => b.code.toLowerCase().includes(q.toLowerCase()) || b.breed.toLowerCase().includes(q.toLowerCase()));
    return l.sort((a, b) => (a.status === 'ACTIVE' ? -1 : 1) - (b.status === 'ACTIVE' ? -1 : 1));
  }, [batches, filter, q, assignments, user]);

  return (
    <Page withNav>
      <PageReveal>
      <Header title="Batches" subtitle={`${list.length} shown`}
        action={<Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => nav('/farms')}>New</Button>} />

      <div className="px-4 sm:px-0 mt-2 space-y-3">
        <SearchField placeholder="Search by code or breed" value={q} onChange={setQ} />
        <SegmentedTabs value={filter} onChange={setFilter} scroll options={[
          { value: 'all', label: 'All' },
          { value: 'live', label: 'Live' },
          { value: 'closed', label: 'Closed' },
          { value: 'assigned', label: 'Assigned to me' },
        ]} />

        {list.length === 0 ? (
          <EmptyState title="No batches found" description="Try a different filter, or create a new batch from a farm." />
        ) : (
          <StaggerContainer className="space-y-2.5">
            {list.map(b => <StaggerItem key={b.id}><BatchRow batchId={b.id} /></StaggerItem>)}
          </StaggerContainer>
        )}
      </div>
      </PageReveal>
    </Page>
  );
}
