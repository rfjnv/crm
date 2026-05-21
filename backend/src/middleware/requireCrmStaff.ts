import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../lib/errors';
import { canAccessCrmApi, isSiteAdminOnlyUser } from '../lib/crmAccess';

/** CRM API только для сотрудников (логин CRM). Админы сайта — site-cms и supabase-auth. */
export function requireCrmStaff(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new AppError(401, 'Не авторизован'));
    return;
  }

  if (!canAccessCrmApi(req.originalUrl, req.user.role as Role, req.user.supabaseUserId)) {
    next(new AppError(403, 'Доступ к CRM только для сотрудников (вход по логину)'));
    return;
  }
  next();
}

export function isCrmStaffUser(req: Request): boolean {
  if (!req.user) return false;
  return !isSiteAdminOnlyUser(req.user.role as Role, req.user.supabaseUserId);
}
