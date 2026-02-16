import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { conversationsController } from './conversations.controller';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// ──── Multer config ────
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../../../uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

router.use(authenticate);

// ──── Non-parameterized routes first (before /:type) ────
router.get('/search', asyncHandler(conversationsController.searchMessages.bind(conversationsController)));
router.get('/unread-counts', asyncHandler(conversationsController.getUnreadCounts.bind(conversationsController)));
router.get('/attachments/:attachmentId', asyncHandler(conversationsController.downloadAttachment.bind(conversationsController)));
router.patch('/messages/:messageId', asyncHandler(conversationsController.editMessage.bind(conversationsController)));
router.delete('/messages/:messageId', asyncHandler(conversationsController.deleteMessage.bind(conversationsController)));

// ──── Conversation list ────
router.get('/', asyncHandler(conversationsController.getConversations.bind(conversationsController)));

// ──── Per-conversation routes ────
router.get('/:type/messages', asyncHandler(conversationsController.getMessages.bind(conversationsController)));
router.post('/:type/messages', upload.array('files', 5), asyncHandler(conversationsController.sendMessage.bind(conversationsController)));
router.patch('/:type/read', asyncHandler(conversationsController.markRead.bind(conversationsController)));
router.get('/:type/read-status', asyncHandler(conversationsController.getReadStatus.bind(conversationsController)));

export default router;
