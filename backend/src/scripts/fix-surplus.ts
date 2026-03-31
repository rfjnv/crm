/**
 * Fix surplus: Remove excess "Импорт из Excel" payments for clients
 * where CRM total payments > Excel total payments.
 *
 * Only removes payments with note starting with "Импорт из Excel"
 * (just-created payments), to trim CRM to match Excel.
 *
 * Run:
 *   npx tsx src/scripts/fix-surplus.ts              # dry-run
 *   npx tsx src/scripts/fix-surplus.ts --execute    # apply
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'PAYME', 'TERMINAL'] as const;
const EXCEL_FILES = [
  { name: 'analytics_2024-12-26.xlsx', defaultYear: 2024 },
  { name: 'analytics_2025-12-29.xlsx', defaultYear: 2025 },
  { name: 'analytics_2026-03-12.xlsx', defaultYear: 2026 },
];

type Row = unknown[];

function numVal(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function normLower(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

function getPaymentCols(data: Row[]): { index: number; method: string }[] {
  const h1 = data[1] as Row | undefined;
  const isShifted = h1 ? normLower(h1[11]).includes('договор') : false;
  if (isShifted) {
    return [
      { index: 13, method: 'CASH' }, { index: 16, method: 'TRANSFER' },
      { index: 19, method: 'QR' }, { index: 22, method: 'PAYME' }, { index: 25, method: 'TERMINAL' },
    ];
  }
  return [
    { index: 12, method: 'CASH' }, { index: 15, method: 'TRANSFER' },
    { index: 18, method: 'QR' }, { index: 21, method: 'PAYME' }, { index: 24, method: 'TERMINAL' },
  ];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  FIX SURPLUS: ${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY-RUN'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Parse Excel: per-client total payments (all years)
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const excelClientTotals = new Map<string, { rawName: string; total: number }>();

  for (const file of EXCEL_FILES) {
    const fpath = path.join(projectRoot, file.name);
    let wb: XLSX.WorkBook;
    try { wb = XLSX.readFile(fpath); } catch { continue; }

    for (const sheetName of wb.SheetNames) {
      const sn = sheetName.toLowerCase().trim();
      if (sn === 'лист1' || sn === 'лист2') continue;
      let monthIdx = -1;
      for (let i = 0; i < MONTH_NAMES.length; i++) {
        if (sn.startsWith(MONTH_NAMES[i])) { monthIdx = i; break; }
      }
      if (monthIdx < 0) continue;

      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Row[];
      const cols = getPaymentCols(data);

      for (let r = 3; r < data.length; r++) {
        const row = data[r];
        if (!row) continue;
        const rawName = String(row[1] || '').trim();
        if (!rawName) continue;
        if (normLower(row[9]) === 'обмен') continue;
        const key = normalizeClientName(rawName);
        if (!key) continue;

        for (const pc of cols) {
          const amt = numVal(row[pc.index]);
          if (amt > 0) {
            if (!excelClientTotals.has(key)) excelClientTotals.set(key, { rawName, total: 0 });
            excelClientTotals.get(key)!.total += amt;
          }
        }
      }
    }
  }
  console.log(`  Excel clients: ${excelClientTotals.size}`);

  // Match to CRM
  const allCrm = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmNorm = new Map<string, { id: string; name: string }>();
  for (const c of allCrm) crmNorm.set(normalizeClientName(c.companyName), { id: c.id, name: c.companyName });

  // Get CRM total payments per client
  const crmPayments = await prisma.$queryRaw<{ client_id: string; total: string }[]>(
    Prisma.sql`SELECT d.client_id, SUM(p.amount)::text as total
    FROM payments p JOIN deals d ON d.id = p.deal_id
    GROUP BY d.client_id`
  );
  const crmClientTotals = new Map<string, number>();
  for (const r of crmPayments) crmClientTotals.set(r.client_id, Number(r.total));

  // Find surplus clients
  let totalSurplus = 0;
  let totalToDelete = 0;
  const surplusClients: { clientId: string; name: string; crmTotal: number; excelTotal: number; surplus: number }[] = [];

  for (const [excelKey, excelData] of excelClientTotals) {
    const crm = crmNorm.get(excelKey);
    if (!crm) continue;

    const crmTotal = crmClientTotals.get(crm.id) || 0;
    const excelTotal = excelData.total;
    const surplus = crmTotal - excelTotal;

    if (surplus > 100) {
      surplusClients.push({
        clientId: crm.id, name: crm.name,
        crmTotal, excelTotal, surplus,
      });
      totalSurplus += surplus;
    }
  }

  surplusClients.sort((a, b) => b.surplus - a.surplus);
  console.log(`  Surplus clients: ${surplusClients.length}`);
  console.log(`  Total surplus: ${fmt(totalSurplus)}\n`);

  // For each surplus client, find "Импорт из Excel" payments to delete
  // Delete newest imports first until surplus is resolved
  let grandDeleted = 0;
  let grandDeletedAmt = 0;

  for (const sc of surplusClients) {
    // Get import payments for this client, newest first
    const importPayments = await prisma.$queryRaw<{ id: string; amount: string; note: string; paid_at: string }[]>(
      Prisma.sql`SELECT p.id, p.amount::text, p.note, p.paid_at::text
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.client_id = ${sc.clientId}
        AND p.note LIKE 'Импорт из Excel%'
      ORDER BY p.paid_at DESC`
    );

    let remaining = sc.surplus;
    const toDelete: string[] = [];

    for (const ip of importPayments) {
      if (remaining <= 0) break;
      const amt = Number(ip.amount);
      toDelete.push(ip.id);
      remaining -= amt;
    }

    if (toDelete.length > 0) {
      const deleteAmt = sc.surplus - Math.max(remaining, 0);
      console.log(
        `  ${sc.name.substring(0, 28).padEnd(28)} | surplus=${fmt(sc.surplus).padStart(14)} | ` +
        `delete ${toDelete.length} imports (${fmt(deleteAmt)})`
      );

      if (EXECUTE) {
        await prisma.payment.deleteMany({
          where: { id: { in: toDelete } },
        });
      }

      grandDeleted += toDelete.length;
      grandDeletedAmt += deleteAmt;
    } else {
      // No import payments to delete — surplus is from original data, skip
      console.log(
        `  ${sc.name.substring(0, 28).padEnd(28)} | surplus=${fmt(sc.surplus).padStart(14)} | ` +
        `no "Импорт" payments to remove (original data)`
      );
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Total payments to delete: ${grandDeleted} (${fmt(grandDeletedAmt)})`);
  console.log(`  Remaining surplus (original data): ${fmt(totalSurplus - grandDeletedAmt)}`);

  if (EXECUTE) {
    console.log(`\n  ✅ Deleted ${grandDeleted} excess import payments.`);

    // Verify
    console.log('\n═══ Post-fix verification ═══');
    for (const year of [2025, 2026]) {
      const start = new Date(`${year - 1}-12-31T19:00:00Z`);
      const end = new Date(`${year}-12-31T19:00:00Z`);
      const rev = await prisma.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(p.amount), 0)::text as total
        FROM payments p
        WHERE p.paid_at >= ${start} AND p.paid_at < ${end}`
      );
      console.log(`  ${year} CRM revenue: ${fmt(Number(rev[0].total))}`);
    }
  } else {
    console.log('\n  ℹ️  DRY-RUN. Run with --execute to apply.');
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
