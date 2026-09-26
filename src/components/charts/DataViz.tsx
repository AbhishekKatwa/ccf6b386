import { useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { CHART } from '@/components/ui/Charts';
import { ChartReveal, MOTION, useReveal } from '@/components/motion';
import { fmtDateShort } from '@/lib/format';

/**
 * The graphs the owner dashboard is built from. They are deliberately dumb: every
 * number arrives already derived by `lib/analytics`, and a `null` in a series is a
 * day with no record — drawn as a break in the line, never as a zero.
 */

export type VPoint = {
  date: string; value: number | null;
  /** Set when a point stands for a bucket rather than a day, e.g. “Sep 26”. */
  label?: string;
};
export type VSeries = {
  id: string; label: string; color: string; points: VPoint[];
  /** Secondary series read better as a guide line than as a filled area. */
  dashed?: boolean; area?: boolean;
};

/** Green leads, gold highlights, teal supports, red only ever means negative. */
export const SERIES_COLORS = [CHART.brand, CHART.accent, CHART.teal, CHART.danger, '#5b6b7a'];

/** Axis ticks in the units an Indian farm actually reads: k, L, Cr. */
export function axisNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(abs >= 1e8 ? 1 : 2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(abs >= 1e6 ? 1 : 2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return `${sign}${Number(abs.toFixed(abs < 10 && abs % 1 !== 0 ? 1 : 0))}`;
}

export function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted">
          <span className="w-2.5 h-[3px] rounded-full" style={{ background: it.color, opacity: it.dashed ? 0.55 : 1 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ============================= TREND (LINE) ============================= */

const W = 320;

function extent(series: VSeries[], zeroBase: boolean): { min: number; max: number } {
  const vals = series.flatMap(s => s.points.map(p => p.value)).filter((v): v is number => v !== null);
  if (!vals.length) return { min: 0, max: 1 };
  let min = Math.min(...vals), max = Math.max(...vals);
  if (zeroBase && min >= 0) min = 0;
  if (min === 0 && max === 0) return { min: 0, max: 1 };
  if (min === max) { min = Math.min(0, min); max = max * 1.2; }
  const pad = (max - min) * 0.12;
  return { min: min - (zeroBase && min === 0 ? 0 : pad), max: max + pad };
}

/**
 * Multi-series trend with gaps, grid, an axis gutter and a touch/hover readout.
 * `onPick` turns the focused day into a drill-down; without it the chart only reads.
 */
export function TrendChart({ series, height = 190, format = axisNum, zeroBase = true, onPick, pickLabel, footnote }: {
  series: VSeries[]; height?: number; format?: (v: number, s: VSeries) => string;
  zeroBase?: boolean; onPick?: (date: string) => void; pickLabel?: (date: string) => string; footnote?: string;
}) {
  const clip = useId().replace(/:/g, '');
  const [idx, setIdx] = useState<number | null>(null);
  const primary = series[0];
  const days = useMemo(() => (primary?.points ?? []).map(p => p.date), [primary]);
  const { min, max } = useMemo(() => extent(series, zeroBase), [series, zeroBase]);
  if (!days.length) return null;

  const h = height;
  const step = days.length > 1 ? W / (days.length - 1) : W;
  const y = (v: number) => h - ((v - min) / (max - min || 1)) * h;
  const active = idx ?? days.length - 1;
  // A bucketed series names its own slot; a daily one is read by its date.
  const bucketed = series.some(s => s.points.some(p => p.label));
  const slotLabel = (i: number) => primary?.points[i]?.label ?? fmtDateShort(days[i] ?? '');
  // A two-slot graph has no middle, so its date is told once rather than twice.
  const dateTicks = Array.from(new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]));
  // A series with nothing recorded on this slot has nothing to say; an absent line point already shows that.
  const readout = series.map(s => ({ s, v: s.points[active]?.value }))
    .filter((x): x is { s: VSeries; v: number } => x.v !== null && x.v !== undefined);

  const track = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setIdx(Math.max(0, Math.min(days.length - 1, Math.round(ratio * (days.length - 1)))));
  };
  const nudge = (delta: number) => setIdx(Math.max(0, Math.min(days.length - 1, (idx ?? days.length - 1) + delta)));

  const ticks = [3, 2, 1, 0].map(i => min + ((max - min) * i) / 3);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 mb-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{idx === null ? (bucketed ? 'Latest period' : 'Latest day') : (bucketed ? 'Selected period' : 'Selected day')}</p>
          <p className="font-display text-[15px] font-semibold text-ink tnum mt-0.5">{slotLabel(active)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {readout.length ? readout.map(({ s, v }) => (
            <span key={s.id} className="inline-flex items-baseline gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: s.color }} />
              <span className="font-mono text-[10px] text-muted uppercase tracking-[0.08em]">{s.label}</span>
              <span className="font-display text-[17px] font-semibold tnum" style={{ color: s.color }}>
                {format(v, s)}
              </span>
            </span>
          )) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">Nothing recorded</span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="w-9 shrink-0 flex flex-col justify-between py-[2px] text-right" style={{ height: h }} aria-hidden>
          {ticks.map((t, i) => <span key={i} className="font-mono text-[9px] text-muted-2 tnum leading-none">{axisNum(t)}</span>)}
        </div>
        <ChartReveal className="relative flex-1">
          <svg
            width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none"
            className="overflow-visible touch-none cursor-crosshair block"
            onPointerMove={track} onPointerDown={track} onPointerLeave={() => setIdx(null)}
            tabIndex={0} role="img"
            aria-label={`Trend from ${slotLabel(0)} to ${slotLabel(days.length - 1)}: ${series.map(s => s.label).join(', ')}`}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
            }}
          >
            {ticks.map((t, i) => (
              <line key={i} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray={i === ticks.length - 1 ? undefined : '2 4'} />
            ))}
            {min < 0 && max > 0 && (
              <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke={CHART.muted} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            )}
            {series.map(s => {
              // Contiguous runs of days that carry a record; a null ends a run so the line breaks.
              const runs: { from: number; to: number; pts: string }[] = [];
              const recorded: { i: number; v: number }[] = [];
              let from = -1;
              let pts: string[] = [];
              const flush = () => {
                if (from >= 0 && pts.length > 1) runs.push({ from, to: from + pts.length - 1, pts: pts.join(' ') });
                from = -1;
                pts = [];
              };
              s.points.forEach((p, i) => {
                if (p.value === null) { flush(); return; }
                if (from < 0) from = i;
                recorded.push({ i, v: p.value });
                pts.push(`${i * step},${y(p.value)}`);
              });
              flush();
              const first = recorded[0];
              const last = recorded[recorded.length - 1];
              return (
                <g key={s.id} clipPath={s.area ? `url(#c${clip})` : undefined}>
                  {s.area && runs.map((r, i) => (
                    <polygon key={`a${i}`} points={`${r.from * step},${h} ${r.pts} ${r.to * step},${h}`}
                      fill={s.color} fillOpacity="0.1" />
                  ))}
                  {runs.map((r, i) => (
                    <polyline key={i} points={r.pts} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2}
                      strokeDasharray={s.dashed ? '4 4' : undefined} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  ))}
                  {first && (
                    <circle cx={first.i * step} cy={y(first.v)} r={last === first ? 3 : 2} fill={s.color} vectorEffect="non-scaling-stroke" />
                  )}
                  {last && last !== first && (
                    <circle cx={last.i * step} cy={y(last.v)} r="2.5" fill={s.color} stroke="var(--color-card)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  )}
                </g>
              );
            })}
            <line x1={active * step} x2={active * step} y1="0" y2={h} stroke={primary?.color ?? CHART.brand} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {series.map(s => {
              const v = s.points[active]?.value;
              if (v === null || v === undefined) return null;
              return <circle key={`p${s.id}`} cx={active * step} cy={y(v)} r="3.5" fill={s.color} stroke="var(--color-card)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />;
            })}
            <defs>
              <clipPath id={`c${clip}`}><rect x="0" y="0" width={W} height={h} /></clipPath>
            </defs>
          </svg>
        </ChartReveal>
      </div>

      <div className="flex justify-between pl-11 mt-1.5">
        {dateTicks.map((i, k) => (
          <span key={i} className={clsx('font-mono text-[9px] text-muted-2 tnum', dateTicks.length === 3 && k === 1 && 'text-center')}>{slotLabel(i)}</span>
        ))}
      </div>

      {onPick && (
        <button type="button" onClick={() => onPick(days[active])}
          className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-semibold text-brand press">
          {pickLabel ? pickLabel(days[active]) : bucketed ? 'Open this period' : 'Open this day'} <ChevronRight size={13} />
        </button>
      )}
      {footnote && <p className="mt-2 text-[11px] text-muted leading-snug">{footnote}</p>}
    </div>
  );
}

/* ============================= VERTICAL BARS ============================= */

export type VBar = { id: string; label: string; value: number | null; hint?: string; color?: string };

/** Category bars — one shed, one ingredient, one day. A click opens its record. */
export function BarSeries({ bars, height = 140, format = axisNum, onPick, color = CHART.brand }: {
  bars: VBar[]; height?: number; format?: (v: number) => string; onPick?: (id: string) => void; color?: string;
}) {
  const { ref, show, reduced } = useReveal();
  const max = Math.max(...bars.map(b => Math.abs(b.value ?? 0)), 0);
  if (!bars.length) return null;
  const showValues = bars.length <= 7;
  return (
    <div ref={ref}>
      <div className="flex items-end gap-2" style={{ height }}>
        {bars.map((b, i) => {
          const zero = b.value === 0;
          const pct = max > 0 && b.value !== null ? (Math.abs(b.value) / max) * 100 : 0;
          const inner = (
            <>
              <span className="w-full flex-1 flex items-end">
                <motion.span
                  className="w-full rounded-t-[6px] transition-[height,opacity] duration-300"
                  initial={reduced ? false : { scaleY: 0 }}
                  animate={{ scaleY: show ? 1 : 0 }}
                  transition={reduced ? { duration: 0 } : { ...MOTION.page, delay: Math.min(i, 12) * 0.03 }}
                  style={{
                    transformOrigin: 'bottom',
                    height: zero ? '3px' : `${pct}%`,
                    background: b.value === null ? 'transparent' : (b.color ?? color),
                    border: b.value === null ? '1px dashed var(--color-line)' : undefined,
                    opacity: b.value === null ? 1 : zero ? 0.45 : 0.92,
                  }}
                />
              </span>
              {showValues && (
                <span className="font-mono text-[10px] text-ink-2 tnum leading-none pb-1">
                  {b.value === null ? '—' : format(b.value)}
                </span>
              )}
            </>
          );
          const label = (
            <span className="block font-mono text-[9px] uppercase tracking-[0.06em] text-muted truncate pt-1.5">{b.label}</span>
          );
          return onPick ? (
            <button key={b.id} type="button" onClick={() => onPick(b.id)} title={`${b.label}: ${b.value === null ? 'no record' : format(b.value)}${b.hint ? ` · ${b.hint}` : ''}`}
              className="flex-1 min-w-0 h-full flex flex-col justify-end items-stretch press rounded-[8px] hover:bg-sunk/70 text-left">
              {inner}{label}
            </button>
          ) : (
            <div key={b.id} className="flex-1 min-w-0 h-full flex flex-col justify-end items-stretch"
              title={`${b.label}: ${b.value === null ? 'no record' : format(b.value)}${b.hint ? ` · ${b.hint}` : ''}`}>
              {inner}{label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================= HORIZONTAL BARS ============================= */

export type HRow = {
  id: string; label: string; value: number; display?: string; sub?: string;
  tone?: 'normal' | 'success' | 'warn' | 'danger' | 'muted';
};

const rowTone: Record<NonNullable<HRow['tone']>, { bar: string; text: string }> = {
  normal: { bar: CHART.brand, text: 'text-ink' },
  success: { bar: CHART.success, text: 'text-success' },
  warn: { bar: CHART.accent, text: 'text-warn' },
  danger: { bar: CHART.danger, text: 'text-danger' },
  muted: { bar: CHART.muted, text: 'text-muted' },
};

/** Ranked list you can read at a glance — traders, ingredients, damage by shed. */
export function HBarList({ rows, format = axisNum, onPick, caption }: {
  rows: HRow[]; format?: (v: number) => string; onPick?: (id: string, label: string) => void; caption?: string;
}) {
  const { ref, show, reduced } = useReveal();
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 0);
  if (!rows.length) return null;
  return (
    <div ref={ref}>
      <div className="divide-y divide-line-2 -my-1">
        {rows.map((r, i) => {
          const tone = rowTone[r.tone ?? 'normal'];
          const zero = r.value === 0;
          const width = max > 0 ? Math.max(2, (Math.abs(r.value) / max) * 100) : 0;
          const body = (
            <>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold text-ink truncate">{r.label}</span>
                {r.sub && <span className="block font-mono text-[10px] text-muted truncate mt-0.5 tnum">{r.sub}</span>}
                <span className="mt-1.5 flex h-1.5 rounded-full bg-sunk overflow-hidden">
                  <motion.span
                    className="h-full rounded-full"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: show ? 1 : 0 }}
                    transition={reduced ? { duration: 0 } : { ...MOTION.page, delay: Math.min(i, 10) * 0.04 }}
                    style={{ transformOrigin: 'left', ...(zero
                      ? { width: 4, background: tone.bar, opacity: 0.5 }
                      : { width: `${width}%`, background: tone.bar }) }}
                  />
                </span>
              </span>
              <span className="shrink-0 pl-3 text-right">
                <span className={clsx('font-display text-[15px] font-semibold tnum block', tone.text)}>
                  {r.display ?? format(r.value)}
                </span>
                {onPick && <ChevronRight size={13} className="text-faint inline -mt-4" />}
              </span>
            </>
          );
          return onPick ? (
            <button key={r.id} type="button" onClick={() => onPick(r.id, r.label)}
              className="w-full flex items-start gap-3 py-2.5 text-left press hover:bg-sunk/50 rounded-[10px]">
              {body}
            </button>
          ) : (
            <div key={r.id} className="flex items-start gap-3 py-2.5">{body}</div>
          );
        })}
      </div>
      {caption && <p className="mt-2 text-[11px] text-muted leading-snug">{caption}</p>}
    </div>
  );
}

/* ============================= DONUT ============================= */

export type Slice = { label: string; value: number; color: string };

/** Only worth using for a handful of real categories; otherwise a bar list reads better. */
export function DonutChart({ slices, format = axisNum, centerLabel }: {
  slices: Slice[]; format?: (v: number) => string; centerLabel?: string;
}) {
  const { ref, show, reduced } = useReveal();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (!slices.length) return null;
  // Recorded but all zero: show the ring as an empty track and the legend as-is, never a blank card.
  const empty = total <= 0;
  const r = 42, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4" ref={ref}>
      <motion.svg
        width="104" height="104" viewBox="0 0 104 104" className="shrink-0" role="img" aria-label={slices.map(s => `${s.label} ${format(s.value)}`).join(', ')}
        initial={reduced ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: show ? 1 : 0, scale: show ? 1 : 0.94 }}
        transition={reduced ? { duration: 0 } : MOTION.page}
      >
        {empty && (
          <circle cx="52" cy="52" r={r} fill="none" stroke="var(--color-line)" strokeWidth="13" strokeDasharray="3 5" />
        )}
        <g transform="rotate(-90 52 52)">
          {!empty && slices.map(s => {
            const share = Math.max(0, s.value) / total;
            const dash = `${c * share} ${c * (1 - share)}`;
            const offset = -c * acc;
            acc += share;
            return <circle key={s.label} cx="52" cy="52" r={r} fill="none" stroke={s.color} strokeWidth="13" strokeDasharray={dash} strokeDashoffset={offset} />;
          })}
        </g>
        <text x="52" y="49" textAnchor="middle" fontSize="11" fontWeight="600" fill={empty ? CHART.muted : CHART.brand} fontFamily="var(--font-mono)">
          {format(total)}
        </text>
        {centerLabel && (
          <text x="52" y="62" textAnchor="middle" fontSize="8" fill={CHART.muted} fontFamily="var(--font-mono)">
            {centerLabel.toUpperCase()}
          </text>
        )}
      </motion.svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map(s => (
          <li key={s.label} className="flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color, opacity: empty ? 0.4 : 1 }} />
            <span className="flex-1 truncate text-ink-2">{s.label}</span>
            <span className="font-mono text-muted tnum shrink-0">{format(s.value)}</span>
            <span className="font-mono text-faint text-[10px] tnum w-9 text-right shrink-0">{empty ? '—' : `${Math.round((s.value / total) * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================= GROUPED BARS (P&L) ============================= */

/** Revenue against expense, bucket by bucket, with the net line on top. */
export function PairedBars({ buckets, format = axisNum, height = 160 }: {
  buckets: { label: string; revenue: number | null; expense: number | null; net: number | null }[];
  format?: (v: number) => string; height?: number;
}) {
  const { ref, show, reduced } = useReveal();
  const max = Math.max(...buckets.flatMap(b => [b.revenue ?? 0, b.expense ?? 0]), 0);
  if (!buckets.length) return null;
  // A recorded zero shows as a thin stub; a bar is only invisible when nothing was recorded.
  const scaleMax = Math.max(max, 1);
  const barStyle = (v: number | null, base: string, solid: boolean): React.CSSProperties =>
    v === null ? { height: 0, background: base, opacity: 0 }
      : v === 0 ? { height: '2px', background: base, opacity: 0.4 }
        : { height: `${Math.max(3, (v / scaleMax) * 100)}%`, background: base, opacity: solid ? 1 : 0.85 };
  const grow = (i: number) => ({
    initial: reduced ? false : { scaleY: 0 },
    animate: { scaleY: show ? 1 : 0 },
    transition: reduced ? { duration: 0 } : { ...MOTION.page, delay: Math.min(i, 14) * 0.03 },
  });
  return (
    <div ref={ref}>
      <div className="flex items-end gap-3" style={{ height }}>
        {buckets.map((b, i) => (
          <div key={`${b.label}-${i}`} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1"
            title={`${b.label} · in ${b.revenue === null ? 'not recorded' : format(b.revenue)} · out ${b.expense === null ? 'not recorded' : format(b.expense)} · net ${b.net === null ? 'unknown' : format(b.net)}`}>
            <span className="w-full flex items-end justify-center gap-1 h-full">
              <motion.span className="w-1/2 max-w-[18px] rounded-t-[4px]" {...grow(i)}
                style={{ ...barStyle(b.revenue, CHART.success, true), transformOrigin: 'bottom' }} />
              <motion.span className="w-1/2 max-w-[18px] rounded-t-[4px]" {...grow(i)}
                style={{ ...barStyle(b.expense, CHART.danger, false), transformOrigin: 'bottom' }} />
            </span>
            <span className="font-mono text-[9px] text-muted-2 tnum truncate w-full text-center">
              {b.net === null ? '—' : format(b.net)}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-muted truncate w-full text-center">{b.label}</span>
          </div>
        ))}
      </div>
      <ChartLegend items={[
        { label: 'Money in', color: CHART.success },
        { label: 'Money out', color: CHART.danger },
      ]} />
      <p className="mt-1 text-[10px] text-faint">A thin stub marks a day recorded as zero; a blank bucket or “—” means nothing was recorded there.</p>
    </div>
  );
}
