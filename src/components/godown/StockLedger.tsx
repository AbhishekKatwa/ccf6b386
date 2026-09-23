import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ChevronRight, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Card, EmptyState, IconTile, Skeleton, type Tone } from '@/components/ui/Card';
import { Button, SearchField, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { fmtDate, fmtIN, fmtMoney, todayISO } from '@/lib/format';
import { dayGroupLabel, MOVEMENT_KINDS, MOVEMENT_LABEL, type LedgerTotals, type Movement, type MovementKind } from '@/lib/movements';
import { KIND_META, ledgerKg } from './movementMeta';
import { MovementDetail, type ShortageAllocation } from './MovementDetail';

/**
 * The godown's history: every movement that produced the Current Stock page, on one
 * ledger surface. Everything here is the ledger's own data — quantities from the rows,
 * money from the valuation basis each row was booked at.
 */

const kg = ledgerKg;

type KindFilter = 'ALL' | MovementKind;
type MonthFilter = 'ALL' | string;

export function StockLedger({ movements, totals, godownValue, canFinance, actions, allocate, focusEntryId }: {
  movements: Movement[];
  totals: LedgerTotals;
  godownValue: number;
  canFinance: boolean;
  actions?: ReactNode;
  allocate: (m: Movement) => ShortageAllocation | null;
  /** A receipt someone asked to see — from a payable in Finance, or a payment's own row. */
  focusEntryId?: string | null;
}) {
  // The first paint of the tab shows ledger-shaped skeletons rather than an empty page.
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(true); }, []);
  const today = todayISO();
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [ingredient, setIngredient] = useState('ALL');
  const [month, setMonth] = useState<MonthFilter>('ALL');
  const [q, setQ] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [open, setOpen] = useState<Movement | null>(null);

  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusEntryId || askedFor.current === focusEntryId) return;
    const hit = movements.find(m => m.lines.some(l => l.entryId === focusEntryId));
    if (!hit) return;
    askedFor.current = focusEntryId;
    setOpen(hit);
  }, [focusEntryId, movements]);

  const ingredientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of movements) for (const l of m.lines) set.add(l.ingredient);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [movements]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of movements) if (/^\d{4}-\d{2}/.test(m.date)) set.add(m.date.slice(0, 7));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [movements]);

  const kinds = useMemo(() => {
    const present = new Set<MovementKind>(movements.map(m => m.kind));
    return (Object.keys(MOVEMENT_LABEL) as MovementKind[]).filter(k => present.has(k));
  }, [movements]);

  // The four kinds a godown can always be asked about, plus anything else the ledger holds.
  const chipKinds = useMemo(() => {
    const standing: MovementKind[] = ['FEED_IN', 'CONSUMPTION', 'ADJUSTMENT', 'SHORTAGE'];
    return MOVEMENT_KINDS.filter(k => standing.includes(k) || kinds.includes(k));
  }, [kinds]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => movements.filter(m => {
    if (kind !== 'ALL' && m.kind !== kind) return false;
    if (ingredient !== 'ALL' && !m.lines.some(l => l.ingredient === ingredient)) return false;
    if (month !== 'ALL' && !m.date.startsWith(month)) return false;
    if (!needle) return true;
    const hay = [m.title, m.context, MOVEMENT_LABEL[m.kind], ...m.lines.map(l => l.ingredient)]
      .join(' ').toLowerCase();
    return hay.includes(needle);
  }), [movements, kind, ingredient, month, needle]);

  const activeFilters = [kind !== 'ALL', ingredient !== 'ALL', month !== 'ALL', needle !== ''].filter(Boolean).length;

  function clearFilters() { setKind('ALL'); setIngredient('ALL'); setMonth('ALL'); setQ(''); }

  const groups = useMemo(() => {
    const out: { date: string; rows: Movement[] }[] = [];
    for (const m of filtered) {
      const last = out[out.length - 1];
      if (last && last.date === m.date) last.rows.push(m);
      else out.push({ date: m.date, rows: [m] });
    }
    return out;
  }, [filtered]);

  const selects = (
    <>
      <SelectField aria-label="Ingredient" value={ingredient} onChange={e => setIngredient(e.target.value)}
        options={[
          { value: 'ALL', label: ingredient === 'ALL' ? 'All ingredients' : ingredient },
          ...ingredientOptions.map(i => ({ value: i, label: i })),
        ]} />
      <SelectField aria-label="Date" value={month} onChange={e => setMonth(e.target.value)}
        options={[
          { value: 'ALL', label: 'All dates' },
          ...monthOptions.map(mo => ({ value: mo, label: monthLabel(mo) })),
        ]} />
    </>
  );

  return (
    <div className="space-y-4">
      {/* §3 · the ledger's own header, with the figures the ledger actually holds */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[21px] leading-tight font-semibold text-ink tracking-tight">Stock Ledger</h2>
          <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
            Every movement affecting Central Godown inventory — the history behind Current Stock.
          </p>
          <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint tnum">
            {fmtIN(totals.movements)} movements · {totals.ingredients} ingredients
            {canFinance && godownValue > 0 && <> · <span className="text-accent-ink">{fmtMoney(godownValue)}</span> on the shelf</>}
          </p>
        </div>
        {actions && <div className="hidden sm:flex items-center gap-2 shrink-0 pt-1">{actions}</div>}
      </div>

      {actions && <div className="grid grid-cols-2 gap-2 sm:hidden">{actions}</div>}

      {/* §4 · compact summary — counts and KG straight off the rows */}
      {totals.movements > 0 && (
        <Card padded={false} className="px-4 py-3.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-5">
            <Cell label="Total movements" value={fmtIN(totals.movements)} sub={`${totals.ingredients} ingredients`} />
            <Cell label="Feed in" value={kg(totals.byKind.FEED_IN.kg)} sub={`${totals.byKind.FEED_IN.count} receipt${totals.byKind.FEED_IN.count === 1 ? '' : 's'}`} dot="success" />
            <Cell label="Consumption" value={kg(totals.byKind.CONSUMPTION.kg)} sub={`${totals.byKind.CONSUMPTION.count} shed feeding${totals.byKind.CONSUMPTION.count === 1 ? '' : 's'}`} dot="accent" />
            <Cell label="Adjustments" value={kg(totals.byKind.ADJUSTMENT.kg)} sub={`${totals.byKind.ADJUSTMENT.count} booked`} dot="neutral" />
            <Cell label="Shortages" value={kg(totals.byKind.SHORTAGE.kg)} sub={`${totals.byKind.SHORTAGE.count} counted short`} dot="danger" className="col-span-2 sm:col-span-1" />
          </div>
        </Card>
      )}

      {/* §5 · filters — the type rides on chips that scroll inside their own row, never widening the page */}
      {movements.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5" role="group" aria-label="Transaction type">
            {(['ALL', ...chipKinds] as const).map(k => {
              const active = kind === k;
              return (
                <button key={k} type="button" onClick={() => setKind(k as KindFilter)} aria-pressed={active}
                  className={clsx('shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold press',
                    active ? 'bg-brand text-white shadow-card' : 'bg-sunk text-ink hover:bg-brand-soft hover:text-brand')}>
                  {k === 'ALL' ? 'All' : MOVEMENT_LABEL[k]}
                </button>
              );
            })}
          </div>
          <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1.2fr] gap-2 items-end">
            {selects}
            <SearchField value={q} onChange={setQ} placeholder="Search movement or ingredient" />
          </div>
          <div className="sm:hidden flex items-center gap-2">
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSheetOpen(true)}
              icon={<SlidersHorizontal size={14} />}>
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
            </Button>
            <SearchField value={q} onChange={setQ} placeholder="Search ledger" className="flex-1" />
          </div>
        </>
      )}

      {!settled ? (
        <Card padded={false} className="divide-y divide-line-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5">
              <Skeleton className="w-9 h-9 rounded-[12px] shrink-0" />
              <div className="flex-1 space-y-1.5 pt-0.5">
                <Skeleton className="h-3 w-[46%]" />
                <Skeleton className="h-2.5 w-[62%]" />
              </div>
              <Skeleton className="h-3 w-[18%] mt-1" />
            </div>
          ))}
        </Card>
      ) : movements.length === 0 ? (
        <EmptyState icon={<ArrowDownLeft size={20} />} title="No stock movements"
          description="Godown inventory movements will appear here — every receipt, feeding, adjustment and shortage, in the order they were booked." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal size={20} />} title="Nothing matches these filters"
          description="No movement in the ledger fits the current selection."
          action={<Button variant="outline" size="sm" onClick={clearFilters} icon={<RotateCcw size={14} />}>Clear filters</Button>} />
      ) : (
        /* §15 · one ledger surface: day groups, hairline dividers, no floating cards */
        <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
          {groups.map(g => (
            <div key={g.date}>
              <LedgerDayHeader date={g.date} today={today} count={g.rows.length} />
              <div className="divide-y divide-line-2">
                {g.rows.map(m => (
                  <LedgerRow key={m.key} m={m} canFinance={canFinance} onOpen={() => setOpen(m)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter the ledger"
        subtitle={`${fmtIN(filtered.length)} of ${fmtIN(movements.length)} movements shown`}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={clearFilters} disabled={activeFilters === 0}>Clear</Button>
          <Button block onClick={() => setSheetOpen(false)}>Show</Button>
        </div>}>
        <div className="space-y-3">{selects}</div>
      </Dialog>

      <MovementDetail movement={open} onClose={() => setOpen(null)} canFinance={canFinance} allocate={allocate} />
    </div>
  );
}

function LedgerRow({ m, canFinance, onOpen }: { m: Movement; canFinance: boolean; onOpen: () => void }) {
  const { tone, Icon } = KIND_META[m.kind];
  const after = m.lines.length === 1 ? m.lines[0].place?.after.kg ?? null : null;
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${m.title} on ${fmtDate(m.date)} — open details`}
      className="group ledger-row flex items-start gap-3 px-4 py-3.5 text-left cursor-pointer transition-colors hover:bg-sunk/60 focus-visible:bg-sunk/60">
      <IconTile tone={tone} size={36}><Icon size={17} strokeWidth={1.9} /></IconTile>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-ink truncate">{m.title}</p>
        <p className="mt-0.5 text-[11.5px] text-muted tnum truncate">{fmtDate(m.date)} · {MOVEMENT_LABEL[m.kind]}</p>
        {m.context && <p className="mt-0.5 text-[11px] text-faint truncate">{m.context}</p>}
        {(after !== null || m.by) && (
          <p className="mt-0.5 text-[10.5px] text-faint tnum truncate">
            {[after !== null ? `Stock after ${kg(after)}` : null, m.by ? `Booked by ${m.by}` : null].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        <div className="text-right">
          <p className={clsx('font-mono text-[12.5px] font-bold tnum', m.incoming ? 'text-success' : 'text-danger')}>
            {m.incoming ? '+' : '−'}{kg(m.totalKg)}
          </p>
          {canFinance && (
            <p className="mt-0.5 font-mono text-[10px] tnum text-muted max-w-[130px] truncate">
              {m.value === null ? 'no rate on record' : `${fmtMoney(m.value)}${m.unpricedKg > 0 ? ` · ${fmtIN(m.unpricedKg)} kg unpriced` : ''}`}
            </p>
          )}
        </div>
        <ChevronRight size={16} className="text-faint transition-colors group-hover:text-muted" />
      </div>
    </div>
  );
}

function Cell({ label, value, sub, dot, className }: {
  label: string; value: string; sub?: string; dot?: Tone; className?: string;
}) {
  const dotClass = { brand: 'bg-brand', accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger', warn: 'bg-warn', neutral: 'bg-line' }[dot ?? 'neutral'];
  return (
    <div className={clsx('min-w-0', className)}>
      <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted truncate">
        {dot && <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', dotClass)} />}
        {label}
      </p>
      <p className="mt-1 font-display text-[16px] leading-5 font-semibold text-ink tnum truncate">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-faint tnum truncate">{sub}</p>}
    </div>
  );
}

/** One day's heading inside a ledger surface: Today/Yesterday when it is near, else the date. */
export function LedgerDayHeader({ date, today, count }: { date: string; today: string; count: number }) {
  const rel = dayGroupLabel(date, today);
  return (
    <div className="flex items-baseline gap-2 bg-sunk/70 px-4 py-2 border-b border-line-2">
      {rel && <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-brand-ink">{rel}</p>}
      <p className={clsx('font-mono text-[10px] tnum', rel
        ? 'text-muted'
        : 'font-semibold uppercase tracking-[0.14em] text-ink-2')}>{fmtDate(date)}</p>
      <p className="ml-auto font-mono text-[10px] text-faint tnum">{count}</p>
    </div>
  );
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Math.max(0, Math.min(11, (m || 1) - 1))]} ${y}`;
}
