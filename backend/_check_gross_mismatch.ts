import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';
import { normalizeClientName } from './src/lib/normalize-client';

const prisma = new PrismaClient();

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function mapOpType(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const mapping: Record<string, string> = {
    'к': 'K', 'н': 'N', 'н/к': 'NK', 'п': 'P', 'п/к': 'PK',
    'пп': 'PP', 'обмен': 'EXCHANGE', 'ф': 'F',
  };
  return mapping[raw] ?? 'UNKNOWN';
}

async function check() {
  const filePath = path.resolve(process.cwd(), 'data/analytics_2025-12-29.xlsx');
  const wb = XLSX.readFile(filePath);
  
  // Find December 2025 sheet
  const decIndex = wb.SheetNames.findIndex(n => n.toLowerCase().includes('декабрь'));
  const sheet = wb.Sheets[wb.SheetNames[decIndex !== -1 ? decIndex : 11]];
  
  const ref = sheet['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
  const closingBalanceCol = totalCols - 2; // AA
  
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
  
  const expectedNetMap = new Map<string, number>();
  
  for (const row of rows) {
    const clientName = norm(row[1]);
    if (!clientName) continue;
    const clientKey = normalizeClientName(clientName);
    
    const opType = mapOpType(row[9]);
    const balRaw = row[closingBalanceCol];
    
    if (balRaw != null && ['K', 'NK', 'PK', 'F', 'PP'].includes(opType || '')) {
      expectedNetMap.set(clientKey, (expectedNetMap.get(clientKey) || 0) + numVal(balRaw));
    }
  }

  const clients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  
  let totalCrmGross = 0;
  let totalExcelGross = 0;
  
  console.log(`Checking CRM GROSS debts against Dec 2025 expected...`);
  
  for (const client of clients) {
    const key = normalizeClientName(client.companyName);
    
    // CRM Gross: sum of all unpaid positive deals
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } }
    });
    
    let crmGross = 0;
    for (const d of deals) {
      const debt = Number(d.amount) - Number(d.paidAmount);
      if (debt > 0) crmGross += debt;
    }
    
    // Excel Gross: because Excel AA is naturally NETTED per row (per client in December),
    // the "Gross" debt in Excel for a client is just their AA balance IF it is positive.
    // If it's negative, their Excel gross is 0 (it's a prepayment).
    let excelGross = 0;
    if (expectedNetMap.has(key)) {
      const aaNet = expectedNetMap.get(key) || 0;
      if (aaNet > 0) {
        excelGross = aaNet;
      }
    }
    
    totalCrmGross += crmGross;
    totalExcelGross += excelGross;
    
    const diff = Math.round(crmGross - excelGross);
    
    if (Math.abs(diff) > 1 && expectedNetMap.has(key)) {
      console.log(`❌ Diff Gross: ${client.companyName.padEnd(30)} CRM: ${String(crmGross).padStart(15)} | Excel: ${String(excelGross).padStart(15)} | Diff: ${diff}`);
    }
  }
  
  console.log(`\nTotal CRM GROSS Debt (excluding forgotten clients): ${Math.round(totalCrmGross)}`);
  console.log(`Total Excel GROSS Debt: ${Math.round(totalExcelGross)}`);
  console.log(`Difference (CRM - Excel): ${Math.round(totalCrmGross - totalExcelGross)}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
