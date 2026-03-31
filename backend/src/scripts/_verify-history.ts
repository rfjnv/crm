/**
 * Verify that History now uses the same debt formula as Dashboard.
 * Run the exact same SQL patterns that history.routes.ts now uses.
 * READ-ONLY.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== VERIFICATION: History == Dashboard ===\n');

  // 1. Dashboard debt (reference)
  const dashboard = await prisma.$queryRaw<{ val: string }[]>(
    Prisma.sql`SELECT COALESCE(SUM(d.amount - d.paid_amount), 0)::text AS val
    FROM deals d
    WHERE d.payment_status IN ('UNPAID','PARTIAL')
      AND d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')`
  );
  console.log(`Dashboard debt:  ${Number(dashboard[0].val).toLocaleString('ru-RU')}`);

  // 2. Overview totalDebt (NEW formula - matches change 1)
  const overview = await prisma.$queryRaw<{ total_debt: string; total_overpayments: string }[]>(
    Prisma.sql`SELECT
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as total_debt,
      COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as total_overpayments
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')`
  );
  const debt = Number(overview[0].total_debt);
  const overpay = Number(overview[0].total_overpayments);
  console.log(`History debt:    ${debt.toLocaleString('ru-RU')}`);
  console.log(`Overpayments:    ${overpay.toLocaleString('ru-RU')}`);
  console.log(`Net balance:     ${(debt - overpay).toLocaleString('ru-RU')}`);
  console.log(`Match Dashboard: ${Number(dashboard[0].val) === debt ? '✓ YES' : '✗ NO'}\n`);

  // 3. Monthly balance for year=2026 (NEW formula - check last month closing)
  const year = 2026;
  const TZ = "'Asia/Tashkent'";
  const balance = await prisma.$queryRaw<{ month: number; closing_balance: string }[]>(
    Prisma.sql`SELECT m.month,
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)) FILTER (
        WHERE d.created_at < make_timestamptz(${year}::int, m.month::int, 1, 0, 0, 0, 'Asia/Tashkent') + interval '1 month'
      ), 0)::text as closing_balance
    FROM generate_series(1, 12) as m(month)
    CROSS JOIN deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY m.month
    ORDER BY m.month`
  );

  console.log('Monthly closing balances (year=2026):');
  for (const b of balance) {
    const val = Number(b.closing_balance);
    if (val > 0) {
      const match = val === debt ? ' ← matches Dashboard' : '';
      console.log(`  Month ${String(b.month).padStart(2)}: ${val.toLocaleString('ru-RU').padStart(18)}${match}`);
    }
  }

  // 4. Debtors top 5 (NEW formula)
  const debtors = await prisma.$queryRaw<{ company_name: string; debt: string }[]>(
    Prisma.sql`SELECT c.company_name,
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.id, c.company_name
    HAVING SUM(GREATEST(d.amount - d.paid_amount, 0)) > 0
    ORDER BY SUM(GREATEST(d.amount - d.paid_amount, 0)) DESC
    LIMIT 5`
  );
  console.log('\nTop 5 debtors (new formula):');
  for (const d of debtors) {
    console.log(`  ${d.company_name.padEnd(30)} ${Number(d.debt).toLocaleString('ru-RU').padStart(15)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
