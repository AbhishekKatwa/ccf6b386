import { useState } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { BarChart3 } from 'lucide-react';
import { useApp } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, SectionTitle, StatStrip, StatCell, Stat, Delta } from '@/components/ui/Card';
import { SegmentedTabs } from '@/components/ui/Form';
import { AreaTrend, BarChart, Sparkline, CHART } from '@/components/ui/Charts';
import { fmtIN, fmtPct } from '@/lib/format';
import { useBatchMetrics, useDailySeries } from '@/hooks/useBatchMetrics';

type Range = 7 | 14 | 30;
type Metric = 'mortality' | 'mortalityCum' | 'feedPerBird' | 'feedBags' | 'eggsGood' | 'productionPct';

const METRICS: Record<Metric, { label: string; short: string; color: string; unit: string; invert?: boolean }> = {
  mortality: { label: 'Mortality (daily)', short: 'Mortality', color: CHART.danger, unit: 'birds', invert: true },
  mortalityCum: { label: 'Mortality (cumulative)', short: 'Cum. mortality', color: CHART.accent, unit: 'total', invert: true },
  feedPerBird: { label: 'Feed per bird', short: 'Feed/bird', color: CHART.brand, unit: 'g/day' },
  feedBags: { label: 'Feed bags used', short: 'Feed bags', color: CHART.success, unit: 'bags' },
  eggsGood: { label: 'Egg production', short: 'Eggs', color: CHART.accent, unit: 'eggs' },
  productionPct: { label: 'Production %', short: 'Production', color: CHART.brand, unit: '%' },
};

export function AnalyticsScreen() {
  const { batchId } = useParams();
  const batches = useApp(s => s.batches);
  const batch = batches.find(b => b.id === batchId);
  const m = useBatchMetrics(batchId);
  const [range, setRange] = useState<Range>(7);
  const [metric, setMetric] = useState<Metric>('mortality');
  const series = useDailySeries(batchId, range);

  if (!batch || !m) return <Page><Header title="Analytics" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;

  const isLayer = batch.birdType === 'LAYER';
  const availableMetrics: Metric[] = isLayer
    ? ['mortality', 'mortalityCum', 'feedPerBird', 'feedBags', 'eggsGood', 'productionPct']
    : ['mortality', 'mortalityCum', 'feedPerBird', 'feedBags'];

  const data = series[metric];
  const cfg = METRICS[metric];
  const latest = data[data.length - 1] ?? 0;
  const prev = data[data.length - 2] ?? latest;
  const delta = latest - prev;
  const hasData = data.some(v => v > 0);
  const fmtVal = (v: number) => metric === 'productionPct' ? fmtPct(v, 1) : fmtIN(v);

  return (
    <Page withNav>
      <Header title="Analytics" subtitle={`${batch.code} · ${m.age.label}`} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <SegmentedTabs value={String(range)} onChange={(v) => setRange(Number(v) as Range)} options={[
          { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' },
        ]} />

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
          {availableMetrics.map(k => (
            <button key={k} onClick={() => setMetric(k)}
              className={clsx(
                'flex-none py-1.5 px-3.5 rounded-full text-[12px] font-semibold transition-all whitespace-nowrap border press',
                metric === k ? 'text-white border-transparent' : 'bg-card text-muted border-line hover:border-brand hover:text-brand',
              )}
              style={metric === k ? { background: METRICS[k].color } : undefined}>
              {METRICS[k].short}
            </button>
          ))}
        </div>

        {hasData ? (
          <Card>
            <div className="flex items-center justify-between mb-1">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{cfg.label}</p>
              <Delta value={Number(delta.toFixed(metric === 'productionPct' ? 2 : 0))} invert={cfg.invert} />
            </div>
            {metric === 'feedBags' ? (
              <>
                <p className="font-display text-[24px] font-semibold tnum text-ink mb-2">{fmtVal(latest)} <span className="text-[12px] text-muted font-normal">{cfg.unit}</span></p>
                <BarChart data={data} labels={series.labels} color={cfg.color} height={92} />
              </>
            ) : (
              <AreaTrend data={data} labels={series.labels} color={cfg.color} height={140} format={fmtVal} />
            )}
          </Card>
        ) : (
          <EmptyState icon={<BarChart3 size={22} />} title="No data yet"
            description={`Start recording ${cfg.label.toLowerCase()} to see trends here.`} />
        )}

        <div>
          <SectionTitle>Batch snapshot</SectionTitle>
          <Card padded={false} className="overflow-hidden">
            <StatStrip>
              <StatCell><Stat label="Live birds" value={fmtIN(m.live)} tone="brand" size="md" /></StatCell>
              <StatCell><Stat label="Age" value={m.age.label} sub={m.age.dayLabel} tone="neutral" size="md" /></StatCell>
              {isLayer ? (
                <>
                  <StatCell><Stat label="Production" value={fmtPct(m.prodPct, 1)} tone="accent" size="md" /></StatCell>
                  <StatCell><Stat label="Eggs today" value={fmtIN(m.todaysEggs.total)} tone="success" size="md" /></StatCell>
                </>
              ) : (
                <>
                  <StatCell><Stat label="FCR" value={m.fcr.fcr ? m.fcr.fcr.toFixed(2) : '—'} tone="success" size="md" /></StatCell>
                  <StatCell><Stat label="Feed 30d" value={fmtIN(m.feed30.bags)} sub="bags" tone="accent" size="md" /></StatCell>
                </>
              )}
            </StatStrip>
          </Card>
        </div>

        <div>
          <SectionTitle>Other metrics</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {availableMetrics.filter(k => k !== metric).map(k => {
              const d = series[k];
              const c = METRICS[k];
              const v = d[d.length - 1] ?? 0;
              return (
                <button key={k} onClick={() => setMetric(k)} className="text-left press">
                  <Card>
                    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted">{c.short}</p>
                    <div className="flex items-end justify-between gap-2 mt-1">
                      <p className="font-display text-[19px] font-semibold tnum leading-none" style={{ color: c.color }}>
                        {k === 'productionPct' ? fmtPct(v, 1) : fmtIN(v)}
                        <span className="text-[10px] text-muted-2 font-normal ml-1">{c.unit}</span>
                      </p>
                    </div>
                    <div className="mt-2.5"><Sparkline data={d} color={c.color} width={120} height={34} /></div>
                  </Card>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Page>
  );
}
