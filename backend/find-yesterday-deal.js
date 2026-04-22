const { Client } = require('pg');
const DATABASE_URL = 'postgresql://crm_user:BChpe9Gb4dOeVQQxRYVkiLUgu4TsmWJo@dpg-d6bcdrt6ubrc73ch10dg-a.oregon-postgres.render.com/crm_db_okj8';

async function run() {
  const client = new Client({ 
    connectionString: DATABASE_URL, 
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  
  try {
    const extUrl = DATABASE_URL.replace('-a.oregon', '-a.external.oregon');
    const c2 = new Client({ connectionString: extUrl, ssl: { rejectUnauthorized: false } });
    await c2.connect();
    
    // 2026-03-31 (Tashkent Yesterday)
    // TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
    // 2026-03-31 00:00:00 Tashkent = 2026-03-30 19:00:00 UTC
    // 2026-04-01 00:00:00 Tashkent = 2026-03-31 19:00:00 UTC
    
    const start = new Date('2026-03-30T19:00:00Z');
    const end = new Date('2026-03-31T19:00:00Z');
    
    const res = await c2.query(`
      SELECT d.id, d.title, d.status, d.amount::text, d.paid_amount::text, d.is_archived, d.created_at,
             c.company_name
      FROM deals d
      LEFT JOIN clients c ON c.id = d.client_id
      WHERE (d.created_at >= $1 AND d.created_at < $2)
         OR EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.deal_date >= $1 AND di.deal_date < $2)
      ORDER BY d.created_at DESC
    `, [start, end]);
    
    console.log('--- DEALS FROM YESTERDAY (Tashkent 31.03.2026) ---');
    for (const r of res.rows) {
      console.log(`[${r.id.slice(0,8)}] ${r.title} | ${r.company_name} | status=${r.status} | amt=${r.amount} | archived=${r.is_archived}`);
    }
    
    await c2.end();
  } catch (e) {
    console.error(e.message);
  }
}

run();
