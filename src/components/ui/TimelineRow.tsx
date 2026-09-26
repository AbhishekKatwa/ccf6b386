import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, ChevronRight, Egg, Pill, Receipt, ShoppingCart, Sprout, Syringe, Wallet, Wheat,
} from 'lucide-react';
import type { TimelineCategory, TimelineEvent } from '@/lib/timeline';

/** Category colour lives here; the wording of a line lives in `lib/timeline`. */
const TONE: Record<TimelineCategory, string> = {
  eggs: 'bg-accent-soft text-accent-ink',
  feed: 'bg-brand-soft text-brand',
  medicine: 'bg-info-soft text-info',
  sales: 'bg-warn-soft text-warn',
  finance: 'bg-sunk text-ink-2',
  farm: 'bg-sunk text-muted',
  audit: 'bg-sunk text-muted-2',
};

const ICON: Record<TimelineCategory, ReactNode> = {
  eggs: <Egg size={12} />,
  feed: <Wheat size={12} />,
  medicine: <Pill size={12} />,
  sales: <ShoppingCart size={12} />,
  finance: <Wallet size={12} />,
  farm: <Sprout size={12} />,
  audit: <Activity size={12} />,
};

/** A dose is flock work wearing medicine's colour, so it reads as its own thing. */
const isVaccination = (e: TimelineEvent) => e.title.startsWith('Vaccination');

/**
 * One line of the farm's day. The time, then the record, then who stood behind it; a line
 * whose record has a screen opens that screen. Historical lines are drawn once — they never
 * move again.
 */
export function TimelineRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const nav = useNavigate();
  const open = event.to ? () => nav(event.to!) : null;
  const meta = [event.by, event.shedLabel, event.batchLabel].filter(Boolean).join(' · ');

  const body = (
    <>
      <span className="w-[46px] shrink-0 pt-[3px] font-mono text-[11px] font-semibold text-muted-2 tnum">
        {event.clock ?? '—'}
      </span>
      <span className="relative flex shrink-0 flex-col items-center pt-0.5">
        <span className={`z-10 flex h-[23px] w-[23px] items-center justify-center rounded-full border border-line ${TONE[event.category]}`}>
          {isVaccination(event) ? <Syringe size={12} /> : ICON[event.category]}
        </span>
        {!last && <span className="absolute top-[23px] bottom-[-14px] w-px bg-line-2" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-snug text-ink">{event.title}</span>
        {event.detail && (
          <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-muted tnum">{event.detail}</span>
        )}
        {meta && (
          <span className="mt-0.5 block truncate text-[10.5px] text-faint">{meta}</span>
        )}
      </span>
      {open && (
        <ChevronRight size={15} className="mt-0.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
      )}
    </>
  );

  const row = 'group flex w-full items-start gap-2.5 px-1 py-[5px] text-left';
  return open
    ? <button type="button" onClick={open} className={`${row} press hover:bg-brand-soft/40`}>{body}</button>
    : <div className={row}>{body}</div>;
}
