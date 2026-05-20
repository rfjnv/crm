import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

/** Доступ только для superadmin из Supabase user_metadata (в JWT после входа через Supabase). */
export function requireSupabaseSuperadmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.supabaseRole !== 'superadmin') {
    next(new AppError(403, 'Доступ только для Superadmin'));
    return;
  }
  next();
}
