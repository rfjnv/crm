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
  
  const expectedMap = new Map<string, number>();
  
  for (const row of rows) {
    const clientName = norm(row[1]);
    if (!clientName) continue;
    const clientKey = normalizeClientName(clientName);
    
    expectedMap.set(clientKey, 1); // just record presence
  }

  const clients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  
  let forgottenDebt = 0;
  let forgotCrmGross = 0;
  
  console.log(`Checking CRM debts against clients MISSING from 2025 Excel...`);
  
  for (const client of clients) {
    const key = normalizeClientName(client.companyName);
    
    // Calculate full CRM debt for this client
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } }
    });
    
    const actual = deals.reduce((s, d) => s + (Number(d.amount) - Number(d.paidAmount)), 0);
    const actualGrossPositive = deals.reduce((s, d) => {
        const dd = Number(d.amount) - Number(d.paidAmount);
        return dd > 0 ? s + dd : s;
    }, 0);
    
    // If client has a non-zero debt in CRM but doesn't exist AT ALL in Dec 2025 Excel
    if (Math.abs(actual) > 1 && !expectedMap.has(key)) {
      console.log(`❌ Forgotten in Excel: ${client.companyName.padEnd(30)} | Still owes CRM: ${actual} (Gross Pos: ${actualGrossPositive})`);
      forgottenDebt += actual;
      forgotCrmGross += actualGrossPositive;
    }
  }
  
  console.log(`\nTotal CRM Net Debt "forgotten" by Dec 2025 Excel: ${Math.round(forgottenDebt)}`);
  console.log(`Total CRM Gross Debt "forgotten" by Dec 2025 Excel: ${Math.round(forgotCrmGross)}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
