import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 1. Payment note patterns
  const notes = await prisma.$queryRaw<{ pattern: string; cnt: string; total: string }[]>(
    Prisma.sql`SELECT COALESCE(
      CASE
        WHEN note LIKE 'Импорт%' THEN 'Импорт...'
        WHEN note LIKE 'Сверка%' THEN 'Сверка...'
        WHEN note IS NULL THEN 'NULL'
        ELSE LEFT(note, 30)
      END, 'NULL') as pattern,
      COUNT(*)::text as cnt,
      SUM(amount)::text as total
    FROM payments
    GROUP BY 1
    ORDER BY SUM(amount) DESC`
  );
  console.log('Payment note patterns:');
  for (const n of notes) {
    console.log(`  ${String(n.pattern).padEnd(35)} count=${String(n.cnt).padStart(6)}  total=${Number(n.total).toLocaleString('ru-RU')}`);
  }

  // 2. Payments by month for 2026
  const p2026 = await prisma.$queryRaw<{
    month: number; cnt: string; total: string;
    imported_cnt: string; imported_total: string | null;
  }[]>(
    Prisma.sql`SELECT EXTRACT(MONTH FROM (paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
      COUNT(*)::text as cnt,
      SUM(amount)::text as total,
      COUNT(*) FILTER (WHERE note LIKE 'Импорт%')::text as imported_cnt,
      COALESCE(SUM(amount) FILTER (WHERE note LIKE 'Импорт%'), 0)::text as imported_total
    FROM payments
    WHERE paid_at >= '2025-12-31T19:00:00Z' AND paid_at < '2026-12-31T19:00:00Z'
    GROUP BY 1 ORDER BY 1`
  );
  console.log('\n2026 payments by month:');
  for (const p of p2026) {
    console.log(`  Month ${p.month}: ${String(p.cnt).padStart(5)} payments, total=${Number(p.total).toLocaleString('ru-RU')}, imported=${String(p.imported_cnt).padStart(4)} (${Number(p.imported_total || 0).toLocaleString('ru-RU')})`);
  }

  // 3. Deals by month for 2026
  const deals2026 = await prisma.$queryRaw<{
    month: number; cnt: string; deal_total: string; paid_total: string;
    zero_paid_cnt: string; zero_paid_total: string | null;
  }[]>(
    Prisma.sql`SELECT EXTRACT(MONTH FROM (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
      COUNT(*)::text as cnt,
      SUM(amount)::text as deal_total,
      SUM(paid_amount)::text as paid_total,
      COUNT(*) FILTER (WHERE paid_amount = 0)::text as zero_paid_cnt,
      COALESCE(SUM(amount) FILTER (WHERE paid_amount = 0), 0)::text as zero_paid_total
    FROM deals
    WHERE created_at >= '2025-12-31T19:00:00Z' AND created_at < '2026-12-31T19:00:00Z'
      AND is_archived = false AND status NOT IN ('CANCELED','REJECTED')
    GROUP BY 1 ORDER BY 1`
  );
  console.log('\n2026 deals by month:');
  for (const d of deals2026) {
    console.log(`  Month ${d.month}: ${String(d.cnt).padStart(5)} deals, total=${Number(d.deal_total).toLocaleString('ru-RU')}, paid=${Number(d.paid_total).toLocaleString('ru-RU')}, zero_paid=${d.zero_paid_cnt} deals (${Number(d.zero_paid_total || 0).toLocaleString('ru-RU')})`);
  }

  // 4. Check how many CRM clients have deals in 2026 vs Excel
  const clientCount2026 = await prisma.$queryRaw<{ cnt: string }[]>(
    Prisma.sql`SELECT COUNT(DISTINCT client_id)::text as cnt
    FROM deals
    WHERE created_at >= '2025-12-31T19:00:00Z' AND created_at < '2026-12-31T19:00:00Z'
      AND is_archived = false AND status NOT IN ('CANCELED','REJECTED')`
  );
  console.log(`\nCRM clients with 2026 deals: ${clientCount2026[0].cnt}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
