/**
 * Sync CRM debts to match Excel column AB (closing balance) from March sheet.
 *
 * Logic:
 *   - Column J = operation type (к, н/к, п/к, ф = debt; пп = prepay; н, п, т = cash)
 *   - Column AB (29-col sheets) or AA (28-col sheets) = balance amount per row
 *   - Per-client debt = SUM of their AB values on the March sheet
 *
 * Run: cd backend && npx tsx src/scripts/_sync_debts_to_excel.ts [--dry-run]
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  SYNC DEBTS CRM <-> Excel (column AB)');
  console.log('  ' + (DRY_RUN ? '*** DRY RUN ***' : '*** LIVE RUN ***'));
  console.log('='.repeat(60) + '\n');

  // 1. Read Excel — use LAST sheet (March = freshest data)
  const excelPath = path.resolve(__dirname, '../../../analytics_2026-03-12.xlsx');
  const wb = XLSX.readFile(excelPath);
  const lastIdx = wb.SheetNames.length - 1;
  const ws = wb.Sheets[wb.SheetNames[lastIdx]];
  const ref = ws['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 29;
  const balCol = totalCols <= 28 ? 26 : 27; // AA for 28-col, AB for 29-col

  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  console.log(`Excel: "${wb.SheetNames[lastIdx]}", ${totalCols} cols, balance col=${balCol}`);

  // 2. Sum column AB per client
  const excelDebts = new Map<string, { name: string; total: number; debtOnly: number; prepay: number }>();
  const DEBT_TYPES = ['к', 'н/к', 'п/к', 'ф'];

  for (const row of rows) {
    const clientName = norm(row[1]);
    if (!clientName) continue;
    const key = normalizeClientName(clientName);
    const j = norm(row[9]).toLowerCase();
    const bal = numVal(row[balCol]);

    if (!excelDebts.has(key)) {
      excelDebts.set(key, { name: clientName, total: 0, debtOnly: 0, prepay: 0 });
    }
    const cd = excelDebts.get(key)!;
    cd.total += bal;
    if (DEBT_TYPES.includes(j)) cd.debtOnly += bal;
    if (j === 'пп') cd.prepay += bal;
  }

  // Filter to clients with non-zero balance
  const excelWithBalance = new Map<string, { name: string; total: number; debtOnly: number; prepay: number }>();
  for (const [key, val] of excelDebts) {
    if (Math.abs(val.total) >= 1) excelWithBalance.set(key, val);
  }

  const excelTotal = [...excelWithBalance.values()].reduce((s, v) => s + v.total, 0);
  console.log(`Excel clients with balance: ${excelWithBalance.size}, total: ${excelTotal.toLocaleString('ru-RU')}\n`);

  // 3. Get CRM per-client net balance
  const crmDebts: any[] = await prisma.$queryRawUnsafe(`
    SELECT c.id as client_id, c.company_name,
      (SUM(d.amount) - SUM(d.paid_amount))::numeric as debt
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.status NOT IN ('CANCELED', 'REJECTED') AND d.is_archived = false
    GROUP BY c.id, c.company_name
  `);

  const crmMap = new Map<string, { client_id: string; company_name: string; debt: number }>();
  for (const r of crmDebts) {
    crmMap.set(normalizeClientName(r.company_name), {
      client_id: r.client_id,
      company_name: r.company_name,
      debt: Number(r.debt),
    });
  }

  // Client lookup
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const clientByNorm = new Map<string, string>();
  for (const c of allClients) clientByNorm.set(normalizeClientName(c.companyName), c.id);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const managerId = admin?.id || '';

  let zeroed = 0, adjusted = 0, created = 0, skipped = 0, alreadyOk = 0;

  // 4a. CRM clients: compare with Excel
  for (const [key, crm] of crmMap) {
    const excel = excelWithBalance.get(key);
    const excelBalance = excel?.total ?? 0;
    const diff = Math.abs(crm.debt - excelBalance);
    if (diff < 1) { alreadyOk++; continue; }

    if (excelBalance === 0 && crm.debt !== 0) {
      console.log(`  ZERO:   ${crm.company_name.padEnd(30)} CRM: ${crm.debt.toLocaleString('ru-RU').padStart(15)} -> 0`);
      if (!DRY_RUN) {
        await prisma.$executeRawUnsafe(`
          UPDATE deals SET paid_amount = amount, payment_status = 'PAID'
          WHERE client_id = $1 AND status NOT IN ('CANCELED','REJECTED')
            AND is_archived = false AND paid_amount != amount
        `, crm.client_id);
      }
      zeroed++;
    } else {
      console.log(`  ADJUST: ${crm.company_name.padEnd(30)} CRM: ${crm.debt.toLocaleString('ru-RU').padStart(15)} -> Excel: ${excelBalance.toLocaleString('ru-RU').padStart(15)}`);
      if (!DRY_RUN) {
        // Zero all deals first
        await prisma.$executeRawUnsafe(`
          UPDATE deals SET paid_amount = amount, payment_status = 'PAID'
          WHERE client_id = $1 AND status NOT IN ('CANCELED','REJECTED') AND is_archived = false
        `, crm.client_id);
        // Delete old sverka deals (payments -> deal_items -> deals)
        await prisma.$executeRawUnsafe(`
          DELETE FROM payments WHERE deal_id IN (SELECT id FROM deals WHERE client_id = $1 AND title LIKE 'Сверка:%')
        `, crm.client_id);
        await prisma.$executeRawUnsafe(`
          DELETE FROM deal_items WHERE deal_id IN (SELECT id FROM deals WHERE client_id = $1 AND title LIKE 'Сверка:%')
        `, crm.client_id);
        await prisma.$executeRawUnsafe(`
          DELETE FROM deals WHERE client_id = $1 AND title LIKE 'Сверка:%'
        `, crm.client_id);
        // Create correct sverka deal
        if (excelBalance > 0) {
          await prisma.deal.create({
            data: {
              title: `Сверка: долг по Excel (${crm.company_name})`,
              status: 'CLOSED', amount: Math.round(excelBalance * 100) / 100,
              paidAmount: 0, paymentStatus: 'UNPAID', paymentType: 'FULL',
              clientId: crm.client_id, managerId,
            },
          });
        } else {
          await prisma.deal.create({
            data: {
              title: `Сверка: переплата по Excel (${crm.company_name})`,
              status: 'CLOSED', amount: 0,
              paidAmount: Math.round(Math.abs(excelBalance) * 100) / 100,
              paymentStatus: 'PAID', paymentType: 'FULL',
              clientId: crm.client_id, managerId,
            },
          });
        }
      }
      adjusted++;
    }
  }

  // 4b. Clients in Excel but not in CRM (or 0 in CRM)
  for (const [key, excel] of excelWithBalance) {
    if (crmMap.has(key)) continue;
    const clientId = clientByNorm.get(key);
    if (!clientId) {
      console.log(`  SKIP:   ${excel.name.padEnd(30)} - not found in CRM`);
      skipped++;
      continue;
    }

    console.log(`  CREATE: ${excel.name.padEnd(30)} Excel: ${excel.total.toLocaleString('ru-RU').padStart(15)}`);
    if (!DRY_RUN) {
      // Delete any old sverka
      await prisma.$executeRawUnsafe(`DELETE FROM payments WHERE deal_id IN (SELECT id FROM deals WHERE client_id = $1 AND title LIKE 'Сверка:%')`, clientId);
      await prisma.$executeRawUnsafe(`DELETE FROM deal_items WHERE deal_id IN (SELECT id FROM deals WHERE client_id = $1 AND title LIKE 'Сверка:%')`, clientId);
      await prisma.$executeRawUnsafe(`DELETE FROM deals WHERE client_id = $1 AND title LIKE 'Сверка:%'`, clientId);
      if (excel.total > 0) {
        await prisma.deal.create({
          data: {
            title: `Сверка: долг по Excel (${excel.name})`,
            status: 'CLOSED', amount: Math.round(excel.total * 100) / 100,
            paidAmount: 0, paymentStatus: 'UNPAID', paymentType: 'FULL',
            clientId, managerId,
          },
        });
      } else {
        await prisma.deal.create({
          data: {
            title: `Сверка: переплата по Excel (${excel.name})`,
            status: 'CLOSED', amount: 0,
            paidAmount: Math.round(Math.abs(excel.total) * 100) / 100,
            paymentStatus: 'PAID', paymentType: 'FULL',
            clientId, managerId,
          },
        });
      }
    }
    created++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('  RESULT:');
  console.log(`    Already OK: ${alreadyOk}`);
  console.log(`    Zeroed: ${zeroed}`);
  console.log(`    Adjusted: ${adjusted}`);
  console.log(`    Created: ${created}`);
  console.log(`    Skipped: ${skipped}`);
  console.log('='.repeat(60));
}

main()
  .catch((e) => { console.error('Failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
