import { useMemo } from 'react';
import { useCompanyData } from '@/store/app';
import { feedCostByShed } from '@/lib/analytics';
import { allocateShortage } from '@/lib/accounting';
import { monthRangeOf, type Movement } from '@/lib/movements';
import type { ShortageAllocation } from '@/components/godown/MovementDetail';

/**
 * Share a godown shortage the way the accounts already do — over the feed each shed ate
 * in the shortage's own month. The rule lives in `allocateShortage`; this only hands it
 * the ledger rows it needs.
 */
export function useShortageAllocator(): (m: Movement) => ShortageAllocation | null {
  const data = useCompanyData();
  return useMemo(() => (m: Movement) => {
    const range = monthRangeOf(m.date);
    if (!range) return null;
    const shedNames = new Map(data.sheds.map(s => [s.id, s.name]));
    return allocateShortage(
      m.value,
      feedCostByShed(data.feed, data.feedStock, data.feedFormulas, range).rows,
      shedNames,
    );
  }, [data]);
}
