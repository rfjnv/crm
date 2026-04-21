import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { AuthUser } from '../../lib/scope';
import type { CreateNotesBoardDto, ListNotesBoardQueryDto, UpdateNotesBoardDto } from './notes-board.dto';

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
  author: { id: string; fullName: string };
  client: { id: string; companyName: string };
};

const MANAGE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];

function canManageRow(user: AuthUser, authorId: string): boolean {
  return MANAGE_ROLES.includes(user.role) || user.userId === authorId;
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
    if (!canManageRow(user, existing.authorId)) throw new AppError(403, 'Недостаточно прав');

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

  async remove(id: string, user: AuthUser) {
    const existing = await prisma.notesBoardRow.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'Запись не найдена');
    if (!canManageRow(user, existing.authorId)) throw new AppError(403, 'Недостаточно прав');

    await prisma.notesBoardRow.delete({ where: { id } });
    return { ok: true };
  }
}

export const notesBoardService = new NotesBoardService();
