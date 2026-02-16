import client from './client';
import type { Conversation, ChatMessage, ConversationType, OnlineUser } from '../types';

export const conversationsApi = {
  getConversations: () =>
    client.get<Conversation[]>('/conversations').then((r) => r.data),

  getUnreadCounts: () =>
    client.get<Record<string, number>>('/conversations/unread-counts').then((r) => r.data),

  getMessages: (type: ConversationType, cursor?: string, limit = 50) =>
    client.get<{ messages: ChatMessage[]; nextCursor: string | null }>(
      `/conversations/${type}/messages`,
      { params: { ...(cursor ? { cursor } : {}), limit } },
    ).then((r) => r.data),

  sendMessage: (type: ConversationType, data: { text: string; dealId?: string; replyToId?: string }, files?: File[]) => {
    if (files && files.length > 0) {
      const formData = new FormData();
      formData.append('text', data.text);
      if (data.dealId) formData.append('dealId', data.dealId);
      if (data.replyToId) formData.append('replyToId', data.replyToId);
      files.forEach((f) => formData.append('files', f));
      return client.post<ChatMessage>(`/conversations/${type}/messages`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    }
    return client.post<ChatMessage>(`/conversations/${type}/messages`, data).then((r) => r.data);
  },

  editMessage: (messageId: string, text: string) =>
    client.patch<ChatMessage>(`/conversations/messages/${messageId}`, { text }).then((r) => r.data),

  deleteMessage: (messageId: string) =>
    client.delete(`/conversations/messages/${messageId}`).then((r) => r.data),

  searchMessages: (query: string) =>
    client.get<ChatMessage[]>('/conversations/search', { params: { query } }).then((r) => r.data),

  getReadStatus: (type: ConversationType) =>
    client.get<{ latestReadAt: string | null }>(`/conversations/${type}/read-status`).then((r) => r.data),

  markRead: (type: ConversationType) =>
    client.patch(`/conversations/${type}/read`).then((r) => r.data),

  // Presence
  ping: () => client.post('/presence/ping').then((r) => r.data),
  getOnlineUsers: () =>
    client.get<OnlineUser[]>('/presence/online').then((r) => r.data),
};
