import 'dotenv/config';
import prisma from '../lib/prisma';

const OLD_PREFIX = '[NOTES_BOARD]';
const OLD_EDIT_PREFIX = '[NOTES_BOARD_EDIT_REQUEST]';
const NEW_PREFIX = 'Перенесено из "Заметок".';
const NEW_EDIT_PREFIX = 'Перенесено из "Заметок" (запрос на правку).';

function extractComment(content: string): string {
  const match = content.match(/(?:^|\n)Комментарий:\s*([\s\S]*)$/m);
  const raw = (match?.[1] ?? '').trim();
  if (raw) return raw;
  return content.replace(/^\[NOTES_BOARD\]\s*/i, '').trim() || '—';
}

function normalizeContent(oldContent: string): string {
  const comment = extractComment(oldContent);
  if (oldContent.includes(OLD_EDIT_PREFIX)) {
    return `${NEW_EDIT_PREFIX}\nКомментарий: ${comment}`;
  }
  return `${NEW_PREFIX}\nКомментарий: ${comment}`;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const rows = await prisma.clientNote.findMany({
    where: {
      deletedAt: null,
      OR: [
        {
          content: {
            contains: OLD_PREFIX,
          },
        },
        {
          content: {
            contains: OLD_EDIT_PREFIX,
          },
        },
      ],
    },
    select: {
      id: true,
      content: true,
    },
  });

  const onlyLegacyRows = rows.filter((r) => r.content.includes(OLD_PREFIX) || r.content.includes(OLD_EDIT_PREFIX));
  console.log(`[cleanup-notes-board-client-notes] matched: ${onlyLegacyRows.length}`);
  if (onlyLegacyRows.length > 0) {
    const preview = onlyLegacyRows.slice(0, 3).map((r) => ({
      id: r.id,
      before: r.content.split('\n').slice(0, 3).join(' | '),
      after: normalizeContent(r.content),
    }));
    console.log('[cleanup-notes-board-client-notes] preview:', JSON.stringify(preview, null, 2));
  }

  if (!apply) {
    console.log('[cleanup-notes-board-client-notes] dry-run only. Re-run with --apply to update rows.');
    return;
  }

  let updated = 0;
  for (const row of onlyLegacyRows) {
    await prisma.clientNote.update({
      where: { id: row.id },
      data: { content: normalizeContent(row.content) },
    });
    updated += 1;
  }

  console.log(`[cleanup-notes-board-client-notes] updated: ${updated}`);
}

run()
  .catch((e) => {
    console.error('[cleanup-notes-board-client-notes] failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

