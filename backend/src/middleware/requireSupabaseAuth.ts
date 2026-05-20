import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

/** Доступ для пользователей, вошедших через Supabase (email). */
export function requireSupabaseAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.supabaseUserId) {
    next(new AppError(403, 'Раздел доступен при входе по email'));
    return;
  }
  next();
}
