import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // 1. Sample a deal from 2025 with its items and payments
  const sample = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT d.id, d.title, d.status, d.payment_status, d.payment_type, d.payment_method,
      d.amount::text, d.paid_amount::text, d.discount::text,
      d.client_id, c.company_name,
      d.manager_id, d.created_at
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.title LIKE '%Январь 2025%'
    LIMIT 3
  `);
  console.log('=== SAMPLE 2025 DEALS ===');
  for (const d of sample) {
    console.log(JSON.stringify(d, null, 2));
    
    // Get items for this deal
    const items = await p.$queryRaw<any[]>(Prisma.sql`
      SELECT di.id, di.deal_id, di.product_id, di.requested_qty, di.price::text,
        pr.name as product_name, pr.unit
      FROM deal_items di
      LEFT JOIN products pr ON pr.id = di.product_id
      WHERE di.deal_id = ${d.id}
      LIMIT 5
    `);
    console.log('  Items (' + items.length + '):');
    for (const i of items) console.log('    ' + i.product_name + ' | qty:' + i.requested_qty + ' | price:' + i.price + ' | unit:' + i.unit);
    
    // Get payments for this deal
    const payments = await p.$queryRaw<any[]>(Prisma.sql`
      SELECT p.id, p.amount::text, p.method, p.note, p.paid_at, p.created_by
      FROM payments p
      WHERE p.deal_id = ${d.id}
      LIMIT 5
    `);
    console.log('  Payments (' + payments.length + '):');
    for (const pm of payments) console.log('    ' + pm.method + ' | ' + pm.amount + ' | ' + pm.paid_at + ' | note:' + (pm.note || ''));
    console.log();
  }
  
  // 2. Check how products are stored - get all columns first
  const prodCols = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'products' 
    ORDER BY ordinal_position
  `);
  console.log('=== PRODUCTS COLUMNS ===');
  for (const f of prodCols) console.log('  ' + f.column_name + ' (' + f.data_type + ', nullable:' + f.is_nullable + ')');

  const products = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT id, name, unit, sku FROM products ORDER BY name LIMIT 20
  `);
  console.log('\n=== PRODUCTS (first 20) ===');
  for (const pr of products) console.log('  ' + pr.name + ' | unit:' + pr.unit + ' | sku:' + pr.sku);
  
  // 3. Check deal_item fields
  const diFields = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'deal_items' 
    ORDER BY ordinal_position
  `);
  console.log('\n=== DEAL_ITEMS COLUMNS ===');
  for (const f of diFields) console.log('  ' + f.column_name + ' (' + f.data_type + ', nullable:' + f.is_nullable + ')');
  
  // 4. Check payment fields
  const pFields = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'payments' 
    ORDER BY ordinal_position
  `);
  console.log('\n=== PAYMENTS COLUMNS ===');
  for (const f of pFields) console.log('  ' + f.column_name + ' (' + f.data_type + ', nullable:' + f.is_nullable + ')');

  // 5. Check deal fields  
  const dFields = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'deals' 
    ORDER BY ordinal_position
  `);
  console.log('\n=== DEALS COLUMNS ===');
  for (const f of dFields) console.log('  ' + f.column_name + ' (' + f.data_type + ', nullable:' + f.is_nullable + ')');
  
  // 6. How many payments per deal on average for 2025
  const avgPayments = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT AVG(cnt)::text as avg_payments, MIN(cnt)::text as min_pay, MAX(cnt)::text as max_pay
    FROM (
      SELECT d.id, COUNT(p.id) as cnt
      FROM deals d
      LEFT JOIN payments p ON p.deal_id = d.id
      WHERE d.title LIKE '%2025%'
      GROUP BY d.id
    ) sub
  `);
  console.log('\n=== PAYMENTS PER 2025 DEAL ===');
  console.log(avgPayments[0]);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
