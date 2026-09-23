import type { MoneyAccess } from '@prisma/client';
import { AppError } from './errors';

/**
 * Серверное ограничение доступа к деньгам (User.moneyAccess).
 *
 * Работает в двух режимах, оба применяются в `authenticate` на каждый запрос:
 *  1. Целые разделы закрыты — 403 ещё до контроллера (KPI, касса, расходы…).
 *  2. Из тела любого JSON-ответа рекурсивно вычищаются денежные поля: значение
 *     заменяется на null. Фронт показывает null как «•••».
 *
 * Именно так, а не маской на фронте: маска защищает от взгляда через плечо,
 * а F12 → Network показывает ответ сервера целиком.
 *
 * Поля определяются по ИМЕНИ ключа правилами, а не списком: в аналитике десятки
 * вариаций (totalCollected, revenueTotal, avgDealSize…), точный список их пропускает.
 * Обнуляются только скалярные значения (число или числовая строка — Prisma Decimal
 * приходит строкой). Массивы и объекты под «денежным» ключом (напр. `debtors`)
 * не обнуляются, а обходятся внутрь — иначе фронт падает на `null.map`.
 *
 * Цена за единицу (`price`, `salePrice`, `installmentPrice`) видна на любом уровне —
 * без неё не составить сделку. Всё, что из цен складывается или их объясняет, — режется.
 */

/** Ключи с такими окончаниями — не деньги: даты, счётчики, идентификаторы, доли. */
const NOT_MONEY_SUFFIX = /(At|Date|Count|Id|Ids|Percent|Pct|Ratio|Qty|Quantity|Status|Method|Type)$/;

/**
 * Стратегическое: маржа, обороты, зарплаты и любые агрегаты по компании.
 * Скрыто на NO_STRATEGIC и NONE.
 *
 * `total*` по деньгам сюда, а не в MONEY: сумма оплат и сумма долгов по всем
 * сделкам вместе дают выручку. Поштучные `amount`/`paidAmount`/`debt` сделки
 * или клиента остаются видны менеджеру на NO_STRATEGIC.
 */
const STRATEGIC_RE = new RegExp([
  'revenue', 'purchase', 'costprice', '^cost$', 'margin', 'profit',
  'stockvalue', 'frozenvalue', 'salary', 'bonus', 'payout',
  'avgdeal', 'avgcheck', 'dealsize',
  'netbalance', 'openingbalance', 'closingbalance',
  '^total(amount|paid|debt|debtpositive|collected|dealsamount|sum|income|expense)$',
].join('|'), 'i');

/** Деньги вообще: суммы сделок, оплаты, долги. Скрыто только на NONE. */
const MONEY_RE = new RegExp([
  'amount', 'paid', 'debt', 'balance', 'collected', 'discount', 'vat',
  '^total$', '^sum$', 'summa', 'linetotal', 'subtotal', 'income', 'expense', 'cash', 'overdue',
].join('|'), 'i');

/**
 * Разделы, закрытые целиком (путь без /api). Всё, что тут не перечислено,
 * отдаётся с вычищенными полями — например, /dashboard/analytics остаётся ради
 * счётчиков сделок, а выручка в нём обнуляется.
 */
const STRATEGIC_PATHS: RegExp[] = [
  // Аналитика закрыта, кроме истории клиентов (матрица активности, иерархия, когорты):
  // это рабочий инструмент менеджера, а суммы в ней вырезает фильтр полей.
  /^\/analytics(?!\/(history|cohorts)(\/|$))(\/|$)/,
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

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const isMoneyScalar = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && NUMERIC_STRING.test(v));

/** Нужно ли скрыть значение под этим ключом на этом уровне. */
export function isMoneyKey(key: string, level: MoneyAccess): boolean {
  if (level === 'FULL' || NOT_MONEY_SUFFIX.test(key)) return false;
  if (STRATEGIC_RE.test(key)) return true;
  return isAllMoneyHidden(level) && MONEY_RE.test(key);
}

/**
 * Возвращает копию тела ответа с вычищенными денежными полями.
 * Не мутирует исходный объект (ответы бывают закэшированы).
 */
export function redactMoney<T>(body: T, level: MoneyAccess): T {
  if (level === 'FULL') return body;

  // Приводим значение к тому виду, каким его отдаст JSON.stringify. Prisma Decimal и Date —
  // объекты с toJSON: обходить их по полям нельзя, Decimal превратится в {s, e, d}
  // вместо «43000.00» — именно так ломались все цены и количества у таких пользователей.
  const toPlain = (v: unknown): unknown =>
    v && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function'
      ? (v as { toJSON: () => unknown }).toJSON()
      : v;

  const walk = (raw: unknown): unknown => {
    const value = toPlain(raw);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const plain = toPlain(v);
        out[k] = isMoneyScalar(plain) && isMoneyKey(k, level) ? null : walk(plain);
      }
      return out;
    }
    return value;
  };
  return walk(body) as T;
}
