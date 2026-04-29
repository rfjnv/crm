import { Request, Response } from 'express';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { authService } from './auth.service';

const REFRESH_COOKIE = 'crm_rt';

/** Strict blocks refresh cookie on cross-origin XHR (отдельный домен фронта и API) — после ~15m access JWT сессия рвётся. В prod: None + Secure. */
const sameSite: 'lax' | 'none' = config.isProduction ? 'none' : 'lax';
const cookieOpts = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite,
  maxAge: config.jwt.refreshExpiresInMs,
  path: '/',
};

function getSessionMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

function resolveRefreshToken(req: Request): string {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  const fromBody = req.body?.refreshToken;
  const token = fromCookie || fromBody;
  if (!token) {
    throw new AppError(401, 'Refresh token не предоставлен');
  }
  return token;
}

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    const tokens = await authService.login(req.body, getSessionMeta(req));
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts);
    res.json({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken = resolveRefreshToken(req);
    const tokens = await authService.refresh(refreshToken, getSessionMeta(req));
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOpts);
    res.json({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  }

  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = resolveRefreshToken(req);
    await authService.logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE, {
      path: '/',
      sameSite: cookieOpts.sameSite,
      secure: cookieOpts.secure,
    });
    res.json({ message: 'Выход выполнен' });
  }

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getMe(req.user!.userId);
    res.json(user);
  }
}

export const authController = new AuthController();
