import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { AuthUser, clientOwnerScope } from '../../lib/scope';
import type { CreateClientNoteDto, UpdateClientNoteDto } from './clients.dto';

async function assertClientAccess(clientId: string, user: AuthUser): Promise<void> {
  const row = await prisma.client.findFirst({
    where: { id: clientId, ...clientOwnerScope(user), isArchived: false },
    select: { id: true },
  });
  if (!row) {
    throw new AppError(404, 'Клиент не найден');
  }
}

export class ClientNotesService {
  async list(clientId: string, user: AuthUser, includeDeleted: boolean) {
    await assertClientAccess(clientId, user);
    if (includeDeleted && user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Недостаточно прав');
    }

    const where = {
      clientId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    };

    const notes = await prisma.clientNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, fullName: true } } },
    });

    return notes.map((n) => ({
      id: n.id,
      clientId: n.clientId,
      userId: n.userId,
      content: n.content,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      deletedAt: n.deletedAt?.toISOString() ?? null,
      user: n.user,
    }));
  }

  async create(clientId: string, dto: CreateClientNoteDto, user: AuthUser) {
    await assertClientAccess(clientId, user);

    const note = await prisma.clientNote.create({
      data: {
        clientId,
        userId: user.userId,
        content: dto.content.trim(),
      },
      include: { user: { select: { id: true, fullName: true } } },
    });

    return {
      id: note.id,
      clientId: note.clientId,
      userId: note.userId,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      deletedAt: null as null,
      user: note.user,
    };
  }

  async update(clientId: string, noteId: string, dto: UpdateClientNoteDto, user: AuthUser) {
    await assertClientAccess(clientId, user);

    const note = await prisma.clientNote.findFirst({
      where: { id: noteId, clientId, deletedAt: null },
    });
    if (!note) {
      throw new AppError(404, 'Заметка не найдена');
    }

    const isOwner = note.userId === user.userId;
    const isSuper = user.role === 'SUPER_ADMIN';
    if (!isOwner && !isSuper) {
      throw new AppError(403, 'Можно редактировать только свои заметки');
    }

    const updated = await prisma.clientNote.update({
      where: { id: noteId },
      data: { content: dto.content.trim() },
      include: { user: { select: { id: true, fullName: true } } },
    });

    return {
      id: updated.id,
      clientId: updated.clientId,
      userId: updated.userId,
      content: updated.content,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      deletedAt: updated.deletedAt?.toISOString() ?? null,
      user: updated.user,
    };
  }

  async softDelete(clientId: string, noteId: string, user: AuthUser) {
    await assertClientAccess(clientId, user);

    const note = await prisma.clientNote.findFirst({
      where: { id: noteId, clientId, deletedAt: null },
    });
    if (!note) {
      throw new AppError(404, 'Заметка не найдена');
    }

    const isOwner = note.userId === user.userId;
    const isSuper = user.role === 'SUPER_ADMIN';
    if (!isOwner && !isSuper) {
      throw new AppError(403, 'Можно удалить только свои заметки');
    }

    const updated = await prisma.clientNote.update({
      where: { id: noteId },
      data: { deletedAt: new Date() },
      include: { user: { select: { id: true, fullName: true } } },
    });

    return {
      id: updated.id,
      clientId: updated.clientId,
      userId: updated.userId,
      content: updated.content,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      deletedAt: updated.deletedAt?.toISOString() ?? null,
      user: updated.user,
    };
  }

  async restore(clientId: string, noteId: string, user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Только супер-администратор может восстановить заметку');
    }

    await assertClientAccess(clientId, user);

    const note = await prisma.clientNote.findFirst({
      where: { id: noteId, clientId, deletedAt: { not: null } },
    });
    if (!note) {
      throw new AppError(404, 'Удалённая заметка не найдена');
    }

    const updated = await prisma.clientNote.update({
      where: { id: noteId },
      data: { deletedAt: null },
      include: { user: { select: { id: true, fullName: true } } },
    });

    return {
      id: updated.id,
      clientId: updated.clientId,
      userId: updated.userId,
      content: updated.content,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      deletedAt: null as null,
      user: updated.user,
    };
  }
}

export const clientNotesService = new ClientNotesService();
