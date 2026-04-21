import { z } from 'zod';

export const createTaskDto = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().uuid(),
  dueDate: z.string().optional(),
  plannedDate: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const updateTaskDto = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  plannedDate: z.string().nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
});

export const moveTaskDto = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'APPROVED']),
  report: z.string().optional(),
});
