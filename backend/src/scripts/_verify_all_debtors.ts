/**
 * Verify ALL debtors: compare CRM deal balances with Excel closingBalance per client.
 *
 * Run: cd backend && npx tsx src/scripts/_verify_all_debtors.ts
 */
import * as XLSX from 'xlsx';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const OP_TYPE_MAP: Record<string, string> = {
  'к': 'K', 'н': 'N', 'н/к': 'NK', 'п': 'P', 'п/к': 'PK',
  'пп': 'PP', 'обмен': 'EXCHANGE', 'ф': 'F',
};
const DEBT_TYPES = new Set(['K', 'NK', 'PK', 'F', 'PP']);

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

async function main() {
  // 1. Read Excel - March 2026 sheet (index 2)
  const wb = XLSX.readFile('../analytics_2026-03-12.xlsx');
  const ws = wb.Sheets[wb.SheetNames[2]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });

  // Detect layout
  const ref = ws['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 29;
  const closingBalanceCol = totalCols - 2; // AB column

  // Build per-client debt from Excel
  const excelDebt = new Map<string, number>(); // client name (lowercase) -> total debt (K+NK+PK+F+PP)
  const excelNetDebt = new Map<string, number>(); // without PP

  for (const row of rows) {
    const clientRaw = String(row[1] || '').trim();
    if (!clientRaw) continue;
    const client = clientRaw.toLowerCase();

    const opTypeRaw = String(row[9] || '').trim().toLowerCase();
    const mapped = OP_TYPE_MAP[opTypeRaw] || '';
    if (!DEBT_TYPES.has(mapped)) continue;

    const ab = typeof row[closingBalanceCol] === 'number' ? row[closingBalanceCol] : 0;

    excelDebt.set(client, (excelDebt.get(client) || 0) + ab);
    if (mapped !== 'PP') {
      excelNetDebt.set(client, (excelNetDebt.get(client) || 0) + ab);
    }
  }

  // 2. Get CRM per-client debt from closingBalance
  const crmDebt = await prisma.$queryRaw<{ client_id: string; company_name: string; total_debt: string }[]>(
    Prisma.sql`
      SELECT d.client_id, c.company_name,
        COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP')
            THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS total_debt
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND di.closing_balance IS NOT NULL
      GROUP BY d.client_id, c.company_name
    `
  );

  // 3. Get CRM per-client deal balance (amount - paidAmount) – what client profile shows
  const crmDealBalance = await prisma.$queryRaw<{ client_id: string; company_name: string; deal_balance: string }[]>(
    Prisma.sql`
      SELECT d.client_id, c.company_name,
        SUM(d.amount - d.paid_amount)::text AS deal_balance
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
      GROUP BY d.client_id, c.company_name
    `
  );

  const crmDebtMap = new Map<string, { name: string; debt: number }>();
  for (const r of crmDebt) {
    crmDebtMap.set(r.client_id, { name: r.company_name, debt: Number(r.total_debt) });
  }

  const crmBalanceMap = new Map<string, number>();
  for (const r of crmDealBalance) {
    crmBalanceMap.set(r.client_id, Number(r.deal_balance));
  }

  // 4. Check for remaining Sverka deals
  const sverkaDeals = await prisma.deal.findMany({
    where: { title: { contains: 'Сверка' } },
    select: { id: true, title: true, amount: true, client: { select: { companyName: true } } },
  });
  if (sverkaDeals.length > 0) {
    console.log(`\n⚠ WARNING: ${sverkaDeals.length} Сверка deals still exist!`);
    for (const d of sverkaDeals) {
      console.log(`  "${d.title}" client=${d.client?.companyName} amount=${fmtNum(Number(d.amount))}`);
    }
  } else {
    console.log('✓ No Сверка deals remain.');
  }

  // 5. Match CRM clients to Excel clients
  const allClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const clientNameMap = new Map<string, { id: string; name: string }>();
  for (const c of allClients) {
    clientNameMap.set(c.companyName.toLowerCase(), { id: c.id, name: c.companyName });
  }

  // 6. Compare
  console.log('\n=== CRM vs Excel: Per-client debt comparison ===\n');
  console.log(
    'Client'.padEnd(35),
    'Excel'.padStart(15),
    'CRM(CB)'.padStart(15),
    'CRM(Deal)'.padStart(15),
    'CB Match?'.padStart(10),
    'Deal Match?'.padStart(12),
  );
  console.log('-'.repeat(105));

  let mismatches = 0;
  let dealMismatches = 0;
  const checked = new Set<string>();

  // Sort Excel clients by debt descending
  const sortedExcel = [...excelDebt.entries()].sort((a, b) => b[1] - a[1]);

  for (const [excelName, excelTotal] of sortedExcel) {
    if (Math.round(excelTotal) === 0) continue;

    const crmClient = clientNameMap.get(excelName);
    if (!crmClient) {
      console.log(`  ${excelName.padEnd(35)} Excel=${fmtNum(excelTotal).padStart(15)}  NOT FOUND IN CRM`);
      mismatches++;
      continue;
    }

    checked.add(crmClient.id);
    const crmCB = crmDebtMap.get(crmClient.id)?.debt ?? 0;
    const crmDeal = crmBalanceMap.get(crmClient.id) ?? 0;

    const cbMatch = Math.abs(Math.round(crmCB) - Math.round(excelTotal)) < 2;
    const dealMatch = Math.abs(Math.round(crmDeal) - Math.round(excelTotal)) < 2;

    if (!cbMatch || !dealMatch) {
      console.log(
        crmClient.name.padEnd(35),
        fmtNum(excelTotal).padStart(15),
        fmtNum(crmCB).padStart(15),
        fmtNum(crmDeal).padStart(15),
        (cbMatch ? '✓' : '✗ DIFF').padStart(10),
        (dealMatch ? '✓' : '✗ DIFF').padStart(12),
      );
      if (!cbMatch) mismatches++;
      if (!dealMatch) dealMismatches++;
    }
  }

  // Check CRM clients with debt but not in Excel
  for (const [clientId, data] of crmDebtMap) {
    if (checked.has(clientId)) continue;
    if (Math.round(data.debt) === 0) continue;
    const dealBal = crmBalanceMap.get(clientId) ?? 0;
    console.log(
      `${data.name.padEnd(35)} ${'N/A'.padStart(15)} ${fmtNum(data.debt).padStart(15)} ${fmtNum(dealBal).padStart(15)}   CRM ONLY (no Excel match)`
    );
  }

  // Summary
  console.log('\n=== Summary ===');

  // Totals
  let excelGrossTotal = 0;
  for (const [, v] of excelDebt) excelGrossTotal += v;
  let excelNetTotal = 0;
  for (const [, v] of excelNetDebt) excelNetTotal += v;

  let crmCBTotal = 0;
  for (const [, v] of crmDebtMap) crmCBTotal += v.debt;
  let crmDealTotal = 0;
  for (const [, v] of crmBalanceMap) crmDealTotal += v;

  console.log(`  Excel gross (K+NK+PK+F+PP): ${fmtNum(excelGrossTotal)}`);
  console.log(`  Excel net   (K+NK+PK+F):    ${fmtNum(excelNetTotal)}`);
  console.log(`  CRM closingBalance total:   ${fmtNum(crmCBTotal)}`);
  console.log(`  CRM deal balance total:     ${fmtNum(crmDealTotal)}`);
  console.log(`  CB mismatches:   ${mismatches}`);
  console.log(`  Deal mismatches: ${dealMismatches}`);

  // All OK clients count
  const okCount = sortedExcel.filter(([, v]) => Math.round(v) !== 0).length - mismatches;
  console.log(`  Matching clients: ${okCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
