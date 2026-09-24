import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarRange, Egg, Handshake, History, Info, Link2, PencilLine, Plus, Ban,
} from 'lucide-react';
import clsx from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Button, ChipGroup, Field, SelectField, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, EmptyState, GroupList, ListRow } from '@/components/ui/Card';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { daysBetween, fmtDate, fmtIN, shiftDate, todayISO } from '@/lib/format';
import { latestFirst } from '@/lib/order';
import { batchOfShedOn } from '@/lib/calc';
import { PLANNER_DAYS, PLANNER_HORIZON, plannerWindow, shedDayPlans, type ShedDayPlan } from '@/lib/planner';
import { EGG_GRADES, type EggBookingStatus, type EggGrade, type EggSaleBooking } from '@/types';

const DASH = '—';

const GRADE_WORD: Record<EggGrade, string> = {
  GOOD: 'Normal', BROKEN: 'Broken', DOUBLE: 'Double', SMALL: 'Small',
};

const STATUS_WORD: Record<EggBookingStatus, { tone: 'brand' | 'success' | 'neutral'; label: string }> = {
  PLANNED: { tone: 'brand', label: 'Planned' },
  FULFILLED: { tone: 'success', label: 'Sold' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};

/** Today, tomorrow, then the weekday — a planner reads in days, not in dates. */
function dayLabel(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return weekdayOf(date);
}

function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? fmtDate(date)
    : d.toLocaleDateString('en-IN', { weekday: 'long' });
}

const traysOf = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

/** The board a segment shows: a slice of the rolling horizon, never a re-cut of the maths. */
type RangeKey = 'TODAY' | 'TOMORROW' | 'WEEK' | 'FORTNIGHT' | 'CUSTOM';

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'WEEK', label: 'Next 7 days' },
  { value: 'FORTNIGHT', label: 'Next 14 days' },
  { value: 'CUSTOM', label: 'Custom range' },
];

function daysShown(key: RangeKey, horizon: string[], from: string, to: string): string[] {
  const last = horizon.length - 1;
  const slice = (start: number, end: number) => horizon.slice(Math.max(0, start), Math.min(last, end) + 1);
  if (key === 'TOMORROW') return slice(1, 1 + PLANNER_DAYS - 1);
  if (key === 'WEEK') return slice(0, 6);
  if (key === 'FORTNIGHT') return slice(0, last);
  if (key === 'CUSTOM') {
    const a = horizon.indexOf(from);
    const b = horizon.indexOf(to);
    if (a < 0 || b < 0 || b < a) return slice(0, PLANNER_DAYS - 1);
    return horizon.slice(a, b + 1);
  }
  return slice(0, PLANNER_DAYS - 1);
}

interface BookingForm {
  date: string; shedId: string; traderId: string; grade: EggGrade; trays: string; remarks: string;
}

export function EggSalePlannerScreen() {
  const data = useCompanyData();
  const canPlan = useCan('createSaleEntries');
  const addBooking = useApp(s => s.addEggSalePlannerBooking);
  const updateBooking = useApp(s => s.updateEggSalePlannerBooking);
  const cancelBooking = useApp(s => s.cancelEggSalePlannerBooking);
  const nav = useNavigate();

  const today = todayISO();
  const horizon = useMemo(() => plannerWindow(today, PLANNER_HORIZON), [today]);
  const [range, setRange] = useState<RangeKey>('TODAY');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(shiftDate(today, PLANNER_DAYS - 1));
  const board = useMemo(() => daysShown(range, horizon, from, to), [range, horizon, from, to]);
  const [showHistory, setShowHistory] = useState(false);
  /** Which booking the sheet holds: null closed, '' a new one, otherwise that record. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<BookingForm | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sheds = useMemo(() => [...data.sheds].sort((a, b) => a.name.localeCompare(b.name)), [data.sheds]);
  /** One walk per shed over the whole horizon, so a day reads the same remainder wherever it is shown. */
  const plans = useMemo(() => new Map(sheds.map(sh => [
    sh.id,
    new Map(shedDayPlans({
      shedId: sh.id, eggs: data.eggs, entries: data.saleEntries, wastages: data.eggWastages,
      bookings: data.eggSaleBookings, dates: horizon, today,
    }).map(p => [p.date, p])),
  ])), [sheds, data.eggs, data.saleEntries, data.eggWastages, data.eggSaleBookings, horizon, today]);

  const planOf = (shedId: string, date: string) => plans.get(shedId)?.get(date) ?? null;
  const shedName = (id: string) => sheds.find(s => s.id === id)?.name ?? DASH;
  const traderName = (id: string) => data.traders.find(t => t.id === id)?.name ?? DASH;
  const findBooking = (id: string | null) => data.eggSaleBookings.find(b => b.id === id) ?? null;

  const upcoming = useMemo(
    () => data.eggSaleBookings
      .filter(b => b.status === 'PLANNED' && b.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
    [data.eggSaleBookings, today],
  );

  /** A booking already saved outside the window stays editable; only a new one is bound to it. */
  function openSheet(at?: { date?: string; shedId?: string; bookingId?: string }) {
    const b = at?.bookingId ? findBooking(at.bookingId) : null;
    setError(null);
    setCancelReason('');
    setEditing(b?.id ?? '');
    setForm({
      date: b?.date ?? at?.date ?? today,
      shedId: b?.shedId ?? at?.shedId ?? sheds[0]?.id ?? '',
      traderId: b?.traderId ?? '',
      grade: b?.grade ?? 'GOOD',
      trays: b ? String(b.plannedTrays) : '',
      remarks: b?.remarks ?? '',
    });
  }

  function closeSheet() {
    setEditing(null);
    setForm(null);
    setError(null);
  }

  function save() {
    if (!form) return;
    setError(null);
    const draft = {
      date: form.date, shedId: form.shedId, traderId: form.traderId,
      grade: form.grade, plannedTrays: traysOf(form.trays),
      remarks: form.remarks.trim() || undefined,
    };
    const r = editing ? updateBooking(editing, draft) : addBooking(draft);
    if (!r.ok) { setError(r.error ?? 'Could not save the booking'); return; }
    closeSheet();
  }

  function dropBooking() {
    if (!cancelling) return;
    setError(null);
    const r = cancelBooking(cancelling, cancelReason);
    if (!r.ok) { setError(r.error ?? 'Could not cancel the booking'); return; }
    setCancelling(null);
    setDetail(null);
    setCancelReason('');
  }

  const rows = showHistory ? latestFirst(data.eggSaleBookings) : [];
  const active = detail ? findBooking(detail) : null;

  return (
    <Page withNav>
      <ScreenTitle
        eyebrow="Commerce" title="Egg Sale Planner"
        subtitle="Plan how many trays to promise to each trader before the load leaves. A booking plan only — it never moves stock, money or a trader balance."
        action={canPlan && sheds.length > 0
          ? <Button size="sm" icon={<Plus size={15} />} onClick={() => openSheet()}>Add booking</Button>
          : undefined}
      />

      <div className="px-4 sm:px-0 mt-1 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div className="min-w-0 sm:max-w-[520px]">
            <ChipGroup value={range} onChange={setRange} options={RANGE_OPTIONS} />
          </div>
          <button type="button" onClick={() => setShowHistory(h => !h)}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-[10px] border border-line bg-card text-[12px] font-semibold text-ink press hover:border-brand hover:text-brand shrink-0">
            <History size={13} />
            {showHistory ? 'Back to the board' : 'View history'}
          </button>
        </div>

        {range === 'CUSTOM' && (
          <div className="grid grid-cols-2 gap-3 max-w-[360px]">
            <Field label="From" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
            <Field label="To" type="date" value={to} min={from} max={horizon[horizon.length - 1]}
              onChange={e => setTo(e.target.value)} />
          </div>
        )}

        {sheds.length === 0 && (
          <EmptyState icon={<Egg size={20} />} title="No sheds yet"
            description="A booking promises trays out of a shed, so the sheds come first." />
        )}

        {showHistory && (
          rows.length === 0
            ? <EmptyState icon={<CalendarRange size={20} />} title="No bookings yet"
              description="Every load promised to a trader shows up here — open, sold or dropped — with who planned it and when." />
            : <GroupList>
              {rows.map(b => (
                <ListRow key={b.id} onClick={() => setDetail(b.id)}
                  leading={<span className="w-9 h-9 rounded-[10px] bg-sunk text-ink-2 flex items-center justify-center shrink-0"><Handshake size={16} /></span>}
                  title={traderName(b.traderId)}
                  subtitle={`${fmtDate(b.date)} · ${shedName(b.shedId)} · ${fmtIN(b.plannedTrays)} ${GRADE_WORD[b.grade].toLowerCase()}`}
                  trailing={<Badge tone={STATUS_WORD[b.status].tone}>{STATUS_WORD[b.status].label}</Badge>}
                />
              ))}
            </GroupList>
        )}

        {!showHistory && sheds.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
            <div className="min-w-0 space-y-4">
              {board.map(date => {
                const dayRows = sheds.map(sh => ({ shed: sh, plan: planOf(sh.id, date) }));
                const known = dayRows.filter(r => r.plan?.available != null);
                return (
                  <section key={date} className="rounded-[18px] border border-line bg-card shadow-card overflow-hidden">
                    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-sunk/50 border-b border-line">
                      <div className="min-w-0">
                        <h2 className="font-display text-[17px] font-semibold text-ink leading-tight">{dayLabel(date, today)}</h2>
                        <p className="text-[11.5px] text-muted tnum mt-0.5 flex items-center gap-2">
                          {fmtDate(date)}
                          <span className="px-2 py-[3px] rounded-full bg-card border border-line text-[10px] text-ink-2">
                            {weekdayOf(date)}
                          </span>
                        </p>
                      </div>
                      <div className="grid grid-cols-3 sm:block sm:max-w-[420px]">
                        <Figure label="Total available" trays={sum(known.map(r => r.plan!.available!))} />
                        <Figure label="Total booked" trays={sum(dayRows.map(r => r.plan?.booked ?? 0))} />
                        <Figure label="Left to book" trays={sum(dayRows.filter(r => r.plan?.remaining != null).map(r => r.plan!.remaining!))}
                          tone={dayRows.some(r => (r.plan?.shortage ?? 0) > 0) ? 'warn' : 'brand'} />
                      </div>
                    </header>
                    <DayTable rows={dayRows} canPlan={canPlan}
                      onAdd={shedId => openSheet({ date, shedId })} />
                  </section>
                );
              })}
              {data.traders.length === 0 && (
                <p className="text-[12px] text-muted bg-sunk rounded-[10px] px-3 py-2">
                  No traders are registered for this company yet, so there is nobody to promise a load to.
                </p>
              )}
            </div>

            <aside className="rounded-[18px] border border-line bg-card shadow-card p-4 xl:sticky xl:top-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ink">Upcoming bookings</h3>
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-sunk text-[11px] font-mono tnum text-ink-2 flex items-center justify-center">
                  {upcoming.length}
                </span>
              </div>
              {upcoming.length === 0 ? (
                <p className="mt-3 text-[12px] text-muted leading-relaxed">
                  No upcoming bookings. Add a booking to plan egg sales to traders.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {upcoming.slice(0, 8).map(b => (
                    <li key={b.id}>
                      <button type="button" onClick={() => setDetail(b.id)}
                        className="w-full min-w-0 flex items-center gap-2.5 rounded-[11px] border border-line bg-sunk/50 px-2.5 py-2 text-left press hover:bg-sunk">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-ink truncate">{traderName(b.traderId)}</span>
                          <span className="block text-[11px] text-muted tnum">
                            {dayLabel(b.date, today)} · {shedName(b.shedId)} · {fmtIN(b.plannedTrays)} {GRADE_WORD[b.grade].toLowerCase()}
                          </span>
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {upcoming.length > 8 && (
                <button type="button" onClick={() => setShowHistory(true)}
                  className="mt-2.5 text-[12px] font-semibold text-brand press hover:underline">
                  See all {upcoming.length} open bookings
                </button>
              )}
            </aside>
          </div>
        )}
      </div>

      {/* New / edit booking */}
      <Dialog open={!!form} onClose={closeSheet}
        title={editing ? 'Edit booking' : 'Add booking'}
        subtitle="A promise of trays to a trader. Nothing here moves stock or books money."
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={closeSheet}>Cancel</Button>
          <Button block onClick={save}
            disabled={!form?.shedId || !form?.traderId || traysOf(form.trays) <= 0}>Save booking</Button>
        </div>}>
        {form && (
          <div className="space-y-3">
            <SelectField label="Date" value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
              options={dateOptions(horizon, editing ? findBooking(editing)?.date : undefined, today)} />
            <SelectField label="Shed" value={form.shedId}
              onChange={e => setForm({ ...form, shedId: e.target.value })}
              options={sheds.map(s => ({ value: s.id, label: s.name }))} />
            <SelectField label="Trader" value={form.traderId}
              onChange={e => setForm({ ...form, traderId: e.target.value })}
              options={[{ value: '', label: 'Select trader' }, ...data.traders.map(t => ({ value: t.id, label: t.name }))]} />
            <Field label="Trays" type="number" inputMode="numeric" min={0} step={1}
              value={form.trays} onChange={e => setForm({ ...form, trays: e.target.value })}
              placeholder="0" suffix="trays"
              hint={batchHint(form.shedId ? batchOfShedOn(data.batches, form.shedId, form.date)?.code : undefined)} />
            <div>
              <p className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Grade</p>
              <ChipGroup value={form.grade} onChange={g => setForm({ ...form, grade: g })}
                options={EGG_GRADES.map(g => ({ value: g, label: GRADE_WORD[g] }))} />
            </div>
            <TextArea label="Remarks (optional)" rows={2} value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
              placeholder="Vehicle, buyer instruction, split load…" />

            {(() => {
              const p = planOf(form.shedId, form.date);
              if (!p) return null;
              const typed = traysOf(form.trays);
              const already = (p.bookings ?? []).filter(b => b.id !== editing).reduce((s, b) => s + b.plannedTrays, 0);
              const left = p.available === null ? null : p.available - already - typed - p.wasted;
              const over = left === null ? 0 : Math.max(0, -left);
              return (
                <div className="rounded-[12px] bg-sunk px-3 py-2.5 space-y-1">
                  <Moneyish label={p.recorded ? 'Available (collected)' : 'Available (projected)'}
                    value={p.available === null ? DASH : `${fmtIN(p.available)} trays`} />
                  <Moneyish label="Already booked" value={`${fmtIN(already)} trays`} />
                  <Moneyish label="This booking" value={`${fmtIN(typed)} trays`} />
                  {p.wasted > 0 && <Moneyish label="Wastage written off" value={`${fmtIN(p.wasted)} trays`} />}
                  <div className="pt-1 mt-1 border-t border-line-2">
                    <Moneyish label="Left" value={left === null ? DASH : `${fmtIN(left)} trays`}
                      tone={left === null ? 'muted' : left < 0 ? 'warn' : 'success'} />
                  </div>
                  {over > 0 && (
                    <p className="mt-1.5 flex items-center gap-1.5 rounded-[10px] bg-warn-soft px-2.5 py-1.5 text-[11.5px] font-semibold text-warn">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span className="tnum">{fmtIN(over)} trays over planned availability</span>
                    </p>
                  )}
                </div>
              );
            })()}

            <p className="flex items-start gap-1.5 text-[11px] text-muted-2 leading-snug">
              <Info size={12} className="shrink-0 mt-[2px]" />
              This creates a booking plan only. It does not deduct stock or affect any balance.
            </p>

            {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
          </div>
        )}
      </Dialog>

      {/* One booking */}
      {active && (
        <BookingDetail b={active} shedName={shedName(active.shedId)} traderName={traderName(active.traderId)}
          canPlan={canPlan} onBoard={horizon.includes(active.date)}
          onClose={() => setDetail(null)}
          onEdit={() => openSheet({ bookingId: active.id })}
          onCancel={() => { setError(null); setCancelling(active.id); }}
          onSale={() => nav(`/sales?planner=${active.id}`)} />
      )}

      {/* Why the plan is being dropped */}
      <Dialog open={!!cancelling} onClose={() => setCancelling(null)}
        title="Cancel this booking?"
        subtitle="The record stays in the planner with its reason. Nothing is deleted, and no stock or money moves either way."
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => setCancelling(null)}>Keep it</Button>
          <Button variant="danger" block onClick={dropBooking}>Cancel booking</Button>
        </div>}>
        <div className="space-y-3">
          <TextArea label="Reason" rows={3} value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            placeholder="Trader called the load off, bird age, no vehicle…" />
          {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        </div>
      </Dialog>
    </Page>
  );
}

const sum = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) : null);

function Figure({ label, trays, tone = 'brand' }: { label: string; trays: number | null; tone?: 'brand' | 'warn' }) {
  return (
    <div className="min-w-0 sm:inline-block sm:px-4 sm:first:pl-0 sm:last:pr-0 sm:border-l sm:border-line-2 sm:first:border-l-0">
      <p className="text-[10.5px] text-muted truncate">{label}</p>
      <p className={clsx('font-mono tnum text-[16px] font-semibold leading-tight mt-0.5',
        trays === null ? 'text-faint' : tone === 'warn' ? 'text-warn' : 'text-brand')}>
        {trays === null ? DASH : fmtIN(trays)}
        {trays !== null && <span className="ml-1 text-[10.5px] font-sans font-normal text-muted">trays</span>}
      </p>
    </div>
  );
}

/** The board's primary UI: one compact line per shed, stacking its own labels on a phone. */
function DayTable({ rows, canPlan, onAdd }: {
  rows: { shed: { id: string; name: string }; plan: ShedDayPlan | null }[];
  canPlan: boolean; onAdd: (shedId: string) => void;
}) {
  return (
    <div>
      <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_5rem_6rem_6.5rem] gap-3 px-4 py-2 bg-sunk/40 border-b border-line font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-2">
        <span>Shed</span>
        <span className="text-right">Available</span>
        <span className="text-right">Booked</span>
        <span className="text-right">Left</span>
        <span className="text-right">Action</span>
      </div>
      <div className="divide-y divide-line-2">
        {rows.map(({ shed, plan: p }) => (
          <div key={shed.id}
            className="grid grid-cols-3 gap-x-3 gap-y-1.5 px-4 py-3 sm:py-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_6rem_6.5rem] sm:gap-3 sm:items-center">
            <div className="col-span-3 sm:col-span-1 flex items-center justify-between gap-3 min-w-0">
              <span className="text-[13px] font-semibold text-ink truncate">{shed.name}</span>
              {canPlan && <BookButton shed={shed.name} onClick={() => onAdd(shed.id)} className="sm:hidden" />}
            </div>
            <Cell label="Available" value={p?.available == null ? null : fmtIN(p.available)} />
            <Cell label="Booked" value={p ? fmtIN(p.booked) : null} />
            <Cell label="Left" value={p?.remaining == null ? null : fmtIN(p.remaining)}
              danger={(p?.shortage ?? 0) > 0} />
            {canPlan && (
              <div className="hidden sm:flex justify-end">
                <BookButton shed={shed.name} onClick={() => onAdd(shed.id)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BookButton({ shed, onClick, className }: { shed: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Book trays from ${shed}`}
      className={clsx('inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[9px] border border-line bg-card',
        'text-[12px] font-semibold text-brand press hover:bg-brand-soft shrink-0', className)}>
      <Plus size={13} /> Book
    </button>
  );
}

function Cell({ label, value, danger }: { label: string; value: string | null; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block sm:hidden font-mono text-[9px] uppercase tracking-[0.12em] text-muted-2">{label}</span>
      <span className={clsx('block sm:text-right font-mono tnum text-[13px] font-semibold',
        value === null ? 'text-faint' : danger ? 'text-warn' : 'text-ink')}>
        {value ?? DASH}
      </span>
    </div>
  );
}

function dateOptions(horizon: string[], keep: string | undefined, today: string) {
  const dates = [...horizon];
  if (keep && !dates.includes(keep)) dates.unshift(keep);
  return dates.map(d => ({ value: d, label: `${dayLabel(d, today)} · ${fmtDate(d)}` }));
}

/** Which batch would be holding this shed on the planned day. Read-only, never chosen. */
function batchHint(code?: string): string | undefined {
  return code ? `Batch on this shed that day: ${code}` : undefined;
}

function Moneyish({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'muted' | 'warn' | 'success' }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className={clsx(tone === 'warn' ? 'text-warn font-semibold' : 'text-muted')}>{label}</span>
      <span className={clsx('font-mono tnum font-semibold',
        tone === 'warn' ? 'text-warn' : tone === 'success' ? 'text-success' : tone === 'muted' ? 'text-faint' : 'text-ink')}>
        {value}
      </span>
    </p>
  );
}

function BookingDetail({ b, shedName, traderName, canPlan, onBoard, onClose, onEdit, onCancel, onSale }: {
  b: EggSaleBooking; shedName: string; traderName: string; canPlan: boolean; onBoard: boolean;
  onClose: () => void; onEdit: () => void; onCancel: () => void; onSale: () => void;
}) {
  const users = useApp(s => s.users);
  const nameOf = (id?: string) => users.find(u => u.id === id)?.name ?? 'Someone';
  return (
    <Dialog open onClose={onClose} title="Booking"
      subtitle={`${fmtDate(b.date)} · ${shedName}`}
      footer={canPlan && b.status === 'PLANNED'
        ? <div className="flex gap-2">
          <Button variant="outline" block icon={<PencilLine size={14} />} onClick={onEdit}>Edit</Button>
          <Button block icon={<Link2 size={14} />} onClick={onSale}>Create sale entry</Button>
        </div>
        : undefined}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-semibold text-ink truncate">{traderName}</p>
          <Badge tone={STATUS_WORD[b.status].tone}>{STATUS_WORD[b.status].label}</Badge>
        </div>
        <div className="rounded-[12px] bg-sunk divide-y divide-line-2">
          <Line label="Shed" value={shedName} />
          <Line label="Planned trays" value={`${fmtIN(b.plannedTrays)} · ${GRADE_WORD[b.grade]}`} mono />
          {b.remarks && <Line label="Remarks" value={b.remarks} />}
          {b.cancelReason && <Line label="Dropped because" value={b.cancelReason} />}
          {b.saleEntryId && <Line label="Sold as" value={fmtDate(b.fulfilledAt?.slice(0, 10) ?? b.date)} mono />}
          <Line label="Planned by" value={`${nameOf(b.createdBy)} · ${fmtDate(b.createdAt.slice(0, 10))}`} />
          {b.updatedAt && <Line label="Last changed" value={`${nameOf(b.updatedBy)} · ${fmtDate(b.updatedAt.slice(0, 10))}`} />}
        </div>
        <p className="text-[11px] text-muted-2 leading-snug">
          A booking plans trays only. Stock, income and the trader balance move when the actual sale entry is saved.
        </p>
        {canPlan && b.status === 'PLANNED' && !onBoard && (
          <p className="text-[12px] text-warn font-medium">
            This date has left the planner window, so the booking can be read but not moved to another day.
          </p>
        )}
        {canPlan && b.status === 'PLANNED' && (
          <Button variant="ghost" size="sm" block icon={<Ban size={14} />} className="text-danger" onClick={onCancel}>
            Cancel this booking
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="flex items-baseline justify-between gap-3 px-3 py-2 text-[12px]">
      <span className="text-muted shrink-0">{label}</span>
      <span className={clsx('text-ink font-semibold text-right min-w-0 break-words', mono && 'font-mono tnum')}>{value}</span>
    </p>
  );
}
