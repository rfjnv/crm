import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const deals = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT d.id, d.title, d.status, d.payment_status, d.payment_type, d.payment_method,
      d.amount::text, d.paid_amount::text, d.discount::text,
      d.client_id, c.company_name,
      d.manager_id, d.created_at
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.title LIKE '%2025%'
    AND d.amount > 0
    ORDER BY d.amount DESC
    LIMIT 5
  `);

  console.log('=== TOP 5 NON-ZERO 2025 DEALS ===');
  for (const d of deals) {
    console.log('');
    console.log('--- ' + d.title + ' ---');
    console.log('  status: ' + d.status + ', payment_status: ' + d.payment_status + ', payment_type: ' + d.payment_type);
    console.log('  payment_method: ' + d.payment_method);
    console.log('  amount: ' + d.amount + ', paid_amount: ' + d.paid_amount + ', discount: ' + d.discount);
    console.log('  client: ' + d.company_name + ', manager_id: ' + d.manager_id);
    console.log('  created_at: ' + d.created_at);

    const items = await p.$queryRaw<any[]>(Prisma.sql`
      SELECT di.product_id, di.requested_qty::text, di.price::text,
        pr.name as product_name, pr.unit
      FROM deal_items di
      LEFT JOIN products pr ON pr.id = di.product_id
      WHERE di.deal_id = ${d.id}
      LIMIT 10
    `);
    console.log('  Items (' + items.length + '):');
    for (const i of items) {
      console.log('    ' + i.product_name + ' | qty:' + i.requested_qty + ' | price:' + i.price + ' | unit:' + i.unit);
    }

    const payments = await p.$queryRaw<any[]>(Prisma.sql`
      SELECT p.amount::text, p.method, p.note, p.paid_at, p.created_by
      FROM payments p
      WHERE p.deal_id = ${d.id}
      LIMIT 10
    `);
    console.log('  Payments (' + payments.length + '):');
    for (const pm of payments) {
      console.log('    ' + pm.method + ' | ' + pm.amount + ' | ' + pm.paid_at + ' | created_by:' + pm.created_by + ' | note:' + (pm.note || ''));
    }
  }

  const stats = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT
      COUNT(*)::text as total_deals,
      COUNT(CASE WHEN amount > 0 THEN 1 END)::text as nonzero_deals,
      COUNT(CASE WHEN amount = 0 THEN 1 END)::text as zero_deals,
      COUNT(CASE WHEN payment_status = 'PAID' THEN 1 END)::text as paid_deals,
      COUNT(CASE WHEN payment_status = 'UNPAID' THEN 1 END)::text as unpaid_deals,
      COUNT(CASE WHEN status = 'CLOSED' THEN 1 END)::text as closed_deals
    FROM deals
    WHERE title LIKE '%2025%'
  `);
  console.log('');
  console.log('=== 2025 DEALS STATS ===');
  console.log(stats[0]);

  const users = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT id, full_name, role FROM users LIMIT 10
  `);
  console.log('');
  console.log('=== USERS ===');
  for (const u of users) console.log('  ' + u.id + ' | ' + u.full_name + ' | ' + u.role);

  const existing2024 = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT COUNT(*)::text as cnt, SUM(amount)::text as total
    FROM payments
    WHERE paid_at >= '2024-01-01' AND paid_at < '2025-01-01'
  `);
  console.log('');
  console.log('=== EXISTING 2024 PAYMENTS ===');
  console.log(existing2024[0]);

  const existing2024deals = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT COUNT(*)::text as cnt FROM deals WHERE title LIKE '%2024%'
  `);
  console.log('');
  console.log('=== EXISTING 2024 DEALS ===');
  console.log(existing2024deals[0]);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });