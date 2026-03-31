import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

async function run() {
  // 1. Bad date payments
  const bad = await p.$queryRaw<{cnt: string, total: string}[]>(
    Prisma.sql`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total FROM payments WHERE paid_at < '2020-01-01'`
  );
  console.log('Bad date payments (< 2020):', bad[0]);

  // 2. Payment date distribution
  const dist = await p.$queryRaw<{yr: string, cnt: string, total: string}[]>(
    Prisma.sql`SELECT EXTRACT(YEAR FROM paid_at)::text as yr, COUNT(*)::text as cnt, SUM(amount)::text as total FROM payments GROUP BY yr ORDER BY yr`
  );
  console.log('\nPayment date distribution:');
  for (const d of dist) console.log(`  ${d.yr}: ${d.cnt} payments, ${Number(d.total).toLocaleString()} UZS`);

  // 3. Totals
  const counts = await p.$queryRaw<{deals: string, clients: string, payments: string}[]>(
    Prisma.sql`SELECT (SELECT COUNT(*) FROM deals)::text as deals, (SELECT COUNT(*) FROM clients)::text as clients, (SELECT COUNT(*) FROM payments)::text as payments`
  );
  console.log('\nTotals:', counts[0]);

  // 4. Sample bad-date payments
  const samples = await p.$queryRaw<{id: string, paid_at: Date, amount: string, company: string, note: string | null}[]>(
    Prisma.sql`SELECT p.id, p.paid_at, p.amount::text, c.company_name as company, p.note FROM payments p JOIN clients c ON c.id = p.client_id WHERE p.paid_at < '2020-01-01' ORDER BY p.amount DESC LIMIT 10`
  );
  console.log('\nSample bad-date payments (top 10 by amount):');
  for (const s of samples) {
    console.log(`  ${s.company.substring(0, 30).padEnd(30)} | ${Number(s.amount).toLocaleString().padStart(15)} | ${s.paid_at} | ${s.note || ''}`);
  }

  await p.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
