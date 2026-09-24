import type Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  SQL_ANALYTICS_LINE_REVENUE_DI,
  SQL_DEALS_REVENUE_ANALYTICS_FILTER,
  SQL_EFFECTIVE_REVENUE_ITEM_TS,
  SQL_EXCLUDE_INTERNAL_COMPANY_PRODUCT,
} from '../../lib/analytics';
import { CATALOG_LINKS, normalizeSku } from '../market/marketCatalogLinks';
import { livePriceRows, loadPriceBySku } from '../market/market.service';
import { OUR_ONLY_ROWS, THEIR_ONLY_ROWS } from '../market/uniqueProductsComparisonData';

/**
 * Инструменты РОП-агента. На первом этапе — только чтение: агент смотрит данные
 * и предлагает, а ничего не меняет. Всё, что пишет в базу (задачи менеджерам),
 * появится отдельными инструментами с подтверждением директора.
 */

/** Больше в модель не отдаём: длинный результат съедает контекст всего чата. */
const MAX_RESULT_CHARS = 60_000;
const SQL_ROW_LIMIT = 200;

// ─── Защита SQL ─────────────────────────────────────────────────────────────

// Первая линия. Главная защита — транзакция READ ONLY в runReadOnly: здесь слова вроде
// `comment` не запрещаем, это имя колонки (deal_ratings.comment).
const FORBIDDEN_SQL = /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|copy|call|execute|vacuum|refresh|listen|notify|lock|prepare|set_config|setval|nextval|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|pg_cancel_backend|lo_import|lo_export|dblink)\b/i;

/**
 * Секреты не должны попадать ни в модель, ни в чат: хэши паролей, токены сессий
 * и ботов. Режем дважды — по тексту запроса и по именам колонок в ответе
 * (второе ловит `SELECT *`).
 */
const SECRET_NAME = /(password|passwd|token|secret|api_?key|signature|otp|hash)/i;
const SECRET_TABLES = /\b(sessions|refresh_tokens|push_subscriptions)\b/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Возвращает запрос без завершающей «;» или бросает ошибку с понятной причиной. */
export function validateReadOnlySql(raw: string): string {
  const sql = stripSqlComments(raw).trim().replace(/;\s*$/, '').trim();
  if (!sql) throw new Error('Пустой запрос');
  if (sql.includes(';')) throw new Error('Разрешён только один запрос, без «;» внутри');
  if (!/^(select|with)\b/i.test(sql)) throw new Error('Разрешены только SELECT / WITH');
  if (FORBIDDEN_SQL.test(sql)) throw new Error('Запрос содержит запрещённое слово (изменение данных или служебная команда)');
  if (SECRET_NAME.test(sql) || SECRET_TABLES.test(sql)) {
    throw new Error('Пароли, токены и сессии недоступны агенту');
  }
  return sql;
}

/** BigInt и Decimal → числа, даты → ISO, секретные колонки → вон. */
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return Number(value);
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_NAME.test(k)) continue;
      out[k] = toPlain(v);
    }
    return out;
  }
  return value;
}

/**
 * Запрос выполняется в транзакции только для чтения и с таймаутом: даже если
 * проверка текста что-то пропустит, Postgres сам не даст ничего изменить.
 */
async function runReadOnly<T>(sql: string): Promise<T[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '20s'`);
    return tx.$queryRawUnsafe<T[]>(sql);
  }, { timeout: 30_000 });
}

// ─── Инструменты ────────────────────────────────────────────────────────────

async function describeTables(input: { tables?: string[] }) {
  const names = (input.tables ?? []).map((t) => t.trim()).filter(Boolean);
  if (!names.length) {
    const rows = await prisma.$queryRaw<{ table_name: string; columns: number }[]>`
      SELECT table_name, COUNT(*)::int AS columns
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name NOT LIKE '\\_prisma%'
      GROUP BY table_name ORDER BY table_name`;
    return { tables: rows.filter((r) => !SECRET_TABLES.test(r.table_name)) };
  }
  const rows = await prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string }[]>`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${names})
    ORDER BY table_name, ordinal_position`;
  const enums = await prisma.$queryRaw<{ enum_name: string; values: string[] }[]>`
    SELECT t.typname AS enum_name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    GROUP BY t.typname`;
  const enumByName = new Map(enums.map((e) => [e.enum_name, e.values]));
  const byTable: Record<string, { column: string; type: string; nullable: boolean; values?: string[] }[]> = {};
  for (const r of rows) {
    if (SECRET_TABLES.test(r.table_name) || SECRET_NAME.test(r.column_name)) continue;
    const isEnum = r.data_type === 'USER-DEFINED' && enumByName.has(r.udt_name);
    (byTable[r.table_name] ??= []).push({
      column: r.column_name,
      type: isEnum ? `enum ${r.udt_name}` : r.data_type,
      nullable: r.is_nullable === 'YES',
      ...(isEnum ? { values: enumByName.get(r.udt_name) } : {}),
    });
  }
  const missing = names.filter((n) => !byTable[n]);
  return { tables: byTable, ...(missing.length ? { not_found: missing } : {}) };
}

async function runSql(input: { sql: string }) {
  const sql = validateReadOnlySql(input.sql);
  const rows = await runReadOnly<Record<string, unknown>>(
    `SELECT * FROM (${sql}) AS agent_query LIMIT ${SQL_ROW_LIMIT + 1}`,
  );
  const truncated = rows.length > SQL_ROW_LIMIT;
  return {
    row_count: Math.min(rows.length, SQL_ROW_LIMIT),
    truncated,
    rows: toPlain(rows.slice(0, SQL_ROW_LIMIT)),
  };
}

type ProductEconomicsInput = {
  search?: string;
  category?: string;
  skus?: string[];
  days?: number;
  limit?: number;
};

type ProductEconomicsRow = {
  id: string;
  sku: string;
  name: string;
  unit: string | null;
  category: string | null;
  stock: number;
  sale_price: number | null;
  purchase_price: number | null;
  qty_sold: number;
  revenue: number;
  clients: number;
  last_sale_at: string | null;
};

/** Товары с экономикой: остаток, цены, маржа, продажи за период и когда продавался в последний раз. */
async function productEconomicsRows(input: ProductEconomicsInput): Promise<ProductEconomicsRow[]> {
  const days = Math.min(Math.max(Math.round(input.days ?? 90), 1), 1095);
  const limit = Math.min(Math.max(Math.round(input.limit ?? 50), 1), 200);
  const filters: Prisma.Sql[] = [Prisma.sql`p.is_active = true`, SQL_EXCLUDE_INTERNAL_COMPANY_PRODUCT];
  if (input.search?.trim()) {
    const q = `%${input.search.trim()}%`;
    filters.push(Prisma.sql`(p.name ILIKE ${q} OR p.sku ILIKE ${q})`);
  }
  if (input.category?.trim()) filters.push(Prisma.sql`p.category ILIKE ${`%${input.category.trim()}%`}`);
  if (input.skus?.length) {
    filters.push(Prisma.sql`LOWER(TRIM(p.sku)) = ANY(${input.skus.map(normalizeSku)})`);
  }

  const rows = await prisma.$queryRaw<ProductEconomicsRow[]>(Prisma.sql`
    WITH lines AS (
      SELECT di.product_id, di.requested_qty, d.client_id,
        ${SQL_ANALYTICS_LINE_REVENUE_DI} AS revenue,
        ${SQL_EFFECTIVE_REVENUE_ITEM_TS} AS ts
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE ${SQL_DEALS_REVENUE_ANALYTICS_FILTER}
    ),
    period AS (
      SELECT product_id, SUM(requested_qty) AS qty, SUM(revenue) AS revenue, COUNT(DISTINCT client_id) AS clients
      FROM lines WHERE ts >= NOW() - make_interval(days => ${days}::int)
      GROUP BY product_id
    ),
    last_sale AS (SELECT product_id, MAX(ts) AS last_sale_at FROM lines GROUP BY product_id)
    SELECT p.id, p.sku, p.name, p.unit, p.category,
      p.stock::float8 AS stock,
      p.sale_price::float8 AS sale_price,
      p.purchase_price::float8 AS purchase_price,
      COALESCE(pr.qty, 0)::float8 AS qty_sold,
      COALESCE(pr.revenue, 0)::float8 AS revenue,
      COALESCE(pr.clients, 0)::int AS clients,
      to_char(ls.last_sale_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS last_sale_at
    FROM products p
    LEFT JOIN period pr ON pr.product_id = p.id
    LEFT JOIN last_sale ls ON ls.product_id = p.id
    WHERE ${Prisma.join(filters, ' AND ')}
    ORDER BY COALESCE(pr.revenue, 0) DESC, p.stock DESC
    LIMIT ${limit}`);
  return rows;
}

function marginPct(price: number | null, cost: number | null): number | null {
  if (!price || cost == null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 1000) / 10;
}

async function productEconomics(input: ProductEconomicsInput) {
  const days = Math.min(Math.max(Math.round(input.days ?? 90), 1), 1095);
  const rows = await productEconomicsRows(input);
  return {
    period_days: days,
    products: rows.map((r) => {
      const dailyQty = r.qty_sold / days;
      return {
        ...r,
        margin_pct: marginPct(r.sale_price, r.purchase_price),
        stock_cover_days: dailyQty > 0 ? Math.round(r.stock / dailyQty) : null,
      };
    }),
  };
}

type MarketInput = {
  category?: string;
  competitor?: string;
  relation?: 'they_cheaper' | 'we_cheaper' | 'same' | 'all';
  include_unique?: boolean;
};

/**
 * Сравнение цен с конкурентами плюс наша экономика по каждой строке: закупка,
 * маржа сейчас и маржа, если опуститься до цены конкурента, остаток и продажи.
 * Именно это нужно, чтобы решать, где демпинговать, а где нет.
 */
async function marketComparison(input: MarketInput) {
  const priceBySku = await loadPriceBySku({ kind: 'trading' });
  let rows = livePriceRows(priceBySku);
  if (input.category?.trim()) {
    const c = input.category.trim().toLowerCase();
    rows = rows.filter((r) => r.category.toLowerCase().includes(c));
  }
  if (input.competitor?.trim()) {
    const c = input.competitor.trim().toLowerCase();
    rows = rows.filter((r) => r.competitor.toLowerCase().includes(c));
  }
  const relation = input.relation ?? 'all';
  if (relation !== 'all') {
    rows = rows.filter((r) => {
      if (r.competitorPrice == null) return false;
      if (relation === 'they_cheaper') return r.competitorPrice < r.ourPrice;
      if (relation === 'we_cheaper') return r.competitorPrice > r.ourPrice;
      return r.competitorPrice === r.ourPrice;
    });
  }

  const allSkus = [...new Set(rows.flatMap((r) => CATALOG_LINKS[r.ourProduct]?.skus ?? []))];
  const econ = allSkus.length
    ? await productEconomicsRows({ skus: allSkus, days: 90, limit: 200 })
    : [];
  const econBySku = new Map(econ.map((e) => [normalizeSku(e.sku), e]));

  const priceRows = rows.map((r) => {
    const link = CATALOG_LINKS[r.ourProduct];
    const perUnit = link?.perUnit ?? 1;
    const linked = (link?.skus ?? []).map((s) => econBySku.get(normalizeSku(s))).filter((e): e is ProductEconomicsRow => !!e);
    const costs = linked.map((e) => e.purchase_price).filter((c): c is number => c != null && c > 0).map((c) => c * perUnit);
    const cost = costs.length ? Math.max(...costs) : null; // консервативно: самая дорогая закупка
    return {
      category: r.category,
      our_product: r.ourProduct,
      competitor: r.competitor,
      competitor_product: r.competitorProduct,
      match: r.matchType,
      our_price: r.ourPrice,
      our_price_from_catalog: r.ourPriceFromCatalog,
      our_price_range: r.ourPriceRange,
      competitor_price: r.competitorPrice,
      diff_pct: r.competitorPrice != null && r.ourPrice > 0
        ? Math.round(((r.competitorPrice - r.ourPrice) / r.ourPrice) * 1000) / 10
        : null,
      purchase_price: cost,
      margin_now_pct: marginPct(r.ourPrice, cost),
      margin_at_competitor_price_pct: marginPct(r.competitorPrice, cost),
      linked_skus: linked.map((e) => e.sku),
      stock: linked.reduce((s, e) => s + e.stock, 0),
      sold_qty_90d: linked.reduce((s, e) => s + e.qty_sold, 0),
      revenue_90d: linked.reduce((s, e) => s + e.revenue, 0),
      clients_90d: Math.max(0, ...linked.map((e) => e.clients)),
      last_sale_at: linked.map((e) => e.last_sale_at).filter(Boolean).sort().pop() ?? null,
    };
  });

  return {
    note: 'Цены конкурентов — из их прайсов (Yann 07.09.2026, Foil Trading 21.09.2026, Avanta 18.03.2026, Bit Trade — старый прайс). Наша цена — из каталога CRM; our_price_from_catalog=false значит, что в каталоге цены нет и взята цена из прайса. purchase_price — самая высокая закупка среди привязанных артикулов.',
    price_rows: priceRows,
    ...(input.include_unique
      ? { competitor_only_products: THEIR_ONLY_ROWS, our_only_products: OUR_ONLY_ROWS }
      : {}),
  };
}

// ─── Описания для модели ────────────────────────────────────────────────────

export const ROP_AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'market_comparison',
    description:
      'Сравнение наших цен с ценами конкурентов (Yann, Bit Trade, Avanta Trade, Foil Trading) по совпадающим товарам. '
      + 'По каждой строке сразу даёт нашу экономику: закупочную цену, маржу сейчас и маржу, если опустить цену до конкурента, '
      + 'остаток на складе и продажи за 90 дней. Используй для ценовых стратегий (демпинг, выравнивание, удержание цены). '
      + 'include_unique=true добавит товары, которые есть только у конкурентов или только у нас.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Часть названия категории, например «фольга» или «ламинац».' },
        competitor: { type: 'string', description: 'Имя конкурента или его часть.' },
        relation: {
          type: 'string',
          enum: ['all', 'they_cheaper', 'we_cheaper', 'same'],
          description: 'Фильтр по соотношению цен. По умолчанию all.',
        },
        include_unique: { type: 'boolean', description: 'Добавить списки уникальных товаров.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'product_economics',
    description:
      'Экономика наших товаров: остаток, цена продажи, закупка, маржа %, продано штук и выручка за период, '
      + 'сколько разных клиентов брали, дата последней продажи и на сколько дней хватит остатка. '
      + 'Сортировка — по выручке за период. Удобно для залежавшегося товара (большой остаток, давняя последняя продажа) '
      + 'и для выбора товаров под акцию.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Поиск по названию или артикулу.' },
        category: { type: 'string', description: 'Часть названия категории.' },
        skus: { type: 'array', items: { type: 'string' }, description: 'Точные артикулы.' },
        days: { type: 'integer', description: 'Период продаж в днях, по умолчанию 90.' },
        limit: { type: 'integer', description: 'Сколько товаров вернуть, по умолчанию 50, максимум 200.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'describe_tables',
    description:
      'Структура базы CRM. Без аргументов — список таблиц. С tables — колонки этих таблиц с типами и значениями перечислений. '
      + 'Вызывай перед run_sql, если не уверен в названиях колонок.',
    input_schema: {
      type: 'object',
      properties: {
        tables: { type: 'array', items: { type: 'string' }, description: 'Имена таблиц, например ["deals","deal_items"].' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_sql',
    description:
      `Один SELECT (или WITH … SELECT) к PostgreSQL базе CRM, только чтение, таймаут 20 с, не больше ${SQL_ROW_LIMIT} строк. `
      + 'Для всего, чего нет в готовых инструментах: сделки, клиенты, менеджеры, долги, заметки, звонки, задачи. '
      + 'Агрегируй в SQL, а не выгружай сырые строки.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Запрос PostgreSQL без «;» внутри.' },
        purpose: { type: 'string', description: 'Одной фразой по-русски: что ищем (показывается директору).' },
      },
      required: ['sql', 'purpose'],
      additionalProperties: false,
    },
  },
];

/** Короткая подпись шага для экрана: «Смотрю цены конкурентов», «SQL: долги по менеджерам». */
export function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'market_comparison':
      return 'Сравнение цен с конкурентами' + (input.category ? `: ${String(input.category)}` : '');
    case 'product_economics':
      return 'Экономика товаров' + (input.search || input.category ? `: ${String(input.search ?? input.category)}` : '');
    case 'describe_tables':
      return 'Структура базы';
    case 'run_sql':
      return `Запрос к базе: ${String(input.purpose ?? '').slice(0, 120)}`;
    default:
      return name;
  }
}

/** Выполняет инструмент. Ошибка возвращается модели как текст — пусть исправит запрос сама. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  try {
    let result: unknown;
    switch (name) {
      case 'market_comparison': result = await marketComparison(input as MarketInput); break;
      case 'product_economics': result = await productEconomics(input as ProductEconomicsInput); break;
      case 'describe_tables': result = await describeTables(input as { tables?: string[] }); break;
      case 'run_sql':
        if (typeof input.sql !== 'string') throw new Error('Нужен параметр sql');
        result = await runSql({ sql: input.sql });
        break;
      default:
        return { content: `Неизвестный инструмент ${name}`, isError: true };
    }
    let text = JSON.stringify(result);
    if (text.length > MAX_RESULT_CHARS) {
      text = `${text.slice(0, MAX_RESULT_CHARS)}\n…[обрезано: результат больше ${MAX_RESULT_CHARS} символов, сузь запрос или агрегируй]`;
    }
    return { content: text, isError: false };
  } catch (err) {
    // У Prisma в сообщении кусок стека вызова; модели нужна только причина от Postgres.
    const raw = (err as Error).message;
    const pg = raw.match(/Message: `([\s\S]*?)`\s*$/);
    return { content: `Ошибка: ${pg ? pg[1] : raw.trim()}`, isError: true };
  }
}
