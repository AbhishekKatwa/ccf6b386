import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, ClipboardList, Egg, Handshake, Skull, Syringe, Wheat } from 'lucide-react';
import type { AlertKind, AlertTone, FarmAlert } from '@/lib/alerts';

export const ALERT_TONE: Record<AlertTone, string> = {
  danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn',
  accent: 'bg-accent-soft text-accent-ink', brand: 'bg-brand-soft text-brand',
};

const ALERT_ICON: Record<AlertKind, ReactNode> = {
  vaccination: <Syringe size={15} />,
  log: <Egg size={15} />,
  mortality: <Skull size={15} />,
  'stock-negative': <AlertTriangle size={15} />,
  'stock-low': <Wheat size={15} />,
  money: <Handshake size={15} />,
  tasks: <ClipboardList size={15} />,
};

/** One alert row — shared by the dashboard Attention layer and the Alerts page. */
export function AlertRow({ alert }: { alert: FarmAlert }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 ${ALERT_TONE[alert.tone]}`}>{ALERT_ICON[alert.kind]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-ink truncate">{alert.title}</p>
        <p className="text-[12px] text-muted truncate mt-0.5 tnum">{alert.detail}</p>
      </div>
      <button onClick={() => nav(alert.to)}
        className="shrink-0 inline-flex items-center gap-1 rounded-ctl border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink press hover:bg-sunk">
        {alert.actionLabel} <ChevronRight size={12} />
      </button>
    </div>
  );
}
