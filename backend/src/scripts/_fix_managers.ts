/**
 * Fix manager assignments on existing deals by reading Excel data.
 *
 * Problem: MANAGER_LOGIN_MAP had wrong logins, so ~95% of deals
 * were assigned to Farxod (admin) as defaultManagerId.
 *
 * This script reads the Excel, finds correct manager per client per month,
 * then updates deals in the database.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

const COL_CLIENT = 1;
const COL_MANAGER = 3;

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const MANAGER_ALIASES: Record<string, string> = {
  'фотих ака': 'фотих',
};

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

async function main() {
  const xlsxPath = path.resolve(__dirname, '../../../analytics_2026-03-12.xlsx');
  const wb = XLSX.readFile(xlsxPath);
  const year = 2026;

  // Build manager name → user ID map by fullName (case insensitive)
  const allUsers = await prisma.user.findMany({
    select: { id: true, fullName: true, role: true },
  });

  const managerIdMap = new Map<string, string>();
  for (const u of allUsers) {
    managerIdMap.set(u.fullName.toLowerCase(), u.id);
  }
  // Also add known aliases
  managerIdMap.set('фотих ака', managerIdMap.get('фотих') || '');

  console.log('Manager ID map:');
  for (const [name, id] of managerIdMap) {
    if (id) console.log(`  ${name} → ${id}`);
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;

  for (let monthIndex = 0; monthIndex < Math.min(wb.SheetNames.length, 12); monthIndex++) {
    const sheetName = wb.SheetNames[monthIndex];
    const sheet = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

    // Group by client, find manager for each client
    const clientManager = new Map<string, string>();
    for (const row of rows) {
      const clientName = norm(row[COL_CLIENT]);
      if (!clientName) continue;
      const key = clientName.toLowerCase().replace(/\s+/g, ' ').trim();

      if (!clientManager.has(key)) {
        const mgrName = MANAGER_ALIASES[normLower(row[COL_MANAGER])] || normLower(row[COL_MANAGER]);
        if (mgrName) {
          clientManager.set(key, mgrName);
        }
      }
    }

    const monthName = MONTH_NAMES_RU[monthIndex];
    console.log(`\n--- ${monthName} ${year} (${clientManager.size} clients) ---`);

    // Find deals for this month by title pattern "ClientName — MonthName Year"
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

    const deals = await prisma.deal.findMany({
      where: {
        createdAt: { gte: monthStart, lt: monthEnd },
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
      },
      select: { id: true, title: true, managerId: true, client: { select: { companyName: true } } },
    });

    for (const deal of deals) {
      const clientKey = deal.client.companyName.toLowerCase().replace(/\s+/g, ' ').trim();
      const correctMgrName = clientManager.get(clientKey);

      if (!correctMgrName) {
        totalSkipped++;
        continue;
      }

      const correctMgrId = managerIdMap.get(correctMgrName);
      if (!correctMgrId) {
        console.log(`  WARNING: Manager "${correctMgrName}" not found in users for client "${deal.client.companyName}"`);
        totalNotFound++;
        continue;
      }

      if (deal.managerId !== correctMgrId) {
        await prisma.deal.update({
          where: { id: deal.id },
          data: { managerId: correctMgrId },
        });
        totalUpdated++;
      }
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Updated: ${totalUpdated} deals`);
  console.log(`  Skipped (no manager in Excel): ${totalSkipped}`);
  console.log(`  Not found (manager name not in users): ${totalNotFound}`);

  // Verify
  console.log('\n=== Verification: deals per manager per month ===');
  const verify = await prisma.$queryRaw<
    { full_name: string; month: number; deals_count: string; revenue: string }[]
  >(Prisma.sql`SELECT u.full_name,
      EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
      COUNT(d.id)::text as deals_count,
      COALESCE(SUM(d.amount), 0)::text as revenue
    FROM deals d
    JOIN users u ON u.id = d.manager_id
    WHERE d.created_at >= '2026-01-01' AND d.created_at < '2027-01-01'
      AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY u.full_name, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')
    ORDER BY u.full_name, month`);

  for (const r of verify) {
    console.log(`  ${r.full_name} | month=${r.month} | deals=${r.deals_count} | revenue=${Number(r.revenue).toLocaleString('ru-RU')}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
