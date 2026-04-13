import client from './client';

export interface AiEntity {
  type: 'client' | 'deal' | 'product' | 'user';
  id: string;
  name: string;
}

export interface AiChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string | null;
  entities?: AiEntity[] | null;
  isError: boolean;
  createdAt: string;
}

export interface AiAssistantResponse {
  answer: string;
  sql?: string;
  entities: AiEntity[];
  chatTitle?: string;
}

export const aiAssistantApi = {
  listChats: () =>
    client.get<AiChat[]>('/ai-assistant').then((r) => r.data),

  createChat: () =>
    client.post<AiChat>('/ai-assistant').then((r) => r.data),

  getMessages: (chatId: string) =>
    client.get<AiChatMessage[]>(`/ai-assistant/${chatId}/messages`).then((r) => r.data),

  ask: (chatId: string, question: string) =>
    client.post<AiAssistantResponse>(`/ai-assistant/${chatId}/ask`, { question }).then((r) => r.data),

  renameChat: (chatId: string, title: string) =>
    client.patch<AiChat>(`/ai-assistant/${chatId}`, { title }).then((r) => r.data),

  deleteChat: (chatId: string) =>
    client.delete(`/ai-assistant/${chatId}`),
};
