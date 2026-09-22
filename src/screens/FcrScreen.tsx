import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Scale, Save } from 'lucide-react';
import { useApp } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, Row, Badge } from '@/components/ui/Card';
import { Button, Field, SegmentedTabs, ChipGroup } from '@/components/ui/Form';
import { fmtIN } from '@/lib/format';
import { useBatchMetrics } from '@/hooks/useBatchMetrics';
import type { Tone } from '@/components/ui/Card';

const BAG_WEIGHTS = ['25', '40', '50'];

function rating(fcr: number): { label: string; tone: Tone; color: string } | null {
  if (fcr <= 0) return null;
  if (fcr < 1.8) return { label: 'Excellent', tone: 'success', color: '#177245' };
  if (fcr < 2.2) return { label: 'Good', tone: 'accent', color: '#d9820b' };
  return { label: 'Needs attention', tone: 'danger', color: '#b3261e' };
}

export function FcrScreen() {
  const { batchId } = useParams();
  const batches = useApp(s => s.batches);
  const addWeight = useApp(s => s.addWeight);
  const pushToast = useApp(s => s.pushToast);
  const m = useBatchMetrics(batchId);
  const batch = batches.find(b => b.id === batchId);

  const [mode, setMode] = useState<'total' | 'avg'>('total');
  const [weight, setWeight] = useState('');
  const [birds, setBirds] = useState(m ? String(m.live) : '');
  const [bagWeight, setBagWeight] = useState<string>('50');
  const [numBags, setNumBags] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ feed: number; fcr: number; birdWeight: number } | null>(null);
  const [calculating, setCalculating] = useState(false);

  if (!batch || !m) return <Page><Header title="FCR" /><div className="px-4 sm:px-0"><EmptyState title="Batch not found" /></div></Page>;

  const bw = parseFloat(bagWeight) || 50;

  function calculate() {
    const e: Record<string, string> = {};
    const w = parseFloat(weight);
    const b = parseFloat(birds);
    const n = parseFloat(numBags);
    if (!w || w <= 0) e.weight = 'Enter a valid weight';
    if (mode === 'avg' && (!b || b <= 0)) e.birds = 'Enter number of birds';
    if (!n || n <= 0) e.bags = 'Enter number of bags';
    setErrors(e);
    if (Object.keys(e).length) { setResult(null); return; }

    setCalculating(true);
    setTimeout(() => {
      const totalFeed = n * bw;
      const totalBirdWeight = mode === 'total' ? w : w * b;
      const fcr = totalBirdWeight > 0 ? totalFeed / totalBirdWeight : 0;
      setResult({ feed: totalFeed, fcr: Number(fcr.toFixed(3)), birdWeight: totalBirdWeight });
      setCalculating(false);
    }, 250);
  }

  function saveAsWeightEntry() {
    if (!result || mode !== 'avg') return;
    const avg = parseFloat(weight);
    const sample = parseInt(birds, 10);
    addWeight({ batchId: batch!.id, date: new Date().toISOString().slice(0, 10), sampleSize: sample, avgWeightKg: avg });
    pushToast('success', 'Weight entry saved to batch');
  }

  const r = result ? rating(result.fcr) : null;

  return (
    <Page withNav>
      <Header title="FCR calculator" subtitle={`${batch.code} · ${m.age.label}`} />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <SegmentedTabs value={mode} onChange={(v) => { setMode(v); setResult(null); }} options={[
          { value: 'total', label: 'Total weight' },
          { value: 'avg', label: 'Average weight' },
        ]} />

        <Card>
          <div className="space-y-3.5">
            <Field
              label={mode === 'total' ? 'Total birds weight (kg)' : 'Average weight per bird (kg)'}
              type="number" inputMode="decimal" value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder={mode === 'total' ? 'e.g. 45000' : 'e.g. 1.85'}
              className="font-mono" error={errors.weight}
            />
            {mode === 'avg' && (
              <Field label="Number of birds" type="number" inputMode="numeric" value={birds}
                onChange={e => setBirds(e.target.value)} placeholder="e.g. 29994"
                className="font-mono" error={errors.birds}
                hint={`Live birds in batch: ${fmtIN(m.live)}`} />
            )}
            <div>
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Feed bag weight</span>
              <ChipGroup value={bagWeight} onChange={setBagWeight} options={BAG_WEIGHTS.map(w => ({ value: w, label: `${w} kg` }))} />
            </div>
            <Field label="Number of feed bags" type="number" inputMode="numeric" value={numBags}
              onChange={e => setNumBags(e.target.value)} placeholder="e.g. 480"
              className="font-mono" error={errors.bags} />
          </div>
        </Card>

        <Button block size="lg" onClick={calculate} loading={calculating} icon={<Scale size={16} />}>Calculate FCR</Button>

        {result && r && (
          <Card padded={false} className="overflow-hidden ap-rise">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">FCR result</p>
                <Badge tone={r.tone}>{r.label}</Badge>
              </div>
              <div className="flex items-end gap-2">
                <p className="font-display text-[56px] leading-none font-semibold tnum tracking-tight" style={{ color: r.color }}>{result.fcr}</p>
                <p className="text-muted text-[13px] mb-2">FCR</p>
              </div>
              <div className="mt-4">
                <div className="flex justify-between font-mono text-[9px] uppercase tracking-wide text-muted mb-1.5">
                  <span>Excellent &lt;1.8</span><span>Good 1.8–2.2</span><span>Poor &gt;2.2</span>
                </div>
                <div className="h-2 rounded-full bg-gradient-to-r from-success via-accent to-danger relative">
                  <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-card border-2 shadow-card transition-all"
                    style={{ borderColor: r.color, left: `${Math.min(Math.max(((result.fcr - 1.4) / 1.2) * 100, 0), 100)}%` }} />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-line-2 bg-sunk/50">
              <Row label="Total feed used" value={`${fmtIN(result.feed)} kg`} />
              <Row label="Total bird weight" value={`${fmtIN(result.birdWeight)} kg`} />
              <Row label="Calculation" value={`${fmtIN(parseFloat(numBags))} × ${bw} kg ÷ ${fmtIN(result.birdWeight)} kg`} />
            </div>
            {mode === 'avg' && (
              <div className="px-5 py-4">
                <Button variant="outline" block icon={<Save size={15} />} onClick={saveAsWeightEntry}>Save as weight entry</Button>
              </div>
            )}
          </Card>
        )}

        <Card className="bg-brand-soft border-brand/10">
          <p className="text-[13px] text-brand-ink leading-relaxed">
            <strong className="font-semibold">Batch live FCR:</strong> {m.fcr.fcr ? m.fcr.fcr.toFixed(2) : '—'} ·
            total feed {fmtIN(m.fcr.totalFeedKg)} kg · total bird weight {fmtIN(m.fcr.totalBirdWeightKg)} kg
          </p>
        </Card>
      </div>
    </Page>
  );
}
