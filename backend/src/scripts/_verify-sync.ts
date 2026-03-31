/**
 * Post-sync verification script.
 * Checks acceptance criteria after sync-payments + reallocate-payments.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== POST-SYNC VERIFICATION ===\n');

  // 1. Gross debt (user-specified SQL)
  const grossDebt = await prisma.$queryRaw<{ gross_debt: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(GREATEST(d.amount - COALESCE(d.paid_amount,0),0)),0)::text AS gross_debt
    FROM deals d
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')`
  );
  console.log(`1. Gross debt (acceptance SQL):  ${Number(grossDebt[0].gross_debt).toLocaleString('ru-RU')}`);

  // 2. Net debt (amount - paid_amount, can be negative)
  const netDebt = await prisma.$queryRaw<{ net_debt: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(d.amount - COALESCE(d.paid_amount,0)),0)::text AS net_debt
    FROM deals d
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')`
  );
  console.log(`2. Net debt (signed):            ${Number(netDebt[0].net_debt).toLocaleString('ru-RU')}`);

  // 3. Dashboard formula: SUM(amount - paid_amount) WHERE payment_status IN (UNPAID, PARTIAL)
  const dashDebt = await prisma.$queryRaw<{ dash_debt: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(d.amount - d.paid_amount),0)::text AS dash_debt
    FROM deals d
    WHERE d.is_archived = false
      AND d.payment_status IN ('UNPAID','PARTIAL')`
  );
  console.log(`3. Dashboard debt (UNPAID+PARTIAL): ${Number(dashDebt[0].dash_debt).toLocaleString('ru-RU')}`);

  // 4. Clients with negative balance (potential errors)
  const negClients = await prisma.$queryRaw<{ company_name: string; net: string }[]>(
    Prisma.sql`SELECT c.company_name, SUM(d.amount - d.paid_amount)::text as net
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    HAVING SUM(d.amount - d.paid_amount) < -1000
    ORDER BY SUM(d.amount - d.paid_amount) ASC
    LIMIT 20`
  );
  console.log(`\n4. Clients with negative balance (net < -1000): ${negClients.length}`);
  if (negClients.length > 0) {
    for (const c of negClients) {
      console.log(`   ${c.company_name.padEnd(35)} ${Number(c.net).toLocaleString('ru-RU')}`);
    }
  }

  // 5. Sync payment stats
  const syncStats = await prisma.$queryRaw<{ cnt: string; total: string }[]>(
    Prisma.sql`SELECT COUNT(*)::text as cnt, COALESCE(SUM(amount),0)::text as total
    FROM payments WHERE note LIKE '%Сверка CRM%'`
  );
  console.log(`\n5. Sync payments: ${syncStats[0].cnt} records, sum = ${Number(syncStats[0].total).toLocaleString('ru-RU')}`);

  // 6. Payment status distribution
  const statusDist = await prisma.$queryRaw<{ status: string; cnt: string }[]>(
    Prisma.sql`SELECT payment_status as status, COUNT(*)::text as cnt
    FROM deals WHERE is_archived = false
    GROUP BY payment_status ORDER BY payment_status`
  );
  console.log(`\n6. Deal payment status distribution:`);
  for (const s of statusDist) {
    console.log(`   ${s.status.padEnd(10)} ${s.cnt}`);
  }

  // 7. Top 10 debtors after sync
  const topDebtors = await prisma.$queryRaw<{ name: string; gross: string; net: string; deals: string }[]>(
    Prisma.sql`SELECT c.company_name as name,
      SUM(GREATEST(d.amount - d.paid_amount, 0))::text as gross,
      SUM(d.amount - d.paid_amount)::text as net,
      COUNT(d.id)::text as deals
    FROM deals d JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
    ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
    LIMIT 10`
  );
  console.log(`\n7. Top 10 debtors after sync:`);
  console.log(`   ${'Клиент'.padEnd(35)} ${'Gross'.padStart(15)} ${'Net'.padStart(15)} Deals`);
  console.log(`   ${'-'.repeat(75)}`);
  for (const d of topDebtors) {
    console.log(`   ${d.name.padEnd(35)} ${Number(d.gross).toLocaleString('ru-RU').padStart(15)} ${Number(d.net).toLocaleString('ru-RU').padStart(15)} ${d.deals}`);
  }

  // 8. Snapshots remaining
  const snaps = await prisma.$queryRaw<{ cnt: string }[]>(
    Prisma.sql`SELECT COUNT(*)::text as cnt FROM "MonthlySnapshot"`
  );
  console.log(`\n8. Snapshots remaining: ${snaps[0].cnt}`);

  // 9. Backup files
  const fs = await import('fs');
  const path = await import('path');
  const backupDir = path.resolve(__dirname, '../../backups');
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
    console.log(`\n9. Backup files in ${backupDir}:`);
    for (const f of files) {
      const stat = fs.statSync(path.join(backupDir, f));
      console.log(`   ${f} (${(stat.size / 1024).toFixed(0)} KB)`);
    }
  }

  console.log('\n=== VERIFICATION COMPLETE ===');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
