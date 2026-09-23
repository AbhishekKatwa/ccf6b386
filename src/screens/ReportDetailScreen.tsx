import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Download, FileText, Link2, X } from 'lucide-react';
import clsx from 'clsx';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, KpiCard, SectionTitle } from '@/components/ui/Card';
import { Button, ChipGroup, Field, SelectField } from '@/components/ui/Form';
import { GraphCard } from '@/components/charts/GraphCard';
import { axisNum, HBarList, PairedBars, TrendChart, type HRow, type VSeries } from '@/components/charts/DataViz';
import { CHART } from '@/components/ui/Charts';
import { godownIngredients, type Range } from '@/lib/analytics';
import { fmtDate, fmtIN, todayISO } from '@/lib/format';
import {
  DATE_PRESETS, REPORT_BY_ID, makeCtx, paramsFromSearch, rangeLabel, reportCsv, reportFileName,
  reportRange, scopeParams, searchFromParams,
  type ReportChart, type ReportDef, type ReportFormat, type ReportParam, type ReportParams,
  type ReportResult, type ReportSource, type ReportTable,
} from '@/lib/reports';

/**
 * A report as a statement rather than a preview: the parameters it was read on, the
 * figures that settle it, the history behind them, then every row in the order a reader
 * would check. Each row still points at the record it came from, so a report is a way
 * into the data — never a second copy of it.
 */
export function ReportDetailScreen() {
  const nav = useNavigate();
  const loc = useLocation();
  const { reportId } = useParams();
  const data = useCompanyData();
  const canFinance = useCan('viewFinance');
  const canExport = useCan('exportReports');
  const pushToast = useApp(s => s.pushToast);

  const def = reportId ? REPORT_BY_ID.get(reportId) : undefined;
  const today = todayISO();

  // The filter bar lives in the address, so a report can be linked to and come back to.
  const raw = useMemo(() => paramsFromSearch(loc.search, today), [loc.search, today]);
  const p = useMemo(() => (def ? scopeParams(def, raw) : raw), [def, raw]);
  const range = useMemo(() => reportRange(p, today), [p, today]);

  const set = (over: Partial<ReportParams>) => {
    if (!def) return;
    nav({ search: searchFromParams(def, scopeParams(def, { ...p, ...over })) }, { replace: true });
  };

  /** One filter at a time, so a report never sets a scope it cannot read. */
  const setParam = (param: ReportParam, value: string) => {
    const patch: Partial<ReportParams> = { [KEY[param]]: value || undefined };
    set(patch);
  };

  const options = useMemo(() => (def ? filterOptions(def, data) : {}), [def, data]);

  const missing = def?.needs?.filter(param => !p[KEY[param]]) ?? [];
  const report = useMemo(() => {
    if (!def?.build || missing.length) return null;
    return def.build(makeCtx(data, p, range, canFinance));
  }, [def, data, p, range, canFinance, missing.length]);

  if (!def) {
    return (
      <Page>
        <Header title="Report" backTo="/reports" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState
            title="That report does not exist"
            description="It may have been renamed. Every statement this role can open is listed under Reports."
            action={<Button variant="outline" icon={<ArrowLeft size={14} />} onClick={() => nav('/reports')}>Back to Reports</Button>}
          />
        </div>
      </Page>
    );
  }

  if (def.financeOnly && !canFinance) {
    return (
      <Page>
        <Header title={def.title} backTo="/reports" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState
            title="This statement carries money"
            description="Your role does not include the finance view, so the figures are withheld whole rather than shown as blanks."
          />
        </div>
      </Page>
    );
  }

  const presetLabel = DATE_PRESETS.find(d => d.value === p.preset)?.label ?? '';

  return (
    <Page withNav>
      <Header
        title={def.title}
        subtitle={def.allTime ? 'Every record on file' : rangeLabel(range)}
        backTo="/reports"
        action={report?.tables.some(t => t.rows.length) && canExport ? (
          <Button variant="outline" size="sm" icon={<Download size={14} />}
            onClick={() => exportCsv(def, range, report, pushToast)}>
            CSV
          </Button>
        ) : undefined}
      />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <p className="text-[12.5px] text-muted leading-relaxed">{def.desc}</p>

        {/* ---------- what this statement is being read on ---------- */}
        <Card>
          <SectionTitle right={
            <span className="font-mono text-[10px] text-muted tnum">
              {def.allTime ? 'No date window' : presetLabel}
            </span>
          }>
            Report parameters
          </SectionTitle>

          {!def.allTime && (
            <>
              <ChipGroup value={p.preset} onChange={preset => set({ preset })} options={DATE_PRESETS} />
              {p.preset === 'CUSTOM' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="From" type="date" value={p.from} max={p.to} onChange={e => set({ from: e.target.value })} />
                  <Field label="To" type="date" value={p.to} max={today} onChange={e => set({ to: e.target.value })} />
                </div>
              )}
            </>
          )}

          {def.params.length > 0 && (
            <div className={clsx('mt-3 grid gap-3', def.params.length > 2 ? 'sm:grid-cols-2 xl:grid-cols-4' : def.params.length === 2 ? 'sm:grid-cols-2' : 'sm:max-w-[320px]')}>
              {def.params.map(param => (
                <SelectField
                  key={param}
                  label={LABEL[param]}
                  value={p[KEY[param]] ?? ''}
                  onChange={e => setParam(param, e.target.value)}
                  options={[{ value: '', label: ALL_OF[param] }, ...(options[param] ?? [])]}
                />
              ))}
            </div>
          )}

          <ScopeLine def={def} p={p} range={range} data={data} onClear={param => setParam(param, '')} />
        </Card>

        {missing.length > 0 ? (
          <NeedsGate param={missing[0]} options={options[missing[0]] ?? []} onPick={id => setParam(missing[0], id)} />
        ) : !report ? (
          <EmptyState
            icon={<FileText size={19} strokeWidth={1.75} />}
            title="Nothing to state yet"
            description="This company has no record this report could read. Nothing here is assumed or filled in."
          />
        ) : (
          <>
            {report.summary.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {report.summary.map(m => (
                  <KpiCard
                    key={m.label} label={m.label} value={m.value} foot={m.foot}
                    valueTone={m.tone === 'danger' ? 'danger' : m.tone === 'success' ? 'success' : m.tone === 'warn' ? 'warn' : undefined}
                    footTone={m.tone === 'danger' ? 'danger' : m.tone === 'success' ? 'success' : m.tone === 'warn' ? 'warn' : 'muted'}
                  />
                ))}
              </div>
            )}

            {report.warnings.length > 0 && (
              <div className="rounded-[14px] border border-dashed border-warn/45 bg-warn-soft/60 px-4 py-3">
                <p className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-warn">
                  <AlertTriangle size={13} /> What this report could not read
                </p>
                <ul className="mt-1.5 space-y-1">
                  {report.warnings.map((w, i) => <li key={i} className="text-[12px] text-ink-2 leading-relaxed">{w}</li>)}
                </ul>
              </div>
            )}

            {report.charts.length === 1
              ? <ChartBlock chart={report.charts[0]} />
              : report.charts.length > 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {report.charts.map(c => <ChartBlock key={c.id} chart={c} />)}
                </div>
              )}

            {report.tables.map((t, i) => <TableBlock key={i} table={t} onOpen={href => nav(href)} />)}

            {report.notes.length > 0 && (
              <Card>
                <SectionTitle>How these figures were arrived at</SectionTitle>
                <ul className="mt-1 space-y-1.5">
                  {report.notes.map((n, i) => <li key={i} className="text-[12px] text-muted leading-relaxed">{n}</li>)}
                </ul>
              </Card>
            )}

            {report.links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {report.links.map(l => (
                  <button
                    key={l.href} type="button" onClick={() => nav(l.href)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-card border border-line text-[12px] font-semibold text-brand press hover:border-brand/45"
                  >
                    <Link2 size={13} /> {l.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

/* ============================= SCOPE ============================= */

const KEY = { shed: 'shedId', batch: 'batchId', trader: 'traderId', ingredient: 'ingredient' } as const;
const LABEL = { shed: 'Shed', batch: 'Batch', trader: 'Buyer', ingredient: 'Ingredient' } as const;
const ALL_OF = { shed: 'All sheds', batch: 'All batches', trader: 'All buyers', ingredient: 'All ingredients' } as const;
const NEEDS_WORD = { shed: 'a shed', batch: 'a batch', trader: 'a buyer', ingredient: 'an ingredient' } as const;

/** A reader checks the scope before trusting a total, so the scope is stated in words. */
function ScopeLine({ def, p, range, data, onClear }: {
  def: ReportDef; p: ReportParams; range: Range; data: ReportSource; onClear: (param: ReportParam) => void;
}) {
  const active = (Object.keys(KEY) as ReportParam[]).filter(param => def.params.includes(param) && p[KEY[param]]);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-2 pt-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-2">Read on</span>
      <span className="font-mono text-[11px] text-ink-2 tnum">
        {def.allTime ? `all records on file · latest ${fmtDate(range.to)}` : rangeLabel(range)}
      </span>
      {active.map(param => (
        <button
          key={param} type="button" onClick={() => onClear(param)}
          className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-1 font-mono text-[10px] text-ink-2 press hover:text-brand min-w-0"
        >
          {LABEL[param]}: <span className="truncate max-w-[130px]">{scopeText(param, p[KEY[param]], data)}</span>
          <X size={11} className="text-muted shrink-0" />
        </button>
      ))}
    </div>
  );
}

/** The name a scope chip carries, read from the records rather than shown as a raw id. */
function scopeText(param: ReportParam, id: string | undefined, data: ReportSource): string {
  if (!id) return '—';
  if (param === 'ingredient') return id;
  if (param === 'shed') return data.sheds.find(s => s.id === id)?.name ?? 'not on file';
  if (param === 'batch') return data.batches.find(b => b.id === id)?.code ?? 'not on file';
  return data.traders.find(t => t.id === id)?.name ?? 'not on file';
}

const NEEDS_WHY: Record<ReportParam, string> = {
  trader: 'A statement is one buyer’s account: opening balance, every bill, every payment, and the running balance between them.',
  ingredient: 'This history is read one ingredient at a time, so the shelf position stays traceable line by line.',
  shed: 'This report is read one shed at a time, so its figures stay its own.',
  batch: 'This report is read one batch at a time, from placement to closure.',
};

/** A report that cannot stand without one subject asks for it, in its own words. */
function NeedsGate({ param, options, onPick }: {
  param: ReportParam; options: { value: string; label: string }[]; onPick: (id: string) => void;
}) {
  return (
    <EmptyState
      icon={<FileText size={19} strokeWidth={1.75} />}
      title={`Choose ${NEEDS_WORD[param]}`}
      description={NEEDS_WHY[param]}
      action={
        <div className="flex flex-wrap justify-center gap-2 max-w-[440px]">
          {options.length === 0
            ? <p className="text-[12px] text-muted">Nothing is on record to choose yet.</p>
            : options.slice(0, 10).map(o => (
              <button key={o.value} type="button" onClick={() => onPick(o.value)}
                className="px-3 py-1.5 rounded-full bg-card border border-line text-[12px] font-semibold text-ink-2 press hover:border-brand hover:text-brand">
                {o.label}
              </button>
            ))}
        </div>
      }
    />
  );
}

/** Only the pickers a report can act on, filled from what this company actually holds. */
function filterOptions(def: ReportDef, data: ReportSource): Partial<Record<ReportParam, { value: string; label: string }[]>> {
  const out: Partial<Record<ReportParam, { value: string; label: string }[]>> = {};
  if (def.params.includes('shed')) out.shed = data.sheds.map(s => ({ value: s.id, label: s.name }));
  if (def.params.includes('batch')) {
    const shed = new Map(data.sheds.map(s => [s.id, s.name]));
    out.batch = data.batches.map(b => ({ value: b.id, label: `${b.code} · ${shed.get(b.shedId) ?? 'no shed'}` }));
  }
  if (def.params.includes('trader')) {
    const billed = new Set(data.saleEntries.map(e => e.traderId));
    out.trader = data.traders
      .slice()
      .sort((a, b) => Number(billed.has(b.id)) - Number(billed.has(a.id)) || a.name.localeCompare(b.name))
      .map(t => ({ value: t.id, label: t.name }));
  }
  if (def.params.includes('ingredient')) {
    out.ingredient = godownIngredients(data.feedStock).map(i => ({ value: i, label: i }));
  }
  return out;
}

/* ============================= CHARTS ============================= */

const SERIES_COLOR = {
  brand: CHART.brand, accent: CHART.accent, teal: CHART.teal,
  danger: CHART.danger, success: CHART.success, muted: CHART.muted,
} as const;

/** Axis ticks in the units a farm reads: k / L / Cr, with the minus outside the number. */
const tick = (v: number) => (v < 0 ? `−${axisNum(Math.abs(v))}` : axisNum(v));

/** Each figure keeps the unit it was gathered in, so an axis never has to be guessed. */
function chartFormat(f: ReportFormat): (v: number) => string {
  switch (f) {
    case 'money': return v => (v < 0 ? `−₹${tick(Math.abs(v))}` : `₹${tick(v)}`);
    case 'kg': return v => `${tick(v)} kg`;
    case 'trays': return v => `${tick(v)} tr`;
    case 'tonnes': return v => `${tick(v)} t`;
    case 'pct': return v => `${tick(v)}%`;
    case 'birds': return v => `${tick(v)} birds`;
    default: return tick;
  }
}

/** A graph earns its place: the frame handles an error in one chart on its own. */
function ChartBlock({ chart }: { chart: ReportChart }) {
  const format = chartFormat(chart.format);
  if (chart.kind === 'trend') {
    const series: VSeries[] = chart.series.map(s => ({ ...s, color: SERIES_COLOR[s.color] }));
    return (
      <GraphCard title={chart.title} subtitle={chart.subtitle} warnings={chart.warnings} height={200}
        detail={series.map(s => `${s.id}:${s.points.length}`).join(' ')}>
        <TrendChart series={series} format={format} height={190} />
      </GraphCard>
    );
  }
  if (chart.kind === 'bars') {
    const rows: HRow[] = chart.rows;
    return (
      <GraphCard title={chart.title} subtitle={chart.subtitle} height={Math.min(320, 40 + rows.length * 34)}>
        <HBarList rows={rows} format={format} caption={chart.caption} />
      </GraphCard>
    );
  }
  return (
    <GraphCard title={chart.title} subtitle={chart.subtitle} warnings={chart.warnings} height={210}>
      <PairedBars buckets={chart.buckets} format={format} height={185} />
    </GraphCard>
  );
}

/* ============================= THE DETAILED REPORT ============================= */

const CLIP = 60;

/**
 * One table, two shapes: the column ledger from `sm` up, and the same rows as cards on a
 * phone, where a nine-column table would only be a horizontal scroll. Order and values
 * are identical — a mobile reader misses nothing but the column line.
 */
function TableBlock({ table, onOpen }: { table: ReportTable; onOpen: (href: string) => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, CLIP);
  const tone = (t?: 'success' | 'danger' | 'muted') =>
    t === 'success' ? 'text-success' : t === 'danger' ? 'text-danger' : t === 'muted' ? 'text-muted' : 'text-ink';

  return (
    <Card>
      {table.title && (
        <SectionTitle right={
          <span className="font-mono text-[10px] text-muted tnum">{fmtIN(table.rows.length)} {table.rows.length === 1 ? 'row' : 'rows'}</span>
        }>
          {table.title}
        </SectionTitle>
      )}
      {table.caption && <p className="text-[11.5px] text-muted leading-relaxed mt-1 mb-2.5">{table.caption}</p>}

      {table.rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">{table.emptyText}</p>
      ) : (
        <>
          <div className="hidden sm:block overflow-x-auto no-scrollbar -mx-1">
            <table className={clsx('w-full text-[12.5px]', table.columns.length > 6 && 'min-w-[720px]')}>
              <thead>
                <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                  {table.columns.map((c, i) => (
                    <th key={i} className={clsx('px-2 py-2 font-semibold whitespace-nowrap', c.right && 'text-right')}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {rows.map(r => {
                  const href = r.href;
                  return (
                    <tr
                      key={r.id}
                      onClick={href ? () => onOpen(href) : undefined}
                      className={clsx(href && 'cursor-pointer hover:bg-sunk/60 transition-colors', tone(r.tone))}
                    >
                      {table.columns.map((c, i) => (
                        <td key={i} className={clsx('px-2 py-2.5 align-top whitespace-nowrap', c.right && 'text-right font-mono tnum')}>
                          <span className={i === 0 && !c.right ? 'font-semibold text-ink' : undefined}>{r.cells[i] ?? '—'}</span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sm:hidden space-y-2">
            {rows.map(r => {
              const href = r.href;
              return (
                <div
                  key={r.id}
                  role={href ? 'button' : undefined}
                  tabIndex={href ? 0 : undefined}
                  onClick={href ? () => onOpen(href) : undefined}
                  onKeyDown={href ? e => { if (e.key === 'Enter') onOpen(href); } : undefined}
                  className={clsx('rounded-[13px] border border-line bg-sunk/40 px-3 py-2.5 min-w-0', href && 'press cursor-pointer')}
                >
                  <p className={clsx('text-[13px] font-semibold truncate', tone(r.tone))}>{r.cells[0] ?? '—'}</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                    {table.columns.slice(1).map((c, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-2 truncate">{c.label}</span>
                        <span className={clsx('font-mono text-[11.5px] tnum text-right', tone(r.tone))}>{r.cells[i + 1] ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {table.rows.length > CLIP && (
            <button type="button" onClick={() => setAll(v => !v)}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand press">
              {all ? <>Show fewer <X size={13} /></> : <>Show all {fmtIN(table.rows.length)} rows</>}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/* ============================= EXPORT ============================= */

/** A real file from the rows on screen — same order, same values, nothing recomputed. */
function exportCsv(def: ReportDef, range: Range, result: ReportResult, pushToast: (kind: 'success' | 'error', message: string) => void) {
  const name = reportFileName(def, range);
  try {
    const url = URL.createObjectURL(new Blob([reportCsv(def, range, result)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    pushToast('success', `${name} downloaded`);
  } catch {
    pushToast('error', 'This browser blocked the download');
  }
}
