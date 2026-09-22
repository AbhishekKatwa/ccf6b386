import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Egg, Skull, Package, Flame, Wheat, Clock, Check, ChevronRight, Minus, Plus,
  LogOut, ClipboardList, History, Sun, Sunset, Moon, Lock, AlertTriangle, Layers,
} from 'lucide-react';
import { useApp, useCompanyData, useCurrentUser } from '@/store/app';
import { SyncPill } from '@/components/layout/AppShell';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Avatar, Badge, Card, EmptyState, IconTile, SectionTitle, StatusBadge } from '@/components/ui/Card';
import { Button, Field, TextArea } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { fmtClock, fmtDate, fmtIN, greeting, timeOf, todayISO } from '@/lib/format';
import { eggStockByGrade, gradeTotal } from '@/lib/calc';
import {
  EGG_GRADES, EMPTY_GRADE_COUNTS, FEED_ROUNDS, FEED_ROUND_LABELS,
  type EggGrade, type EggGradeCounts, type FeedRound,
} from '@/types';

/* ============================= shared labor context ============================= */

/** Labor-facing wording: the good grade is simply "today's" eggs. */
const GRADE_WORD: Record<EggGrade, string> = { GOOD: 'Today', BROKEN: 'Broken', DOUBLE: 'Double', SMALL: 'Small' };

const ROUND_ICONS: Record<FeedRound, typeof Sun> = { MORNING: Sun, AFTERNOON: Sunset, EVENING: Moon };
/** Sensible defaults so the worker only has to nudge the clock. */
const ROUND_DEFAULT_TIME: Record<FeedRound, string> = { MORNING: '07:30', AFTERNOON: '13:30', EVENING: '18:00' };
/** The round decides the half of the day, so the worker never has to set AM or PM. */
const ROUND_MERIDIEM: Record<FeedRound, 'AM' | 'PM'> = { MORNING: 'AM', AFTERNOON: 'PM', EVENING: 'PM' };

/** Snap a typed clock time onto the round's half-day, e.g. evening 6:00 is 18:00. */
function alignToRound(at: string, round: FeedRound): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(at);
  if (!m) return ROUND_DEFAULT_TIME[round];
  const hour = (Number(m[1]) % 12 + 12) % 12 + (ROUND_MERIDIEM[round] === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

function useLaborDay() {
  const user = useCurrentUser();
  const data = useCompanyData();
  const today = todayISO();

  const batch = useMemo(() => {
    const mine = data.assignments.filter(a => a.userId === user?.id).map(a => a.batchId);
    return data.batches.find(b => b.status === 'ACTIVE' && mine.includes(b.id));
  }, [data.assignments, data.batches, user?.id]);

  const shed = data.sheds.find(s => s.id === batch?.shedId);
  const locked = !!batch && data.dayLocks.some(l => l.shedId === batch.shedId && l.date === today);

  /** Everyone mapped to this shed — the labor form prefills the signer-in name but allows switching. */
  const staffNames = useMemo(() => {
    if (!user) return [];
    const ids = new Set(data.assignments.filter(a => !batch || a.batchId === batch.id).map(a => a.userId));
    const names = data.users
      .filter(u => u.active && (u.id === user.id || ids.has(u.id)))
      .map(u => u.name);
    return [...new Set([user.name, ...names])];
  }, [data.assignments, data.users, batch?.id, user]);

  const todays = useMemo(() => {
    if (!batch) return null;
    const colls = data.eggs.filter(e => e.batchId === batch.id && e.date === today);
    const byGrade: EggGradeCounts = { ...EMPTY_GRADE_COUNTS };
    for (const c of colls) {
      byGrade.GOOD += c.goodTrays; byGrade.BROKEN += c.brokenTrays;
      byGrade.DOUBLE += c.doubleTrays; byGrade.SMALL += c.smallTrays;
    }
    const logs = data.saleLogs.filter(l => l.batchId === batch.id && l.date === today);
    return {
      colls,
      byGrade,
      trays: gradeTotal(byGrade),
      given: logs.reduce((s, l) => s + l.trays, 0),
      mort: data.mortality.filter(m => m.batchId === batch.id && m.date === today).reduce((s, m) => s + m.count, 0),
      disposed: data.disposals.filter(d => d.batchId === batch.id && d.date === today).reduce((s, d) => s + d.count, 0),
      rounds: data.feedRounds.filter(r => r.shedId === batch.shedId && r.date === today),
      stock: eggStockByGrade(batch.shedId, data.eggs, data.saleLogs, today),
    };
  }, [batch, data, today]);

  return { user, data, today, batch, shed, locked, staffNames, todays };
}

type LaborDay = ReturnType<typeof useLaborDay>;

/* ============================= big-touch primitives ============================= */

function CountInput({ label, icon, unit, value, onChange, tone = 'brand', hint }: {
  label: string; icon: ReactNode; unit: string; value: string; onChange: (v: string) => void;
  tone?: 'brand' | 'accent' | 'danger' | 'warn' | 'neutral'; hint?: string;
}) {
  const panel: Record<string, string> = {
    brand: 'bg-brand-soft text-brand-ink', accent: 'bg-accent-soft text-accent-ink',
    danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn', neutral: 'bg-sunk text-ink',
  };
  const n = value === '' ? 0 : Math.max(0, Number(value) || 0);
  const set = (v: number) => onChange(String(Math.max(0, v)));
  return (
    <div className="rounded-[16px] border border-line bg-card p-3.5">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className={clsx('w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0', panel[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink leading-tight">{label}</p>
          {hint && <p className="text-[11px] text-muted truncate mt-0.5 tnum">{hint}</p>}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted shrink-0">{unit}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(n - 1)}
          className="w-14 h-14 shrink-0 rounded-[14px] bg-sunk border border-line text-ink flex items-center justify-center press">
          <Minus size={22} />
        </button>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" value={value} aria-label={label}
          onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          className="flex-1 min-w-0 h-14 rounded-[14px] bg-canvas border border-line text-center font-display text-[26px] font-semibold tnum text-ink outline-none focus:border-brand"
        />
        <button type="button" aria-label={`Increase ${label}`} onClick={() => set(n + 1)}
          className="w-14 h-14 shrink-0 rounded-[14px] bg-sunk border border-line text-ink flex items-center justify-center press">
          <Plus size={22} />
        </button>
      </div>
      <div className="flex gap-2 mt-2">
        {[5, 10, 50].map(q => (
          <button key={q} type="button" onClick={() => set(n + q)}
            className="flex-1 h-9 rounded-[10px] bg-brand-soft text-brand-ink font-mono text-[11px] font-semibold uppercase tracking-[0.08em] press">
            +{q}
          </button>
        ))}
        <button type="button" onClick={() => onChange('')}
          className="flex-1 h-9 rounded-[10px] bg-sunk text-muted font-mono text-[11px] font-semibold uppercase tracking-[0.08em] press">
          Clear
        </button>
      </div>
    </div>
  );
}

function WorkerField({ value, onChange, names }: { value: string; onChange: (v: string) => void; names: string[] }) {
  const others = names.filter(n => n !== value);
  return (
    <div>
      <Field label="Recorded by" value={value} onChange={e => onChange(e.target.value)}
        placeholder="Who did this work?" className="text-[16px] py-3" />
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {others.map(n => (
            <button key={n} type="button" onClick={() => onChange(n)}
              className="px-3 h-8 rounded-full bg-sunk text-muted text-[12px] font-semibold press hover:text-brand">
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetFooter({ onCancel, onSave, saveLabel = 'Save' }: { onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="flex gap-2.5">
      <Button variant="outline" size="lg" block onClick={onCancel}>Cancel</Button>
      <Button size="lg" block onClick={onSave} icon={<Check size={17} />}>{saveLabel}</Button>
    </div>
  );
}

/* ============================= entry forms ============================= */

function EggSheet({ onClose, day }: { onClose: () => void; day: LaborDay }) {
  const addEggCollection = useApp(s => s.addEggCollection);
  const pushToast = useApp(s => s.pushToast);
  const [v, setV] = useState({
    GOOD: '', BROKEN: '', DOUBLE: '', SMALL: '',
    name: day.user?.name ?? '', remarks: '',
  });

  const nums: EggGradeCounts = {
    GOOD: Number(v.GOOD) || 0, BROKEN: Number(v.BROKEN) || 0,
    DOUBLE: Number(v.DOUBLE) || 0, SMALL: Number(v.SMALL) || 0,
  };
  const total = gradeTotal(nums);

  function save() {
    if (!day.batch) return;
    if (total === 0) return pushToast('error', 'Enter at least one tray count');
    if (!v.name.trim()) return pushToast('error', 'Enter who collected the eggs');
    const r = addEggCollection({
      batchId: day.batch.id, shedId: day.batch.shedId, date: day.today,
      goodTrays: nums.GOOD, brokenTrays: nums.BROKEN, doubleTrays: nums.DOUBLE, smallTrays: nums.SMALL,
      workerName: v.name.trim(), remarks: v.remarks.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not save');
    pushToast('success', `${fmtIN(total)} trays recorded`);
    onClose();
  }

  const rows: { grade: EggGrade; label: string; icon: ReactNode; tone: 'accent' | 'warn' | 'neutral'; hint: string }[] = [
    { grade: 'GOOD', label: 'Today', icon: <Egg size={18} />, tone: 'accent', hint: 'Fresh normal eggs' },
    { grade: 'BROKEN', label: 'Broken', icon: <AlertTriangle size={18} />, tone: 'warn', hint: 'Cracked or broken while collecting' },
    { grade: 'DOUBLE', label: 'Double', icon: <Layers size={18} />, tone: 'neutral', hint: 'Double-shelled / double-yolk' },
    { grade: 'SMALL', label: 'Small', icon: <Package size={18} />, tone: 'neutral', hint: 'Pullet / small grade' },
  ];

  return (
    <Dialog open onClose={onClose} title="Today's eggs"
      subtitle={`${day.shed?.name ?? 'Shed'} · ${fmtIN(day.todays?.trays ?? 0)} trays already logged today`}
      footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-3">
        <WorkerField value={v.name} onChange={name => setV(s => ({ ...s, name }))} names={day.staffNames} />
        {rows.map(r => (
          <CountInput key={r.grade} label={r.label} icon={r.icon} unit="trays" tone={r.tone} hint={r.hint}
            value={v[r.grade]} onChange={val => setV(s => ({ ...s, [r.grade]: val }))} />
        ))}
        <TextArea label="Remarks" rows={2} value={v.remarks}
          onChange={e => setV(s => ({ ...s, remarks: e.target.value }))} placeholder="Anything the supervisor should know" />
        <p className="text-[13px] text-muted text-center tnum">
          This round <span className="font-display font-semibold text-ink">{fmtIN(total)}</span> trays
        </p>
      </div>
    </Dialog>
  );
}

function MortalitySheet({ onClose, day }: { onClose: () => void; day: LaborDay }) {
  const addMortality = useApp(s => s.addMortality);
  const pushToast = useApp(s => s.pushToast);
  const [count, setCount] = useState('');
  const [name, setName] = useState(day.user?.name ?? '');
  const [remarks, setRemarks] = useState('');

  function save() {
    if (!day.batch) return;
    const n = Number(count) || 0;
    if (n <= 0) return pushToast('error', 'Enter how many birds died');
    if (!name.trim()) return pushToast('error', 'Enter who found the birds');
    const r = addMortality({
      batchId: day.batch.id, shedId: day.batch.shedId, date: day.today, count: n,
      workerName: name.trim(), remarks: remarks.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not save');
    pushToast('success', `${n} ${n === 1 ? 'bird' : 'birds'} recorded`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Mortality"
      subtitle={`${day.shed?.name ?? 'Shed'} · ${fmtIN(day.todays?.mort ?? 0)} already logged today`}
      footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-3">
        <WorkerField value={name} onChange={setName} names={day.staffNames} />
        <CountInput label="Dead birds found" icon={<Skull size={18} />} unit="birds" tone="danger"
          value={count} onChange={setCount} hint="Add one entry per visit" />
        <TextArea label="Reason / remarks" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="e.g. found near the feeder" />
      </div>
    </Dialog>
  );
}

function SaleSheet({ onClose, day }: { onClose: () => void; day: LaborDay }) {
  const addSaleLog = useApp(s => s.addSaleLog);
  const pushToast = useApp(s => s.pushToast);
  const [grade, setGrade] = useState<EggGrade>('GOOD');
  const [trays, setTrays] = useState('');
  const [name, setName] = useState(day.user?.name ?? '');
  const [remarks, setRemarks] = useState('');
  const icons: Record<EggGrade, ReactNode> = {
    GOOD: <Egg size={18} />, BROKEN: <AlertTriangle size={18} />, DOUBLE: <Layers size={18} />, SMALL: <Package size={18} />,
  };

  function save() {
    if (!day.batch) return;
    const n = Number(trays) || 0;
    if (n <= 0) return pushToast('error', 'Enter the trays given out');
    if (!name.trim()) return pushToast('error', 'Enter who handed the trays over');
    const r = addSaleLog({
      batchId: day.batch.id, shedId: day.batch.shedId, date: day.today,
      trays: n, grade, workerName: name.trim(), remarks: remarks.trim() || undefined,
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not save');
    pushToast('success', `${n} ${GRADE_WORD[grade].toLowerCase()} trays recorded`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Eggs given out"
      subtitle={`${day.shed?.name ?? 'Shed'} · a sale log the accounts team accepts later`}
      footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-3">
        <WorkerField value={name} onChange={setName} names={day.staffNames} />
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-2">Grade</p>
          <div className="grid grid-cols-2 gap-2">
            {EGG_GRADES.map(g => {
              const active = grade === g;
              return (
                <button key={g} type="button" onClick={() => setGrade(g)}
                  className={clsx('flex items-center gap-2.5 rounded-[14px] border px-3 py-3 text-left press',
                    active ? 'border-brand bg-brand-soft' : 'border-line bg-card')}>
                  <span className={active ? 'text-brand' : 'text-muted'}>{icons[g]}</span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-ink">{GRADE_WORD[g]}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-muted tnum">
                      {fmtIN(day.todays?.stock[g].balance ?? 0)} in stock
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <CountInput label="Trays given out" icon={<Package size={18} />} unit="trays" tone="brand"
          value={trays} onChange={setTrays}
          hint={`${fmtIN(day.todays?.stock[grade].balance ?? 0)} ${GRADE_WORD[grade].toLowerCase()} trays in stock`} />
        <TextArea label="Remarks" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="e.g. taken by Rajesh Traders" />
      </div>
    </Dialog>
  );
}

const DISPOSAL_METHODS = ['Compost', 'Burial', 'Incinerator'];

function DisposalSheet({ onClose, day }: { onClose: () => void; day: LaborDay }) {
  const addDisposal = useApp(s => s.addDisposal);
  const pushToast = useApp(s => s.pushToast);
  const [count, setCount] = useState('');
  const [method, setMethod] = useState(DISPOSAL_METHODS[0]);
  const [name, setName] = useState(day.user?.name ?? '');

  function save() {
    if (!day.batch) return;
    const n = Number(count) || 0;
    if (n <= 0) return pushToast('error', 'Enter how many birds were disposed');
    if (!name.trim()) return pushToast('error', 'Enter who disposed the birds');
    const r = addDisposal({
      batchId: day.batch.id, shedId: day.batch.shedId, date: day.today, count: n,
      method, workerName: name.trim(),
    });
    if (!r.ok) return pushToast('error', r.error ?? 'Could not save');
    pushToast('success', `${n} disposed by ${method.toLowerCase()}`);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Dispose dead birds"
      subtitle={`${day.shed?.name ?? 'Shed'} · ${fmtIN(day.todays?.disposed ?? 0)} disposed today`}
      footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-3">
        <WorkerField value={name} onChange={setName} names={day.staffNames} />
        <CountInput label="Birds disposed" icon={<Flame size={18} />} unit="birds" tone="neutral"
          value={count} onChange={setCount} hint={`Mortality today: ${fmtIN(day.todays?.mort ?? 0)}`} />
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-2">Method</p>
          <div className="flex flex-wrap gap-2">
            {DISPOSAL_METHODS.map(m => (
              <button key={m} type="button" onClick={() => setMethod(m)}
                className={clsx('px-4 h-12 rounded-full border text-[15px] font-semibold press',
                  method === m ? 'border-brand bg-brand text-white' : 'border-line bg-card text-ink')}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

type RoundMode = 'NONE' | 'GIVEN' | 'SKIPPED';

function FeedSheet({ onClose, day }: { onClose: () => void; day: LaborDay }) {
  const logFeedRound = useApp(s => s.logFeedRound);
  const pushToast = useApp(s => s.pushToast);
  const [name, setName] = useState(day.user?.name ?? '');
  const [rows, setRows] = useState<Record<FeedRound, { mode: RoundMode; at: string }>>(() => {
    const out = {} as Record<FeedRound, { mode: RoundMode; at: string }>;
    for (const r of FEED_ROUNDS) {
      const logged = day.todays?.rounds.find(x => x.round === r);
      out[r] = logged
        ? { mode: logged.status === 'GIVEN' ? 'GIVEN' : 'SKIPPED', at: logged.at || ROUND_DEFAULT_TIME[r] }
        : { mode: 'NONE', at: ROUND_DEFAULT_TIME[r] };
    }
    return out;
  });

  function save() {
    if (!day.batch) return;
    if (!name.trim()) return pushToast('error', 'Enter who gave the feed');
    const active = FEED_ROUNDS.filter(r => rows[r].mode !== 'NONE');
    if (active.length === 0) return pushToast('error', 'Choose a round to record');
    for (const r of active) {
      const { mode, at } = rows[r];
      const res = logFeedRound({
        batchId: day.batch.id, shedId: day.batch.shedId, date: day.today, round: r,
        status: mode === 'SKIPPED' ? 'SKIPPED' : 'GIVEN', at: mode === 'GIVEN' ? at : '',
        workerName: name.trim(),
      });
      if (!res.ok) return pushToast('error', res.error ?? 'Could not save');
    }
    pushToast('success', 'Feed timing saved');
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Feed timing"
      subtitle={`${day.shed?.name ?? 'Shed'} · when the feed actually went to the birds`}
      footer={<SheetFooter onCancel={onClose} onSave={save} />}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted leading-relaxed">
          The supervisor has already put today's feed in the shed. Record only the time you
          gave it, or mark a round as skipped — no quantities here.
        </p>
        <WorkerField value={name} onChange={setName} names={day.staffNames} />
        {FEED_ROUNDS.map(r => {
          const Icon = ROUND_ICONS[r];
          const row = rows[r];
          return (
            <div key={r} className="rounded-[16px] border border-line bg-card p-3.5">
              <div className="flex items-center gap-2.5">
                <span className={clsx('w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0',
                  row.mode === 'GIVEN' ? 'bg-success-soft text-success' : row.mode === 'SKIPPED' ? 'bg-warn-soft text-warn' : 'bg-sunk text-muted-2')}>
                  <Icon size={18} />
                </span>
                <p className="flex-1 text-[15px] font-semibold text-ink">{FEED_ROUND_LABELS[r]}</p>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted tnum">
                  {row.mode === 'GIVEN' ? fmtClock(row.at) : row.mode === 'SKIPPED' ? 'skipped' : 'not logged'}
                </span>
              </div>
              <div className="flex gap-2 mt-2.5">
                {(['GIVEN', 'SKIPPED'] as const).map(mode => (
                  <button key={mode} type="button"
                    onClick={() => setRows(s => ({ ...s, [r]: { ...s[r], mode: s[r].mode === mode ? 'NONE' : mode } }))}
                    className={clsx(
                      'flex-1 h-12 rounded-[12px] border text-[15px] font-semibold press',
                      row.mode === mode
                        ? mode === 'GIVEN' ? 'border-success bg-success text-white' : 'border-warn bg-warn-soft text-warn'
                        : 'border-line bg-sunk text-muted',
                    )}>
                    {mode === 'GIVEN' ? 'Given' : 'Skipped'}
                  </button>
                ))}
              </div>
              {row.mode === 'GIVEN' && (
                <div className="mt-2.5 ap-fade-in">
                  <Field label="Time given" type="time" value={row.at}
                    onChange={e => setRows(s => ({ ...s, [r]: { ...s[r], at: e.target.value } }))}
                    className="text-[16px] py-3" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/* ============================= today (labor home) ============================= */

type SheetKind = 'eggs' | 'mortality' | 'sale' | 'disposal' | 'feed';

export function LaborHomeScreen() {
  const nav = useNavigate();
  const day = useLaborDay();
  const signOut = useApp(s => s.signOut);
  const updateTask = useApp(s => s.updateTask);
  const pushToast = useApp(s => s.pushToast);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);

  const s = day.todays;
  const user = day.user;
  const myTasks = day.batch && user
    ? day.data.tasks.filter(t => t.date === day.today && t.assignedUserId === user.id)
    : [];

  if (!user) return null;

  const firstName = user.name.split(' ')[0];

  if (!day.batch) {
    return (
      <Page withNav>
        <ScreenTitle eyebrow={greeting()} title={firstName} subtitle={fmtDate(day.today)} />
        <div className="px-4 sm:px-0">
          <EmptyState icon={<Layers size={22} />} title="No shed assigned yet"
            description="Your supervisor has not mapped you to a shed. You will see today's work here once that is done." />
        </div>
        <SignOut open={confirmOut} onClose={() => setConfirmOut(false)} onConfirm={signOut} />
      </Page>
    );
  }

  const tiles: { key: SheetKind; label: string; icon: ReactNode; value: string; unit: string; tone: string }[] = [
    { key: 'eggs', label: 'Today’s eggs', icon: <Egg size={26} />, value: fmtIN(s?.trays ?? 0), unit: 'trays collected', tone: 'bg-accent-soft text-accent-ink' },
    { key: 'mortality', label: 'Mortality', icon: <Skull size={26} />, value: fmtIN(s?.mort ?? 0), unit: 'birds', tone: 'bg-danger-soft text-danger' },
    { key: 'sale', label: 'Eggs given out', icon: <Package size={26} />, value: fmtIN(s?.given ?? 0), unit: 'trays', tone: 'bg-brand-soft text-brand' },
    { key: 'disposal', label: 'Dead birds disposed', icon: <Flame size={26} />, value: fmtIN(s?.disposed ?? 0), unit: 'birds', tone: 'bg-sunk text-ink' },
  ];

  return (
    <Page withNav>
      <header className="px-4 sm:px-0 pt-5 pb-3 safe-top flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            {greeting()} · {fmtDate(day.today)}
          </p>
          <h1 className="font-display text-[28px] sm:text-[32px] font-semibold text-ink leading-tight tracking-tight truncate mt-1">
            {firstName}
          </h1>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge tone="brand">{day.shed?.name ?? 'Shed'}</Badge>
            <Badge tone="neutral">{day.batch.code}</Badge>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <SyncPill compact />
          <Avatar name={user.name} size={40} />
        </div>
      </header>

      {day.locked && (
        <div className="px-4 sm:px-0 mt-1">
          <div className="flex items-center gap-2.5 rounded-[14px] bg-warn-soft px-4 py-3">
            <Lock size={16} className="text-warn shrink-0" />
            <p className="text-[12.5px] text-warn font-medium">{fmtDate(day.today)} is locked by the owner — entries are on hold.</p>
          </div>
        </div>
      )}

      <section className="px-4 sm:px-0 mt-4">
        <SectionTitle right={
          <button onClick={() => nav('/log')} className="font-mono text-[11px] font-semibold text-brand press">Today’s log</button>
        }>What to record</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map(t => (
            <button key={t.key} onClick={() => setSheet(t.key)}
              className="rounded-[18px] bg-card border border-line shadow-card p-4 text-left press hover:border-brand min-h-[132px] flex flex-col">
              <span className={clsx('w-11 h-11 rounded-[13px] flex items-center justify-center mb-3', t.tone)}>{t.icon}</span>
              <span className="block text-[13px] font-semibold text-ink leading-tight">{t.label}</span>
              <span className="block font-display text-[26px] font-semibold text-ink tnum leading-none mt-1.5">{t.value}</span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-muted mt-1.5">{t.unit}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="px-4 sm:px-0 mt-5">
        <SectionTitle>Feed timing</SectionTitle>
        <Card padded={false} className="overflow-hidden">
          <button onClick={() => setSheet('feed')} className="w-full press">
            <div className="divide-y divide-line-2">
              {FEED_ROUNDS.map(r => {
                const Icon = ROUND_ICONS[r];
                const logged = s?.rounds.find(x => x.round === r);
                return (
                  <div key={r} className="flex items-center gap-3 px-4 py-3">
                    <span className={clsx('w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0',
                      logged ? 'bg-success-soft text-success' : 'bg-sunk text-muted-2')}>
                      <Icon size={17} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-ink">{FEED_ROUND_LABELS[r]}</p>
                      <p className="text-[12px] text-muted truncate mt-0.5">
                        {logged
                          ? logged.status === 'GIVEN'
                            ? `Feed given · ${fmtClock(logged.at)}`
                            : 'Round skipped'
                          : 'Not logged yet'}
                        {logged?.workerName ? ` · ${logged.workerName}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={17} className="text-muted-2 shrink-0" />
                  </div>
                );
              })}
            </div>
          </button>
        </Card>
      </section>

      {myTasks.length > 0 && (
        <section className="px-4 sm:px-0 mt-5">
          <SectionTitle right={
            <button onClick={() => nav('/tasks')} className="font-mono text-[11px] font-semibold text-brand press">All tasks</button>
          }>My tasks today</SectionTitle>
          <div className="space-y-2.5">
            {myTasks.map(t => {
              const done = t.status === 'COMPLETED';
              return (
                <Card key={t.id} className={clsx('flex items-center gap-3', done && 'opacity-60')}>
                  <IconTile tone={done ? 'success' : 'brand'} size={38}>
                    {done ? <Check size={18} /> : <ClipboardList size={18} />}
                  </IconTile>
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-[14px] font-semibold truncate', done ? 'text-muted line-through' : 'text-ink')}>{t.title}</p>
                    <p className="text-[12px] text-muted mt-0.5 tnum">{t.time ? fmtClock(t.time) : 'Any time'}</p>
                  </div>
                  {done
                    ? <StatusBadge status="COMPLETED" />
                    : <Button size="sm" onClick={() => { updateTask(t.id, { status: 'COMPLETED' }); pushToast('success', 'Task completed'); }}>Mark done</Button>}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="px-4 sm:px-0 mt-6 space-y-2.5">
        <Button variant="outline" size="lg" block icon={<History size={17} />} onClick={() => nav('/log')}>Today’s log</Button>
        <Button variant="outline" size="lg" block icon={<LogOut size={17} />} className="text-danger border-danger/30"
          onClick={() => setConfirmOut(true)}>Sign out</Button>
      </section>

      {sheet === 'eggs' && <EggSheet onClose={() => setSheet(null)} day={day} />}
      {sheet === 'mortality' && <MortalitySheet onClose={() => setSheet(null)} day={day} />}
      {sheet === 'sale' && <SaleSheet onClose={() => setSheet(null)} day={day} />}
      {sheet === 'disposal' && <DisposalSheet onClose={() => setSheet(null)} day={day} />}
      {sheet === 'feed' && <FeedSheet onClose={() => setSheet(null)} day={day} />}

      <SignOut open={confirmOut} onClose={() => setConfirmOut(false)} onConfirm={signOut} />
    </Page>
  );
}

function SignOut({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog open={open} title="Sign out?" confirmLabel="Sign out" onCancel={onClose}
      onConfirm={() => { onClose(); onConfirm(); }}
      message="Entries you already saved stay on this phone and sync when you sign in again." />
  );
}

/* ============================= today's log ============================= */

type LogItem = { id: string; at: string; icon: ReactNode; tone: string; title: string; detail: string; by?: string };

export function LaborLogScreen() {
  const day = useLaborDay();
  const nav = useNavigate();

  const items = useMemo<LogItem[]>(() => {
    const s = day.todays;
    const batch = day.batch;
    if (!s || !batch || !day.user) return [];
    const out: LogItem[] = [];
    for (const e of s.colls) {
      const own: EggGradeCounts = { GOOD: e.goodTrays, BROKEN: e.brokenTrays, DOUBLE: e.doubleTrays, SMALL: e.smallTrays };
      const grades = EGG_GRADES.filter(g => own[g] > 0)
        .map(g => `${fmtIN(own[g])} ${GRADE_WORD[g].toLowerCase()}`).join(' · ');
      out.push({
        id: e.id, at: e.createdAt, icon: <Egg size={17} />, tone: 'bg-accent-soft text-accent-ink',
        title: `Eggs collected — ${fmtIN(gradeTotal(own))} trays`,
        detail: grades || 'No trays', by: e.workerName,
      });
    }
    for (const l of day.data.saleLogs.filter(x => x.batchId === batch.id && x.date === day.today)) {
      out.push({
        id: l.id, at: l.createdAt, icon: <Package size={17} />, tone: 'bg-brand-soft text-brand',
        title: `${fmtIN(l.trays)} ${GRADE_WORD[l.grade].toLowerCase()} trays given out`,
        detail: l.status === 'PENDING' ? 'Waiting for accounts to accept' : 'Accepted by accounts', by: l.workerName,
      });
    }
    for (const m of day.data.mortality.filter(x => x.batchId === batch.id && x.date === day.today)) {
      out.push({
        id: m.id, at: m.createdAt, icon: <Skull size={17} />, tone: 'bg-danger-soft text-danger',
        title: `${fmtIN(m.count)} ${m.count === 1 ? 'bird' : 'birds'} dead`,
        detail: m.remarks ?? 'Mortality recorded', by: m.workerName,
      });
    }
    for (const d of day.data.disposals.filter(x => x.batchId === batch.id && x.date === day.today)) {
      out.push({
        id: d.id, at: d.createdAt, icon: <Flame size={17} />, tone: 'bg-sunk text-ink',
        title: `${fmtIN(d.count)} disposed`, detail: d.method ?? 'Disposal', by: d.workerName,
      });
    }
    for (const r of s.rounds) {
      out.push({
        id: r.id, at: r.createdAt,
        icon: r.status === 'GIVEN' ? <Wheat size={17} /> : <Clock size={17} />,
        tone: r.status === 'GIVEN' ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn',
        title: `Feed ${FEED_ROUND_LABELS[r.round].toLowerCase()} · ${r.status === 'GIVEN' ? fmtClock(r.at) : 'skipped'}`,
        detail: r.status === 'GIVEN' ? 'Given to the birds at this time' : (r.remarks ?? 'Round missed'),
        by: r.workerName,
      });
    }
    for (const t of day.data.tasks.filter(x => x.date === day.today && x.assignedUserId === day.user?.id && x.status === 'COMPLETED')) {
      out.push({
        id: t.id, at: t.updatedAt ?? t.createdAt, icon: <Check size={17} />, tone: 'bg-success-soft text-success',
        title: t.title, detail: 'Task completed', by: day.user.name,
      });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [day.todays, day.batch, day.data, day.today, day.user]);

  if (!day.user) return null;
  const s = day.todays;

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Farm labor" title="Today’s log"
        subtitle={`${day.shed?.name ?? 'Shed'} · ${fmtDate(day.today)}`} />
      <div className="px-4 sm:px-0 space-y-4">
        {s && (
          <Card>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-display text-[22px] font-semibold text-ink tnum leading-none">{fmtIN(s.trays)}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted mt-1.5">Trays in</p>
              </div>
              <div>
                <p className="font-display text-[22px] font-semibold text-ink tnum leading-none">{fmtIN(s.given)}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted mt-1.5">Trays out</p>
              </div>
              <div>
                <p className="font-display text-[22px] font-semibold text-danger tnum leading-none">{fmtIN(s.mort)}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted mt-1.5">Birds dead</p>
              </div>
            </div>
          </Card>
        )}

        {!day.batch ? (
          <EmptyState icon={<Layers size={22} />} title="No shed assigned"
            description="Your day log appears here once a shed is assigned to you." />
        ) : items.length === 0 ? (
          <EmptyState icon={<History size={22} />} title="Nothing logged yet today"
            description="Every egg, mortality, sale and feed entry you add today is listed here with its time."
            action={<Button size="lg" onClick={() => nav('/')}>Go to today</Button>} />
        ) : (
          <div className="bg-card border border-line rounded-[18px] shadow-card divide-y divide-line-2 overflow-hidden">
            {items.map(it => (
              <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                <span className={clsx('w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 mt-0.5', it.tone)}>{it.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-ink">{it.title}</p>
                  <p className="text-[12px] text-muted truncate mt-0.5">{it.detail}</p>
                  {it.by && <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2 mt-1">by {it.by}</p>}
                </div>
                <span className="font-mono text-[11px] text-muted tnum shrink-0">{fmtClock(timeOf(it.at))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
