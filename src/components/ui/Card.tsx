import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { TrendingDown, TrendingUp, Minus, CheckCircle2, Inbox } from 'lucide-react';
import { HoverCard, SectionReveal, ScrollReveal } from '@/components/motion';

/* ---------------- surfaces ---------------- */

export function Card({ children, className, padded = true, hover = false }: { children: ReactNode; className?: string; padded?: boolean; hover?: boolean }) {
  const inner = (
    <div className={clsx('bg-card border border-line rounded-[18px] shadow-card', padded && 'p-4', className)}>
      {children}
    </div>
  );
  return hover ? <HoverCard>{inner}</HoverCard> : inner;
}

/** Open, borderless grouping surface — use when a card would add noise. */
export function Surface({ children, className, reveal = false }: { children: ReactNode; className?: string; reveal?: boolean }) {
  const inner = <section className={clsx('rounded-[18px] bg-card border border-line shadow-card', className)}>{children}</section>;
  return reveal ? <SectionReveal>{inner}</SectionReveal> : inner;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2 px-0.5">
      <h3 className="min-w-0 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted truncate">{children}</h3>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx('h-px bg-line-2', className)} />;
}

/* ---------------- rows / key-value ---------------- */

export function Row({ label, value, valueClass, mono = true, danger, success }: {
  label: string; value: ReactNode; valueClass?: string; mono?: boolean; danger?: boolean; success?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-line-2 last:border-0 last:pb-0 first:pt-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className={clsx(
        'text-[13px] font-semibold tnum text-right',
        mono && 'font-mono',
        danger ? 'text-danger' : success ? 'text-success' : 'text-ink',
        valueClass,
      )}>{value}</span>
    </div>
  );
}

/* ---------------- metrics ---------------- */

export type Tone = 'brand' | 'accent' | 'success' | 'danger' | 'warn' | 'neutral';

const tonePanel: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  accent: 'bg-accent-soft text-accent-ink',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-sunk text-ink',
};
const toneText: Record<Tone, string> = {
  brand: 'text-brand', accent: 'text-accent-ink', success: 'text-success',
  danger: 'text-danger', warn: 'text-warn', neutral: 'text-ink',
};

export function KPI({ label, value, sub, tone = 'brand', icon }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'navy' | 'amber' | 'success' | 'danger' | 'neutral' | Tone; icon?: ReactNode;
}) {
  const t = (tone === 'navy' ? 'brand' : tone === 'amber' ? 'accent' : tone) as Tone;
  return (
    <div className={clsx('rounded-[14px] px-3.5 py-3', tonePanel[t])}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{label}</p>
        {icon}
      </div>
      <p className="font-display text-[22px] leading-7 font-semibold tnum mt-1 truncate">{value}</p>
      {sub && <p className="text-[11px] opacity-70 mt-0.5 truncate tnum">{sub}</p>}
    </div>
  );
}

/** Open (borderless) hero metric — for dominant numbers. */
export function Stat({ label, value, sub, tone = 'neutral', size = 'md' }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const sizes = {
    sm: 'text-lg leading-6', md: 'text-2xl leading-8', lg: 'text-[32px] leading-9', xl: 'text-[44px] leading-[48px]',
  };
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={clsx('font-display font-semibold tnum tracking-tight mt-1', sizes[size], toneText[tone])}>{value}</p>
      {sub && <div className="text-[11px] text-muted mt-1 tnum">{sub}</div>}
    </div>
  );
}

/** Band of open stats: stacked with hairlines on mobile, one horizontal row from `sm` up. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('grid grid-cols-1 divide-y divide-line-2 sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0', className)}>
      {children}
    </div>
  );
}

export function StatCell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-4 py-3 min-w-0 sm:first:pl-0 sm:last:pr-0 sm:min-w-[96px]', className)}>{children}</div>;
}

/** Compact metric tile for the responsive KPI grids at the top of a command screen. */
export function KpiCard({ label, value, unit, foot, footTone = 'muted', valueTone }: {
  label: string; value: string; unit?: string; foot?: ReactNode; footTone?: 'muted' | 'success' | 'danger' | 'warn';
  /** A figure that is itself the alarm (a loss, a negative stock) says so in its own colour. */
  valueTone?: 'ink' | 'success' | 'danger' | 'warn';
}) {
  const footToneClass = { muted: 'text-muted', success: 'text-success', danger: 'text-danger', warn: 'text-warn' }[footTone];
  const valueToneClass = { ink: 'text-ink', success: 'text-success', danger: 'text-danger', warn: 'text-warn' }[valueTone ?? 'ink'];
  return (
    <div className="rounded-card border border-line bg-card shadow-card px-4 py-3.5 min-w-0">
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted truncate">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1 min-w-0">
        <span className={clsx('font-display text-[21px] leading-7 font-semibold tnum tracking-tight truncate', valueToneClass)}>{value}</span>
        {unit && <span className="text-[11px] text-muted shrink-0">{unit}</span>}
      </p>
      <p className={`mt-1 font-mono text-[10px] tnum truncate ${footToneClass}`}>{foot ?? '—'}</p>
    </div>
  );
}

/** Directional change indicator. */
export function Delta({ value, invert = false, suffix = '' }: { value: number; invert?: boolean; suffix?: string }) {
  const good = invert ? value < 0 : value > 0;
  const flat = value === 0;
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 font-mono text-[11px] font-semibold tnum',
      flat ? 'text-muted' : good ? 'text-success' : 'text-danger',
    )}>
      <Icon size={12} strokeWidth={2.5} />
      {flat ? '0' : Math.abs(value).toLocaleString('en-IN')}{suffix}
    </span>
  );
}

/* ---------------- badges / identity ---------------- */

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]', tonePanel[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: 'LIVE' | 'CLOSED' | 'PLANNED' | 'ACTIVE' | 'IDLE' | 'MAINTENANCE' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'PAID' | 'PARTIAL' }) {
  const map: Record<string, { tone: Tone; label: string; pulse?: boolean }> = {
    LIVE: { tone: 'success', label: 'Live', pulse: true },
    ACTIVE: { tone: 'success', label: 'Active' },
    COMPLETED: { tone: 'success', label: 'Done' },
    PAID: { tone: 'success', label: 'Paid' },
    IN_PROGRESS: { tone: 'accent', label: 'In progress' },
    PARTIAL: { tone: 'accent', label: 'Partial' },
    PLANNED: { tone: 'brand', label: 'Planned' },
    PENDING: { tone: 'brand', label: 'Pending' },
    IDLE: { tone: 'neutral', label: 'Idle' },
    SKIPPED: { tone: 'neutral', label: 'Skipped' },
    CLOSED: { tone: 'neutral', label: 'Closed' },
    MAINTENANCE: { tone: 'danger', label: 'Maintenance' },
  };
  const m = map[status] ?? { tone: 'neutral' as Tone, label: status };
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]', tonePanel[m.tone])}>
      {m.pulse
        ? <span className="relative flex w-1.5 h-1.5"><span className="absolute inline-flex w-full h-full rounded-full bg-success opacity-60 animate-ping" /><span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-success" /></span>
        : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {m.label}
    </span>
  );
}

export function PermissionChip({ active, label }: { active: boolean; label: string }) {
  const on: Record<string, string> = {
    Create: 'bg-success-soft text-success', Update: 'bg-brand-soft text-brand', Delete: 'bg-danger-soft text-danger',
  };
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]',
      active ? (on[label] ?? 'bg-brand-soft text-brand') : 'bg-sunk text-muted-2 line-through',
    )}>
      {label}
    </span>
  );
}

export function Avatar({ name, initials: ini, size = 36, tone = 'brand' }: { name?: string; initials?: string; size?: number; tone?: Tone }) {
  const text = (ini ?? (name ?? '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')) || '?';
  return (
    <span
      className={clsx('inline-flex items-center justify-center rounded-full font-display font-semibold shrink-0', tonePanel[tone])}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-label={name}
    >{text}</span>
  );
}

export function IconTile({ children, tone = 'brand', size = 40 }: { children: ReactNode; tone?: Tone; size?: number }) {
  return (
    <span className={clsx('inline-flex items-center justify-center rounded-[12px] shrink-0', tonePanel[tone])} style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

/* ---------------- lists ---------------- */

export function GroupList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-card border border-line rounded-[18px] shadow-card divide-y divide-line-2 overflow-hidden', className)}>
      {children}
    </div>
  );
}

export function ListRow({ leading, title, subtitle, chips, trailing, onClick, className }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; chips?: ReactNode; trailing?: ReactNode; onClick?: () => void; className?: string;
}) {
  // A row may carry its own buttons in `trailing`, so a clickable row is a div
  // with button semantics rather than a <button> nesting invalid controls.
  const activate = onClick ? {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    },
  } : {};
  return (
    <div
      {...activate}
      className={clsx(
        'flex w-full items-center gap-3 px-4 py-3 text-left',
        onClick && 'group press ring-focus hover:bg-sunk/60 focus-visible:bg-sunk/60 cursor-pointer',
        className,
      )}
    >
      {leading}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-ink truncate">{title}</div>
        {subtitle && <div className="text-[12px] text-muted truncate mt-0.5 tnum">{subtitle}</div>}
        {chips && <div className="mt-1.5 flex flex-wrap items-center gap-1">{chips}</div>}
      </div>
      {trailing}
    </div>
  );
}

/* ---------------- states ---------------- */

export function EmptyState({ icon, title, description, action }: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <ScrollReveal className="rounded-[18px] border border-dashed border-line bg-card/60 px-6 py-10 flex flex-col items-center text-center gap-2">
      <div className="w-12 h-12 rounded-full bg-sunk flex items-center justify-center text-muted mb-1 animate-[float_4s_ease-in-out_infinite]">
        {icon ?? <Inbox size={19} strokeWidth={1.75} />}
      </div>
      <p className="font-display text-[17px] font-semibold text-ink">{title}</p>
      {description && <p className="text-[13px] text-muted max-w-[300px] leading-relaxed">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </ScrollReveal>
  );
}

export function AllClear({ title = 'All clear', description = 'Nothing needs your attention right now.' }: { title?: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-success-soft px-4 py-3 ap-fade-in">
      <CheckCircle2 size={18} className="text-success shrink-0" />
      <div>
        <p className="text-[13px] font-semibold text-success">{title}</p>
        <p className="text-[12px] text-success/80">{description}</p>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('rounded-[12px] ap-shimmer', className)} />;
}
