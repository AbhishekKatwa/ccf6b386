import { useNavigate, useParams } from 'react-router-dom';
import { History, FlaskConical } from 'lucide-react';
import { useCompanyData } from '@/store/app';
import type { FeedFormula } from '@/types';
import { Header, Page } from '@/components/ui/Header';
import { Badge, Card, EmptyState, IconTile, ListRow, Stat, StatCell, StatStrip } from '@/components/ui/Card';
import { GroupList } from '@/components/ui/Card';
import { formulaTotalKg, formulaUsage } from '@/lib/calc';
import { fmtDate, fmtIN } from '@/lib/format';

/** Every version of one formula family, newest first — the audit trail behind the mix. */
export function FormulaHistoryScreen() {
  const { formulaId } = useParams();
  const nav = useNavigate();
  const { feedFormulas, sheds, feed, users } = useCompanyData();

  const current = feedFormulas.find(f => f.id === formulaId);
  if (!current) {
    return (
      <Page>
        <Header title="Formula history" backTo="/feed/formulas" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState icon={<History size={22} />} title="Formula not found" description="It belongs to another company or was removed." />
        </div>
      </Page>
    );
  }

  const familyId = current.familyId;
  const versions = feedFormulas
    .filter(f => f.familyId === familyId)
    .sort((a, b) => b.version - a.version || b.effectiveFrom.localeCompare(a.effectiveFrom));
  const shed = sheds.find(s => s.id === current.shedId);
  const usage = (v: FeedFormula) => formulaUsage(v, feed, feedFormulas).length;

  return (
    <Page>
      <Header title="Formula history" subtitle={`${current.name} · ${shed?.name ?? 'Shed'}`}
        backTo={`/feed/formulas/${current.id}`} />

      <div className="px-4 sm:px-0 mt-3 space-y-4 pb-6">
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Versions" value={String(versions.length)} tone="brand" size="sm" /></StatCell>
            <StatCell><Stat label="Active" value={versions.find(v => v.status === 'ACTIVE') ? `V${versions.find(v => v.status === 'ACTIVE')!.version}` : 'None'} tone="success" size="sm" /></StatCell>
            <StatCell><Stat label="Consumption" value={String(versions.reduce((s, v) => s + usage(v), 0))} sub="records" tone="neutral" size="sm" /></StatCell>
          </StatStrip>
        </Card>

        <div className="rounded-[22px] bg-brand-soft p-4">
          <p className="text-sm text-brand-ink leading-relaxed">
            <strong>History is immutable.</strong> A version that already drove feed consumption is never edited in place — saving a change
            appends a new version, and each consumption record keeps the version it was fed with.
          </p>
        </div>

        <GroupList>
          {versions.map(v => {
            const used = usage(v);
            const changed = `${v.items.length} ingredients · ${fmtIN(formulaTotalKg(v.items), 2)} kg`;
            return (
              <ListRow key={v.id} onClick={() => nav(`/feed/formulas/${v.id}`)}
                leading={<IconTile tone={v.status === 'ACTIVE' ? 'brand' : 'neutral'} size={40}><FlaskConical size={18} /></IconTile>}
                title={<span className="flex items-center gap-2">V{v.version}{v.status === 'ACTIVE' && <Badge tone="success">Active</Badge>}{v.id === current.id && <Badge tone="brand">Viewing</Badge>}</span>}
                subtitle={<span>Effective {fmtDate(v.effectiveFrom)} · {changed}</span>}
                trailing={
                  <div className="text-right shrink-0">
                    <p className="font-mono text-[11px] text-ink tnum">{used} fed</p>
                    <p className="text-[10px] text-faint mt-0.5">{users.find(u => u.id === v.createdBy)?.name.split(' ')[0] ?? '—'} · {fmtDate(v.createdAt.slice(0, 10))}</p>
                  </div>
                } />
            );
          })}
        </GroupList>

        {versions.some(v => v.changeReason) && (
          <Card>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2">Why the mix changed</p>
            <div className="space-y-2">
              {versions.filter(v => v.changeReason).map(v => (
                <div key={v.id} className="flex items-start gap-2 text-[12px]">
                  <span className="font-mono text-muted shrink-0">V{v.version}</span>
                  <span className="text-ink leading-relaxed">{v.changeReason}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}
