import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics.api';

type DayPoint = { date: string; revenue: number | null };

const EMPTY = new Map<string, DayPoint[]>();

/**
 * Выручка клиентов по дням за `from..to` (включительно) → `Map<clientId, дни>`.
 * Ключ начинается с `manager-client-activity`, поэтому сбрасывается вместе с матрицей
 * (например, после новой заметки на доске).
 */
export function useClientActivityDays(from: string, to: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ['manager-client-activity', 'days', from, to],
    queryFn: () => analyticsApi.getHistoryClientDays(from, to),
    enabled,
    staleTime: 120_000,
  });

  const byClient = useMemo(() => {
    if (!query.data) return EMPTY;
    return new Map(query.data.clients.map((c) => [c.clientId, c.days] as const));
  }, [query.data]);

  return { byClient, isLoading: enabled && query.isLoading, isError: query.isError };
}
