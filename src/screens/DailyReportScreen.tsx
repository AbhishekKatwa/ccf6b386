import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import clsx from 'clsx';
import { useApp, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { fmtIN, fmtDate, todayISO } from '@/lib/format';
import { buildDailyReport, dailyReportTotals } from '@/lib/dailyReport';
import { EGG_GRADES, EGG_GRADE_LABELS } from '@/types';
import { PageReveal } from '@/components/motion';

export function DailyReportScreen() {
  const { batchId } = useParams();
  const data = useCompanyData();
  const { batches, mortality, feed, eggs, farms, sheds, companies } = data;
  const pushToast = useApp(s => s.pushToast);
  const batch = batches.find(b => b.id === batchId);
  const company = companies.find(c => c.id === data.companyId);

  const rows = useMemo(
    () => (batch ? buildDailyReport({ batch, mortality, feed, eggs }) : []),
    [batch, mortality, feed, eggs],
  );
  const totals = useMemo(() => dailyReportTotals(rows), [rows]);

  if (!batch) return <Page><Header title="Daily report" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  const farm = farms.find(f => f.id === batch.farmId);
  const shed = sheds.find(s => s.id === batch.shedId);
  const isLayer = batch.birdType === 'LAYER';
  const last = rows[rows.length - 1];

  function print() {
    pushToast('info', 'Opening print dialog…');
    setTimeout(() => window.print(), 300);
  }

  return (
    <Page withNav>
      <Header title="Daily report" subtitle={`${batch.code} · printable summary`}
        action={<Button size="sm" variant="outline" icon={<Printer size={14} />} onClick={print}>Print</Button>} />

      <PageReveal className="px-4 sm:px-0 mt-3">
        <Card padded={false} className="overflow-hidden">
          <div className="px-4 py-3.5 bg-brand text-white">
            <p className="font-display font-semibold text-[15px] tracking-tight">{company?.name ?? 'Poultry Management'}</p>
            <p className="font-mono text-[10px] text-white/60 mt-1 tnum">
              {farm?.name} · {shed?.name} · Batch {batch.code} · Generated {fmtDate(todayISO())}
            </p>
          </div>

          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-[9px] font-mono tnum" style={{ minWidth: 760 }}>
              <thead>
                <tr className="bg-brand-2 text-white">
                  {['Day', 'Date', 'Live', 'Mort', 'Mort%', 'C.Mor', 'C.Mor%', 'Feed kg', 'C.Feed t', 'g/bird', ...(isLayer ? [...EGG_GRADES.map(g => EGG_GRADE_LABELS[g]), 'Trays', 'Eggs'] : [])].map((h, hi) => (
                    <th key={h} className={clsx('px-1.5 py-1.5 font-semibold whitespace-nowrap uppercase tracking-wide', hi > 1 ? 'text-right' : 'text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.date} className={i === rows.length - 1 ? 'bg-accent-soft font-semibold' : i % 2 ? 'bg-sunk/40' : ''}>
                    <td className="px-1.5 py-1 whitespace-nowrap">D{r.day}</td>
                    <td className="px-1.5 py-1 whitespace-nowrap">{r.date.slice(8)}/{r.date.slice(5, 7)}</td>
                    <td className="px-1.5 py-1 text-right">{fmtIN(r.live)}</td>
                    <td className="px-1.5 py-1 text-right text-danger">{r.mort}</td>
                    <td className="px-1.5 py-1 text-right">{r.mortPct.toFixed(3)}</td>
                    <td className="px-1.5 py-1 text-right">{fmtIN(r.cumMort)}</td>
                    <td className="px-1.5 py-1 text-right">{r.cumMortPct.toFixed(2)}</td>
                    <td className="px-1.5 py-1 text-right">{fmtIN(r.feedKg)}</td>
                    <td className="px-1.5 py-1 text-right">{(r.cumFeedKg / 1000).toFixed(2)}</td>
                    <td className="px-1.5 py-1 text-right">{r.feedPerBirdG}</td>
                    {isLayer && EGG_GRADES.map(g => <td key={g} className="px-1.5 py-1 text-right">{r.byGrade[g]}</td>)}
                    {isLayer && <td className="px-1.5 py-1 text-right">{fmtIN(r.trays)}</td>}
                    {isLayer && <td className="px-1.5 py-1 text-right">{fmtIN(r.eggs)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-line-2 bg-sunk/50">
            <p className="font-mono text-[10px] text-muted tnum">
              Week {Math.floor((last?.day ?? 0) / 7)} · {last?.day ?? 0} days ·
              Confidential — internal use
            </p>
          </div>
        </Card>

        <Card className="mt-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2">30-day totals</p>
          <p className="text-[13px] text-muted leading-relaxed">
            Feed consumed: <strong className="text-ink font-mono tnum">{fmtIN(totals.feedTonnes, 2)} t</strong> ·
            Mortality: <strong className="text-ink font-mono tnum">{fmtIN(totals.mortality)} birds</strong>
            {isLayer && <> · Eggs collected: <strong className="text-ink font-mono tnum">{fmtIN(totals.eggs)}</strong></>}
          </p>
        </Card>
      </PageReveal>
    </Page>
  );
}
