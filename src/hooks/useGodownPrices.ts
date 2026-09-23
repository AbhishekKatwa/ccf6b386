import { useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { valueGodown, type GodownValuation } from '@/lib/valuation';

/**
 * The godown's weighted-average prices for the current company — the one price
 * source every formula and feed cost reads. `priceOf` answers with the average in
 * force today, or null when the godown has never priced that ingredient.
 */
export function useGodownPrices(): { valuation: GodownValuation; priceOf: (ingredient: string) => number | null } {
  const { feedStock } = useCompanyData();
  const valuation = useMemo(() => valueGodown(feedStock), [feedStock]);
  return useMemo(() => ({
    valuation,
    priceOf: (ingredient: string) => valuation.now(ingredient).avg,
  }), [valuation]);
}
