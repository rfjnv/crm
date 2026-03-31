import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://crm_user:BChpe9Gb4dOeVQQxRYVkiLUgu4TsmWJo@dpg-d6bcdrt6ubrc73ch10dg-a.oregon-postgres.render.com/crm_db_okj8',
    },
  },
});

async function main() {
  // ===== QUERY 1 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 1: Payments with dates before 2020 (erroneous dates)');
  console.log('='.repeat(80));
  const q1: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.amount, p.paid_at, p.method, p.note,
      d.title, d.created_at as deal_created,
      c.company_name
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = p.client_id
    WHERE p.paid_at < '2020-01-01'
    ORDER BY p.paid_at
    LIMIT 30
  `);
  if (q1.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q1.map(r => ({
      id: r.id,
      amount: Number(r.amount),
      paid_at: r.paid_at,
      method: r.method,
      note: r.note?.substring(0, 40),
      deal_title: r.title?.substring(0, 30),
      deal_created: r.deal_created,
      company: r.company_name?.substring(0, 30),
    })));
  }

  // ===== QUERY 2 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 2: Payments grouped by note');
  console.log('='.repeat(80));
  const q2: any[] = await prisma.$queryRawUnsafe(`
    SELECT note, COUNT(*) as cnt, SUM(amount) as total
    FROM payments
    WHERE note IS NOT NULL AND note != ''
    GROUP BY note
    ORDER BY cnt DESC
    LIMIT 20
  `);
  if (q2.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q2.map(r => ({
      note: r.note?.substring(0, 60),
      count: Number(r.cnt),
      total: Number(r.total),
    })));
  }

  // ===== QUERY 3 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 3: Payments with reconciliation/import notes');
  console.log('='.repeat(80));
  const q3: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.amount, p.paid_at, p.method, p.note,
      c.company_name, d.title
    FROM payments p
    JOIN deals d ON d.id = p.deal_id
    JOIN clients c ON c.id = p.client_id
    WHERE p.note LIKE '%Сверка%' OR p.note LIKE '%Импорт%'
    ORDER BY p.amount DESC
    LIMIT 30
  `);
  if (q3.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q3.map(r => ({
      id: r.id,
      amount: Number(r.amount),
      paid_at: r.paid_at,
      method: r.method,
      note: r.note?.substring(0, 50),
      company: r.company_name?.substring(0, 30),
      deal: r.title?.substring(0, 30),
    })));
  }

  // ===== QUERY 4 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 4: 2026 deals with payment anomalies (|paid - amount| > 10M)');
  console.log('='.repeat(80));
  const q4: any[] = await prisma.$queryRawUnsafe(`
    SELECT d.title, d.amount, d.paid_amount,
      d.amount - d.paid_amount as remaining,
      d.payment_status, d.status,
      c.company_name,
      (SELECT COUNT(*) FROM payments WHERE deal_id = d.id) as payment_count,
      (SELECT SUM(amount) FROM payments WHERE deal_id = d.id) as sum_payments
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.created_at >= '2025-12-31T19:00:00Z'
      AND d.is_archived = false
      AND ABS(d.paid_amount - d.amount) > 10000000
    ORDER BY ABS(d.paid_amount - d.amount) DESC
    LIMIT 20
  `);
  if (q4.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q4.map(r => ({
      title: r.title?.substring(0, 30),
      amount: Number(r.amount),
      paid_amount: Number(r.paid_amount),
      remaining: Number(r.remaining),
      pay_status: r.payment_status,
      status: r.status,
      company: r.company_name?.substring(0, 25),
      pay_count: Number(r.payment_count),
      sum_payments: Number(r.sum_payments),
    })));
  }

  // ===== QUERY 5 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 5: Deals with massive overpayments (> 1M)');
  console.log('='.repeat(80));
  const q5: any[] = await prisma.$queryRawUnsafe(`
    SELECT d.id, d.title, d.amount, d.paid_amount,
      d.paid_amount - d.amount as overpayment,
      c.company_name,
      EXTRACT(MONTH FROM d.created_at) as month
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.paid_amount > d.amount
      AND d.paid_amount - d.amount > 1000000
    ORDER BY d.paid_amount - d.amount DESC
    LIMIT 20
  `);
  if (q5.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q5.map(r => ({
      id: r.id,
      title: r.title?.substring(0, 30),
      amount: Number(r.amount),
      paid_amount: Number(r.paid_amount),
      overpayment: Number(r.overpayment),
      company: r.company_name?.substring(0, 25),
      month: Number(r.month),
    })));
  }

  // ===== QUERY 6 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 6: 2026 monthly import summary');
  console.log('='.repeat(80));
  const q6: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      EXTRACT(MONTH FROM d.created_at) as month,
      COUNT(*) as deals,
      SUM(d.amount) as total_amount,
      SUM(d.paid_amount) as total_paid,
      SUM(GREATEST(d.amount - d.paid_amount, 0)) as gross_debt,
      SUM(GREATEST(d.paid_amount - d.amount, 0)) as overpayments
    FROM deals d
    WHERE d.created_at >= '2025-12-31T19:00:00Z'
      AND d.created_at < '2026-12-31T19:00:00Z'
      AND d.is_archived = false
    GROUP BY EXTRACT(MONTH FROM d.created_at)
    ORDER BY month
  `);
  if (q6.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q6.map(r => ({
      month: Number(r.month),
      deals: Number(r.deals),
      total_amount: Number(r.total_amount),
      total_paid: Number(r.total_paid),
      gross_debt: Number(r.gross_debt),
      overpayments: Number(r.overpayments),
    })));
  }

  // ===== QUERY 7 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 7: Top clients by overpayment (> 1M)');
  console.log('='.repeat(80));
  const q7: any[] = await prisma.$queryRawUnsafe(`
    SELECT c.company_name, c.id,
      SUM(GREATEST(d.paid_amount - d.amount, 0)) as total_overpayment,
      SUM(GREATEST(d.amount - d.paid_amount, 0)) as total_debt,
      SUM(d.amount - d.paid_amount) as net,
      COUNT(d.id) as deals
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    HAVING SUM(GREATEST(d.paid_amount - d.amount, 0)) > 1000000
    ORDER BY SUM(GREATEST(d.paid_amount - d.amount, 0)) DESC
    LIMIT 15
  `);
  if (q7.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q7.map(r => ({
      company: r.company_name?.substring(0, 35),
      id: r.id,
      overpayment: Number(r.total_overpayment),
      debt: Number(r.total_debt),
      net: Number(r.net),
      deals: Number(r.deals),
    })));
  }

  // ===== QUERY 8 =====
  console.log('\n' + '='.repeat(80));
  console.log('QUERY 8: Stock check - products in deals vs products table');
  console.log('='.repeat(80));
  const q8: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT di.product_id) as products_in_deals,
      (SELECT COUNT(*) FROM products WHERE is_active = true) as total_products,
      (SELECT COUNT(*) FROM products WHERE is_active = true AND stock > 0) as products_with_stock
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    WHERE d.is_archived = false
  `);
  if (q8.length === 0) {
    console.log('(no rows)');
  } else {
    console.table(q8.map(r => ({
      products_in_deals: Number(r.products_in_deals),
      total_active_products: Number(r.total_products),
      products_with_stock: Number(r.products_with_stock),
    })));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
