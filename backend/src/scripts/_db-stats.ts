import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

async function run() {
  // -- Query 1: 30 sample deals with item counts --
  console.log('=== QUERY 1: Sample deals (Jan-Feb 2025) ordered by client + date ===\n');
  const q1 = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT d.id, d.title, d.status, d.amount::text, d.paid_amount::text,
      d.payment_status, d.created_at, c.company_name,
      (SELECT COUNT(*) FROM deal_items di WHERE di.deal_id = d.id)::text as item_count
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.created_at >= '2025-01-01' AND d.created_at < '2025-03-01'
    ORDER BY c.company_name, d.created_at
    LIMIT 30
  `);
  for (const r of q1) {
    console.log(
      '  ' + String(r.company_name).substring(0, 28).padEnd(28) + ' | ' +
      String(r.title).substring(0, 35).padEnd(35) + ' | ' +
      'status=' + r.status.padEnd(12) + ' | ' +
      'amount=' + Number(r.amount).toLocaleString().padStart(15) + ' | ' +
      'paid=' + Number(r.paid_amount).toLocaleString().padStart(15) + ' | ' +
      'pay_status=' + (r.payment_status || 'null').padEnd(10) + ' | ' +
      'items=' + r.item_count + ' | ' +
      'created=' + new Date(r.created_at).toISOString().slice(0, 10)
    );
  }
  console.log('\n  (' + q1.length + ' rows)\n');

  // -- Query 2: Deal items for deals with multiple items --
  console.log('=== QUERY 2: Deal items (2025 deals) ===\n');
  const q2 = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT di.deal_id, d.title, p.name as product_name,
      di.requested_qty::text, di.price::text
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    JOIN products p ON p.id = di.product_id
    WHERE d.created_at >= '2025-01-01'
    ORDER BY d.title, p.name
    LIMIT 30
  `);
  for (const r of q2) {
    console.log(
      '  deal_id=' + r.deal_id + ' | ' +
      String(r.title).substring(0, 35).padEnd(35) + ' | ' +
      'product=' + String(r.product_name).substring(0, 30).padEnd(30) + ' | ' +
      'qty=' + String(r.requested_qty).padStart(6) + ' | ' +
      'price=' + Number(r.price).toLocaleString().padStart(15)
    );
  }
  console.log('\n  (' + q2.length + ' rows)\n');

  // -- Query 3: Deals per client (clients with >1 deal) --
  console.log('=== QUERY 3: Deals per client (clients with multiple deals, 2025) ===\n');
  const q3 = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT c.company_name, COUNT(d.id)::text as deal_count,
      MIN(d.created_at)::text as first_deal, MAX(d.created_at)::text as last_deal
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.created_at >= '2025-01-01'
    GROUP BY c.company_name
    HAVING COUNT(d.id) > 1
    ORDER BY COUNT(d.id) DESC
    LIMIT 20
  `);
  for (const r of q3) {
    console.log(
      '  ' + String(r.company_name).substring(0, 35).padEnd(35) + ' | ' +
      'deals=' + String(r.deal_count).padStart(4) + ' | ' +
      'first=' + r.first_deal.slice(0, 10) + ' | ' +
      'last=' + r.last_deal.slice(0, 10)
    );
  }
  console.log('\n  (' + q3.length + ' rows)\n');

  // -- Query 4: Deals with "Import" in title --
  console.log('=== QUERY 4: Deals with title patterns ===\n');
  const q4 = await p.$queryRaw<any[]>(Prisma.sql`
    SELECT d.title, d.status, d.amount::text, d.paid_amount::text,
      c.company_name, d.created_at
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.title LIKE '%Импорт%'
    ORDER BY d.created_at
    LIMIT 20
  `);
  if (q4.length === 0) {
    console.log('  No deals found with "Импорт" in title.');
    console.log('\n  Falling back: showing distinct title patterns for 2025 deals...\n');
    const patterns = await p.$queryRaw<any[]>(Prisma.sql`
      SELECT d.title, COUNT(*)::text as cnt
      FROM deals d
      WHERE d.created_at >= '2025-01-01'
      GROUP BY d.title
      ORDER BY COUNT(*) DESC
      LIMIT 30
    `);
    for (const r of patterns) {
      console.log('  ' + String(r.cnt).padStart(5) + 'x  ' + r.title);
    }
    console.log('\n  (' + patterns.length + ' distinct title patterns)\n');
  } else {
    for (const r of q4) {
      console.log(
        '  ' + String(r.company_name).substring(0, 30).padEnd(30) + ' | ' +
        String(r.title).substring(0, 40).padEnd(40) + ' | ' +
        'status=' + r.status.padEnd(12) + ' | ' +
        'amount=' + Number(r.amount).toLocaleString().padStart(15) + ' | ' +
        'paid=' + Number(r.paid_amount).toLocaleString().padStart(15) + ' | ' +
        'created=' + new Date(r.created_at).toISOString().slice(0, 10)
      );
    }
    console.log('\n  (' + q4.length + ' rows)\n');
  }

  await p.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
