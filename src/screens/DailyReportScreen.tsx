import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import { useApp, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { fmtIN, fmtDate, todayISO } from '@/lib/format';
import { batchAgeDays, cumulativeMortality, liveBirdsOn } from '@/lib/calc';
import { EGG_GRADES, EGG_GRADE_LABELS, EGGS_PER_TRAY, EMPTY_GRADE_COUNTS, type EggGradeCounts } from '@/types';

export function DailyReportScreen() {
  const { batchId } = useParams();
  const data = useCompanyData();
  const { batches, mortality, feed, eggs, farms, sheds, companies } = data;
  const pushToast = useApp(s => s.pushToast);
  const batch = batches.find(b => b.id === batchId);
  const company = companies.find(c => c.id === data.companyId);

  const rows = useMemo(() => {
    if (!batch) return [];
    const out: Array<{
      date: string; day: number; live: number; mort: number; mortPct: number;
      cumMort: number; cumMortPct: number;
      feedKg: number; cumFeedKg: number; feedPerBirdG: number;
      trays: number; eggs: number; byGrade: EggGradeCounts;
    }> = [];
    let cumFeedKg = 0;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const day = batchAgeDays(batch, date);
      const live = liveBirdsOn(batch, date, mortality);
      const mort = mortality.filter(x => x.batchId === batch.id && x.date === date).reduce((s, x) => s + x.count, 0);
      const cumMort = cumulativeMortality(batch.id, mortality, date);
      const feedT = feed.filter(x => x.batchId === batch.id && x.date === date).reduce((s, x) => s + x.tonnes, 0);
      const feedKg = Math.round(feedT * 1000);
      cumFeedKg += feedKg;
      const feedPerBirdG = live > 0 ? Math.round((feedKg * 1000) / live) : 0;
      const eggEntries = eggs.filter(x => x.shedId === batch.shedId && x.date === date);
      const byGrade: EggGradeCounts = { ...EMPTY_GRADE_COUNTS };
      for (const x of eggEntries) {
        byGrade.GOOD += x.goodTrays; byGrade.BROKEN += x.brokenTrays;
        byGrade.DOUBLE += x.doubleTrays; byGrade.SMALL += x.smallTrays;
      }
      const trays = byGrade.GOOD + byGrade.BROKEN + byGrade.DOUBLE + byGrade.SMALL;
      out.push({
        date, day, live, mort,
        mortPct: batch.initialBirds > 0 ? (mort / batch.initialBirds) * 100 : 0,
        cumMort,
        cumMortPct: batch.initialBirds > 0 ? (cumMort / batch.initialBirds) * 100 : 0,
        feedKg, cumFeedKg, feedPerBirdG,
        trays, eggs: trays * EGGS_PER_TRAY, byGrade,
      });
    }
    return out;
  }, [batch, mortality, feed, eggs]);

  if (!batch) return <Page><Header title="Daily report" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  const farm = farms.find(f => f.id === batch.farmId);
  const shed = sheds.find(s => s.id === batch.shedId);
  const isLayer = batch.birdType === 'LAYER';

  function print() {
    pushToast('info', 'Opening print dialog…');
    setTimeout(() => window.print(), 300);
  }

  return (
    <Page withNav>
      <Header title="Daily report" subtitle={`${batch.code} · printable summary`}
        action={<Button size="sm" variant="outline" icon={<Printer size={14} />} onClick={print}>Print</Button>} />

      <div className="px-4 sm:px-0 mt-3">
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
                  {['Day', 'Date', 'Live', 'Mort', 'Mort%', 'C.Mor', 'C.Mor%', 'Feed kg', 'C.Feed t', 'g/bird', ...(isLayer ? [...EGG_GRADES.map(g => EGG_GRADE_LABELS[g]), 'Trays', 'Eggs'] : [])].map(h => (
                    <th key={h} className="px-1.5 py-1.5 text-left font-semibold whitespace-nowrap uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.date} className={i === rows.length - 1 ? 'bg-accent-soft font-semibold' : i % 2 ? 'bg-sunk/40' : ''}>
                    <td className="px-1.5 py-1 whitespace-nowrap">D{r.day}</td>
                    <td className="px-1.5 py-1 whitespace-nowrap">{r.date.slice(8)}/{r.date.slice(5, 7)}</td>
                    <td className="px-1.5 py-1">{fmtIN(r.live)}</td>
                    <td className="px-1.5 py-1 text-danger">{r.mort}</td>
                    <td className="px-1.5 py-1">{r.mortPct.toFixed(3)}</td>
                    <td className="px-1.5 py-1">{fmtIN(r.cumMort)}</td>
                    <td className="px-1.5 py-1">{r.cumMortPct.toFixed(2)}</td>
                    <td className="px-1.5 py-1">{fmtIN(r.feedKg)}</td>
                    <td className="px-1.5 py-1">{(r.cumFeedKg / 1000).toFixed(2)}</td>
                    <td className="px-1.5 py-1">{r.feedPerBirdG}</td>
                    {isLayer && EGG_GRADES.map(g => <td key={g} className="px-1.5 py-1">{r.byGrade[g]}</td>)}
                    {isLayer && <td className="px-1.5 py-1">{fmtIN(r.trays)}</td>}
                    {isLayer && <td className="px-1.5 py-1">{fmtIN(r.eggs)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-line-2 bg-sunk/50">
            <p className="font-mono text-[10px] text-muted tnum">
              Week {Math.floor(rows[rows.length - 1]?.day / 7) ?? 0} · {rows[rows.length - 1]?.day ?? 0} days ·
              Confidential — internal use
            </p>
          </div>
        </Card>

        <Card className="mt-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2">30-day totals</p>
          <p className="text-[13px] text-muted leading-relaxed">
            Feed consumed: <strong className="text-ink font-mono tnum">{fmtIN((rows[rows.length - 1]?.cumFeedKg ?? 0) / 1000, 2)} t</strong> ·
            Mortality: <strong className="text-ink font-mono tnum">{fmtIN(rows[rows.length - 1]?.cumMort ?? 0)} birds</strong>
            {isLayer && <> · Eggs collected: <strong className="text-ink font-mono tnum">{fmtIN(rows.reduce((s, r) => s + r.eggs, 0))}</strong></>}
          </p>
        </Card>
      </div>
    </Page>
  );
}
