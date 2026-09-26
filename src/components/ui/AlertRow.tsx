import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarRange, ClipboardList, Egg, Handshake, Pill, Receipt, RefreshCw,
  Skull, Syringe, Wheat,
} from 'lucide-react';
import type { AlertKind, AlertSeverity, FarmAlert } from '@/lib/alerts';

/** Severity is operational standing only: what stops the farm, what will, what is worth knowing. */
export const SEVERITY_CHIP: Record<AlertSeverity, string> = {
  critical: 'bg-danger-soft text-danger',
  warning: 'bg-warn-soft text-warn',
  info: 'bg-sunk text-muted',
};

const ICON: Record<AlertKind, ReactNode> = {
  vaccination: <Syringe size={15} />,
  log: <Egg size={15} />,
  mortality: <Skull size={15} />,
  stock: <Wheat size={15} />,
  'stock-issue': <AlertTriangle size={15} />,
  medicine: <Pill size={15} />,
  planner: <CalendarRange size={15} />,
  receivable: <Handshake size={15} />,
  payable: <Receipt size={15} />,
  sync: <RefreshCw size={15} />,
  tasks: <ClipboardList size={15} />,
};

/**
 * One alert row — shared by the dashboard band and the Alerts page. It offers the action
 * the record actually needs: a screen that owns it, or the sync retry that belongs here.
 * A row with neither simply tells you what is waiting.
 */
export function AlertRow({ alert }: { alert: FarmAlert }) {
  const nav = useNavigate();
  const act = alert.run ? () => alert.run?.() : alert.to ? () => nav(alert.to!) : null;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 ${SEVERITY_CHIP[alert.severity]}`}>
        {ICON[alert.kind]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-ink truncate">{alert.title}</p>
        <p className="text-[12px] text-muted truncate mt-0.5 tnum">{alert.detail}</p>
      </div>
      {act && (
        <button onClick={act}
          className="shrink-0 inline-flex items-center gap-1 rounded-ctl border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink press hover:bg-sunk">
          {alert.actionLabel}
        </button>
      )}
    </div>
  );
}
