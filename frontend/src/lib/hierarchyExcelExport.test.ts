import { describe, expect, it } from 'vitest';
import type { Worksheet } from 'exceljs';
import { buildHierarchyWorkbook, type ExportProductInfo } from './hierarchyExcelExport';
import type { ProductPurchaseRow } from './analyticsHierarchySales';

const products: Record<string, ExportProductInfo> = {
  p1: { name: 'Бумага A4', sku: 'A4', unit: 'пач', category: 'Бумага', type: 'Офисная' },
  p2: { name: 'Бумага A3', sku: 'A3', unit: 'пач', category: 'Бумага', type: 'Офисная' },
};

function row(over: Partial<ProductPurchaseRow>): ProductPurchaseRow {
  return {
    productId: 'p1', dealId: 'd1', dealTitle: 'Сделка 1', clientId: 'c1', clientName: 'ООО Альфа',
    clientIsSvip: false, soldQty: 10, salesRevenue: 1000, saleAt: '2026-03-10T06:00:00Z', ...over,
  };
}

const rows = [
  row({}),
  row({ dealId: 'd2', saleAt: '2026-04-02T06:00:00Z', soldQty: 5, salesRevenue: 500 }),
  row({ productId: 'p2', dealId: 'd3', clientId: 'c2', clientName: 'ООО Бета', soldQty: 2, salesRevenue: 400 }),
];

function values(ws: Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
  return out;
}

describe('buildHierarchyWorkbook', () => {
  const input = {
    rows,
    product: (id: string) => products[id],
    scopeLabel: 'Категория «Бумага»',
    periodLabel: '01.03.2026 — 30.04.2026',
    moneyHidden: false,
    generatedAt: new Date('2026-10-22T10:00:00Z'),
  };

  it('три листа в нужном порядке', async () => {
    const wb = await buildHierarchyWorkbook(input);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Товары', 'Клиенты', 'Данные']);
  });

  it('«Товары»: количество и выручка по товару, итог', async () => {
    const ws = (await buildHierarchyWorkbook(input)).getWorksheet('Товары')!;
    const v = values(ws);
    expect(v[1][0]).toBe('Выбор: Категория «Бумага»');
    const a4 = v.find((r) => r[3] === 'Бумага A4')!;
    expect(a4[6]).toBe(15); // продано
    expect(a4[7]).toBe(1500); // выручка
    expect(a4[9]).toBe(2); // сделок
    const total = v[v.length - 1];
    expect(total[1]).toBe('Итого');
    expect(total[6]).toBe(17); // одна единица — количество складывается
    expect(total[7]).toBe(1900);
  });

  it('«Клиенты»: строки товаров и итог по клиенту с датами покупок', async () => {
    const v = values((await buildHierarchyWorkbook(input)).getWorksheet('Клиенты')!);
    const alpha = v.find((r) => r[0] === 'ООО Альфа')!;
    expect(alpha[5]).toBe(15);
    expect(alpha[6]).toBe(1500);
    expect(alpha[10]).toBe('10.03.2026, 02.04.2026');
    expect(v.some((r) => r[0] === 'Итого: ООО Альфа')).toBe(true);
  });

  it('«Данные»: каждая строка продажи', async () => {
    const v = values((await buildHierarchyWorkbook(input)).getWorksheet('Данные')!);
    const headerAt = v.findIndex((r) => r[0] === 'Дата');
    const data = v.slice(headerAt + 1, -1);
    expect(data).toHaveLength(3);
    expect(v[v.length - 1][11]).toBe(1900);
  });

  it('без доступа к суммам денежных колонок нет', async () => {
    const ws = (await buildHierarchyWorkbook({ ...input, moneyHidden: true })).getWorksheet('Товары')!;
    const header = values(ws).find((r) => r[0] === '№')!;
    expect(header).not.toContain('Выручка');
    expect(header).not.toContain('Средняя цена');
    expect(header).toContain('Продано');
  });
});
