import { Request, Response, NextFunction } from 'express';
import { runWithRequestContext } from '../lib/requestContext';

/** Прокидывает IP/User-Agent/device-id в AsyncLocalStorage, чтобы auditLog() мог их подхватить без правки каждого места вызова. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const deviceIdHeader = req.headers['x-device-id'];
  const deviceId = typeof deviceIdHeader === 'string' ? deviceIdHeader : undefined;

  runWithRequestContext(
    {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId,
    },
    next,
  );
}
