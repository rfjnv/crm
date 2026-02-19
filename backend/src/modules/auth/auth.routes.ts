import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { loginDto, refreshDto } from './auth.dto';
import { asyncHandler } from '../../lib/asyncHandler';
import { rateLimiter } from '../../middleware/rateLimiter';

const router = Router();

const loginLimiter = rateLimiter(15 * 60 * 1000, 10);

router.post(
  '/login',
  loginLimiter,
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
