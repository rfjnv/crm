/**
 * Reads precomputed debt totals from debt-totals.json.
 * Updated by sync-payments when it runs.
 *
 *   Общий долг  = rows with marks к, н/к, п/к, ф
 *   Предоплаты  = |rows with mark пп| (positive number)
 *   Чистый долг = all rows net
 */

import * as fs from 'fs';
import path from 'path';

export interface ExcelDebtTotals {
  grossDebt: number;
  prepayments: number;
  totalDebt: number;
}

// process.cwd() = backend/, works both in dev (tsx) and prod (node dist/)
const JSON_PATH = path.resolve(process.cwd(), 'src', 'data', 'debt-totals.json');

let cached: { mtime: number; totals: ExcelDebtTotals } | null = null;

export function getExcelDebtTotals(): ExcelDebtTotals | null {
  try {
    const stat = fs.statSync(JSON_PATH);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.totals;
    }

    const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    const totals: ExcelDebtTotals = {
      grossDebt: Number(raw.grossDebt) || 0,
      prepayments: Number(raw.prepayments) || 0,
      totalDebt: Number(raw.totalDebt) || 0,
    };

    cached = { mtime: stat.mtimeMs, totals };
    return totals;
  } catch {
    return null;
  }
}
