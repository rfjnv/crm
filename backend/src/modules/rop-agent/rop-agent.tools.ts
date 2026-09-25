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
import {
  clientPurchaseCycles,
  listManagers,
  slowStock,
  stockedProductBuyers,
  type ClientCyclesInput,
  type SlowStockInput,
  type StockedProductBuyersInput,
} from './rop-agent.analysis';
import { proposeTaskPlan } from './rop-agent.plans';
import { taskPlanResults } from './rop-agent.control';
import { forgetTool, rememberTool } from './rop-agent.memory';
import { callReviews } from './rop-agent.call-reviews';
import { clientCard, lossReasons } from './rop-agent.clients';
import { kpiForecast } from './rop-agent.kpi';

/**
 * Инструменты РОП-агента. Все, кроме propose_task_plan, только читают. И тот
 * пишет лишь черновик плана: задачи менеджерам создаёт директор кнопкой «Раздать».
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
        // С одним знаком: «0» при запасе на полдня читается как «уже кончился».
        stock_cover_days: dailyQty > 0 ? Math.round((r.stock / dailyQty) * 10) / 10 : null,
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
    name: 'client_purchase_cycles',
    description:
      'Цикл покупок клиентов: сколько покупок, обычный интервал между ними (медиана, дни), когда брал последний раз, '
      + 'выручка за 12 месяцев, последний контакт (заметка или звонок), три главных товара и статус: '
      + 'due_soon — пора покупать (горячие), overdue — пропал (прошло больше overdue_factor интервалов), '
      + 'lost — давно ушёл (холодные), regular — ещё рано. Сортировка по выручке за год.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'due_soon', 'overdue', 'lost', 'regular'], description: 'По умолчанию all.' },
        manager_id: { type: 'string', description: 'Только клиенты этого менеджера.' },
        min_orders: { type: 'integer', description: 'Минимум покупок в истории, по умолчанию 3.' },
        overdue_factor: { type: 'number', description: 'Во сколько интервалов тишины клиент считается пропавшим, по умолчанию 1.5.' },
        lost_after_days: { type: 'integer', description: 'Сколько дней без покупок — «давно ушёл», по умолчанию 180.' },
        limit: { type: 'integer', description: 'По умолчанию 50, максимум 200.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'stocked_product_buyers',
    description:
      'Товары, которые сейчас есть на складе, и клиенты, которые брали их регулярно, но давно не берут '
      + '(тишина больше overdue_factor их обычных интервалов по этому товару и больше 30 дней). '
      + 'По каждому клиенту: менеджер, телефон, сколько раз брал, обычный объём, когда брал последний раз. '
      + 'Это список «позвонить и узнать причину / предложить снова».',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Поиск товара по названию или артикулу.' },
        category: { type: 'string', description: 'Часть названия категории.' },
        skus: { type: 'array', items: { type: 'string' } },
        min_purchases: { type: 'integer', description: 'Минимум покупок этого товара клиентом, по умолчанию 3.' },
        overdue_factor: { type: 'number', description: 'По умолчанию 1.5.' },
        include_active: { type: 'boolean', description: 'true — вернуть и тех, кто берёт как обычно.' },
        limit_products: { type: 'integer', description: 'По умолчанию 20.' },
        limit_buyers: { type: 'integer', description: 'Клиентов на товар, по умолчанию 15.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'slow_stock',
    description:
      'Залежавшийся товар: есть на складе, но не продавался days_without_sale дней (или никогда). '
      + 'Сумма, замороженная по закупке, продажи за год и прошлые покупатели — кому предложить.',
    input_schema: {
      type: 'object',
      properties: {
        days_without_sale: { type: 'integer', description: 'По умолчанию 60.' },
        category: { type: 'string' },
        limit: { type: 'integer', description: 'По умолчанию 30.' },
        buyers_per_product: { type: 'integer', description: 'Прошлых покупателей на товар, по умолчанию 5.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_managers',
    description: 'Активные сотрудники, которым можно ставить задачи: id, имя, роль, сколько клиентов ведёт, сделки и выручка за 90 дней.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_task_plan',
    description:
      'Сохраняет ЧЕРНОВИК плана задач менеджерам и показывает его директору под твоим ответом. '
      + 'Задачи не создаются: директор проверит, поправит и нажмёт «Раздать». '
      + 'Обычно одна задача на менеджера со списком его клиентов. manager_id и client_id — только реальные id из данных '
      + '(list_managers, client_purchase_cycles и т.д.). Клиента давай тому, кто его ведёт (clients.manager_id), если директор не сказал иначе. '
      + 'Если директор просит изменить план — вызови инструмент заново с исправленным планом.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Название плана, например «Вернуть пропавших клиентов — сентябрь».' },
        goal: { type: 'string', description: 'Зачем этот план, одним-двумя предложениями.' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              manager_id: { type: 'string' },
              title: { type: 'string', description: 'Название задачи для менеджера.' },
              description: { type: 'string', description: 'Что сделать и какой результат нужен.' },
              due_date: { type: 'string', description: 'Срок, YYYY-MM-DD.' },
              clients: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    client_id: { type: 'string' },
                    reason: { type: 'string', description: 'Факт: почему клиент в списке (например «брал раз в 20 дней, тишина 64 дня»).' },
                    offer: { type: 'string', description: 'Что предложить или выяснить.' },
                  },
                  required: ['client_id', 'reason', 'offer'],
                  additionalProperties: false,
                },
              },
            },
            required: ['manager_id', 'title', 'description', 'clients'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'tasks'],
      additionalProperties: false,
    },
  },
  {
    name: 'task_plan_results',
    description:
      'Контроль розданных планов задач: по каждому менеджеру и клиенту после раздачи — звонки из телефонии '
      + '(сколько, с разговором, минуты), заметки и последняя из них, касания других сотрудников, новые сделки и выручка, '
      + 'галочка в чек-листе, статус задачи и отчёт менеджера, просрочен ли срок, и итог verdict. '
      + 'Без plan_id — все розданные планы за days дней (по умолчанию 45).',
    input_schema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Один конкретный план.' },
        days: { type: 'integer', description: 'За сколько дней брать розданные планы, по умолчанию 45.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'kpi_forecast',
    description:
      'План и прогноз месяца по выручке — по компании и по каждому менеджеру: факт с начала месяца, прогноз на конец месяца '
      + '(по профилю продаж по дням недели) с вилкой, % выполнения плана сейчас и по прогнозу, сколько не хватает до плана, сколько нужно '
      + 'продавать в каждый оставшийся рабочий день против текущего темпа, открытые сделки, ставка бонуса по прогнозу и сколько продаж '
      + 'нужно до следующей ступени. Без аргументов — текущий месяц.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer' },
        month: { type: 'integer', description: '1–12' },
        manager_id: { type: 'string', description: 'Только этот менеджер.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'client_card',
    description:
      'Всё о клиенте одним вызовом: контакты, менеджер, статус кредита, портрет; покупки (сколько, как часто, когда последний раз, '
      + 'выручка по месяцам за год, средний чек, главные товары); платёжная дисциплина (сколько сделок со сроком, оплачено вовремя / '
      + 'с опозданием, на сколько дней, текущий долг и просрочка); последние заметки менеджеров, звонки, разборы звонков, открытые сделки '
      + 'и планы агента по нему. Используй для любого вопроса о конкретном клиенте, особенно «давать ли отсрочку» и «почему ушёл».',
    input_schema: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        search: { type: 'string', description: 'Название компании, телефон или ИНН, если id неизвестен.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'loss_reasons',
    description:
      'Почему мы теряем клиентов: берёт пропавших и давно ушедших постоянных клиентов (самых ценных по выручке), читает заметки '
      + 'менеджеров и раскладывает по причинам — цена, отсрочка/кредит, качество, наличие, сервис, упал спрос, сменился закупщик, другое, '
      + 'не ясно, менеджер не выяснял. По каждой причине — сколько клиентов, сколько выручки за год ушло, сколько ушли к конкуренту, примеры с цитатами. '
      + 'Плюс кто из менеджеров чаще не выясняет причину.',
    input_schema: {
      type: 'object',
      properties: {
        include_lost: { type: 'boolean', description: 'Включать давно ушедших (больше 180 дней), по умолчанию true.' },
        manager_id: { type: 'string', description: 'Только клиенты этого менеджера.' },
        limit: { type: 'integer', description: 'Сколько клиентов разобрать, по умолчанию 40, максимум 80.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'call_reviews',
    description:
      'Качество звонков менеджеров по аудитам (записи присылают вручную — менеджеры звонят с мобильных): '
      + 'по каждому менеджеру число аудитов, средняя оценка и вероятность продажи, доля звонков, где выполнен каждый этап '
      + '(приветствие, выявление потребности, презентация, возражения, закрытие); последние разборы с пропущенными этапами, советами и итогом.',
    input_schema: {
      type: 'object',
      properties: {
        manager_id: { type: 'string', description: 'Только этот менеджер.' },
        days: { type: 'integer', description: 'За сколько дней, по умолчанию 90.' },
        limit: { type: 'integer', description: 'Сколько последних разборов показать, по умолчанию 20.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description:
      'Запомнить надолго решение, договорённость или факт от директора, который должен действовать и в следующих разговорах: '
      + '«фольгу не демпингуем», «Акмал в отпуске до 10.10», «Print House платит только в конце месяца», «скидки на ламинацию не предлагать». '
      + 'Одна запись — одна мысль, коротко и самодостаточно (с именами, без «он», «этот»). Для временного факта укажи expires_on.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Что запомнить, до 500 символов.' },
        expires_on: { type: 'string', description: 'До какого дня действует, YYYY-MM-DD. Не указывай для бессрочного.' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'forget',
    description: 'Удалить запись из памяти, если директор отменил решение или факт устарел. memory_id — 8 символов из квадратных скобок в блоке памяти.',
    input_schema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
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
    case 'client_purchase_cycles':
      return 'Циклы покупок клиентов' + (input.status && input.status !== 'all' ? ` (${String(input.status)})` : '');
    case 'stocked_product_buyers':
      return 'Покупатели товара в наличии' + (input.search || input.category ? `: ${String(input.search ?? input.category)}` : '');
    case 'slow_stock':
      return 'Залежавшийся товар';
    case 'list_managers':
      return 'Список менеджеров';
    case 'propose_task_plan':
      return `Черновик плана задач: ${String(input.title ?? '').slice(0, 100)}`;
    case 'task_plan_results':
      return 'Проверка розданных задач';
    case 'call_reviews':
      return 'Разборы звонков';
    case 'kpi_forecast':
      return 'План и прогноз месяца';
    case 'client_card':
      return `Карточка клиента${input.search ? `: ${String(input.search).slice(0, 60)}` : ''}`;
    case 'loss_reasons':
      return 'Причины потерь клиентов';
    case 'remember':
      return `Запомнил: ${String(input.content ?? '').slice(0, 140)}`;
    case 'forget':
      return 'Удалил запись из памяти';
    default:
      return name;
  }
}

/** Выполняет инструмент. Ошибка возвращается модели как текст — пусть исправит запрос сама. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { chatId: string; userId: string },
): Promise<{ content: string; isError: boolean; planId?: string }> {
  try {
    let result: unknown;
    let planId: string | undefined;
    switch (name) {
      case 'client_purchase_cycles': result = await clientPurchaseCycles(input as ClientCyclesInput); break;
      case 'stocked_product_buyers': result = await stockedProductBuyers(input as StockedProductBuyersInput); break;
      case 'slow_stock': result = await slowStock(input as SlowStockInput); break;
      case 'list_managers': result = await listManagers(); break;
      case 'task_plan_results': result = await taskPlanResults(input as { plan_id?: string; days?: number }); break;
      case 'kpi_forecast': result = await kpiForecast(input as { year?: number; month?: number; manager_id?: string }); break;
      case 'client_card': result = await clientCard(input as { client_id?: string; search?: string }); break;
      case 'loss_reasons': result = await lossReasons(input as { include_lost?: boolean; manager_id?: string; limit?: number }); break;
      case 'call_reviews': result = await callReviews(input as { manager_id?: string; days?: number; limit?: number }); break;
      case 'remember': result = await rememberTool(ctx, input); break;
      case 'forget': result = await forgetTool(input); break;
      case 'propose_task_plan': {
        const r = await proposeTaskPlan(ctx, input);
        planId = r.plan_id;
        result = r;
        break;
      }
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
    return { content: text, isError: false, planId };
  } catch (err) {
    // У Prisma в сообщении кусок стека вызова; модели нужна только причина от Postgres.
    const raw = (err as Error).message;
    const pg = raw.match(/Message: `([\s\S]*?)`\s*$/);
    return { content: `Ошибка: ${pg ? pg[1] : raw.trim()}`, isError: true };
  }
}
