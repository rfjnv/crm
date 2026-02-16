import client from './client';
import type { AppNotification, BroadcastData, BroadcastTargets } from '../types';

export const notificationsApi = {
  list: (params?: { unreadOnly?: boolean; limit?: number; cursor?: string }) =>
    client.get<{ items: AppNotification[]; nextCursor: string | null }>('/notifications', {
      params: {
        ...(params?.unreadOnly ? { unreadOnly: '1' } : {}),
        ...(params?.limit ? { limit: params.limit } : {}),
        ...(params?.cursor ? { cursor: params.cursor } : {}),
      },
    }).then((r) => r.data),

  getUnreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),

  markRead: (id: string) =>
    client.patch<AppNotification>(`/notifications/${id}/read`).then((r) => r.data),

  markAllRead: () =>
    client.patch<{ updated: number }>('/notifications/read-all').then((r) => r.data),

  broadcast: (data: BroadcastData) =>
    client.post<{ batchId: string; recipientCount: number }>('/notifications/broadcast', data).then((r) => r.data),

  previewRecipients: (targets: BroadcastTargets) =>
    client.post<{ count: number; users: { id: string; fullName: string; role: string }[] }>('/notifications/broadcast/preview', { targets }).then((r) => r.data),
};
