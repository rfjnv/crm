import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  console.error('Unhandled error:', err);

  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}
