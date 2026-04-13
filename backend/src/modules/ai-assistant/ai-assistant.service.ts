import OpenAI from 'openai';
import { config } from '../../lib/config';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import type { AiAssistantResponse } from './ai-assistant.dto';

const FORBIDDEN_KEYWORDS = [
  'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'TRUNCATE',
  'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
];

const DB_SCHEMA = `
Table: clients (mapped from Prisma model Client)
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

Table: deals (mapped from Prisma model Deal)
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

Table: deal_items (mapped from Prisma model DealItem)
  - id (uuid, PK)
  - deal_id (uuid, FK -> deals.id)
  - product_id (uuid, FK -> products.id)
  - requested_qty (decimal 12,3)
  - price (decimal 12,2)
  - line_total (decimal 15,2) — итого по строке
  - deal_date (timestamp, nullable)
  - created_at (timestamp)

Table: products (mapped from Prisma model Product)
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

Table: payments (mapped from Prisma model Payment)
  - id (uuid, PK)
  - deal_id (uuid, FK -> deals.id)
  - client_id (uuid, FK -> clients.id)
  - amount (decimal 12,2)
  - paid_at (timestamp)
  - method (text, nullable)
  - note (text, nullable)
  - created_by (uuid, FK -> users.id)
  - created_at (timestamp)

Table: users (mapped from Prisma model User)
  - id (uuid, PK)
  - login (text, unique)
  - full_name (text)
  - role (enum: SUPER_ADMIN, ADMIN, OPERATOR, MANAGER, ACCOUNTANT, WAREHOUSE, WAREHOUSE_MANAGER, DRIVER, LOADER)
  - is_active (boolean)
  - created_at (timestamp)

Table: contracts (mapped from Prisma model Contract)
  - id (uuid, PK)
  - client_id (uuid, FK -> clients.id)
  - contract_number (text, unique)
  - contract_type (enum: ANNUAL, ONE_TIME)
  - amount (decimal 14,2)
  - start_date (timestamp)
  - end_date (timestamp, nullable)
  - is_active (boolean)
  - created_at (timestamp)

Table: expenses (mapped from Prisma model Expense)
  - id (uuid, PK)
  - date (date)
  - category (text)
  - amount (decimal 12,2)
  - note (text, nullable)
  - status (text, default 'APPROVED')
  - created_by (uuid, FK -> users.id)
  - created_at (timestamp)
`;

const SYSTEM_PROMPT = `You are an AI data assistant for a CRM system (Polygraph Business).
Your job is to answer user questions using real data from the PostgreSQL database.

DATABASE SCHEMA:
${DB_SCHEMA}

RULES:
- Generate ONLY valid PostgreSQL SELECT queries
- NEVER use DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, EXEC
- Always add LIMIT (max 100 rows)
- Use ORDER BY when appropriate
- Use JOINs when needed to connect related tables
- Cast bigint counts to int: COUNT(*)::int
- Cast decimal sums to numeric for JSON serialization
- When calculating debt: SUM(d.amount - d.paid_amount) for unpaid deals
- Filter out archived records (is_archived = false) by default unless user asks about archived
- The user speaks Russian (Uzbek CRM), answer in Russian
- Use company_name for client names, full_name for user/manager names

SMART PRODUCT SEARCH:
- When searching for products by name, ALWAYS use fuzzy matching: LOWER(p.name) LIKE LOWER('%keyword%')
- Split user's search into individual words and match ALL of them: e.g. "ламинация 72" → LOWER(name) LIKE '%ламинация%' AND LOWER(name) LIKE '%72%'
- Also search by SKU: OR LOWER(p.sku) LIKE LOWER('%keyword%')
- Also search in category: OR LOWER(p.category) LIKE LOWER('%keyword%')
- When user asks "найди товар X" or "есть ли X" or "поиск X" — search products table with fuzzy matching
- Include stock, sale_price, unit in results so the user sees availability
- If no exact match found, try broader search with fewer keywords

ENTITY TYPES — use the correct type depending on context:
- "client" — for clients (from clients table), use company_name as name
- "deal" — for deals (from deals table), use title as name
- "product" — for products (from products table), use name
- "user" — for users/employees/managers (from users table), use full_name as name, and include their role in the answer

CRITICAL: When the user asks about "пользователи", "сотрудники", "менеджеры" — these are USERS (from the users table), NOT clients. Always use type "user" for them. Clients are companies (from the clients table).

RESPONSE FORMAT (strict JSON):
{
  "sql": "SELECT ...",
  "answer": "human-readable answer in Russian",
  "entities": [
    { "type": "client|deal|product|user", "id": "uuid", "name": "display name" }
  ]
}

- "entities" must include all relevant IDs for navigation
- If no entities are relevant, return empty array []
- Always include the SQL you generated in the "sql" field
- When listing users, always mention their role (ADMIN, MANAGER, etc.) in the answer

CONVERSATIONAL QUESTIONS:
- If the user asks a non-data question (greetings, "what can you do?", "can you create tasks?", etc.) — do NOT generate SQL
- Instead return: { "sql": null, "answer": "your conversational response in Russian", "entities": [] }
- You are a READ-ONLY assistant: you can only QUERY data, you CANNOT create, edit, or delete anything
- When asked what you can do, explain: you can answer questions about clients, deals, products, users, payments, debts, expenses — any data in the CRM

IMPORTANT:
- Think step by step
- For data questions: first generate the SQL query, the system will execute it and give you the results, then generate the final answer
- For non-data questions: respond directly without SQL`;

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

// ==================== ASK QUESTION (with DB persistence) ====================

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

  // Save user message
  await prisma.aiChatMessage.create({
    data: { chatId, role: 'user', content: question },
  });

  // Auto-title on first message
  const isFirstMessage = chat._count.messages === 0;
  if (isFirstMessage) {
    await prisma.aiChat.update({
      where: { id: chatId },
      data: { title: generateTitle(question) },
    });
  }

  // Touch updatedAt
  await prisma.aiChat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });

  let result: AiAssistantResponse;
  try {
    result = await executeAiQuery(question);
  } catch (err) {
    const errorMsg = err instanceof AppError ? err.message : 'Произошла ошибка при обработке запроса';
    await prisma.aiChatMessage.create({
      data: { chatId, role: 'assistant', content: errorMsg, isError: true },
    });
    throw err;
  }

  // Save assistant message
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

// Core AI query logic (extracted from old askQuestion)
async function executeAiQuery(question: string): Promise<AiAssistantResponse> {
  const openai = getOpenAIClient();
  const customRules = await getActiveTrainingRules();
  const fullPrompt = SYSTEM_PROMPT + customRules;

  const sqlResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: fullPrompt },
      {
        role: 'user',
        content: `Вопрос пользователя: "${question}"

If this is a DATA question — generate SQL. Return: { "sql": "SELECT ..." }
If this is a CONVERSATIONAL question (greeting, capabilities, non-data) — return: { "sql": null, "answer": "ответ на русском", "entities": [] }

Return ONLY valid JSON.`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const sqlContent = sqlResponse.choices[0]?.message?.content;
  if (!sqlContent) {
    throw new AppError(500, 'AI не смог сгенерировать запрос.');
  }

  let parsedFirst: { sql?: string | null; answer?: string; entities?: any[] };
  try {
    parsedFirst = JSON.parse(sqlContent);
  } catch {
    throw new AppError(500, 'AI вернул некорректный JSON.');
  }

  if (!parsedFirst.sql) {
    return {
      answer: parsedFirst.answer || 'Я — AI-ассистент CRM. Я могу отвечать на вопросы по данным: клиенты, сделки, товары, платежи, пользователи и расходы.',
      entities: Array.isArray(parsedFirst.entities) ? parsedFirst.entities : [],
    };
  }

  const sql = parsedFirst.sql.trim();
  validateSQL(sql);

  let queryResult: unknown;
  try {
    queryResult = await prisma.$queryRawUnsafe(sql);
    queryResult = serialize(queryResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(400, `Ошибка выполнения SQL: ${msg}`);
  }

  const answerResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: fullPrompt },
      { role: 'user', content: `Вопрос: "${question}"` },
      { role: 'assistant', content: JSON.stringify({ sql }) },
      {
        role: 'user',
        content: `Результат SQL запроса:
${JSON.stringify(queryResult, null, 2)}

Теперь сформируй финальный ответ. Верни JSON:
{
  "sql": "${sql.replace(/"/g, '\\"')}",
  "answer": "понятный ответ на русском языке с конкретными цифрами",
  "entities": [{ "type": "client|deal|product|user", "id": "uuid", "name": "название" }]
}

Правила:
- Форматируй числа с разделителями (1,000,000)
- Упоминай конкретные имена и суммы
- entities должны содержать id из результата запроса для навигации
- Если результат пустой — скажи об этом`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const answerContent = answerResponse.choices[0]?.message?.content;
  if (!answerContent) {
    throw new AppError(500, 'AI не смог сформировать ответ.');
  }

  let parsed: AiAssistantResponse;
  try {
    parsed = JSON.parse(answerContent);
  } catch {
    throw new AppError(500, 'AI вернул некорректный ответ.');
  }

  return {
    answer: parsed.answer || 'Не удалось получить ответ.',
    sql: sql,
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
  };
}
