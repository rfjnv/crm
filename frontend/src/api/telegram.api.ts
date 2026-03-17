import client from './client';

export const telegramApi = {
  getStatus: () =>
    client.get<{ linked: boolean; botUsername: string | null }>('/telegram/status').then((r) => r.data),

  link: () =>
    client.post<{ deepLink: string; botUsername: string }>('/telegram/link').then((r) => r.data),

  unlink: () =>
    client.delete('/telegram/unlink').then((r) => r.data),
};
