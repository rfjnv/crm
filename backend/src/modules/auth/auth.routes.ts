import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { loginDto, refreshDto } from './auth.dto';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

router.post(
  '/login',
  validate(loginDto),
  asyncHandler(authController.login.bind(authController)),
);

router.post(
  '/refresh',
  validate(refreshDto),
  asyncHandler(authController.refresh.bind(authController)),
);

router.post(
  '/logout',
  validate(refreshDto),
  asyncHandler(authController.logout.bind(authController)),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(authController.me.bind(authController)),
);

export default router;
