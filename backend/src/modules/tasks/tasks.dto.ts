import { z } from 'zod';
import { Role } from '@prisma/client';

const taskChecklistItemDto = z.object({
  text: z.string().trim().min(1).max(300),
  checked: z.boolean().optional(),
});

export const createTaskDto = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  assigneeIds: z.array(z.string().uuid()).max(500).optional(),
  assignmentMode: z.enum(['MANUAL', 'ALL', 'ROLES']).optional(),
  roleFilters: z.array(z.nativeEnum(Role)).max(20).optional(),
  dueDate: z.string().optional(),
  plannedDate: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  checklist: z.array(taskChecklistItemDto).max(50).optional(),
});

export const updateTaskDto = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  plannedDate: z.string().nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  checklist: z.array(taskChecklistItemDto).max(50).optional(),
});

export const moveTaskDto = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'APPROVED']),
  report: z.string().optional(),
});
