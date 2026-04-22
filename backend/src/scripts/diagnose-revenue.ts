/**
 * Diagnostic: Check yesterday's deals and revenue calculation
 * Run: npx ts-node src/scripts/diagnose-revenue.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTashkent.getUTCFullYear();
  const mo = nowTashkent.getUTCMonth();
  const dy = nowTashkent.getUTCDate();

  const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfMonth = new Date(Date.UTC(y, mo, 1) - TASHKENT_OFFSET);

  console.log('=== REVENUE DIAGNOSTIC ===');
  console.log(`Now (Tashkent): ${nowTashkent.toISOString()}`);
  console.log(`Start of today (UTC): ${startOfToday.toISOString()}`);
  console.log(`Start of yesterday (UTC): ${startOfYesterday.toISOString()}`);
  console.log(`Start of month (UTC): ${startOfMonth.toISOString()}`);

  // 1. All deals created yesterday
  console.log('\n=== DEALS CREATED YESTERDAY ===');
  const yesterdayDeals = await prisma.deal.findMany({
    where: {
      createdAt: {
        gte: startOfYesterday,
        lt: startOfToday,
      },
      isArchived: false,
    },
    include: {
      client: { select: { companyName: true } },
      manager: { select: { fullName: true } },
      items: {
        include: { product: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Total deals created yesterday: ${yesterdayDeals.length}`);
  for (const deal of yesterdayDeals) {
    console.log(`\n  Deal: ${deal.title} (${deal.id.slice(0, 8)})`);
    console.log(`    Client: ${deal.client?.companyName}`);
    console.log(`    Manager: ${deal.manager?.fullName}`);
    console.log(`    Status: ${deal.status}`);
    console.log(`    Amount: ${Number(deal.amount).toLocaleString('ru-RU')}`);
    console.log(`    Paid: ${Number(deal.paidAmount).toLocaleString('ru-RU')}`);
    console.log(`    Created: ${deal.createdAt.toISOString()}`);
    console.log(`    Archived: ${deal.isArchived}`);
    console.log(`    Items (${deal.items.length}):`);
    for (const item of deal.items) {
      const qty = item.requestedQty != null ? Number(item.requestedQty) : 0;
      const price = item.price != null ? Number(item.price) : 0;
      const lineTotal = item.lineTotal != null ? Number(item.lineTotal) : null;
      const dealDate = item.dealDate ? item.dealDate.toISOString() : 'NULL';
      console.log(`      - ${item.product?.name}: qty=${qty}, price=${price.toLocaleString('ru-RU')}, lineTotal=${lineTotal !== null ? lineTotal.toLocaleString('ru-RU') : 'NULL'}, dealDate=${dealDate}`);
    }
  }

  // 2. Revenue calculation as dashboard does it (COALESCE(deal_date, created_at))
  console.log('\n=== DASHBOARD REVENUE CALCULATION: YESTERDAY ===');
  const revenueYesterday = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
     FROM deal_items di
     JOIN deals d ON d.id = di.deal_id
     WHERE d.status NOT IN ('CANCELED', 'REJECTED')
       AND d.is_archived = false
       AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
       AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}`
  );
  console.log(`Revenue yesterday (dashboard formula): ${Number(revenueYesterday[0]?.total || 0).toLocaleString('ru-RU')}`);

  // 3. Find deal items that match yesterday by COALESCE logic
  console.log('\n=== DEAL ITEMS MATCHING YESTERDAY (by COALESCE) ===');
  const matchingItems = await prisma.$queryRaw<{
    item_id: string;
    deal_id: string;
    deal_title: string;
    deal_status: string;
    is_archived: boolean;
    product_name: string;
    requested_qty: string;
    price: string;
    line_total: string | null;
    deal_date: Date | null;
    deal_created_at: Date;
    effective_date: Date;
    computed_revenue: string;
    client_name: string;
  }[]>(
    Prisma.sql`SELECT 
      di.id as item_id,
      d.id as deal_id,
      d.title as deal_title,
      d.status as deal_status,
      d.is_archived,
      p.name as product_name,
      di.requested_qty::text,
      di.price::text,
      di.line_total::text,
      di.deal_date,
      d.created_at as deal_created_at,
      COALESCE(di.deal_date, d.created_at) as effective_date,
      COALESCE(di.line_total, di.requested_qty * di.price, 0)::text as computed_revenue,
      c.company_name as client_name
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    JOIN products p ON p.id = di.product_id
    JOIN clients c ON c.id = d.client_id
    WHERE COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
      AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
    ORDER BY d.created_at DESC`
  );

  console.log(`Total items matching yesterday: ${matchingItems.length}`);
  for (const item of matchingItems) {
    const excluded = ['CANCELED', 'REJECTED'].includes(item.deal_status) || item.is_archived;
    console.log(`  ${excluded ? '[EXCLUDED] ' : ''}${item.product_name} | deal="${item.deal_title}" (${item.deal_id.slice(0, 8)}) | client="${item.client_name}"`);
    console.log(`    status=${item.deal_status}, archived=${item.is_archived}`);
    console.log(`    qty=${item.requested_qty}, price=${item.price}, lineTotal=${item.line_total ?? 'NULL'}`);
    console.log(`    dealDate=${item.deal_date ? item.deal_date.toISOString() : 'NULL'}, deal.createdAt=${item.deal_created_at.toISOString()}`);
    console.log(`    effectiveDate=${item.effective_date.toISOString()}`);
    console.log(`    computedRevenue=${Number(item.computed_revenue).toLocaleString('ru-RU')}`);
  }

  // 4. Check for items with NULL lineTotal that have qty and price
  console.log('\n=== ITEMS WITH NULL line_total (but qty & price present) ===');
  const nullLineTotalItems = await prisma.$queryRaw<{
    item_id: string;
    deal_id: string;
    deal_title: string;
    product_name: string;
    requested_qty: string;
    price: string;
    line_total: string | null;
    deal_date: Date | null;
    deal_created_at: Date;
  }[]>(
    Prisma.sql`SELECT 
      di.id as item_id,
      d.id as deal_id,
      d.title as deal_title,
      p.name as product_name,
      di.requested_qty::text,
      di.price::text,
      di.line_total::text,
      di.deal_date,
      d.created_at as deal_created_at
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    JOIN products p ON p.id = di.product_id
    WHERE di.line_total IS NULL
      AND di.requested_qty IS NOT NULL AND di.requested_qty > 0
      AND di.price IS NOT NULL AND di.price > 0
      AND d.status NOT IN ('CANCELED', 'REJECTED')
      AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
      AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
    ORDER BY d.created_at DESC`
  );

  console.log(`Items with NULL lineTotal but have qty & price: ${nullLineTotalItems.length}`);
  for (const item of nullLineTotalItems) {
    const expected = Number(item.requested_qty) * Number(item.price);
    console.log(`  ${item.product_name} | deal="${item.deal_title}" (${item.deal_id.slice(0,8)})`);
    console.log(`    qty=${item.requested_qty}, price=${item.price}, expected lineTotal=${expected.toLocaleString('ru-RU')}`);
  }

  // 5. Revenue today for comparison
  console.log('\n=== DASHBOARD REVENUE CALCULATION: TODAY ===');
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
  const revenueToday = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
     FROM deal_items di
     JOIN deals d ON d.id = di.deal_id
     WHERE d.status NOT IN ('CANCELED', 'REJECTED')
       AND d.is_archived = false
       AND COALESCE(di.deal_date, d.created_at) >= ${startOfToday}
       AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}`
  );
  console.log(`Revenue today (dashboard formula): ${Number(revenueToday[0]?.total || 0).toLocaleString('ru-RU')}`);

  // 6. Revenue this month
  const revenueMonth = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
     FROM deal_items di
     JOIN deals d ON d.id = di.deal_id
     WHERE d.status NOT IN ('CANCELED', 'REJECTED')
       AND d.is_archived = false
       AND COALESCE(di.deal_date, d.created_at) >= ${startOfMonth}
       AND COALESCE(di.deal_date, d.created_at) < ${startOfTomorrow}`
  );
  console.log(`Revenue this month (dashboard formula): ${Number(revenueMonth[0]?.total || 0).toLocaleString('ru-RU')}`);

  // 7. Check if deals yesterday are CANCELED or REJECTED
  console.log('\n=== DEALS YESTERDAY WITH CANCELED/REJECTED STATUS ===');
  const excludedDeals = await prisma.deal.findMany({
    where: {
      createdAt: { gte: startOfYesterday, lt: startOfToday },
      OR: [
        { status: { in: ['CANCELED', 'REJECTED'] } },
        { isArchived: true },
      ],
    },
    include: {
      client: { select: { companyName: true } },
      items: true,
    },
  });
  
  console.log(`Excluded deals: ${excludedDeals.length}`);
  for (const deal of excludedDeals) {
    const itemsTotal = deal.items.reduce((s, i) => s + Number(i.lineTotal ?? (Number(i.requestedQty ?? 0) * Number(i.price ?? 0))), 0);
    console.log(`  ${deal.title} (${deal.id.slice(0,8)}) | status=${deal.status}, archived=${deal.isArchived} | client=${deal.client?.companyName} | itemsTotal=${itemsTotal.toLocaleString('ru-RU')}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
