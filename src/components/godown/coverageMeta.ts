import type { CoverageStatus } from '@/lib/coverage';

/**
 * How the godown words and colours a days-of-stock reading. The bands themselves come
 * from `lib/coverage`, so a screen cannot disagree with the report about what is low.
 */
export const COVERAGE_META: Record<CoverageStatus, { label: string; text: string; dot: string }> = {
  HEALTHY: { label: 'Healthy', text: 'text-success', dot: 'bg-success' },
  LOW: { label: 'Low', text: 'text-warn', dot: 'bg-warn' },
  CRITICAL: { label: 'Critical', text: 'text-danger', dot: 'bg-danger' },
  IDLE: { label: 'Nothing eating it', text: 'text-muted', dot: 'bg-line' },
};
