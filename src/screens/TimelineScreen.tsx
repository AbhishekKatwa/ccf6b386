import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { History, RotateCcw } from 'lucide-react';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Card, EmptyState, GroupList, Skeleton } from '@/components/ui/Card';
import { Button, ChipGroup, Field, SelectField } from '@/components/ui/Form';
import { TimelineRow } from '@/components/ui/TimelineRow';
import { CATEGORY_LABEL, TIMELINE_CATEGORIES, categoriesFor, type TimelineCategory, type TimelineEvent } from '@/lib/timeline';
import { useTimeline, useTimelineAccess } from '@/hooks/useTimeline';
import { useCompanyData, useVisibleSheds } from '@/store/app';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { DATE_PRESETS, rangeLabel, reportRange, type DatePreset, type ReportParams } from '@/lib/reports';
import { dayGroupLabel } from '@/lib/movements';
import { fmtDate, fmtIN, shiftDate, todayISO } from '@/lib/format';
import { PageReveal, StaggerContainer, StaggerItem } from '@/components/motion';

/** A day's worth of the farm, in the order it happened. */
const PAGE = 60;

const ALL = 'ALL';
type Cat = typeof ALL | TimelineCategory;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  params: ReportParams;
  shedId?: string;
  batchId?: string;
  by?: string;
  cat: Cat;
}

/** The read lives in the address, so a Tuesday can be linked to and come back to. */
function readFilters(search: string, today: string): Filters {
  const q = new URLSearchParams(search);
  const iso = (v: string | null, fallback: string) => (v && ISO.test(v) ? v : fallback);
  const cat = q.get('cat');
  return {
    params: {
      preset: DATE_PRESETS.find(d => d.value === q.get('preset'))?.value ?? '30D',
      from: iso(q.get('from'), shiftDate(today, -29)),
      to: iso(q.get('to'), today),
    },
    shedId: q.get('shed') || undefined,
    batchId: q.get('batch') || undefined,
    by: q.get('by') || undefined,
    cat: cat && (TIMELINE_CATEGORIES as string[]).includes(cat) ? cat as TimelineCategory : ALL,
  };
}

/**
 * What the farm did, in order — one line per record, derived from the records themselves.
 *
 * There is no second history behind this screen: an egg collection, a feed issue, a godown
 * receipt, a dose drawn, a dispatch note, a voucher, a money row, a batch placed or an edit
 * the audit trail kept are each read once from the table that owns them, and each line opens
 * that screen. So the filters only choose which records are read, and a line can never disagree
 * with the record it names.
 *
 * What the reader's role cannot open is not listed at all: no money without the finance view,
 * no shelf line without the godown, no draw without the medicine store — and a shed the reader
 * is not assigned to never appears.
 */
export function TimelineScreen() {
  const nav = useNavigate();
  const loc = useLocation();
  const today = todayISO();
  const data = useCompanyData();
  const sheds = useVisibleSheds();
  const access = useTimelineAccess();
  const sync = useSyncStatus();

  const f = useMemo(() => readFilters(loc.search, today), [loc.search, today]);
  const range = useMemo(() => reportRange(f.params, today), [f.params, today]);
  const events = useTimeline({ from: range.from, to: range.to });

  const set = (over: Partial<Record<'preset' | 'from' | 'to' | 'shed' | 'batch' | 'by' | 'cat', string>>) => {
    const next: Record<string, string | undefined> = {
      preset: f.params.preset, from: f.params.from, to: f.params.to,
      shed: f.shedId, batch: f.batchId, by: f.by, cat: f.cat === ALL ? undefined : f.cat,
      ...over,
    };
    // A preset names its own window. Leaving the previous dates beside it would make the
    // address describe a range the screen is not showing.
    if (over.preset && over.preset !== 'CUSTOM') {
      const span = reportRange({ ...f.params, preset: over.preset as DatePreset }, today);
      next.from = span.from;
      next.to = span.to;
    }
    const q = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v); else q.delete(k);
    }
    nav({ search: q.toString() }, { replace: true });
  };

  /** Every line the window and the role allow, before the picker filters narrow it. */
  const match = useMemo(() => events.filter(e =>
    (!f.shedId || e.shedId === f.shedId)
    && (!f.batchId || e.batchId === f.batchId)
    && (!f.by || e.userId === f.by)
    && (f.cat === ALL || e.category === f.cat)), [events, f]);

  /** Whether this farm has any record at all: a quiet day is not an empty company. */
  const everRecorded = useMemo(() => [
    data.eggs, data.eggWastages, data.mortality, data.feed, data.feedRounds, data.feedStock,
    data.medicineStock, data.saleLogs, data.saleEntries, data.finance, data.cashHandovers,
    data.batches, data.vaccinations, data.audit,
  ].some(list => list.length > 0), [data]);

  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [loc.search]);

  const shedOptions = useMemo(() => sheds
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({ value: s.id, label: s.name })), [sheds]);

  const visibleSheds = useMemo(() => new Set(sheds.map(s => s.id)), [sheds]);
  const batchOptions = useMemo(() => {
    const nameOf = new Map(sheds.map(s => [s.id, s.name]));
    return data.batches
      .filter(b => visibleSheds.has(b.shedId))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(b => ({ value: b.id, label: `${b.code} · ${nameOf.get(b.shedId) ?? 'no shed'}` }));
  }, [data.batches, sheds, visibleSheds]);

  /** Only the people who actually appear in this window, so the picker is never a dead end. */
  const byOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) if (e.userId && e.by) seen.set(e.userId, e.by);
    return [...seen].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [events]);

  const cats = useMemo(() => categoriesFor(access), [access]);
  const catOptions = useMemo(() => [
    { value: ALL, label: 'All activity' },
    ...cats.map(c => ({ value: c, label: CATEGORY_LABEL[c] })),
  ], [cats]);

  const shown = match.slice(0, limit);
  const days = useMemo(() => {
    const out: { date: string; items: TimelineEvent[] }[] = [];
    for (const e of shown) {
      const last = out[out.length - 1];
      if (last && last.date === e.date) last.items.push(e);
      else out.push({ date: e.date, items: [e] });
    }
    return out;
  }, [shown]);

  const narrowing = !!(f.shedId || f.batchId || f.by || f.cat !== ALL);
  const remaining = match.length - shown.length;

  return (
    <Page withNav>
      <PageReveal>
      <ScreenTitle eyebrow="History" title="Farm timeline"
        subtitle={`${rangeLabel(range)} · ${fmtIN(match.length)} ${match.length === 1 ? 'line' : 'lines'}`} />

      <div className="px-4 sm:px-0 mt-1 space-y-4">
        {/* ---------- what is being read ---------- */}
        <Card>
          <ChipGroup value={f.params.preset} onChange={preset => set({ preset })} options={DATE_PRESETS} />
          {f.params.preset === 'CUSTOM' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="From" type="date" value={f.params.from} max={f.params.to} onChange={e => set({ from: e.target.value })} />
              <Field label="To" type="date" value={f.params.to} max={today} onChange={e => set({ to: e.target.value })} />
            </div>
          )}

          <ChipGroup className="mt-3" value={f.cat} onChange={cat => set({ cat })} options={catOptions} />

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <SelectField label="Shed" value={f.shedId ?? ''} onChange={e => set({ shed: e.target.value || undefined })}
              options={[{ value: '', label: 'All sheds' }, ...shedOptions]} />
            <SelectField label="Batch" value={f.batchId ?? ''} onChange={e => set({ batch: e.target.value || undefined })}
              options={[{ value: '', label: 'All batches' }, ...batchOptions]} />
            <SelectField label="Person" value={f.by ?? ''} onChange={e => set({ by: e.target.value || undefined })}
              options={[{ value: '', label: 'Anyone' }, ...byOptions]} />
          </div>

          {(narrowing || f.params.preset !== '30D') && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-2 pt-2.5">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-2">Read on</span>
              <span className="font-mono text-[11px] text-ink-2 tnum">{rangeLabel(range)}</span>
              {narrowing && (
                <button type="button" onClick={() => nav('/timeline', { replace: true })}
                  className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-1 font-mono text-[10px] text-ink-2 press hover:text-brand">
                  <RotateCcw size={11} /> Clear filters
                </button>
              )}
            </div>
          )}
        </Card>

        {sync.syncing && (
          <Card>
            <div className="space-y-2.5" aria-busy="true">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-[38px] shrink-0" />
                  <Skeleton className="h-8 w-8 shrink-0 rounded-[11px]" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-[45%]" />
                    <Skeleton className="h-3 w-[65%]" />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-muted">Reading the records this device does not have yet.</p>
          </Card>
        )}

        {/* ---------- one block per day, newest day first, morning leading inside it ---------- */}
        {match.length === 0 ? (
          !everRecorded ? (
            <EmptyState icon={<History size={19} strokeWidth={1.75} />}
              title="Nothing has been recorded yet"
              description="This timeline is written by the farm's own records — collections, feed issues, godown and medicine movements, dispatch notes, sales, money rows and batch events appear here as they are booked." />
          ) : (
            <EmptyState icon={<History size={19} strokeWidth={1.75} />}
              title="No lines match this reading"
              description="The records exist, but none of them fall inside these filters. Widen the dates or clear the filters to see them."
              action={<Button variant="outline" size="sm" icon={<RotateCcw size={14} />}
                onClick={() => nav('/timeline', { replace: true })}>Clear filters</Button>} />
          )
        ) : (
          <StaggerContainer className="space-y-5">
            {days.map(d => (
              <StaggerItem key={d.date}>
                <div>
                  <div className="flex items-baseline justify-between gap-3 px-0.5 mb-1.5">
                    <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-2">
                      {dayGroupLabel(d.date, today) ?? fmtDate(d.date)}
                    </p>
                    <p className="font-mono text-[10px] text-faint tnum shrink-0">
                      {fmtIN(d.items.length)} {d.items.length === 1 ? 'line' : 'lines'}
                    </p>
                  </div>
                  <GroupList>
                    {d.items.map((e, i) => <TimelineRow key={e.id} event={e} last={i === d.items.length - 1} />)}
                  </GroupList>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}

        {remaining > 0 && (
          <button type="button" onClick={() => setLimit(v => v + PAGE)}
            className="w-full rounded-[14px] border border-dashed border-line py-2.5 text-[12.5px] font-semibold text-brand press hover:bg-sunk/60">
            Show {fmtIN(Math.min(PAGE, remaining))} earlier · {fmtIN(remaining)} more in this window
          </button>
        )}

        {match.length > 0 && (
          <p className="text-[11px] text-faint leading-relaxed flex items-start gap-1.5">
            <History size={12} className="shrink-0 mt-0.5" />
            Each line is one record read from the screen that owns it, so nothing here is stored twice
            and no line can disagree with its source. Only the modules your role opens are listed, and
            figures appear only where your role may read them.
          </p>
        )}

        {sync.pending > 0 && (
          <div className="rounded-[14px] border border-dashed border-warn/45 bg-warn-soft/60 px-4 py-3 flex items-center gap-3">
            <p className="flex-1 min-w-0 text-[12px] text-ink-2 leading-relaxed">
              {fmtIN(sync.pending)} {sync.pending === 1 ? 'change is' : 'changes are'} still held on this
              device. They are in this read; anything booked elsewhere since may be missing from it.
            </p>
            <button type="button" onClick={sync.retry}
              className="shrink-0 inline-flex items-center gap-1 rounded-ctl border border-line bg-card px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink press hover:bg-sunk">
              Retry
            </button>
          </div>
        )}
      </div>
      </PageReveal>
    </Page>
  );
}
