import type { Workbook, Worksheet } from 'exceljs';
import type { ProductPurchaseRow } from './analyticsHierarchySales';

/**
 * Выгрузка «Клиенты по иерархии» в Excel, три листа:
 *  1. «Товары» — что и сколько продано по выбранной категории / типу / товару;
 *  2. «Клиенты» — кто, когда, на какую сумму и сколько купил, по товарам;
 *  3. «Данные» — каждая строка продажи, из которых собраны первые два листа.
 *
 * Строки приходят уже без исключённых клиентов — в файле их нет ни на одном листе.
 */

export interface ExportProductInfo {
  name: string;
  sku: string;
  unit: string;
  category: string;
  type: string;
}

export interface HierarchyExportInput {
  rows: ProductPurchaseRow[];
  product: (productId: string) => ExportProductInfo;
  /** «Категория «Бумага»», «Тип …», «Товар …» */
  scopeLabel: string;
  periodLabel: string;
  /** Нет доступа к суммам — колонки с деньгами не выгружаем. */
  moneyHidden: boolean;
  generatedAt?: Date;
}

const MONEY_FMT = '#,##0';
const QTY_FMT = '#,##0.###';
const DATE_FMT = 'dd.mm.yyyy';

interface Col {
  header: string;
  width: number;
  numFmt?: string;
  money?: boolean;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent' });
}

/** Дата продажи как календарный день Ташкента — чтобы Excel не сдвигал её часовым поясом. */
function saleDay(iso: string): Date {
  const [d, m, y] = fmtDate(new Date(iso)).split('.').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Шапка отчёта над таблицей; возвращает номер строки заголовков таблицы. */
function writeHeader(ws: Worksheet, title: string, input: HierarchyExportInput, cols: Col[]): number {
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `Выбор: ${input.scopeLabel}`;
  ws.getCell('A3').value = `Период: ${input.periodLabel}`;
  ws.getCell('A4').value = `Сформирован: ${fmtDate(input.generatedAt ?? new Date())}`;
  for (const r of [2, 3, 4]) ws.getCell(`A${r}`).font = { color: { argb: 'FF595959' } };

  const headerRow = 6;
  ws.getRow(headerRow).values = cols.map((c) => c.header);
  ws.getRow(headerRow).font = { bold: true };
  ws.getRow(headerRow).alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(headerRow).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF8' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8EA3C7' } } };
  });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.numFmt) col.numFmt = c.numFmt;
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  return headerRow;
}

function addTotal(ws: Worksheet, values: (string | number | null)[]) {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.border = { top: { style: 'thin', color: { argb: 'FF8EA3C7' } } };
  });
}

function withoutMoney(cols: Col[], moneyHidden: boolean): Col[] {
  return moneyHidden ? cols.filter((c) => !c.money) : cols;
}

/** Убирает значения денежных колонок так же, как `withoutMoney` убирает сами колонки. */
function pick<T>(cols: Col[], moneyHidden: boolean, values: T[]): T[] {
  return moneyHidden ? values.filter((_, i) => !cols[i].money) : values;
}

/** «1 товар», «3 товара», «12 товаров». */
function goods(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'товар' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'товара' : 'товаров';
  return `${n} ${word}`;
}

function byText(a: string, b: string): number {
  return a.localeCompare(b, 'ru');
}

export async function buildHierarchyWorkbook(input: HierarchyExportInput): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Polygraph Business CRM';
  wb.created = input.generatedAt ?? new Date();

  const rows = [...input.rows].sort((a, b) => a.saleAt.localeCompare(b.saleAt));
  const { moneyHidden } = input;

  // ── 1. Товары ──
  {
    const all: Col[] = [
      { header: '№', width: 5 },
      { header: 'Категория', width: 22 },
      { header: 'Тип', width: 20 },
      { header: 'Товар', width: 44 },
      { header: 'Артикул', width: 14 },
      { header: 'Ед.', width: 7 },
      { header: 'Продано', width: 12, numFmt: QTY_FMT },
      { header: 'Выручка', width: 16, numFmt: MONEY_FMT, money: true },
      { header: 'Средняя цена', width: 14, numFmt: MONEY_FMT, money: true },
      { header: 'Сделок', width: 9 },
      { header: 'Клиентов', width: 10 },
      { header: 'Последняя продажа', width: 14, numFmt: DATE_FMT },
    ];
    const cols = withoutMoney(all, moneyHidden);
    const ws = wb.addWorksheet('Товары');
    const headerRow = writeHeader(ws, 'Товары и проданное количество', input, cols);

    const agg = new Map<string, { qty: number; revenue: number; deals: Set<string>; clients: Set<string>; last: string }>();
    for (const r of rows) {
      const a = agg.get(r.productId) ?? { qty: 0, revenue: 0, deals: new Set(), clients: new Set(), last: r.saleAt };
      a.qty += r.soldQty;
      a.revenue += r.salesRevenue;
      a.deals.add(r.dealId);
      a.clients.add(r.clientId);
      if (r.saleAt > a.last) a.last = r.saleAt;
      agg.set(r.productId, a);
    }
    const list = [...agg.entries()]
      .map(([id, a]) => ({ p: input.product(id), ...a }))
      .sort((x, y) => byText(x.p.category, y.p.category) || byText(x.p.type, y.p.type) || y.qty - x.qty);
    list.forEach((x, i) => {
      ws.addRow(pick(all, moneyHidden, [
        i + 1, x.p.category, x.p.type, x.p.name, x.p.sku, x.p.unit, x.qty,
        x.revenue, x.qty > 0 ? Math.round(x.revenue / x.qty) : null,
        x.deals.size, x.clients.size, saleDay(x.last),
      ]));
    });
    const units = new Set(list.map((x) => x.p.unit));
    addTotal(ws, pick(all, moneyHidden, [
      null, 'Итого', null, goods(list.length), null, units.size === 1 ? [...units][0] : null,
      // Разные единицы (кг и шт) не складываем
      units.size === 1 ? list.reduce((s, x) => s + x.qty, 0) : null,
      list.reduce((s, x) => s + x.revenue, 0), null,
      new Set(rows.map((r) => r.dealId)).size, new Set(rows.map((r) => r.clientId)).size, null,
    ]));
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length } };
  }

  // ── 2. Клиенты ──
  {
    const all: Col[] = [
      { header: 'Клиент', width: 34 },
      { header: 'Категория', width: 20 },
      { header: 'Тип', width: 18 },
      { header: 'Товар', width: 40 },
      { header: 'Ед.', width: 7 },
      { header: 'Количество', width: 12, numFmt: QTY_FMT },
      { header: 'Сумма', width: 16, numFmt: MONEY_FMT, money: true },
      { header: 'Сделок', width: 9 },
      { header: 'Первая покупка', width: 14, numFmt: DATE_FMT },
      { header: 'Последняя покупка', width: 14, numFmt: DATE_FMT },
      { header: 'Даты покупок', width: 40 },
    ];
    const cols = withoutMoney(all, moneyHidden);
    const ws = wb.addWorksheet('Клиенты');
    const headerRow = writeHeader(ws, 'Сводка по клиентам и товарам', input, cols);

    type Line = { productId: string; qty: number; revenue: number; deals: Set<string>; days: Set<string>; first: string; last: string };
    const byClient = new Map<string, { name: string; lines: Map<string, Line> }>();
    for (const r of rows) {
      const c = byClient.get(r.clientId) ?? { name: r.clientName, lines: new Map<string, Line>() };
      const l = c.lines.get(r.productId) ?? { productId: r.productId, qty: 0, revenue: 0, deals: new Set(), days: new Set(), first: r.saleAt, last: r.saleAt };
      l.qty += r.soldQty;
      l.revenue += r.salesRevenue;
      l.deals.add(r.dealId);
      l.days.add(fmtDate(new Date(r.saleAt)));
      if (r.saleAt < l.first) l.first = r.saleAt;
      if (r.saleAt > l.last) l.last = r.saleAt;
      c.lines.set(r.productId, l);
      byClient.set(r.clientId, c);
    }
    // Крупные клиенты сверху; внутри клиента — товары по категории и сумме
    const clients = [...byClient.values()]
      .map((c) => ({ ...c, revenue: [...c.lines.values()].reduce((s, l) => s + l.revenue, 0), qty: [...c.lines.values()].reduce((s, l) => s + l.qty, 0) }))
      .sort((a, b) => (moneyHidden ? b.qty - a.qty : b.revenue - a.revenue) || byText(a.name, b.name));

    for (const c of clients) {
      const lines = [...c.lines.values()].map((l) => ({ ...l, p: input.product(l.productId) }))
        .sort((a, b) => byText(a.p.category, b.p.category) || b.revenue - a.revenue || b.qty - a.qty);
      lines.forEach((l, i) => {
        ws.addRow(pick(all, moneyHidden, [
          i === 0 ? c.name : '', l.p.category, l.p.type, l.p.name, l.p.unit, l.qty, l.revenue,
          l.deals.size, saleDay(l.first), saleDay(l.last), [...l.days].join(', '),
        ]));
      });
      const units = new Set(lines.map((l) => l.p.unit));
      const sub = ws.addRow(pick(all, moneyHidden, [
        `Итого: ${c.name}`, null, null, goods(lines.length), units.size === 1 ? [...units][0] : null,
        units.size === 1 ? c.qty : null, c.revenue,
        new Set(lines.flatMap((l) => [...l.deals])).size, null, null, null,
      ]));
      sub.font = { bold: true };
      sub.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FB' } };
      });
    }
    addTotal(ws, pick(all, moneyHidden, [
      `Всего клиентов: ${clients.length}`, null, null, null, null, null,
      clients.reduce((s, c) => s + c.revenue, 0), new Set(rows.map((r) => r.dealId)).size, null, null, null,
    ]));
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length } };
  }

  // ── 3. Данные ──
  {
    const all: Col[] = [
      { header: 'Дата', width: 12, numFmt: DATE_FMT },
      { header: 'Сделка', width: 30 },
      { header: 'ID сделки', width: 38 },
      { header: 'Клиент', width: 34 },
      { header: 'Категория', width: 20 },
      { header: 'Тип', width: 18 },
      { header: 'Товар', width: 40 },
      { header: 'Артикул', width: 14 },
      { header: 'Ед.', width: 7 },
      { header: 'Количество', width: 12, numFmt: QTY_FMT },
      { header: 'Цена', width: 13, numFmt: MONEY_FMT, money: true },
      { header: 'Сумма', width: 16, numFmt: MONEY_FMT, money: true },
    ];
    const cols = withoutMoney(all, moneyHidden);
    const ws = wb.addWorksheet('Данные');
    const headerRow = writeHeader(ws, 'Исходные строки продаж (из них собраны листы «Товары» и «Клиенты»)', input, cols);
    for (const r of rows) {
      const p = input.product(r.productId);
      ws.addRow(pick(all, moneyHidden, [
        saleDay(r.saleAt), r.dealTitle, r.dealId, r.clientName, p.category, p.type, p.name, p.sku, p.unit,
        r.soldQty, r.soldQty > 0 ? Math.round(r.salesRevenue / r.soldQty) : null, r.salesRevenue,
      ]));
    }
    addTotal(ws, pick(all, moneyHidden, [
      null, `Строк: ${rows.length}`, null, null, null, null, null, null, null, null, null,
      rows.reduce((s, r) => s + r.salesRevenue, 0),
    ]));
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length } };
  }

  return wb;
}

export async function buildHierarchyXlsx(input: HierarchyExportInput): Promise<Blob> {
  const wb = await buildHierarchyWorkbook(input);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
