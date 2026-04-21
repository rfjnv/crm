import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { AuthUser } from '../../lib/scope';
import type {
  CreateNotesBoardDto,
  ListNotesBoardQueryDto,
  RequestNotesBoardEditDto,
  UpdateNotesBoardDto,
} from './notes-board.dto';

type NotesBoardRowDto = {
  id: string;
  clientId: string;
  callResult: 'ANSWERED' | 'NO_ANSWER';
  status: string | null;
  comment: string;
  lastCallAt: string;
  nextCallAt: string | null;
  createdAt: string;
  updatedAt: string;
  editRequestCount: number;
  lastEditRequestComment: string | null;
  lastEditRequestByName: string | null;
  lastEditRequestAt: string | null;
  author: { id: string; fullName: string };
  client: { id: string; companyName: string };
};

function canDeleteRow(user: AuthUser, authorId: string): boolean {
  return user.role === 'SUPER_ADMIN' || user.userId === authorId;
}

function canEditRow(user: AuthUser, authorId: string): boolean {
  return (
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.userId === authorId
  );
}

function mapRow(row: {
  id: string;
  clientId: string;
  callResult: 'ANSWERED' | 'NO_ANSWER';
  status: string | null;
  comment: string;
  lastCallAt: Date;
  nextCallAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  editRequestCount: number;
  lastEditRequestComment: string | null;
  lastEditRequestByName: string | null;
  lastEditRequestAt: Date | null;
  author: { id: string; fullName: string };
  client: { id: string; companyName: string };
}): NotesBoardRowDto {
  return {
    id: row.id,
    clientId: row.clientId,
    callResult: row.callResult,
    status: row.status,
    comment: row.comment,
    lastCallAt: row.lastCallAt.toISOString(),
    nextCallAt: row.nextCallAt ? row.nextCallAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editRequestCount: row.editRequestCount,
    lastEditRequestComment: row.lastEditRequestComment,
    lastEditRequestByName: row.lastEditRequestByName,
    lastEditRequestAt: row.lastEditRequestAt ? row.lastEditRequestAt.toISOString() : null,
    author: row.author,
    client: row.client,
  };
}

function buildClientNoteText(input: {
  callResult: 'ANSWERED' | 'NO_ANSWER';
  status: string | null;
  comment: string;
  lastCallAt: Date;
}) {
  const callResultLabel = input.callResult === 'ANSWERED' ? 'Взял трубку' : 'Не взял трубку';
  const status = input.status?.trim() || '—';
  return `[NOTES_BOARD] Дозвон: ${callResultLabel}\nСтатус: ${status}\nДата контакта: ${input.lastCallAt.toISOString()}\nКомментарий: ${input.comment}`;
}

export class NotesBoardService {
  async list(query: ListNotesBoardQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const q = query.q?.trim();

    const where = {
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.callResult ? { callResult: query.callResult } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { comment: { contains: q, mode: 'insensitive' as const } },
              { status: { contains: q, mode: 'insensitive' as const } },
              { client: { companyName: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.notesBoardRow.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ lastCallAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          author: { select: { id: true, fullName: true } },
          client: { select: { id: true, companyName: true } },
        },
      }),
      prisma.notesBoardRow.count({ where }),
    ]);

    return {
      items: rows.map(mapRow),
      meta: { page, pageSize, total },
    };
  }

  async create(dto: CreateNotesBoardDto, user: AuthUser) {
    const client = await prisma.client.findFirst({
      where: { id: dto.clientId, isArchived: false },
      select: { id: true, companyName: true },
    });
    if (!client) throw new AppError(404, 'Клиент не найден');

    const row = await prisma.notesBoardRow.create({
      data: {
        clientId: dto.clientId,
        authorId: user.userId,
        callResult: dto.callResult,
        status: dto.status?.trim() || null,
        comment: dto.comment.trim(),
        lastCallAt: new Date(dto.lastCallAt),
        nextCallAt: dto.nextCallAt ? new Date(dto.nextCallAt) : null,
      },
      include: {
        author: { select: { id: true, fullName: true } },
        client: { select: { id: true, companyName: true } },
      },
    });

    await prisma.clientNote.create({
      data: {
        clientId: row.clientId,
        userId: user.userId,
        content: buildClientNoteText({
          callResult: row.callResult,
          status: row.status,
          comment: row.comment,
          lastCallAt: row.lastCallAt,
        }),
      },
    });

    return mapRow(row);
  }

  async update(id: string, dto: UpdateNotesBoardDto, user: AuthUser) {
    const existing = await prisma.notesBoardRow.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, fullName: true } },
        client: { select: { id: true, companyName: true } },
      },
    });
    if (!existing) throw new AppError(404, 'Запись не найдена');
    if (!canEditRow(user, existing.authorId)) {
      throw new AppError(403, 'Редактировать может только автор, администратор или супер-админ');
    }

    const updated = await prisma.notesBoardRow.update({
      where: { id },
      data: {
        ...(dto.callResult ? { callResult: dto.callResult } : {}),
        ...(dto.status !== undefined ? { status: dto.status?.trim() || null } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment.trim() } : {}),
        ...(dto.lastCallAt ? { lastCallAt: new Date(dto.lastCallAt) } : {}),
        ...(dto.nextCallAt !== undefined
          ? { nextCallAt: dto.nextCallAt ? new Date(dto.nextCallAt) : null }
          : {}),
      },
      include: {
        author: { select: { id: true, fullName: true } },
        client: { select: { id: true, companyName: true } },
      },
    });

    await prisma.clientNote.create({
      data: {
        clientId: updated.clientId,
        userId: user.userId,
        content: buildClientNoteText({
          callResult: updated.callResult,
          status: updated.status,
          comment: updated.comment,
          lastCallAt: updated.lastCallAt,
        }),
      },
    });

    return mapRow(updated);
  }

  async requestEdit(id: string, dto: RequestNotesBoardEditDto, user: AuthUser) {
    const existing = await prisma.notesBoardRow.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Запись не найдена');
    if (existing.authorId === user.userId) {
      throw new AppError(400, 'Нельзя отправить запрос на правку самому себе');
    }
    if (existing.editRequestCount >= 3) {
      throw new AppError(400, 'Лимит запросов на правку исчерпан (3/3)');
    }

    const actor = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { fullName: true },
    });
    const actorName = actor?.fullName || 'Сотрудник';

    const updated = await prisma.$transaction(async (tx) => {
      await tx.notesBoardEditRequest.create({
        data: {
          rowId: id,
          requesterId: user.userId,
          comment: dto.comment.trim(),
        },
      });

      return tx.notesBoardRow.update({
        where: { id },
        data: {
          editRequestCount: { increment: 1 },
          lastEditRequestComment: dto.comment.trim(),
          lastEditRequestByName: actorName,
          lastEditRequestAt: new Date(),
        },
        include: {
          author: { select: { id: true, fullName: true } },
          client: { select: { id: true, companyName: true } },
        },
      });
    });

    await prisma.clientNote.create({
      data: {
        clientId: updated.clientId,
        userId: user.userId,
        content: `[NOTES_BOARD_EDIT_REQUEST] Запрос на правку (${updated.editRequestCount}/3): ${dto.comment.trim()}`,
      },
    });

    return mapRow(updated);
  }

  async listMyRequests(user: AuthUser, page?: number, pageSize?: number) {
    const p = page ?? 1;
    const ps = pageSize ?? 20;
    const skip = (p - 1) * ps;
    const [items, total] = await Promise.all([
      prisma.notesBoardEditRequest.findMany({
        where: { requesterId: user.userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: ps,
        include: {
          row: {
            include: {
              client: { select: { id: true, companyName: true } },
              author: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
      prisma.notesBoardEditRequest.count({ where: { requesterId: user.userId } }),
    ]);

    return {
      items: items.map((r: {
        id: string;
        comment: string;
        createdAt: Date;
        rowId: string;
        row: {
          client: { id: string; companyName: string };
          author: { id: string; fullName: string };
          lastCallAt: Date;
        };
      }) => ({
        id: r.id,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        rowId: r.rowId,
        client: r.row.client,
        noteAuthor: r.row.author,
        lastCallAt: r.row.lastCallAt.toISOString(),
      })),
      meta: { page: p, pageSize: ps, total },
    };
  }

  async remove(id: string, user: AuthUser) {
    const existing = await prisma.notesBoardRow.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Запись не найдена');
    if (!canDeleteRow(user, existing.authorId)) throw new AppError(403, 'Удаление доступно только автору или супер-админу');

    await prisma.notesBoardRow.delete({ where: { id } });
    return { ok: true };
  }
}

export const notesBoardService = new NotesBoardService();
