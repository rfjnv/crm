import { Router } from 'express';
import { authController, REFRESH_COOKIE } from './auth.controller';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { loginDto, refreshDto, telegramWebAppDto } from './auth.dto';
import { asyncHandler } from '../../lib/asyncHandler';
import { byIp, hashKey, rateLimiter } from '../../middleware/rateLimiter';

const router = Router();

const WINDOW_15M = 15 * 60 * 1000;

/**
 * Узкие лимиты считаются по аккаунту/сессии, а по IP — только запасной потолок:
 * весь офис выходит в интернет с одного адреса, и общий лимит 10–30 на IP выкидывал
 * людей на экран входа, а потом не пускал обратно.
 */
const loginLimiters = [
  // Подбор пароля к одному логину
  rateLimiter(WINDOW_15M, 10, (req) => {
    const login = typeof req.body?.login === 'string' ? req.body.login.trim().toLowerCase() : '';
    return login ? `login:${login}` : '';
  }),
  rateLimiter(WINDOW_15M, 100, byIp),
];

const telegramLoginLimiter = rateLimiter(WINDOW_15M, 100, byIp);

const refreshLimiters = [
  // Зациклившийся клиент повторяет один и тот же токен; удачный refresh выдаёт новый
  rateLimiter(WINDOW_15M, 20, (req) => {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    return typeof token === 'string' && token ? `rt:${hashKey(token)}` : '';
  }),
  rateLimiter(WINDOW_15M, 600, byIp),
];

router.post(
  '/login',
  ...loginLimiters,
  validate(loginDto),
  asyncHandler(authController.login.bind(authController)),
);

router.post(
  '/telegram-webapp',
  telegramLoginLimiter,
  validate(telegramWebAppDto),
  asyncHandler(authController.telegramWebApp.bind(authController)),
);

router.post(
  '/refresh',
  ...refreshLimiters,
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
