import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { useApp, TOAST_TTL_MS } from '@/store/app';
import { Presence, useReducedMotion } from '@/components/motion';

/**
 * Notices drop in from the safe area, push one another aside rather than jumping, and read
 * their own lifetime on the line under the message — the store removes them on the same clock.
 */
export function ToastHost() {
  const toasts = useApp(s => s.toasts);
  const dismiss = useApp(s => s.dismissToast);
  const reduced = useReducedMotion();
  if (!toasts.length) return null;
  return createPortal(
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[200] w-full max-w-[400px] px-3 flex flex-col gap-2 pointer-events-none safe-top">
      <Presence mode="popLayout">
        {toasts.map(t => (
          <motion.div
            key={t.id}
            layout
            initial={reduced ? false : { opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
            transition={reduced ? { duration: 0.01 } : { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            className="pointer-events-auto"
          >
            <button
              onClick={() => dismiss(t.id)}
              role="status"
              className="relative w-full overflow-hidden flex items-center gap-3 px-4 py-3 rounded-[14px] shadow-pop bg-ink text-white text-left"
            >
              <span className={clsx(
                'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                t.kind === 'success' ? 'bg-success/30 text-[#9ed3b2]' : t.kind === 'error' ? 'bg-danger/30 text-[#f0b9b4]' : 'bg-white/15 text-white',
              )}>
                {t.kind === 'success' ? <CheckCircle2 size={15} /> : t.kind === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium leading-snug">{t.message}</span>
                {t.detail && <span className="block mt-0.5 text-[11.5px] leading-snug text-white/70">{t.detail}</span>}
              </span>
              <motion.span
                aria-hidden
                className="absolute bottom-0 left-0 h-[2px] w-full origin-left bg-white/40"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={reduced ? { duration: 0.01 } : { duration: TOAST_TTL_MS / 1000, ease: 'linear' }}
              />
            </button>
          </motion.div>
        ))}
      </Presence>
    </div>,
    document.body,
  );
}
