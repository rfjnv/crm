/**
 * Quick fix: find deals where deals.amount != SUM(items revenue)
 * This explains the 250k gap.
 *
 * Run via Render Shell or local if DB is accessible.
 * Usage: node quick-gap.js
 */
const { Client } = require('pg');

const DB = 'postgresql://crm_user:BChpe9Gb4dOeVQQxRYVkiLUgu4TsmWJo@dpg-d6bcdrt6ubrc73ch10dg-a.oregon-postgres.render.com/crm_db_okj8';

async function run() {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('Connected!\n');

  // Yesterday window (Tashkent 31.03.2026)
  const yStart = '2026-03-30T19:00:00Z';
  const yEnd   = '2026-03-31T19:00:00Z';

  // Find deals where the item revenue doesn't match the deal amount
  const { rows } = await c.query(`
    SELECT 
      d.id,
      d.title,
      d.status,
      d.amount::numeric                                              AS deal_amount,
      COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::numeric AS items_revenue,
      d.amount - COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0) AS gap,
      c.company_name,
      d.created_at
    FROM deals d
    LEFT JOIN clients c ON c.id = d.client_id
    LEFT JOIN deal_items di ON di.deal_id = d.id
    WHERE d.created_at >= $1 AND d.created_at < $2
      AND d.status NOT IN ('CANCELED','REJECTED')
      AND d.is_archived = false
    GROUP BY d.id, c.company_name
    HAVING ABS(d.amount - COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)) > 100
    ORDER BY ABS(gap) DESC
  `, [yStart, yEnd]);

  if (rows.length === 0) {
    console.log('No gap found between deal.amount and item revenues for yesterday.');
    console.log('The issue might be with deal_date vs created_at — checking that now...\n');

    // Check deals where deal_date is set to a different day than created_at
    const { rows: r2 } = await c.query(`
      SELECT d.id, d.title, c.company_name, d.created_at, 
             di.deal_date, d.amount::numeric,
             COALESCE(di.line_total, di.requested_qty * di.price, 0)::numeric as item_rev
      FROM deals d
      LEFT JOIN clients c ON c.id = d.client_id
      LEFT JOIN deal_items di ON di.deal_id = d.id
      WHERE d.created_at >= $1 AND d.created_at < $2
        AND di.deal_date IS NOT NULL
        AND di.deal_date NOT BETWEEN $1 AND $2
      LIMIT 20
    `, [yStart, yEnd]);

    console.log(`Deals created yesterday but with deal_date OUTSIDE yesterday: ${r2.length}`);
    for (const r of r2) {
      console.log(`  "${r.title}" (${r.id.slice(0,8)}) | ${r.company_name}`);
      console.log(`    created_at=${r.created_at} | deal_date=${r.deal_date} | item_rev=${Number(r.item_rev).toLocaleString('ru-RU')}`);
    }
  } else {
    console.log(`Found ${rows.length} deals with gap:\n`);
    for (const r of rows) {
      console.log(`  "${r.title}" (${r.id.slice(0,8)}) | ${r.company_name}`);
      console.log(`    deal.amount=${Number(r.deal_amount).toLocaleString('ru-RU')}`);
      console.log(`    items_revenue=${Number(r.items_revenue).toLocaleString('ru-RU')}`);
      console.log(`    GAP=${Number(r.gap).toLocaleString('ru-RU')}`);
    }
  }

  // Also show all items for all yesterday deals to see what's contributing 0
  const { rows: allItems } = await c.query(`
    SELECT 
      c.company_name, d.title, d.id as deal_id,
      p.name as product,
      di.requested_qty::numeric, di.price::numeric, di.line_total::numeric,
      COALESCE(di.line_total, di.requested_qty * di.price, 0)::numeric as computed,
      di.deal_date, d.created_at
    FROM deals d
    LEFT JOIN clients c ON c.id = d.client_id
    LEFT JOIN deal_items di ON di.deal_id = d.id
    LEFT JOIN products p ON p.id = di.product_id
    WHERE d.created_at >= $1 AND d.created_at < $2
      AND d.status NOT IN ('CANCELED','REJECTED')
      AND d.is_archived = false
    ORDER BY d.created_at DESC, computed ASC
  `, [yStart, yEnd]);

  console.log(`\n── All items from yesterday's deals (${allItems.length} items) ──`);
  let lastDeal = '';
  let dealTotal = 0;
  for (const r of allItems) {
    if (r.deal_id !== lastDeal) {
      if (lastDeal) console.log(`  → ITEMS SUM: ${dealTotal.toLocaleString('ru-RU')}`);
      console.log(`\n  ${r.company_name} — "${r.title}"`);
      lastDeal = r.deal_id;
      dealTotal = 0;
    }
    const c2 = Number(r.computed);
    dealTotal += c2;
    const warn = c2 === 0 ? ' ← ⚠️ ZERO' : '';
    console.log(`    ${r.product}: qty=${r.requested_qty} × price=${r.price} | lineTotal=${r.line_total} | computed=${c2.toLocaleString('ru-RU')}${warn}`);
    console.log(`      dealDate=${r.deal_date || 'NULL'} createdAt=${r.created_at}`);
  }
  if (lastDeal) console.log(`  → ITEMS SUM: ${dealTotal.toLocaleString('ru-RU')}`);

  await c.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
