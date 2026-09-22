import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Egg, Skull, Wheat, AlertTriangle, ClipboardList, Handshake, ChevronRight,
  Activity, Layers, Lock, PlusCircle, CheckCircle2, Trash2, Pencil, Package,
  TriangleAlert, Flame, Sun, Moon,
} from 'lucide-react';
import { useApp, useCurrentUser, useCan, useCompanyData } from '@/store/app';
import { SyncPill } from '@/components/layout/AppShell';
import { fmtIN, fmtMoney, fmtPct, greeting, todayISO, fmtDateShort, fmtDateTime } from '@/lib/format';
import { liveBirdsOn, cumulativeMortality, eggSummary } from '@/lib/calc';
import { Page } from '@/components/ui/Header';
import { Card, SectionTitle, GroupList, ListRow, StatusBadge, EmptyState, AllClear, Avatar, IconTile, Badge } from '@/components/ui/Card';
import { Button, Field } from '@/components/ui/Form';
import { Dialog as Modal } from '@/components/ui/Dialog';
import { AreaTrend, CHART } from '@/components/ui/Charts';
import { ROLE_LABELS, EGGS_PER_TRAY } from '@/types';
import type { Batch } from '@/types';
import { LaborHomeScreen } from '@/screens/LaborScreen';

type Attention = {
  id: string; icon: ReactNode; tone: 'danger' | 'warn' | 'accent' | 'brand';
  title: string; detail: string; actionLabel: string; to: string;
};

const VERB: Record<string, string> = { CREATE: 'added', UPDATE: 'updated', DELETE: 'removed', LOCK: 'locked', UNLOCK: 'unlocked' };
const ENTITY: Record<string, string> = {
  Mortality: 'mortality', Feed: 'feed', EggCollection: 'egg collection', EggSale: 'egg sale',
  Finance: 'transaction', Task: 'task', Batch: 'batch', DayLock: 'a day', Session: 'session',
  Assignment: 'access', Trader: 'trader', Farm: 'farm', FeedStock: 'feed stock', TraderTxn: 'trader txn',
  SaleLog: 'sale log', Disposal: 'disposal', FeedConsumption: 'feed',
};

export function HomeScreen() {
  const user = useCurrentUser();
  if (user?.role === 'FARM_LABOR') return <LaborHomeScreen />;
  return <ManagerHome />;
}

/* ================================ manager / owner / supervisor home ================================ */

function ManagerHome() {
  const nav = useNavigate();
  const user = useCurrentUser();
  const data = useCompanyData();
  const { batches, mortality, feed, eggs, traders, tasks, users, assignments, audit } = data;
  const canViewFinance = useCan('viewFinance');

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

  const pendingTasks = tasks.filter(t => t.date === today && (t.status === 'PENDING' || t.status === 'IN_PROGRESS'));

  const attention = useMemo<Attention[]>(() => {
    const items: Attention[] = [];
    for (const b of myLive) {
      const loggedMort = mortality.some(m => m.batchId === b.id && m.date === today);
      const loggedFeed = feed.some(f => f.batchId === b.id && f.date === today);
      const loggedEgg = b.birdType !== 'LAYER' || eggs.some(e => e.shedId === b.shedId && e.date === today);
      if (!loggedMort || !loggedFeed || !loggedEgg) {
        const missing = [!loggedMort && 'mortality', !loggedFeed && 'feed', !loggedEgg && 'eggs'].filter(Boolean).join(', ');
        items.push({
          id: `log-${b.id}`, icon: <Wheat size={16} />, tone: 'accent',
          title: `${b.code} — not logged today`, detail: `Missing ${missing}`,
          actionLabel: 'Log', to: `/batches/${b.id}/daily-report`,
        });
      }
      const cum = cumulativeMortality(b.id, mortality, today);
      const pct = b.initialBirds > 0 ? (cum / b.initialBirds) * 100 : 0;
      if (pct > 5) {
        items.push({
          id: `mort-${b.id}`, icon: <AlertTriangle size={16} />, tone: 'danger',
          title: `Elevated mortality — ${b.code}`, detail: `Cumulative ${fmtPct(pct, 2)} of placed birds`,
          actionLabel: 'Review', to: `/batches/${b.id}/mortality`,
        });
      }
    }
    if (pendingTasks.length) {
      items.push({
        id: 'tasks', icon: <ClipboardList size={16} />, tone: 'brand',
        title: `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} pending today`,
        detail: 'Daily work awaiting action', actionLabel: 'Open', to: '/tasks',
      });
    }
    if (canViewFinance) {
      const owed = traders.filter(t => t.active && t.outstandingAmount > 0);
      const sum = owed.reduce((s, t) => s + t.outstandingAmount, 0);
      if (owed.length) {
        items.push({
          id: 'traders', icon: <Handshake size={16} />, tone: 'warn',
          title: `${fmtMoney(sum)} outstanding`, detail: `Across ${owed.length} trader${owed.length === 1 ? '' : 's'}`,
          actionLabel: 'Collect', to: '/traders',
        });
      }
    }
    return items;
  }, [myLive, mortality, feed, eggs, today, pendingTasks.length, canViewFinance, traders]);

  const recent = useMemo(() => audit.slice(0, 7), [audit]);
  const firstName = user?.name.split(' ')[0] ?? 'there';
  const trendData = hasLayers ? week.eggSeries : week.mortSeries;
  const trendLabel = hasLayers ? 'Good trays collected' : 'Mortality';

  const toneMap: Record<Attention['tone'], string> = {
    danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn',
    accent: 'bg-accent-soft text-accent-ink', brand: 'bg-brand-soft text-brand',
  };

  return (
    <Page withNav>
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
        <>
          {/* live-now hero */}
          <section className="px-4 sm:px-0 mt-2">
            <div className="rounded-[22px] bg-brand text-white p-5 shadow-card relative overflow-hidden">
              <div className="absolute -top-16 -right-12 w-52 h-52 rounded-full bg-white/8 blur-2xl" aria-hidden />
              <div className="relative">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 flex items-center gap-1.5">
                  <span className="relative flex w-1.5 h-1.5"><span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-70 animate-ping" /><span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-accent" /></span>
                  Live right now
                </p>
                <div className="flex items-end gap-2 mt-2">
                  <span className="font-display text-[46px] leading-none font-semibold tnum tracking-tight">{fmtIN(totals.live)}</span>
                  <span className="text-white/70 text-[13px] mb-1.5">birds</span>
                </div>
                <div className="grid grid-flow-col auto-cols-fr divide-x divide-white/15 mt-5 -mx-1">
                  {hasLayers && <HeroStat label="Eggs today" value={`${fmtIN(totals.eggsTotal)} tr`} />}
                  <HeroStat label="Mortality today" value={fmtIN(totals.mortToday)} />
                  <HeroStat label="Batches" value={fmtIN(myLive.length)} />
                </div>
              </div>
            </div>
          </section>

          {/* needs attention */}
          <section className="px-4 sm:px-0 mt-5">
            <SectionTitle right={<span className="font-mono text-[11px] text-muted tnum">{attention.length ? `${attention.length} open` : ''}</span>}>
              Needs attention
            </SectionTitle>
            {attention.length === 0 ? (
              <AllClear title="Everything's logged" description="No pending tasks, alerts or unlogged batches right now." />
            ) : (
              <GroupList>
                {attention.slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 ${toneMap[a.tone]}`}>{a.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-ink truncate">{a.title}</p>
                      <p className="text-[12px] text-muted truncate mt-0.5 tnum">{a.detail}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => nav(a.to)} className="shrink-0">{a.actionLabel}</Button>
                  </div>
                ))}
              </GroupList>
            )}
          </section>

          {/* trend + batches + activity */}
          <div className="px-4 sm:px-0 mt-5 grid gap-4 lg:grid-cols-3">
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
              <Card>
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-3 flex items-center gap-1.5">
                  <Activity size={13} /> Recent activity
                </h3>
                <ol className="relative">
                  {recent.map((a, i) => {
                    const who = users.find(u => u.id === a.byUserId)?.name.split(' ')[0] ?? 'System';
                    const verb = VERB[a.action] ?? a.action.toLowerCase();
                    const entity = ENTITY[a.entity] ?? a.entity.toLowerCase();
                    const Icon = a.action === 'DELETE' ? Trash2 : a.action === 'UPDATE' ? Pencil : a.action === 'LOCK' ? Lock : a.action === 'UNLOCK' ? CheckCircle2 : PlusCircle;
                    const tone = a.action === 'DELETE' ? 'text-danger' : a.action === 'LOCK' ? 'text-warn' : a.action === 'UNLOCK' ? 'text-success' : 'text-brand';
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
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 first:pl-1 min-w-0">
      <p className="font-display text-[20px] leading-6 font-semibold tnum truncate">{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/55 mt-1 truncate">{label}</p>
    </div>
  );
}
