import client from './client';

export interface CostAccessStatus {
  /** ADMIN / SUPER_ADMIN — могут открывать себестоимость */
  eligible: boolean;
  hasPin: boolean;
  /** ISO — до какого момента открыта; null — закрыта */
  unlockedUntil: string | null;
  /** ISO — ввод ПИН заблокирован после неверных попыток */
  lockedUntil: string | null;
  durations: { short: number; long: number };
}

export const costAccessApi = {
  status: () => client.get<CostAccessStatus>('/cost-access/status').then((r) => r.data),

  setPin: (password: string, pin: string) =>
    client.post<{ ok: true }>('/cost-access/pin', { password, pin }).then((r) => r.data),

  unlock: (pin: string, duration: 'short' | 'long') =>
    client.post<{ unlockedUntil: string }>('/cost-access/unlock', { pin, duration }).then((r) => r.data),

  lock: () => client.post<{ ok: true }>('/cost-access/lock').then((r) => r.data),

  /** SUPER_ADMIN: сбросить ПИН сотруднику */
  resetPin: (userId: string) =>
    client.delete<{ ok: true }>(`/cost-access/users/${userId}/pin`).then((r) => r.data),
};
