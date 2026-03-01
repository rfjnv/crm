/**
 * Post-migration analytics audit script.
 * Verifies data integrity after _import → real user migration.
 *
 * Run: cd backend && npx tsx src/scripts/audit-analytics.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const TZ = Prisma.sql`'Asia/Tashkent'`;

interface AuditResult {
  check: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
}

const results: AuditResult[] = [];

function ok(check: string, detail: string) { results.push({ check, status: 'OK', detail }); }
function warn(check: string, detail: string) { results.push({ check, status: 'WARN', detail }); }
function fail(check: string, detail: string) { results.push({ check, status: 'FAIL', detail }); }

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Post-Migration Analytics Audit');
  console.log('═══════════════════════════════════════════════\n');

  // ── 1. Check no orphaned references ──
  console.log('[1] Checking for orphaned foreign keys...\n');

  const orphanChecks = [
    { table: 'deals', column: 'manager_id', label: 'deals.manager_id' },
    { table: 'clients', column: 'manager_id', label: 'clients.manager_id' },
    { table: 'payments', column: 'created_by', label: 'payments.created_by' },
    { table: 'inventory_movements', column: 'created_by', label: 'inventory_movements.created_by' },
  ];

  for (const { table, column, label } of orphanChecks) {
    const orphans = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int as count FROM "${table}" t LEFT JOIN users u ON u.id = t."${column}" WHERE t."${column}" IS NOT NULL AND u.id IS NULL`
    );
    const count = orphans[0]?.count || 0;
    if (count > 0) fail(label, `${count} orphaned references found!`);
    else ok(label, 'No orphans');
  }

  // ── 2. Check no _import users remain ──
  console.log('[2] Checking for remaining _import users...\n');
  const importUsers = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM users WHERE login LIKE '%_import'
  `;
  if ((importUsers[0]?.count || 0) > 0) {
    fail('_import users', `${importUsers[0].count} _import users still exist!`);
  } else {
    ok('_import users', 'All _import users deleted');
  }

  // ── 3. Verify deals totals for 2025 ──
  console.log('[3] Verifying 2025 analytics totals...\n');
  const yearStart2025 = new Date('2024-12-31T19:00:00Z');
  const yearEnd2025 = new Date('2025-12-31T19:00:00Z');

  const deals2025 = await prisma.$queryRaw<{ total: number; sum: string; clients: number }[]>`
    SELECT COUNT(*)::int as total,
      COALESCE(SUM(amount), 0)::text as sum,
      COUNT(DISTINCT client_id)::int as clients
    FROM deals WHERE created_at >= ${yearStart2025} AND created_at < ${yearEnd2025} AND is_archived = false
  `;
  const d25 = deals2025[0];
  console.log(`  2025: ${d25.total} deals, ${d25.clients} clients, revenue=${d25.sum}`);
  if (d25.total > 0) ok('2025 deals', `${d25.total} deals, ${d25.clients} clients`);
  else warn('2025 deals', 'No deals found for 2025');

  // ── 4. Verify deals totals for 2026 ──
  console.log('[4] Verifying 2026 analytics totals...\n');
  const yearStart2026 = new Date('2025-12-31T19:00:00Z');
  const yearEnd2026 = new Date('2026-12-31T19:00:00Z');

  const deals2026 = await prisma.$queryRaw<{ total: number; sum: string; clients: number }[]>`
    SELECT COUNT(*)::int as total,
      COALESCE(SUM(amount), 0)::text as sum,
      COUNT(DISTINCT client_id)::int as clients
    FROM deals WHERE created_at >= ${yearStart2026} AND created_at < ${yearEnd2026} AND is_archived = false
  `;
  const d26 = deals2026[0];
  console.log(`  2026: ${d26.total} deals, ${d26.clients} clients, revenue=${d26.sum}`);
  if (d26.total > 0) ok('2026 deals', `${d26.total} deals, ${d26.clients} clients`);
  else warn('2026 deals', 'No deals found for 2026');

  // ── 5. Verify monthly distribution (timezone fix) ──
  console.log('[5] Verifying monthly distribution (timezone fix)...\n');

  for (const [yearLabel, ys, ye] of [['2025', yearStart2025, yearEnd2025], ['2026', yearStart2026, yearEnd2026]] as const) {
    const monthly = await prisma.$queryRaw<{ month: number; count: number; revenue: string }[]>`
      SELECT EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::int as month,
        COUNT(*)::int as count, COALESCE(SUM(amount), 0)::text as revenue
      FROM deals d
      WHERE d.created_at >= ${ys} AND d.created_at < ${ye} AND is_archived = false
      GROUP BY EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})
      ORDER BY month
    `;
    console.log(`  ${yearLabel} monthly distribution:`);
    for (const m of monthly) {
      console.log(`    Month ${m.month}: ${m.count} deals, revenue=${m.revenue}`);
    }

    // Check no month > 12 or < 1
    const bad = monthly.filter(m => m.month < 1 || m.month > 12);
    if (bad.length > 0) fail(`${yearLabel} months`, `Invalid months found: ${bad.map(b => b.month).join(', ')}`);
    else ok(`${yearLabel} months`, `All months valid (${monthly.map(m => m.month).join(', ')})`);
  }

  // ── 6. Verify manager data after migration ──
  console.log('\n[6] Verifying manager analytics...\n');
  const managerStats = await prisma.$queryRaw<{ login: string; full_name: string; deals: number; revenue: string }[]>`
    SELECT u.login, u.full_name,
      COUNT(d.id)::int as deals,
      COALESCE(SUM(d.amount), 0)::text as revenue
    FROM users u
    LEFT JOIN deals d ON d.manager_id = u.id AND d.is_archived = false
    GROUP BY u.id, u.login, u.full_name
    HAVING COUNT(d.id) > 0
    ORDER BY COUNT(d.id) DESC
  `;
  console.log('  Active managers (with deals):');
  for (const m of managerStats) {
    console.log(`    ${m.login.padEnd(15)} ${m.full_name.padEnd(20)} deals=${m.deals} revenue=${m.revenue}`);
  }
  // Verify admin has deals (from фарход_import)
  const adminStats = managerStats.find(m => m.login === 'admin');
  if (adminStats && adminStats.deals > 0) {
    ok('admin data', `admin has ${adminStats.deals} deals (from фарход_import)`);
  } else {
    fail('admin data', 'admin has no deals — migration may have failed');
  }

  // ── 7. Verify debt calculations ──
  console.log('\n[7] Verifying debt calculations...\n');
  const debtTotal = await prisma.$queryRaw<{ total_debt: string; debtor_count: number }[]>`
    SELECT COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as total_debt,
      COUNT(DISTINCT CASE WHEN (d.amount - COALESCE(p.total_paid, 0)) > 0 THEN d.client_id END)::int as debtor_count
    FROM deals d
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
  `;
  console.log(`  Total debt: ${debtTotal[0].total_debt}, debtors: ${debtTotal[0].debtor_count}`);
  ok('Debt calc', `debt=${debtTotal[0].total_debt}, debtors=${debtTotal[0].debtor_count}`);

  // ── 8. Verify payments/cashflow ──
  console.log('\n[8] Verifying cashflow...\n');
  for (const [yearLabel, ys, ye] of [['2025', yearStart2025, yearEnd2025], ['2026', yearStart2026, yearEnd2026]] as const) {
    const cf = await prisma.$queryRaw<{ total: string; count: number }[]>`
      SELECT COALESCE(SUM(amount), 0)::text as total, COUNT(*)::int as count
      FROM payments WHERE paid_at >= ${ys} AND paid_at < ${ye}
    `;
    console.log(`  ${yearLabel}: ${cf[0].count} payments, total=${cf[0].total}`);
    ok(`${yearLabel} cashflow`, `${cf[0].count} payments, total=${cf[0].total}`);
  }

  // ── 9. Verify opening/closing balance ──
  console.log('\n[9] Verifying opening/closing balance (sample: Jan 2026)...\n');
  const balance = await prisma.$queryRaw<{ opening: string; closing: string }[]>`
    WITH deal_paid AS (
      SELECT d.id as deal_id, d.amount as deal_amount, d.created_at,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.paid_at < make_timestamptz(2026::int, 1::int, 1, 0, 0, 0, ${TZ})
        ), 0) as paid_before_open,
        COALESCE(SUM(p.amount) FILTER (
          WHERE p.paid_at < make_timestamptz(2026::int, 1::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
        ), 0) as paid_before_close
      FROM deals d
      LEFT JOIN payments p ON p.deal_id = d.id
      WHERE d.is_archived = false
      GROUP BY d.id, d.amount, d.created_at
    )
    SELECT
      COALESCE(SUM(GREATEST(deal_amount - paid_before_open, 0)) FILTER (
        WHERE created_at < make_timestamptz(2026::int, 1::int, 1, 0, 0, 0, ${TZ})
      ), 0)::text as opening,
      COALESCE(SUM(GREATEST(deal_amount - paid_before_close, 0)) FILTER (
        WHERE created_at < make_timestamptz(2026::int, 1::int, 1, 0, 0, 0, ${TZ}) + interval '1 month'
      ), 0)::text as closing
    FROM deal_paid
  `;
  console.log(`  Jan 2026: opening=${balance[0].opening}, closing=${balance[0].closing}`);
  ok('Balance Jan 2026', `opening=${balance[0].opening}, closing=${balance[0].closing}`);

  // ── 10. Check for data duplication ──
  console.log('\n[10] Checking for data duplication...\n');
  const dupDeals = await prisma.$queryRaw<{ dup_count: number }[]>`
    SELECT COUNT(*)::int as dup_count FROM (
      SELECT title, client_id, amount, created_at, COUNT(*) as cnt
      FROM deals WHERE is_archived = false
      GROUP BY title, client_id, amount, created_at
      HAVING COUNT(*) > 1
    ) dups
  `;
  if ((dupDeals[0]?.dup_count || 0) > 0) {
    warn('Deal duplicates', `${dupDeals[0].dup_count} potential duplicate deal groups found`);
  } else {
    ok('Deal duplicates', 'No duplicate deals detected');
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════');
  console.log('  AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════\n');

  const okCount = results.filter(r => r.status === 'OK').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  for (const r of results) {
    const icon = r.status === 'OK' ? 'OK' : r.status === 'WARN' ? 'WARN' : 'FAIL';
    console.log(`  [${icon}] ${r.check}: ${r.detail}`);
  }

  console.log(`\n  Total: ${okCount} OK, ${warnCount} WARN, ${failCount} FAIL`);
  if (failCount > 0) console.log('  ACTION REQUIRED: Fix FAIL items above');
}

main().catch(console.error).finally(() => prisma.$disconnect());
