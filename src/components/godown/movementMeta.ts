import {
  ArrowUpRight, Boxes, PackagePlus, SlidersHorizontal, TriangleAlert, Wheat,
} from 'lucide-react';
import type { Tone } from '@/components/ui/Card';
import { fmtKg } from '@/lib/format';
import type { MovementKind } from '@/lib/movements';

/**
 * The ledger's visual vocabulary, shared by the godown ledger and an ingredient's own
 * history so the same movement reads the same way in both.
 */
export const KIND_META: Record<MovementKind, { tone: Tone; Icon: typeof Boxes }> = {
  FEED_IN: { tone: 'success', Icon: PackagePlus },
  OPENING: { tone: 'brand', Icon: Boxes },
  CONSUMPTION: { tone: 'accent', Icon: Wheat },
  FEED_OUT: { tone: 'warn', Icon: ArrowUpRight },
  ADJUSTMENT: { tone: 'neutral', Icon: SlidersHorizontal },
  SHORTAGE: { tone: 'danger', Icon: TriangleAlert },
};

/** Whole KG read clean; a fraction keeps its two decimals. */
export function ledgerKg(n: number): string { return fmtKg(n, Number.isInteger(n) ? 0 : 2); }
