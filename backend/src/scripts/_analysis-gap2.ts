/**
 * Supplementary gap analysis: Excel clients with zero CRM debt.
 * Completes the full decomposition of 305M gap.
 * READ-ONLY — no INSERT/UPDATE/DELETE.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

async function main() {
  // Parse Feb 2026 sheet
  const fname = '28.02.2026.xlsx';
  const fpath = path.resolve(process.cwd(), '..', fname);
  const wb = XLSX.readFile(fpath);
  const lastSheet = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[lastSheet];
  const ref = ws['!ref']!;
  const range = XLSX.utils.decode_range(ref);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  const excelClients = new Map<string, number>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = String(row[1] || '').trim().toLowerCase();
    if (!name) continue;
    excelClients.set(name, numVal(row[closingCol]));
  }

  console.log(`Excel Feb 2026 "${lastSheet}": ${excelClients.size} clients`);

  // Get ALL CRM clients (including zero debt)
  const crmAll = await prisma.$queryRaw<{
    company_name: string;
    crm_gross: string;
  }[]>(
    Prisma.sql`SELECT c.company_name,
      COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text AS crm_gross
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
    GROUP BY c.id, c.company_name`
  );

  const crmMap = new Map<string, number>();
  for (const c of crmAll) {
    crmMap.set(c.company_name.trim().toLowerCase(), Number(c.crm_gross));
  }

  console.log(`CRM clients: ${crmMap.size}`);

  // Excel clients with positive closing but zero CRM debt
  let excelOnlyTotal = 0;
  let excelOnlyCount = 0;
  const excelOnlyList: { name: string; closing: number }[] = [];

  for (const [name, closing] of excelClients) {
    if (closing <= 0) continue;
    const crmDebt = crmMap.get(name) ?? 0;
    if (crmDebt < 100) {
      excelOnlyTotal += closing;
      excelOnlyCount++;
      excelOnlyList.push({ name, closing });
    }
  }

  excelOnlyList.sort((a, b) => b.closing - a.closing);

  console.log(`\n=== EXCEL > 0 BUT CRM DEBT = 0: ${excelOnlyCount} clients ===`);
  console.log(`Total Excel closing: ${excelOnlyTotal.toLocaleString('ru-RU')}`);
  console.log(`\n${'Client'.padEnd(40)} ${'Excel Closing'.padStart(15)}`);
  for (const e of excelOnlyList.slice(0, 25)) {
    console.log(`${e.name.padEnd(40)} ${e.closing.toLocaleString('ru-RU').padStart(15)}`);
  }

  // Negative closing in Excel
  let negCount = 0;
  let negTotal = 0;
  for (const [, v] of excelClients) {
    if (v < 0) { negCount++; negTotal += v; }
  }

  // Not in CRM at all
  let notInCrmCount = 0;
  let notInCrmTotal = 0;
  for (const [name, closing] of excelClients) {
    if (closing > 0 && !crmMap.has(name)) {
      notInCrmCount++;
      notInCrmTotal += closing;
      console.log(`  [NOT IN CRM] ${name}: ${closing.toLocaleString('ru-RU')}`);
    }
  }

  // Full decomposition
  const excelTotal = [...excelClients.values()].reduce((s, v) => s + v, 0);
  const crmTotal = crmAll.reduce((s, c) => s + Number(c.crm_gross), 0);

  console.log(`\n=== FULL 305M GAP DECOMPOSITION ===`);
  console.log(`CRM total gross debt:     ${crmTotal.toLocaleString('ru-RU')}`);
  console.log(`Excel total closing:      ${excelTotal.toLocaleString('ru-RU')}`);
  console.log(`Gap (CRM - Excel):        ${(crmTotal - excelTotal).toLocaleString('ru-RU')}`);
  console.log();
  console.log(`Component A: 29 clients where CRM > Excel:`);
  console.log(`  CRM excess:             +1 045 653 945`);
  console.log(`Component B: 5 clients where Excel > CRM:`);
  console.log(`  Excel excess:              -9 809 000`);
  console.log(`Component C: ${excelOnlyCount} Excel clients with CRM debt = 0:`);
  console.log(`  Excel-only debt:        -${excelOnlyTotal.toLocaleString('ru-RU')}`);
  const computed = 1045653945 - 9809000 - excelOnlyTotal;
  console.log(`SUM: 1,045,653,945 - 9,809,000 - ${excelOnlyTotal.toLocaleString('ru-RU')} = ${computed.toLocaleString('ru-RU')}`);
  console.log();
  console.log(`Excel negative balances: ${negCount} clients, total: ${negTotal.toLocaleString('ru-RU')}`);
  console.log(`Excel clients NOT in CRM: ${notInCrmCount}, total: ${notInCrmTotal.toLocaleString('ru-RU')}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
