import Anthropic from '@anthropic-ai/sdk';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { el } from './rop-agent.elevenlabs';
import { bridgeAlive, callbackAvailable, enqueueCall, telegramIdOfUser } from './rop-agent.callback';
import { directorUserIds } from './rop-agent.people';
import { kpiForecast } from './rop-agent.kpi';
import { clientPurchaseCycles } from './rop-agent.analysis';
import { agentBot } from './rop-agent.bot';

/**
 * Белла звонит менеджеру по поручению директора: «свяжись с Дилнозой, узнай, как идут
 * продажи». Поручение ставится в очередь моста звонков (call-bridge), мост звонит с
 * аккаунта Беллы. Разговор ведёт отдельный агент ElevenLabs — с целью звонка и сводкой
 * по менеджеру из CRM, без доступа к инструментам. После звонка мост присылает
 * расшифровку, отчёт уходит тому, кто поручил.
 */

const AGENT_NAME = 'Polygraph Business — Белла (звонок менеджеру)';
const MAX_MINUTES = 8;

const PROMPT = `Тебя зовут Белла. Ты — ИИ-помощница отдела продаж компании Polygraph Business (Ташкент, расходники для типографий). Ты девушка: о себе говори в женском роде.
Сейчас ты САМА звонишь менеджеру {{manager_name}} по поручению {{requester_name}}. Сегодня {{today}}.

Цель звонка: {{goal}}

Что известно из CRM о менеджере (не зачитывай списком — используй, чтобы задавать точные вопросы):
{{context}}

Как вести разговор:
- Ты уже представилась в приветствии. Если менеджер занят — спроси, когда перезвонить, поблагодари и заверши звонок.
- Говори коротко и по-деловому, дружелюбно, как руководитель отдела продаж. Один вопрос за раз, дай ответить.
- Выясняй конкретику: каких клиентов обзвонил, кто что сказал, какие суммы и сроки, что мешает, нужна ли помощь директора (цена, отсрочка, товар).
- Не дави, не угрожай, не обещай от имени директора скидок, отсрочек или решений — скажи, что передашь директору.
- Не рассказывай о других менеджерах и о цифрах компании в целом.
- Язык: отвечай на том языке, на котором говорит менеджер (русский или узбекский, латиница). Если перешёл на другой — переключись (language_detection).
- Без списков и цифр «по буквам»: суммы округляй и говори словами.
- Уложись в 3–5 минут. В конце коротко повтори главное, поблагодари, скажи, что передашь {{requester_name}}, и заверши звонок (end_call).`;

function agentBody() {
  return {
    name: AGENT_NAME,
    tags: ['polygraph-crm', 'rop-agent', 'manager-call'],
    conversation_config: {
      agent: {
        first_message: '{{greeting}}',
        language: 'ru',
        dynamic_variables: {
          dynamic_variable_placeholders: {
            greeting: 'Ассалому алейкум, Дилноза! Это Белла, ИИ-помощница отдела продаж. Звоню по просьбе Фарходa. Удобно пару минут поговорить?',
            manager_name: 'Дилноза', requester_name: 'Фарход', today: '2026-10-14', goal: 'узнать, как идут продажи', context: '—',
          },
        },
        prompt: {
          prompt: PROMPT,
          llm: config.ropAgent.call.llm,
          temperature: 0.4,
          built_in_tools: {
            language_detection: {
              type: 'system', name: 'language_detection', description: '',
              params: { system_tool_type: 'language_detection', only_at_conversation_start: false },
            },
            end_call: { type: 'system', name: 'end_call', description: '', params: { system_tool_type: 'end_call' } },
          },
        },
      },
      tts: { model_id: 'eleven_v4_turbo', voice_id: config.ropAgent.call.voiceId },
      conversation: { max_duration_seconds: MAX_MINUTES * 60 },
      language_presets: { uz: { overrides: { agent: { first_message: '{{greeting}}' } } } },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

let ensuring: Promise<string> | null = null;

function ensureManagerAgent(): Promise<string> {
  if (!ensuring) {
    ensuring = (async () => {
      if (!config.elevenlabs.apiKey) throw new AppError(503, 'ElevenLabs не настроен (ELEVENLABS_API_KEY)');
      const list = await el<{ agents?: { agent_id: string; name: string }[] }>('GET', `/convai/agents?search=${encodeURIComponent(AGENT_NAME)}`);
      let agentId = list.agents?.find((a) => a.name === AGENT_NAME)?.agent_id ?? '';
      if (agentId) await el('PATCH', `/convai/agents/${agentId}`, agentBody());
      else agentId = (await el<{ agent_id: string }>('POST', '/convai/agents/create', agentBody())).agent_id;
      console.log(`[rop-call] manager-call agent ${agentId} ready`);
      return agentId;
    })().catch((err) => {
      ensuring = null;
      throw err;
    });
  }
  return ensuring;
}

// ─── Поручение ──────────────────────────────────────────────────────────────

/** Инструмент call_manager: поставить звонок менеджеру в очередь моста. */
export async function requestManagerCall(requesterId: string, input: { manager_id?: unknown; goal?: unknown }) {
  const goal = typeof input.goal === 'string' ? input.goal.trim().slice(0, 1000) : '';
  if (!goal) throw new AppError(400, 'Нужна цель звонка (goal): что узнать у менеджера');
  if (!callbackAvailable()) throw new AppError(503, 'Звонки Беллы не настроены (нет моста звонков)');
  if (!bridgeAlive()) throw new AppError(503, 'Мост звонков сейчас не на связи — позвонить не получится');

  const manager = typeof input.manager_id === 'string'
    ? await prisma.user.findFirst({
      where: { id: input.manager_id, isActive: true },
      select: { id: true, fullName: true, telegramChatId: true },
    })
    : null;
  if (!manager) throw new AppError(400, 'Сотрудник не найден или неактивен (manager_id из list_managers)');
  if ((await directorUserIds()).has(manager.id)) throw new AppError(400, 'Директору Белла по поручениям не звонит');
  if (!manager.telegramChatId) {
    throw new AppError(400, `У сотрудника ${manager.fullName} не привязан Telegram в CRM — позвонить некуда. Привязка: «Уведомления → Привязать Telegram».`);
  }
  const busy = await prisma.ropCallMission.findFirst({
    where: { managerId: manager.id, status: { in: ['QUEUED', 'CALLING'] }, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
  });
  if (busy) throw new AppError(409, `Белла уже звонит ${manager.fullName} — дождитесь отчёта`);

  const phone = await prisma.servicePhone.findFirst({ where: { userId: manager.id }, select: { phone: true } });
  const mission = await prisma.ropCallMission.create({ data: { requestedById: requesterId, managerId: manager.id, goal } });
  enqueueCall({ telegramId: manager.telegramChatId, missionId: mission.id, phone: phone?.phone, name: manager.fullName });
  return {
    mission_id: mission.id,
    status: 'QUEUED',
    note: `Белла позвонит ${manager.fullName} в Telegram в ближайшую минуту (если сейчас идёт другой звонок — после него). `
      + 'Отчёт о разговоре придёт тому, кто поручил, в Telegram; позже его можно посмотреть через manager_call_reports. '
      + 'Скажи об этом коротко и не выдумывай результат разговора.',
  };
}

/** Сводка по менеджеру для разговора: план, задачи, кто из его клиентов пропал. */
async function managerContext(managerId: string): Promise<string> {
  const lines: string[] = [];
  const money = (v: number) => `${Math.round(v / 1e6)} млн`;
  try {
    const f = await kpiForecast({ manager_id: managerId });
    const m = f.managers[0];
    if (m) {
      lines.push(`План месяца: ${m.plan ? `${money(m.plan)}, сделано ${money(m.fact_mtd)}, прогноз ${money(m.forecast)} (${m.forecast_pct ?? '—'}%)` : `плана нет, сделано ${money(m.fact_mtd)}`}. Открытых сделок: ${m.open_pipeline.deals}.`);
    }
  } catch { /* без прогноза — не страшно */ }
  const tasks = await prisma.task.findMany({
    where: { assigneeId: managerId, status: { in: ['TODO', 'IN_PROGRESS'] } },
    orderBy: { dueDate: 'asc' },
    take: 5,
    select: { title: true, dueDate: true },
  });
  if (tasks.length) {
    lines.push(`Открытые задачи: ${tasks.map((t) => `«${t.title.slice(0, 80)}»${t.dueDate ? ` до ${t.dueDate.toISOString().slice(5, 10).split('-').reverse().join('.')}` : ''}`).join('; ')}.`);
  }
  try {
    const lapsed = await clientPurchaseCycles({ status: 'overdue', manager_id: managerId, limit: 5 });
    if (lapsed.clients.length) {
      lines.push(`Пропавшие клиенты: ${lapsed.clients.map((c) => `${c.client} (не покупает ${c.days_since} дн.)`).join(', ')}.`);
    }
  } catch { /* не страшно */ }
  return lines.join('\n') || 'Данных из CRM нет.';
}

/** Мост начинает звонок: адрес агента и переменные разговора. */
export async function startMissionSession(missionId: string) {
  const mission = await prisma.ropCallMission.findUnique({
    where: { id: missionId },
    include: { manager: { select: { fullName: true } }, requestedBy: { select: { fullName: true } } },
  });
  if (!mission || mission.status !== 'QUEUED') throw new AppError(404, 'Поручение не найдено или уже выполнено');
  const agentId = await ensureManagerAgent();
  const { signed_url } = await el<{ signed_url: string }>('GET', `/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  await prisma.ropCallMission.update({ where: { id: missionId }, data: { status: 'CALLING', startedAt: new Date() } });
  const managerFirst = mission.manager.fullName.split(' ')[0];
  const requester = mission.requestedBy.fullName.split(' ')[0];
  return {
    signedUrl: signed_url,
    userName: mission.manager.fullName,
    dynamicVariables: {
      greeting: `Ассалому алейкум, ${managerFirst}! Это Белла, ИИ-помощница отдела продаж. Звоню по просьбе ${requester}. Удобно пару минут поговорить?`,
      manager_name: mission.manager.fullName,
      requester_name: requester,
      today: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10),
      goal: mission.goal,
      context: await managerContext(mission.managerId),
    },
  };
}

// ─── Отчёт ──────────────────────────────────────────────────────────────────

type Line = { role: 'agent' | 'manager'; text: string };

const REPORT_PROMPT = `Ты — Белла, ИИ-помощница отдела продаж. Тебе дают цель звонка менеджеру и расшифровку разговора.
Напиши отчёт тому, кто поручил звонок, по-русски, коротко:
- первой строкой — вывод в одном предложении;
- затем 2–6 пунктов «- »: что сказал менеджер по цели, конкретные клиенты, суммы и сроки, что мешает, о чём просит;
- последней строкой — что предлагаешь сделать директору (если есть).
Только то, что было в разговоре, ничего не выдумывай. Если разговор не состоялся или менеджер был занят — так и скажи.`;

async function writeReport(goal: string, lines: Line[]): Promise<string> {
  const transcript = lines.map((l) => `${l.role === 'agent' ? 'Белла' : 'Менеджер'}: ${l.text}`).join('\n');
  if (!config.claude.apiKey || !config.ropAgent.enabled) return transcript;
  try {
    const client = new Anthropic({ apiKey: config.claude.apiKey });
    const response = await client.messages.create({
      model: config.ropAgent.digestModel,
      max_tokens: 2000,
      system: REPORT_PROMPT,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `Цель звонка: ${goal}\n\nРасшифровка:\n${transcript}` }],
    });
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
    return text || transcript;
  } catch (err) {
    console.error('[rop-call] mission report failed:', (err as Error).message);
    return transcript;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Мост сообщает, чем кончился звонок: отчёт сохраняется и уходит тому, кто поручил. */
/**
 * Почему звонок не состоялся — по коду от моста, с подсказкой, что сделать.
 * who — имя в родительном падеже не склоняем: «у Дилноза Эргашева» читается нормально.
 */
export function callFailureText(reason: unknown, who: string): string {
  switch (reason) {
    case 'privacy':
      return `у ${who} в Telegram звонки разрешены только контактам. Пусть ${who} добавит Беллу в контакты (или разрешит звонки от всех) — тогда дозвонюсь.`;
    case 'not_found':
      return `Белла не нашла ${who} в Telegram: её нет в контактах Беллы и она Белле не писала. Пусть ${who} напишет Белле в Telegram любое сообщение — после этого дозвонюсь.`;
    case 'no_answer':
      return `${who} не взяла трубку.`;
    case 'declined':
      return `${who} отклонила звонок.`;
    case 'busy':
      return `${who} была занята другим звонком.`;
    case 'blocked':
      return `${who} заблокировала аккаунт Беллы в Telegram.`;
    default:
      return typeof reason === 'string' && reason ? `не удалось соединиться (${reason}).` : 'не удалось соединиться.';
  }
}

export async function finishMission(missionId: string, status: string, transcript: unknown, reason?: unknown) {
  const mission = await prisma.ropCallMission.findUnique({
    where: { id: missionId },
    include: { manager: { select: { fullName: true } } },
  });
  if (!mission || !['QUEUED', 'CALLING'].includes(mission.status)) return { ok: false };
  const lines = (Array.isArray(transcript) ? transcript : [])
    .filter((l): l is Line => !!l && typeof l.text === 'string' && (l.role === 'agent' || l.role === 'manager'))
    .slice(0, 400);
  const answered = lines.some((l) => l.role === 'manager');
  const final = status === 'DONE' && !answered ? 'NO_ANSWER' : ['DONE', 'NO_ANSWER', 'FAILED'].includes(status) ? status : 'FAILED';
  // Не дозвонилась — в отчёт причину и что сделать: агент потом сможет её назвать.
  const summary = final === 'DONE'
    ? await writeReport(mission.goal, lines)
    : `Не дозвонилась: ${callFailureText(reason, mission.manager.fullName.split(' ')[0])}`;
  await prisma.ropCallMission.update({
    where: { id: missionId },
    data: { status: final, transcript: lines as unknown as Prisma.InputJsonValue, summary, finishedAt: new Date() },
  });

  const head = final === 'DONE'
    ? `📞 <b>Белла поговорила с ${esc(mission.manager.fullName)}</b>`
    : `📞 Белла не дозвонилась до ${esc(mission.manager.fullName)}: ${esc(callFailureText(reason, mission.manager.fullName.split(' ')[0]))}`;
  const body = final === 'DONE' && summary ? `\n<i>Цель: ${esc(mission.goal)}</i>\n\n${esc(summary)}` : '';
  const target = await telegramIdOfUser(mission.requestedById);
  if (agentBot.enabled) {
    for (const chat of target ? [target] : config.hos.groupId ? [config.hos.groupId] : []) {
      await agentBot.sendHtmlToChat(chat, `${head}${body}`);
    }
  }
  return { ok: true };
}

/** Инструмент manager_call_reports: последние звонки менеджерам и что они сказали. */
export async function managerCallReports(input: { manager_id?: string; limit?: number }) {
  const rows = await prisma.ropCallMission.findMany({
    where: input.manager_id ? { managerId: input.manager_id } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Math.round(input.limit ?? 10), 1), 30),
    include: { manager: { select: { fullName: true } }, requestedBy: { select: { fullName: true } } },
  });
  return {
    calls: rows.map((r) => ({
      manager: r.manager.fullName,
      requested_by: r.requestedBy.fullName,
      goal: r.goal,
      status: r.status,
      at: new Date(r.createdAt.getTime() + 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' '),
      report: r.summary,
    })),
  };
}
