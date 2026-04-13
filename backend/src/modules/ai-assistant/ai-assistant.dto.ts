import { z } from 'zod';

export const askQuestionDto = z.object({
  question: z.string().min(1, 'Вопрос не может быть пустым').max(1000),
});

export const renameChatDto = z.object({
  title: z.string().min(1).max(100),
});

export type AskQuestionDto = z.infer<typeof askQuestionDto>;

export interface AiAssistantEntity {
  type: 'client' | 'deal' | 'product' | 'user';
  id: string;
  name: string;
}

export interface AiAssistantResponse {
  answer: string;
  sql?: string;
  entities: AiAssistantEntity[];
  chatTitle?: string;
}
