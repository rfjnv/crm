/**
 * Section C: Monthly cashflow CSV (Jan 2025 – Feb 2026).
 * READ-ONLY — no INSERT/UPDATE/DELETE.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('=== SECTION C: MONTHLY CASHFLOW ===\n');

  const reportsDir = path.resolve(process.cwd(), '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  // Generate months from Jan 2025 to Feb 2026 (14 months)
  const months: { year: number; month: number; label: string }[] = [];
  for (let m = 1; m <= 12; m++) months.push({ year: 2025, month: m, label: `2025-${String(m).padStart(2, '0')}` });
  months.push({ year: 2026, month: 1, label: '2026-01' });
  months.push({ year: 2026, month: 2, label: '2026-02' });

  const results: {
    label: string;
    opening: number;
    new_sales: number;
    payments_received: number;
    closing: number;
  }[] = [];

  for (const m of months) {
    const monthStart = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
    const nextMonth = m.month === 12 ? `${m.year + 1}-01-01` : `${m.year}-${String(m.month + 1).padStart(2, '0')}-01`;

    // Opening balance: SUM(GREATEST(amount - paid_before_month_start, 0)) for deals created before month start
    const opening = await prisma.$queryRaw<{ val: string }[]>(
      Prisma.sql`
      WITH dp AS (
        SELECT d.id, d.amount AS deal_amount,
               COALESCE(SUM(p.amount) FILTER (WHERE p.paid_at < ${monthStart}::timestamptz AT TIME ZONE 'Asia/Tashkent'), 0) AS paid_before
        FROM deals d
        LEFT JOIN payments p ON p.deal_id = d.id
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')
          AND d.created_at < ${monthStart}::timestamptz AT TIME ZONE 'Asia/Tashkent'
        GROUP BY d.id, d.amount
      )
      SELECT COALESCE(SUM(GREATEST(deal_amount - paid_before, 0)), 0)::text AS val FROM dp`
    );

    // New sales: deals created within the month
    const sales = await prisma.$queryRaw<{ val: string }[]>(
      Prisma.sql`
      SELECT COALESCE(SUM(d.amount), 0)::text AS val
      FROM deals d
      WHERE d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.created_at >= ${monthStart}::timestamptz AT TIME ZONE 'Asia/Tashkent'
        AND d.created_at < ${nextMonth}::timestamptz AT TIME ZONE 'Asia/Tashkent'`
    );

    // Payments received in the month
    const payments = await prisma.$queryRaw<{ val: string }[]>(
      Prisma.sql`
      SELECT COALESCE(SUM(p.amount), 0)::text AS val
      FROM payments p
      WHERE p.paid_at >= ${monthStart}::timestamptz AT TIME ZONE 'Asia/Tashkent'
        AND p.paid_at < ${nextMonth}::timestamptz AT TIME ZONE 'Asia/Tashkent'`
    );

    // Closing balance
    const closing = await prisma.$queryRaw<{ val: string }[]>(
      Prisma.sql`
      WITH dp AS (
        SELECT d.id, d.amount AS deal_amount,
               COALESCE(SUM(p.amount) FILTER (WHERE p.paid_at < ${nextMonth}::timestamptz AT TIME ZONE 'Asia/Tashkent'), 0) AS paid_before
        FROM deals d
        LEFT JOIN payments p ON p.deal_id = d.id
        WHERE d.is_archived = false
          AND d.status NOT IN ('CANCELED','REJECTED')
          AND d.created_at < ${nextMonth}::timestamptz AT TIME ZONE 'Asia/Tashkent'
        GROUP BY d.id, d.amount
      )
      SELECT COALESCE(SUM(GREATEST(deal_amount - paid_before, 0)), 0)::text AS val FROM dp`
    );

    const row = {
      label: m.label,
      opening: Number(opening[0].val),
      new_sales: Number(sales[0].val),
      payments_received: Number(payments[0].val),
      closing: Number(closing[0].val),
    };
    results.push(row);

    console.log(`${row.label}  open=${row.opening.toLocaleString('ru-RU').padStart(18)} sales=${row.new_sales.toLocaleString('ru-RU').padStart(15)} pay=${row.payments_received.toLocaleString('ru-RU').padStart(15)} close=${row.closing.toLocaleString('ru-RU').padStart(18)}`);
  }

  // Write CSV
  const csvHeader = 'month,opening_balance,new_sales,payments_received,closing_balance';
  const csvRows = results.map(r =>
    `${r.label},${r.opening},${r.new_sales},${r.payments_received},${r.closing}`
  );
  const csvPath = path.join(reportsDir, 'monthly_cashflow.csv');
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log(`\nWritten: ${csvPath}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
