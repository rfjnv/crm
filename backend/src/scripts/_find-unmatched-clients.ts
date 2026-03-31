import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { normalizeClientName } from '../lib/normalize-client';

const prisma = new PrismaClient();

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

async function main() {
  // Read Excel
  const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');
  const ws = wb.Sheets[wb.SheetNames[2]]; // March
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  const debtTypes = ['к','н/к','п/к','ф'];
  const ppTypes = ['пп'];

  // Build all CRM clients
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const crmByNorm = new Map<string, string>();
  for (const c of allClients) {
    crmByNorm.set(normalizeClientName(c.companyName), c.id);
  }

  // Check each row
  let matched = 0, unmatched = 0;
  let matchedAB = 0, unmatchedAB = 0;
  const unmatchedNames = new Set<string>();

  for (const row of rows) {
    const clientName = norm(row[1]);
    if (!clientName) continue;
    const key = normalizeClientName(row[1]);
    const ab = typeof row[27] === 'number' ? row[27] : 0;
    const opType = String(row[9] || '').trim().toLowerCase();
    const isDebt = debtTypes.includes(opType) || ppTypes.includes(opType);

    if (crmByNorm.has(key)) {
      matched++;
      if (isDebt) matchedAB += ab;
    } else {
      unmatched++;
      if (isDebt) {
        unmatchedAB += ab;
        unmatchedNames.add(clientName);
      }
    }
  }

  console.log(`Matched rows: ${matched}, Unmatched: ${unmatched}`);
  console.log(`Matched AB (debt types): ${matchedAB.toLocaleString('ru-RU')}`);
  console.log(`Unmatched AB (debt types): ${unmatchedAB.toLocaleString('ru-RU')}`);
  console.log(`Unmatched client names with debt:`, [...unmatchedNames]);
}

main().catch(console.error).finally(() => prisma.$disconnect());
