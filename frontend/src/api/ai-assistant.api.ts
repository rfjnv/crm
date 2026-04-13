import client from './client';

export interface AiEntity {
  type: 'client' | 'deal' | 'product';
  id: string;
  name: string;
}

export interface AiAssistantResponse {
  answer: string;
  sql?: string;
  entities: AiEntity[];
}

export const aiAssistantApi = {
  ask: (question: string) =>
    client
      .post<AiAssistantResponse>('/ai-assistant/ask', { question })
      .then((r) => r.data),
};
