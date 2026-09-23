import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, ChevronRight, FileText, Lock } from 'lucide-react';
import { useCan, useCompanyData } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Badge, Card, EmptyState, IconTile } from '@/components/ui/Card';
import { ChipGroup, Field, SearchField } from '@/components/ui/Form';
import { todayISO } from '@/lib/format';
import {
  DATE_PRESETS, REPORT_SECTIONS, reportHref, reportRange, rangeLabel, visibleReports,
  type DatePreset, type ReportDef, type ReportParams,
} from '@/lib/reports';

/**
 * The reporting centre: one window, then every statement the farm can produce over the
 * records it already keeps. A card opens a real view over real rows — nothing here
 * generates a file, and a statement the role cannot read is not offered at all.
 */
export function ReportsScreen() {
  const nav = useNavigate();
  const data = useCompanyData();
  const canFinance = useCan('viewFinance');
  const canExport = useCan('exportReports');

  const today = todayISO();
  const [preset, setPreset] = useState<DatePreset>('30D');
  const [from, setFrom] = useState(() => reportRange({ preset: '30D', from: '', to: today }, today).from);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');

  const params: ReportParams = { preset, from, to };
  const range = useMemo(() => reportRange(params, today), [preset, from, to, today]);

  const needle = q.trim().toLowerCase();
  const list = visibleReports(canFinance)
    .filter(r => !needle || `${r.title} ${r.desc}`.toLowerCase().includes(needle));

  return (
    <Page withNav>
      <ScreenTitle
        eyebrow="Records"
        title="Reports"
        subtitle={<>{data.companies.find(c => c.id === data.companyId)?.name ?? 'This farm'} · read-only statements over the records already booked</>}
      />

      <div className="px-4 sm:px-0 mt-1 space-y-5">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <CalendarRange size={14} className="text-brand -mt-[1px]" /> Report period
            </p>
            <p className="font-mono text-[11px] text-ink-2 tnum">{rangeLabel(range)}</p>
          </div>
          <ChipGroup className="mt-3" value={preset} onChange={setPreset} options={DATE_PRESETS} />
          {preset === 'CUSTOM' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="From" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
              <Field label="To" type="date" value={to} max={today} onChange={e => setTo(e.target.value)} />
            </div>
          )}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-[11.5px] text-muted leading-relaxed max-w-[520px]">
              Every report opens on this window. A buyer statement and the batch register are lifetime
              by nature, so a card marked <strong className="text-ink-2">Lifetime</strong> is not clipped
              by it. Shed, batch, buyer and ingredient filters sit inside the reports that can act on them.
            </p>
            <SearchField className="sm:w-[220px] shrink-0" value={q} onChange={setQ} placeholder="Search reports" />
          </div>
        </Card>

        {list.length === 0 ? (
          <EmptyState
            icon={<FileText size={19} strokeWidth={1.75} />}
            title="No report matches that"
            description="Clear the search to see every statement this role can open."
          />
        ) : REPORT_SECTIONS.map(section => {
          const items = list.filter(r => r.section === section.id);
          if (!items.length) return null;
          return (
            <section key={section.id}>
              <div className="flex items-baseline justify-between gap-3 px-0.5 mt-1">
                <h2 className="font-display text-[16px] font-semibold text-ink leading-tight">{section.label}</h2>
                <p className="font-mono text-[10px] text-muted tnum shrink-0">
                  {items.length} {items.length === 1 ? 'report' : 'reports'}
                </p>
              </div>
              <p className="text-[12px] text-muted px-0.5 mt-0.5 mb-3 leading-snug">{section.blurb}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map(def => (
                  <ReportCard key={def.id} def={def} onOpen={() => nav(reportHref(def, params))} />
                ))}
              </div>
            </section>
          );
        })}

        {!canExport && (
          <div className="flex items-start gap-3 rounded-[14px] bg-accent-soft px-4 py-3">
            <Lock size={15} className="text-accent-ink shrink-0 mt-[2px]" />
            <p className="text-[12px] text-accent-ink leading-relaxed">
              <strong>Export is off for your role.</strong> Every statement below can still be read on
              screen; downloading one needs the report export permission.
            </p>
          </div>
        )}
      </div>
    </Page>
  );
}

const WORD = { shed: 'Shed', batch: 'Batch', trader: 'Buyer', ingredient: 'Ingredient' } as const;
const NEEDS = { shed: 'a shed', batch: 'a batch', trader: 'a buyer', ingredient: 'an ingredient' } as const;

/** One report, the question it answers, and the scope it understands. */
function ReportCard({ def, onOpen }: { def: ReportDef; onOpen: () => void }) {
  const Icon = def.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left bg-card border border-line rounded-[16px] shadow-card p-3.5 press hover:border-brand/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 transition-colors min-w-0"
    >
      <div className="flex items-start gap-3">
        <IconTile tone={def.section === 'financial' || def.section === 'control' ? 'brand' : 'accent'} size={34}>
          <Icon size={17} />
        </IconTile>
        <div className="flex-1 min-w-0">
          <p className="font-display text-[14.5px] font-semibold text-ink leading-snug">{def.title}</p>
          <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{def.desc}</p>
        </div>
        <ChevronRight size={15} className="text-faint shrink-0 mt-1 transition-colors group-hover:text-brand" />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 min-h-[20px]">
        {def.allTime && <Badge tone="neutral">Lifetime</Badge>}
        {def.needs?.map(n => <Badge key={n} tone="warn">Needs {NEEDS[n]}</Badge>)}
        {def.href
          ? <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-2">Opens the sheet the batch already has</span>
          : def.params.length > 0
            ? def.params.map(p => <span key={p} className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-2">{WORD[p]}</span>)
            : <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-2">Whole farm in the period</span>}
      </div>
    </button>
  );
}
