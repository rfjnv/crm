import { useMemo, useSyncExternalStore } from 'react';

type ChartTier = 'narrow' | 'tablet' | 'desktop';

function getTier(): ChartTier {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia('(max-width: 480px)').matches) return 'narrow';
  if (window.matchMedia('(max-width: 768px)').matches) return 'tablet';
  return 'desktop';
}

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mq480 = window.matchMedia('(max-width: 480px)');
  const mq768 = window.matchMedia('(max-width: 768px)');
  mq480.addEventListener('change', cb);
  mq768.addEventListener('change', cb);
  return () => {
    mq480.removeEventListener('change', cb);
    mq768.removeEventListener('change', cb);
  };
}

/**
 * Responsive window for dashboard revenue chart: days shown + x-axis label step.
 * - ≤480px: 7 days
 * - 481–768px: 15 days
 * - &gt;768px: 30 days
 */
export function useDashboardChartRange(): {
  maxDays: number;
  titleLabel: string;
  tickStep: number;
} {
  const tier = useSyncExternalStore(subscribe, getTier, () => 'desktop' as ChartTier);

  return useMemo(() => {
    if (tier === 'narrow') return { maxDays: 7, titleLabel: '7', tickStep: 2 };
    if (tier === 'tablet') return { maxDays: 15, titleLabel: '15', tickStep: 2 };
    return { maxDays: 30, titleLabel: '30', tickStep: 3 };
  }, [tier]);
}
