import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, MapPin, Building2, Plus } from 'lucide-react';
import { useApp, useCompanyData, useCurrentUser, useVisibleSheds } from '@/store/app';
import { ScreenTitle, Page } from '@/components/ui/Header';
import { Card, StatusBadge, EmptyState, GroupList, ListRow, IconTile, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { Button, Field, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { STRUCTURE_ROLES } from '@/lib/permissions';
import { normalizeMobile } from '@/lib/auth';
import { ageLabel, fmtIN, todayISO } from '@/lib/format';
import { eggStockByGrade, liveBirdsOn } from '@/lib/calc';
import { PageReveal, StaggerContainer, StaggerItem, ScrollReveal } from '@/components/motion';

/** The farm picker's stand-in for a shed whose farm does not exist yet. */
const NEW_FARM = '__new__';

/**
 * The operational entry point is the shed, not the farm: COMPANY → SHED → BATCH.
 * Farms group the list so a company with several sites stays scannable. A farm with
 * no shed is still listed for those who lay sheds out, because that empty farm is
 * where the company's first one gets added.
 */
export function FarmsScreen() {
  const nav = useNavigate();
  const user = useCurrentUser();
  const mayBuild = !!user && STRUCTURE_ROLES.includes(user.role);
  const addFarm = useApp(s => s.addFarm);
  const addShed = useApp(s => s.addShed);
  const pushToast = useApp(s => s.pushToast);

  const { farms: allFarms, batches: allBatches, mortality, eggs, saleEntries, eggWastages } = useCompanyData();
  const sheds = useVisibleSheds();
  const shedsById = new Set(sheds.map(s => s.id));
  const batches = allBatches.filter(b => shedsById.has(b.shedId));
  const groups = allFarms
    .map(f => ({ farm: f, farmSheds: sheds.filter(s => s.farmId === f.id) }))
    .filter(g => g.farmSheds.length > 0 || mayBuild);

  const today = todayISO();
  const liveBatches = batches.filter(b => b.status === 'ACTIVE');
  const liveBirds = liveBatches.reduce((s, b) => s + liveBirdsOn(b, today, mortality), 0);
  const capacity = sheds.reduce((s, x) => s + x.capacity, 0);

  const [open, setOpen] = useState(false);
  const [farmId, setFarmId] = useState<string>(NEW_FARM);
  const [farmForm, setFarmForm] = useState({ name: '', location: '', mobile: '' });
  const [shedForm, setShedForm] = useState({ name: '', capacity: '' });
  const needsFarm = farmId === NEW_FARM;

  function openSheet(ontoFarmId?: string) {
    setFarmId(ontoFarmId ?? allFarms[0]?.id ?? NEW_FARM);
    setFarmForm({ name: '', location: '', mobile: '' });
    setShedForm({ name: '', capacity: '' });
    setOpen(true);
  }

  function submit() {
    if (!shedForm.name.trim()) return pushToast('error', 'Shed name is required');
    const cap = parseInt(shedForm.capacity, 10);
    if (!cap || cap <= 0) return pushToast('error', 'Enter a valid bird capacity');

    const mobile = farmForm.mobile.trim() ? normalizeMobile(farmForm.mobile) : '';
    if (farmForm.mobile.trim() && mobile.length !== 10) return pushToast('error', 'Enter a valid 10-digit farm mobile');

    let targetFarmId = farmId;
    let targetFarmName = allFarms.find(f => f.id === farmId)?.name ?? '';
    if (needsFarm) {
      if (!farmForm.name.trim()) return pushToast('error', 'Farm name is required');
      const farm = addFarm({
        name: farmForm.name.trim(), location: farmForm.location.trim(), contactMobile: mobile,
      });
      if (!farm) return pushToast('error', 'Select a company first');
      targetFarmId = farm.id;
      targetFarmName = farm.name;
    }

    if (!addShed({ farmId: targetFarmId, name: shedForm.name.trim(), capacity: cap, status: 'IDLE' })) {
      return pushToast('error', 'Select a company first');
    }
    pushToast('success', `Shed "${shedForm.name.trim()}" added to ${targetFarmName}`);
    setOpen(false);
  }

  return (
    <Page withNav>
      <PageReveal>
      <ScreenTitle eyebrow="Operations" title="Sheds"
        subtitle={`${sheds.length} sheds · ${liveBatches.length} live batches`}
        action={mayBuild
          ? <Button size="sm" icon={<Plus size={14} />} onClick={() => openSheet()}>Add shed</Button>
          : undefined} />

      <StaggerContainer className="px-4 sm:px-0 space-y-4">
        <StaggerItem>
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Sheds" value={fmtIN(sheds.length)} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Live birds" value={fmtIN(liveBirds)} tone="success" size="md" /></StatCell>
            <StatCell><Stat label="Live batches" value={fmtIN(liveBatches.length)} tone="accent" size="md" /></StatCell>
            <StatCell><Stat label="Capacity" value={fmtIN(capacity)} tone="neutral" size="md" /></StatCell>
          </StatStrip>
        </Card>
        </StaggerItem>

        {groups.length === 0 ? (
          <EmptyState icon={<Building2 size={22} />}
            title={allFarms.length ? 'No sheds assigned to you' : 'Nothing set up yet'}
            description={allFarms.length
              ? 'Your supervisor has not mapped you to a shed yet. Sheds appear here once you are assigned to one.'
              : 'A shed is where a flock lives and where all daily work is recorded. The first one also lays out the farm it stands on.'}
            action={!allFarms.length && mayBuild
              ? <Button onClick={() => openSheet()} icon={<Plus size={14} />}>Add shed</Button>
              : undefined} />
        ) : groups.map(({ farm, farmSheds }) => (
          <ScrollReveal key={farm.id}>
          <div className="space-y-2">
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
            {farmSheds.length === 0 ? (
              <Card className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-muted">No shed on this farm yet.</p>
                {mayBuild && (
                  <Button size="sm" variant="outline" icon={<Plus size={13} />} onClick={() => openSheet(farm.id)}>
                    Add shed
                  </Button>
                )}
              </Card>
            ) : (
              <GroupList>
                {farmSheds.map(sh => {
                  const live = batches.find(b => b.shedId === sh.id && b.status === 'ACTIVE');
                  const birds = live ? liveBirdsOn(live, today, mortality) : 0;
                  /** Normal eggs only: small, broken and double are separate pools. */
                  const normalToday = eggs.filter(e => e.shedId === sh.id && e.date === today)
                    .reduce((s, e) => s + e.goodTrays, 0);
                  const normalStock = eggStockByGrade(sh.id, eggs, saleEntries, eggWastages, today).GOOD.balance;
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
            )}
          </div>
          </ScrollReveal>
        ))}
      </StaggerContainer>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add shed"
        subtitle={needsFarm ? 'This shed also sets up the farm it stands on' : 'Pick the farm it stands on'}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Create shed</Button></div>}>
        <div className="space-y-3">
          {allFarms.length > 0 && (
            <SelectField label="Farm" value={farmId} onChange={e => setFarmId(e.target.value)}
              options={[...allFarms.map(f => ({ value: f.id, label: f.name })), { value: NEW_FARM, label: '＋ New farm' }]} />
          )}
          {needsFarm && (
            <>
              <Field label="Farm name" value={farmForm.name} onChange={e => setFarmForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Main site" />
              <Field label="Location" value={farmForm.location} onChange={e => setFarmForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Nashik" hint="Optional — shown beside the farm across the app." />
              <Field label="Contact mobile" type="tel" inputMode="numeric" value={farmForm.mobile}
                onChange={e => setFarmForm(f => ({ ...f, mobile: e.target.value }))} placeholder="Optional" className="font-mono" />
            </>
          )}
          <Field label="Shed name" value={shedForm.name} onChange={e => setShedForm(s => ({ ...s, name: e.target.value }))}
            placeholder="e.g. Gld-1" />
          <Field label="Bird capacity" type="number" inputMode="numeric" value={shedForm.capacity}
            onChange={e => setShedForm(s => ({ ...s, capacity: e.target.value }))} placeholder="e.g. 25000" className="font-mono" />
        </div>
      </Dialog>
      </PageReveal>
    </Page>
  );
}
