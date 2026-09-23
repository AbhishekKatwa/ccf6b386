import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Plus, ChevronRight, Building2, Phone } from 'lucide-react';
import { useApp, useCompanyData, useVisibleSheds } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, StatusBadge, EmptyState, IconTile, GroupList, ListRow, StatStrip, StatCell, Stat } from '@/components/ui/Card';
import { Button, Field } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtIN } from '@/lib/format';

export function FarmDetailScreen() {
  const { farmId } = useParams();
  const nav = useNavigate();
  const { farms, batches } = useCompanyData();
  const addShed = useApp(s => s.addShed);
  const pushToast = useApp(s => s.pushToast);

  const farm = farms.find(f => f.id === farmId);
  const farmSheds = useVisibleSheds().filter(s => s.farmId === farmId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cap, setCap] = useState('');

  if (!farm) return <Page><Header title="Farm" /><div className="px-4 sm:px-0"><EmptyState title="Farm not found" /></div></Page>;

  function submit() {
    const c = parseInt(cap, 10);
    if (!name.trim()) return pushToast('error', 'Shed name is required');
    if (!c || c <= 0) return pushToast('error', 'Enter a valid capacity');
    addShed({ farmId: farm!.id, name: name.trim(), capacity: c, status: 'IDLE' });
    pushToast('success', `Shed "${name}" created`);
    setOpen(false); setName(''); setCap('');
  }

  return (
    <Page withNav>
      <Header title={farm.name} subtitle={farm.location}
        action={<Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Shed</Button>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <Card padded={false} className="overflow-hidden">
          <div className="p-4 flex items-start gap-3">
            <IconTile tone="brand" size={46}><MapPin size={20} /></IconTile>
            <div className="flex-1 min-w-0">
              <p className="font-display text-[17px] font-semibold text-ink truncate">{farm.name}</p>
              <p className="text-[13px] text-muted mt-0.5 truncate">{farm.location}</p>
              <a href={`tel:+91${farm.contactMobile}`} className="inline-flex items-center gap-1.5 font-mono text-[12px] text-brand mt-1.5 tnum press">
                <Phone size={12} /> +91 {farm.contactMobile}
              </a>
            </div>
          </div>
          <StatStrip className="border-t border-line-2">
            <StatCell><Stat label="Sheds" value={fmtIN(farmSheds.length)} tone="brand" size="md" /></StatCell>
            <StatCell><Stat label="Capacity" value={fmtIN(farmSheds.reduce((s, x) => s + x.capacity, 0))} tone="neutral" size="md" /></StatCell>
            <StatCell><Stat label="Live batches" value={fmtIN(batches.filter(b => b.farmId === farm.id && b.status === 'ACTIVE' && farmSheds.some(s => s.id === b.shedId)).length)} tone="accent" size="md" /></StatCell>
          </StatStrip>
        </Card>

        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2 px-0.5">Sheds</p>
          {farmSheds.length === 0 ? (
            <EmptyState icon={<Building2 size={22} />} title="No sheds yet" description="Add a shed to start assigning batches."
              action={<Button onClick={() => setOpen(true)} icon={<Plus size={14} />}>Add shed</Button>} />
          ) : (
            <GroupList>
              {farmSheds.map(sh => {
                const live = batches.find(b => b.shedId === sh.id && b.status === 'ACTIVE');
                return (
                  <ListRow
                    key={sh.id}
                    onClick={() => nav(`/sheds/${sh.id}`)}
                    leading={<IconTile tone={live ? 'success' : 'neutral'} size={40}><Building2 size={18} /></IconTile>}
                    title={<span className="flex items-center gap-2">{sh.name} <StatusBadge status={sh.status} /></span>}
                    subtitle={`Cap ${fmtIN(sh.capacity)} · ${live ? `Live: ${live.code}` : 'No live batch'}`}
                    trailing={<ChevronRight size={17} className="text-muted-2 shrink-0" />}
                  />
                );
              })}
            </GroupList>
          )}
        </div>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Add shed" subtitle={farm.name}
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setOpen(false)}>Cancel</Button><Button block onClick={submit}>Create shed</Button></div>}>
        <div className="space-y-3">
          <Field label="Shed name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gld-3" />
          <Field label="Bird capacity" type="number" inputMode="numeric" value={cap} onChange={e => setCap(e.target.value)} placeholder="e.g. 25000" className="font-mono" />
        </div>
      </Dialog>
    </Page>
  );
}
