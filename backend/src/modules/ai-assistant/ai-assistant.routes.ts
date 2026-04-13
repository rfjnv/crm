import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { askQuestionDto, renameChatDto } from './ai-assistant.dto';
import {
  listChats,
  createChat,
  getChatMessages,
  askQuestionInChat,
  renameChat,
  deleteChat,
} from './ai-assistant.service';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'));

// List chats
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const chats = await listChats(req.user!.userId);
    res.json(chats);
  }),
);

// Create chat
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const chat = await createChat(req.user!.userId);
    res.status(201).json(chat);
  }),
);

// Get chat messages
router.get(
  '/:chatId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const messages = await getChatMessages(req.params.chatId as string, req.user!.userId);
    res.json(messages);
  }),
);

// Ask question in chat
router.post(
  '/:chatId/ask',
  asyncHandler(async (req: Request, res: Response) => {
    const { question } = askQuestionDto.parse(req.body);
    const result = await askQuestionInChat(req.params.chatId as string, req.user!.userId, question);
    res.json(result);
  }),
);

// Rename chat
router.patch(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response) => {
    const { title } = renameChatDto.parse(req.body);
    const chat = await renameChat(req.params.chatId as string, req.user!.userId, title);
    res.json(chat);
  }),
);

// Delete chat
router.delete(
  '/:chatId',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteChat(req.params.chatId as string, req.user!.userId);
    res.status(204).end();
  }),
);

export default router;
