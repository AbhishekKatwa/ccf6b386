/**
 * Global motion system — one place for every animation primitive the product uses.
 *
 * Design goals (per master spec §2, §34, §39):
 *   - Premium, calm, fast, confident. Never flashy or distracting.
 *   - Every animation communicates hierarchy, causality, feedback or state.
 *   - Micro 100-200ms · Component 200-350ms · Page/section 300-600ms.
 *   - Respects prefers-reduced-motion globally via useReducedMotion.
 *   - GPU-friendly: transform + opacity only; no layout-thrashing properties.
 *
 * These primitives wrap `motion` (framer-motion v11+) and are the ONLY approved way to
 * add motion in this codebase. Do not introduce ad-hoc keyframes or a second library.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  motion, AnimatePresence, useAnimationControls, useSpring, useTransform, useMotionValue, useInView,
  type Variants, type Transition, type HTMLMotionProps,
} from 'motion/react';
import clsx from 'clsx';

/* ============================= REDUCED MOTION ============================= */

const ReducedMotionContext = createContext<boolean>(false);

/** Reads OS-level prefers-reduced-motion and exposes it to every primitive. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return <ReducedMotionContext.Provider value={reduced}>{children}</ReducedMotionContext.Provider>;
}

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}

/** Shared transition factory: returns a near-instant swap when reduced motion is on. */
export function useMotionTransition(fast: Transition, slow?: Transition): Transition {
  const reduced = useReducedMotion();
  return reduced ? { duration: 0.01 } : (slow ?? fast);
}

/* ============================= TIMING TOKENS ============================= */

/** The single easing curve every tier resolves to — a settle, never a bounce. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * The three motion tiers. Pick the tier by what moves, not by taste:
 *   micro     — buttons, icons, hover, focus, toggles           (L1, 100-200ms)
 *   component — cards, drawers, modals, tabs, list items, charts (L2, 200-350ms)
 *   page      — page and section entrances                       (L3, 300-600ms)
 * Nothing outside these three numbers should appear in a transition. The exception is a
 * distance-driven move — a layout pill or a pointer-following tilt — which takes a spring
 * (INDICATOR_SPRING below) because the travel is measured, not timed.
 */
export const MOTION = {
  micro:     { duration: 0.16, ease: EASE },
  component: { duration: 0.26, ease: EASE },
  page:      { duration: 0.42, ease: EASE },
} as const satisfies Record<string, Transition>;

/**
 * The one transition a shared-layout pill uses when it travels between controls. A spring,
 * because a measured distance is not a fixed duration: short hops settle quickly, long ones
 * keep the same feel. Stiffness high and damping near-critical so it glides without bouncing.
 */
export const INDICATOR_SPRING: Transition = { type: 'spring', stiffness: 400, damping: 34, mass: 0.8 };

/* ============================= SHARED VARIANTS ============================= */

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: MOTION.page },
  exit: { opacity: 0, y: -6, transition: MOTION.component },
};

export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: MOTION.page },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: MOTION.component },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: MOTION.component },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: MOTION.micro },
};

export const drawerVariants: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { type: 'spring', stiffness: 320, damping: 32 } },
  exit: { y: '100%', transition: MOTION.component },
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: MOTION.component },
  exit: { opacity: 0, transition: MOTION.micro },
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: MOTION.component },
  exit: { opacity: 0, scale: 0.98, transition: MOTION.micro },
};

/* ============================= PAGE / SECTION REVEAL ============================= */

export function PageReveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : 'hidden'}
      animate="visible"
      exit="exit"
      variants={pageVariants}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SectionReveal({ children, className, delay = 0, once = true }: {
  children: ReactNode; className?: string; delay?: number; once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: '-60px 0px' });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : 'hidden'}
      animate={inView ? 'visible' : 'hidden'}
      variants={sectionVariants}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerContainer({ children, className, as = 'div' }: {
  children: ReactNode; className?: string; as?: 'div' | 'ul' | 'ol' | 'section';
}) {
  const reduced = useReducedMotion();
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      initial={reduced ? false : 'hidden'}
      whileInView={reduced ? undefined : 'visible'}
      viewport={{ once: true, margin: '-40px 0px' }}
      variants={staggerContainer}
      className={className}
    >
      {children}
    </Comp>
  );
}

export function StaggerItem({ children, className, as = 'div' }: {
  children: ReactNode; className?: string; as?: 'div' | 'li' | 'article' | 'button';
}) {
  const Comp = motion[as] as typeof motion.div;
  return <Comp variants={staggerItem} className={className}>{children}</Comp>;
}

/* ============================= SCROLL REVEAL ============================= */

export function ScrollReveal({ children, className, once = true, margin }: {
  children: ReactNode; className?: string; once?: boolean; margin?: number | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: margin as never });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: reduced ? 0 : 0.45, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================= ANIMATED NUMBER ============================= */

/**
 * A count-up asks for its formatter on every frame the spring runs, and constructing one is far
 * dearer than using it. There are only a handful of option shapes in the whole app, so they are
 * built once and shared.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();

function formatterFor(locale: string | undefined, format: Intl.NumberFormatOptions) {
  const key = `${locale ?? ''}|${JSON.stringify(format)}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, format);
    numberFormats.set(key, f);
  }
  return f;
}

/**
 * Count-up/down between numeric values. Settles quickly (~600ms spring).
 * Only re-animates when `value` changes by more than `threshold` (avoids jitter on small updates).
 * Formats with Intl.NumberFormat so currency/compact notation stays consistent.
 */
export function AnimatedNumber({ value, format, prefix = '', suffix = '', threshold = 0.5, locale, className }: {
  value: number; format?: Intl.NumberFormatOptions; prefix?: string; suffix?: string;
  threshold?: number; locale?: string; className?: string;
}) {
  const reduced = useReducedMotion();
  const prev = useRef(value);
  const mv = useMotionValue(prev.current);
  const spring = useSpring(mv, { stiffness: 260, damping: 28, mass: 0.6 });
  // `locale` lets a figure count up in the same grouping the screen prints it with (₹ en-IN vs default).
  const show = (n: number) => {
    try {
      return format ? formatterFor(locale, format).format(n) : String(n);
    } catch {
      return String(n);
    }
  };
  const display = useTransform(spring, n => show(Math.round(n * 100) / 100));
  const [text, setText] = useState(prefix + show(value) + suffix);

  useEffect(() => {
    if (Math.abs(value - prev.current) < threshold) {
      setText(prefix + show(value) + suffix);
      prev.current = value;
      return;
    }
    prev.current = value;
    if (reduced) {
      setText(prefix + show(value) + suffix);
      mv.set(value);
      return;
    }
    mv.set(value);
  }, [value, format, locale, prefix, suffix, threshold, reduced, mv]);

  useEffect(() => {
    if (reduced) return;
    return display.on('change', v => setText(prefix + v + suffix));
  }, [display, prefix, suffix, reduced]);

  return <span className={clsx('tnum tabular-nums', className)}>{text}</span>;
}

/* ============================= HOVER / PRESS WRAPPERS ============================= */

export function HoverCard({ children, className, lift = -2, shadowOnHover = true, disabled }: {
  children: ReactNode; className?: string; lift?: number; shadowOnHover?: boolean; disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      whileHover={disabled || reduced ? undefined : { y: lift, boxShadow: shadowOnHover ? '0 8px 24px -12px rgba(0,0,0,.12)' : undefined }}
      transition={MOTION.micro}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Adds press scale + hover brightness without replacing the element's own classes. */
export function Pressable({ children, className, scale = 0.98, disabled, ...props }: HTMLMotionProps<'div'> & {
  scale?: number; disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      {...props}
      whileTap={disabled || reduced ? undefined : { scale }}
      transition={MOTION.micro}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================= TABS INDICATOR ============================= */

/**
 * Sliding pill indicator behind an active tab. Wrap each tab button in a relative container
 * and render `<TabIndicator active={i === activeIndex} />` inside it.
 */
export function TabIndicator({ active, className }: { active: boolean; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {active && (
        <motion.span
          layoutId="tab-indicator"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? { duration: 0 } : INDICATOR_SPRING}
          className={clsx('absolute inset-0 rounded-full bg-card shadow-card ring-1 ring-inset ring-brand/15', className)}
          aria-hidden
        />
      )}
    </AnimatePresence>
  );
}

/* ============================= MODAL / DRAWER TRANSITION ============================= */

export function ModalTransition({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduced ? false : 'hidden'}
          animate="visible"
          exit="exit"
          variants={modalVariants}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DrawerTransition({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduced ? false : 'hidden'}
          animate="visible"
          exit="exit"
          variants={drawerVariants}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function BackdropTransition({ open, onClick, blur = 2 }: { open: boolean; onClick?: () => void; blur?: number }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial="hidden" animate="visible" exit="exit" variants={backdropVariants}
          onClick={onClick}
          style={{ backdropFilter: `blur(${blur}px)` }}
          className="fixed inset-0 z-[99] bg-ink/45"
          aria-hidden
        />
      )}
    </AnimatePresence>
  );
}

/* ============================= SKELETON LOADER ============================= */

export function Skeleton({ className, radius = 'rounded-[10px]' }: { className?: string; radius?: string }) {
  return (
    <div className={clsx('bg-line-2/60 animate-pulse', radius, className)} aria-hidden />
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-[18px] border border-line bg-card p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-7 w-2/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

export function TableRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <div className="grid gap-3 px-4 py-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

/* ============================= SUCCESS / ERROR FEEDBACK ============================= */

export function SuccessCheck({ size = 18, className }: { size?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={clsx('text-success', className)}>
      <motion.path
        d="M4 12.5l5 5L20 6.5"
        stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={reduced ? { duration: 0 } : MOTION.component}
      />
    </svg>
  );
}

export function ErrorShake({ children, trigger, className }: { children: ReactNode; trigger: unknown; className?: string }) {
  const reduced = useReducedMotion();
  const controls = useAnimationControls();
  const seen = useRef(trigger);
  // Every new rejection shakes, including a repeat of the same message. Keying the wrapper
  // would work too, but it remounts the form and drops the field the user is standing in.
  useEffect(() => {
    if (seen.current === trigger) return;
    seen.current = trigger;
    if (trigger && !reduced) void controls.start({ x: [0, -4, 4, -3, 3, 0], transition: MOTION.component });
  }, [trigger, reduced, controls]);
  return (
    <motion.div
      className={className}
      animate={controls}
    >
      {children}
    </motion.div>
  );
}

/* ============================= CHART REVEAL ============================= */

/**
 * Mount-time draw signal for the parts of a chart (bars, a ring, a distribution row).
 * `show` flips true once the container has entered view — and is true from the start under
 * reduced motion, so a figure can never be left hidden by an animation that never ran.
 * Pair with `initial={reduced ? false : hiddenState}`, exactly like the primitives here.
 */
export function useReveal(margin = '-40px 0px') {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: margin as never });
  const reduced = useReducedMotion();
  // Fail open: an observer that never reports — a document the browser does not paint, a
  // container it never intersects — must not leave a chart's bars at zero scale. A figure the
  // user cannot see is a data fault, not a missed animation.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    // A figure already drawn needs no rescue: the timer exists only for the observer that
    // never reports, so every chart on a long page would otherwise hold one for 900ms.
    if (reduced || inView) return;
    const t = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(t);
  }, [inView, reduced]);
  return { ref, show: reduced || inView || settled, reduced } as const;
}

/** Generic clip-path reveal for any chart container. Children draw normally; the mask wipes left→right. */
export function ChartReveal({ children, className, duration = 0.6, delay = 0 }: {
  children: ReactNode; className?: string; duration?: number; delay?: number;
}) {
  const { ref, show, reduced } = useReveal();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
      animate={show ? { clipPath: 'inset(0 0% 0 0)' } : undefined}
      transition={{ duration: reduced ? 0 : duration, ease: EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================= PARALLAX / TILT (desktop-only, decorative) ============================= */

export function ParallaxLayer({ children, offset = 20, className }: {
  children: ReactNode; offset?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, margin: '-20% 0px' });
  const reduced = useReducedMotion();
  // Simple scroll-driven Y shift using CSS perspective would require scroll listeners; keep it declarative via motion's useScroll isn't imported to save bundle. Fallback: subtle entrance parallax via inView.
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { y: offset }}
      animate={inView ? { y: 0 } : undefined}
      transition={{ duration: reduced ? 0 : 0.7, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function TiltCard({ children, className, maxDeg = 3, disabled }: {
  children: ReactNode; className?: string; maxDeg?: number; disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-0.5, 0.5], [maxDeg, -maxDeg]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-maxDeg, maxDeg]);
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || reduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const handleLeave = () => { x.set(0); y.set(0); };
  return (
    <motion.div
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================= LAYOUT ID UTILS ============================= */

/** Convenience: wraps children in AnimatePresence so exit animations fire. */
export function Presence({ children, mode = 'wait' }: { children: ReactNode; mode?: 'sync' | 'wait' | 'popLayout' }) {
  return <AnimatePresence mode={mode}>{children}</AnimatePresence>;
}

/**
 * One tab body, replaced rather than patched: pass the active tab as `id` and put every
 * conditional panel inside it. The outgoing body lifts away before the incoming one rises, so
 * a tab switch reads as one gesture instead of a content swap.
 */
export function TabPanel({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <Presence mode="wait">
      <motion.div
        key={id}
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? undefined : { opacity: 0, y: -8 }}
        transition={reduced ? { duration: 0 } : MOTION.component}
        className={className}
      >
        {children}
      </motion.div>
    </Presence>
  );
}
