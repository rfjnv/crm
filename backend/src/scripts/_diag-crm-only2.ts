import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

async function main() {
  // Read Excel to get list of synced clients
  const fpath = path.resolve(process.cwd(), '..', '07.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  const SYNC_MARKS = new Set(['к', 'н/к', 'п/к', 'ф', 'пп']);
  const excelClients = new Set<string>();

  // Collect ALL excel client names (not just sync marks)
  const allExcelClients = new Set<string>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = normalizeClientName(row[1]);
    if (!name) continue;
    allExcelClients.add(name);
    const mark = String(row[9] || '').trim().toLowerCase();
    if (SYNC_MARKS.has(mark)) excelClients.add(name);
  }

  console.log(`Excel sync clients (with marks): ${excelClients.size}`);
  console.log(`All Excel clients (any mark): ${allExcelClients.size}`);

  // Get all CRM clients with active debt
  const crmClients = await prisma.$queryRaw<{client_id: string, company_name: string, deal_count: string, net: string}[]>(
    Prisma.sql`
      SELECT c.id as client_id, c.company_name, COUNT(d.id)::text as deal_count,
        COALESCE(SUM(d.amount - d.paid_amount), 0)::text as net
      FROM deals d JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
      GROUP BY c.id, c.company_name
      HAVING ABS(SUM(d.amount - d.paid_amount)) > 1000
      ORDER BY SUM(d.amount - d.paid_amount) DESC
    `
  );

  // Classify: in excel sync, in excel but no sync mark, CRM-only
  let inExcelSync = 0, inExcelSyncDebt = 0;
  let inExcelNoSync = 0, inExcelNoSyncDebt = 0;
  let crmOnly = 0, crmOnlyDebt = 0;
  const crmOnlyList: {name: string, debt: number, deals: number}[] = [];

  for (const c of crmClients) {
    const norm = normalizeClientName(c.company_name);
    const debt = Number(c.net);
    const deals = Number(c.deal_count);

    if (excelClients.has(norm)) {
      inExcelSync++;
      inExcelSyncDebt += debt;
    } else if (allExcelClients.has(norm)) {
      inExcelNoSync++;
      inExcelNoSyncDebt += debt;
      if (Math.abs(debt) > 5000000) {
        crmOnlyList.push({ name: c.company_name, debt, deals });
      }
    } else {
      crmOnly++;
      crmOnlyDebt += debt;
      if (Math.abs(debt) > 5000000) {
        crmOnlyList.push({ name: c.company_name, debt, deals });
      }
    }
  }

  console.log(`\n=== CLIENT CLASSIFICATION ===`);
  console.log(`In Excel (sync marks):     ${inExcelSync} clients, debt: ${inExcelSyncDebt.toLocaleString()}`);
  console.log(`In Excel (no sync marks):  ${inExcelNoSync} clients, debt: ${inExcelNoSyncDebt.toLocaleString()}`);
  console.log(`CRM-only (not in Excel):   ${crmOnly} clients, debt: ${crmOnlyDebt.toLocaleString()}`);
  console.log(`\nTotal remaining debt: ${(inExcelSyncDebt + inExcelNoSyncDebt + crmOnlyDebt).toLocaleString()}`);

  console.log(`\nClients NOT in Excel sync with debt > 5M:`);
  crmOnlyList.sort((a, b) => Math.abs(b.debt) - Math.abs(a.debt));
  for (const c of crmOnlyList.slice(0, 30)) {
    console.log(`  ${c.name.substring(0, 35).padEnd(35)} | ${c.deals} deals | debt: ${c.debt.toLocaleString()}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
