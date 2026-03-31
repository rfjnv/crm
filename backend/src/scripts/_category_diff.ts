/**
 * Find clients categorized differently between CRM (by balance sign) and Excel (by marks)
 */
import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

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
function fmtNum(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф']);
const PREPAY_MARKS = new Set(['пп']);
const SYNC_MARKS = new Set([...DEBT_MARKS, ...PREPAY_MARKS]);
const NKP_COL = 9;

async function main() {
  const fpath = path.resolve(process.cwd(), '..', '07.03.2026.xlsx');
  const wb = XLSX.readFile(fpath);
  const sheetName = wb.SheetNames[wb.SheetNames.length - 1];
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const closingCol = range.e.c + 1 - 2;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

  // Per-client: total balance, has debt mark, has pp mark
  const excelClients = new Map<string, { total: number; hasDebt: boolean; hasPP: boolean }>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = normalizeClientName(row[1]);
    if (!name) continue;
    const mark = norm(row[NKP_COL]).toLowerCase();
    const closing = numVal(row[closingCol]);
    const e = excelClients.get(name) || { total: 0, hasDebt: false, hasPP: false };
    e.total += closing;
    if (DEBT_MARKS.has(mark)) e.hasDebt = true;
    if (PREPAY_MARKS.has(mark)) e.hasPP = true;
    excelClients.set(name, e);
  }

  console.log('=== КЛИЕНТЫ С РАЗНОЙ КАТЕГОРИЗАЦИЕЙ Excel vs CRM ===\n');
  console.log('Excel считает по МЕТКАМ (к/н/к/п/к/ф = долг, пп = предоплата)');
  console.log('CRM считает по ЗНАКУ БАЛАНСА (>0 = долг, <0 = предоплата)\n');

  // Excel gross/prepay by marks
  let exDebtTotal = 0, exPPTotal = 0;
  // Excel gross/prepay by sign (how CRM would see it)
  let exSignGross = 0, exSignPrepay = 0;

  const mismatches: { name: string; total: number; excelCat: string; crmCat: string }[] = [];

  for (const [name, e] of excelClients) {
    if (!e.hasDebt && !e.hasPP) continue; // not a sync client

    // Excel categorization (by marks)
    const excelCat = e.hasDebt ? 'ДОЛГ' : 'ПРЕДОПЛАТА';
    // CRM categorization (by sign)
    const crmCat = e.total > 0 ? 'ДОЛГ' : (e.total < 0 ? 'ПРЕДОПЛАТА' : 'НОЛЬ');

    if (e.hasDebt) exDebtTotal += e.total;
    if (e.hasPP && !e.hasDebt) exPPTotal += e.total;

    if (e.total > 0) exSignGross += e.total;
    else exSignPrepay += e.total;

    if (excelCat !== crmCat && e.total !== 0) {
      mismatches.push({ name, total: e.total, excelCat, crmCat });
    }
  }

  if (mismatches.length === 0) {
    console.log('Все клиенты категоризированы одинаково.\n');
  } else {
    console.log(`Найдено ${mismatches.length} клиентов с разной категорией:\n`);
    for (const m of mismatches.sort((a, b) => Math.abs(b.total) - Math.abs(a.total))) {
      console.log(`  ${m.name}: баланс=${fmtNum(m.total)}, Excel="${m.excelCat}", CRM="${m.crmCat}"`);
    }
  }

  console.log(`\n=== СРАВНЕНИЕ ПОДСЧЁТОВ ===`);
  console.log(`  По МЕТКАМ (Excel):    Долг=${fmtNum(exDebtTotal)}, ПП=${fmtNum(exPPTotal)}`);
  console.log(`  По ЗНАКУ (CRM):       Долг=${fmtNum(exSignGross)}, ПП=${fmtNum(exSignPrepay)}`);
  console.log(`  Разница gross:        ${fmtNum(exSignGross - exDebtTotal)}`);
  console.log(`  Разница prepay:       ${fmtNum(exSignPrepay - exPPTotal)}`);
  console.log(`  (чистый итог одинаков: ${fmtNum(exSignGross + exSignPrepay)})`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
