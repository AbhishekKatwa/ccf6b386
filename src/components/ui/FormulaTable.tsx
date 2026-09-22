import { clsx } from 'clsx';
import { FORMULA_TOLERANCE_KG, formulaPct, formulaTotalKg, FORMULA_TONNE_KG } from '@/lib/calc';
import { fmtIN, fmtMoney } from '@/lib/format';
import type { FeedFormula } from '@/types';

/** The mix as Ingredient | Kg/Tonne | %, with rates only when finance is visible. */
export function FormulaTable({ formula, showCosts, className }: {
  formula: FeedFormula; showCosts: boolean; className?: string;
}) {
  const cols = showCosts ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]';
  const total = formulaTotalKg(formula.items);
  const exact = Math.abs(total - FORMULA_TONNE_KG) <= FORMULA_TOLERANCE_KG;
  return (
    <div className={clsx('bg-card border border-line rounded-[18px] shadow-card overflow-hidden', className)}>
      <div className={clsx('grid gap-3 px-4 py-2.5 bg-sunk text-[10px] font-semibold uppercase tracking-[0.12em] text-faint', cols)}>
        <span>Ingredient</span>
        <span className="text-right w-16">Kg/Tonne</span>
        <span className="text-right w-12">%</span>
        {showCosts && <span className="text-right w-16">₹/kg</span>}
      </div>
      <div className="divide-y divide-line-2">
        {formula.items.map((it, i) => (
          <div key={`${it.ingredient}-${i}`} className={clsx('grid gap-3 px-4 py-2.5 items-center text-[13px]', cols)}>
            <span className="font-semibold text-ink truncate">{it.ingredient}</span>
            <span className="font-mono tnum text-right w-16">{fmtIN(it.kgPerTonne, 2)}</span>
            <span className="font-mono tnum text-right w-12 text-muted">{formulaPct(it.kgPerTonne).toFixed(1)}</span>
            {showCosts && (
              <span className="font-mono tnum text-right w-16 text-muted">{it.costPerKg != null ? fmtMoney(it.costPerKg, 2) : '—'}</span>
            )}
          </div>
        ))}
      </div>
      <div className={clsx('grid gap-3 px-4 py-3 items-center text-[13px] font-semibold border-t border-line bg-sunk/50', cols)}>
        <span className="font-display text-ink">Total · {formula.items.length} ingredients</span>
        <span className={clsx('font-mono tnum text-right w-16', exact ? 'text-success' : 'text-danger')}>{fmtIN(total, 2)}</span>
        <span className="font-mono tnum text-right w-12 text-muted">100</span>
        {showCosts && <span className="w-16" />}
      </div>
    </div>
  );
}
