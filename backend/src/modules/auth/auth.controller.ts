import { Request, Response } from 'express';
import { authService } from './auth.service';

function getSessionMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    const tokens = await authService.login(req.body, getSessionMeta(req));
    res.json(tokens);
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    const tokens = await authService.refresh(refreshToken, getSessionMeta(req));
    res.json(tokens);
  }

  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);
    res.json({ message: 'Выход выполнен' });
  }

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.getMe(req.user!.userId);
    res.json(user);
  }
}

export const authController = new AuthController();
