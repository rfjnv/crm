import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  console.log('=== VERIFY 2024 IMPORT ===\n');

  const counts = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM deals WHERE title LIKE '%2024%')::text as d24,
      (SELECT COUNT(*) FROM deals WHERE title LIKE '%2025%')::text as d25,
      (SELECT COUNT(*) FROM deals WHERE title LIKE '%2026%')::text as d26,
      (SELECT COUNT(*) FROM deals)::text as dt,
      (SELECT COUNT(*) FROM clients)::text as ct,
      (SELECT COUNT(*) FROM payments)::text as pt,
      (SELECT COUNT(*) FROM products)::text as pr
  `);
  console.log('Deals: 2024=' + counts[0].d24 + '  2025=' + counts[0].d25 + '  2026=' + counts[0].d26 + '  total=' + counts[0].dt);
  console.log('Clients=' + counts[0].ct + '  Payments=' + counts[0].pt + '  Products=' + counts[0].pr);

  const dist = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT EXTRACT(YEAR FROM paid_at)::text as yr, COUNT(*)::text as cnt, SUM(amount)::text as total
    FROM payments GROUP BY yr ORDER BY yr
  `);
  console.log('\nPayments by year:');
  for (const d of dist) console.log('  ' + d.yr + ': ' + d.cnt + ' payments, ' + Number(d.total).toLocaleString() + ' UZS');

  // Sample 2024 deals
  const sample = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT d.id, d.title, d.status, d.payment_status, d.amount::text, d.paid_amount::text,
      (SELECT COUNT(*) FROM deal_items WHERE deal_id = d.id)::text as items,
      (SELECT COUNT(*) FROM payments WHERE deal_id = d.id)::text as pays
    FROM deals d WHERE d.title LIKE '%2024%' AND d.amount > 0
    ORDER BY d.amount DESC LIMIT 3
  `);
  console.log('\nTop 2024 deals:');
  for (const s of sample) {
    console.log('  ' + s.title);
    console.log('    ' + s.status + '/' + s.payment_status + ' | amount=' + Number(s.amount).toLocaleString() + ' paid=' + Number(s.paid_amount).toLocaleString() + ' | items=' + s.items + ' payments=' + s.pays);
  }

  // Monthly breakdown
  const monthly = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT EXTRACT(MONTH FROM created_at)::text as mo, COUNT(*)::text as cnt,
      SUM(amount)::text as amt, SUM(paid_amount)::text as paid
    FROM deals WHERE title LIKE '%2024%' GROUP BY EXTRACT(MONTH FROM created_at) ORDER BY EXTRACT(MONTH FROM created_at)
  `);
  const mn = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  console.log('\n2024 deals by month:');
  for (const m of monthly) {
    console.log('  ' + mn[parseInt(m.mo)].padEnd(4) + ': ' + m.cnt.padStart(4) + ' deals | amt=' + Number(m.amt).toLocaleString().padStart(18) + ' | paid=' + Number(m.paid).toLocaleString().padStart(18));
  }

  // Integrity
  const integrity = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM deal_items di LEFT JOIN deals d ON d.id = di.deal_id WHERE d.id IS NULL)::text as orphan_items,
      (SELECT COUNT(*) FROM payments p LEFT JOIN deals d ON d.id = p.deal_id WHERE d.id IS NULL)::text as orphan_pays,
      (SELECT COUNT(*) FROM deals WHERE title LIKE '%2024%' AND payment_status = 'PAID' AND paid_amount != amount)::text as mismatch
  `);
  console.log('\nIntegrity:');
  console.log('  Orphan items: ' + integrity[0].orphan_items);
  console.log('  Orphan payments: ' + integrity[0].orphan_pays);
  console.log('  PAID deals with paid!=amount: ' + integrity[0].mismatch);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
