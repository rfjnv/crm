import { randomBytes, createHash } from 'crypto';
import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { asyncHandler } from '../../lib/asyncHandler';
import { verifyTelegramInitData } from '../../lib/telegramWebApp';
import { ROP_AGENT_TOOLS, executeTool } from './rop-agent.tools';
import { activeMemories, memoryText } from './rop-agent.memory';
import { crmUserByTelegramId, isAllowedTelegramId, type AgentUser } from './rop-agent.people';

/**
 * Живой голосовой звонок с РОП-агентом (мини-приложение в Telegram или страница CRM).
 *
 * Разговор в реальном времени ведёт ElevenLabs Agents: распознавание, голос (eleven_v4_turbo —
 * русский и узбекский) и модель Claude на их стороне. Данные CRM агент берёт через
 * вебхуки к нам — те же инструменты, что у текстового агента, только на чтение.
 *
 * Агент и инструменты в ElevenLabs создаются и обновляются отсюда при первом звонке после
 * запуска (по имени), так что их настройки живут в коде. Каждый звонок получает
 * случайный ключ сессии: вебхук без живого ключа ничего не вернёт.
 */

const API = 'https://api.elevenlabs.io/v1';
const AGENT_NAME = 'Polygraph Business — РОП-агент (звонок)';
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 12_000;

/** Инструменты для звонка: только чтение, без черновиков планов и изменений задач. */
const CALL_TOOLS = [
  'kpi_forecast', 'client_card', 'client_purchase_cycles', 'loss_reasons', 'list_managers',
  'task_plan_results', 'list_tasks', 'slow_stock', 'stocked_product_buyers', 'market_comparison',
  'product_economics', 'call_reviews', 'remember',
];

const CALL_PROMPT = `Ты — РОП-агент компании Polygraph Business (Ташкент, расходники для типографий: бумага, картон, самоклейка, плёнка, фольга, краски, химия). Деньги — в сумах.
Сейчас ГОЛОСОВОЙ звонок. С тобой говорит {{user_name}} — директор или администратор CRM. Сегодня {{today}} (Ташкент).

Язык: отвечай на том языке, на котором с тобой говорят. Русский — по-русски. Узбекский — по-узбекски (латиница, простая разговорная речь). Если собеседник перешёл на другой язык — переключись (language_detection).

Как говорить:
- Коротко, как живой руководитель отдела продаж по телефону: 1–3 предложения, главное сначала. Подробности — только если попросят.
- Без таблиц, списков, markdown и эмодзи. Числа округляй и говори словами удобно для слуха: «сто двадцать миллионов», «около двух миллиардов», «семьдесят процентов».
- Перед поиском в данных скажи коротко «секунду, смотрю». Не выдумывай цифры — бери их из инструментов. Если данных нет — так и скажи.

Данные CRM — через инструменты:
- kpi_forecast — план и прогноз месяца; client_card — всё о клиенте; client_purchase_cycles — кто пропал и кому пора покупать;
- loss_reasons — почему уходят клиенты; list_managers — менеджеры; task_plan_results и list_tasks — задачи и их выполнение;
- slow_stock и stocked_product_buyers — залежалый товар и кому его предложить; market_comparison и product_economics — цены и товары;
- call_reviews — разборы звонков менеджеров; remember — запомнить решение директора («запомни: …»).
Себестоимость и маржа тебе закрыты. Свои и союзные компании (Базис Принт, ППС) и конкуренты — не клиенты.
В звонке ты не ставишь задачи и не меняешь данные: предложи написать агенту в чат, там он подготовит план.

Договорённости директора (память агента):
{{memory}}

Когда разговор закончен (попрощались) — заверши звонок (end_call).`;

const FIRST_MESSAGE = { ru: 'Слушаю, {{user_name}}. Что посмотреть?', uz: 'Eshitaman, {{user_name}}. Nimani ko‘rib chiqamiz?' };

// ─── ElevenLabs API ─────────────────────────────────────────────────────────

async function el<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'xi-api-key': config.elevenlabs.apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[rop-call] ElevenLabs ${method} ${path} → ${res.status}: ${text.slice(0, 1000)}`);
    const hint = res.status === 401 || res.status === 403 ? ' — у ключа ElevenLabs нет доступа к Agents (нужно право «ElevenAgents» у API-ключа)' : '';
    throw new AppError(502, `ElevenLabs ответил ${res.status}${hint}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ─── Схемы инструментов ─────────────────────────────────────────────────────

type JsonSchema = { type?: string | string[]; description?: string; enum?: unknown[]; items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[] };

/** JSON Schema инструмента Claude → схема параметра ElevenLabs (у каждого поля должно быть описание). */
function toElProperty(name: string, s: JsonSchema): Record<string, unknown> {
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') ?? 'string' : s.type ?? 'string';
  const description = (s.description || name).slice(0, 500);
  if (type === 'array') return { type: 'array', description, items: toElProperty(`${name} item`, s.items ?? { type: 'string' }) };
  if (type === 'object') return toElObject(s, description);
  return {
    type,
    description,
    ...(Array.isArray(s.enum) ? { enum: s.enum.map(String) } : {}),
  };
}

function toElObject(s: JsonSchema, description: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.properties ?? {})) properties[k] = toElProperty(k, v);
  return { type: 'object', description, properties, required: (s.required ?? []).filter((r) => r in properties) };
}

function toolUrl(name: string): string {
  return `${config.telegram.backendPublicUrl}/api/public/rop-call/tool/${name}`;
}

export function webhookToolConfig(tool: (typeof ROP_AGENT_TOOLS)[number]) {
  const body = toElObject(tool.input_schema as JsonSchema, 'Параметры инструмента');
  // Ключ сессии подставляет ElevenLabs из переменной звонка — модель его не видит и не меняет.
  (body.properties as Record<string, unknown>).session = { type: 'string', dynamic_variable: 'session_key' };
  body.required = [...(body.required as string[]), 'session'];
  return {
    type: 'webhook',
    name: tool.name,
    description: (tool.description ?? tool.name).slice(0, 1000),
    response_timeout_secs: 30,
    api_schema: { url: toolUrl(tool.name), method: 'POST', request_body_schema: body },
  };
}

export function agentConfig(toolIds: string[]) {
  const s = config.ropAgent.call;
  return {
    name: AGENT_NAME,
    tags: ['polygraph-crm', 'rop-agent'],
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE.ru,
        language: 'ru',
        dynamic_variables: {
          dynamic_variable_placeholders: { session_key: 'test', user_name: 'Фарход', today: '2026-10-14', memory: '—' },
        },
        prompt: {
          prompt: CALL_PROMPT,
          llm: s.llm,
          temperature: 0.3,
          tool_ids: toolIds,
          built_in_tools: {
            language_detection: {
              type: 'system', name: 'language_detection', description: '',
              params: { system_tool_type: 'language_detection', only_at_conversation_start: false },
            },
            end_call: { type: 'system', name: 'end_call', description: '', params: { system_tool_type: 'end_call' } },
          },
        },
      },
      tts: { model_id: 'eleven_v4_turbo', voice_id: s.voiceId },
      conversation: { max_duration_seconds: s.maxMinutes * 60 },
      language_presets: { uz: { overrides: { agent: { first_message: FIRST_MESSAGE.uz } } } },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

// ─── Агент в ElevenLabs ─────────────────────────────────────────────────────

let ensuring: Promise<string> | null = null;

/** Найти или создать инструменты и агента и привести их к настройкам из кода. Один раз за запуск. */
export function ensureCallAgent(): Promise<string> {
  if (!ensuring) {
    ensuring = syncAgent().catch((err) => {
      ensuring = null;
      throw err;
    });
  }
  return ensuring;
}

async function syncAgent(): Promise<string> {
  if (!config.elevenlabs.apiKey) throw new AppError(503, 'ElevenLabs не настроен (ELEVENLABS_API_KEY)');
  if (!config.telegram.backendPublicUrl) throw new AppError(503, 'Не задан публичный адрес сервера (RENDER_EXTERNAL_URL / BACKEND_PUBLIC_URL)');

  const existing = await el<{ tools?: { id: string; tool_config: { name: string; api_schema?: { url?: string } } }[] }>('GET', '/convai/tools');
  const ours = new Map((existing.tools ?? [])
    .filter((t) => t.tool_config?.api_schema?.url?.includes('/api/public/rop-call/tool/'))
    .map((t) => [t.tool_config.name, t.id]));

  const toolIds: string[] = [];
  for (const tool of ROP_AGENT_TOOLS.filter((t) => CALL_TOOLS.includes(t.name))) {
    const tool_config = webhookToolConfig(tool);
    const id = ours.get(tool.name);
    if (id) {
      await el('PATCH', `/convai/tools/${id}`, { tool_config });
      toolIds.push(id);
    } else {
      toolIds.push((await el<{ id: string }>('POST', '/convai/tools', { tool_config })).id);
    }
  }

  const body = agentConfig(toolIds);
  let agentId = config.ropAgent.call.agentId;
  if (!agentId) {
    const list = await el<{ agents?: { agent_id: string; name: string }[] }>('GET', `/convai/agents?search=${encodeURIComponent(AGENT_NAME)}`);
    agentId = list.agents?.find((a) => a.name === AGENT_NAME)?.agent_id ?? '';
  }
  if (agentId) await el('PATCH', `/convai/agents/${agentId}`, body);
  else agentId = (await el<{ agent_id: string }>('POST', '/convai/agents/create', body)).agent_id;
  console.log(`[rop-call] agent ${agentId} ready, tools: ${toolIds.length}`);
  return agentId;
}

// ─── Сессии звонков ─────────────────────────────────────────────────────────

const sessions = new Map<string, { userId: string; expires: number }>();
const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

function sessionUser(key: unknown): string | null {
  if (typeof key !== 'string' || !key) return null;
  const s = sessions.get(hashKey(key));
  if (!s || s.expires < Date.now()) return null;
  return s.userId;
}

function tashkentToday(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

/** Начать звонок: токен WebRTC от ElevenLabs и переменные звонка для клиента. */
export async function startCallSession(user: AgentUser) {
  if (!config.ropAgent.call.enabled) throw new AppError(503, 'Звонки РОП-агенту выключены (ROP_CALL=off)');
  const agentId = await ensureCallAgent();
  const { token } = await el<{ token: string }>(
    'GET', `/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}&participant_name=${encodeURIComponent(user.fullName)}`,
  );
  const key = randomBytes(24).toString('base64url');
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
  sessions.set(hashKey(key), { userId: user.id, expires: now + SESSION_TTL_MS });
  return {
    conversationToken: token,
    userName: user.fullName,
    dynamicVariables: {
      session_key: key,
      user_name: user.fullName.split(' ')[0],
      today: tashkentToday(),
      memory: memoryText(await activeMemories()) || '—',
    },
  };
}

// ─── Маршруты ───────────────────────────────────────────────────────────────

/** Без входа в CRM: мини-приложение HOS-бота (initData) и вебхуки инструментов ElevenLabs. */
export const ropCallPublicRouter = Router();

ropCallPublicRouter.post('/session', asyncHandler(async (req: Request, res: Response) => {
  const tg = verifyTelegramInitData(String(req.body?.initData ?? ''), config.hos.botToken);
  if (!tg) throw new AppError(401, 'Откройте звонок из бота РОП-агента в Telegram');
  if (!isAllowedTelegramId(tg.id)) throw new AppError(403, 'Нет доступа к РОП-агенту');
  const user = await crmUserByTelegramId(tg.id);
  if (!user) throw new AppError(403, 'Ваш Telegram не привязан к сотруднику CRM');
  res.json(await startCallSession(user));
}));

ropCallPublicRouter.post('/tool/:name', asyncHandler(async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const { session, ...input } = (req.body ?? {}) as Record<string, unknown>;
  const userId = sessionUser(session);
  if (!userId) throw new AppError(401, 'Сессия звонка не найдена или истекла');
  if (!CALL_TOOLS.includes(name)) throw new AppError(404, 'Инструмент недоступен в звонке');
  // Пустые строки и null от модели — как «не задано».
  for (const k of Object.keys(input)) if (input[k] === '' || input[k] === null) delete input[k];
  const r = await executeTool(name, input, { chatId: '', userId, allowCost: false });
  const text = r.content.length > MAX_TOOL_RESULT_CHARS
    ? `${r.content.slice(0, MAX_TOOL_RESULT_CHARS)}… [обрезано — уточни вопрос]`
    : r.content;
  res.json({ ok: !r.isError, result: text });
}));

/** Для кнопки «Позвонить» в CRM: сотрудник уже вошёл и имеет право use_rop_agent. */
export async function startCallForCrmUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, isActive: true } });
  if (!user?.isActive) throw new AppError(403, 'Нет доступа');
  return startCallSession({ id: user.id, fullName: user.fullName });
}
