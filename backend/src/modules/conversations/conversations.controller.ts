import { Request, Response } from 'express';
import { ConversationType, Role } from '@prisma/client';
import { conversationsService } from './conversations.service';
import { AuthUser } from '../../lib/scope';
import { sendMessageDto, editMessageDto } from './conversations.dto';

function getUser(req: Request): AuthUser {
  return { userId: req.user!.userId, role: req.user!.role as Role, permissions: req.user!.permissions || [] };
}

export class ConversationsController {
  async getConversations(req: Request, res: Response): Promise<void> {
    const result = await conversationsService.getConversations(getUser(req));
    res.json(result);
  }

  async getUnreadCounts(req: Request, res: Response): Promise<void> {
    const counts = await conversationsService.getUnreadCounts(getUser(req));
    res.json(counts);
  }

  async getMessages(req: Request, res: Response): Promise<void> {
    const type = (req.params.type as string).toUpperCase() as ConversationType;
    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const result = await conversationsService.getMessages(type, getUser(req), cursor, limit);
    res.json(result);
  }

  async sendMessage(req: Request, res: Response): Promise<void> {
    const type = (req.params.type as string).toUpperCase() as ConversationType;

    // With multer, body fields come as strings; validate manually
    const parsed = sendMessageDto.parse({
      text: req.body.text,
      dealId: req.body.dealId || undefined,
      replyToId: req.body.replyToId || undefined,
    });

    const files = req.files as Express.Multer.File[] | undefined;
    const message = await conversationsService.sendMessageWithAttachments(type, parsed, files, getUser(req));
    res.status(201).json(message);
  }

  async editMessage(req: Request, res: Response): Promise<void> {
    const messageId = req.params.messageId as string;
    const { text } = editMessageDto.parse(req.body);
    const result = await conversationsService.editMessage(messageId, text, getUser(req));
    res.json(result);
  }

  async deleteMessage(req: Request, res: Response): Promise<void> {
    const messageId = req.params.messageId as string;
    const result = await conversationsService.deleteMessage(messageId, getUser(req));
    res.json(result);
  }

  async searchMessages(req: Request, res: Response): Promise<void> {
    const query = req.query.query as string;
    if (!query || query.length < 1) {
      res.json([]);
      return;
    }
    const results = await conversationsService.searchMessages(query, getUser(req));
    res.json(results);
  }

  async getReadStatus(req: Request, res: Response): Promise<void> {
    const type = (req.params.type as string).toUpperCase() as ConversationType;
    const latestReadAt = await conversationsService.getLatestReadAt(type, getUser(req));
    res.json({ latestReadAt: latestReadAt ? latestReadAt.toISOString() : null });
  }

  async downloadAttachment(req: Request, res: Response): Promise<void> {
    const attachmentId = req.params.attachmentId as string;
    const attachment = await conversationsService.downloadAttachment(attachmentId, getUser(req));
    res.download(attachment.path, attachment.filename);
  }

  async markRead(req: Request, res: Response): Promise<void> {
    const type = (req.params.type as string).toUpperCase() as ConversationType;
    const result = await conversationsService.markRead(type, getUser(req));
    res.json(result);
  }
}

export const conversationsController = new ConversationsController();
