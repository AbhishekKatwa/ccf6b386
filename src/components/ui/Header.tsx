import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';

export function Header({ title, subtitle, action, onBack, backTo }: {
  title: string; subtitle?: string; action?: ReactNode; onBack?: () => void; backTo?: string;
}) {
  const nav = useNavigate();
  const handleBack = () => {
    if (onBack) return onBack();
    if (backTo) return nav(backTo);
    if (window.history.length > 1) nav(-1);
    else nav('/');
  };
  return (
    <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-md safe-top">
      <div className="flex items-center gap-3 px-4 sm:px-0 py-3">
        <button
          onClick={handleBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full bg-card border border-line text-ink-2 flex items-center justify-center press hover:text-brand hover:border-brand shrink-0"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-semibold text-ink text-[19px] leading-tight truncate">{title}</h1>
          {subtitle && <p className="font-mono text-[11px] text-muted truncate mt-0.5 tnum">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** Large editorial title for primary (tab) screens — no back button. */
export function ScreenTitle({ eyebrow, title, subtitle, action }: {
  eyebrow?: string; title: string; subtitle?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 px-4 sm:px-0 pt-5 pb-4 safe-top">
      <div className="min-w-0">
        {eyebrow && <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted mb-1">{eyebrow}</p>}
        <h1 className="font-display font-semibold text-ink text-[26px] sm:text-[30px] leading-tight tracking-tight truncate">{title}</h1>
        {subtitle && <div className="text-[13px] text-muted mt-1 tnum">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}

export function Page({ children, className, withNav = false }: { children: ReactNode; className?: string; withNav?: boolean }) {
  return (
    <div className={clsx('flex flex-col min-h-full', withNav ? 'pb-28 sm:pb-8' : 'pb-8', className)}>
      {children}
    </div>
  );
}
