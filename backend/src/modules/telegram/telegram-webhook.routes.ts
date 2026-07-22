import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { AppError } from '../../lib/errors';
import { config } from '../../lib/config';
import { telegramService } from './telegram.service';
import { telegramCustomerBotService } from './telegram.customer-bot.service';

const router = Router();

function verifyTelegramSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = config.telegram.webhookSecret;
  if (!expected) {
    next(new AppError(503, 'TELEGRAM_WEBHOOK_SECRET is not configured'));
    return;
  }

  const provided = String(req.header('x-telegram-bot-api-secret-token') || '');
  if (!provided) {
    next(new AppError(401, 'Invalid Telegram webhook secret'));
    return;
  }

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.alloc(expectedBuf.length);
  providedBuf.write(provided.slice(0, expectedBuf.length));
  if (!timingSafeEqual(expectedBuf, providedBuf) || provided.length !== expected.length) {
    next(new AppError(401, 'Invalid Telegram webhook secret'));
    return;
  }

  next();
}

router.post('/admin', verifyTelegramSecret, (req: Request, res: Response) => {
  telegramService.handleWebhookUpdate(req.body);
  res.sendStatus(200);
});

router.post('/customer', verifyTelegramSecret, (req: Request, res: Response) => {
  telegramCustomerBotService.handleWebhookUpdate(req.body);
  res.sendStatus(200);
});

export default router;
