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

export interface AudioTranscriptionResponse {
  text: string;
}

export interface SalesCallAnalysisResponse {
  analysis: string;
}

export interface AiTrainingRule {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; fullName: string };
}

export const aiTrainingApi = {
  list: () =>
    client.get<AiTrainingRule[]>('/ai-assistant/training-rules').then((r) => r.data),

  create: (data: { title: string; content: string }) =>
    client.post<AiTrainingRule>('/ai-assistant/training-rules', data).then((r) => r.data),

  update: (ruleId: string, data: { title?: string; content?: string; isActive?: boolean }) =>
    client.patch<AiTrainingRule>(`/ai-assistant/training-rules/${ruleId}`, data).then((r) => r.data),

  delete: (ruleId: string) =>
    client.delete(`/ai-assistant/training-rules/${ruleId}`),
};

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

  transcribeAudio: (audioFile: File) => {
    const formData = new FormData();
    formData.append('audio', audioFile);
    return client.post<AudioTranscriptionResponse>('/ai-assistant/transcribe', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  analyzeSalesCall: (transcript: string) =>
    client.post<SalesCallAnalysisResponse>('/ai-assistant/analyze-call', { transcript }).then((r) => r.data),
};
