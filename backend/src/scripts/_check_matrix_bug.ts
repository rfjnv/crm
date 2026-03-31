import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r1: any[] = await p.$queryRawUnsafe(`
    SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text as debt
    FROM deals d WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
  `);
  console.log('Dashboard totalDebt:', r1[0].debt);

  const r2: any[] = await p.$queryRawUnsafe(`
    SELECT 
      SUM(CASE WHEN amount-paid_amount > 0 THEN amount-paid_amount ELSE 0 END)::text as gross,
      SUM(CASE WHEN amount-paid_amount < 0 THEN amount-paid_amount ELSE 0 END)::text as prepay,
      SUM(amount-paid_amount)::text as net
    FROM deals WHERE is_archived = false AND status NOT IN ('CANCELED','REJECTED')
  `);
  console.log('Gross:', r2[0].gross, 'Prepay:', r2[0].prepay, 'Net:', r2[0].net);

  // Check snapshots that might be stale
  const snaps: any[] = await p.$queryRawUnsafe(`
    SELECT year, month, scope, type, LENGTH(data::text) as data_len
    FROM monthly_snapshots
    ORDER BY year DESC, month DESC
  `);
  console.log('\nMonthly snapshots in DB:');
  for (const s of snaps) {
    console.log(`  ${s.year}-${String(s.month).padStart(2,'0')} scope=${s.scope} type=${s.type} (${s.data_len} bytes)`);
  }

  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
