/**
 * Phase 1: Audit — find duplicate deals (same client + same title).
 *
 * Run:  cd backend && npx tsx src/scripts/rebuild/phase1-audit.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Phase 1: AUDIT DUPLICATES ===\n');

  // Find duplicate deals
  const dupes = await prisma.$queryRaw<
    { client_id: string; company_name: string; title: string; cnt: string; total_amount: string }[]
  >(Prisma.sql`
    SELECT d.client_id, c.company_name, d.title, COUNT(*)::text as cnt,
      COALESCE(SUM(d.amount), 0)::text as total_amount
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    GROUP BY d.client_id, c.company_name, d.title
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  console.log(`Found ${dupes.length} groups of duplicate deals\n`);

  if (dupes.length === 0) {
    console.log('No duplicates found!');
    return;
  }

  let totalExtraDeals = 0;
  let totalExtraAmount = 0;

  console.log('Client                         | Title                          | Count | Total Amount');
  console.log('-'.repeat(110));

  for (const d of dupes.slice(0, 50)) {
    const cnt = Number(d.cnt);
    const extra = cnt - 1; // all but the keeper
    totalExtraDeals += extra;
    // approximate extra amount: (cnt-1)/cnt * total
    const totalAmt = Number(d.total_amount);
    totalExtraAmount += totalAmt * extra / cnt;

    console.log(
      `${d.company_name.substring(0, 30).padEnd(30)} | ` +
      `${d.title.substring(0, 30).padEnd(30)} | ` +
      `${String(cnt).padStart(5)} | ` +
      `${totalAmt.toLocaleString('ru-RU')}`
    );
  }

  if (dupes.length > 50) console.log(`... and ${dupes.length - 50} more groups`);

  // Overall stats
  const totalDeals = await prisma.deal.count({
    where: { isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
  });

  const totalAmountResult = await prisma.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(amount), 0)::text as total
    FROM deals WHERE is_archived = false AND status NOT IN ('CANCELED', 'REJECTED')
  `);

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total active deals:          ${totalDeals}`);
  console.log(`  Duplicate groups:            ${dupes.length}`);
  console.log(`  Extra deals (to archive):    ~${totalExtraDeals}`);
  console.log(`  Current SUM(amount):         ${Number(totalAmountResult[0].total).toLocaleString('ru-RU')}`);
  console.log(`  Estimated bloat (extra amt): ~${totalExtraAmount.toLocaleString('ru-RU')}`);
  console.log(`  After dedup SUM(amount):     ~${(Number(totalAmountResult[0].total) - totalExtraAmount).toLocaleString('ru-RU')}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
