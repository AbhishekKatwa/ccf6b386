import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, Egg, Scale, Wallet, TrendingUp, Truck, Skull, Calendar, Check, Lock } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Card, EmptyState, GroupList, ListRow, IconTile, type Tone } from '@/components/ui/Card';
import { SelectField, Field } from '@/components/ui/Form';
import { fmtDate, todayISO } from '@/lib/format';

type ReportDef = {
  id: string; name: string; desc: string; icon: typeof FileText;
  kind: 'BROILER' | 'LAYER' | 'BOTH'; financeOnly?: boolean;
};

const BROILER: ReportDef[] = [
  { id: 'br_daily', name: 'Batch Daily Report', desc: 'Day-wise summary of all activities', icon: Calendar, kind: 'BROILER' },
  { id: 'br_mort', name: 'Mortality & Sale Report', desc: 'Track deaths and sales per batch', icon: Skull, kind: 'BROILER' },
  { id: 'br_feed', name: 'Feed Usage Report', desc: 'Batch-wise feed consumption', icon: FileText, kind: 'BROILER' },
  { id: 'br_weight', name: 'Weight, FCR & Production Cost', desc: 'Performance metrics per batch', icon: Scale, kind: 'BROILER' },
  { id: 'br_finance', name: 'Batch Finance Report', desc: 'Income, expenses, balance', icon: Wallet, kind: 'BROILER', financeOnly: true },
  { id: 'br_growth', name: 'Growth Chart Report', desc: 'Visual weight gain over time', icon: TrendingUp, kind: 'BROILER' },
  { id: 'br_sale', name: 'Batch Sale Report', desc: 'Complete sale transaction log', icon: Truck, kind: 'BROILER' },
];

const LAYER: ReportDef[] = [
  { id: 'ly_batch', name: 'Layer Batch Report', desc: 'Full production & sale summary', icon: Egg, kind: 'LAYER' },
  { id: 'ly_egg', name: 'Egg Production Report', desc: 'Day-wise egg collection data', icon: Egg, kind: 'LAYER' },
  { id: 'ly_sale', name: 'Egg Sales Report', desc: 'Trader-wise egg sales', icon: Truck, kind: 'LAYER' },
  { id: 'ly_feed', name: 'Feed Consumption Report', desc: 'Layer feed usage & FCR', icon: FileText, kind: 'LAYER' },
  { id: 'ly_mort', name: 'Mortality Report', desc: 'Layer mortality trend', icon: Skull, kind: 'LAYER' },
  { id: 'ly_finance', name: 'Finance Report', desc: 'Layer batch P&L', icon: Wallet, kind: 'LAYER', financeOnly: true },
];

export function ReportsScreen() {
  const nav = useNavigate();
  const batches = useApp(s => s.batches);
  const pushToast = useApp(s => s.pushToast);
  const canExport = useCan('exportReports');
  const canFinance = useCan('viewFinance');

  const [batchId, setBatchId] = useState(batches.find(b => b.status === 'LIVE')?.id ?? batches[0]?.id ?? '');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayISO());
  const [downloading, setDownloading] = useState<string | null>(null);

  const batch = batches.find(b => b.id === batchId);

  function download(r: ReportDef) {
    if (!canExport) { pushToast('error', 'You do not have export permission'); return; }
    if (r.financeOnly && !canFinance) { pushToast('error', 'Finance reports are restricted for your role'); return; }
    if (!batch) { pushToast('error', 'Select a batch first'); return; }
    setDownloading(r.id);
    setTimeout(() => {
      setDownloading(null);
      if (r.id === 'br_daily' || r.id === 'ly_batch') {
        nav(`/batches/${batch.id}/daily-report`);
      } else {
        pushToast('success', `${r.name} generated · ${fmtDate(from)} → ${fmtDate(to)}`);
      }
    }, 900);
  }

  function Section({ title, tone, items }: { title: string; tone: Tone; items: ReportDef[] }) {
    const visible = items.filter(r => !r.financeOnly || canFinance);
    if (visible.length === 0) return null;
    return (
      <div>
        <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">{title}</p>
        <GroupList>
          {visible.map(r => {
            const Icon = r.icon;
            const busy = downloading === r.id;
            return (
              <ListRow key={r.id} onClick={() => download(r)}
                leading={<IconTile tone={tone}><Icon size={17} /></IconTile>}
                title={r.name}
                subtitle={r.desc}
                trailing={
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${busy ? 'bg-success-soft text-success' : 'bg-sunk text-muted'}`}>
                    {busy ? <Check size={16} strokeWidth={2.5} /> : <Download size={16} />}
                  </span>
                } />
            );
          })}
        </GroupList>
      </div>
    );
  }

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Insights" title="Reports" subtitle="Broiler & layer exports" />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <div className="rounded-[22px] bg-brand text-white p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center flex-shrink-0">
              <FileText size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-lg">Amrut Reports</p>
              <p className="text-white/60 text-xs mt-0.5">{BROILER.length + LAYER.length} report types · PDF format</p>
            </div>
          </div>
        </div>

        <Card>
          <p className="font-display font-bold text-ink text-sm mb-3">Report parameters</p>
          <div className="space-y-3">
            <SelectField label="Batch" value={batchId} onChange={e => setBatchId(e.target.value)}
              options={batches.map(b => ({ value: b.id, label: `${b.code} · ${b.birdType}` }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} />
              <Field label="To" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
        </Card>

        {!batch ? (
          <EmptyState title="Select a batch" description="Choose a batch to generate reports." />
        ) : (
          <>
            <Section title="Broiler reports" tone="brand" items={BROILER} />
            <Section title="Layer reports" tone="accent" items={LAYER} />
          </>
        )}

        {!canExport && (
          <div className="flex items-start gap-3 rounded-2xl bg-accent-soft px-4 py-3">
            <Lock size={16} className="text-accent-ink flex-shrink-0 mt-0.5" />
            <p className="text-xs text-accent-ink leading-relaxed">
              <strong>Note:</strong> Your role does not include report export permission. Contact the farm OWNER to enable.
            </p>
          </div>
        )}
      </div>
    </Page>
  );
}
