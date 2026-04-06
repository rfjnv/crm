import client from './client';

export const telegramApi = {
  getStatus: () =>
    client.get<{ linked: boolean; botUsername: string | null }>('/telegram/status').then((r) => r.data),

  link: () =>
    client.post<{ deepLink: string; botUsername: string }>('/telegram/link').then((r) => r.data),

  unlink: () =>
    client.delete('/telegram/unlink').then((r) => r.data),

  /** ADMIN / SUPER_ADMIN: тест сообщений в Telegram-группы (склад / производство / финансы) */
  testGroupNotifications: () =>
    client
      .post<{
        ok: boolean;
        message: string;
        results: Array<{ label: string; chatId: string; ok: boolean; error?: string }>;
      }>('/telegram/test-group-notifications')
      .then((r) => r.data),
};
