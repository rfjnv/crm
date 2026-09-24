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

const askDto = z.object({ question: z.string().trim().min(1, 'Вопрос не может быть пустым').max(8000) });
const renameDto = z.object({ title: z.string().trim().min(1).max(100) });

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

export default router;
