import type { Role } from '@prisma/client';

/**
 * Себестоимость (цена закупки) и всё, из чего её можно вычислить: маржа, валовая
 * прибыль, COGS, «замороженный капитал» по закупке.
 *
 * Видят её только ADMIN и SUPER_ADMIN — и только пока открыт доступ по личному ПИН
 * (10 минут или час, срок хранится в сессии входа: Session.costUnlockedUntil).
 * Всем остальным и админам без ПИН сервер вычищает эти поля из любого JSON-ответа
 * в `authenticate` — так же, как `moneyAccess` вычищает деньги. Маской на фронте
 * это не сделать: F12 → Network показывает ответ целиком.
 *
 * ИИ (AI-ассистент, РОП-агент) текст отвечает свободно, поэтому там отдельная защита:
 * запрет слов в SQL + вычистка тех же ключей из результатов (см. `isCostSql`, `stripCostDeep`).
 */

export const COST_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN'];

export const COST_UNLOCK_MINUTES = { short: 10, long: 60 } as const;
export const COST_PIN_MAX_ATTEMPTS = 5;
export const COST_PIN_LOCK_MINUTES = 15;

/** Код ошибки: фронт по нему предлагает ввести ПИН. */
export const COST_ACCESS_REQUIRED = 'COST_ACCESS_REQUIRED';

export function canHaveCostAccess(role: string | undefined): boolean {
  return !!role && (COST_ROLES as readonly string[]).includes(role);
}

/** Открыт ли сейчас доступ к себестоимости у этого пользователя запроса. */
export function hasCostAccess(user?: { role: string; costUnlockedUntil?: Date | null }): boolean {
  if (!user || !canHaveCostAccess(user.role)) return false;
  return !!user.costUnlockedUntil && user.costUnlockedUntil.getTime() > Date.now();
}

/**
 * Ключ ответа, в котором себестоимость или производное от неё. Сравнение без регистра
 * и подчёркиваний: `purchase_price`, `purchasePrice`, `margin_now_pct` — всё одно.
 * Счётчики вроде `purchases` (сколько раз покупал клиент) сюда не попадают, CSS-отступы
 * (`marginTop` в настройках сайта) — тоже.
 */
const COST_KEY_RE = /purchaseprice|costprice|^cost$|cogs|totalcost|unitcost|margin(?!top|bottom|left|right|inline|block|x$|y$)|markup|grossprofit|netprofit|frozencapital|frozenvalue|frozenbypurchase|^frozen$/;

export function isCostKey(key: string): boolean {
  return COST_KEY_RE.test(key.toLowerCase().replace(/_/g, ''));
}

/** Строка, в которой явно лежит себестоимость (JSON товара, приведённый к тексту и т.п.). */
const COST_TEXT_RE = /purchase_?price|cost_?price/i;

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const isScalarNumber = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && NUMERIC_STRING.test(v));

/** Prisma Decimal и Date — объекты с toJSON: обходить их по полям нельзя. */
const toPlain = (v: unknown): unknown =>
  v && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function'
    ? (v as { toJSON: () => unknown }).toJSON()
    : v;

/**
 * Копия тела ответа, где числовые значения под «себестоимостными» ключами заменены на null.
 * Массивы и объекты под такими ключами (напр. `profitability`) обходятся внутрь, а не
 * обнуляются целиком — иначе фронт упадёт на `null.x`. Исходник не мутирует.
 */
export function redactCost<T>(body: T): T {
  const walk = (raw: unknown): unknown => {
    const value = toPlain(raw);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const plain = toPlain(v);
        out[k] = isScalarNumber(plain) && isCostKey(k) ? null : walk(plain);
      }
      return out;
    }
    return value;
  };
  return walk(body) as T;
}

/**
 * Жёсткая версия для результатов SQL, которые уходят в ИИ: ключ удаляется целиком
 * (что бы там ни лежало), а строки с упоминанием закупочной цены заменяются заглушкой —
 * это ловит `to_jsonb(p)::text` и JSON из audit_logs.
 */
export function stripCostDeep(value: unknown): unknown {
  const v = toPlain(value);
  if (typeof v === 'string') return COST_TEXT_RE.test(v) ? '[скрыто]' : v;
  if (Array.isArray(v)) return v.map(stripCostDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
      if (isCostKey(k)) continue;
      out[k] = stripCostDeep(inner);
    }
    return out;
  }
  return v;
}

/**
 * SQL от ИИ, который трогает себестоимость: колонки цены закупки, заказы у поставщиков
 * (там закупочные цены за единицу) или целые строки товаров (`p.*`, `to_jsonb(p)` —
 * их результат потом вычищается `stripCostDeep`, но и сам запрос лучше не пускать).
 */
const COST_SQL_RE = /purchase_price|cost_price|\bimport_order_items\b|\bimport_orders\b|\bcogs\b|\bmargin/i;

export function isCostSql(sql: string): boolean {
  return COST_SQL_RE.test(sql);
}

export const COST_AI_REFUSAL =
  'Себестоимость и цены закупки закрыты: ИИ их не видит. Откройте их в CRM по своему ПИН-коду.';
