import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { COST_ACCESS_REQUIRED, hasCostAccess } from '../../lib/costAccess';
import {
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT,
  SQL_LINE_REVENUE_DI,
} from '../../lib/analytics/sqlFragments';

/**
 * Финансовый отчёт (P&L): товарооборот без НДС → себестоимость → валовая прибыль →
 * расходы (наличная часть / перечислением, по категориям из «Расходов») → чистая прибыль.
 *
 * Только ADMIN / SUPER_ADMIN и только с открытым по ПИН доступом к себестоимости:
 * без него authenticate всё равно вырезал бы себестоимость и прибыль из ответа,
 * поэтому отвечаем 403 COST_ACCESS_REQUIRED — фронт предложит ввести ПИН.
 * Путь лежит под /api/finance, так что урезанный moneyAccess сюда тоже не пускает.
 */

const router = Router();
router.use(authenticate);

/** НДС в цене строки сделки (цены в CRM — с НДС, см. deals.service includeVat). */
const VAT_RATE = 0.12;

/** Деньги ушли из кассы, но это не расход бизнеса — в отчёт не входят, показываются отдельно. */
const NON_OPERATING_CATEGORIES = ['Выдача владельцу', 'Возврат залога'];

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from: YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to: YYYY-MM-DD'),
});

type Part = 'cash' | 'transfer';

interface PartTotals {
  revenueGross: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

const emptyPart = (): PartTotals => ({ revenueGross: 0, revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0 });

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (let guard = 0; guard < 120; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

router.get(
  '/',
  authorize('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!hasCostAccess(req.user)) {
      throw new AppError(403, 'Финансовый отчёт открывается по ПИН-коду себестоимости', COST_ACCESS_REQUIRED);
    }
    const { from, to } = querySchema.parse(req.query);
    if (from > to) throw new AppError(400, 'Начало периода позже конца');
    const months = monthsBetween(from, to);
    if (months.length > 36) throw new AppError(400, 'Период не больше 36 месяцев');

    const monthOfItem = Prisma.sql`to_char(${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT}, 'YYYY-MM')`;

    const [salesRaw, expensesRaw, skippedFxRaw] = await Promise.all([
      prisma.$queryRaw<{
        month: string;
        is_transfer: boolean;
        revenue_gross: string;
        cogs: string;
        lines_no_cost: string;
        revenue_no_cost: string;
      }[]>(Prisma.sql`
        SELECT ${monthOfItem} AS month,
               (d.payment_method = 'TRANSFER') IS TRUE AS is_transfer,
               COALESCE(SUM(${SQL_LINE_REVENUE_DI}), 0)::text AS revenue_gross,
               COALESCE(SUM(di.requested_qty * pr.purchase_price), 0)::text AS cogs,
               COUNT(*) FILTER (WHERE pr.purchase_price IS NULL OR pr.purchase_price = 0)::text AS lines_no_cost,
               COALESCE(SUM(${SQL_LINE_REVENUE_DI}) FILTER (WHERE pr.purchase_price IS NULL OR pr.purchase_price = 0), 0)::text AS revenue_no_cost
          FROM deal_items di
          JOIN deals d ON d.id = di.deal_id
          JOIN products pr ON pr.id = di.product_id
         WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
           AND di.requested_qty IS NOT NULL
           AND ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT} >= ${from}::date
           AND ${SQL_EFFECTIVE_REVENUE_ITEM_DATE_TASHKENT} <= ${to}::date
         GROUP BY 1, 2`),
      // Сумма в сумах: для UZS — amount, для валюты — amount_uzs (эквивалент по курсу ЦБ).
      prisma.$queryRaw<{ month: string; category: string; is_transfer: boolean; total: string; cnt: string }[]>(Prisma.sql`
        SELECT to_char(e.date, 'YYYY-MM') AS month,
               e.category,
               (e.method = 'TRANSFER') IS TRUE AS is_transfer,
               SUM(CASE WHEN e.currency IS NULL OR e.currency = 'UZS' THEN e.amount ELSE e.amount_uzs END)::text AS total,
               COUNT(*)::text AS cnt
          FROM expenses e
         WHERE e.status = 'APPROVED'
           AND e.date >= ${from}::date AND e.date <= ${to}::date
           AND (e.currency IS NULL OR e.currency = 'UZS' OR e.amount_uzs IS NOT NULL)
         GROUP BY 1, 2, 3`),
      prisma.$queryRaw<{ cnt: string }[]>(Prisma.sql`
        SELECT COUNT(*)::text AS cnt
          FROM expenses e
         WHERE e.status = 'APPROVED'
           AND e.date >= ${from}::date AND e.date <= ${to}::date
           AND e.currency IS NOT NULL AND e.currency <> 'UZS' AND e.amount_uzs IS NULL`),
    ]);

    const parts: Part[] = ['cash', 'transfer'];
    const byMonth = new Map<string, Record<Part, PartTotals>>(
      months.map((m) => [m, { cash: emptyPart(), transfer: emptyPart() }]),
    );
    const partOf = (isTransfer: boolean): Part => (isTransfer ? 'transfer' : 'cash');

    let linesNoCost = 0;
    let revenueNoCost = 0;
    for (const r of salesRaw) {
      const slot = byMonth.get(r.month);
      if (!slot) continue;
      const p = slot[partOf(r.is_transfer)];
      const gross = Number(r.revenue_gross);
      p.revenueGross += gross;
      p.revenue += gross / (1 + VAT_RATE);
      p.cogs += Number(r.cogs);
      linesNoCost += Number(r.lines_no_cost);
      revenueNoCost += Number(r.revenue_no_cost);
    }

    // Расходы: категория → часть → месяц
    const expenseRows = new Map<string, { category: string; part: Part; byMonth: Record<string, number>; total: number; count: number }>();
    const nonOperating = new Map<string, { category: string; byMonth: Record<string, number>; total: number }>();
    for (const r of expensesRaw) {
      const amount = Number(r.total);
      if (!byMonth.has(r.month)) continue;
      if (NON_OPERATING_CATEGORIES.includes(r.category)) {
        const row = nonOperating.get(r.category) ?? { category: r.category, byMonth: {}, total: 0 };
        row.byMonth[r.month] = (row.byMonth[r.month] ?? 0) + amount;
        row.total += amount;
        nonOperating.set(r.category, row);
        continue;
      }
      const part = partOf(r.is_transfer);
      const key = `${part}|${r.category}`;
      const row = expenseRows.get(key) ?? { category: r.category, part, byMonth: {}, total: 0, count: 0 };
      row.byMonth[r.month] = (row.byMonth[r.month] ?? 0) + amount;
      row.total += amount;
      row.count += Number(r.cnt);
      expenseRows.set(key, row);
      byMonth.get(r.month)![part].expenses += amount;
    }

    const total: Record<Part, PartTotals> = { cash: emptyPart(), transfer: emptyPart() };
    for (const slot of byMonth.values()) {
      for (const part of parts) {
        const p = slot[part];
        p.grossProfit = p.revenue - p.cogs;
        p.netProfit = p.grossProfit - p.expenses;
        for (const k of Object.keys(p) as (keyof PartTotals)[]) total[part][k] += p[k];
      }
    }

    const sumParts = (s: Record<Part, PartTotals>): PartTotals => {
      const out = emptyPart();
      for (const part of parts) for (const k of Object.keys(out) as (keyof PartTotals)[]) out[k] += s[part][k];
      return out;
    };
    const roundPart = (p: PartTotals): PartTotals =>
      Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round2(v)])) as unknown as PartTotals;
    const roundMap = (m: Record<string, number>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round2(v)]));

    const sortRows = <T extends { total: number }>(rows: T[]) => rows.sort((a, b) => b.total - a.total);

    res.json({
      from,
      to,
      months,
      vatRate: VAT_RATE,
      columns: months.map((m) => {
        const slot = byMonth.get(m)!;
        return { month: m, cash: roundPart(slot.cash), transfer: roundPart(slot.transfer), all: roundPart(sumParts(slot)) };
      }),
      total: { cash: roundPart(total.cash), transfer: roundPart(total.transfer), all: roundPart(sumParts(total)) },
      expenses: {
        cash: sortRows([...expenseRows.values()].filter((r) => r.part === 'cash'))
          .map((r) => ({ category: r.category, count: r.count, total: round2(r.total), byMonth: roundMap(r.byMonth) })),
        transfer: sortRows([...expenseRows.values()].filter((r) => r.part === 'transfer'))
          .map((r) => ({ category: r.category, count: r.count, total: round2(r.total), byMonth: roundMap(r.byMonth) })),
      },
      nonOperating: sortRows([...nonOperating.values()])
        .map((r) => ({ category: r.category, total: round2(r.total), byMonth: roundMap(r.byMonth) })),
      warnings: {
        linesWithoutPurchasePrice: linesNoCost,
        revenueWithoutPurchasePrice: round2(revenueNoCost),
        foreignExpensesWithoutRate: Number(skippedFxRaw[0]?.cnt ?? 0),
      },
    });
  }),
);

export { router as financeReportRoutes };
