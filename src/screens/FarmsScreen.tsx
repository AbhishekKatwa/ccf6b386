import { useNavigate } from 'react-router-dom';
import { Warehouse, ChevronRight, MapPin } from 'lucide-react';
import { useCompanyData } from '@/store/app';
import { ScreenTitle, Page } from '@/components/ui/Header';
import { Card, EmptyState, GroupList, ListRow, IconTile, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { fmtIN, todayISO } from '@/lib/format';
import { liveBirdsOn } from '@/lib/calc';

export function FarmsScreen() {
  const nav = useNavigate();
  const { farms, sheds, batches, mortality } = useCompanyData();

  const today = todayISO();
  const liveBatches = batches.filter(b => b.status === 'ACTIVE');
  const liveBirds = liveBatches.reduce((s, b) => s + liveBirdsOn(b, today, mortality), 0);
  const capacity = sheds.reduce((s, x) => s + x.capacity, 0);

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Operations" title="Farms" subtitle={`${farms.length} farms · ${sheds.length} sheds`} />

      <div className="px-4 sm:px-0 space-y-4">
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Farms" value={fmtIN(farms.length)} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Live birds" value={fmtIN(liveBirds)} tone="success" size="md" /></StatCell>
            <StatCell><Stat label="Live batches" value={fmtIN(liveBatches.length)} tone="accent" size="md" /></StatCell>
            <StatCell><Stat label="Capacity" value={fmtIN(capacity)} tone="neutral" size="md" /></StatCell>
          </StatStrip>
        </Card>

        {farms.length === 0 ? (
          <EmptyState icon={<Warehouse size={22} />} title="No farms yet" description="Farms you add will appear here with their sheds and live batches." />
        ) : (
          <GroupList>
            {farms.map(f => {
              const fSheds = sheds.filter(s => s.farmId === f.id);
              const fLive = batches.filter(b => b.farmId === f.id && b.status === 'ACTIVE');
              return (
                <ListRow
                  key={f.id}
                  onClick={() => nav(`/farms/${f.id}`)}
                  leading={<IconTile tone="brand" size={42}><Warehouse size={19} /></IconTile>}
                  title={f.name}
                  subtitle={<span className="inline-flex items-center gap-1.5"><MapPin size={11} className="text-muted-2" />{f.location} · {fSheds.length} sheds · {fLive.length} live</span>}
                  trailing={<ChevronRight size={17} className="text-muted-2 shrink-0" />}
                />
              );
            })}
          </GroupList>
        )}
      </div>
    </Page>
  );
}
