import { useCallback, useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { coverageOf, feedForecast, type FeedForecast, type IngredientCoverage } from '@/lib/coverage';
import { todayISO } from '@/lib/format';
import { useGodownPrices } from './useGodownPrices';

/**
 * How long each shelf in the godown lasts against what the live batches are expected to
 * eat. The rule lives in `lib/coverage`; this only hands it the company's own batches,
 * the formula version in force for each shed today and the stock the valuation already
 * replays. Read-only — a forecast never writes to the ledger.
 */
export function useFeedCoverage(): {
  forecast: FeedForecast;
  /** One ingredient's standing against the shelf the valuation holds for it. */
  coverage: (ingredient: string) => IngredientCoverage;
} {
  const { batches, feedFormulas, sheds } = useCompanyData();
  const { valuation } = useGodownPrices();
  const today = todayISO();

  const forecast = useMemo(() => {
    const names = new Map(sheds.map(s => [s.id, s.name]));
    return feedForecast(batches, feedFormulas, today, id => names.get(id) ?? '—');
  }, [batches, feedFormulas, sheds, today]);

  const coverage = useCallback(
    (ingredient: string) => coverageOf(forecast, ingredient, Math.max(0, valuation.now(ingredient).kg)),
    [forecast, valuation],
  );

  return { forecast, coverage };
}
