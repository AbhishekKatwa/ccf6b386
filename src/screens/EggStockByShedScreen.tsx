import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Egg, Filter, Warehouse } from 'lucide-react';
import { useCompanyData, useVisibleSheds } from '@/store/app';
import { fmtDateShort, fmtIN, todayISO } from '@/lib/format';
import { eggGradeTotals, eggStockByGrade, gradeTotal, wasteTraysByGrade } from '@/lib/calc';
import { EGG_GRADES, EGG_GRADE_LABELS, type EggCollection, type EggWastage, type SaleEntry, type Shed } from '@/types';
import { Surface, SectionTitle, Stat, Row, Badge, EmptyState } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Form';
import { AnimatedNumber, ScrollReveal, StaggerContainer, StaggerItem } from '@/components/motion';

const trayCount = (v: number) => <AnimatedNumber value={v} format={{ maximumFractionDigits: 0 }} />;

/** A shed's stock snapshot for one date — derived, never stored. */
type ShedStock = {
  shedId: string;
  shedName: string;
  collected: number;
  sold: number;
  wasted: number;
  balance: number;
  goodBalance: number;
  brokenBalance: number;
  doubleBalance: number;
  smallBalance: number;
  status: 'OK' | 'LOW' | 'EMPTY';
};

const LOW_THRESHOLD = 50; // trays below which we flag a shed as low-stock

export function EggStockByShedScreen() {
  const data = useCompanyData();
  const sheds = useVisibleSheds();
  const nav = useNavigate();
  const [selectedShed, setSelectedShed] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const company = data.companies.find(c => c.id === data.companyId);

  /** Today's production per shed (collected on the selected date). */
  const todayProduction = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of data.eggs) {
      if (e.date !== selectedDate) continue;
      const prev = map.get(e.shedId) ?? 0;
      map.set(e.shedId, prev + e.goodTrays + e.brokenTrays + e.doubleTrays + e.smallTrays);
    }
    return map;
  }, [data.eggs, selectedDate]);

  /** Today's dispatch per shed (sale entries on the selected date, filtered to that shed). */
  const todayDispatch = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of data.saleEntries) {
      if (entry.date !== selectedDate) continue;
      for (const line of entry.lines) {
        const prev = map.get(line.shedId) ?? 0;
        map.set(line.shedId, prev + gradeTotal(line.byGrade));
      }
    }
    return map;
  }, [data.saleEntries, selectedDate]);

  /** Today's damage per shed (wastage records on the selected date). */
  const todayDamage = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of data.eggWastages) {
      if (w.date !== selectedDate) continue;
      const prev = map.get(w.shedId) ?? 0;
      map.set(w.shedId, prev + gradeTotal(w.byGrade));
    }
    return map;
  }, [data.eggWastages, selectedDate]);

  /** Build every visible shed's stock position as of the selected date. */
  const rows = useMemo<ShedStock[]>(() => {
    return sheds.map(shed => {
      const stock = eggStockByGrade(shed.id, data.eggs, data.saleEntries, data.eggWastages, selectedDate);
      const balance = gradeTotal({ GOOD: stock.GOOD.balance, BROKEN: stock.BROKEN.balance, DOUBLE: stock.DOUBLE.balance, SMALL: stock.SMALL.balance });
      const collected = gradeTotal({ GOOD: stock.GOOD.collected, BROKEN: stock.BROKEN.collected, DOUBLE: stock.DOUBLE.collected, SMALL: stock.SMALL.collected });
      const sold = gradeTotal({ GOOD: stock.GOOD.dispatched, BROKEN: stock.BROKEN.dispatched, DOUBLE: stock.DOUBLE.dispatched, SMALL: stock.SMALL.dispatched });
      const wasted = gradeTotal({ GOOD: stock.GOOD.wasted, BROKEN: stock.BROKEN.wasted, DOUBLE: stock.DOUBLE.wasted, SMALL: stock.SMALL.wasted });
      let status: ShedStock['status'] = 'OK';
      if (balance <= 0) status = 'EMPTY';
      else if (balance < LOW_THRESHOLD) status = 'LOW';
      return {
        shedId: shed.id,
        shedName: shed.name,
        collected, sold, wasted, balance,
        goodBalance: stock.GOOD.balance,
        brokenBalance: stock.BROKEN.balance,
        doubleBalance: stock.DOUBLE.balance,
        smallBalance: stock.SMALL.balance,
        status,
      };
    }).filter(r => selectedShed === 'all' || r.shedId === selectedShed)
      .sort((a, b) => b.balance - a.balance);
  }, [sheds, data.eggs, data.saleEntries, data.eggWastages, selectedDate, selectedShed]);

  /** Aggregate totals across the visible rows. */
  const totals = useMemo(() => {
    const out = { totalStock: 0, totalCollected: 0, totalSold: 0, totalWasted: 0, prodToday: 0, dispToday: 0, dmgToday: 0 };
    for (const r of rows) {
      out.totalStock += r.balance;
      out.totalCollected += r.collected;
      out.totalSold += r.sold;
      out.totalWasted += r.wasted;
      out.prodToday += todayProduction.get(r.shedId) ?? 0;
      out.dispToday += todayDispatch.get(r.shedId) ?? 0;
      out.dmgToday += todayDamage.get(r.shedId) ?? 0;
    }
    return out;
  }, [rows, todayProduction, todayDispatch, todayDamage]);

  const shedOptions = useMemo(() => [
    { value: 'all', label: 'All sheds' },
    ...sheds.map(s => ({ value: s.id, label: s.name })),
  ], [sheds]);

  const statusTone = (s: ShedStock['status']) =>
    s === 'EMPTY' ? 'danger' : s === 'LOW' ? 'warn' : 'success';

  return (
    <div className="px-4 sm:px-0 space-y-5">
      {/* Filters */}
      <Surface className="p-3 flex flex-wrap items-end gap-3">
          <SelectField
            label="Shed"
            value={selectedShed}
            onChange={e => setSelectedShed(e.target.value)}
            options={shedOptions}
            className="min-w-[160px]"
          />
          <SelectField
            label="Date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            options={[{ value: todayISO(), label: 'Today' }]}
            className="min-w-[140px]"
          />
        </Surface>

        {/* Summary strip */}
        <StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          <StaggerItem key="totalStock"><Stat label="Total stock" value={trayCount(totals.totalStock)} sub="trays" /></StaggerItem>
          <StaggerItem key="totalCollected"><Stat label="Collected all time" value={trayCount(totals.totalCollected)} sub="trays" /></StaggerItem>
          <StaggerItem key="totalSold"><Stat label="Sold all time" value={trayCount(totals.totalSold)} sub="trays" /></StaggerItem>
          <StaggerItem key="prodToday"><Stat label="Produced today" value={trayCount(totals.prodToday)} sub="trays" /></StaggerItem>
          <StaggerItem key="dispToday"><Stat label="Dispatched today" value={trayCount(totals.dispToday)} sub="trays" /></StaggerItem>
          <StaggerItem key="dmgToday"><Stat label="Damaged today" value={trayCount(totals.dmgToday)} sub="trays" tone={totals.dmgToday > 0 ? 'danger' : undefined} /></StaggerItem>
        </StaggerContainer>

        {/* Shed-wise table */}
        <ScrollReveal>
        <Surface className="overflow-hidden">
          <SectionTitle right={
            <button onClick={() => nav('/sales?tab=entries')}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-brand font-semibold press hover:underline">
              Open sale entries <ChevronRight size={12} />
            </button>
          }>
            Current stock by shed
          </SectionTitle>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Egg size={22} />}
              title="No sheds match this filter"
              description={selectedShed === 'all'
                ? 'No shed has recorded an egg collection yet.'
                : 'This shed has no egg records for the selected date range.'}
            />
          ) : (
            <>
              {/* Desktop table header */}
              <div className="hidden md:grid md:grid-cols-7 gap-2 px-4 py-2 bg-sunk border-b border-line-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                <div>Shed</div>
                <div className="text-right">Stock</div>
                <div className="text-right">Collected</div>
                <div className="text-right">Sold</div>
                <div className="text-right">Wasted</div>
                <div className="text-right">Produced today</div>
                <div className="text-right">Status</div>
              </div>

              {/* Rows */}
              <StaggerContainer className="divide-y divide-line-2">
                {rows.map(r => (
                  <StaggerItem key={r.shedId}>
                  <button type="button"
                    onClick={() => nav(`/batches?q=${encodeURIComponent(r.shedName)}`)}
                    className="w-full text-left grid grid-cols-2 md:grid-cols-7 gap-x-2 gap-y-1 px-4 py-3 hover:bg-card press transition-colors">
                    <div className="font-medium text-sm truncate">{r.shedName}</div>
                    <div className="md:text-right tnum font-semibold">{fmtIN(r.balance)}</div>
                    <div className="md:text-right tnum text-muted-2">{fmtIN(r.collected)}</div>
                    <div className="md:text-right tnum text-muted-2">{fmtIN(r.sold)}</div>
                    <div className="md:text-right tnum text-muted-2">{fmtIN(r.wasted)}</div>
                    <div className="md:text-right tnum">{fmtIN(todayProduction.get(r.shedId) ?? 0)}</div>
                    <div className="md:text-right">
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </div>

                    {/* Mobile-only detail lines */}
                    <div className="col-span-2 md:hidden text-[11px] text-muted leading-relaxed">
                      Good {fmtIN(r.goodBalance)} · Broken {fmtIN(r.brokenBalance)} · Double {fmtIN(r.doubleBalance)} · Small {fmtIN(r.smallBalance)}
                    </div>
                  </button>
                  </StaggerItem>
                ))}
              </StaggerContainer>

              <p className="px-4 pb-3 pt-1 text-[11px] text-muted">
                Stock is derived from collections minus sale entries and wastage records. A load that left the shed but was not yet billed still counts as unsold.
              </p>
            </>
          )}
        </Surface>
        </ScrollReveal>

        {/* Grade breakdown for the first visible shed (or all if single shed selected) */}
        {rows.length > 0 && (
          <ScrollReveal>
          <Surface className="p-4">
            <SectionTitle>Grade breakdown</SectionTitle>
            <p className="text-[11px] text-muted mb-2">
              {selectedShed === 'all' ? 'Across all visible sheds' : `For ${rows[0].shedName}`}
            </p>
            <div className="space-y-1">
              {EGG_GRADES.map(g => {
                const total = selectedShed === 'all'
                  ? rows.reduce((s, r) => s + (r[`${g.toLowerCase()}Balance` as keyof typeof r] as number), 0)
                  : (rows[0][`${g.toLowerCase()}Balance` as keyof typeof rows[0]] as number);
                return (
                  <Row key={g} label={EGG_GRADE_LABELS[g]} value={`${fmtIN(total)} trays`} />
                );
              })}
            </div>
          </Surface>
          </ScrollReveal>
        )}

        <p className="text-[11px] text-faint leading-relaxed pb-2">
          Every figure on this page is the same reading the module screen gives, filtered to {company?.name ?? 'this company'} and to the role you are signed in as. Detailed history stays on the batch eggs screen.
        </p>
    </div>
  );
}
