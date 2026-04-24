import { z } from 'zod';

export const askQuestionDto = z.object({
  question: z.string().min(1, 'Вопрос не может быть пустым').max(1000),
});

export const renameChatDto = z.object({
  title: z.string().min(1).max(100),
});

export const analyzeCallDto = z.object({
  transcript: z.string().min(20, 'Транскрипт слишком короткий').max(120000),
});

export const createTrainingRuleDto = z.object({
  title: z.string().min(1, 'Название обязательно').max(200),
  content: z.string().min(1, 'Содержание обязательно').max(5000),
});

export const updateTrainingRuleDto = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5000).optional(),
  isActive: z.boolean().optional(),
});

export type AskQuestionDto = z.infer<typeof askQuestionDto>;
export type AnalyzeCallDto = z.infer<typeof analyzeCallDto>;

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
