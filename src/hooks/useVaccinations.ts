import { useMemo } from 'react';
import { useApp, useCompanyData, useCurrentUser } from '@/store/app';
import { todayISO } from '@/lib/format';
import { effectiveCan } from '@/lib/permissions';
import {
  byUrgency, nextVaccination, vaccinationCounts, vaccinationPositions, vaccinationReminders,
  type VaccinationCounts, type VaccinationPosition, type VaccinationReminder,
} from '@/lib/vaccination';
import type { PermissionKey, PermissionSet } from '@/types';

/**
 * One reading of the flock's vaccination plan for every screen that shows it — the major
 * page, a batch, the dashboards and labor's task cards all take their rows and their
 * buttons from here, so a date is never due in one place and upcoming in another.
 *
 * Rights are resolved the same way the store gates its writes: the role's own standing,
 * or what the assignment on that batch grants. A button shown here is a write the store
 * will accept.
 */

/** Only a live flock on a still-open line can be acted on (§16, §17). */
const actionable = (p: VaccinationPosition) => p.batchActive && p.item.status === 'SCHEDULED';

function useVaccinationAccess() {
  const user = useCurrentUser();
  const assignments = useApp(s => s.assignments);
  const { batches } = useCompanyData();

  return useMemo(() => {
    const granted = new Map<string, PermissionSet | undefined>();
    if (user) for (const a of assignments) if (a.userId === user.id) granted.set(a.batchId, a.permissions);
    const held = (batchId: string, key: PermissionKey) =>
      !!user && effectiveCan(user.role, granted.get(batchId), key);

    return {
      canManage: (p: VaccinationPosition) => actionable(p) && held(p.item.batchId, 'manageVaccination'),
      canComplete: (p: VaccinationPosition) => actionable(p) && held(p.item.batchId, 'completeVaccination'),
      /** Live flocks this user may plan: where "Add to schedule" belongs. */
      plannableBatches: batches.filter(b => b.status === 'ACTIVE' && held(b.id, 'manageVaccination')),
    };
  }, [user, assignments, batches]);
}

export interface VaccinationBoard {
  today: string;
  /** Every line in the company, soonest action first. */
  positions: VaccinationPosition[];
  counts: VaccinationCounts;
  /** The dashboard rows for what needs doing — one per open item, never a pile of copies. */
  reminders: VaccinationReminder[];
  canManage: (p: VaccinationPosition) => boolean;
  canComplete: (p: VaccinationPosition) => boolean;
  plannableBatches: ReturnType<typeof useCompanyData>['batches'];
}

export function useVaccinations(): VaccinationBoard {
  const { vaccinations, batches, sheds } = useCompanyData();
  const access = useVaccinationAccess();
  const today = todayISO();

  const positions = useMemo(
    () => byUrgency(vaccinationPositions(vaccinations, batches, sheds, today)),
    [vaccinations, batches, sheds, today],
  );
  const counts = useMemo(() => vaccinationCounts(positions), [positions]);
  const reminders = useMemo(() => vaccinationReminders(positions), [positions]);

  return { today, positions, counts, reminders, ...access };
}

/** One batch's own plan, in the same order, with the dose it is next owed. */
export function useVaccinationSchedule(batchId: string | undefined) {
  const { vaccinations, batches, sheds } = useCompanyData();
  const access = useVaccinationAccess();
  const today = todayISO();

  const positions = useMemo(
    () => byUrgency(vaccinationPositions(
      batchId ? vaccinations.filter(v => v.batchId === batchId) : [], batches, sheds, today,
    )),
    [vaccinations, batches, sheds, batchId, today],
  );
  const counts = useMemo(() => vaccinationCounts(positions), [positions]);
  const next = useMemo(() => nextVaccination(positions), [positions]);
  /** Whether this user may plan a line on this flock — where "Schedule vaccine" belongs. */
  const canAdd = !!batchId && access.plannableBatches.some(b => b.id === batchId);

  return { today, positions, counts, next, canAdd, canManage: access.canManage, canComplete: access.canComplete };
}
