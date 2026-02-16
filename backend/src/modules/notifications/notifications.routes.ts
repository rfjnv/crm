import { Router } from 'express';
import { notificationsController } from './notifications.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { broadcastDto, previewDto } from './notifications.dto';

const router = Router();

router.use(authenticate);

// All authenticated users
router.get('/', asyncHandler(notificationsController.findAll.bind(notificationsController)));
router.get('/unread-count', asyncHandler(notificationsController.getUnreadCount.bind(notificationsController)));
router.patch('/read-all', asyncHandler(notificationsController.markAllRead.bind(notificationsController)));
router.patch('/:id/read', asyncHandler(notificationsController.markRead.bind(notificationsController)));

// ADMIN/SUPER_ADMIN only
router.post(
  '/broadcast',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(broadcastDto),
  asyncHandler(notificationsController.broadcast.bind(notificationsController)),
);

router.post(
  '/broadcast/preview',
  authorize('ADMIN', 'SUPER_ADMIN'),
  validate(previewDto),
  asyncHandler(notificationsController.previewRecipients.bind(notificationsController)),
);

export default router;
