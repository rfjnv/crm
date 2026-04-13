import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { askQuestionDto, renameChatDto, createTrainingRuleDto, updateTrainingRuleDto } from './ai-assistant.dto';
import {
  listChats,
  createChat,
  getChatMessages,
  askQuestionInChat,
  renameChat,
  deleteChat,
  listTrainingRules,
  createTrainingRule,
  updateTrainingRule,
  deleteTrainingRule,
} from './ai-assistant.service';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'));

// ==================== Training Rules (SUPER_ADMIN / ADMIN only) ====================
// Must be defined BEFORE /:chatId routes to avoid "training-rules" matching as chatId

router.get(
  '/training-rules',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (_req: Request, res: Response) => {
    const rules = await listTrainingRules();
    res.json(rules);
  }),
);

router.post(
  '/training-rules',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = createTrainingRuleDto.parse(req.body);
    const rule = await createTrainingRule(req.user!.userId, data);
    res.status(201).json(rule);
  }),
);

router.patch(
  '/training-rules/:ruleId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = updateTrainingRuleDto.parse(req.body);
    const rule = await updateTrainingRule(req.params.ruleId as string, data);
    res.json(rule);
  }),
);

router.delete(
  '/training-rules/:ruleId',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteTrainingRule(req.params.ruleId as string);
    res.status(204).end();
  }),
);

// ==================== Chat CRUD ====================

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const chats = await listChats(req.user!.userId);
    res.json(chats);
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const chat = await createChat(req.user!.userId);
    res.status(201).json(chat);
  }),
);

router.get(
  '/:chatId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const messages = await getChatMessages(req.params.chatId as string, req.user!.userId);
    res.json(messages);
  }),
);

router.post(
  '/:chatId/ask',
  asyncHandler(async (req: Request, res: Response) => {
    const { question } = askQuestionDto.parse(req.body);
    const result = await askQuestionInChat(req.params.chatId as string, req.user!.userId, question);
    res.json(result);
  }),
);

router.patch(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = renameChatDto.parse(req.body);
    const chat = await renameChat(req.params.chatId as string, req.user!.userId, title);
    res.json(chat);
  }),
);

router.delete(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteChat(req.params.chatId as string, req.user!.userId);
    res.status(204).end();
  }),
);

export default router;
