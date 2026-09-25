import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { costAccessApi } from '../api/costAccess.api';
import { useAuthStore } from '../store/authStore';

export const COST_ACCESS_QUERY_KEY = ['cost-access-status'];

const COST_ROLES = ['SUPER_ADMIN', 'ADMIN'];

/**
 * Открыт ли доступ к себестоимости (ПИН введён, срок не вышел).
 *
 * Решает сервер: без доступа он сам вырезает цену закупки и маржу из ответов,
 * здесь это только чтобы прятать пустые колонки и показывать замок. Когда срок
 * выходит, все запросы перезапрашиваются — цены исчезают с экрана без перезагрузки.
 */
export function useCostAccess() {
  const role = useAuthStore((s) => s.user?.role);
  const eligibleRole = !!role && COST_ROLES.includes(role);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: COST_ACCESS_QUERY_KEY,
    queryFn: costAccessApi.status,
    enabled: eligibleRole,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const until = data?.unlockedUntil ? new Date(data.unlockedUntil).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  const open = eligibleRole && until > now;

  // Тикаем раз в секунду только пока доступ открыт — для обратного отсчёта.
  useEffect(() => {
    if (!until) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [until]);

  // Срок вышел — перезапросить данные, чтобы цены пропали с уже открытых страниц.
  useEffect(() => {
    if (!until) return;
    const left = until - Date.now();
    if (left <= 0) return;
    const id = window.setTimeout(() => {
      void queryClient.invalidateQueries();
    }, left + 500);
    return () => window.clearTimeout(id);
  }, [until, queryClient]);

  return {
    eligible: eligibleRole && (data?.eligible ?? true),
    hasPin: !!data?.hasPin,
    open,
    secondsLeft: open ? Math.max(0, Math.round((until - now) / 1000)) : 0,
    lockedUntil: data?.lockedUntil ?? null,
    durations: data?.durations ?? { short: 10, long: 60 },
    loaded: !!data,
  };
}
