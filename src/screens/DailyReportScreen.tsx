import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Printer } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { fmtIN, fmtPct, fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { batchAgeDays, cumulativeMortality, liveBirdsOn } from '@/lib/calc';

export function DailyReportScreen() {
  const { batchId } = useParams();
  const batches = useApp(s => s.batches);
  const mortality = useApp(s => s.mortality);
  const feed = useApp(s => s.feed);
  const eggs = useApp(s => s.eggs);
  const weights = useApp(s => s.weights);
  const farms = useApp(s => s.farms);
  const sheds = useApp(s => s.sheds);
  const pushToast = useApp(s => s.pushToast);
  const canFinance = useCan('viewFinance');
  const batch = batches.find(b => b.id === batchId);

  const rows = useMemo(() => {
    if (!batch) return [];
    const out: Array<{
      date: string; day: number; live: number; mort: number; mortPct: number;
      cumMort: number; cumMortPct: number; feedBags: number; cumBags: number;
      feedPerBirdG: number; weightG: number; fcr: number; eggs: number; prodPct: number;
    }> = [];
    let cumBags = 0;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const day = batchAgeDays(batch, date);
      const live = liveBirdsOn(batch, date, mortality);
      const mort = mortality.filter(x => x.batchId === batch.id && x.date === date).reduce((s, x) => s + x.count, 0);
      const cumMort = cumulativeMortality(batch.id, mortality, date);
      const bags = feed.filter(x => x.batchId === batch.id && x.date === date).reduce((s, x) => s + x.bags, 0);
      cumBags += bags;
      const feedKg = bags * 50;
      const feedPerBirdG = live > 0 ? Math.round((feedKg * 1000) / live) : 0;
      const w = weights.filter(x => x.batchId === batch.id && x.date <= date).sort((a, b) => a.date.localeCompare(b.date)).pop();
      const weightG = w ? Math.round(w.avgWeightKg * 1000) : 0;
      const cumFeedKg = feed.filter(x => x.batchId === batch.id && x.date <= date).reduce((s, x) => s + x.bags * x.bagWeightKg, 0);
      const cumBirdWeight = live * (w?.avgWeightKg ?? 0);
      const fcr = cumBirdWeight > 0 ? cumFeedKg / cumBirdWeight : 0;
      const eggEntries = eggs.filter(x => x.batchId === batch.id && x.date === date);
      const eggTotal = eggEntries.reduce((s, x) => s + x.good + x.damaged + x.cracked, 0);
      const prodPct = live > 0 ? (eggTotal / live) * 100 : 0;
      out.push({
        date, day, live, mort,
        mortPct: batch.initialBirds > 0 ? (mort / batch.initialBirds) * 100 : 0,
        cumMort,
        cumMortPct: batch.initialBirds > 0 ? (cumMort / batch.initialBirds) * 100 : 0,
        feedBags: bags, cumBags, feedPerBirdG, weightG, fcr,
        eggs: eggTotal, prodPct,
      });
    }
    return out;
  }, [batch, mortality, feed, eggs, weights]);

  if (!batch) return <Page><Header title="Daily report" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;
  const farm = farms.find(f => f.id === batch.farmId);
  const shed = sheds.find(s => s.id === batch.shedId);

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
            <p className="font-display font-semibold text-[15px] tracking-tight">Amrut Poultry Management</p>
            <p className="font-mono text-[10px] text-white/60 mt-1 tnum">
              {farm?.name} · {shed?.name} · Batch {batch.code} · Generated {fmtDate(todayISO())}
            </p>
          </div>

          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-[9px] font-mono tnum" style={{ minWidth: 720 }}>
              <thead>
                <tr className="bg-brand-2 text-white">
                  {['Day', 'Date', 'Live', 'Mort', 'Mort%', 'C.Mor', 'C.Mor%', 'Bags', 'CumBags', 'F/B(g)', 'Wt(g)', 'FCR', batch.birdType === 'LAYER' ? 'Eggs' : '—', batch.birdType === 'LAYER' ? 'Prod%' : '—'].map(h => (
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
                    <td className="px-1.5 py-1">{r.feedBags}</td>
                    <td className="px-1.5 py-1">{fmtIN(r.cumBags)}</td>
                    <td className="px-1.5 py-1">{r.feedPerBirdG}</td>
                    <td className="px-1.5 py-1">{r.weightG || '—'}</td>
                    <td className="px-1.5 py-1">{r.fcr ? r.fcr.toFixed(2) : '—'}</td>
                    <td className="px-1.5 py-1">{batch.birdType === 'LAYER' ? fmtIN(r.eggs) : '—'}</td>
                    <td className="px-1.5 py-1">{batch.birdType === 'LAYER' ? r.prodPct.toFixed(2) : '—'}</td>
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

        {canFinance && (
          <Card className="mt-3">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted mb-2">Production cost estimate</p>
            <p className="text-[13px] text-muted leading-relaxed">
              Total feed consumed: <strong className="text-ink font-mono tnum">{fmtIN(rows.reduce((s, r) => s + r.feedBags, 0))} bags</strong> ·
              approx cost: <strong className="text-ink font-mono tnum">{fmtMoney(rows.reduce((s, r) => s + r.feedBags, 0) * 50 * 25)}</strong>
            </p>
          </Card>
        )}
      </div>
    </Page>
  );
}
