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

RESPONSE FORMAT (strict JSON):
{
  "sql": "SELECT ...",
  "answer": "human-readable answer in Russian",
  "entities": [
    { "type": "client", "id": "uuid", "name": "company name" }
  ]
}

- "entities" must include all relevant client/deal/product IDs for navigation
- entity type can be: "client", "deal", "product"
- If no entities are relevant, return empty array []
- Always include the SQL you generated in the "sql" field

IMPORTANT:
- Think step by step
- First generate the SQL query
- The system will execute it and give you the results
- Then generate the final answer based on the actual data`;

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

export async function askQuestion(question: string): Promise<AiAssistantResponse> {
  const openai = getOpenAIClient();

  // Step 1: Ask OpenAI to generate SQL
  const sqlResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Вопрос пользователя: "${question}"

Generate the SQL query first. Return JSON with "sql" field containing the query. Do NOT include the final answer yet — I will execute the SQL and give you the results.

Return ONLY valid JSON: { "sql": "SELECT ..." }`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const sqlContent = sqlResponse.choices[0]?.message?.content;
  if (!sqlContent) {
    throw new AppError(500, 'AI не смог сгенерировать запрос.');
  }

  let parsedSql: { sql: string };
  try {
    parsedSql = JSON.parse(sqlContent);
  } catch {
    throw new AppError(500, 'AI вернул некорректный JSON.');
  }

  const sql = parsedSql.sql?.trim();
  if (!sql) {
    throw new AppError(500, 'AI не вернул SQL запрос.');
  }

  validateSQL(sql);

  // Step 2: Execute the SQL
  let queryResult: unknown;
  try {
    queryResult = await prisma.$queryRawUnsafe(sql);
    queryResult = serialize(queryResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(400, `Ошибка выполнения SQL: ${msg}`);
  }

  // Step 3: Ask OpenAI to format the final answer
  const answerResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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
  "entities": [{ "type": "client|deal|product", "id": "uuid", "name": "название" }]
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
