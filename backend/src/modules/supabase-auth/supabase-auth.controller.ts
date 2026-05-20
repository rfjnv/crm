import { Request, Response } from 'express';
import { config, isSupabaseConfigured } from '../../lib/config';
import { supabaseAuthService } from './supabase-auth.service';

const REFRESH_COOKIE = 'crm_rt';
const sameSite: 'lax' | 'none' = config.isProduction ? 'none' : 'lax';
const cookieOpts = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite,
  maxAge: config.jwt.refreshExpiresInMs,
  path: '/',
};

function sessionMeta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

export class SupabaseAuthController {
  async config(_req: Request, res: Response): Promise<void> {
    if (!isSupabaseConfigured) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      url: config.supabase.url,
      anonKey: config.supabase.anonKey,
    });
  }

  async exchange(req: Request, res: Response): Promise<void> {
    const result = await supabaseAuthService.exchangeSession(req.body.accessToken, sessionMeta(req));
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOpts);
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  }

  async listUsers(_req: Request, res: Response): Promise<void> {
    const users = await supabaseAuthService.listUsers();
    res.json(users);
  }

  async createUser(req: Request, res: Response): Promise<void> {
    const user = await supabaseAuthService.createUser(req.body.email, req.body.password, req.body.role);
    res.status(201).json(user);
  }

  async updateRole(req: Request, res: Response): Promise<void> {
    const user = await supabaseAuthService.updateRole(req.params.id as string, req.body.role);
    res.json(user);
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    await supabaseAuthService.deleteUser(req.params.id as string, req.user?.supabaseUserId);
    res.json({ message: 'Пользователь удалён' });
  }
}

export const supabaseAuthController = new SupabaseAuthController();
