/**
 * Global motion system — one place for every animation primitive the product uses.
 *
 * Design goals (per master spec §2, §34, §39):
 *   - Premium, calm, fast, confident. Never flashy or distracting.
 *   - Every animation communicates hierarchy, causality, feedback or state.
 *   - Micro 100-180ms · Hover 150-220ms · Modal 200-300ms · Page 300-450ms · Chart 400-700ms.
 *   - Respects prefers-reduced-motion globally via useReducedMotion.
 *   - GPU-friendly: transform + opacity only; no layout-thrashing properties.
 *
 * These primitives wrap `motion` (framer-motion v11+) and are the ONLY approved way to
 * add motion in this codebase. Do not introduce ad-hoc keyframes or a second library.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  motion, AnimatePresence, useSpring, useTransform, useMotionValue, useInView,
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

/* ============================= SHARED VARIANTS ============================= */

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
};

export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
};

export const drawerVariants: Variants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { type: 'spring', stiffness: 320, damping: 32 } },
  exit: { y: '100%', transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
};

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.22 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.18 } },
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
      transition={{ duration: reduced ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ============================= ANIMATED NUMBER ============================= */

/**
 * Count-up/down between numeric values. Settles quickly (~600ms spring).
 * Only re-animates when `value` changes by more than `threshold` (avoids jitter on small updates).
 * Formats with Intl.NumberFormat so currency/compact notation stays consistent.
 */
export function AnimatedNumber({ value, format, prefix = '', suffix = '', threshold = 0.5, className }: {
  value: number; format?: Intl.NumberFormatOptions; prefix?: string; suffix?: string;
  threshold?: number; className?: string;
}) {
  const reduced = useReducedMotion();
  const prev = useRef(value);
  const mv = useMotionValue(prev.current);
  const spring = useSpring(mv, { stiffness: 260, damping: 28, mass: 0.6 });
  const display = useTransform(spring, n => {
    const v = Math.round(n * 100) / 100;
    try {
      return format ? new Intl.NumberFormat(undefined, format).format(v) : String(v);
    } catch {
      return String(v);
    }
  });
  const [text, setText] = useState(prefix + (format ? new Intl.NumberFormat(undefined, format).format(value) : String(value)) + suffix);

  useEffect(() => {
    if (Math.abs(value - prev.current) < threshold) {
      setText(prefix + (format ? new Intl.NumberFormat(undefined, format).format(value) : String(value)) + suffix);
      prev.current = value;
      return;
    }
    prev.current = value;
    if (reduced) {
      setText(prefix + (format ? new Intl.NumberFormat(undefined, format).format(value) : String(value)) + suffix);
      mv.set(value);
      return;
    }
    mv.set(value);
  }, [value, format, prefix, suffix, threshold, reduced, mv]);

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
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
      transition={{ duration: 0.12 }}
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
          transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
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
        transition={{ duration: reduced ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

export function ErrorShake({ children, trigger, className }: { children: ReactNode; trigger: unknown; className?: string }) {
  const reduced = useReducedMotion();
  // Re-animate when trigger changes by keying the wrapper externally; here we just expose a stable mount.
  return (
    <motion.div
      className={className}
      animate={reduced ? undefined : { x: [0, -4, 4, -3, 3, 0] }}
      transition={{ duration: 0.32, ease: 'easeOut' }}
      key={String(trigger)}
    >
      {children}
    </motion.div>
  );
}

/* ============================= CHART REVEAL ============================= */

/** Generic clip-path reveal for any chart container. Children draw normally; the mask wipes left→right. */
export function ChartReveal({ children, className, duration = 0.6, delay = 0 }: {
  children: ReactNode; className?: string; duration?: number; delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px 0px' });
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
      animate={inView ? { clipPath: 'inset(0 0% 0 0)' } : undefined}
      transition={{ duration: reduced ? 0 : duration, ease: [0.22, 1, 0.36, 1], delay }}
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
      transition={{ duration: reduced ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
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
