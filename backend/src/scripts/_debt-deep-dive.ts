import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  // 1. Get CRM client-level debt (per client, net of overpayments within client)
  const crmClients = await prisma.$queryRaw<
    { client_id: string; company_name: string; deal_count: string; total_amount: string; total_paid: string; debt: string; overpay: string; net: string }[]
  >(
    Prisma.sql`SELECT
      c.id as client_id,
      c.company_name,
      COUNT(d.id)::text as deal_count,
      COALESCE(SUM(d.amount), 0)::text as total_amount,
      COALESCE(SUM(COALESCE(p.total_paid, 0)), 0)::text as total_paid,
      COALESCE(SUM(GREATEST(d.amount - COALESCE(p.total_paid, 0), 0)), 0)::text as debt,
      COALESCE(SUM(GREATEST(COALESCE(p.total_paid, 0) - d.amount, 0)), 0)::text as overpay,
      COALESCE(SUM(d.amount - COALESCE(p.total_paid, 0)), 0)::text as net
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN (SELECT deal_id, SUM(amount) as total_paid FROM payments GROUP BY deal_id) p ON p.deal_id = d.id
    WHERE d.is_archived = false
    GROUP BY c.id, c.company_name
    HAVING SUM(d.amount - COALESCE(p.total_paid, 0)) != 0
    ORDER BY SUM(d.amount - COALESCE(p.total_paid, 0)) DESC`
  );

  console.log(`=== CRM Client Balances (non-zero net) ===`);
  console.log(`Total clients with balance: ${crmClients.length}`);

  let totalCrmDebt = 0;
  let totalCrmOverpay = 0;
  let totalCrmNet = 0;
  const crmMap = new Map<string, { name: string; debt: number; overpay: number; net: number; deals: number }>();

  for (const c of crmClients) {
    const debt = Number(c.debt);
    const overpay = Number(c.overpay);
    const net = Number(c.net);
    totalCrmDebt += debt;
    totalCrmOverpay += overpay;
    totalCrmNet += net;
    crmMap.set(c.company_name.toLowerCase().trim(), {
      name: c.company_name,
      debt, overpay, net,
      deals: Number(c.deal_count),
    });
  }
  console.log(`Total debt (positive): ${totalCrmDebt.toLocaleString()}`);
  console.log(`Total overpay: ${totalCrmOverpay.toLocaleString()}`);
  console.log(`Total net: ${totalCrmNet.toLocaleString()}`);

  // Top 20 CRM debtors
  console.log(`\nTop 20 CRM debtors:`);
  for (const c of crmClients.slice(0, 20)) {
    console.log(`  "${c.company_name}" deals=${c.deal_count} net=${Number(c.net).toLocaleString()} debt=${Number(c.debt).toLocaleString()} overpay=${Number(c.overpay).toLocaleString()}`);
  }

  // 2. Parse Excel Feb 2026 closing balances per client
  const fpath = path.resolve(process.cwd(), '..', '28.02.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const ws = wb.Sheets['февраль 2026'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  // Build per-client closing balance from Excel
  // Each client can have multiple rows (transactions)
  // Column [2] = opening balance (first row), Column [27] = closing balance per transaction
  // The SUM of all column [27] values = total closing balance
  // But for per-CLIENT balance, we need to sum col[27] per client

  const excelClients = new Map<string, { sumClosing: number; sumSale: number; sumPayment: number; rows: number }>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row) continue;
    const company = String(row[1] || '').trim().toLowerCase();
    if (!company) continue;
    const closing = Number(row[27]) || 0;
    const sale = Number(row[8]) || 0;
    // Sum all payment columns (11-25)
    let payment = 0;
    for (let j = 11; j <= 25; j++) {
      payment += Number(row[j]) || 0;
    }

    if (!excelClients.has(company)) {
      excelClients.set(company, { sumClosing: closing, sumSale: sale, sumPayment: payment, rows: 1 });
    } else {
      const c = excelClients.get(company)!;
      c.sumClosing += closing;
      c.sumSale += sale;
      c.sumPayment += payment;
      c.rows++;
    }
  }

  console.log(`\n=== Excel Feb 2026 Client Balances ===`);
  console.log(`Total unique clients: ${excelClients.size}`);
  let totalExcelClosing = 0;
  for (const [, c] of excelClients) {
    totalExcelClosing += c.sumClosing;
  }
  console.log(`Total closing balance: ${totalExcelClosing.toLocaleString()}`);

  // 3. Cross-reference: CRM clients vs Excel clients
  console.log(`\n=== RECONCILIATION ===`);

  const matched: { name: string; crmNet: number; excelClosing: number; diff: number }[] = [];
  const crmOnly: { name: string; crmNet: number }[] = [];
  const excelOnly: { name: string; excelClosing: number }[] = [];

  // Normalize names for matching
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  // Build normalized CRM map
  const crmNorm = new Map<string, { name: string; net: number; debt: number; overpay: number; deals: number }>();
  for (const [key, val] of crmMap) {
    crmNorm.set(normalize(key), val);
  }

  // Build normalized Excel map
  const excelNorm = new Map<string, { closing: number }>();
  for (const [key, val] of excelClients) {
    excelNorm.set(normalize(key), { closing: val.sumClosing });
  }

  // Match
  const matchedKeys = new Set<string>();
  for (const [crmKey, crmVal] of crmNorm) {
    if (excelNorm.has(crmKey)) {
      const excelVal = excelNorm.get(crmKey)!;
      matched.push({
        name: crmVal.name,
        crmNet: crmVal.net,
        excelClosing: excelVal.closing,
        diff: crmVal.net - excelVal.closing,
      });
      matchedKeys.add(crmKey);
    } else {
      crmOnly.push({ name: crmVal.name, crmNet: crmVal.net });
    }
  }
  for (const [excelKey, excelVal] of excelNorm) {
    if (!matchedKeys.has(excelKey) && !crmNorm.has(excelKey)) {
      excelOnly.push({ name: excelKey, excelClosing: excelVal.closing });
    }
  }

  console.log(`\nMatched clients: ${matched.length}`);
  console.log(`CRM-only clients (not in Excel): ${crmOnly.length}`);
  console.log(`Excel-only clients (not in CRM): ${excelOnly.length}`);

  // Show matched with differences
  const withDiff = matched.filter(m => Math.abs(m.diff) > 1000);
  console.log(`\nMatched clients WITH difference > 1000:`);
  let totalDiff = 0;
  for (const m of withDiff.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))) {
    totalDiff += m.diff;
    console.log(`  "${m.name}": CRM_net=${m.crmNet.toLocaleString()} Excel=${m.excelClosing.toLocaleString()} DIFF=${m.diff.toLocaleString()}`);
  }
  console.log(`  TOTAL DIFF (matched): ${totalDiff.toLocaleString()}`);

  // Show CRM-only totals
  let totalCrmOnly = 0;
  console.log(`\nCRM-only clients (top 20 by balance):`);
  const crmOnlySorted = crmOnly.sort((a, b) => Math.abs(b.crmNet) - Math.abs(a.crmNet));
  for (const c of crmOnlySorted.slice(0, 20)) {
    totalCrmOnly += c.crmNet;
    console.log(`  "${c.name}": CRM_net=${c.crmNet.toLocaleString()}`);
  }
  for (const c of crmOnlySorted.slice(20)) {
    totalCrmOnly += c.crmNet;
  }
  console.log(`  TOTAL CRM-only net: ${totalCrmOnly.toLocaleString()}`);

  // Show Excel-only totals
  let totalExcelOnly = 0;
  console.log(`\nExcel-only clients (top 20 by balance):`);
  const excelOnlySorted = excelOnly.filter(e => Math.abs(e.excelClosing) > 0).sort((a, b) => Math.abs(b.excelClosing) - Math.abs(a.excelClosing));
  for (const e of excelOnlySorted.slice(0, 20)) {
    totalExcelOnly += e.excelClosing;
    console.log(`  "${e.name}": Excel=${e.excelClosing.toLocaleString()}`);
  }
  for (const e of excelOnlySorted.slice(20)) {
    totalExcelOnly += e.excelClosing;
  }
  console.log(`  TOTAL Excel-only: ${totalExcelOnly.toLocaleString()}`);

  // Summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`CRM total net: ${totalCrmNet.toLocaleString()}`);
  console.log(`Excel total closing: ${totalExcelClosing.toLocaleString()}`);
  console.log(`Gap: ${(totalCrmNet - totalExcelClosing).toLocaleString()}`);
  console.log(`  Of which matched diffs: ${totalDiff.toLocaleString()}`);
  console.log(`  Of which CRM-only: ${totalCrmOnly.toLocaleString()}`);
  console.log(`  Of which Excel-only: ${totalExcelOnly.toLocaleString()}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
