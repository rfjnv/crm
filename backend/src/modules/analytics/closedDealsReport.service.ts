import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SPAN_DAYS = 400;

type ClosedDealsRowRaw = {
  closed_date: string | null;
  client_name: string;
  manager_name: string;
  product_name: string;
  quantity: string | null;
  unit: string | null;
  price: string | null;
  line_total: string | null;
  payment_method: string | null;
  due_date: string | null;
  contract_number: string | null;
  deal_amount: string | null;
  deal_paid_amount: string | null;
  payment_sum: string | null;
  payment_methods: string | null;
  payment_count: string | null;
};

type ClosedDealsExcelRow = {
  'Дата закрытия': string;
  'Клиент': string;
  'Менеджер': string;
  'Товар': string;
  'Кол-во': number;
  'Ед. изм.': string;
  'Цена': number;
  'Сумма': number;
  'Способ оплаты': string;
  'Срок оплаты': string;
  'Номер договора': string;
  'Сумма оплаты': number;
  'Каким способом оплатил': string;
  'Остаток долга': number;
  'Число оплаты': number;
};

export type ManagerBreakdown = {
  managerName: string;
  dealsCount: number;
  clientsCount: number;
  totalAmount: number;
  debtAmount: number;
};

export type PaymentMethodBreakdown = {
  method: string;
  count: number;
  totalAmount: number;
};

export type ClosedDealsReportResult = {
  from: string;
  to: string;
  rowCount: number;
  totalLineAmount: number;
  totalDebtAmount: number;
  clientsCount: number;
  managerBreakdown: ManagerBreakdown[];
  paymentMethodBreakdown: PaymentMethodBreakdown[];
  xlsxBuffer: Buffer;
  csvBuffer: Buffer;
};

function parseYmd(day: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) {
    throw new AppError(400, 'Параметры from и to обязательны (формат YYYY-MM-DD)');
  }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function tashkentDayStartUtc(day: string): Date {
  const { y, m, d } = parseYmd(day);
  return new Date(Date.UTC(y, m - 1, d) - TASHKENT_OFFSET_MS);
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function numberOrZero(v: string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateCell(v: string | null): string {
  if (!v) return '';
  return v.length >= 10 ? v.slice(0, 10) : v;
}

const REPORT_HEADER = [
  'Дата закрытия',
  'Клиент',
  'Менеджер',
  'Товар',
  'Кол-во',
  'Ед. изм.',
  'Цена',
  'Сумма',
  'Способ оплаты',
  'Срок оплаты',
  'Номер договора',
  'Сумма оплаты',
  'Каким способом оплатил',
  'Остаток долга',
  'Число оплаты',
];

const REPORT_COLUMN_WIDTHS: Array<{ wch: number }> = [
  { wch: 13 }, // Дата закрытия
  { wch: 26 }, // Клиент
  { wch: 20 }, // Менеджер
  { wch: 38 }, // Товар
  { wch: 10 }, // Кол-во
  { wch: 9 }, // Ед. изм.
  { wch: 12 }, // Цена
  { wch: 14 }, // Сумма
  { wch: 13 }, // Способ оплаты
  { wch: 13 }, // Срок оплаты
  { wch: 16 }, // Номер договора
  { wch: 14 }, // Сумма оплаты
  { wch: 22 }, // Каким способом оплатил
  { wch: 14 }, // Остаток долга
  { wch: 12 }, // Число оплаты
];

const MONEY_COLUMNS = new Set(['Цена', 'Сумма', 'Сумма оплаты', 'Остаток долга']);

function applyMoneyFormat(ws: XLSX.WorkSheet, rows: ClosedDealsExcelRow[]): void {
  REPORT_HEADER.forEach((header, colIdx) => {
    if (!MONEY_COLUMNS.has(header)) return;
    for (let r = 0; r < rows.length; r += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: r + 1, c: colIdx });
      const cell = ws[cellRef];
      if (cell && cell.t === 'n') {
        cell.z = '#,##0';
      }
    }
  });
}

function buildWorkbook(rows: ClosedDealsExcelRow[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows, { header: REPORT_HEADER });
  ws['!cols'] = REPORT_COLUMN_WIDTHS;
  const lastCol = XLSX.utils.encode_col(REPORT_HEADER.length - 1);
  ws['!autofilter'] = { ref: `A1:${lastCol}${rows.length + 1}` };
  applyMoneyFormat(ws, rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ClosedDeals');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildCsv(rows: ClosedDealsExcelRow[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows, { header: REPORT_HEADER });
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
  return Buffer.from(`\uFEFF${csv}`, 'utf8');
}

function buildManagerBreakdown(excelRows: ClosedDealsExcelRow[]): ManagerBreakdown[] {
  const byManager = new Map<string, { deals: Set<string>; clients: Set<string>; total: number; debt: number }>();
  for (const row of excelRows) {
    const manager = row['\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440'] || '\u0411\u0435\u0437 \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440\u0430';
    const entry = byManager.get(manager) || { deals: new Set(), clients: new Set(), total: 0, debt: 0 };
    entry.deals.add(`${row['\u041A\u043B\u0438\u0435\u043D\u0442']}|${row['\u0414\u0430\u0442\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F']}|${row['\u041D\u043E\u043C\u0435\u0440 \u0434\u043E\u0433\u043E\u0432\u043E\u0440\u0430']}`);
    entry.clients.add(row['\u041A\u043B\u0438\u0435\u043D\u0442']);
    entry.total += row['\u0421\u0443\u043C\u043C\u0430'];
    entry.debt += row['\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0434\u043E\u043B\u0433\u0430'];
    byManager.set(manager, entry);
  }
  return Array.from(byManager.entries())
    .map(([managerName, v]) => ({
      managerName,
      dealsCount: v.deals.size,
      clientsCount: v.clients.size,
      totalAmount: v.total,
      debtAmount: v.debt,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

function buildPaymentMethodBreakdown(excelRows: ClosedDealsExcelRow[]): PaymentMethodBreakdown[] {
  const byMethod = new Map<string, { count: number; total: number }>();
  for (const row of excelRows) {
    const method = row['\u0421\u043F\u043E\u0441\u043E\u0431 \u043E\u043F\u043B\u0430\u0442\u044B'] || '\u041D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D';
    const entry = byMethod.get(method) || { count: 0, total: 0 };
    entry.count += 1;
    entry.total += row['\u0421\u0443\u043C\u043C\u0430'];
    byMethod.set(method, entry);
  }
  return Array.from(byMethod.entries())
    .map(([method, v]) => ({ method, count: v.count, totalAmount: v.total }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

class ClosedDealsReportService {
  private validateRange(from: string, to: string): { fromUtc: Date; toUtcExclusive: Date } {
    const fromUtc = tashkentDayStartUtc(from);
    const toUtc = tashkentDayStartUtc(to);
    if (fromUtc.getTime() > toUtc.getTime()) {
      throw new AppError(400, 'Некорректный диапазон дат');
    }
    const spanDays = Math.floor((toUtc.getTime() - fromUtc.getTime()) / DAY_MS) + 1;
    if (spanDays > MAX_SPAN_DAYS) {
      throw new AppError(400, `Интервал не более ${MAX_SPAN_DAYS} дней`);
    }
    return {
      fromUtc,
      toUtcExclusive: new Date(toUtc.getTime() + DAY_MS),
    };
  }

  async buildReport(from: string, to: string): Promise<ClosedDealsReportResult> {
    const { fromUtc, toUtcExclusive } = this.validateRange(from, to);

    const rows = await prisma.$queryRaw<ClosedDealsRowRaw[]>(
      Prisma.sql`
        WITH payment_agg AS (
          SELECT
            p.deal_id,
            COALESCE(SUM(p.amount), 0)::text AS payment_sum,
            COALESCE(COUNT(p.id), 0)::text AS payment_count,
            COALESCE(string_agg(DISTINCT COALESCE(NULLIF(TRIM(p.method), ''), 'UNKNOWN'), ', '), '') AS payment_methods
          FROM payments p
          WHERE p.paid_at >= ${fromUtc}
            AND p.paid_at < ${toUtcExclusive}
          GROUP BY p.deal_id
        )
        SELECT
          TO_CHAR((((d.closed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')), 'YYYY-MM-DD') AS closed_date,
          c.company_name AS client_name,
          u.full_name AS manager_name,
          pr.name AS product_name,
          COALESCE(di.requested_qty, 0)::text AS quantity,
          COALESCE(pr.unit, 'шт') AS unit,
          COALESCE(di.price, 0)::text AS price,
          COALESCE(NULLIF(di.line_total, 0), di.requested_qty * di.price, 0)::text AS line_total,
          COALESCE(d.payment_method::text, '') AS payment_method,
          CASE WHEN d.due_date IS NULL THEN NULL ELSE TO_CHAR(d.due_date, 'YYYY-MM-DD') END AS due_date,
          COALESCE(ct.contract_number, '') AS contract_number,
          COALESCE(d.amount, 0)::text AS deal_amount,
          COALESCE(d.paid_amount, 0)::text AS deal_paid_amount,
          COALESCE(pa.payment_sum, '0') AS payment_sum,
          COALESCE(pa.payment_methods, '') AS payment_methods,
          COALESCE(pa.payment_count, '0') AS payment_count
        FROM deals d
        JOIN clients c ON c.id = d.client_id
        JOIN users u ON u.id = d.manager_id
        JOIN deal_items di ON di.deal_id = d.id
        JOIN products pr ON pr.id = di.product_id
        LEFT JOIN contracts ct ON ct.id = d.contract_id
        LEFT JOIN payment_agg pa ON pa.deal_id = d.id
        WHERE d.status = 'CLOSED'
          AND d.is_archived = false
          AND d.closed_at IS NOT NULL
          AND d.closed_at >= ${fromUtc}
          AND d.closed_at < ${toUtcExclusive}
        ORDER BY d.closed_at ASC, c.company_name ASC, d.id ASC, di.created_at ASC
      `,
    );

    const excelRows: ClosedDealsExcelRow[] = rows.map((r) => {
      const lineAmount = numberOrZero(r.line_total);
      const dealAmount = numberOrZero(r.deal_amount);
      const dealPaidAmount = numberOrZero(r.deal_paid_amount);
      return {
        'Дата закрытия': normalizeDateCell(r.closed_date),
        'Клиент': r.client_name || '',
        'Менеджер': r.manager_name || '',
        'Товар': r.product_name || '',
        'Кол-во': numberOrZero(r.quantity),
        'Ед. изм.': r.unit || '',
        'Цена': numberOrZero(r.price),
        'Сумма': lineAmount,
        'Способ оплаты': r.payment_method || '',
        'Срок оплаты': normalizeDateCell(r.due_date),
        'Номер договора': r.contract_number || '',
        'Сумма оплаты': numberOrZero(r.payment_sum),
        'Каким способом оплатил': r.payment_methods || '',
        'Остаток долга': Math.max(dealAmount - dealPaidAmount, 0),
        'Число оплаты': numberOrZero(r.payment_count),
      };
    });

    const totalLineAmount = excelRows.reduce((acc, row) => acc + row['Сумма'], 0);
    const totalDebtAmount = excelRows.reduce((acc, row) => acc + row['Остаток долга'], 0);
    const clientsCount = new Set(excelRows.map((row) => row['Клиент'])).size;
    const managerBreakdown = buildManagerBreakdown(excelRows);
    const paymentMethodBreakdown = buildPaymentMethodBreakdown(excelRows);
    const xlsxBuffer = buildWorkbook(excelRows);
    const csvBuffer = buildCsv(excelRows);

    return {
      from,
      to,
      rowCount: excelRows.length,
      totalLineAmount,
      totalDebtAmount,
      clientsCount,
      managerBreakdown,
      paymentMethodBreakdown,
      xlsxBuffer,
      csvBuffer,
    };
  }

  getYesterdayRange(): { from: string; to: string } {
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
    const y = nowTashkent.getUTCFullYear();
    const m = nowTashkent.getUTCMonth();
    const d = nowTashkent.getUTCDate();
    const startOfTodayUtc = new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET_MS);
    const yesterdayUtc = new Date(startOfTodayUtc.getTime() - DAY_MS);
    const day = formatYmd(new Date(yesterdayUtc.getTime() + TASHKENT_OFFSET_MS));
    return { from: day, to: day };
  }

  /** Сегодняшний день по Ташкенту — отчёт в 20:00 показывает сделки, закрытые сегодня. */
  getTodayRange(): { from: string; to: string } {
    const day = this.getTodayTashkentYmd();
    return { from: day, to: day };
  }

  getTodayTashkentYmd(): string {
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
    return formatYmd(nowTashkent);
  }
}

export const closedDealsReportService = new ClosedDealsReportService();
