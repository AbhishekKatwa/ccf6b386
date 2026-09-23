import { clsx } from 'clsx';
import { formulaCostPerTonne, formulaPct, formulaTotalKg } from '@/lib/calc';
import { fmtIN, fmtMoney } from '@/lib/format';
import type { FeedFormula } from '@/types';

/**
 * The mix as Ingredient | Kg | share % of the mix. The rate column is never a typed
 * price — it is the godown's weighted average for that ingredient, which is where the
 * formula's cost per tonne comes from. `showCosts` gates that on finance access.
 */
export function FormulaTable({ formula, showCosts, priceOf, className }: {
  formula: FeedFormula; showCosts: boolean; priceOf: (ingredient: string) => number | null; className?: string;
}) {
  const cols = showCosts ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]';
  const total = formulaTotalKg(formula.items);
  const cost = formulaCostPerTonne(formula, priceOf);
  const unpriced = formula.items.filter(it => priceOf(it.ingredient) === null).length;
  return (
    <div className={clsx('bg-card border border-line rounded-[18px] shadow-card overflow-hidden', className)}>
      <div className={clsx('grid gap-3 px-4 py-2.5 bg-sunk text-[10px] font-semibold uppercase tracking-[0.12em] text-faint', cols)}>
        <span>Ingredient</span>
        <span className="text-right w-16">Kg</span>
        <span className="text-right w-12">%</span>
        {showCosts && <span className="text-right w-20">Avg ₹/kg</span>}
      </div>
      <div className="divide-y divide-line-2">
        {formula.items.map((it, i) => {
          const rate = priceOf(it.ingredient);
          return (
            <div key={`${it.ingredient}-${i}`} className={clsx('grid gap-3 px-4 py-2.5 items-center text-[13px] transition-colors hover:bg-sunk/50', cols)}>
              <span className="font-semibold text-ink truncate">{it.ingredient}</span>
              <span className="font-mono tnum text-right w-16">{fmtIN(it.kgPerTonne, 2)}</span>
              <span className="font-mono tnum text-right w-12 text-muted">{formulaPct(it.kgPerTonne, total).toFixed(1)}</span>
              {showCosts && (
                <span className="font-mono tnum text-right w-20 text-muted" title={rate === null ? 'No rate on record in the godown' : undefined}>
                  {rate === null ? '—' : fmtMoney(rate, 2)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className={clsx('grid gap-3 px-4 py-3 items-center text-[13px] font-semibold border-t border-line bg-sunk/50', cols)}>
        <span className="font-display text-ink">
          Total · {formula.items.length} ingredients
          {showCosts && unpriced > 0 && (
            <span className="block font-mono text-[9.5px] font-medium text-warn normal-case tracking-normal mt-0.5">
              {unpriced} {unpriced === 1 ? 'ingredient has' : 'ingredients have'} no godown rate
            </span>
          )}
        </span>
        <span className="font-mono tnum text-right w-16 text-ink">{fmtIN(total, 2)}</span>
        <span className="font-mono tnum text-right w-12 text-muted">100</span>
        {showCosts && (
          <span className="text-right w-20">
            <span className="block font-mono tnum text-[13px] text-ink">{fmtMoney(cost, 2)}</span>
            <span className="block font-mono text-[9px] uppercase tracking-wider text-faint">/tonne</span>
          </span>
        )}
      </div>
    </div>
  );
}
