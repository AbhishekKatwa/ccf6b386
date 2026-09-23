import { useMemo } from 'react';
import { BellRing } from 'lucide-react';
import { useCan, useCompanyData } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { AllClear, GroupList } from '@/components/ui/Card';
import { AlertRow } from '@/components/ui/AlertRow';
import { buildFarmAlerts, type AlertTone } from '@/lib/alerts';
import { todayISO } from '@/lib/format';

const TONE_HEAD: Record<AlertTone, { label: string; cls: string }> = {
  danger: { label: 'Needs action now', cls: 'text-danger' },
  warn: { label: 'Watch', cls: 'text-warn' },
  accent: { label: 'For review', cls: 'text-accent-ink' },
  brand: { label: 'Work open', cls: 'text-brand' },
};

/** The full Attention-required list — the dashboard shows a preview of this page. */
export function AlertsScreen() {
  const data = useCompanyData();
  const canReport = useCan('exportReports');
  const canViewFinance = useCan('viewFinance');
  const canVaccinate = useCan('completeVaccination');
  const today = todayISO();

  const alerts = useMemo(() => buildFarmAlerts({
    batches: data.batches, mortality: data.mortality, feed: data.feed, eggs: data.eggs,
    tasks: data.tasks, feedStock: data.feedStock, traders: data.traders, traderTxns: data.traderTxns,
    sheds: data.sheds, vaccinations: data.vaccinations,
    today, canReport, canViewFinance, canViewVaccination: canVaccinate,
  }), [data.batches, data.mortality, data.feed, data.eggs, data.tasks, data.feedStock, data.traders, data.traderTxns, data.sheds, data.vaccinations, today, canReport, canViewFinance, canVaccinate]);

  const groups = useMemo(() => {
    const order: AlertTone[] = ['danger', 'warn', 'accent', 'brand'];
    return order
      .map(tone => ({ tone, items: alerts.filter(a => a.tone === tone) }))
      .filter(g => g.items.length > 0);
  }, [alerts]);

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Overview" title="Alerts"
        subtitle={alerts.length
          ? `${alerts.length} open · derived only from recorded data`
          : 'Nothing needs your attention'} />

      <div className="px-4 sm:px-0 mt-1 space-y-5">
        {alerts.length === 0 ? (
          <AllClear title="No alerts" description="Every live batch is logged today, no vaccination dose is due, godown stock is above the reorder level, no trader is owed money and today's tasks are clear." />
        ) : groups.map(g => (
          <div key={g.tone}>
            <p className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] mb-2 px-0.5 ${TONE_HEAD[g.tone].cls}`}>
              {TONE_HEAD[g.tone].label} · {g.items.length}
            </p>
            <GroupList>
              {g.items.map(a => <AlertRow key={a.id} alert={a} />)}
            </GroupList>
          </div>
        ))}

        {alerts.length > 0 && (
          <p className="text-[11px] text-faint leading-relaxed flex items-center gap-1.5">
            <BellRing size={12} className="shrink-0" />
            Each alert re-evaluates against the records as you log them — resolving the underlying entry clears it here and on the dashboard.
          </p>
        )}
      </div>
    </Page>
  );
}
