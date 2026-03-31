import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Top Сверка payments
  const sverka = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT p.note, p.amount::text as amount, p.method,
      (p.paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date::text as paid_date,
      c.company_name
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = d.client_id
    WHERE p.note LIKE 'Сверка%'
    ORDER BY p.amount DESC
    LIMIT 30
  `);
  console.log('Top 30 Сверка payments:');
  for (const s of sverka) {
    console.log(
      `  ${String(s.company_name).substring(0, 25).padEnd(25)} | ` +
      `${Number(s.amount).toLocaleString('ru-RU').padStart(14)} | ` +
      `${String(s.method).padEnd(10)} | ${s.paid_date} | ${s.note.substring(0, 50)}`
    );
  }

  // Totals by month
  const totals = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM (p.paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'))::int as yr,
      EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'))::int as mo,
      COUNT(*)::text as cnt,
      SUM(p.amount)::text as total
    FROM payments p
    WHERE p.note LIKE 'Сверка%'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log('\nСверка totals by month:');
  for (const t of totals) {
    console.log(
      `  ${t.yr}-${String(t.mo).padStart(2, '0')}: ` +
      `${String(t.cnt).padStart(3)} payments, total=${Number(t.total).toLocaleString('ru-RU')}`
    );
  }

  // What are the unique note prefixes?
  const notePatterns = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT DISTINCT LEFT(p.note, 50) as note_prefix
    FROM payments p
    WHERE p.note LIKE 'Сверка%'
    ORDER BY 1
  `);
  console.log('\nDistinct Сверка note patterns:');
  for (const n of notePatterns) {
    console.log(`  "${n.note_prefix}"`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
