import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { PERMISSIONS } from '../../lib/permissions';
import {
  askInChat,
  createChat,
  deleteChat,
  getChatMessages,
  getTurnStatus,
  listChats,
  renameChat,
} from './rop-agent.service';
import { assignPlan, discardPlan, listChatPlans, updatePlan } from './rop-agent.plans';
import { listManagers } from './rop-agent.analysis';

const askDto = z.object({ question: z.string().trim().min(1, 'Вопрос не может быть пустым').max(8000) });
const renameDto = z.object({ title: z.string().trim().min(1).max(100) });
const planClientDto = z.object({
  clientId: z.string().min(1),
  reason: z.string().max(500).default(''),
  offer: z.string().max(500).default(''),
});
const updatePlanDto = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  items: z.array(z.object({
    key: z.string().max(64).optional(),
    managerId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(''),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    clients: z.array(planClientDto).max(200),
  })).min(1).max(50),
});

const router = Router();

// Доступ поимённо: SUPER_ADMIN всегда, остальным — право use_rop_agent.
// Сотрудникам без полного доступа к деньгам раздел закрыт в authenticate (moneyAccess).
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.USE_ROP_AGENT));

router.get('/chats', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listChats(req.user!.userId));
}));

router.post('/chats', asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await createChat(req.user!.userId));
}));

router.get('/chats/:chatId/messages', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getChatMessages(req.params.chatId as string, req.user!.userId));
}));

router.get('/chats/:chatId/status', asyncHandler(async (req: Request, res: Response) => {
  // Владение чатом проверяет getChatMessages; статус сам по себе ничего не раскрывает,
  // но проверяем так же, чтобы не угадывали чужие id.
  await getChatMessages(req.params.chatId as string, req.user!.userId);
  res.json(getTurnStatus(req.params.chatId as string));
}));

router.post('/chats/:chatId/ask', asyncHandler(async (req: Request, res: Response) => {
  const { question } = askDto.parse(req.body);
  res.status(202).json(await askInChat(req.params.chatId as string, req.user!.userId, question));
}));

router.patch('/chats/:chatId', asyncHandler(async (req: Request, res: Response) => {
  const { title } = renameDto.parse(req.body);
  res.json(await renameChat(req.params.chatId as string, req.user!.userId, title));
}));

router.delete('/chats/:chatId', asyncHandler(async (req: Request, res: Response) => {
  await deleteChat(req.params.chatId as string, req.user!.userId);
  res.status(204).end();
}));

// ─── Планы задач ────────────────────────────────────────────────────────────

router.get('/chats/:chatId/plans', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listChatPlans(req.params.chatId as string, req.user!.userId));
}));

router.put('/plans/:planId', asyncHandler(async (req: Request, res: Response) => {
  const data = updatePlanDto.parse(req.body);
  res.json(await updatePlan(req.params.planId as string, req.user!.userId, data));
}));

router.post('/plans/:planId/assign', asyncHandler(async (req: Request, res: Response) => {
  res.json(await assignPlan(req.params.planId as string, req.user!.userId));
}));

router.post('/plans/:planId/discard', asyncHandler(async (req: Request, res: Response) => {
  res.json(await discardPlan(req.params.planId as string, req.user!.userId));
}));

/** Кому можно переназначить задачу в плане. */
router.get('/managers', asyncHandler(async (_req: Request, res: Response) => {
  const { managers } = await listManagers();
  res.json(managers.map((m) => ({ id: m.id, name: m.name, role: m.role, clients: m.clients })));
}));

export default router;
