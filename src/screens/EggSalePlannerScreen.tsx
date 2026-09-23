import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarRange, Egg, Handshake, Link2, PencilLine, Plus, Ban,
} from 'lucide-react';
import clsx from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Button, ChipGroup, Field, SelectField, TextArea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, EmptyState, GroupList, ListRow, Stat, StatCell, StatStrip } from '@/components/ui/Card';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { daysBetween, fmtDate, fmtIN, safeDate, todayISO } from '@/lib/format';
import { latestFirst } from '@/lib/order';
import { batchOfShedOn } from '@/lib/calc';
import { planSummary, plannerWindow, shedDayPlans, type ShedDayPlan } from '@/lib/planner';
import { EGG_GRADES, type EggBookingStatus, type EggGrade, type EggSaleBooking } from '@/types';

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
  return safeDate(date)?.toLocaleDateString('en-IN', { weekday: 'long' }) ?? fmtDate(date);
}

const traysOf = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
};

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
  const board = useMemo(() => plannerWindow(today), [today]);
  const [showHistory, setShowHistory] = useState(false);
  /** Which booking the sheet holds: null closed, '' a new one, otherwise that record. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<BookingForm | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sheds = useMemo(() => [...data.sheds].sort((a, b) => a.name.localeCompare(b.name)), [data.sheds]);
  /** One walk per shed across the whole window, so each day reads the carried-forward remainder. */
  const byShed = useMemo(() => new Map(sheds.map(sh => [sh.id, shedDayPlans({
    shedId: sh.id, eggs: data.eggs, entries: data.saleEntries, bookings: data.eggSaleBookings, dates: board, today,
  })])), [sheds, data.eggs, data.saleEntries, data.eggSaleBookings, board, today]);

  const shedName = (id: string) => sheds.find(s => s.id === id)?.name ?? '—';
  const traderName = (id: string) => data.traders.find(t => t.id === id)?.name ?? '—';
  const findBooking = (id: string | null) => data.eggSaleBookings.find(b => b.id === id) ?? null;

  const totals = useMemo(() => planSummary([...byShed.values()].flat()), [byShed]);
  const openCount = data.eggSaleBookings.filter(b => b.status === 'PLANNED').length;

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
  const plan = form ? (byShed.get(form.shedId) ?? []).find(p => p.date === form.date) ?? null : null;
  /** Trays promised on this shed and day, with the one being typed on top of the saved ones. */
  const promised = form
    ? (plan?.bookings ?? []).filter(b => b.id !== editing).reduce((s, b) => s + b.plannedTrays, 0) + traysOf(form.trays)
    : 0;
  const shortage = plan?.available == null ? 0 : Math.max(0, promised - plan.available);
  /** The trays that day still has left to promise, once what is typed here is counted. */
  const headroom = plan?.available == null ? 0 : Math.max(0, plan.available - promised);
  const active = detail ? findBooking(detail) : null;

  return (
    <Page withNav>
      <ScreenTitle
        eyebrow="Commerce" title="Egg Sale Planner"
        subtitle="Promise trays to a trader before the load leaves. A booking plans only — it never moves stock, money or a trader balance."
        action={canPlan && sheds.length > 0
          ? <Button size="sm" icon={<Plus size={15} />} onClick={() => openSheet()}>Add booking</Button>
          : undefined}
      />

      <div className="px-4 sm:px-0 mt-1 space-y-4">
        <StatStrip className="bg-card border border-line rounded-[16px] shadow-card">
          <StatCell><Stat label="Promised" value={fmtIN(totals.booked)} sub="trays over 5 days" tone="brand" size="sm" /></StatCell>
          <StatCell><Stat label="Bookings" value={totals.bookings} sub={`${openCount} still open`} size="sm" /></StatCell>
          <StatCell><Stat label="Short days" value={totals.shortDays} sub="promised past forecast" tone={totals.shortDays ? 'warn' : 'neutral'} size="sm" /></StatCell>
        </StatStrip>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-ink">
            {showHistory ? 'All bookings' : `${dayLabel(board[0], today)} → ${dayLabel(board[board.length - 1], today)}`}
          </p>
          <button type="button" onClick={() => setShowHistory(h => !h)}
            className="text-[12px] font-semibold text-brand press hover:underline shrink-0">
            {showHistory ? 'Back to the board' : 'Booking history'}
          </button>
        </div>

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

        {!showHistory && sheds.length > 0 && board.map((date, i) => {
          const dayRows = sheds.map(sh => ({ shed: sh, plan: (byShed.get(sh.id) ?? [])[i] }));
          const booked = dayRows.reduce((s, r) => s + (r.plan?.booked ?? 0), 0);
          const short = dayRows.filter(r => (r.plan?.shortage ?? 0) > 0).length;
          return (
            <section key={date} className="rounded-[18px] border border-line bg-card shadow-card overflow-hidden">
              <header className="flex items-start justify-between gap-3 px-4 py-3 bg-sunk/50 border-b border-line">
                <div className="min-w-0">
                  <p className="font-display text-[15px] font-semibold text-ink leading-tight">{dayLabel(date, today)}</p>
                  <p className="text-[11px] text-muted tnum mt-0.5">{fmtDate(date)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge tone={booked ? 'brand' : 'neutral'}>{fmtIN(booked)} promised</Badge>
                  {short > 0 && <Badge tone="warn">{short} over</Badge>}
                </div>
              </header>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 p-2.5">
                {dayRows.map(({ shed, plan: p }) => (
                  <div key={shed.id} className="min-w-0 rounded-[14px] border border-line-2 bg-card p-3">
                    {p && <ShedDay shedName={shed.name} plan={p} canPlan={canPlan} traderName={traderName}
                      onOpen={setDetail} onAdd={() => openSheet({ date, shedId: shed.id })} />}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {!showHistory && sheds.length > 0 && data.traders.length === 0 && (
          <p className="text-[12px] text-muted bg-sunk rounded-[10px] px-3 py-2">
            No traders are registered for this company yet, so there is nobody to promise a load to.
          </p>
        )}
      </div>

      {/* New / edit booking */}
      <Dialog open={!!form} onClose={closeSheet}
        title={editing ? 'Edit booking' : 'Plan a load'}
        subtitle="A promise of trays to a trader. Nothing here moves stock or books money."
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={closeSheet}>Cancel</Button>
          <Button block onClick={save} disabled={!form?.shedId || !form?.traderId}>Save booking</Button>
        </div>}>
        {form && (
          <div className="space-y-3">
            <SelectField label="Shed" value={form.shedId}
              onChange={e => setForm({ ...form, shedId: e.target.value })}
              options={sheds.map(s => ({ value: s.id, label: s.name }))} />
            <SelectField label="Date" value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
              options={dateOptions(board, editing ? findBooking(editing)?.date : undefined, today)} />
            <SelectField label="Trader" value={form.traderId}
              onChange={e => setForm({ ...form, traderId: e.target.value })}
              options={[{ value: '', label: 'Select trader' }, ...data.traders.map(t => ({ value: t.id, label: t.name }))]} />
            <div>
              <p className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Grade</p>
              <ChipGroup value={form.grade} onChange={g => setForm({ ...form, grade: g })}
                options={EGG_GRADES.map(g => ({ value: g, label: GRADE_WORD[g] }))} />
            </div>
            <Field label="Planned trays" type="number" inputMode="numeric" min={0} step={1}
              value={form.trays} onChange={e => setForm({ ...form, trays: e.target.value })}
              placeholder="0" suffix="trays"
              hint={batchHint(form.shedId ? batchOfShedOn(data.batches, form.shedId, form.date)?.code : undefined)} />
            <TextArea label="Remarks (optional)" rows={2} value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
              placeholder="Vehicle, buyer instruction, split load…" />

            {plan && (
              <div className="rounded-[12px] bg-sunk px-3 py-2.5 space-y-1">
                <Moneyish label={plan.recorded ? 'Collected that day' : 'Projected lay'}
                  value={plan.available === null ? '—' : `${fmtIN(plan.available)} trays`} />
                <Moneyish label="Promised for this shed and day" value={`${fmtIN(promised)} trays`} />
                {plan.available !== null && (
                  <p className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className={clsx(shortage ? 'text-warn font-semibold' : 'text-muted')}>
                      {shortage ? 'Projected shortage' : 'Still unplanned'}
                    </span>
                    <span className={clsx('font-mono tnum font-semibold', shortage ? 'text-warn' : 'text-success')}>
                      {fmtIN(shortage || headroom)} trays
                    </span>
                  </p>
                )}
                <p className="text-[11px] text-muted-2 leading-snug pt-0.5">
                  {plan.available === null
                    ? 'This shed has no collection on record to project from, so no figure is invented. The booking can still be made.'
                    : 'All grades combined. A shortage is a warning, never a block — the eggs may still be laid.'}
                </p>
              </div>
            )}

            {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
          </div>
        )}
      </Dialog>

      {/* One booking */}
      {active && (
        <BookingDetail b={active} shedName={shedName(active.shedId)} traderName={traderName(active.traderId)}
          canPlan={canPlan} onBoard={board.includes(active.date)}
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

function dateOptions(board: string[], keep: string | undefined, today: string) {
  const dates = [...board];
  if (keep && !dates.includes(keep)) dates.unshift(keep);
  return dates.map(d => ({ value: d, label: `${dayLabel(d, today)} · ${fmtDate(d)}` }));
}

/** Which batch would be holding this shed on the planned day. Read-only, never chosen. */
function batchHint(code?: string): string {
  return code ? `Batch on this shed that day: ${code}` : 'No batch is running on this shed for that date yet.';
}

function Moneyish({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-[12px] text-muted">
      <span>{label}</span>
      <span className="font-mono tnum text-ink font-semibold">{value}</span>
    </p>
  );
}

function ShedDay({ shedName, plan, canPlan, traderName, onOpen, onAdd }: {
  shedName: string; plan: ShedDayPlan; canPlan: boolean;
  traderName: (id: string) => string;
  onOpen: (id: string) => void; onAdd: () => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink truncate">{shedName}</p>
          <p className="text-[11px] text-muted tnum mt-0.5 leading-snug">
            {plan.available === null
              ? 'No lay on record to project from'
              : `${fmtIN(plan.available)} trays projected${plan.recorded ? '' : ' · forecast'}`}
          </p>
        </div>
        {canPlan && (
          <button type="button" onClick={onAdd} aria-label={`Plan a load from ${shedName}`}
            className="w-8 h-8 shrink-0 rounded-[9px] border border-line bg-card text-brand flex items-center justify-center press hover:bg-brand-soft">
            <Plus size={15} />
          </button>
        )}
      </div>

      {plan.shortage > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-warn-soft px-2.5 py-1.5 text-[11px] font-semibold text-warn leading-snug">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span className="tnum">Promised {fmtIN(plan.booked)} of {fmtIN(plan.available ?? 0)} projected trays</span>
        </p>
      )}

      {plan.bookings.length === 0
        ? <p className="mt-2 text-[11px] text-muted-2">Nothing promised.</p>
        : (
          <ul className="mt-2 space-y-1.5">
            {plan.bookings.map(b => (
              <li key={b.id}>
                <button type="button" onClick={() => onOpen(b.id)}
                  className="w-full min-w-0 flex items-center gap-2.5 rounded-[11px] border border-line bg-sunk/50 px-2.5 py-2 text-left press hover:bg-sunk">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-ink truncate">{traderName(b.traderId)}</span>
                    <span className="block text-[11px] text-muted tnum">
                      {fmtIN(b.plannedTrays)} {GRADE_WORD[b.grade].toLowerCase()}
                      {b.status === 'FULFILLED' && ' · sold'}
                    </span>
                  </span>
                  {b.status === 'FULFILLED'
                    ? <Badge tone="success">Sold</Badge>
                    : <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
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
