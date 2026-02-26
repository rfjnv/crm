import { Request, Response } from 'express';
import { pushService } from './push.service';
import { config } from '../../lib/config';

export class PushController {
  async subscribe(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const userAgent = req.headers['user-agent'];
    await pushService.subscribe(userId, req.body, userAgent);
    res.status(201).json({ success: true });
  }

  async unsubscribe(req: Request, res: Response): Promise<void> {
    await pushService.unsubscribe(req.body.endpoint);
    res.json({ success: true });
  }

  async test(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    await pushService.sendPushToUser(userId, {
      title: 'Тестовое уведомление',
      body: 'Push уведомления работают!',
      url: '/notifications',
      severity: 'INFO',
    });
    res.json({ success: true });
  }

  async getVapidPublicKey(_req: Request, res: Response): Promise<void> {
    res.json({ publicKey: config.vapid.publicKey });
  }
}

export const pushController = new PushController();
