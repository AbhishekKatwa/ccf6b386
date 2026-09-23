import { useState } from 'react';
import { AlertCircle, ChevronDown, Plus, Syringe, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useCompanyData } from '@/store/app';
import { SectionTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { daysBetween, fmtDate, shiftDate } from '@/lib/format';
import { scheduleFromTemplate, templatesForBird } from '@/lib/vaccination';
import { LineFields, blankLine, draftOf, lineOf, nextLineDate, type LineForm } from './ScheduleLineFields';
import type { BirdType, VaccinationDraft, VaccinationTemplate } from '@/types';

/**
 * The vaccination step of batch creation. A template is copied here, line by line, and
 * the resulting dates are saved onto the new batch's own schedule — the batch keeps no
 * link back to the template, so editing a template afterwards cannot reach this flock (§1, §11).
 *
 * Dates are also never moved behind the user's back: if the placement date is corrected
 * after lines exist, the step says so and offers to shift them, rather than silently
 * rewriting a plan that was already typed out.
 */

export function VaccinationPlanStep({ placementDate, birdType, drafts, onChange }: {
  placementDate: string; birdType: BirdType;
  drafts: VaccinationDraft[]; onChange: (next: VaccinationDraft[]) => void;
}) {
  const { vaccinationTemplates } = useCompanyData();
  const templates = templatesForBird(vaccinationTemplates, birdType);
  // The placement the current lines were written against.
  const [anchorDate, setAnchorDate] = useState(placementDate);
  const [expanded, setExpanded] = useState<number | null>(null);

  const drift = daysBetween(anchorDate, placementDate);

  function applyTemplate(t: VaccinationTemplate) {
    onChange(scheduleFromTemplate(t, placementDate));
    setAnchorDate(placementDate);
    setExpanded(null);
  }

  function addLine() {
    const draft = draftOf(blankLine(nextLineDate(placementDate, drafts)));
    onChange([...drafts, draft]);
    setAnchorDate(placementDate);
    setExpanded(drafts.length);
  }

  function patchLine(i: number, patch: Partial<LineForm>) {
    const next = { ...lineOf(drafts[i]), ...patch };
    onChange(drafts.map((d, n) => (n === i ? draftOf(next) : d)));
  }

  function removeLine(i: number) {
    onChange(drafts.filter((_, n) => n !== i));
    setExpanded(null);
  }

  function realign() {
    onChange(drafts.map(d => ({ ...d, scheduledDate: shiftDate(d.scheduledDate, drift) })));
    setAnchorDate(placementDate);
  }

  const last = drafts.at(-1);

  return (
    <div className="pt-1">
      <SectionTitle right={
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addLine}>Create manually</Button>
      }>Vaccination schedule</SectionTitle>

      <p className="text-[11.5px] text-muted leading-relaxed mb-2.5">
        Apply a template or build the plan line by line. These dates are saved with the batch;
        they move only when someone moves them.
      </p>

      {!!templates.length && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
          {templates.map(t => (
            <button key={t.id} type="button" onClick={() => applyTemplate(t)}
              className="flex-none inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-[12px] font-semibold text-ink-2 press hover:border-brand hover:text-brand">
              <Syringe size={12} className="text-brand" />
              {t.name}
              <span className="font-mono text-[10px] text-muted tnum">{t.items.length}</span>
            </button>
          ))}
        </div>
      )}

      {drift !== 0 && drafts.length > 0 && (
        <div className="mb-2.5 flex items-start gap-2 rounded-[12px] bg-warn-soft px-3 py-2.5">
          <AlertCircle size={14} className="text-warn shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold text-warn">
              Placement moved {Math.abs(drift)} day{Math.abs(drift) === 1 ? '' : 's'} — the schedule still points at the old days.
            </p>
            <button type="button" onClick={realign} className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-warn underline press">
              Shift every date {drift > 0 ? 'forward' : 'back'}
            </button>
          </div>
        </div>
      )}

      {!drafts.length ? (
        <div className="rounded-[14px] border border-dashed border-line px-4 py-5 text-center">
          <p className="text-[12.5px] text-muted">No doses planned yet.</p>
          <p className="text-[11.5px] text-muted-2 mt-0.5">
            {templates.length ? 'Apply a template above, or create a line by hand.' : 'The batch can still be placed — add doses later from the Vaccination module.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((d, i) => {
            const open = expanded === i;
            const name = d.vaccineName.trim() || 'New vaccination';
            return (
              <div key={i} className={clsx(
                'rounded-[14px] border bg-card transition-colors',
                open ? 'border-brand/45 shadow-card' : 'border-line',
              )}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => setExpanded(open ? null : i)}
                    aria-expanded={open} className="flex-1 min-w-0 text-left press">
                    <p className="text-[13px] font-semibold text-ink truncate">{name}</p>
                    <p className="font-mono text-[11px] text-muted tnum truncate mt-0.5">
                      {d.scheduledDate ? fmtDate(d.scheduledDate) : 'No date'} · Day {daysBetween(placementDate, d.scheduledDate)}
                    </p>
                  </button>
                  <button type="button" onClick={() => removeLine(i)} aria-label={`Remove ${name}`}
                    className="w-8 h-8 rounded-[10px] text-muted-2 hover:text-danger flex items-center justify-center press shrink-0">
                    <Trash2 size={14} />
                  </button>
                  <ChevronDown size={15} className={clsx('text-muted transition-transform shrink-0', open && 'rotate-180')} />
                </div>
                {open && (
                  <div className="px-3 pb-3 border-t border-line-2 pt-3">
                    <LineFields value={lineOf(d)} onChange={patch => patchLine(i, patch)} placementDate={placementDate} />
                  </div>
                )}
              </div>
            );
          })}
          <p className="font-mono text-[10.5px] text-muted tnum px-0.5">
            {drafts.length} dose{drafts.length === 1 ? '' : 's'} · last on {last ? fmtDate(last.scheduledDate) : '—'}
          </p>
        </div>
      )}
    </div>
  );
}
