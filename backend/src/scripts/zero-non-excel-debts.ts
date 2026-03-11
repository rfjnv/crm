/**
 * zero-non-excel-debts.ts
 *
 * For all clients NOT in the Excel sync list (10.03.2026.xlsx with marks к,н/к,п/к,ф,пп),
 * set deal.paidAmount = deal.amount and paymentStatus = 'PAID'.
 * This zeros out their debt since they are not debtors per Excel.
 *
 * Usage:
 *   DRY RUN:  npx tsx src/scripts/zero-non-excel-debts.ts
 *   APPLY:    npx tsx src/scripts/zero-non-excel-debts.ts --apply
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const SYNC_MARKS = new Set(['к', 'н/к', 'п/к', 'ф', 'пп']);

async function main() {
  console.log(`\n=== ZERO NON-EXCEL DEBTS ${APPLY ? '*** APPLY ***' : '(dry run)'} ===\n`);

  // 1. Read Excel to get synced client names
  const fpath = path.resolve(process.cwd(), '..', '10.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  const excelSyncNames = new Set<string>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = normalizeClientName(row[1]);
    if (!name) continue;
    const mark = String(row[9] || '').trim().toLowerCase();
    if (SYNC_MARKS.has(mark)) excelSyncNames.add(name);
  }
  console.log(`Excel sync clients (with debt/prepay marks): ${excelSyncNames.size}`);

  // 2. Get all CRM clients
  const allClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });

  // 3. Find clients NOT in Excel sync
  const nonExcelClientIds: string[] = [];
  for (const c of allClients) {
    const norm = normalizeClientName(c.companyName);
    if (!excelSyncNames.has(norm)) {
      nonExcelClientIds.push(c.id);
    }
  }
  console.log(`CRM clients NOT in Excel sync: ${nonExcelClientIds.length}`);

  // 4. Find their deals with non-zero debt
  const dealsToFix = await prisma.$queryRaw<
    { id: string; amount: string; paid_amount: string; title: string; client_name: string }[]
  >(
    Prisma.sql`
      SELECT d.id, d.amount::text, d.paid_amount::text, d.title, c.company_name as client_name
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.client_id IN (${Prisma.join(nonExcelClientIds)})
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED', 'REJECTED')
        AND ABS(d.amount - d.paid_amount) > 0.01
    `
  );

  let totalDebtToZero = 0;
  let totalPrepayToZero = 0;
  for (const d of dealsToFix) {
    const diff = Number(d.amount) - Number(d.paid_amount);
    if (diff > 0) totalDebtToZero += diff;
    else totalPrepayToZero += Math.abs(diff);
  }

  console.log(`Deals with non-zero balance: ${dealsToFix.length}`);
  console.log(`  Debt to zero out: ${totalDebtToZero.toLocaleString()}`);
  console.log(`  Overpayments to zero out: ${totalPrepayToZero.toLocaleString()}`);

  // Show top 20 by debt
  const sorted = [...dealsToFix]
    .map(d => ({ ...d, debt: Number(d.amount) - Number(d.paid_amount) }))
    .sort((a, b) => Math.abs(b.debt) - Math.abs(a.debt));

  console.log(`\nTop 20 deals to zero:`);
  for (const d of sorted.slice(0, 20)) {
    console.log(`  ${d.client_name.substring(0, 25).padEnd(25)} | ${d.title.substring(0, 25).padEnd(25)} | debt: ${d.debt.toLocaleString()}`);
  }

  if (!APPLY) {
    console.log('\n*** DRY RUN — no changes. Run with --apply ***\n');

    // Show what totals would look like
    const current = await prisma.$queryRaw<{ gross: string; prepay: string }[]>(
      Prisma.sql`
        SELECT
          COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
          COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as prepay
        FROM deals d
        WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      `
    );
    const gross = Number(current[0].gross);
    const prepay = Number(current[0].prepay);
    console.log(`Current:  gross=${gross.toLocaleString()}, prepay=${prepay.toLocaleString()}, net=${(gross - prepay).toLocaleString()}`);
    console.log(`After:    gross=${(gross - totalDebtToZero).toLocaleString()}, prepay=${(prepay - totalPrepayToZero).toLocaleString()}, net=${(gross - totalDebtToZero - prepay + totalPrepayToZero).toLocaleString()}`);
    console.log(`Target:   gross=1,221,993,663, prepay=241,058,500, net=983,502,063`);
    return;
  }

  // 5. Apply: set paidAmount = amount for all these deals
  console.log('\nApplying...');
  const BATCH = 100;
  let updated = 0;

  for (let i = 0; i < dealsToFix.length; i += BATCH) {
    const batch = dealsToFix.slice(i, i + BATCH);
    const ids = batch.map(d => d.id);

    // Set paidAmount = amount, paymentStatus = PAID
    await prisma.$executeRaw`
      UPDATE deals
      SET paid_amount = amount, payment_status = 'PAID'
      WHERE id IN (${Prisma.join(ids)})
    `;
    updated += ids.length;

    if (updated % 500 === 0 || i + BATCH >= dealsToFix.length) {
      console.log(`  Updated ${updated}/${dealsToFix.length} deals`);
    }
  }

  // 6. Verify
  const after = await prisma.$queryRaw<{ gross: string; prepay: string }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as gross,
        COALESCE(SUM(GREATEST(d.paid_amount - d.amount, 0)), 0)::text as prepay
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
    `
  );
  const g = Number(after[0].gross);
  const p = Number(after[0].prepay);
  console.log(`\n=== AFTER ===`);
  console.log(`  Gross debt:   ${g.toLocaleString()}`);
  console.log(`  Prepayments:  ${p.toLocaleString()}`);
  console.log(`  Net debt:     ${(g - p).toLocaleString()}`);
  console.log(`  Target:       gross=1,221,993,663 prepay=241,058,500 net=983,502,063`);
  console.log(`  Done!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
