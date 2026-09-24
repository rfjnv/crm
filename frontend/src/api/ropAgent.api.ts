import client from './client';

export interface RopAgentChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface RopAgentToolCall {
  name: string;
  label: string;
  isError: boolean;
}

export interface RopAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: RopAgentToolCall[] | null;
  isError: boolean;
  createdAt: string;
}

export interface RopAgentTurnStatus {
  running: boolean;
  startedAt?: string;
  /** Что агент уже посмотрел за этот ответ. */
  steps: string[];
}

export const ropAgentApi = {
  listChats: () => client.get<RopAgentChat[]>('/rop-agent/chats').then((r) => r.data),
  createChat: () => client.post<RopAgentChat>('/rop-agent/chats').then((r) => r.data),
  getMessages: (chatId: string) =>
    client
      .get<{ messages: RopAgentMessage[]; status: RopAgentTurnStatus }>(`/rop-agent/chats/${chatId}/messages`)
      .then((r) => r.data),
  ask: (chatId: string, question: string) =>
    client.post<RopAgentMessage>(`/rop-agent/chats/${chatId}/ask`, { question }).then((r) => r.data),
  renameChat: (chatId: string, title: string) =>
    client.patch<RopAgentChat>(`/rop-agent/chats/${chatId}`, { title }).then((r) => r.data),
  deleteChat: (chatId: string) => client.delete(`/rop-agent/chats/${chatId}`),
};
