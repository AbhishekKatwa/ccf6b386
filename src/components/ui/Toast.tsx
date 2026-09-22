import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '@/store/app';

export function ToastHost() {
  const toasts = useApp(s => s.toasts);
  const dismiss = useApp(s => s.dismissToast);
  if (!toasts.length) return null;
  return createPortal(
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[200] w-full max-w-[400px] px-3 space-y-2 pointer-events-none safe-top">
      {toasts.map(t => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          role="status"
          className="ap-toast-in pointer-events-auto w-full flex items-center gap-3 px-4 py-3 rounded-[14px] shadow-pop bg-ink text-white text-left"
        >
          <span className={clsx(
            'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
            t.kind === 'success' ? 'bg-success/25 text-[#7ee2a8]' : t.kind === 'error' ? 'bg-danger/30 text-[#ffb4ad]' : 'bg-white/15 text-white',
          )}>
            {t.kind === 'success' ? <CheckCircle2 size={15} /> : t.kind === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
          </span>
          <span className="flex-1 text-[13px] font-medium leading-snug">{t.message}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
