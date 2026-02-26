import { Router } from 'express';
import { pushController } from './push.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { subscribeDto, unsubscribeDto } from './push.dto';

const router = Router();

router.use(authenticate);

router.get('/vapid-key', asyncHandler(pushController.getVapidPublicKey.bind(pushController)));

router.post(
  '/subscribe',
  validate(subscribeDto),
  asyncHandler(pushController.subscribe.bind(pushController)),
);

router.delete(
  '/unsubscribe',
  validate(unsubscribeDto),
  asyncHandler(pushController.unsubscribe.bind(pushController)),
);

router.post(
  '/test',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(pushController.test.bind(pushController)),
);

export default router;
