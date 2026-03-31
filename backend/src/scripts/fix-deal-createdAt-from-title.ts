/**
 * Reconcile deal.createdAt date with title pattern: "Сделка от DD.MM.YYYY".
 *
 * Run:
 *   cd backend && npx tsx src/scripts/fix-deal-createdAt-from-title.ts
 *   cd backend && npx tsx src/scripts/fix-deal-createdAt-from-title.ts --execute
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TITLE_DATE_REGEX = /Сделка\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/i;

function parseDateFromTitle(title: string): Date | null {
  const match = TITLE_DATE_REGEX.exec(title);
  if (!match) return null;

  const [, ddRaw, mmRaw, yyyyRaw] = match;
  const dd = Number(ddRaw);
  const mm = Number(mmRaw);
  const yyyy = Number(yyyyRaw);

  if (!Number.isInteger(dd) || !Number.isInteger(mm) || !Number.isInteger(yyyy)) return null;
  if (yyyy < 2000 || yyyy > 2100) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  // Set to noon UTC to avoid timezone day shifting in most user timezones.
  const date = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));

  if (
    date.getUTCFullYear() !== yyyy ||
    date.getUTCMonth() !== mm - 1 ||
    date.getUTCDate() !== dd
  ) {
    return null;
  }

  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(72));
  console.log(`  FIX DEAL createdAt FROM TITLE DATE ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(72));

  const deals = await prisma.deal.findMany({
    where: {
      title: {
        contains: 'Сделка от',
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  type Mismatch = {
    id: string;
    title: string;
    currentCreatedAt: Date;
    expectedCreatedAt: Date;
  };

  const mismatches: Mismatch[] = [];
  let parsedCount = 0;

  for (const deal of deals) {
    const expectedDate = parseDateFromTitle(deal.title);
    if (!expectedDate) continue;
    parsedCount++;

    if (isoDate(deal.createdAt) !== isoDate(expectedDate)) {
      mismatches.push({
        id: deal.id,
        title: deal.title,
        currentCreatedAt: deal.createdAt,
        expectedCreatedAt: expectedDate,
      });
    }
  }

  console.log(`Total deals with 'Сделка от': ${deals.length}`);
  console.log(`Parsed title date successfully: ${parsedCount}`);
  console.log(`Mismatches found: ${mismatches.length}`);

  if (mismatches.length === 0) {
    console.log('\nNo mismatches found. Nothing to update.');
    return;
  }

  console.log('\nSample mismatches (up to 30):');
  for (const d of mismatches.slice(0, 30)) {
    console.log(
      `${d.id.slice(0, 8)} | ${isoDate(d.currentCreatedAt)} -> ${isoDate(d.expectedCreatedAt)} | ${d.title}`
    );
  }

  if (!isExecute) {
    console.log('\nThis was a DRY-RUN. Re-run with --execute to apply updates.');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const d of mismatches) {
    try {
      await prisma.deal.update({
        where: { id: d.id },
        data: { createdAt: d.expectedCreatedAt },
      });
      updated++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to update deal ${d.id}: ${message.slice(0, 200)}`);
    }
  }

  console.log(`\nUpdate complete. Updated: ${updated}, Errors: ${errors}`);
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
