import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../lib/errors';

/** Доступ для пользователей, вошедших через Supabase (email) или роли SITE_ADMIN. */
export function requireSupabaseAuth(req: Request, _res: Response, next: NextFunction): void {
  const ok =
    Boolean(req.user?.supabaseUserId)
    || req.user?.role === Role.SITE_ADMIN;
  if (!ok) {
    next(new AppError(403, 'Раздел доступен при входе по email'));
    return;
  }
  next();
}
