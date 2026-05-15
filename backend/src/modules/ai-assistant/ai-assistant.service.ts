import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../lib/config';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import type { AiAssistantResponse } from './ai-assistant.dto';
import type { LanguageMode, TranscriptionResult } from '../asr/polygraph-transcriber';
import { transcribeWithElevenLabs } from '../asr/elevenlabs-transcriber';
import { transcribeWithAisha } from '../asr/aisha-transcriber';
import { mergeTranscriptsWithClaude, type CandidateTranscript } from '../asr/claude-merger';

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
- DATE RANGE (full access to all history):
  - You MAY query **any date range** including **all time** (entire database history). There is NO requirement to add a date filter on every query.
  - If the user names a period ("сегодня", "этот месяц", "2025 год", "последние 120 дней", "за январь") -> apply a precise WHERE on the relevant timestamp/date column.
  - If the user asks for totals, "ever", "за всё время", "всего", "вообще", "all time", ranking without a period, or does not narrow time -> query **without** a date filter (still use LIMIT and sane filters like is_archived = false). State in the answer that the figures are **for all available data** when no period was given.
  - Prefer COALESCE(di.deal_date, di.created_at, d.created_at) or closed_at when the question is revenue/deals timing; use created_at for audit_logs, etc.
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
- Period column when user asks a range: COALESCE(di.deal_date, di.created_at, d.created_at) (not only closed_at). If user wants all-time product stats, omit date filter (still LIMIT).
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

function getClaudeClient(): Anthropic {
  const apiKey = config.claude.apiKey;
  if (!apiKey) {
    throw new AppError(500, 'CLAUDE_API_KEY не настроен. Обратитесь к администратору.');
  }
  return new Anthropic({ apiKey });
}

// ============================================================
// Multi-engine transcription
// Запускаем все 3 STT параллельно (AISHA / ElevenLabs / OpenAI),
// затем Claude собирает один финальный диалог.
// ============================================================

export interface EngineMeta {
  engine: 'aisha' | 'elevenlabs' | 'openai';
  status: 'success' | 'error' | 'skipped';
  textLength: number;
  durationMs: number;
  error?: string;
}

export interface TranscribeAudioResponse {
  text: string;
  rawText: string;
  dialogueText: string;
  languageMode: LanguageMode;
  audioQuality: {
    sampleRate: number;
    channels: number;
    durationSec: number;
    isLowQuality: boolean;
    warnings: string[];
  };
  qualityScore: number;
  needsHumanReview: boolean;
  auditRecommended: boolean;
  auditSkipReason?: string;
  model: string;
  segments: TranscriptionResult['segments'];
  engines: EngineMeta[];
  disputedNote: string;
  enginesUsed: number;
  mergeModel: string;
}

interface EngineRunResult {
  engine: 'aisha' | 'elevenlabs' | 'openai';
  text: string;
  hasDiarization?: boolean;
  durationMs: number;
  error?: string;
  status: 'success' | 'error' | 'skipped';
  // Optional engine-specific extras for shaping the response
  audioQuality?: TranscribeAudioResponse['audioQuality'];
  qualityScore?: number;
  needsHumanReview?: boolean;
  segments?: TranscriptionResult['segments'];
}

async function runAisha(filePath: string, languageMode: LanguageMode): Promise<EngineRunResult> {
  const start = Date.now();
  const apiKey = config.aisha.apiKey;
  if (!apiKey) {
    return { engine: 'aisha', text: '', status: 'skipped', durationMs: 0, error: 'AISHA_AI_API_KEY не настроен' };
  }
  try {
    const res = await transcribeWithAisha(filePath, apiKey, {
      languageMode,
      baseUrl: config.aisha.baseUrl,
    });
    return {
      engine: 'aisha',
      text: res.text,
      durationMs: res.durationMs || (Date.now() - start),
      status: 'success',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ASR] AISHA failed:', msg);
    return { engine: 'aisha', text: '', status: 'error', durationMs: Date.now() - start, error: msg };
  }
}

async function runElevenLabs(filePath: string, languageMode: LanguageMode): Promise<EngineRunResult> {
  const start = Date.now();
  const apiKey = config.elevenlabs.apiKey;
  if (!apiKey) {
    return { engine: 'elevenlabs', text: '', status: 'skipped', durationMs: 0, error: 'ELEVENLABS_API_KEY не настроен' };
  }
  try {
    const res = await transcribeWithElevenLabs(filePath, apiKey, { languageMode });
    return {
      engine: 'elevenlabs',
      text: res.dialogueText || res.rawText,
      hasDiarization: res.hasDiarization,
      durationMs: Date.now() - start,
      status: 'success',
      segments: res.words
        .filter((w) => w.type === 'word')
        .map((w, i) => ({
          id: i,
          start: w.start,
          end: w.end,
          speaker: w.speaker_id ?? 'unknown',
          speakerRole: null,
          text: w.text,
          language: res.languageCode || null,
          confidence: res.languageProbability ?? null,
        })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ASR] ElevenLabs failed:', msg);
    return { engine: 'elevenlabs', text: '', status: 'error', durationMs: Date.now() - start, error: msg };
  }
}


export async function transcribeAudioFile(
  file: Express.Multer.File,
  opts: { languageMode?: LanguageMode } = {},
): Promise<TranscribeAudioResponse> {
  if (!file) {
    throw new AppError(400, 'Аудио файл не передан');
  }

  const languageMode: LanguageMode = opts.languageMode ?? 'auto';

  // ── Smart engine routing ──
  // uz  → AISHA only  (strongest for Uzbek)
  // ru  → ElevenLabs only (strongest for Russian)
  // auto/mixed → both in parallel
  const useAisha = languageMode !== 'ru';
  const useElevenLabs = languageMode !== 'uz';

  const [aishaRes, elevenRes] = await Promise.all([
    useAisha
      ? runAisha(file.path, languageMode)
      : Promise.resolve<EngineRunResult>({ engine: 'aisha', text: '', status: 'skipped', durationMs: 0, error: 'Пропущен: язык ru' }),
    useElevenLabs
      ? runElevenLabs(file.path, languageMode)
      : Promise.resolve<EngineRunResult>({ engine: 'elevenlabs', text: '', status: 'skipped', durationMs: 0, error: 'Пропущен: язык uz' }),
  ]);

  const allRuns = [aishaRes, elevenRes];
  const successful = allRuns.filter((r) => r.status === 'success' && r.text.trim().length > 0);

  if (successful.length === 0) {
    const errors = allRuns
      .filter((r) => r.status !== 'success')
      .map((r) => `${r.engine}: ${r.error || r.status}`)
      .join('; ');
    throw new AppError(
      500,
      `Ни один из STT движков не справился. ${errors || 'Проверьте ключи AISHA_AI_API_KEY / ELEVENLABS_API_KEY'}`,
    );
  }

  // ── Claude merges the 3 transcripts into one ──
  const candidates: CandidateTranscript[] = successful.map((r) => ({
    engine: r.engine,
    text: r.text,
    hasDiarization: r.hasDiarization,
  }));

  let mergedText = '';
  let disputedNote = '';
  let mergeModel = 'fallback';

  const claudeKey = config.claude.apiKey;
  if (claudeKey && candidates.length >= 2) {
    try {
      const merged = await mergeTranscriptsWithClaude(candidates, claudeKey, {
        model: config.claude.model,
      });
      mergedText = merged.mergedText;
      disputedNote = merged.disputedNote;
      mergeModel = merged.modelUsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ASR] Claude merge failed, falling back to longest transcript:', msg);
    }
  }

  // Fallback: pick the longest successful transcript
  if (!mergedText) {
    const longest = [...successful].sort((a, b) => b.text.length - a.text.length)[0];
    mergedText = longest.text;
    disputedNote = claudeKey
      ? `Claude недоступен — использован самый длинный транскрипт (${longest.engine.toUpperCase()}).`
      : `CLAUDE_API_KEY не настроен — слияние не выполнялось, использован транскрипт ${longest.engine.toUpperCase()}.`;
  }

  // ── Build response meta ──
  const engines: EngineMeta[] = allRuns.map((r) => ({
    engine: r.engine,
    status: r.status,
    textLength: r.text.length,
    durationMs: r.durationMs,
    error: r.error,
  }));

  const audioQuality = {
    sampleRate: 0,
    channels: 0,
    durationSec: 0,
    isLowQuality: false,
    warnings: [] as string[],
  };

  const segments =
    allRuns.find((r) => r.engine === 'elevenlabs' && r.status === 'success')?.segments ?? [];

  // Quality score: high if ≥2 engines succeeded and merged text is substantial
  const qualityScore =
    successful.length >= 2 && mergedText.length > 50
      ? 9.5
      : successful.length === 1 && mergedText.length > 50
      ? 7.5
      : mergedText.length > 20
      ? 6.0
      : 4.0;

  const auditRecommended = mergedText.length > 20;
  const auditSkipReason = auditRecommended ? undefined : 'Транскрипт слишком короткий для аудита';

  return {
    text: mergedText,
    rawText: mergedText,
    dialogueText: mergedText,
    languageMode,
    audioQuality,
    qualityScore,
    needsHumanReview: successful.length < 2,
    auditRecommended,
    auditSkipReason,
    model: `${successful.map((r) => r.engine).join('+')} → ${mergeModel ?? 'fallback'}`,
    segments,
    engines,
    disputedNote,
    enginesUsed: successful.length,
    mergeModel,
  };
}

const SALES_AUDIT_LANG_INSTRUCTIONS: Record<string, string> = {
  ru: '- Весь ответ пиши на русском языке',
  uz: '- Весь ответ пиши на узбекском языке (латиница)',
  mixed: '- Пиши в смешанном стиле: узбекский + русский, но термины сохраняй понятно для менеджера.',
};

function buildSalesAuditSystemPrompt(auditLanguage: string = 'mixed'): string {
  const langInstruction = SALES_AUDIT_LANG_INSTRUCTIONS[auditLanguage] ?? SALES_AUDIT_LANG_INSTRUCTIONS['mixed'];
  return `Ты — эксперт по анализу звонков отдела продаж и клиентского сервиса.
Твоя задача — сделать точный, объективный и практичный анализ звонка.

ЯЗЫК:
${langInstruction}

КРИТИЧЕСКИЕ ПРАВИЛА:
1) Сначала классифицируй тип звонка и только потом применяй соответствующую воронку.
2) Не применяй framework продаж к сервисному звонку и наоборот.
3) Каждый вывод подкрепляй цитатой из транскрипта.
4) Если данных недостаточно — пиши "Недостаточно данных / Dalil yetarli emas", не додумывай.
5) Не используй странные, нелитературные или ошибочные слова (например "Dushlik").
6) Оценки ставь с дробной точностью (например 6.4), а не "на глаз".
7) Вероятность продажи указывай только при наличии явных сигналов в разговоре.
8) Не пиши вводных фраз про себя ("как AI", "как языковая модель", "ниже представлен анализ", "конечно"). Сразу начинай с "ШАГ 1".
9) Таблицы оформляй только валидным Markdown/GFM: строка заголовков, строка разделителей "| --- |" и строки данных. Не используй псевдотаблицы из одних дефисов или палочек без заголовка.

СТРУКТУРА ANALYSIS (строго 9 шагов):
ШАГ 1 — Классификация звонка:
- Новая продажа / Аккаунт-менеджмент / Сервис-рекламация / Смешанный

ШАГ 2 — Участники и контекст:
- роли, канал, цель менеджера, ожидания клиента

ШАГ 3 — Результаты звонка:
- таблица "Цель | Статус | Комментарий"

ШАГ 4 — Воронка:
- если продажа: Контакт → Квалификация → Потребность → Презентация → Возражения → Закрытие → Next step
- если сервис/аккаунт: Контакт → Выяснение ситуации → Решение вопроса → Управление ожиданиями → Договоренности → Next step
- для каждого этапа: ✅/⚠️/❌ + цитата

ШАГ 5 — 3-5 критических развилок:
- момент (цитата), что хорошо/плохо, как надо сказать, почему важно

ШАГ 6 — Customer Health:
- таблица сигналов: лояльность, бюджет/намерение, доверие, апсейл-потенциал

ШАГ 7 — Оценка по критериям:
- таблица критериев (1-10) + обоснование цитатой + итог (среднее взвешенное)

ШАГ 8 — Приоритетные рекомендации:
- ровно 3-5 рекомендаций, каждая: проблема / рекомендация / конкретный скрипт

ШАГ 9 — Итог:
- 3 предложения: что хорошо, главная точка роста, что будет если не менять

JSON-ВЫХОД:
{
  "analysis": "готовый анализ в формате 9 шагов выше",
  "score": <number 1-10>,
  "saleProbability": <number 0-100 or null>,
  "mentorTips": ["совет 1", "совет 2", "совет 3"],
  "stageChecklist": {
    "greeting": true|false,
    "needsDiscovery": true|false,
    "presentation": true|false,
    "objectionHandling": true|false,
    "closing": true|false
  }
}`;
}

const SALES_AUDIT_OUTPUT_FORMAT = `Analysis должен содержать 9 шагов с таблицами и цитатами по правилам выше.`;

function extractScoreFromAnalysis(analysis: string): { score: number | null; saleProbability: number | null } {
  let score: number | null = null;
  let saleProbability: number | null = null;

  // Match "Baho: 7/10" or "Оценка: 7/10" or "Baho: 7" patterns
  const scoreMatch = analysis.match(/(?:baho|оценка)[:\s]*(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/i);
  if (scoreMatch) {
    const val = parseFloat(scoreMatch[1]);
    if (val >= 1 && val <= 10) score = val;
  }

  // Match "Sotuv ehtimoli: 70%" or "Вероятность продажи: 70%"
  const probMatch = analysis.match(/(?:sotuv ehtimoli|вероятность продажи)[:\s]*(\d+)\s*%/i);
  if (probMatch) {
    const val = parseInt(probMatch[1], 10);
    if (val >= 0 && val <= 100) saleProbability = val;
  }

  return { score, saleProbability };
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI не вернул JSON');
  }
  return body.slice(start, end + 1);
}

/** Если JSON обрезан и не парсится — попробуем вытащить поле "analysis" построчным чтением. */
function extractAnalysisFromTruncatedJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
  const body = fenced ? fenced[1] : raw;
  const match = body.match(/"analysis"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"(?:score|saleProbability|mentorTips|stageChecklist)"|$)/);
  if (!match || !match[1]) return null;
  const value = match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
  return value || null;
}

type SalesStageChecklist = {
  greeting: boolean;
  needsDiscovery: boolean;
  presentation: boolean;
  objectionHandling: boolean;
  closing: boolean;
};

function inferStageChecklistFromAnalysis(analysis: string): SalesStageChecklist {
  const has = (pattern: RegExp) => pattern.test(analysis);
  return {
    greeting: has(/(?:salomlashish|приветствие)\s*:\s*(?:ha|да)/i),
    needsDiscovery: has(/(?:talablarni aniqlash|выявление потребностей)\s*:\s*(?:ha|да)/i),
    presentation: has(/(?:taqdimot|презентация)\s*:\s*(?:ha|да)/i),
    objectionHandling: has(/(?:e'tirozlar bilan ishlash|работа с возражениями)\s*:\s*(?:ha|да)/i),
    closing: has(/(?:bitimni yopish|закрытие сделки)\s*:\s*(?:ha|да)/i),
  };
}

export async function analyzeSalesCallTranscript(
  transcript: string,
  auditLanguage: string = 'mixed',
  opts: {
    userId?: string;
    managerName?: string;
    audioDuration?: number;
    qualityScore?: number;
    source?: string;
  } = {},
): Promise<{ analysis: string; auditId?: string; score?: number | null; saleProbability?: number | null; mentorTips?: string[]; stageChecklist?: SalesStageChecklist }> {
  if (!transcript || transcript.trim().length < 20) {
    throw new AppError(400, 'Недостаточно текста для анализа');
  }

  try {
    const claude = getClaudeClient();
    const customRules = await getActiveTrainingRules();
    const basePrompt = buildSalesAuditSystemPrompt(auditLanguage);
    const auditSystemPrompt = `${basePrompt}\n\n${customRules}`.trim();
    const completion = await claude.messages.create({
      model: config.claude.model,
      temperature: 0,
      max_tokens: 8000,
      system: auditSystemPrompt,
      messages: [
        {
          role: 'user',
          content: `=== ВХОДНЫЕ ДАННЫЕ ===
Вот расшифровка звонка:
${transcript}

=== ЗАДАЧИ ===

1. Определи роли:
- Кто менеджер
- Кто клиент

2. Анализ тона (эмоции):
- Клиент: (раздражён / нейтральный / заинтересован / сомневается)
- Менеджер: (уверенный / давящий / неуверенный / дружелюбный)

Оцени по шкале 1–10:
- Эмоциональное состояние клиента
- Качество коммуникации менеджера

3. Анализ ошибок менеджера:
Найди ВСЕ ошибки:
- перебивает клиента
- не выявил потребность
- не задал вопросы
- давит
- не закрыл сделку
- не отработал возражение
- говорит слишком много
- не слушает

Для каждой ошибки:
- кратко объясни
- приведи пример из текста

4. Анализ сильных сторон:
- что менеджер сделал хорошо

5. Проверка структуры продаж:
Отметь (ДА/НЕТ):
- приветствие
- выявление потребностей
- презентация
- работа с возражениями
- закрытие сделки

6. Общая оценка:
Поставь оценку менеджеру от 1 до 10

7. Вероятность продажи:
- % вероятность, что клиент купит

8. Рекомендации (САМОЕ ВАЖНОЕ):
Дай конкретные советы:
- что исправить
- как говорить лучше
- какие фразы использовать

9. КРАТКИЙ ВЫВОД:
Очень коротко:
- хороший звонок или плохой
- главная причина

КРИТИЧЕСКИЕ ПРАВИЛА КАЧЕСТВА:
- Har bir xulosa uchun 1 ta aniq iqtibos yoz ("misol: ...").
- Agar iqtibos bo'lmasa, xatoni tasdiqlama.
- "Menedjer yo'q" degan xulosa faqat matnda haqiqatan menedjer replikalari bo'lmasa yozilsin.
- Umumiy, shablon gaplar yozma. Faqat aniq fakt + iqtibos.
- Применяй только релевантный типу звонка framework.

${SALES_AUDIT_OUTPUT_FORMAT}

Верни только JSON по заданной выше схеме.
Не добавляй пояснения вне JSON.`,
        },
      ],
    });

    const raw = completion.content.find((c) => c.type === 'text' && 'text' in c)?.text?.trim() || '';
    if (!raw) {
      throw new AppError(500, 'Claude не вернул результат анализа');
    }

    let analysis = '';
    let score: number | null = null;
    let saleProbability: number | null = null;
    let mentorTips: string[] = [];
    let stageChecklist: SalesStageChecklist = {
      greeting: false,
      needsDiscovery: false,
      presentation: false,
      objectionHandling: false,
      closing: false,
    };
    try {
      const parsed = JSON.parse(extractJsonObject(raw)) as {
        analysis?: string;
        score?: number;
        saleProbability?: number;
        mentorTips?: string[];
        stageChecklist?: Partial<SalesStageChecklist>;
      };
      analysis = (parsed.analysis || '').trim();
      score = typeof parsed.score === 'number' && parsed.score >= 1 && parsed.score <= 10 ? parsed.score : null;
      saleProbability = typeof parsed.saleProbability === 'number' && parsed.saleProbability >= 0 && parsed.saleProbability <= 100
        ? parsed.saleProbability
        : null;
      mentorTips = Array.isArray(parsed.mentorTips)
        ? parsed.mentorTips.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
        : [];
      stageChecklist = {
        greeting: Boolean(parsed.stageChecklist?.greeting),
        needsDiscovery: Boolean(parsed.stageChecklist?.needsDiscovery),
        presentation: Boolean(parsed.stageChecklist?.presentation),
        objectionHandling: Boolean(parsed.stageChecklist?.objectionHandling),
        closing: Boolean(parsed.stageChecklist?.closing),
      };
    } catch (parseErr) {
      console.warn('[Audit] JSON parse failed, falling back to raw extraction', parseErr);
      const recovered = extractAnalysisFromTruncatedJson(raw);
      analysis = (recovered ?? raw).trim();
      const extracted = extractScoreFromAnalysis(analysis);
      score = extracted.score;
      saleProbability = extracted.saleProbability;
      mentorTips = [];
      stageChecklist = inferStageChecklistFromAnalysis(analysis);
    }

    if (!analysis) {
      throw new AppError(500, 'AI не вернул результат анализа');
    }

    let auditId: string | undefined;
    if (opts.userId) {
      const saved = await prisma.callAudit.create({
        data: {
          createdBy: opts.userId,
          managerName: opts.managerName ?? null,
          transcript,
          analysis,
          score,
          saleProbability,
          audioDuration: opts.audioDuration ?? null,
          qualityScore: opts.qualityScore ?? null,
          auditLanguage,
          source: opts.source ?? 'audio',
        },
        select: { id: true },
      });
      auditId = saved.id;
    }

    return { analysis, auditId, score, saleProbability, mentorTips, stageChecklist };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[Audit] Claude analysis failed:', reason);
    throw new AppError(500, `Не удалось выполнить анализ звонка: ${reason}`);
  }
}

function stripSqlComments(sql: string): string {
  // Remove block comments /* ... */
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove line comments -- ...
  s = s.replace(/--[^\r\n]*/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function validateSQL(sql: string): void {
  const clean = stripSqlComments(sql);
  const upper = clean.toUpperCase();

  if (!upper.trimStart().startsWith('SELECT')) {
    throw new AppError(400, 'AI сгенерировал недопустимый запрос. Разрешены только SELECT.');
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (keyword === 'UPDATE') {
      // Allow updated_at / update_ column names, but block UPDATE statement
      const withoutColumns = upper
        .replace(/\bUPDATED_AT\b/g, '')
        .replace(/\bUPDATE_\w*/g, '');
      if (/\bUPDATE\b/.test(withoutColumns)) {
        throw new AppError(400, 'Запрос содержит запрещённое ключевое слово: UPDATE');
      }
    } else {
      if (new RegExp(`\\b${keyword}\\b`).test(upper)) {
        throw new AppError(400, `Запрос содержит запрещённое ключевое слово: ${keyword}`);
      }
    }
  }

  if (!/\bLIMIT\s+\d/i.test(upper)) {
    throw new AppError(400, 'Запрос должен содержать LIMIT.');
  }
}

/** Wraps AI-generated SQL in a subquery enforcing a hard row cap of 500. */
function capRows(sql: string): string {
  return `SELECT * FROM (${sql.replace(/;+\s*$/, '')}) AS _ai_q LIMIT 500`;
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

// ==================== CALL AUDITS CRUD ====================

export async function listCallAudits(userId: string, isAdmin: boolean, limit = 50) {
  return prisma.callAudit.findMany({
    where: isAdmin ? undefined : { createdBy: userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      managerName: true,
      score: true,
      saleProbability: true,
      audioDuration: true,
      qualityScore: true,
      auditLanguage: true,
      source: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
    },
  });
}

export async function getCallAudit(auditId: string, userId: string, isAdmin: boolean) {
  const audit = await prisma.callAudit.findUnique({ where: { id: auditId } });
  if (!audit) throw new AppError(404, 'Аудит не найден');
  if (!isAdmin && audit.createdBy !== userId) throw new AppError(403, 'Нет доступа');
  return audit;
}

export async function deleteCallAudit(auditId: string, userId: string, isAdmin: boolean) {
  const audit = await prisma.callAudit.findUnique({ where: { id: auditId } });
  if (!audit) throw new AppError(404, 'Аудит не найден');
  if (!isAdmin && audit.createdBy !== userId) throw new AppError(403, 'Нет доступа');
  await prisma.callAudit.delete({ where: { id: auditId } });
}

export async function getCallAuditStats(isAdmin: boolean, userId: string) {
  const where = isAdmin ? {} : { createdBy: userId };
  const audits = await prisma.callAudit.findMany({
    where,
    select: {
      score: true,
      saleProbability: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by manager
  const byManager: Record<string, { name: string; scores: number[]; probs: number[]; count: number }> = {};
  for (const a of audits) {
    const key = a.author.id;
    if (!byManager[key]) byManager[key] = { name: a.author.fullName, scores: [], probs: [], count: 0 };
    byManager[key].count += 1;
    if (a.score !== null) byManager[key].scores.push(a.score);
    if (a.saleProbability !== null) byManager[key].probs.push(a.saleProbability);
  }

  const managers = Object.entries(byManager).map(([id, m]) => ({
    id,
    name: m.name,
    count: m.count,
    avgScore: m.scores.length ? Math.round((m.scores.reduce((a, b) => a + b, 0) / m.scores.length) * 10) / 10 : null,
    avgSaleProbability: m.probs.length ? Math.round(m.probs.reduce((a, b) => a + b, 0) / m.probs.length) : null,
  })).sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

  // Weekly trend (last 8 weeks)
  const weeklyMap: Record<string, { week: string; count: number; totalScore: number; scoreCount: number }> = {};
  for (const a of audits) {
    const d = new Date(a.createdAt);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay() + 1);
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeklyMap[key]) weeklyMap[key] = { week: key, count: 0, totalScore: 0, scoreCount: 0 };
    weeklyMap[key].count += 1;
    if (a.score !== null) { weeklyMap[key].totalScore += a.score; weeklyMap[key].scoreCount += 1; }
  }
  const weekly = Object.values(weeklyMap)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-8)
    .map((w) => ({ week: w.week, count: w.count, avgScore: w.scoreCount ? Math.round((w.totalScore / w.scoreCount) * 10) / 10 : null }));

  return { total: audits.length, managers, weekly };
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
  Date filters are OPTIONAL: use them only when the user specifies a period. For all-time / overall questions, do NOT add an artificial 30-day cutoff.
  Product-by-client: deals_count + total_qty + total_amount_uzs; broad product LIKE; "last N days" -> NOW() - INTERVAL 'N days' on COALESCE(di.deal_date, di.created_at, d.created_at).
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
      const queryResult = await prisma.$queryRawUnsafe(capRows(sql));
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

Fix: use correct table/column names from the schema. EVERY query MUST have LIMIT. Date filter only if the user's question implies a time window.
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
              const queryResult = await prisma.$queryRawUnsafe(capRows(sql));
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
