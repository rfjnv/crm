/**
 * Quick revenue diagnostic using pg module
 */
const { Client } = require('pg');

// External Render PostgreSQL URL (note: external hostname format)
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://crm_user:BChpe9Gb4dOeVQQxRYVkiLUgu4TsmWJo@dpg-d6bcdrt6ubrc73ch10dg-a.oregon-postgres.render.com/crm_db_okj8';

async function main() {
  console.log('Connecting to database...');
  const client = new Client({ 
    connectionString: DATABASE_URL, 
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  
  try {
    await client.connect();
    console.log('Connected!');
  } catch (e) {
    console.error('Connection failed:', e.message);
    // Try with external URL
    console.log('\nTrying external URL...');
    const extUrl = DATABASE_URL.replace('-a.oregon', '-a.external.oregon');
    const client2 = new Client({ connectionString: extUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
      await client2.connect();
      console.log('Connected via external URL!');
      await runDiagnostic(client2);
      await client2.end();
      return;
    } catch (e2) {
      console.error('External URL also failed:', e2.message);
      process.exit(1);
    }
  }

  await runDiagnostic(client);
  await client.end();
}

async function runDiagnostic(client) {
  const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
  const y = nowTashkent.getUTCFullYear();
  const mo = nowTashkent.getUTCMonth();
  const dy = nowTashkent.getUTCDate();

  const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
  const startOfTomorrow = new Date(startOfToday.getTime() + 86400000);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfMonth = new Date(Date.UTC(y, mo, 1) - TASHKENT_OFFSET);

  console.log('\n=== REVENUE DIAGNOSTIC ===');
  console.log(`Now (Tashkent): ${nowTashkent.toISOString()}`);
  console.log(`Start of today (UTC): ${startOfToday.toISOString()}`);
  console.log(`Start of yesterday (UTC): ${startOfYesterday.toISOString()}`);

  // Revenue yesterday
  const rev = await client.query(`
    SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
    FROM deal_items di JOIN deals d ON d.id = di.deal_id
    WHERE d.status NOT IN ('CANCELED', 'REJECTED') AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= $1 AND COALESCE(di.deal_date, d.created_at) < $2
  `, [startOfYesterday, startOfToday]);
  console.log(`\nRevenue YESTERDAY: ${Number(rev.rows[0].total).toLocaleString('ru-RU')}`);

  // Revenue today
  const revT = await client.query(`
    SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
    FROM deal_items di JOIN deals d ON d.id = di.deal_id
    WHERE d.status NOT IN ('CANCELED', 'REJECTED') AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= $1 AND COALESCE(di.deal_date, d.created_at) < $2
  `, [startOfToday, startOfTomorrow]);
  console.log(`Revenue TODAY: ${Number(revT.rows[0].total).toLocaleString('ru-RU')}`);

  // Revenue month
  const revM = await client.query(`
    SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
    FROM deal_items di JOIN deals d ON d.id = di.deal_id
    WHERE d.status NOT IN ('CANCELED', 'REJECTED') AND d.is_archived = false
      AND COALESCE(di.deal_date, d.created_at) >= $1 AND COALESCE(di.deal_date, d.created_at) < $2
  `, [startOfMonth, startOfTomorrow]);
  console.log(`Revenue THIS MONTH: ${Number(revM.rows[0].total).toLocaleString('ru-RU')}`);

  // Deals created yesterday
  const deals = await client.query(`
    SELECT d.id, d.title, d.status, d.amount::text, d.paid_amount::text, d.is_archived, d.created_at,
           c.company_name, u.full_name as manager_name
    FROM deals d JOIN clients c ON c.id = d.client_id JOIN users u ON u.id = d.manager_id
    WHERE d.created_at >= $1 AND d.created_at < $2
    ORDER BY d.created_at DESC
  `, [startOfYesterday, startOfToday]);

  console.log(`\n=== DEALS CREATED YESTERDAY (${deals.rows.length}) ===`);
  for (const d of deals.rows) {
    console.log(`  "${d.title}" (${d.id.slice(0,8)}) | ${d.company_name} | mgr=${d.manager_name}`);
    console.log(`    status=${d.status} | amount=${Number(d.amount).toLocaleString('ru-RU')} | paid=${Number(d.paid_amount).toLocaleString('ru-RU')} | archived=${d.is_archived}`);
  }

  // Deal items matching yesterday
  const items = await client.query(`
    SELECT di.id, d.id as deal_id, d.title, d.status, d.is_archived,
           p.name as product_name, c.company_name,
           di.requested_qty::text, di.price::text, di.line_total::text,
           di.deal_date, d.created_at,
           COALESCE(di.line_total, di.requested_qty * di.price, 0)::text as computed
    FROM deal_items di
    JOIN deals d ON d.id = di.deal_id
    JOIN products p ON p.id = di.product_id
    JOIN clients c ON c.id = d.client_id
    WHERE COALESCE(di.deal_date, d.created_at) >= $1 AND COALESCE(di.deal_date, d.created_at) < $2
    ORDER BY d.created_at DESC
  `, [startOfYesterday, startOfToday]);

  console.log(`\n=== DEAL ITEMS MATCHING YESTERDAY (${items.rows.length}) ===`);
  for (const r of items.rows) {
    const ex = ['CANCELED','REJECTED'].includes(r.status) || r.is_archived;
    console.log(`  ${ex ? '[EXCLUDED] ' : ''}${r.product_name} | "${r.title}" (${r.deal_id.slice(0,8)}) | ${r.company_name}`);
    console.log(`    status=${r.status} archived=${r.is_archived} | qty=${r.requested_qty} price=${r.price} lineTotal=${r.line_total ?? 'NULL'} computed=${Number(r.computed).toLocaleString('ru-RU')}`);
    console.log(`    dealDate=${r.deal_date || 'NULL'} createdAt=${r.created_at}`);
  }

  // Excluded deals
  const excluded = await client.query(`
    SELECT d.id, d.title, d.status, d.amount::text, d.is_archived, c.company_name
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.created_at >= $1 AND d.created_at < $2
      AND (d.status IN ('CANCELED', 'REJECTED') OR d.is_archived = true)
  `, [startOfYesterday, startOfToday]);

  console.log(`\n=== EXCLUDED DEALS YESTERDAY (${excluded.rows.length}) ===`);
  for (const d of excluded.rows) {
    console.log(`  "${d.title}" (${d.id.slice(0,8)}) | ${d.company_name} | status=${d.status} archived=${d.is_archived} | amount=${Number(d.amount).toLocaleString('ru-RU')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
