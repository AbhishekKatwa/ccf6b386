import { Component, useId, useState, type ErrorInfo, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, RotateCw, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { Surface } from '@/components/ui/Card';
import { EASE, INDICATOR_SPRING, MOTION, Presence, useReducedMotion } from '@/components/motion';

/**
 * The frame every owner-dashboard graph is drawn in. It owns the five states a
 * graph can be in — loading, empty, warning, ready, error — so a chart itself only
 * has to plot numbers. Each frame gets its own error boundary: one graph that
 * throws stays broken on its own and leaves the rest of the dashboard standing.
 */

/* ============================= RANGE CONTROL ============================= */

export function GraphRange<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[]; label?: string;
}) {
  const reduced = useReducedMotion();
  // One shared layout id per control (never across the four graphs on a page), so the active
  // pill slides between widths instead of repainting.
  const pill = useId();
  return (
    <div className="flex gap-0.5 bg-sunk rounded-full p-0.5 shrink-0" role="group" aria-label={label}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={clsx(
              'relative px-2.5 py-1 rounded-full font-mono text-[10px] font-semibold uppercase tracking-[0.08em] press transition-colors',
              on ? 'text-white' : 'text-muted hover:text-ink',
            )}
          >
            {on && (
              <motion.span
                layoutId={pill}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduced ? { duration: 0 } : INDICATOR_SPRING}
                className="absolute inset-0 rounded-full bg-brand shadow-card"
                aria-hidden
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================= STATES ============================= */

function GraphSkeleton({ height }: { height: number }) {
  return (
    <div className="space-y-3" style={{ minHeight: height }} aria-busy="true" aria-live="polite">
      <div className="h-3 w-24 rounded-full bg-sunk ap-shimmer" />
      <div className="rounded-[12px] bg-sunk ap-shimmer" style={{ height: height - 24 }} />
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">Loading this graph…</p>
    </div>
  );
}

function GraphEmpty({ title, description, height }: { title: string; description?: string; height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-1.5 px-4 rounded-[14px] border border-dashed border-line bg-sunk/30"
      style={{ minHeight: height ?? 150 }}>
      <TrendingUp size={20} className="text-muted-2 mb-0.5" />
      <p className="font-display text-[14px] font-semibold text-ink-2">{title}</p>
      {description && <p className="text-[12px] text-muted max-w-[320px] leading-relaxed">{description}</p>}
    </div>
  );
}

function GraphError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 px-4 py-8 rounded-[14px] border border-dashed border-danger-soft bg-danger-soft/40">
      <AlertTriangle size={20} className="text-danger" />
      <p className="font-display text-[14px] font-semibold text-ink">Unable to load this graph</p>
      <p className="text-[12px] text-muted max-w-[300px] leading-relaxed">{message}</p>
      <button type="button" onClick={onRetry}
        className="mt-1.5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-card border border-line text-[12px] font-semibold text-brand press">
        <RotateCw size={13} /> Retry
      </button>
    </div>
  );
}

/** Data-quality notes stay quiet — a single line under the chart, never a banner. */
function GraphWarnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 flex items-start gap-2 border-t border-line-2 pt-2.5">
      <AlertTriangle size={13} className="text-warn shrink-0 mt-[2px]" />
      <div className="min-w-0 space-y-0.5">
        {items.map((w, i) => <p key={i} className="text-[11px] text-warn leading-snug">{w}</p>)}
      </div>
    </div>
  );
}

/* ============================= BOUNDARY ============================= */

interface BoundaryProps {
  graph: string;
  detail?: string;
  children: ReactNode;
  onError: (message: string) => void;
}

class GraphErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Technical detail is for the console in development only; users never see a stack.
    if (import.meta.env.DEV) {
      console.warn(`[graph] ${this.props.graph} failed`, { message: error.message, detail: this.props.detail, stack: info.componentStack });
    }
    this.props.onError(error.message || 'The chart could not be drawn.');
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ============================= FRAME ============================= */

export type GraphStat = { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ink' | 'success' | 'danger' | 'warn' | 'muted' };

const statTone: Record<NonNullable<GraphStat['tone']>, string> = {
  ink: 'text-ink', success: 'text-success', danger: 'text-danger', warn: 'text-warn', muted: 'text-muted',
};

export function GraphCard({ title, subtitle, actions, stats, loading = false, empty, warnings, height = 190, detail, className, children }: {
  title: string;
  subtitle?: ReactNode;
  /** Range switch, mode pills or a picker — anything that re-scopes this one graph. */
  actions?: ReactNode;
  stats?: GraphStat[];
  loading?: boolean;
  empty?: { title: string; description?: string };
  /** Records the graph could not include; the chart still shows what is real. */
  warnings?: string[];
  height?: number;
  /** Range / selector context for development logging. */
  detail?: string;
  className?: string;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();

  const shown = error === null && !loading && !empty;
  // Which of the five states is on screen decides the key, so a skeleton hands over to its
  // graph with one short crossfade instead of the plot appearing inside a still frame.
  const phase = loading ? 'loading' : error !== null ? 'error' : empty ? 'empty' : 'ready';

  return (
    <Surface className={clsx('p-4 min-w-0', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-display text-[16px] font-semibold text-ink leading-tight">{title}</h2>
          {subtitle && <p className="text-[12px] text-muted mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        {actions && shown && <div className="ml-auto min-w-0">{actions}</div>}
      </div>

      {stats && stats.length > 0 && shown && (
        <div className="mt-3.5 mb-1 flex gap-5 overflow-x-auto no-scrollbar pb-0.5">
          {stats.map(s => (
            <div key={s.label} className="shrink-0 min-w-[84px]">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-2">{s.label}</p>
              <p className={clsx('font-display text-[17px] font-semibold tnum mt-0.5 whitespace-nowrap', statTone[s.tone ?? 'ink'])}>{s.value}</p>
              {s.sub && <p className="font-mono text-[10px] text-muted mt-0.5 tnum whitespace-nowrap">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Presence mode="wait">
          <motion.div
            key={phase}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: MOTION.micro.duration } }}
            transition={reduced ? { duration: 0.01 } : { duration: MOTION.component.duration, ease: EASE }}
          >
            {loading ? <GraphSkeleton height={height} />
              : error !== null ? <GraphError message={error} onRetry={() => { setError(null); setAttempt(a => a + 1); }} />
              : empty ? <GraphEmpty {...empty} height={height} />
              : (
                <GraphErrorBoundary key={attempt} graph={title} detail={detail} onError={setError}>
                  {children}
                </GraphErrorBoundary>
              )}
            {shown && <GraphWarnings items={(warnings ?? []).filter(Boolean)} />}
          </motion.div>
        </Presence>
      </div>
    </Surface>
  );
}
