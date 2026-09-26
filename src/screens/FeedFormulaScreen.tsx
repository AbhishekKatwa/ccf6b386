import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical, History, Plus, ChevronRight } from 'lucide-react';
import { useCan, useCompanyData, useCurrentUser } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Badge, EmptyState, GroupList, IconTile, ListRow } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { PageReveal, StaggerContainer, StaggerItem } from '@/components/motion';
import { currentFormula, formulaCostPerTonne, formulaTotalKg } from '@/lib/calc';
import { canViewFormulas } from '@/lib/permissions';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { fmtIN, fmtMoney } from '@/lib/format';

/** Shed → the formula version currently in force. Editing is scoped per shed in the store. */
export function FeedFormulaScreen() {
  const nav = useNavigate();
  const { sheds, batches, feedFormulas } = useCompanyData();
  const user = useCurrentUser();
  const canManage = useCan('manageFormulas');
  const canFinance = useCan('viewFinance');
  const { priceOf } = useGodownPrices();

  const perShed = useMemo(() => sheds.map(s => {
    const active = currentFormula(s.id, feedFormulas);
    return {
      shed: s, active, live: batches.find(b => b.shedId === s.id && b.status === 'ACTIVE'),
      versions: active ? feedFormulas.filter(f => f.familyId === active.familyId).length : 0,
    };
  }), [sheds, batches, feedFormulas]);

  const missing = perShed.filter(p => !p.active).map(p => p.shed.id);
  const newUrl = `/feed/formulas/new?shedId=${missing[0] ?? sheds[0]?.id ?? ''}`;

  if (!canViewFormulas(user?.role)) {
    return (
      <Page withNav>
        <Header title="Feed Formulas" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState icon={<FlaskConical size={22} />} title="Not available for your role"
            description="Feed formulas are managed by the Owner and supervisors. Record today’s feed in tonnes — the mix is deducted for you." />
        </div>
      </Page>
    );
  }

  return (
    <Page withNav>
      <PageReveal>
      <Header title="Feed Formulas" subtitle="Per shed · the mix, in KG per ingredient"
        action={canManage && sheds.length > 0
          ? <Button size="sm" icon={<Plus size={14} />} onClick={() => nav(newUrl)}>New</Button>
          : undefined} />

      <StaggerContainer className="px-4 sm:px-0 mt-3 space-y-4 pb-6">
        <StaggerItem>
        <div className="rounded-[22px] bg-brand-soft p-4">
          <p className="text-sm text-brand-ink leading-relaxed">
            <strong>Auto deduction.</strong> Daily shed consumption is entered in tonnes. Each entry deducts
            {' '}<code className="font-mono">tonnes × kg/tonne</code> of every ingredient from the central godown, using the formula
            version that was in force on that date.
          </p>
        </div>
        </StaggerItem>

        <StaggerItem>
        {sheds.length === 0 ? (
          <EmptyState icon={<FlaskConical size={22} />} title="No sheds yet" description="Create a shed first, then define its feed formula." />
        ) : (
          <GroupList>
            {perShed.map(({ shed, active, live, versions }) => (
              <ListRow key={shed.id} onClick={() => nav(active ? `/feed/formulas/${active.id}` : newUrl)}
                leading={<IconTile tone={active ? 'brand' : 'neutral'} size={40}><FlaskConical size={18} /></IconTile>}
                title={shed.name}
                subtitle={active
                  ? <span className="font-mono">V{active.version} · {active.items.length} ingredients · {fmtIN(formulaTotalKg(active.items), 2)} kg</span>
                  : <span className="font-mono">{live ? `${live.code} — no active formula` : 'Idle shed'}</span>}
                trailing={active ? (
                  <div className="flex items-center gap-2 shrink-0">
                    {versions > 1 && (
                      <button onClick={e => { e.stopPropagation(); nav(`/feed/formulas/${active.id}/history`); }} aria-label="Formula history"
                        className="w-8 h-8 rounded-[10px] bg-sunk text-muted flex items-center justify-center press hover:text-brand"><History size={14} /></button>
                    )}
                    <div className="text-right">
                      <p className="font-display text-[15px] font-semibold text-ink tnum">{canFinance ? fmtMoney(formulaCostPerTonne(active, priceOf)) : '₹••••'}</p>
                      <p className="font-mono text-[9px] uppercase tracking-wider text-faint mt-0.5">/tonne{versions > 1 ? ` · V${versions}` : ''}</p>
                    </div>
                    <ChevronRight size={15} className="text-muted-2" />
                  </div>
                ) : <Badge tone="warn">Missing</Badge>} />
            ))}
          </GroupList>
        )}
        </StaggerItem>

        {!canManage && (
          <StaggerItem>
          <p className="text-[12px] text-muted px-1 leading-relaxed">
            Read-only view — formulas are created and revised by the Owner and the supervisors assigned to each shed.
          </p>
          </StaggerItem>
        )}

        <StaggerItem>
        <Button block variant="outline" icon={<FlaskConical size={15} />} onClick={() => nav('/feed')}>View godown stock</Button>
        </StaggerItem>
      </StaggerContainer>
      </PageReveal>
    </Page>
  );
}
