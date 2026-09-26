import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Egg, Skull, Wheat, ChevronRight,
  Activity, Layers, PlusCircle, Trash2, Pencil,
  TriangleAlert, Flame, Sun, Moon,
} from 'lucide-react';
import { useApp, useCurrentUser, useCompanyData } from '@/store/app';
import { SyncPill } from '@/components/layout/AppShell';
import { fmtIN, greeting, todayISO, fmtDateShort, fmtDateTime } from '@/lib/format';
import { liveBirdsOn, cumulativeMortality, eggSummary } from '@/lib/calc';
import { useAttention } from '@/hooks/useAttention';
import { AlertRow } from '@/components/ui/AlertRow';
import { OPS_ROLES } from '@/lib/permissions';
import { Page } from '@/components/ui/Header';
import { AttentionButtons } from '@/components/ui/AttentionButtons';
import { Card, SectionTitle, GroupList, ListRow, StatusBadge, EmptyState, AllClear, Avatar, IconTile, Badge } from '@/components/ui/Card';
import { Button, Field } from '@/components/ui/Form';
import { Dialog as Modal } from '@/components/ui/Dialog';
import { AreaTrend, CHART } from '@/components/ui/Charts';
import { ROLE_LABELS, EGGS_PER_TRAY } from '@/types';
import type { Batch } from '@/types';
import { LaborHomeScreen } from '@/screens/LaborScreen';
import { OwnerDashboard } from '@/screens/OwnerDashboard';
import { PageReveal, StaggerContainer, StaggerItem, AnimatedNumber, ScrollReveal } from '@/components/motion';

const VERB: Record<string, string> = {
  CREATE: 'added', UPDATE: 'updated', DELETE: 'removed',
  BACKUP_CREATED: 'exported', RESTORE_STARTED: 'started restoring',
  RESTORE_COMPLETED: 'restored', RESTORE_FAILED: 'failed to restore',
};
const ENTITY: Record<string, string> = {
  Mortality: 'mortality', Feed: 'feed', EggCollection: 'egg collection', SaleEntry: 'sale entry',
  Finance: 'transaction', Task: 'task', Batch: 'batch', Session: 'session',
  Assignment: 'access', Trader: 'trader', Farm: 'farm', FeedStock: 'feed stock', TraderTxn: 'trader txn',
  SaleLog: 'dispatch log', FeedConsumption: 'feed', Backup: 'backup',
  Vaccination: 'vaccination', VaccinationTemplate: 'vaccination template',
  EggSaleBooking: 'egg sale booking',
};

export function HomeScreen() {
  const user = useCurrentUser();
  if (user?.role === 'FARM_LABOR') return <LaborHomeScreen />;
  // The owner's home is the graph-led control centre; every other role keeps the
  // attention-first home built around their own batches.
  if (user?.role === 'OWNER') return <OwnerDashboard />;
  return <ManagerHome />;
}

/* ================================ manager / owner / supervisor home ================================ */

function ManagerHome() {
  const nav = useNavigate();
  const user = useCurrentUser();
  const data = useCompanyData();
  const { batches, mortality, feed, eggs, tasks, users, assignments, audit } = data;

  const today = todayISO();

  const myLive = useMemo(() => {
    // Owner sees the whole company; Master Admin sees it too once they enter a company context.
    const mine = user?.role === 'OWNER' || user?.role === 'MASTER_ADMIN'
      ? batches.map(b => b.id)
      : assignments.filter(a => a.userId === user?.id).map(a => a.batchId);
    return batches.filter(b => b.status === 'ACTIVE' && mine.includes(b.id));
  }, [batches, assignments, user]);

  const hasLayers = myLive.some(b => b.birdType === 'LAYER');

  const totals = useMemo(() => {
    let live = 0, eggsGood = 0, eggsTotal = 0, mortToday = 0;
    for (const b of myLive) {
      live += liveBirdsOn(b, today, mortality);
      const e = eggSummary(b.shedId, eggs, today);
      eggsGood += e.byGrade.GOOD; eggsTotal += e.total;
      mortToday += mortality.filter(m => m.batchId === b.id && m.date === today).reduce((s, m) => s + m.count, 0);
    }
    return { live, eggsGood, eggsTotal, mortToday };
  }, [myLive, mortality, eggs, today]);

  const week = useMemo(() => {
    const labels: string[] = [], eggSeries: number[] = [], mortSeries: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      labels.push(fmtDateShort(date));
      let e = 0, m = 0;
      for (const b of myLive) {
        e += eggs.filter(x => x.shedId === b.shedId && x.date === date).reduce((s, x) => s + x.goodTrays, 0);
        m += mortality.filter(x => x.batchId === b.id && x.date === date).reduce((s, x) => s + x.count, 0);
      }
      eggSeries.push(e); mortSeries.push(m);
    }
    return { labels, eggSeries, mortSeries };
  }, [myLive, eggs, mortality]);

  /**
   * The Alerts badge and the preview below are the shared attention engine's own list —
   * the same rules, the same role gates and the same order the Alerts page shows, so a
   * number on this screen can never disagree with the page behind it.
   */
  const { alerts } = useAttention();

  const tasksOpen = tasks.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length;
  const canSeeAlerts = !!user && OPS_ROLES.includes(user.role);

  const recent = useMemo(() => audit.slice(0, 7), [audit]);
  const firstName = user?.name.split(' ')[0] ?? 'there';
  const trendData = hasLayers ? week.eggSeries : week.mortSeries;
  const trendLabel = hasLayers ? 'Good trays collected' : 'Mortality';

  return (
    <Page withNav>
      <PageReveal>
      {/* greeting */}
      <header className="px-4 sm:px-0 pt-5 pb-3 safe-top flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            {greeting()} · {fmtDateShort(today)}
          </p>
          <h1 className="font-display text-[27px] sm:text-[32px] font-semibold text-ink leading-tight mt-1 tracking-tight truncate">
            {firstName}
          </h1>
          <p className="text-[13px] text-muted mt-1 tnum">
            {user ? ROLE_LABELS[user.role] : ''} · {myLive.length} live {myLive.length === 1 ? 'batch' : 'batches'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <SyncPill compact />
          {user && <Avatar name={user.name} size={38} />}
        </div>
      </header>

      {myLive.length === 0 ? (
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState
            icon={<Layers size={22} />}
            title="No live batches"
            description="Once a batch goes live it will appear here with eggs, feed and mortality at a glance."
            action={<Button onClick={() => nav('/batches')} icon={<ChevronRight size={15} />}>View batches</Button>}
          />
        </div>
      ) : (
        <StaggerContainer className="space-y-5">
          {/* live-now hero */}
          <StaggerItem className="px-4 sm:px-0">
            <div className="rounded-[22px] bg-brand text-white p-5 shadow-card relative overflow-hidden">
              <div className="absolute -top-16 -right-12 w-52 h-52 rounded-full bg-white/8 blur-2xl" aria-hidden />
              <div className="relative">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 flex items-center gap-1.5">
                  <span className="relative flex w-1.5 h-1.5"><span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-70 animate-ping" /><span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-accent" /></span>
                  Live right now
                </p>
                <div className="flex items-end gap-2 mt-2">
                  <AnimatedNumber value={totals.live} format={{ notation: 'standard', useGrouping: true }} suffix="" className="font-display text-[46px] leading-none font-semibold tracking-tight" />
                  <span className="text-white/70 text-[13px] mb-1.5">birds</span>
                </div>
                <div className="grid grid-flow-col auto-cols-fr divide-x divide-white/15 mt-5 -mx-1">
                  {hasLayers && <HeroStat label="Eggs today" value={`${fmtIN(totals.eggsTotal)} tr`} rawValue={totals.eggsTotal} />}
                  <HeroStat label="Mortality today" value={fmtIN(totals.mortToday)} rawValue={totals.mortToday} />
                  <HeroStat label="Batches" value={fmtIN(myLive.length)} rawValue={myLive.length} />
                </div>
              </div>
            </div>
          </StaggerItem>

          {/* alerts & tasks, merged into one pair of count buttons */}
          <StaggerItem className="px-4 sm:px-0">
            <AttentionButtons alerts={canSeeAlerts ? alerts.length : undefined} tasks={tasksOpen} />
          </StaggerItem>

          {/* needs attention */}
          <StaggerItem className="px-4 sm:px-0">
            <SectionTitle right={<span className="font-mono text-[11px] text-muted tnum">{alerts.length ? `${alerts.length} open` : ''}</span>}>
              Needs attention
            </SectionTitle>
            {alerts.length === 0 ? (
              <AllClear title="Everything's logged" description="No pending tasks, alerts or unlogged batches right now." />
            ) : (
              <GroupList>
                {alerts.slice(0, 5).map(a => <AlertRow key={a.id} alert={a} />)}
              </GroupList>
            )}
          </StaggerItem>

          {/* trend + batches + activity */}
          <StaggerItem className="px-4 sm:px-0 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">This week</h3>
                    <p className="font-display text-[15px] font-semibold text-ink mt-0.5">{trendLabel}</p>
                  </div>
                  <Badge tone={hasLayers ? 'accent' : 'danger'}>{hasLayers ? <Egg size={12} /> : <Skull size={12} />} last 7 days</Badge>
                </div>
                <AreaTrend
                  data={trendData}
                  labels={week.labels}
                  color={hasLayers ? CHART.accent : CHART.danger}
                  height={132}
                  format={(v) => fmtIN(v)}
                />
              </Card>

              <div>
                <SectionTitle right={
                  <button onClick={() => nav('/batches')} className="font-mono text-[11px] font-semibold text-brand press">All batches</button>
                }>My batches</SectionTitle>
                <GroupList>
                  {myLive.slice(0, 4).map(b => {
                    const live = liveBirdsOn(b, today, mortality);
                    const e = eggSummary(b.shedId, eggs, today);
                    const cum = cumulativeMortality(b.id, mortality, today);
                    const mortPct = b.initialBirds > 0 ? (cum / b.initialBirds) * 100 : 0;
                    return (
                      <ListRow
                        key={b.id}
                        onClick={() => nav(`/batches/${b.id}`)}
                        leading={<IconTile tone={b.birdType === 'LAYER' ? 'accent' : 'brand'} size={38}>{b.birdType === 'LAYER' ? <Egg size={17} /> : <Wheat size={17} />}</IconTile>}
                        title={<span className="flex items-center gap-2">{b.code} <StatusBadge status={b.status} /></span>}
                        subtitle={`${fmtIN(live)} live · ${fmtIN(mortPct === 0 ? 0 : Number(mortPct.toFixed(2)))}% mort${b.birdType === 'LAYER' ? ` · ${fmtIN(e.total)} trays today` : ''}`}
                        trailing={<ChevronRight size={17} className="text-muted-2 shrink-0" />}
                      />
                    );
                  })}
                </GroupList>
              </div>
            </div>

            <div className="space-y-4">
              <ScrollReveal>
                <Card>
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3 flex items-center gap-1.5">
                    <Activity size={13} /> Recent activity
                  </h3>
                  <ol className="relative">
                    {recent.map((a, i) => {
                      const who = users.find(u => u.id === a.byUserId)?.name.split(' ')[0] ?? 'System';
                      const verb = VERB[a.action] ?? a.action.toLowerCase();
                      const entity = ENTITY[a.entity] ?? a.entity.toLowerCase();
                      const Icon = a.action === 'DELETE' ? Trash2 : a.action === 'UPDATE' ? Pencil : PlusCircle;
                      const tone = a.action === 'DELETE' ? 'text-danger' : 'text-brand';
                      return (
                        <li key={a.id} className="relative flex gap-3 pb-3.5 last:pb-0">
                          {i < recent.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-line-2" aria-hidden />}
                          <span className={`relative z-10 w-[23px] h-[23px] rounded-full bg-card border border-line flex items-center justify-center shrink-0 ${tone}`}>
                            <Icon size={11} />
                          </span>
                          <div className="min-w-0 pt-0.5">
                            <p className="text-[13px] text-ink leading-snug">
                              <span className="font-semibold">{who}</span> <span className="text-muted">{verb}</span> <span className="font-medium">{entity}</span>
                            </p>
                            <p className="font-mono text-[10px] text-muted-2 mt-0.5 tnum">{fmtDateTime(a.at)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              </ScrollReveal>
            </div>
          </StaggerItem>
        </StaggerContainer>
      )}
      </PageReveal>
    </Page>
  );
}

function HeroStat({ label, value, rawValue }: { label: string; value: string; rawValue?: number }) {
  return (
    <div className="px-3 first:pl-1 min-w-0">
      {rawValue !== undefined ? (
        <AnimatedNumber value={rawValue} format={{ notation: 'standard', useGrouping: true }} className="font-display text-[20px] leading-6 font-semibold" />
      ) : (
        <p className="font-display text-[20px] leading-6 font-semibold tnum truncate">{value}</p>
      )}
      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/55 mt-1 truncate">{label}</p>
    </div>
  );
}
