import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Router, Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { asyncHandler } from '../../lib/asyncHandler';
import { verifyTelegramInitData } from '../../lib/telegramWebApp';
import { el } from './rop-agent.elevenlabs';
import { ROP_AGENT_TOOLS, executeTool } from './rop-agent.tools';
import { activeMemories, memoryText } from './rop-agent.memory';
import { crmUserByTelegramId, isAllowedTelegramId, type AgentUser } from './rop-agent.people';
import { assignPlan } from './rop-agent.plans';
import { AGENT_OFF_TEXT, askInChat, getLastAssistantMessage, getTelegramChat, waitForTurn } from './rop-agent.service';
import { splitTelegramHtml } from './rop-agent.bot';
import { transcribeVoiceNote } from './rop-agent.voice';
import { agentBot } from './rop-agent.bot';
import { broadcastTargets, markdownToTelegramHtml } from './rop-agent.telegram';
import { takePendingCallbacks } from './rop-agent.callback';
import { callFailureText, finishMission, startMissionSession } from './rop-agent.missions';

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

const AGENT_NAME = 'Polygraph Business — РОП-агент (звонок)';
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 12_000;

/**
 * Инструменты для звонка: данные CRM на чтение, память и задачи менеджерам. Задачи —
 * как в чате: сначала черновик (propose_task_plan), раздаёт assign_task_plan только после
 * прямого «да» собеседника — в звонке это то же, что кнопка «Раздать».
 */
const CALL_TOOLS = [
  'kpi_forecast', 'client_card', 'client_purchase_cycles', 'loss_reasons', 'list_managers',
  'task_plan_results', 'list_tasks', 'slow_stock', 'stocked_product_buyers', 'market_comparison',
  'product_economics', 'call_reviews', 'remember', 'propose_task_plan', 'assign_task_plan',
  'call_manager', 'manager_call_reports',
];

/** Раздать черновик плана — только в звонке (в чате это кнопка «Раздать» у директора). */
const ASSIGN_TOOL = {
  name: 'assign_task_plan',
  description: 'Раздаёт менеджерам черновик плана, сохранённый propose_task_plan в этом звонке: создаёт задачи в CRM. '
    + 'Вызывай ТОЛЬКО после того, как зачитала собеседнику кому и что и он прямо ответил «да», «раздай», «ставь».',
  input_schema: {
    type: 'object' as const,
    properties: { plan_id: { type: 'string', description: 'plan_id из ответа propose_task_plan.' } },
    required: ['plan_id'],
  },
};

const CALL_PROMPT = `Тебя зовут Белла. Ты — РОП-агент компании Polygraph Business (Ташкент, расходники для типографий: бумага, картон, самоклейка, плёнка, фольга, краски, химия), девушка, руководитель отдела продаж и помощница директора. Деньги — в сумах.
О себе по-русски говори в женском роде: «посмотрела», «поставила», «я готова». Представляйся Беллой.
Сейчас ГОЛОСОВОЙ звонок. С тобой говорит {{user_name}} — директор или администратор CRM. Сегодня {{today}} (Ташкент).

Язык: отвечай на том языке, на котором с тобой говорят. Русский — по-русски. Узбекский — по-узбекски (латиница, простая разговорная речь). Если собеседник перешёл на другой язык — переключись (language_detection).

Как говорить:
- Коротко, как живая руководительница отдела продаж по телефону: 1–3 предложения, главное сначала. Подробности — только если попросят.
- Без таблиц, списков, markdown и эмодзи. Числа округляй и говори словами удобно для слуха: «сто двадцать миллионов», «около двух миллиардов», «семьдесят процентов».
- Перед поиском в данных скажи коротко «секунду, смотрю». Не выдумывай цифры — бери их из инструментов. Если данных нет — так и скажи.

Данные CRM — через инструменты:
- kpi_forecast — план и прогноз месяца; client_card — всё о клиенте; client_purchase_cycles — кто пропал и кому пора покупать;
- loss_reasons — почему уходят клиенты; list_managers — менеджеры; task_plan_results и list_tasks — задачи и их выполнение;
- slow_stock и stocked_product_buyers — залежалый товар и кому его предложить; market_comparison и product_economics — цены и товары;
- call_reviews — разборы звонков менеджеров; remember — запомнить решение директора («запомни: …»).
Себестоимость и маржа тебе закрыты. Свои и союзные компании (Базис Принт, ППС) и конкуренты — не клиенты.

Задачи менеджерам:
- Если просят поставить задачу («поставь Наргизе обзвонить пропавших», «пусть Дилноза позвонит Хумо Принт») — найди данные (list_managers, client_purchase_cycles, client_card), сохрани черновик через propose_task_plan: одна задача на менеджера, понятное название, что сделать, срок 1–3 рабочих дня, клиенты с причиной.
- Потом коротко зачитай: кому, что, сколько клиентов, до какого числа — и спроси «раздаю?». Только на прямое «да» вызови assign_task_plan с plan_id. На «нет» или правки — поправь черновик новым propose_task_plan.
- Директору (Фарходу) задачи не ставь: по его клиентам — совет. Задачи — только тем, у кого в list_managers can_take_tasks = true.
- Задачи пиши по-русски: CRM сама переведёт их менеджерам на узбекский.
- Закрыть, удалить или перенести задачи в звонке нельзя — предложи написать Белле в чат.

Договорённости директора (память агента):
{{memory}}

Когда разговор закончен (попрощались) — заверши звонок (end_call).`;

/** Приветствие — из переменной звонка: на входящий и на «перезвони мне» Белла здоровается по-разному. */
const FIRST_MESSAGE = { ru: '{{greeting}}', uz: 'Ha, {{user_name}}, Bella eshitmoqda. Gapiring.' };
const greetingFor = (name: string, outbound: boolean) => (outbound
  ? `Алло, ${name}! Это Белла, вы просили перезвонить. Слушаю вас.`
  : `Да, ${name}, это Белла. Слушаю вас.`);

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

export function webhookToolConfig(tool: { name: string; description?: string; input_schema: unknown }) {
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
          dynamic_variable_placeholders: {
            session_key: 'test', user_name: 'Фарход', today: '2026-10-14', memory: '—', greeting: 'Да, Фарход, это Белла. Слушаю вас.',
          },
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
  for (const tool of [...ROP_AGENT_TOOLS.filter((t) => CALL_TOOLS.includes(t.name)), ASSIGN_TOOL]) {
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

/** Переменные звонка и ключ сессии для вебхуков инструментов. */
async function callVariables(user: AgentUser, outbound = false) {
  const key = randomBytes(24).toString('base64url');
  const now = Date.now();
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
  sessions.set(hashKey(key), { userId: user.id, expires: now + SESSION_TTL_MS });
  const firstName = user.fullName.split(' ')[0];
  return {
    session_key: key,
    greeting: greetingFor(firstName, outbound),
    user_name: firstName,
    today: tashkentToday(),
    memory: memoryText(await activeMemories()) || '—',
  };
}

function assertCallsEnabled(): void {
  if (!config.ropAgent.call.enabled) throw new AppError(503, 'Звонки РОП-агенту выключены (ROP_CALL=off)');
}

/** Начать звонок в браузере / мини-приложении: токен WebRTC от ElevenLabs и переменные звонка. */
export async function startCallSession(user: AgentUser) {
  assertCallsEnabled();
  const agentId = await ensureCallAgent();
  const { token } = await el<{ token: string }>(
    'GET', `/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}&participant_name=${encodeURIComponent(user.fullName)}`,
  );
  return { conversationToken: token, userName: user.fullName, dynamicVariables: await callVariables(user) };
}

/** Звонок через мост (обычный звонок Telegram): подписанный адрес WebSocket вместо WebRTC. */
async function startBridgeSession(user: AgentUser, outbound: boolean) {
  assertCallsEnabled();
  const agentId = await ensureCallAgent();
  const { signed_url } = await el<{ signed_url: string }>(
    'GET', `/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
  );
  return { signedUrl: signed_url, userName: user.fullName, dynamicVariables: await callVariables(user, outbound) };
}

function bridgeAuthorized(header: unknown): boolean {
  const secret = config.ropAgent.call.bridgeSecret;
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
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

/**
 * Мост звонков спрашивает, кто звонит (Telegram ID): тот же список доступа, что у бота.
 * 403 — мост сбрасывает звонок, не отвечая.
 */
ropCallPublicRouter.post('/bridge-session', asyncHandler(async (req: Request, res: Response) => {
  if (!bridgeAuthorized(req.headers['x-bridge-secret'])) throw new AppError(401, 'Неверный секрет моста');
  // Звонок менеджеру по поручению: доступ даёт само поручение, а не список HOS.
  if (typeof req.body?.missionId === 'string') {
    res.json(await startMissionSession(req.body.missionId));
    return;
  }
  const telegramId = String(req.body?.telegramId ?? '');
  if (!isAllowedTelegramId(telegramId)) throw new AppError(403, 'Нет доступа к РОП-агенту');
  const user = await crmUserByTelegramId(telegramId);
  if (!user) throw new AppError(403, 'Telegram не привязан к сотруднику CRM');
  res.json(await startBridgeSession(user, req.body?.outbound === true));
}));

/**
 * Личка Беллы: мост присылает сообщение (текст или голосовое), агент отвечает в том же
 * разговоре, что и в личке бота, — история общая. Ответ — частями HTML для Telegram.
 */
ropCallPublicRouter.post('/bridge-message', asyncHandler(async (req: Request, res: Response) => {
  if (!bridgeAuthorized(req.headers['x-bridge-secret'])) throw new AppError(401, 'Неверный секрет моста');
  const telegramId = String(req.body?.telegramId ?? '');
  if (!isAllowedTelegramId(telegramId)) throw new AppError(403, 'Нет доступа к РОП-агенту');
  const user = await crmUserByTelegramId(telegramId);
  if (!user) throw new AppError(403, 'Telegram не привязан к сотруднику CRM');
  res.json(await answerBellaMessage(user, String(req.body?.text ?? '').trim(), req.body?.voiceBase64));
}));

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function answerBellaMessage(user: AgentUser, text: string, voiceBase64: unknown) {
  if (!config.ropAgent.enabled) return { parts: [escHtml(AGENT_OFF_TEXT)] };
  let question = text;
  let heard: string | undefined;
  if (typeof voiceBase64 === 'string' && voiceBase64) {
    const dir = path.resolve(config.uploads.dir, 'tg-voice');
    const file = path.join(dir, `bella-${randomBytes(6).toString('hex')}.ogg`);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, Buffer.from(voiceBase64, 'base64'));
      heard = await transcribeVoiceNote(file);
      question = `🎙 ${heard}`;
    } catch (err) {
      return { parts: [`⚠️ ${escHtml(err instanceof AppError ? err.message : 'Не удалось распознать голосовое — напишите текстом.')}`] };
    } finally {
      await fs.unlink(file).catch(() => {});
    }
  }
  if (!question) return { parts: [] };

  const chat = await getTelegramChat(user.id, 'telegram');
  try {
    await askInChat(chat.id, user.id, question);
  } catch (err) {
    return { heard, parts: [`⚠️ ${escHtml((err as Error).message)}`] };
  }
  await waitForTurn(chat.id);
  const reply = await getLastAssistantMessage(chat.id);
  if (!reply) return { heard, parts: ['⚠️ Ответ не получился — попробуйте ещё раз.'] };
  let html = reply.isError ? `⚠️ ${escHtml(reply.text)}` : markdownToTelegramHtml(reply.text);
  // Кнопок у обычного аккаунта нет: черновики планов и изменений задач решаются в боте или CRM.
  const calls = (reply.toolCalls as { planId?: string; actionId?: string }[] | null) ?? [];
  if (calls.some((c) => c.planId || c.actionId)) {
    const link = `${config.telegram.crmUrl}/rop-agent?chat=${chat.id}`;
    const bot = agentBot.username ? ` или в боте @${agentBot.username} (/last)` : '';
    html += `\n\n📝 Черновик ждёт решения — подтвердите <a href="${link}">в CRM</a>${bot}.`;
  }
  return { heard, parts: splitTelegramHtml(html) };
}

/** Мост сообщает, чем кончился звонок менеджеру: DONE / NO_ANSWER / FAILED и расшифровка. */
ropCallPublicRouter.post('/bridge-call-ended', asyncHandler(async (req: Request, res: Response) => {
  if (!bridgeAuthorized(req.headers['x-bridge-secret'])) throw new AppError(401, 'Неверный секрет моста');
  res.json(await finishMission(String(req.body?.missionId ?? ''), String(req.body?.status ?? ''), req.body?.transcript, req.body?.reason));
}));

/** «Позвони мне» не получилось — мост сообщает причину, человеку уходит сообщение в боте. */
ropCallPublicRouter.post('/bridge-callback-failed', asyncHandler(async (req: Request, res: Response) => {
  if (!bridgeAuthorized(req.headers['x-bridge-secret'])) throw new AppError(401, 'Неверный секрет моста');
  const telegramId = String(req.body?.telegramId ?? '');
  if (isAllowedTelegramId(telegramId) && agentBot.enabled) {
    await agentBot.sendHtmlToChat(telegramId,
      `📞 Белла не смогла вам позвонить: ${callFailureText(req.body?.reason, 'вы').replace(/&/g, '&amp;').replace(/</g, '&lt;')}`);
  }
  res.json({ ok: true });
}));

/** Мост забирает очередь: «перезвони мне» и звонки менеджерам. */
ropCallPublicRouter.get('/bridge-queue', (req: Request, res: Response) => {
  if (!bridgeAuthorized(req.headers['x-bridge-secret'])) {
    res.status(401).json({ message: 'Неверный секрет моста' });
    return;
  }
  res.json({ calls: takePendingCallbacks() });
});

ropCallPublicRouter.post('/tool/:name', asyncHandler(async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const { session, ...input } = (req.body ?? {}) as Record<string, unknown>;
  const userId = sessionUser(session);
  if (!userId) throw new AppError(401, 'Сессия звонка не найдена или истекла');
  if (!CALL_TOOLS.includes(name)) throw new AppError(404, 'Инструмент недоступен в звонке');
  // Пустые строки и null от модели — как «не задано».
  for (const k of Object.keys(input)) if (input[k] === '' || input[k] === null) delete input[k];
  if (name === 'assign_task_plan') {
    res.json(await assignFromCall(userId, String(input.plan_id ?? '')));
    return;
  }
  // Черновики планов из звонка живут в Telegram-разговоре собеседника — их видно и в CRM.
  const chatId = name === 'propose_task_plan' ? (await getTelegramChat(userId)).id : '';
  const r = await executeTool(name, input, { chatId, userId, allowCost: false });
  const text = r.content.length > MAX_TOOL_RESULT_CHARS
    ? `${r.content.slice(0, MAX_TOOL_RESULT_CHARS)}… [обрезано — уточни вопрос]`
    : r.content;
  res.json({ ok: !r.isError, result: text });
}));

/** «Раздаю» голосом = кнопка «Раздать»: задачи создаются, в Telegram уходит отметка, кто раздал. */
async function assignFromCall(userId: string, planId: string) {
  try {
    const r = await assignPlan(planId, userId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    const warn = r.warnings.length ? `\n⚠️ ${r.warnings.join('; ')}` : '';
    const text = `✅ ${user?.fullName ?? ''} (по звонку с Беллой): план «${r.plan.title}» роздан, задач ${r.createdTasks}.${warn}`;
    for (const target of agentBot.enabled ? broadcastTargets() : []) {
      await agentBot.sendHtmlToChat(target, text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        [[{ text: 'Открыть задачи', url: '/tasks' }]]);
    }
    return { ok: true, result: JSON.stringify({ created_tasks: r.createdTasks, warnings: r.warnings }) };
  } catch (err) {
    return { ok: false, result: `Ошибка: ${(err as Error).message}` };
  }
}

/** Для кнопки «Позвонить» в CRM: сотрудник уже вошёл и имеет право use_rop_agent. */
export async function startCallForCrmUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, isActive: true } });
  if (!user?.isActive) throw new AppError(403, 'Нет доступа');
  return startCallSession({ id: user.id, fullName: user.fullName });
}
