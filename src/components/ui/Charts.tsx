import { useId, useState } from 'react';
import clsx from 'clsx';

export const CHART = {
  brand: '#17493b',
  accent: '#d9820b',
  success: '#177245',
  danger: '#b3261e',
  muted: '#979b90',
};

function scale(data: number[], h: number, pad = 4) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  return data.map(v => h - pad - ((v - min) / range) * (h - pad * 2));
}

/** Tiny inline trend line (no axes). */
export function Sparkline({ data, color = CHART.brand, width = 96, height = 28 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  if (!data.length) return null;
  const ys = scale(data, height, 3);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = ys.map((y, i) => `${i * step},${y}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(data.length - 1) * step} cy={ys[ys.length - 1]} r="2.5" fill={color} />
    </svg>
  );
}

export function LineChart({ data, labels, color = CHART.brand, height = 64, showArea = true, unit }: {
  data: number[]; labels?: string[]; color?: string; height?: number; showArea?: boolean; unit?: string;
}) {
  const gid = useId().replace(/:/g, '');
  if (!data.length) return null;
  const w = 320, h = height;
  const ys = scale(data, h, 4);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = ys.map((y, i) => `${i * step},${y}`).join(' ');
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        {showArea && (
          <>
            <defs>
              <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.16" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={`0,${h} ${points} ${(data.length - 1) * step},${h}`} fill={`url(#g${gid})`} />
          </>
        )}
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={(data.length - 1) * step} cy={ys[ys.length - 1]} r="3" fill={color} stroke="#fffdf9" strokeWidth="1.5" />
      </svg>
      {labels && (
        <div className="flex justify-between mt-1.5">
          {labels.map((l, i) => <span key={i} className="font-mono text-[9px] text-muted-2 tnum">{l}</span>)}
        </div>
      )}
      {unit && <span className="sr-only">unit {unit}</span>}
    </div>
  );
}

/** Interactive area trend with hover/touch readout. */
export function AreaTrend({ data, labels, color = CHART.brand, height = 120, format }: {
  data: number[]; labels?: string[]; color?: string; height?: number; format?: (v: number) => string;
}) {
  const gid = useId().replace(/:/g, '');
  const [idx, setIdx] = useState<number | null>(null);
  if (!data.length) return null;
  const w = 320, h = height;
  const ys = scale(data, h, 8);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const line = ys.map((y, i) => `${i * step},${y}`).join(' ');
  const active = idx ?? data.length - 1;
  const fmt = format ?? ((v: number) => v.toLocaleString('en-IN'));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    setIdx(Math.max(0, Math.min(data.length - 1, Math.round(x / step))));
  };

  return (
    <div className="relative" onPointerLeave={() => setIdx(null)}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-display text-[20px] font-semibold tnum text-ink">{fmt(data[active])}</span>
        {labels && <span className="font-mono text-[10px] text-muted tnum">{labels[active]}</span>}
      </div>
      <svg
        width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
        className="overflow-visible touch-none cursor-crosshair"
        onPointerMove={onMove} onPointerDown={onMove}
      >
        <defs>
          <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${line} ${(data.length - 1) * step},${h}`} fill={`url(#a${gid})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {idx !== null && (
          <>
            <line x1={active * step} y1="0" x2={active * step} y2={h} stroke={color} strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={active * step} cy={ys[active]} r="4" fill={color} stroke="#fffdf9" strokeWidth="2" />
          </>
        )}
        <circle cx={(data.length - 1) * step} cy={ys[data.length - 1]} r="3" fill={color} stroke="#fffdf9" strokeWidth="1.5" />
      </svg>
      {labels && (
        <div className="flex justify-between mt-1.5">
          {[0, Math.floor((labels.length - 1) / 2), labels.length - 1].map((i, k) => (
            <span key={k} className="font-mono text-[9px] text-muted-2 tnum">{labels[i]}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function BarChart({ data, labels, color = CHART.accent, height = 80 }: {
  data: number[]; labels?: string[]; color?: string; height?: number;
}) {
  const max = Math.max(...data, 1);
  const lastIdx = data.length - 1;
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-[3px] transition-all hover:opacity-100"
            style={{
              height: `${Math.max(3, (v / max) * 100)}%`,
              background: color,
              opacity: i === lastIdx ? 1 : 0.32 + (v / max) * 0.4,
            }}
            title={`${labels?.[i] ?? i}: ${v}`}
          />
        ))}
      </div>
      {labels && (
        <div className="flex gap-[3px] mt-1">
          {labels.map((l, i) => <span key={i} className="flex-1 text-center font-mono text-[9px] text-muted-2 truncate tnum">{l}</span>)}
        </div>
      )}
    </div>
  );
}

/** Compact horizontal distribution bars (e.g. feed by ingredient). */
export function BarsMini({ items, color = CHART.brand }: { items: { label: string; value: number; display?: string }[]; color?: string }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="space-y-2.5">
      {items.map(it => (
        <div key={it.label}>
          <div className="flex justify-between text-[12px] mb-1">
            <span className="text-ink-2 font-medium">{it.label}</span>
            <span className="font-mono text-muted tnum">{it.display ?? it.value.toLocaleString('en-IN')}</span>
          </div>
          <div className="h-1.5 rounded-full bg-sunk overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DonutStat({ value, max, label, color = CHART.brand }: { value: number; max: number; label: string; color?: string }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#edeae0" strokeWidth="7" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform="rotate(-90 36 36)" />
        <text x="36" y="41" textAnchor="middle" fontSize="14" fontWeight="600" fill={color} fontFamily="Inter">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
        <p className="font-display font-semibold text-ink text-lg tnum">{value.toLocaleString('en-IN')}</p>
      </div>
    </div>
  );
}

/** Day-by-day intensity strip (calendar-like) for production/mortality. */
export function HeatStrip({ data, labels, color = CHART.brand, goodWhenLow = false }: {
  data: number[]; labels?: string[]; color?: string; goodWhenLow?: boolean;
}) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex gap-[3px]">
        {data.map((v, i) => {
          const t = v / max;
          return (
            <div key={i} title={`${labels?.[i] ?? i}: ${v}`}
              className="flex-1 h-7 rounded-[4px] transition-transform hover:scale-y-110"
              style={{ background: v === 0 ? '#edeae0' : color, opacity: v === 0 ? 1 : 0.25 + t * 0.75 }} />
          );
        })}
      </div>
      {labels && (
        <div className="flex justify-between mt-1">
          <span className="font-mono text-[9px] text-muted-2 tnum">{labels[0]}</span>
          <span className="font-mono text-[9px] text-muted-2 tnum">{goodWhenLow ? 'lower is better' : ''}</span>
          <span className="font-mono text-[9px] text-muted-2 tnum">{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

export function ChartCard({ title, right, children, className }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={clsx('bg-card border border-line rounded-[18px] shadow-card p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h4>
        {right}
      </div>
      {children}
    </div>
  );
}
