import { ConversationType, Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { AuthUser } from '../../lib/scope';
import { SendMessageDto } from './conversations.dto';

// Role -> accessible conversation types
const ROLE_CONVERSATIONS: Record<string, ConversationType[]> = {
  SUPER_ADMIN: ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'SHIPMENT'],
  ADMIN: ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'SHIPMENT'],
  MANAGER: ['SALES'],
  OPERATOR: ['SALES'],
  WAREHOUSE: ['WAREHOUSE', 'SHIPMENT'],
  WAREHOUSE_MANAGER: ['WAREHOUSE', 'SHIPMENT'],
  ACCOUNTANT: ['ACCOUNTING'],
};

const CONVERSATION_LABELS: Record<ConversationType, string> = {
  SALES: 'Продажи',
  WAREHOUSE: 'Склад',
  ACCOUNTING: 'Бухгалтерия',
  SHIPMENT: 'Отгрузки',
};

function getAccessibleTypes(role: string): ConversationType[] {
  return ROLE_CONVERSATIONS[role] || [];
}

function verifyAccess(role: string, type: ConversationType): void {
  const accessible = getAccessibleTypes(role);
  if (!accessible.includes(type)) {
    throw new AppError(403, 'Нет доступа к данному каналу');
  }
}

// Common include pattern for full message response
const messageInclude = {
  sender: { select: { id: true, fullName: true } },
  deal: { select: { id: true, title: true } },
  replyTo: {
    select: {
      id: true,
      text: true,
      senderId: true,
      isDeleted: true,
      sender: { select: { id: true, fullName: true } },
    },
  },
  attachments: { select: { id: true, filename: true, mimeType: true, size: true } },
};

export class ConversationsService {
  async getConversations(user: AuthUser) {
    const types = getAccessibleTypes(user.role);

    // Get last read timestamps
    const reads = await prisma.conversationRead.findMany({
      where: { userId: user.userId, conversationType: { in: types } },
    });
    const readMap = new Map(reads.map((r) => [r.conversationType, r.lastReadAt]));

    // Get latest message per conversation + unread counts
    const result = await Promise.all(
      types.map(async (type) => {
        const lastReadAt = readMap.get(type) || new Date(0);

        const [lastMessage, unreadCount] = await Promise.all([
          prisma.message.findFirst({
            where: { conversationType: type },
            orderBy: { createdAt: 'desc' },
            include: { sender: { select: { id: true, fullName: true } } },
          }),
          prisma.message.count({
            where: {
              conversationType: type,
              createdAt: { gt: lastReadAt },
              senderId: { not: user.userId },
            },
          }),
        ]);

        return {
          type,
          label: CONVERSATION_LABELS[type],
          lastMessage: lastMessage || null,
          unreadCount,
        };
      }),
    );

    return result;
  }

  async getMessages(type: ConversationType, user: AuthUser, cursor?: string, limit = 50) {
    verifyAccess(user.role, type);

    const where: Record<string, unknown> = { conversationType: type };
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: messageInclude,
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    return {
      messages: messages.reverse(),
      nextCursor: hasMore ? messages[0]?.createdAt.toISOString() : null,
    };
  }

  async sendMessageWithAttachments(
    type: ConversationType,
    dto: SendMessageDto,
    files: Express.Multer.File[] | undefined,
    user: AuthUser,
  ) {
    verifyAccess(user.role, type);

    // Verify replyToId belongs to the same conversation type
    if (dto.replyToId) {
      const replyTarget = await prisma.message.findUnique({
        where: { id: dto.replyToId },
      });
      if (!replyTarget) {
        throw new AppError(404, 'Сообщение для ответа не найдено');
      }
      if (replyTarget.conversationType !== type) {
        throw new AppError(400, 'Нельзя ответить на сообщение из другого канала');
      }
    }

    // Verify deal exists if dealId provided
    if (dto.dealId) {
      const deal = await prisma.deal.findUnique({ where: { id: dto.dealId } });
      if (!deal) {
        throw new AppError(404, 'Сделка не найдена');
      }
    }

    // Create message + attachments in a transaction
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationType: type,
          senderId: user.userId,
          text: dto.text,
          dealId: dto.dealId,
          replyToId: dto.replyToId,
        },
      });

      // Create attachments if files were uploaded
      if (files && files.length > 0) {
        await tx.messageAttachment.createMany({
          data: files.map((file) => ({
            messageId: created.id,
            filename: file.originalname,
            path: file.path,
            mimeType: file.mimetype,
            size: file.size,
          })),
        });
      }

      // Return full message with includes
      return tx.message.findUnique({
        where: { id: created.id },
        include: messageInclude,
      });
    });

    // Auto-mark as read for sender
    await prisma.conversationRead.upsert({
      where: {
        userId_conversationType: { userId: user.userId, conversationType: type },
      },
      update: { lastReadAt: new Date() },
      create: { userId: user.userId, conversationType: type, lastReadAt: new Date() },
    });

    return message;
  }

  async editMessage(messageId: string, text: string, user: AuthUser) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });

    if (!message) {
      throw new AppError(404, 'Сообщение не найдено');
    }

    if (message.senderId !== user.userId) {
      throw new AppError(403, 'Можно редактировать только свои сообщения');
    }

    if (message.isDeleted) {
      throw new AppError(400, 'Нельзя редактировать удалённое сообщение');
    }

    const minutesSinceCreation = (Date.now() - message.createdAt.getTime()) / 1000 / 60;
    if (minutesSinceCreation > 10) {
      throw new AppError(400, 'Сообщение можно редактировать только в течение 10 минут после отправки');
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        text,
        editedAt: new Date(),
      },
      include: messageInclude,
    });

    return updated;
  }

  async deleteMessage(messageId: string, user: AuthUser) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });

    if (!message) {
      throw new AppError(404, 'Сообщение не найдено');
    }

    if (message.senderId !== user.userId) {
      throw new AppError(403, 'Можно удалять только свои сообщения');
    }

    const minutesSinceCreation = (Date.now() - message.createdAt.getTime()) / 1000 / 60;
    if (minutesSinceCreation > 10) {
      throw new AppError(400, 'Сообщение можно удалить только в течение 10 минут после отправки');
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        text: '',
      },
      include: messageInclude,
    });

    return updated;
  }

  async searchMessages(query: string, user: AuthUser) {
    const types = getAccessibleTypes(user.role);

    const messages = await prisma.message.findMany({
      where: {
        conversationType: { in: types },
        isDeleted: false,
        text: { contains: query, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sender: { select: { id: true, fullName: true } },
      },
    });

    return messages;
  }

  async getLatestReadAt(type: ConversationType, user: AuthUser) {
    verifyAccess(user.role, type);

    const reads = await prisma.conversationRead.findMany({
      where: {
        conversationType: type,
        userId: { not: user.userId },
      },
      orderBy: { lastReadAt: 'desc' },
      take: 1,
    });

    return reads.length > 0 ? reads[0].lastReadAt : null;
  }

  async downloadAttachment(attachmentId: string, user: AuthUser) {
    const attachment = await prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: true },
    });

    if (!attachment) {
      throw new AppError(404, 'Вложение не найдено');
    }

    verifyAccess(user.role, attachment.message.conversationType);

    return attachment;
  }

  async markRead(type: ConversationType, user: AuthUser) {
    verifyAccess(user.role, type);

    await prisma.conversationRead.upsert({
      where: {
        userId_conversationType: { userId: user.userId, conversationType: type },
      },
      update: { lastReadAt: new Date() },
      create: { userId: user.userId, conversationType: type, lastReadAt: new Date() },
    });

    return { ok: true };
  }

  async getUnreadCounts(user: AuthUser) {
    const types = getAccessibleTypes(user.role);

    const reads = await prisma.conversationRead.findMany({
      where: { userId: user.userId, conversationType: { in: types } },
    });
    const readMap = new Map(reads.map((r) => [r.conversationType, r.lastReadAt]));

    const counts: Record<string, number> = {};
    await Promise.all(
      types.map(async (type) => {
        const lastReadAt = readMap.get(type) || new Date(0);
        counts[type] = await prisma.message.count({
          where: {
            conversationType: type,
            createdAt: { gt: lastReadAt },
            senderId: { not: user.userId },
          },
        });
      }),
    );

    return counts;
  }
}

export const conversationsService = new ConversationsService();
