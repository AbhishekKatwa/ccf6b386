import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, ClipboardList } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Alerts and Tasks collapsed into one dashboard control. Each button carries its own
 * open-item count the way a notification bell does, so the home screen says what is
 * outstanding before either page is opened. Counts come from the same rules those
 * pages show, never from a number this component invents.
 */

const TILE: Record<'danger' | 'brand', string> = {
  danger: 'bg-danger-soft text-danger',
  brand: 'bg-brand-soft text-brand',
};

const BADGE: Record<'clear' | 'danger' | 'brand', string> = {
  clear: 'bg-sunk text-muted-2',
  danger: 'bg-danger text-white',
  brand: 'bg-brand text-white',
};

function OpenButton({ to, label, count, icon, tone }: {
  to: string; label: string; count: number; icon: ReactNode; tone: 'danger' | 'brand';
}) {
  const nav = useNavigate();
  const open = count > 0;
  return (
    <button type="button" onClick={() => nav(to)}
      className="flex items-center gap-2.5 min-w-0 rounded-card border border-line bg-card shadow-card px-3 py-2.5 text-left press hover:bg-sunk">
      <span className={clsx('w-8 h-8 rounded-[10px] grid place-items-center shrink-0', open ? TILE[tone] : 'bg-sunk text-muted-2')}>
        {icon}
      </span>
      <span className="flex-1 min-w-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted truncate">
        {label}
      </span>
      <span aria-label={`${count} open`}
        className={clsx('shrink-0 min-w-[24px] h-6 px-1.5 grid place-items-center rounded-full font-mono text-[11.5px] font-semibold tnum',
          !open ? BADGE.clear : tone === 'danger' ? BADGE.danger : BADGE.brand)}>
        {count}
      </span>
    </button>
  );
}

/** A section is left out entirely when the signed-in role does not reach that page. */
export function AttentionButtons({ alerts, tasks }: { alerts?: number; tasks?: number }) {
  if (alerts === undefined && tasks === undefined) return null;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {alerts !== undefined && (
        <OpenButton to="/alerts" label="Alerts" count={alerts} tone="danger" icon={<BellRing size={16} />} />
      )}
      {tasks !== undefined && (
        <OpenButton to="/tasks" label="Tasks" count={tasks} tone="brand" icon={<ClipboardList size={16} />} />
      )}
    </div>
  );
}
