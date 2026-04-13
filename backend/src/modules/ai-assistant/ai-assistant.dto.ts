import { z } from 'zod';

export const askQuestionDto = z.object({
  question: z.string().min(1, 'Вопрос не может быть пустым').max(1000),
});

export type AskQuestionDto = z.infer<typeof askQuestionDto>;

export interface AiAssistantEntity {
  type: 'client' | 'deal' | 'product';
  id: string;
  name: string;
}

export interface AiAssistantResponse {
  answer: string;
  sql?: string;
  entities: AiAssistantEntity[];
}
