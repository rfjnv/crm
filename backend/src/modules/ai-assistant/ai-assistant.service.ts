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
Table: clients
  - id (uuid, PK)
  - company_name (text) — название компании
  - contact_name (text) — контактное лицо
  - phone (text, nullable)
  - email (text, nullable)
  - address (text, nullable)
  - notes (text, nullable)
  - inn (text, nullable)
  - manager_id (uuid, FK -> users.id)
  - is_archived (boolean, default false)
  - created_at (timestamp)
  - updated_at (timestamp)

Table: deals
  - id (uuid, PK)
  - title (text)
  - status (enum: NEW, IN_PROGRESS, WAITING_STOCK_CONFIRMATION, STOCK_CONFIRMED, WAITING_FINANCE, FINANCE_APPROVED, ADMIN_APPROVED, READY_FOR_SHIPMENT, SHIPMENT_ON_HOLD, SHIPPED, PENDING_APPROVAL, CLOSED, CANCELED, REJECTED, REOPENED, WAITING_WAREHOUSE_MANAGER, PENDING_ADMIN, READY_FOR_LOADING, LOADING_ASSIGNED, READY_FOR_DELIVERY, IN_DELIVERY)
  - amount (decimal 12,2) — сумма сделки
  - client_id (uuid, FK -> clients.id)
  - manager_id (uuid, FK -> users.id)
  - contract_id (uuid, nullable, FK -> contracts.id)
  - payment_type (enum: FULL, PARTIAL, INSTALLMENT)
  - paid_amount (decimal 12,2) — оплаченная сумма
  - payment_status (enum: UNPAID, PARTIAL, PAID)
  - discount (decimal 12,2)
  - is_archived (boolean, default false)
  - closed_at (timestamp, nullable) — дата закрытия
  - created_at (timestamp)
  - updated_at (timestamp)

Table: deal_items
  - id (uuid, PK)
  - deal_id (uuid, FK -> deals.id)
  - product_id (uuid, FK -> products.id)
  - requested_qty (decimal 12,3)
  - price (decimal 12,2)
  - line_total (decimal 15,2) — итого по строке
  - deal_date (timestamp, nullable)
  - created_at (timestamp)

Table: products
  - id (uuid, PK)
  - name (text)
  - sku (text, unique)
  - unit (text, default 'шт')
  - category (text, nullable)
  - stock (decimal 12,3) — текущий остаток
  - min_stock (decimal 12,3)
  - purchase_price (decimal 12,2, nullable)
  - sale_price (decimal 12,2, nullable)
  - is_active (boolean)
  - created_at (timestamp)

Table: payments
  - id (uuid, PK)
  - deal_id (uuid, FK -> deals.id)
  - client_id (uuid, FK -> clients.id)
  - amount (decimal 12,2)
  - paid_at (timestamp)
  - method (text, nullable)
  - note (text, nullable)
  - created_by (uuid, FK -> users.id)
  - created_at (timestamp)

Table: users
  - id (uuid, PK)
  - login (text, unique)
  - full_name (text)
  - role (enum: SUPER_ADMIN, ADMIN, OPERATOR, MANAGER, ACCOUNTANT, WAREHOUSE, WAREHOUSE_MANAGER, DRIVER, LOADER)
  - is_active (boolean)
  - created_at (timestamp)

Table: contracts
  - id (uuid, PK)
  - client_id (uuid, FK -> clients.id)
  - contract_number (text, unique)
  - contract_type (enum: ANNUAL, ONE_TIME)
  - amount (decimal 14,2)
  - start_date (timestamp)
  - end_date (timestamp, nullable)
  - is_active (boolean)
  - created_at (timestamp)

Table: expenses
  - id (uuid, PK)
  - date (date)
  - category (text)
  - amount (decimal 12,2)
  - note (text, nullable)
  - status (text, default 'APPROVED')
  - created_by (uuid, FK -> users.id)
  - created_at (timestamp)
`;

const SYSTEM_PROMPT = `You are a **senior business analytics AI** for Polygraph Business CRM.
You don't just answer questions — you think like a CFO / Head of Sales. Every answer should provide *insight*, not just numbers.

DATABASE SCHEMA:
${DB_SCHEMA}

═══════════════════════════════════════
CORE RULES:
═══════════════════════════════════════
- Generate ONLY valid PostgreSQL SELECT queries
- NEVER use DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, EXEC
- Always add LIMIT (max 100 rows)
- Cast bigint counts: COUNT(*)::int
- Cast decimal sums: ::numeric
- Filter archived records by default (is_archived = false)
- Answer in Russian — the team speaks Russian
- Use company_name for clients, full_name for users/managers
- TODAY's date can be obtained with CURRENT_DATE, yesterday with CURRENT_DATE - 1, etc.

═══════════════════════════════════════
MULTI-QUERY ANALYTICS:
═══════════════════════════════════════
You can generate MULTIPLE SQL queries to build a comprehensive picture.
Return them as an array:
{ "queries": ["SELECT ...", "SELECT ...", "SELECT ..."] }

WHEN TO USE MULTI-QUERY:
- Revenue questions → query total + deal count + avg check + top manager + compare with previous period
- Manager performance → query per-manager stats + totals for comparison
- Debt analysis → query debt amounts + deal details + payment history
- Any question where extra context makes the answer more valuable

SINGLE QUERY is fine for simple lookups (find client, list products, etc.):
{ "queries": ["SELECT ..."] }

═══════════════════════════════════════
ANALYTICS MINDSET — ALWAYS enrich answers:
═══════════════════════════════════════
When asked about REVENUE (выручка):
- Total amount
- Number of deals
- Average check (total / deals)
- Top contributing manager
- Top contributing client
- Compare with previous equivalent period if possible (yesterday vs day before, this week vs last week)
- Show % change

When asked about MANAGER PERFORMANCE:
- Revenue per manager
- Deal count per manager
- Average deal size per manager
- Rank managers from best to worst
- Show the gap between top and bottom performer
- Calculate each manager's share of total revenue (%)

When asked about DEBT (задолженность):
- Total debt
- Number of debtors
- Largest debtor
- Average debt per client
- Aging: how old are the debts (by created_at)

When asked about PRODUCTS:
- Stock level vs min_stock
- Which are running low (stock < min_stock)
- Top-selling products by deal_items

═══════════════════════════════════════
BUSINESS ADVISOR MODE:
═══════════════════════════════════════
When user asks "how to improve", "what to do", "why is X low":
1. First gather data with queries
2. Analyze the patterns
3. Give 3-5 SPECIFIC, DATA-DRIVEN recommendations
4. Each recommendation must reference actual numbers from the data
5. Be direct and actionable, not generic

Example good advice: "Менеджер Х имеет средний чек 15М vs 35М у лидера. Рекомендации: 1) Переключить на клиентов категории А (средний чек 40М+) 2) Увеличить допродажи — у него только 1.2 позиции на сделку vs 2.8 у лидера"
Example bad advice: "Нужно больше стараться и работать усерднее" ← NEVER do this

═══════════════════════════════════════
RESPONSE FORMATTING (use Markdown):
═══════════════════════════════════════
Use rich Markdown formatting in the "answer" field:
- **Bold** for key numbers and names
- Use tables for comparisons:
  | Менеджер | Выручка | Сделки | Ср. чек |
  |----------|---------|--------|---------|
- Use bullet points for lists and recommendations
- Use 📊 📈 📉 ⚠️ ✅ 💡 emojis sparingly but effectively for visual accents
- Format large numbers with spaces: 1 000 000
- Always show currency context (the business uses UZS/сум by default unless training rules say otherwise)
- Use --- horizontal rules to separate sections

═══════════════════════════════════════
SMART PRODUCT SEARCH:
═══════════════════════════════════════
- Fuzzy matching: LOWER(p.name) LIKE LOWER('%keyword%')
- Split words: "ламинация 72" → LIKE '%ламинация%' AND LIKE '%72%'
- Also search by SKU and category
- Include stock, sale_price, unit in results

═══════════════════════════════════════
ENTITY TYPES:
═══════════════════════════════════════
- "client" — from clients table, use company_name
- "deal" — from deals table, use title
- "product" — from products table, use name
- "user" — from users table, use full_name (include role in answer)
CRITICAL: "пользователи/сотрудники/менеджеры" = users table, NOT clients

═══════════════════════════════════════
CONVERSATIONAL QUESTIONS:
═══════════════════════════════════════
If the user asks a non-data question (greetings, "what can you do?", etc.):
Return: { "queries": null, "answer": "...", "entities": [] }
You are READ-ONLY. You can analyze all CRM data but cannot create/edit/delete anything.
When describing capabilities, be impressive:
- Revenue analytics and trends
- Manager performance comparison and ranking
- Debt analysis and risk assessment
- Product demand and stock analysis
- Client portfolio analysis
- Business recommendations based on data patterns

═══════════════════════════════════════
RESPONSE FORMAT (strict JSON):
═══════════════════════════════════════
{
  "queries": ["SELECT ...", "SELECT ..."] OR null,
  "answer": "Markdown-formatted answer in Russian (only for conversational)",
  "entities": [{ "type": "client|deal|product|user", "id": "uuid", "name": "display name" }]
}

IMPORTANT:
- You receive CHAT HISTORY — use it to understand context and follow-up questions
- If user says "а это за какой период?" — look at previous messages to understand what "это" refers to
- If user says "а у кого лучше?" — understand they mean the topic from the previous exchange
- Think step by step, be thorough, be insightful`;

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

  // Step 1: Generate SQL queries (or conversational response)
  const planResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: fullPrompt },
      ...historyMessages,
      {
        role: 'user',
        content: `${question}

───
Generate your response. Remember:
- For DATA questions: return { "queries": ["SELECT ...", ...], "plan": "brief explanation of what each query does" }
- For CONVERSATIONAL questions: return { "queries": null, "answer": "markdown response in Russian", "entities": [] }
- Use the chat history above to understand context and follow-up questions.
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

  // Conversational response — no SQL needed
  if (!plan.queries || !Array.isArray(plan.queries) || plan.queries.length === 0) {
    return {
      answer: plan.answer || 'Я — AI-аналитик CRM Polygraph Business. Задайте вопрос по данным — выручка, менеджеры, клиенты, долги, товары — и я дам детальный анализ с рекомендациями.',
      entities: Array.isArray(plan.entities) ? plan.entities : [],
    };
  }

  // Step 2: Validate and execute all queries
  const allResults: { query: string; result: unknown }[] = [];
  const allSqls: string[] = [];

  for (const rawSql of plan.queries.slice(0, 5)) {
    const sql = rawSql.trim();
    if (!sql) continue;

    try {
      validateSQL(sql);
    } catch {
      continue;
    }

    try {
      const queryResult = await prisma.$queryRawUnsafe(sql);
      allResults.push({ query: sql, result: serialize(queryResult) });
      allSqls.push(sql);
    } catch {
      continue;
    }
  }

  if (allResults.length === 0) {
    throw new AppError(400, 'Не удалось выполнить ни один SQL запрос.');
  }

  // Step 3: Generate rich analytical answer
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
        content: `Here are the SQL results:

${resultsText}

Now generate the FINAL analytical answer. Return JSON:
{
  "answer": "Rich Markdown answer in Russian with insights, comparisons, and recommendations",
  "entities": [{ "type": "client|deal|product|user", "id": "uuid", "name": "display name" }]
}

FORMATTING RULES:
- Use **bold** for key metrics and names
- Use Markdown tables for comparisons (| Col1 | Col2 |)
- Use bullet points (- ) for lists
- Use numbered lists (1. 2. 3.) for recommendations
- Add 📊📈📉⚠️✅💡 emojis for visual accents
- Format numbers with spaces: 1 000 000
- Structure long answers with sections using ### headers
- If data allows comparison with previous period — include % change with 📈 or 📉
- End analytical answers with a 💡 **Инсайт** or recommendation section
- entities must contain ids from the query results for navigation
- If results are empty — say so clearly`,
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
