import type { MoneyAccess } from '@prisma/client';
import { AppError } from './errors';

/**
 * Серверное ограничение доступа к деньгам (User.moneyAccess).
 *
 * Работает в двух режимах, оба применяются в `authenticate` на каждый запрос:
 *  1. Целые разделы закрыты — 403 ещё до контроллера (аналитика, касса, расходы…).
 *  2. Из тела любого JSON-ответа рекурсивно вычищаются денежные поля: значение
 *     заменяется на null. Фронт показывает null как «•••».
 *
 * Именно так, а не маской на фронте: маска защищает от взгляда через плечо,
 * а F12 → Network показывает ответ сервера целиком.
 *
 * Ключи подобраны по именам полей в ответах API. Единичная цена товара
 * (`price`, `salePrice`, `installmentPrice`) видна на любом уровне — без неё
 * не составить сделку. Всё, что из цен складывается или их объясняет, — режется.
 */

/** Стратегическое: маржа, обороты, зарплаты. Скрыто на NO_STRATEGIC и NONE. */
const STRATEGIC_KEYS = new Set([
  'purchasePrice', 'purchase_price', 'costPrice', 'cost',
  'revenue', 'revenueToday', 'revenueYesterday', 'revenueMonth', 'revenueLast30Days',
  'revenue90d', 'totalRevenue', 'monthRevenue', 'dailyRevenue',
  'margin', 'marginPct', 'profit', 'grossProfit', 'netProfit',
  'totalStockValueSale', 'totalStockValuePurchase', 'stockValue', 'frozenValue',
  'monthlyRevenueGoal', 'dailyRevenueGoal',
  'salary', 'fixedSalary', 'bonus', 'totalPayout', 'payout',
]);

/** Деньги вообще: суммы сделок, оплаты, долги. Скрыто только на NONE. */
const MONEY_KEYS = new Set([
  'amount', 'paidAmount', 'paid_amount', 'lineTotal', 'line_total', 'closingBalance',
  'total', 'subtotal', 'totalAmount', 'totalPaid', 'sum', 'summa',
  'debt', 'clientDebt', 'totalDebt', 'balance', 'overdue', 'overdueAmount',
  'discount', 'vatAmount', 'totalWithVat', 'amountWithVat', 'amountWithoutVat',
  'cashIn', 'cashOut', 'income', 'expense', 'expenses',
]);

/**
 * Разделы, закрытые целиком (req.path без /api). Всё, что тут не перечислено,
 * отдаётся с вычищенными полями — например, /dashboard/analytics остаётся ради
 * счётчиков сделок, а выручка в нём обнуляется.
 */
const STRATEGIC_PATHS: RegExp[] = [
  /^\/analytics(\/|$)/,           // вся аналитика, включая KPI, бонусы, отчёты отделов
  /^\/finance(\/|$)/,             // касса, баланс компании
  /^\/expenses(\/|$)/,
  /^\/timepay(\/|$)/,             // зарплатный учёт
  /^\/dashboard\/revenue-today/,
  /^\/users\/[^/]+\/kpi/,
  /^\/users\/[^/]+\/monthly-goal/,
  /^\/users\/monthly-goals/,
];

export function isStrategicHidden(level: MoneyAccess): boolean {
  return level !== 'FULL';
}

export function isAllMoneyHidden(level: MoneyAccess): boolean {
  return level === 'NONE';
}

/** Бросает 403, если раздел закрыт для этого уровня. */
export function assertPathAllowed(level: MoneyAccess, path: string): void {
  if (!isStrategicHidden(level)) return;
  const p = path.replace(/^\/api/, '');
  if (STRATEGIC_PATHS.some((re) => re.test(p))) {
    throw new AppError(403, 'Этот раздел недоступен: у вас ограничен доступ к финансовым данным');
  }
}

/**
 * Возвращает копию тела ответа с вычищенными денежными полями.
 * Не трогает примитивы верхнего уровня и не мутирует исходный объект.
 */
export function redactMoney<T>(body: T, level: MoneyAccess): T {
  if (level === 'FULL') return body;
  const hideAll = isAllMoneyHidden(level);
  const hidden = (key: string) => STRATEGIC_KEYS.has(key) || (hideAll && MONEY_KEYS.has(key));

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = hidden(k) ? null : walk(v);
      }
      return out;
    }
    return value;
  };
  return walk(body) as T;
}
