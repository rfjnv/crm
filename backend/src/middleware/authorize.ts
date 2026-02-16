import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../lib/errors';

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'Не авторизован');
    }

    if (!roles.includes(req.user.role as Role)) {
      throw new AppError(403, 'Недостаточно прав');
    }

    next();
  };
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'Не авторизован');
    }

    // SUPER_ADMIN always has all permissions
    if (req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    const userPerms = req.user.permissions || [];
    const hasAll = permissions.every((p) => userPerms.includes(p));
    if (!hasAll) {
      throw new AppError(403, 'Недостаточно прав');
    }

    next();
  };
}
