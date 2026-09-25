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
import { getPlanProgress } from './rop-agent.control';
import { buildDigest, getDigest, listDigests, tashkentYesterday } from './rop-agent.digest';
import { sendDigestToUser } from './rop-agent.telegram';
import { addMemory, deleteMemory, listMemories, updateMemory } from './rop-agent.memory';
import { decideAlert, listAlerts } from './rop-agent.alerts';

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

router.get('/plans/:planId/progress', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPlanProgress(req.params.planId as string, req.user!.userId));
}));

router.post('/plans/:planId/discard', asyncHandler(async (req: Request, res: Response) => {
  res.json(await discardPlan(req.params.planId as string, req.user!.userId));
}));

// ─── Ежедневная сводка ──────────────────────────────────────────────────────

router.get('/digests', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ latestDate: tashkentYesterday(), digests: await listDigests() });
}));

router.get('/digests/:date', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getDigest(req.params.date as string));
}));

/** Собрать заново (или впервые) — цифры на сейчас и новый комментарий агента. */
router.post('/digests/:date/build', asyncHandler(async (req: Request, res: Response) => {
  res.json(await buildDigest(req.params.date as string));
}));

/** Прислать сводку себе в Telegram. */
router.post('/digests/:date/send-me', asyncHandler(async (req: Request, res: Response) => {
  await sendDigestToUser(req.params.date as string, req.user!.userId);
  res.json({ ok: true });
}));

// ─── Память агента ──────────────────────────────────────────────────────────

const memoryDto = z.object({
  content: z.string().trim().min(1).max(500),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

router.get('/memories', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listMemories());
}));

router.post('/memories', asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await addMemory(req.user!.userId, memoryDto.parse(req.body)));
}));

router.patch('/memories/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json(await updateMemory(req.params.id as string, memoryDto.partial().parse(req.body)));
}));

router.delete('/memories/:id', asyncHandler(async (req: Request, res: Response) => {
  await deleteMemory(req.params.id as string);
  res.status(204).end();
}));

// ─── Сигналы ────────────────────────────────────────────────────────────────

router.get('/alerts', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listAlerts());
}));

router.post('/alerts/:id/accept', asyncHandler(async (req: Request, res: Response) => {
  res.json(await decideAlert(req.params.id as string, req.user!.userId, true));
}));

router.post('/alerts/:id/decline', asyncHandler(async (req: Request, res: Response) => {
  res.json(await decideAlert(req.params.id as string, req.user!.userId, false));
}));

/** Кому можно переназначить задачу в плане. */
router.get('/managers', asyncHandler(async (_req: Request, res: Response) => {
  const { managers } = await listManagers();
  res.json(managers.map((m) => ({ id: m.id, name: m.name, role: m.role, clients: m.clients })));
}));

export default router;
