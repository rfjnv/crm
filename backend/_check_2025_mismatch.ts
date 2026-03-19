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
    
    const opType = mapOpType(row[9]);
    const balRaw = row[closingBalanceCol];
    
    if (balRaw != null && ['K', 'NK', 'PK', 'F', 'PP'].includes(opType || '')) {
      expectedMap.set(clientKey, (expectedMap.get(clientKey) || 0) + numVal(balRaw));
    }
  }

  const clients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  
  let match = 0;
  let mismatch = 0;
  let crmTooHigh = 0;
  
  console.log(`Checking ${clients.length} clients against Dec 2025 expected...`);
  
  for (const client of clients) {
    const key = normalizeClientName(client.companyName);
    
    const deals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } }
    });
    
    const actual = deals.reduce((s, d) => s + (Number(d.amount) - Number(d.paidAmount)), 0);
    
    // Only compare if expected exists (meaning they had activity in 2025)
    // Wait, some 2024 clients might have NO activity in 2025. Then their expected=0 ? No, their expected = actual from 2024.
    // If they have no activity in Dec 2025, their AA in Dec 2025 is 0? 
    // IF they had activity in 2025, check mismatch.
    if (expectedMap.has(key)) {
      const expected = expectedMap.get(key) || 0;
      const diff = Math.round(actual - expected);
      
      if (Math.abs(diff) > 1) {
        console.log(`❌ ${client.companyName.padEnd(30)} CRM: ${String(actual).padStart(15)} | Excel: ${String(expected).padStart(15)} | Diff: ${diff}`);
        mismatch++;
        crmTooHigh += diff;
      } else {
        match++;
      }
    }
  }
  
  console.log(`\nMatches: ${match}`);
  console.log(`Mismatches: ${mismatch}`);
  console.log(`CRM is off by a net total of: ${crmTooHigh}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
