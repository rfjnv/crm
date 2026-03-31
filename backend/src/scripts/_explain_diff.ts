/**
 * Show exactly WHY Excel gross/prepay differ from CRM gross/prepay.
 * The key: clients with BOTH debt marks AND пп marks.
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { normalizeClientName } from '../lib/normalize-client';

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}
function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф']);
const NKP_COL = 9;

async function main() {
  const fpath = path.resolve(process.cwd(), '..', '07.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  // Per-client: separate debt-row sum, pp-row sum, other-row sum
  const clients = new Map<string, {
    debtRowsSum: number; ppRowsSum: number; otherRowsSum: number;
    totalSum: number; hasDebt: boolean; hasPP: boolean;
  }>();

  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = normalizeClientName(row[1]);
    if (!name) continue;
    const mark = norm(row[NKP_COL]).toLowerCase();
    const closing = numVal(row[closingCol]);
    const e = clients.get(name) || { debtRowsSum: 0, ppRowsSum: 0, otherRowsSum: 0, totalSum: 0, hasDebt: false, hasPP: false };
    e.totalSum += closing;
    if (DEBT_MARKS.has(mark)) { e.debtRowsSum += closing; e.hasDebt = true; }
    else if (mark === 'пп') { e.ppRowsSum += closing; e.hasPP = true; }
    else { e.otherRowsSum += closing; }
    clients.set(name, e);
  }

  // Excel method: sum of ROWS by mark (as user computes in Excel)
  let excelDebtTotal = 0, excelPPTotal = 0, excelAllTotal = 0;
  for (const [, e] of clients) {
    if (!e.hasDebt && !e.hasPP) continue;
    excelDebtTotal += e.debtRowsSum;
    excelPPTotal += e.ppRowsSum;
    excelAllTotal += e.totalSum;
  }

  // CRM method: per-client total, split by sign
  let crmGross = 0, crmPrepay = 0;
  for (const [, e] of clients) {
    if (!e.hasDebt && !e.hasPP) continue;
    if (e.totalSum > 0) crmGross += e.totalSum;
    else crmPrepay += e.totalSum;
  }

  console.log('=== Excel способ: суммировать СТРОКИ по метке ===');
  console.log(`  Строки с метками к/н/к/п/к/ф:  ${fmtNum(excelDebtTotal)}`);
  console.log(`  Строки с меткой пп:             ${fmtNum(excelPPTotal)}`);
  console.log(`  Строки с другими метками:       ${fmtNum(excelAllTotal - excelDebtTotal - excelPPTotal)}`);
  console.log(`  Итого:                          ${fmtNum(excelAllTotal)}`);

  console.log(`\n=== CRM способ: группировка по КЛИЕНТУ, разбивка по ЗНАКУ ===`);
  console.log(`  Клиенты с балансом > 0 (долг):  ${fmtNum(crmGross)}`);
  console.log(`  Клиенты с балансом < 0 (пп):    ${fmtNum(crmPrepay)}`);
  console.log(`  Итого:                          ${fmtNum(crmGross + crmPrepay)}`);

  console.log(`\n=== РАЗНИЦА ===`);
  console.log(`  Gross: ${fmtNum(excelDebtTotal)} vs ${fmtNum(crmGross)} = ${fmtNum(excelDebtTotal - crmGross)}`);
  console.log(`  Prepay: ${fmtNum(excelPPTotal)} vs ${fmtNum(crmPrepay)} = ${fmtNum(excelPPTotal - crmPrepay)}`);

  // Show clients causing the difference (have BOTH debt and pp marks)
  console.log(`\n=== КЛИЕНТЫ С ОБЕИМИ МЕТКАМИ (и долг, и пп) ===`);
  console.log('Эти клиенты создают разницу, потому что:');
  console.log('- Excel считает их долговые строки ОТДЕЛЬНО от пп строк');
  console.log('- CRM берёт ОБЩИЙ баланс клиента и смотрит плюс или минус\n');

  for (const [name, e] of [...clients.entries()].sort((a, b) => Math.abs(b[1].totalSum) - Math.abs(a[1].totalSum))) {
    if (!e.hasDebt || !e.hasPP) continue;
    console.log(`  ${name}:`);
    console.log(`    Долговые строки (к/н/к/п/к/ф): ${fmtNum(e.debtRowsSum)}`);
    console.log(`    Строки пп:                     ${fmtNum(e.ppRowsSum)}`);
    console.log(`    Другие строки (н/п/т):         ${fmtNum(e.otherRowsSum)}`);
    console.log(`    ИТОГО баланс:                  ${fmtNum(e.totalSum)} → CRM: ${e.totalSum > 0 ? 'ДОЛГ' : 'ПРЕДОПЛАТА'}`);
    console.log();
  }
}

main().catch(console.error);
