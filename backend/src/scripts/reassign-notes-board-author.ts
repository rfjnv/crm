import 'dotenv/config';
import prisma from '../lib/prisma';

type Candidate = {
  rowId: string;
  clientId: string;
  currentAuthorId: string;
  inferredAuthorId: string | null;
  reason: 'client_note_match' | 'client_manager' | 'unknown' | 'ambiguous';
};

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

async function resolveAuthorId(raw?: string): Promise<string | null> {
  if (!raw) {
    const supers = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
      take: 2,
    });
    if (supers.length === 1) return supers[0].id;
    return null;
  }

  const byId = await prisma.user.findUnique({ where: { id: raw }, select: { id: true } });
  if (byId) return byId.id;

  const byUsername = await prisma.user.findFirst({
    where: { username: raw },
    select: { id: true },
  });
  return byUsername?.id ?? null;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const authorArg = parseArg('--author');
  const authorId = await resolveAuthorId(authorArg);

  if (!authorId) {
    throw new Error('Не удалось определить автора. Передайте --author <id|username>.');
  }

  const rows = await prisma.notesBoardRow.findMany({
    where: { authorId },
    orderBy: { createdAt: 'desc' },
    include: {
      client: { select: { id: true, companyName: true, managerId: true } },
    },
  });

  const candidates: Candidate[] = [];

  for (const row of rows) {
    const from = new Date(row.createdAt.getTime() - 10 * 60 * 1000);
    const to = new Date(row.createdAt.getTime() + 10 * 60 * 1000);
    const commentNeedle = row.comment.trim().slice(0, 80);

    const noteMatches = await prisma.clientNote.findMany({
      where: {
        clientId: row.clientId,
        deletedAt: null,
        createdAt: { gte: from, lte: to },
        ...(commentNeedle
          ? {
              content: {
                contains: commentNeedle,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      select: { userId: true },
      take: 20,
    });

    const uniqueUsers = [...new Set(noteMatches.map((n) => n.userId).filter((u) => u !== authorId))];

    if (uniqueUsers.length === 1) {
      candidates.push({
        rowId: row.id,
        clientId: row.clientId,
        currentAuthorId: row.authorId,
        inferredAuthorId: uniqueUsers[0],
        reason: 'client_note_match',
      });
      continue;
    }

    if (uniqueUsers.length > 1) {
      candidates.push({
        rowId: row.id,
        clientId: row.clientId,
        currentAuthorId: row.authorId,
        inferredAuthorId: null,
        reason: 'ambiguous',
      });
      continue;
    }

    if (row.client.managerId && row.client.managerId !== authorId) {
      candidates.push({
        rowId: row.id,
        clientId: row.clientId,
        currentAuthorId: row.authorId,
        inferredAuthorId: row.client.managerId,
        reason: 'client_manager',
      });
      continue;
    }

    candidates.push({
      rowId: row.id,
      clientId: row.clientId,
      currentAuthorId: row.authorId,
      inferredAuthorId: null,
      reason: 'unknown',
    });
  }

  const resolvable = candidates.filter((c) => c.inferredAuthorId);
  const stats = {
    totalRows: rows.length,
    resolvable: resolvable.length,
    byReason: {
      client_note_match: candidates.filter((c) => c.reason === 'client_note_match').length,
      client_manager: candidates.filter((c) => c.reason === 'client_manager').length,
      ambiguous: candidates.filter((c) => c.reason === 'ambiguous').length,
      unknown: candidates.filter((c) => c.reason === 'unknown').length,
    },
  };
  console.log('[reassign-notes-board-author] stats:', JSON.stringify(stats, null, 2));
  console.log(
    '[reassign-notes-board-author] sample:',
    JSON.stringify(candidates.slice(0, 20), null, 2),
  );

  if (!apply) {
    console.log('[reassign-notes-board-author] dry-run only. Re-run with --apply to update rows.');
    return;
  }

  let updated = 0;
  for (const c of resolvable) {
    await prisma.notesBoardRow.update({
      where: { id: c.rowId },
      data: { authorId: c.inferredAuthorId! },
    });
    updated += 1;
  }
  console.log(`[reassign-notes-board-author] updated: ${updated}`);
}

run()
  .catch((e) => {
    console.error('[reassign-notes-board-author] failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

