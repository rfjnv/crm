import { Request, Response } from 'express';
import { notificationsService } from './notifications.service';

export class NotificationsController {
  async findAll(req: Request, res: Response): Promise<void> {
    const userId = req.user!.userId;
    const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = req.query.cursor as string | undefined;

    const result = await notificationsService.findAll(userId, { unreadOnly, limit, cursor });
    res.json(result);
  }

  async getUnreadCount(req: Request, res: Response): Promise<void> {
    const count = await notificationsService.getUnreadCount(req.user!.userId);
    res.json({ count });
  }

  async markRead(req: Request, res: Response): Promise<void> {
    const notification = await notificationsService.markRead(req.params.id as string, req.user!.userId);
    res.json(notification);
  }

  async markAllRead(req: Request, res: Response): Promise<void> {
    const result = await notificationsService.markAllRead(req.user!.userId);
    res.json(result);
  }

  async broadcast(req: Request, res: Response): Promise<void> {
    const result = await notificationsService.broadcast(req.body, req.user!.userId);
    res.status(201).json(result);
  }

  async previewRecipients(req: Request, res: Response): Promise<void> {
    const result = await notificationsService.previewRecipients(req.body.targets);
    res.json(result);
  }
}

export const notificationsController = new NotificationsController();
