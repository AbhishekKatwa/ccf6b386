import { useMemo } from 'react';
import { BellRing } from 'lucide-react';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { AllClear, GroupList } from '@/components/ui/Card';
import { AlertRow } from '@/components/ui/AlertRow';
import { SEVERITY_LABEL, SEVERITY_ORDER, type AlertSeverity } from '@/lib/alerts';
import { useAttention } from '@/hooks/useAttention';
import { PageReveal, StaggerContainer, StaggerItem } from '@/components/motion';

const HEAD: Record<AlertSeverity, { cls: string; note: string }> = {
  critical: { cls: 'text-danger', note: 'stops something on the farm right now' },
  warning: { cls: 'text-warn', note: 'will stop it if it waits' },
  info: { cls: 'text-muted-2', note: 'worth handling today' },
};

/**
 * Everything the farm's own rules say is open. Each line is one standing rule re-read
 * against the records — the godown's reorder level, a medicine's low-stock threshold, the
 * 5% mortality line, the planner's shortage, the ledgers' balances, the device's sync queue —
 * and each one leads to the screen that owns the record behind it.
 */
export function AlertsScreen() {
  const { alerts, counts } = useAttention();

  const groups = useMemo(
    () => SEVERITY_ORDER
      .map(severity => ({ severity, items: alerts.filter(a => a.severity === severity) }))
      .filter(g => g.items.length > 0),
    [alerts],
  );

  return (
    <Page withNav>
      <PageReveal>
      <ScreenTitle eyebrow="Overview" title="Needs attention"
        subtitle={alerts.length
          ? `${alerts.length} open · ${SEVERITY_ORDER.filter(s => counts[s]).map(s => `${counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(' · ')}`
          : 'Nothing needs your attention'} />

      <div className="px-4 sm:px-0 mt-1 space-y-5">
        {alerts.length === 0 ? (
          <AllClear title="No alerts"
            description="Every live batch is logged today, no vaccination dose is due, the godown and the medicine shelf are above their reorder levels, no booking falls short and nothing is owed or waiting to sync." />
        ) : (
          <StaggerContainer className="space-y-5">
            {groups.map(g => (
              <StaggerItem key={g.severity}>
                <div>
                  <p className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] mb-1 px-0.5 ${HEAD[g.severity].cls}`}>
                    {SEVERITY_LABEL[g.severity]} · {g.items.length}
                  </p>
                  <p className="text-[11px] text-faint mb-2 px-0.5">{HEAD[g.severity].note}</p>
                  <GroupList>
                    {g.items.map(a => <AlertRow key={a.id} alert={a} />)}
                  </GroupList>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}

        {alerts.length > 0 && (
          <p className="text-[11px] text-faint leading-relaxed flex items-center gap-1.5">
            <BellRing size={12} className="shrink-0" />
            Each line re-reads the rule it comes from, so resolving the record clears the alert here and on the dashboard. Only the modules your role opens are listed.
          </p>
        )}
      </div>
      </PageReveal>
    </Page>
  );
}
