import { ageDaysLabel, daysBetween, fmtDate, shiftDate } from '@/lib/format';
import type {
  Batch, BirdType, Shed, VaccinationDraft, VaccinationItem, VaccinationState, VaccinationTemplate,
} from '@/types';

/**
 * The vaccination reading for one day. Nothing here is stored: a schedule row keeps
 * only its own `status`, and DUE_SOON / DUE_TODAY / OVERDUE are computed from
 * `scheduledDate` against today each time the row is shown. That is what lets a
 * reminder stop the moment a vaccination is completed without a notification table,
 * and why an overdue item keeps showing itself until it is done or cancelled.
 */

/** Kept structurally identical to the design-system `Tone`, so badges need no mapping. */
type Tone = 'brand' | 'accent' | 'success' | 'danger' | 'warn' | 'neutral';

export interface VaccinationStateMeta {
  label: string;
  tone: Tone;
  /** Whether this state belongs in the active reminder counts (§15). */
  pending: boolean;
}

export const VACCINATION_STATE_META: Record<VaccinationState, VaccinationStateMeta> = {
  OVERDUE: { label: 'Overdue', tone: 'danger', pending: true },
  DUE_TODAY: { label: 'Due today', tone: 'warn', pending: true },
  DUE_SOON: { label: 'Due soon', tone: 'accent', pending: true },
  SCHEDULED: { label: 'Scheduled', tone: 'brand', pending: false },
  COMPLETED: { label: 'Completed', tone: 'success', pending: false },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', pending: false },
};

export const VACCINATION_ROUTE_OPTIONS = ['Drinking water', 'Eye drop', 'Injection', 'Spray', 'Inhalation'] as const;

export const VACCINATION_REMINDER_OPTIONS = [0, 1, 3, 7] as const;

/** The stored status plus the calendar, read together. */
export function vaccinationState(item: VaccinationItem, today: string): VaccinationState {
  if (item.status === 'COMPLETED') return 'COMPLETED';
  if (item.status === 'CANCELLED') return 'CANCELLED';
  const toGo = daysUntil(item.scheduledDate, today);
  if (toGo < 0) return 'OVERDUE';
  if (toGo === 0) return 'DUE_TODAY';
  return toGo <= item.reminderDaysBefore ? 'DUE_SOON' : 'SCHEDULED';
}

/** Positive when the date is still ahead, negative once it has passed. */
export function daysUntil(date: string, today: string): number {
  return daysBetween(today, date);
}

export interface VaccinationPosition {
  item: VaccinationItem;
  state: VaccinationState;
  meta: VaccinationStateMeta;
  /** Days to the scheduled date; negative once overdue. */
  toGo: number;
  overdueDays: number;
  batch?: Batch;
  shed?: Shed;
  batchCode: string;
  shedName: string;
  /** A closed batch keeps its schedule as history but stops asking for action (§17). */
  batchActive: boolean;
  /** Completed after the day it was due — the record says both, and says so. */
  late: boolean;
  /** Anything this row should currently pull attention to. */
  attention: boolean;
}

export function vaccinationPositions(
  items: VaccinationItem[],
  batches: Batch[],
  sheds: Shed[],
  today: string,
): VaccinationPosition[] {
  return items.map(item => {
    const state = vaccinationState(item, today);
    const toGo = daysUntil(item.scheduledDate, today);
    const batch = batches.find(b => b.id === item.batchId);
    const shed = sheds.find(s => s.id === (batch?.shedId ?? item.shedId));
    const batchActive = batch?.status === 'ACTIVE';
    return {
      item,
      state,
      meta: VACCINATION_STATE_META[state],
      toGo,
      overdueDays: toGo < 0 ? -toGo : 0,
      batch,
      shed,
      batchCode: batch?.code ?? '—',
      shedName: shed?.name ?? '—',
      batchActive,
      // Completed on a later day than it was scheduled for: both dates stand, and the record says so.
      late: state === 'COMPLETED' && !!item.completedDate
        && daysBetween(item.scheduledDate, item.completedDate) > 0,
      attention: batchActive && VACCINATION_STATE_META[state].pending,
    };
  });
}

/** The order the screens list in — overdue leads, scheduled follows, finished history sits at the back. */
export function byUrgency(positions: VaccinationPosition[]): VaccinationPosition[] {
  const rank = (p: VaccinationPosition) => (p.state === 'COMPLETED' || p.state === 'CANCELLED' ? 2 : p.toGo < 0 ? 0 : 1);
  return [...positions].sort((a, b) => rank(a) - rank(b)
    || (a.state === 'COMPLETED' ? daysBetween(a.item.completedDate ?? '', b.item.completedDate ?? '') : a.toGo - b.toGo)
    || a.item.id.localeCompare(b.item.id));
}

export interface VaccinationCounts {
  overdue: number;
  dueToday: number;
  dueSoon: number;
  /** Everything still ahead of today that has not been done or cancelled. */
  upcoming: number;
  completed: number;
  cancelled: number;
  attention: number;
}

/** Completed and cancelled rows never enter the pending counts (§15). */
export function vaccinationCounts(positions: VaccinationPosition[]): VaccinationCounts {
  const c: VaccinationCounts = {
    overdue: 0, dueToday: 0, dueSoon: 0, upcoming: 0, completed: 0, cancelled: 0, attention: 0,
  };
  for (const p of positions) {
    // What a flock already finished is history, and history reads the same whether or not
    // the batch is still standing (§16).
    if (p.state === 'COMPLETED') { c.completed++; continue; }
    if (p.state === 'CANCELLED') { c.cancelled++; continue; }
    // Only a live flock is owed a dose: a closed batch keeps its open lines as record (§17).
    if (!p.batchActive) continue;
    if (p.state === 'OVERDUE') { c.overdue++; c.attention++; }
    else if (p.state === 'DUE_TODAY') { c.dueToday++; c.attention++; }
    else if (p.state === 'DUE_SOON') { c.dueSoon++; c.upcoming++; c.attention++; }
    else c.upcoming++;
  }
  return c;
}

export function countsSummaryLine(c: VaccinationCounts): string {
  const parts = [
    c.overdue ? `${c.overdue} overdue` : null,
    c.dueToday ? `${c.dueToday} due today` : null,
    c.upcoming ? `${c.upcoming} upcoming` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing pending';
}

/** The next thing the batch is owed: soonest incomplete item still in force. */
export function nextVaccination(positions: VaccinationPosition[]): VaccinationPosition | null {
  const open = positions.filter(p => p.batchActive
    && (p.state === 'OVERDUE' || p.state === 'DUE_TODAY' || p.state === 'DUE_SOON' || p.state === 'SCHEDULED'));
  if (!open.length) return null;
  return open.sort((a, b) => a.toGo - b.toGo || a.item.id.localeCompare(b.item.id))[0];
}

export function isVaccinationOpen(item: VaccinationItem): boolean {
  return item.status === 'SCHEDULED';
}

/** "3 days overdue", "Due today", "in 5 days" — one wording wherever a date is read out. */
export function vaccinationDayLabel(p: VaccinationPosition): string {
  if (p.state === 'OVERDUE') return `${p.overdueDays} ${p.overdueDays === 1 ? 'day' : 'days'} overdue`;
  if (p.state === 'DUE_TODAY') return 'Due today';
  if (p.toGo === 1) return 'Tomorrow';
  return `In ${p.toGo} days`;
}

export interface VaccinationReminder {
  id: string;
  tone: 'danger' | 'warn' | 'accent';
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
}

/**
 * One row per schedule item that needs doing, derived from the item's own state —
 * the same row every time, so a reminder never piles up duplicate records.
 */
export function vaccinationReminders(positions: VaccinationPosition[]): VaccinationReminder[] {
  return byUrgency(positions)
    .filter(p => p.attention)
    .map(p => ({
      id: `vac-${p.item.id}`,
      tone: (p.state === 'OVERDUE' ? 'danger' : p.state === 'DUE_TODAY' ? 'warn' : 'accent') as VaccinationReminder['tone'],
      title: p.state === 'OVERDUE' ? 'Vaccination overdue'
        : p.state === 'DUE_TODAY' ? 'Vaccination due today' : 'Vaccination coming up',
      detail: `${p.batchCode} · ${p.item.vaccineName} · ${vaccinationDayLabel(p)}`,
      actionLabel: p.state === 'OVERDUE' ? 'Attend' : 'Open',
      // A reminder is a notification, never a second scheduler: it lands on the flock's own Health tab.
      to: `/batches/${encodeURIComponent(p.item.batchId)}?tab=health`,
    }));
}

/**
 * A template is copied, never referenced: the day offsets are resolved against this
 * batch's placement date here, and the resulting dates are stored on the batch's own
 * rows. Editing the template afterwards cannot reach back into a placed batch (§11).
 */
export function scheduleFromTemplate(template: VaccinationTemplate, placementDate: string): VaccinationDraft[] {
  return template.items.map(i => ({
    vaccineName: i.vaccineName,
    scheduledDate: shiftDate(placementDate, i.relativeDay),
    reminderDaysBefore: i.reminderDaysBefore,
    dose: i.dose,
    route: i.route,
    remarks: i.remarks,
  }));
}

/** Templates are offered by bird type first, but a blank-type one fits any batch. */
export function templatesForBird(templates: VaccinationTemplate[], birdType: BirdType): VaccinationTemplate[] {
  return templates.filter(t => t.active && (!t.birdType || t.birdType === birdType));
}

export function fmtScheduled(item: VaccinationItem): string {
  return `${fmtDate(item.scheduledDate)} · ${ageDaysLabel(item.relativeDay)}`;
}
