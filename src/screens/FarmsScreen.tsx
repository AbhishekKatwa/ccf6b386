import { useNavigate } from 'react-router-dom';
import { ChevronRight, MapPin, Building2 } from 'lucide-react';
import { useCompanyData, useVisibleSheds } from '@/store/app';
import { ScreenTitle, Page } from '@/components/ui/Header';
import { Card, StatusBadge, EmptyState, GroupList, ListRow, IconTile, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { ageLabel, fmtIN, todayISO } from '@/lib/format';
import { eggStockByGrade, liveBirdsOn } from '@/lib/calc';

/**
 * The operational entry point is the shed, not the farm: COMPANY → SHED → BATCH.
 * Farms group the list so a company with several sites stays scannable, and each
 * heading opens that farm's own screen where sheds are created.
 */
export function FarmsScreen() {
  const nav = useNavigate();
  const { farms: allFarms, batches: allBatches, mortality, eggs, saleEntries } = useCompanyData();
  const sheds = useVisibleSheds();
  const shedsById = new Set(sheds.map(s => s.id));
  const batches = allBatches.filter(b => shedsById.has(b.shedId));
  const farms = allFarms
    .map(f => ({ farm: f, farmSheds: sheds.filter(s => s.farmId === f.id) }))
    .filter(g => g.farmSheds.length > 0);

  const today = todayISO();
  const liveBatches = batches.filter(b => b.status === 'ACTIVE');
  const liveBirds = liveBatches.reduce((s, b) => s + liveBirdsOn(b, today, mortality), 0);
  const capacity = sheds.reduce((s, x) => s + x.capacity, 0);

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Operations" title="Sheds" subtitle={`${sheds.length} sheds · ${liveBatches.length} live batches`} />

      <div className="px-4 sm:px-0 space-y-4">
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Sheds" value={fmtIN(sheds.length)} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Live birds" value={fmtIN(liveBirds)} tone="success" size="md" /></StatCell>
            <StatCell><Stat label="Live batches" value={fmtIN(liveBatches.length)} tone="accent" size="md" /></StatCell>
            <StatCell><Stat label="Capacity" value={fmtIN(capacity)} tone="neutral" size="md" /></StatCell>
          </StatStrip>
        </Card>

        {farms.length === 0 ? (
          <EmptyState icon={<Building2 size={22} />}
            title={allFarms.length ? 'No sheds assigned to you' : 'No sheds yet'}
            description={allFarms.length
              ? 'Your supervisor has not mapped you to a shed yet. Sheds appear here once you are assigned to one.'
              : 'Farms and their sheds appear here. A shed carries the live batch and all of its daily work.'} />
        ) : (
          farms.map(({ farm, farmSheds }) => (
            <div key={farm.id} className="space-y-2">
              <button onClick={() => nav(`/farms/${farm.id}`)}
                className="w-full flex items-center gap-2 px-0.5 text-left press group rounded-lg focus-visible:ring-2 ring-focus">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink truncate">{farm.name}</p>
                  <p className="text-[11.5px] text-muted truncate inline-flex items-center gap-1.5"><MapPin size={10} className="text-muted-2 shrink-0" />{farm.location}</p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-2">
                  {farmSheds.length} {farmSheds.length === 1 ? 'shed' : 'sheds'}
                  <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
              <GroupList>
                {farmSheds.map(sh => {
                  const live = batches.find(b => b.shedId === sh.id && b.status === 'ACTIVE');
                  const birds = live ? liveBirdsOn(live, today, mortality) : 0;
                  /** Normal eggs only: small, broken and double are separate pools. */
                  const normalToday = eggs.filter(e => e.shedId === sh.id && e.date === today)
                    .reduce((s, e) => s + e.goodTrays, 0);
                  const normalStock = eggStockByGrade(sh.id, eggs, saleEntries, today).GOOD.balance;
                  return (
                    <ListRow
                      key={sh.id}
                      onClick={() => nav(live ? `/batches/${live.id}` : `/sheds/${sh.id}`)}
                      leading={<IconTile tone={live ? 'success' : 'neutral'} size={40}><Building2 size={18} /></IconTile>}
                      title={<span className="flex items-center gap-2">{sh.name} <StatusBadge status={live ? 'ACTIVE' : sh.status} /></span>}
                      subtitle={live ? (
                        <span className="tnum">
                          {live.code} · {fmtIN(birds)} birds · {ageLabel(live.placementDate, today).dayLabel}
                          <span className="block text-muted-2">
                            {fmtIN(normalToday)} normal trays today · {fmtIN(normalStock)} in stock
                          </span>
                        </span>
                      ) : <span className="tnum">No live batch · cap {fmtIN(sh.capacity)}</span>}
                      trailing={<ChevronRight size={17} className="text-muted-2 shrink-0" />}
                    />
                  );
                })}
              </GroupList>
            </div>
          ))
        )}
      </div>
    </Page>
  );
}
