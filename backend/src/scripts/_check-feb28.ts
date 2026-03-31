import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function fmt(n: string | number): string {
  return Number(n).toLocaleString();
}

async function main() {
  // 1. Total payments per day around Feb 28
  console.log('=== 1. PAYMENTS PER DAY (Feb 22 – Mar 3) ===');
  const daily = await prisma.$queryRaw<{ day: string; cnt: string; total: string }[]>(
    Prisma.sql`SELECT DATE(p.paid_at)::text as day, COUNT(*)::text as cnt, SUM(p.amount)::text as total
    FROM payments p
    WHERE p.paid_at >= '2026-02-22' AND p.paid_at < '2026-03-04'
    GROUP BY DATE(p.paid_at)
    ORDER BY day`
  );
  for (const r of daily) {
    console.log(`  ${r.day}  count: ${fmt(r.cnt)}  total: ${fmt(r.total)}`);
  }

  // 2. Breakdown of Feb 28 payments by note
  console.log('\n=== 2. FEB 28 PAYMENTS BY NOTE ===');
  const byNote = await prisma.$queryRaw<{ note: string; cnt: string; total: string }[]>(
    Prisma.sql`SELECT COALESCE(p.note, '(no note)') as note, COUNT(*)::text as cnt, SUM(p.amount)::text as total
    FROM payments p
    WHERE DATE(p.paid_at) = '2026-02-28'
    GROUP BY COALESCE(p.note, '(no note)')
    ORDER BY SUM(p.amount) DESC`
  );
  for (const r of byNote) {
    console.log(`  [${r.note}]  count: ${fmt(r.cnt)}  total: ${fmt(r.total)}`);
  }

  // 3. Top 20 largest payments on Feb 28
  console.log('\n=== 3. TOP 20 LARGEST PAYMENTS ON FEB 28 ===');
  const top20 = await prisma.$queryRaw<{
    id: number; amount: string; paid_at: Date; method: string; note: string | null;
    company_name: string; title: string;
  }[]>(
    Prisma.sql`SELECT p.id, p.amount::text, p.paid_at, p.method, p.note, c.company_name, d.title
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = p.client_id
    WHERE DATE(p.paid_at) = '2026-02-28'
    ORDER BY p.amount DESC
    LIMIT 20`
  );
  for (const r of top20) {
    console.log(`  #${r.id}  ${fmt(r.amount)}  ${r.method}  "${r.company_name}" / "${r.title}"  note: ${r.note ?? '(none)'}`);
  }

  // 4. Reconciliation vs regular payments on Feb 28
  console.log('\n=== 4. RECONCILIATION vs REGULAR ON FEB 28 ===');
  const reconVsReg = await prisma.$queryRaw<{ type: string; cnt: string; total: string }[]>(
    Prisma.sql`SELECT
      CASE WHEN note LIKE 'Sverka%' THEN 'RECONCILIATION' ELSE 'REGULAR' END as type,
      COUNT(*)::text as cnt,
      SUM(amount)::text as total
    FROM payments
    WHERE DATE(paid_at) = '2026-02-28'
    GROUP BY CASE WHEN note LIKE 'Sverka%' THEN 'RECONCILIATION' ELSE 'REGULAR' END`
  );
  for (const r of reconVsReg) {
    console.log(`  ${r.type}  count: ${fmt(r.cnt)}  total: ${fmt(r.total)}`);
  }

  // 5. All sync-created payments date distribution (top 10 by amount)
  console.log('\n=== 5. SYNC-CREATED PAYMENTS DATE DISTRIBUTION (top 10 by total) ===');
  const syncDist = await prisma.$queryRaw<{ day: string; cnt: string; total: string }[]>(
    Prisma.sql`SELECT DATE(paid_at)::text as day, COUNT(*)::text as cnt, SUM(amount)::text as total
    FROM payments
    WHERE note LIKE 'Sverka%'
    GROUP BY DATE(paid_at)
    ORDER BY SUM(amount) DESC
    LIMIT 10`
  );
  for (const r of syncDist) {
    console.log(`  ${r.day}  count: ${fmt(r.cnt)}  total: ${fmt(r.total)}`);
  }

  console.log('\nDone.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
