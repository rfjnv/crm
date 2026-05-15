import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ message: err.message, error: err.message });
    return;
  }

  console.error('Unhandled error:', err);

  res.status(500).json({ message: 'Внутренняя ошибка сервера', error: 'Внутренняя ошибка сервера' });
}
