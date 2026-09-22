import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Form';

export function Dialog({ open, onClose, title, subtitle, children, footer }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-ink/45 backdrop-blur-[2px] ap-fade" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[440px] bg-card rounded-t-[22px] sm:rounded-[20px] shadow-pop overflow-hidden ap-sheet-up sm:ap-rise"
        role="dialog" aria-modal="true" aria-label={title}
      >
        <div className="flex justify-center pt-2.5 sm:hidden"><span className="w-9 h-1 rounded-full bg-line" /></div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h3 className="font-display text-[18px] font-semibold text-ink leading-tight">{title}</h3>
            {subtitle && <p className="text-[12px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full bg-sunk text-muted hover:text-ink flex items-center justify-center press shrink-0">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 pb-5 max-h-[68vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-line-2 bg-card safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Alias — bottom sheet on mobile, modal on desktop. */
export const Sheet = Dialog;

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" block onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} block onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      }
    >
      <p className="text-[14px] text-muted leading-relaxed">{message}</p>
    </Dialog>
  );
}

/** Contextual action list (quick actions, overflow menus). */
export function ActionSheet({ open, onClose, title, actions }: {
  open: boolean; onClose: () => void; title?: string;
  actions: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; tone?: 'default' | 'danger' }[];
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title ?? 'Actions'}>
      <div className="divide-y divide-line-2 -mx-5 px-5">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={() => { a.onClick(); onClose(); }}
            className={clsx('flex w-full items-center gap-3 py-3 text-left press', a.tone === 'danger' ? 'text-danger' : 'text-ink')}
          >
            {a.icon && <span className={clsx('w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0', a.tone === 'danger' ? 'bg-danger-soft' : 'bg-brand-soft text-brand')}>{a.icon}</span>}
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold">{a.label}</span>
              {a.hint && <span className="block text-[12px] text-muted mt-0.5">{a.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
