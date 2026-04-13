import OpenAI from 'openai';
import { config } from '../../lib/config';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import type { AiAssistantResponse } from './ai-assistant.dto';

const FORBIDDEN_KEYWORDS = [
  'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'TRUNCATE',
  'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
];

const MAX_CHAT_HISTORY = 20;

const DB_SCHEMA = `
\u2550\u2550 CORE TABLES \u2550\u2550

Table: users
  id, login, full_name, role (SUPER_ADMIN|ADMIN|OPERATOR|MANAGER|ACCOUNTANT|WAREHOUSE|WAREHOUSE_MANAGER|DRIVER|LOADER), is_active, created_at

Table: clients
  id, company_name, contact_name, phone, email, address, notes, inn, manager_id (FK->users), is_archived, created_at, updated_at

Table: deals
  id, title, status (NEW|IN_PROGRESS|WAITING_STOCK_CONFIRMATION|STOCK_CONFIRMED|WAITING_FINANCE|FINANCE_APPROVED|ADMIN_APPROVED|READY_FOR_SHIPMENT|SHIPMENT_ON_HOLD|SHIPPED|PENDING_APPROVAL|CLOSED|CANCELED|REJECTED|REOPENED|WAITING_WAREHOUSE_MANAGER|PENDING_ADMIN|READY_FOR_LOADING|LOADING_ASSIGNED|READY_FOR_DELIVERY|IN_DELIVERY)
  amount (decimal), client_id (FK->clients), manager_id (FK->users), contract_id (FK->contracts, nullable)
  payment_type (FULL|PARTIAL|INSTALLMENT), paid_amount (decimal), payment_status (UNPAID|PARTIAL|PAID)
  discount (decimal), is_archived, closed_at (nullable), created_at, updated_at, delivery_type (nullable)

Table: deal_items
  id, deal_id (FK->deals), product_id (FK->products), requested_qty, price, line_total, deal_date (nullable), shipped_at (nullable), delivered_at (nullable), is_problem, created_at

Table: products
  id, name, sku (unique), unit, category (nullable), stock (current balance), min_stock, purchase_price, sale_price, is_active, created_at

Table: payments
  id, deal_id (FK->deals), client_id (FK->clients), amount, paid_at, method (nullable), note (nullable), created_by (FK->users), created_at

Table: contracts
  id, client_id (FK->clients), contract_number (unique), contract_type (ANNUAL|ONE_TIME), amount, start_date, end_date, is_active, created_at

Table: expenses
  id, date, category, amount, note, status, created_by (FK->users), created_at

\u2550\u2550 HISTORY & ACTIVITY TABLES \u2550\u2550

Table: audit_logs -- log of ALL actions (who changed what, when)
  id, user_id (FK->users), action (enum), entity_type (text, e.g. 'deal','client'), entity_id, before (JSON -- old value), after (JSON -- new value), reason, created_at
  USE: track deal status changes, price adjustments, who edited what, deal lifecycle

Table: deal_comments -- comments on deals
  id, deal_id (FK->deals), author_id (FK->users), text, created_at
  USE: manager activity, communication frequency, negotiation effort per deal

Table: client_notes -- notes about clients
  id, client_id (FK->clients), user_id (FK->users), content, created_at, deleted_at
  USE: follow-up frequency, client engagement tracking

Table: inventory_movements -- warehouse stock movements
  id, product_id (FK->products), type (IN|OUT|ADJUSTMENT|RETURN|TRANSFER|WRITE_OFF), quantity, deal_id (FK->deals, nullable), note, created_by, created_at
  USE: product demand velocity, stock turnover, returns analysis

Table: shipments -- deliveries
  id, deal_id (FK->deals, unique), vehicle_type, vehicle_number, driver_name, departure_time, shipped_at
  USE: delivery timeline, logistics efficiency

Table: tasks -- employee tasks
  id, title, description, status (TODO|IN_PROGRESS|DONE|CANCELLED), assignee_id (FK->users), created_by_id (FK->users), due_date, approved_at, created_at
  USE: workload distribution, task completion rates

Table: deal_ratings -- customer QR feedback
  id, deal_id (FK->deals, unique), score (1-5), comment, created_at
  USE: customer satisfaction, service quality per manager

Table: monthly_snapshots -- monthly analytical aggregates
  id, year, month, scope, type, data (JSON), created_at
`;

const SYSTEM_PROMPT = `You are a **senior business analytics AI** for Polygraph Business CRM (printing/polygraphy company).
You are NOT a simple assistant. You are an ANALYST. Think like a CFO / Head of Sales.
Your job: explain WHY things happen, not just WHAT. Identify PATTERNS, correlate ACTIONS to OUTCOMES.

DATABASE SCHEMA:
${DB_SCHEMA}

============================
SQL RULES (NEVER BREAK):
============================
- ONLY valid PostgreSQL SELECT queries
- NEVER DELETE/UPDATE/INSERT/DROP/ALTER/TRUNCATE/CREATE
- EVERY query MUST end with LIMIT N (max 100)
- Cast: COUNT(*)::int, SUM(...)::numeric
- Filter: is_archived = false by default
- CRITICAL: ALWAYS include WHERE date filter!
  - If user specifies a period -> use it
  - If NO period mentioned -> default to last 30 days: WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  - NEVER return aggregated data without a date filter
- TIMEZONE: The database runs in UTC but the business is in Asia/Tashkent (UTC+5).
  ALWAYS use timezone-aware date functions:
  - Today: (NOW() AT TIME ZONE 'Asia/Tashkent')::date
  - Yesterday: (NOW() AT TIME ZONE 'Asia/Tashkent')::date - 1
  - This week: date_trunc('week', NOW() AT TIME ZONE 'Asia/Tashkent')
  - This month: date_trunc('month', NOW() AT TIME ZONE 'Asia/Tashkent')
  - Last 30 days: (NOW() AT TIME ZONE 'Asia/Tashkent')::date - INTERVAL '30 days'
  - Last N days (любое N из вопроса: 7, 90, 120, 365): use NOW() - INTERVAL 'N days' (substitute N, e.g. INTERVAL '120 days') on deal line time COALESCE(di.deal_date, di.created_at, d.created_at)
  - Last week: date_trunc('week', NOW() AT TIME ZONE 'Asia/Tashkent') - INTERVAL '7 days'
  - When comparing dates: created_at AT TIME ZONE 'Asia/Tashkent'
  - For display: to_char(created_at AT TIME ZONE 'Asia/Tashkent', 'DD.MM.YYYY HH24:MI')

============================
LANGUAGE (CRITICAL):
============================
- Detect the language of the user's message and RESPOND in the SAME language.
- If question is in Russian -> answer in Russian
- If question is in Uzbek (o'zbek tili / узбекча) -> answer in Uzbek! Example Uzbek phrases: "qancha", "qanday", "kim", "nima", "eng ko'p", "sotuvlar", "daromad", "qarzdorlik", "xodimlar", "mahsulot"
- If mixed or unclear -> default to Russian
- SQL queries are ALWAYS in English (PostgreSQL syntax), only the answer text and entities should match the user's language
- NEVER respond in English unless the user writes in English

============================
REAL NAMES (ABSOLUTELY CRITICAL):
============================
- ALWAYS JOIN for names: u.full_name, c.company_name, p.name
- ALWAYS include id + name in SELECT and GROUP BY: SELECT u.id, u.full_name, ...
- NEVER anonymize: use REAL names from data (e.g. "Дилмурод", "Фарход", "е гранд")
- NEVER use "Менеджер 1", "Клиент 1", "Клиент (ID: ...)", or any UUID as display name
- In entities array: "name" MUST be the human-readable name from SQL result (full_name or company_name), NEVER a UUID
- Example: if SQL returns {id: "abc-123", full_name: "Дилмурод"} -> entity: {"type": "user", "id": "abc-123", "name": "Дилмурод"}
- Example: if SQL returns {id: "xyz-456", company_name: "е гранд"} -> entity: {"type": "client", "id": "xyz-456", "name": "е гранд"}
- If you cannot determine the real name, DO NOT include that entity at all

============================
MULTI-QUERY ANALYTICS:
============================
Return: { "queries": ["SELECT ...", "SELECT ...", ...] }
Use multi-query for rich analysis. Single query for simple lookups.

============================
DEEP ANALYSIS (USE HISTORY TABLES!):
============================
You have access to history/activity tables. USE THEM for deeper insights:

- audit_logs: Track deal lifecycle (NEW->CLOSED time), who changed prices, status change patterns
- deal_comments: Manager engagement per deal (more comments = better/worse close rate?)
- client_notes: Follow-up frequency -> client retention correlation
- inventory_movements: Product demand velocity, returns rate, which products move fastest
- deal_items: Avg items per deal = upselling metric, product mix per manager
- tasks: Employee workload, task completion rates, overdue tasks
- deal_ratings: Customer satisfaction by manager, avg score trends
- shipments: Delivery time from deal close to ship

CORRELATION ANALYSIS (connect actions -> outcomes):
- deal_comments.count per deal -> deal.status (do more comments lead to CLOSED?)
- client_notes frequency -> repeat deal rate
- audit_logs status changes -> avg deal cycle time (days from NEW to CLOSED)
- inventory_movements type=RETURN -> quality issues per product
- deal_ratings.score -> manager_id (which manager has happiest clients?)

============================
ANALYTICS TEMPLATES:
============================
REVENUE question -> queries for: total, deal count, avg check, top manager, top client, period comparison (% change)
MANAGER PERFORMANCE -> revenue per manager, deals, avg check, items per deal, comments per deal, share of total %, rank
DEBT -> total debt, debtor count, top debtors, avg debt per client, debt aging (how old)
PRODUCTS -> stock vs min_stock, top-selling (by deal_items), turnover rate (by inventory_movements)
TOP CLIENTS FOR ONE PRODUCT -> GROUP BY client: deals_count, SUM(qty), SUM(line revenue), broad LIKE on p.name
CLIENT ANALYSIS -> revenue per client, deal frequency, payment reliability (paid_amount/amount ratio), last activity
DEAL PIPELINE -> deals by status, avg time in each stage (via audit_logs), bottleneck identification

============================
BUSINESS ADVISOR:
============================
When asked "how to improve", "why is X low", "what to do":
1. Query MULTIPLE tables (not just deals -- use comments, notes, audit_logs, ratings)
2. Find patterns and ROOT CAUSES
3. Give 3-5 SPECIFIC recommendations with REAL NUMBERS from data
4. Reference specific people, dates, and metrics

GOOD: "**Farkhod** has avg check **6.4M** vs **4.2M** for Dilnoza, but 2x fewer deals. He has 1.5 comments per deal vs 3.2 for Dilnoza -> recommendation: increase follow-up contacts"
BAD: "You need to try harder" <- NEVER generic advice. EVERYTHING must be data-backed.

Instead of "Revenue is high", say:
"Revenue increased by 35% mainly due to 3 large deals closed by **Farkhod** after 5+ follow-up comments. Audit log shows pricing adjustments (discount reduced from 15% to 5%) before closing."

============================
FORMATTING (Markdown):
============================
- **Bold** key names and numbers
- Tables: | Менеджер | Выручка | Сделки | Ср. чек |
- Numbered lists for recommendations
- Emojis for accents: 📊 📈 📉 ⚠️ ✅ 💡 🏆 📋
- Numbers with spaces: 1 000 000
- ### headers for sections
- End with 💡 **Инсайт** section
- For visual charts use text-based bars in tables:
  Example: | Дилмурод | ████████████ 65% | 402M |
  Use unicode block chars: █ ▓ ░ to show proportions
- Format dates in local format: DD.MM.YYYY

============================
PRODUCT SEARCH:
============================
Fuzzy: LOWER(name) LIKE '%keyword%'. Split words. Also search sku, category.

============================
PRODUCT SALES / "КТО ПОКУПАЕТ ТОВАР" (CRITICAL):
============================
When user asks which clients buy product X most often, топ покупателей по товару, самоклеящая/ламинация/конкретный товар:
- FROM deal_items di JOIN deals d ON d.id = di.deal_id JOIN clients c ON c.id = d.client_id JOIN products p ON p.id = di.product_id
- d.is_archived = false AND d.status NOT IN ('CANCELED', 'REJECTED')
- Do NOT filter to status = 'CLOSED' only unless user explicitly asks for revenue only from closed deals
- Product name: use WIDE OR of LIKE patterns — Russian word forms differ (самоклеящаяся, самоклеящая, самоклейка, этикет). Example:
  (LOWER(p.name) LIKE '%самокле%' OR LOWER(p.name) LIKE '%этикет%' OR LOWER(p.name) LIKE '%sticker%')
  One narrow string often returns zero rows while data exists.
- Period column: COALESCE(di.deal_date, di.created_at, d.created_at) for time window (not only closed_at)
- In EVERY ranking query include ALL of:
  COUNT(DISTINCT d.id)::int AS deals_count
  SUM(COALESCE(di.requested_qty, 0))::numeric AS total_qty
  SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0))::numeric AS total_amount_uzs
  Include p.unit in SELECT or GROUP BY if needed for display
- In the Markdown answer: table columns must show **deals**, **quantity (total_qty + unit)**, **sum in UZS (total_amount_uzs)** — not only "how many times" or count of lines unless user explicitly asked only for count
- If result is empty: run a second query — list products WHERE LOWER(name) LIKE '%<shortest_stem>%' LIMIT 30 — to see real naming in DB; widen LIKE; only then say "no sales"
- Follow-up "за последние 120 дней" after a product question: reuse same product filters from chat history, change only INTERVAL to 120 days

============================
ENTITIES:
============================
- "client" -> company_name | "deal" -> title | "product" -> name | "user" -> full_name
- "employees/managers/users" = users table, NOT clients

============================
CONVERSATIONAL:
============================
Non-data questions -> { "queries": null, "answer": "...", "entities": [] }
READ-ONLY. Capabilities: revenue analytics, manager ranking, debt risk, product demand, client portfolio, deal pipeline, activity analysis, satisfaction scores, business recommendations.

============================
RESPONSE FORMAT:
============================
{ "queries": ["SELECT ...", ...] OR null, "answer": "...", "entities": [{ "type": "...", "id": "uuid", "name": "real name" }] }

============================
CHAT CONTEXT:
============================
You receive chat history. Use it for follow-ups. Be thorough, specific, insightful. NEVER generic.`;

function getOpenAIClient(): OpenAI {
  const apiKey = config.openai.apiKey;
  if (!apiKey) {
    throw new AppError(500, 'OPENAI_API_KEY не настроен. Обратитесь к администратору.');
  }
  return new OpenAI({ apiKey });
}

function validateSQL(sql: string): void {
  const upper = sql.toUpperCase().replace(/\s+/g, ' ').trim();

  if (!upper.startsWith('SELECT')) {
    throw new AppError(400, 'AI сгенерировал недопустимый запрос. Разрешены только SELECT.');
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upper) && keyword !== 'UPDATE') {
      throw new AppError(400, `Запрос содержит запрещённое ключевое слово: ${keyword}`);
    }
    if (keyword === 'UPDATE' && regex.test(upper) && !upper.includes('UPDATED_AT') && !upper.includes('UPDATE_')) {
      throw new AppError(400, `Запрос содержит запрещённое ключевое слово: ${keyword}`);
    }
  }

  if (!/LIMIT\s+\d/i.test(upper)) {
    throw new AppError(400, 'Запрос должен содержать LIMIT.');
  }
}

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, v) =>
    typeof v === 'bigint' ? Number(v) : v
  ));
}

function generateTitle(question: string): string {
  const cleaned = question.replace(/[?!.]+$/, '').trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + '...';
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

async function getChatHistory(chatId: string): Promise<ChatMessage[]> {
  const messages = await prisma.aiChatMessage.findMany({
    where: { chatId, isError: false },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
    take: MAX_CHAT_HISTORY,
  });
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.role === 'assistant' ? m.content.slice(0, 500) : m.content,
  }));
}

// ==================== TRAINING RULES CRUD ====================

export async function listTrainingRules() {
  return prisma.aiTrainingRule.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, fullName: true } } },
  });
}

export async function createTrainingRule(userId: string, data: { title: string; content: string }) {
  return prisma.aiTrainingRule.create({
    data: { ...data, createdBy: userId },
    include: { author: { select: { id: true, fullName: true } } },
  });
}

export async function updateTrainingRule(
  ruleId: string,
  data: { title?: string; content?: string; isActive?: boolean },
) {
  const rule = await prisma.aiTrainingRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Правило не найдено');

  return prisma.aiTrainingRule.update({
    where: { id: ruleId },
    data,
    include: { author: { select: { id: true, fullName: true } } },
  });
}

export async function deleteTrainingRule(ruleId: string) {
  const rule = await prisma.aiTrainingRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Правило не найдено');

  await prisma.aiTrainingRule.delete({ where: { id: ruleId } });
}

async function getActiveTrainingRules(): Promise<string> {
  const rules = await prisma.aiTrainingRule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { title: true, content: true },
  });
  if (rules.length === 0) return '';
  return '\n\nCUSTOM BUSINESS RULES (set by admin):\n' +
    rules.map((r, i) => `${i + 1}. [${r.title}]: ${r.content}`).join('\n');
}

// ==================== CHAT CRUD ====================

export async function listChats(userId: string) {
  return prisma.aiChat.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export async function createChat(userId: string) {
  return prisma.aiChat.create({
    data: { userId },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

export async function getChatMessages(chatId: string, userId: string) {
  const chat = await prisma.aiChat.findFirst({
    where: { id: chatId, userId },
  });
  if (!chat) throw new AppError(404, 'Чат не найден');

  return prisma.aiChatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      sql: true,
      entities: true,
      isError: true,
      createdAt: true,
    },
  });
}

export async function renameChat(chatId: string, userId: string, title: string) {
  const chat = await prisma.aiChat.findFirst({
    where: { id: chatId, userId },
  });
  if (!chat) throw new AppError(404, 'Чат не найден');

  return prisma.aiChat.update({
    where: { id: chatId },
    data: { title },
    select: { id: true, title: true },
  });
}

export async function deleteChat(chatId: string, userId: string) {
  const chat = await prisma.aiChat.findFirst({
    where: { id: chatId, userId },
  });
  if (!chat) throw new AppError(404, 'Чат не найден');

  await prisma.aiChat.delete({ where: { id: chatId } });
}

// ==================== ASK QUESTION (with DB persistence + chat context) ====================

export async function askQuestionInChat(
  chatId: string,
  userId: string,
  question: string,
): Promise<AiAssistantResponse> {
  const chat = await prisma.aiChat.findFirst({
    where: { id: chatId, userId },
    include: { _count: { select: { messages: true } } },
  });
  if (!chat) throw new AppError(404, 'Чат не найден');

  const chatHistory = await getChatHistory(chatId);

  await prisma.aiChatMessage.create({
    data: { chatId, role: 'user', content: question },
  });

  const isFirstMessage = chat._count.messages === 0;
  if (isFirstMessage) {
    await prisma.aiChat.update({
      where: { id: chatId },
      data: { title: generateTitle(question) },
    });
  }

  await prisma.aiChat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });

  let result: AiAssistantResponse;
  try {
    result = await executeAiQuery(question, chatHistory);
  } catch (err) {
    const errorMsg = err instanceof AppError ? err.message : 'Произошла ошибка при обработке запроса';
    await prisma.aiChatMessage.create({
      data: { chatId, role: 'assistant', content: errorMsg, isError: true },
    });
    throw err;
  }

  await prisma.aiChatMessage.create({
    data: {
      chatId,
      role: 'assistant',
      content: result.answer,
      sql: result.sql,
      entities: result.entities as any,
    },
  });

  const updatedTitle = isFirstMessage ? generateTitle(question) : undefined;

  return { ...result, chatTitle: updatedTitle };
}

// ==================== CORE AI ENGINE ====================

async function executeAiQuery(
  question: string,
  chatHistory: ChatMessage[] = [],
): Promise<AiAssistantResponse> {
  const openai = getOpenAIClient();
  const customRules = await getActiveTrainingRules();
  const fullPrompt = SYSTEM_PROMPT + customRules;

  const historyMessages = chatHistory.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const planResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: fullPrompt },
      ...historyMessages,
      {
        role: 'user',
        content: `${question}

---
Generate your response:
- DATA questions: { "queries": ["SELECT ...", ...], "plan": "brief explanation" }
  CRITICAL: EVERY query MUST have a WHERE date filter! Default to last 30 days if no period specified.
  Product-by-client questions: include deals_count + total_qty + total_amount_uzs (not count-only). Use broad product LIKE. For "last N days" use NOW() - INTERVAL 'N days' on COALESCE(di.deal_date, di.created_at, d.created_at).
  USE JOINs to get real names. Use history tables when they add insight.
- CONVERSATIONAL questions: { "queries": null, "answer": "markdown response", "entities": [] }
Return ONLY valid JSON.`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const planContent = planResponse.choices[0]?.message?.content;
  if (!planContent) {
    throw new AppError(500, 'AI не смог сгенерировать план запроса.');
  }

  let plan: { queries?: string[] | null; answer?: string; entities?: any[]; plan?: string };
  try {
    plan = JSON.parse(planContent);
  } catch {
    throw new AppError(500, 'AI вернул некорректный JSON.');
  }

  if (!plan.queries || !Array.isArray(plan.queries) || plan.queries.length === 0) {
    return {
      answer: plan.answer || 'Я — AI-аналитик CRM Polygraph Business. Задайте вопрос по данным — выручка, менеджеры, клиенты, долги, товары — и я дам детальный анализ с рекомендациями.',
      entities: Array.isArray(plan.entities) ? plan.entities : [],
    };
  }

  const allResults: { query: string; result: unknown }[] = [];
  const allSqls: string[] = [];
  const failedQueries: { query: string; error: string }[] = [];

  for (const rawSql of plan.queries.slice(0, 7)) {
    const sql = rawSql.trim();
    if (!sql) continue;

    try {
      validateSQL(sql);
    } catch (err) {
      failedQueries.push({ query: sql, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    try {
      const queryResult = await prisma.$queryRawUnsafe(sql);
      allResults.push({ query: sql, result: serialize(queryResult) });
      allSqls.push(sql);
    } catch (err) {
      failedQueries.push({ query: sql, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
  }

  if (allResults.length === 0 && failedQueries.length > 0) {
    const retryResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: fullPrompt },
        ...historyMessages,
        { role: 'user', content: question },
        {
          role: 'user',
          content: `Your previous SQL queries ALL failed. Errors:
${failedQueries.map((f) => `SQL: ${f.query}\nError: ${f.error}`).join('\n\n')}

Fix: use correct table/column names from the schema. EVERY query MUST have LIMIT and WHERE date filter.
Return: { "queries": ["SELECT ..."] }`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const retryContent = retryResponse.choices[0]?.message?.content;
    if (retryContent) {
      try {
        const retryPlan = JSON.parse(retryContent);
        if (Array.isArray(retryPlan.queries)) {
          for (const rawSql of retryPlan.queries.slice(0, 5)) {
            const sql = rawSql.trim();
            if (!sql) continue;
            try {
              validateSQL(sql);
              const queryResult = await prisma.$queryRawUnsafe(sql);
              allResults.push({ query: sql, result: serialize(queryResult) });
              allSqls.push(sql);
            } catch {
              continue;
            }
          }
        }
      } catch { /* ignore parse errors on retry */ }
    }
  }

  if (allResults.length === 0) {
    throw new AppError(400, 'Не удалось выполнить SQL запросы. Попробуйте переформулировать вопрос.');
  }

  const resultsText = allResults.map((r, i) =>
    `--- Query ${i + 1} ---\nSQL: ${r.query}\nResult:\n${JSON.stringify(r.result, null, 2)}`
  ).join('\n\n');

  const answerResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    messages: [
      { role: 'system', content: fullPrompt },
      ...historyMessages,
      { role: 'user', content: question },
      { role: 'assistant', content: JSON.stringify({ queries: allSqls, plan: plan.plan }) },
      {
        role: 'user',
        content: `SQL results:

${resultsText}

Generate the FINAL analytical answer. Return JSON:
{
  "answer": "Rich Markdown answer",
  "entities": [{ "type": "client|deal|product|user", "id": "uuid-from-data", "name": "real name from data" }]
}

RULES:
1. Use REAL names from SQL results. NEVER "Менеджер 1", "Клиент 1", or UUIDs
2. **Bold** key metrics and names
3. Markdown tables with real names
4. Format numbers with spaces: 1 000 000
5. Use emojis for accents: 📊 📈 📉 ⚠️ ✅ 💡 🏆 📋
6. ### headers for sections
7. End with 💡 **Инсайт** section with data-driven recommendation
8. If comparing periods: show % change
9. Explain WHY, not just WHAT
10. entities array: ONLY include entities where "name" is a REAL human/company name from the SQL data. NEVER put a UUID as "name". If unsure of the name, omit that entity.
11. Respond in the SAME language as the user's question (Russian or Uzbek)
12. Product / client rankings: table MUST show quantity sum and UZS sum columns if the SQL returned them — do not hide amounts and only show frequency
13. If SQL returned empty rows but a sanity-check query listed similar products, say the product name might differ in the catalog and list matches — do not invent "no demand" without that check`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const answerContent = answerResponse.choices[0]?.message?.content;
  if (!answerContent) {
    throw new AppError(500, 'AI не смог сформировать ответ.');
  }

  let parsed: { answer?: string; entities?: any[] };
  try {
    parsed = JSON.parse(answerContent);
  } catch {
    throw new AppError(500, 'AI вернул некорректный ответ.');
  }

  return {
    answer: parsed.answer || 'Не удалось получить ответ.',
    sql: allSqls.join('\n;\n'),
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
  };
}
