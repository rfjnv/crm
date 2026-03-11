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

// Try multiple paths: dev (process.cwd()=backend/) and prod (process.cwd()=/app)
const CANDIDATE_PATHS = [
  path.resolve(process.cwd(), 'src', 'data', 'debt-totals.json'),
  path.resolve(__dirname, '..', '..', 'data', 'debt-totals.json'),  // dist/lib/ -> dist/data/
  path.resolve(__dirname, '..', 'data', 'debt-totals.json'),        // dist/lib/ -> data/
];

function findJsonPath(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let cached: { mtime: number; totals: ExcelDebtTotals; path: string } | null = null;

export function getExcelDebtTotals(): ExcelDebtTotals | null {
  try {
    const jsonPath = cached?.path || findJsonPath();
    if (!jsonPath) {
      console.warn('[excel-debt-totals] debt-totals.json not found. Tried:', CANDIDATE_PATHS);
      return null;
    }

    const stat = fs.statSync(jsonPath);
    if (cached && cached.mtime === stat.mtimeMs && cached.path === jsonPath) {
      return cached.totals;
    }

    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const totals: ExcelDebtTotals = {
      grossDebt: Number(raw.grossDebt) || 0,
      prepayments: Number(raw.prepayments) || 0,
      totalDebt: Number(raw.totalDebt) || 0,
    };

    cached = { mtime: stat.mtimeMs, totals, path: jsonPath };
    return totals;
  } catch (err) {
    console.warn('[excel-debt-totals] Error reading debt-totals.json:', err);
    return null;
  }
}
