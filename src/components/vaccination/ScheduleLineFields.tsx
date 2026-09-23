import { Field, SelectField, TextArea } from '@/components/ui/Form';
import { daysBetween, shiftDate } from '@/lib/format';
import { VACCINATION_REMINDER_OPTIONS, VACCINATION_ROUTE_OPTIONS } from '@/lib/vaccination';
import type { BirdType, VaccinationDraft, VaccinationItem } from '@/types';

/**
 * The one set of fields a vaccination line carries, whether it is being planned into a
 * batch that does not exist yet or amended on a batch that does. Keeping it here is what
 * lets both paths store the same six values.
 */

export const REMINDER_OPTIONS = VACCINATION_REMINDER_OPTIONS.map(d => ({
  value: String(d),
  label: d === 0 ? 'On the day' : d === 1 ? '1 day before' : d === 7 ? '1 week before' : `${d} days before`,
}));

export const ROUTE_OPTIONS = [
  { value: '', label: '— Not set —' },
  ...VACCINATION_ROUTE_OPTIONS.map(r => ({ value: r, label: r })),
];

export const BIRD_OPTIONS: { value: '' | BirdType; label: string }[] = [
  { value: '', label: 'Any bird' }, { value: 'LAYER', label: 'Layer' }, { value: 'BROILER', label: 'Broiler' },
];

/** The editing shape: optional text as empty strings, so every input stays controlled. */
export interface LineForm {
  vaccineName: string; scheduledDate: string; reminderDaysBefore: number;
  dose: string; route: string; remarks: string;
}

export const blankLine = (scheduledDate: string): LineForm => ({
  vaccineName: '', scheduledDate, reminderDaysBefore: 3, dose: '', route: '', remarks: '',
});

export const lineOf = (i: VaccinationItem | VaccinationDraft): LineForm => ({
  vaccineName: i.vaccineName, scheduledDate: i.scheduledDate, reminderDaysBefore: i.reminderDaysBefore,
  dose: i.dose ?? '', route: i.route ?? '', remarks: i.remarks ?? '',
});

/** Back to the store's shape; blanks become absent, not empty strings. */
export function draftOf(f: LineForm): VaccinationDraft {
  return {
    vaccineName: f.vaccineName.trim(), scheduledDate: f.scheduledDate, reminderDaysBefore: f.reminderDaysBefore,
    dose: f.dose.trim() || undefined, route: f.route.trim() || undefined, remarks: f.remarks.trim() || undefined,
  };
}

/** A new line sits after the last one planned, so a hand-built schedule reads forward. */
export function nextLineDate(placementDate: string, drafts: VaccinationDraft[]): string {
  if (!drafts.length) return shiftDate(placementDate, 7);
  const last = drafts.map(d => daysBetween(placementDate, d.scheduledDate)).sort((a, b) => a - b).at(-1) ?? 0;
  return shiftDate(placementDate, last + 7);
}

export const fail = (r: { error?: string }, fallback: string) => r.error ?? fallback;

/** Where a date falls on the flock's own calendar. */
export function FlockDay({ placementDate, scheduledDate }: { placementDate?: string; scheduledDate: string }) {
  if (!placementDate) return null;
  return <p className="font-mono text-[11px] text-muted tnum">Day {daysBetween(placementDate, scheduledDate)} of this flock</p>;
}

export function LineFields({ value, onChange, placementDate }: {
  value: LineForm; onChange: (patch: Partial<LineForm>) => void; placementDate?: string;
}) {
  return (
    <div className="space-y-3">
      <Field label="Vaccine name" value={value.vaccineName} placeholder="e.g. Newcastle B1"
        onChange={e => onChange({ vaccineName: e.target.value })} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Scheduled date" type="date" value={value.scheduledDate}
          onChange={e => onChange({ scheduledDate: e.target.value })} className="font-mono" />
        <SelectField label="Remind" value={String(value.reminderDaysBefore)}
          onChange={e => onChange({ reminderDaysBefore: Number(e.target.value) })} options={REMINDER_OPTIONS} />
      </div>
      <FlockDay placementDate={placementDate} scheduledDate={value.scheduledDate} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Dose" value={value.dose} placeholder="e.g. 0.5 ml / bird"
          onChange={e => onChange({ dose: e.target.value })} />
        <SelectField label="Route / method" value={value.route}
          onChange={e => onChange({ route: e.target.value })} options={ROUTE_OPTIONS} />
      </div>
      <TextArea label="Remarks" rows={2} value={value.remarks} placeholder="Water withheld 2 h before dosing…"
        onChange={e => onChange({ remarks: e.target.value })} />
    </div>
  );
}
