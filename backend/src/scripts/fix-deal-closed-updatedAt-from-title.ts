/**
 * Reconcile CLOSED deal updatedAt (used as close date in KPI) with title pattern:
 * "Сделка от DD.MM.YYYY".
 *
 * Run:
 *   cd backend && npx tsx src/scripts/fix-deal-closed-updatedAt-from-title.ts
 *   cd backend && npx tsx src/scripts/fix-deal-closed-updatedAt-from-title.ts --execute
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

  const d = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  if (
    d.getUTCFullYear() !== yyyy ||
    d.getUTCMonth() !== mm - 1 ||
    d.getUTCDate() !== dd
  ) {
    return null;
  }

  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(78));
  console.log(`  FIX CLOSED DEAL updatedAt FROM TITLE DATE ${isExecute ? '** LIVE **' : '(DRY-RUN)'}`);
  console.log('='.repeat(78));

  const deals = await prisma.deal.findMany({
    where: {
      status: 'CLOSED',
      title: {
        contains: 'Сделка от',
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'asc' },
  });

  type Mismatch = {
    id: string;
    title: string;
    currentUpdatedAt: Date;
    expectedUpdatedAt: Date;
    createdAt: Date;
  };

  const mismatches: Mismatch[] = [];
  let parsedCount = 0;

  for (const d of deals) {
    const expected = parseDateFromTitle(d.title);
    if (!expected) continue;
    parsedCount++;

    if (isoDate(d.updatedAt) !== isoDate(expected)) {
      mismatches.push({
        id: d.id,
        title: d.title,
        currentUpdatedAt: d.updatedAt,
        expectedUpdatedAt: expected,
        createdAt: d.createdAt,
      });
    }
  }

  console.log(`Total CLOSED deals with 'Сделка от': ${deals.length}`);
  console.log(`Parsed title date successfully: ${parsedCount}`);
  console.log(`Mismatches found: ${mismatches.length}`);

  if (mismatches.length === 0) {
    console.log('\nNo mismatches found. Nothing to update.');
    return;
  }

  console.log('\nSample mismatches (up to 30):');
  for (const d of mismatches.slice(0, 30)) {
    console.log(
      `${d.id.slice(0, 8)} | close ${isoDate(d.currentUpdatedAt)} -> ${isoDate(d.expectedUpdatedAt)} | create ${isoDate(d.createdAt)} | ${d.title}`
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
        data: { updatedAt: d.expectedUpdatedAt },
      });
      updated++;
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to update deal ${d.id}: ${msg.slice(0, 200)}`);
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
