import Anthropic from '@anthropic-ai/sdk';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { ROP_AGENT_SYSTEM_PROMPT } from './rop-agent.prompt';
import { ROP_AGENT_TOOLS, describeToolCall, executeTool } from './rop-agent.tools';
import { activeMemories, memoryHash, memoryText } from './rop-agent.memory';

/** Сколько раз за один ответ агент может сходить за данными. */
const MAX_TOOL_ROUNDS = 25;
/** Чат длиннее этого (в токенах на входе) закрываем для новых вопросов — пусть начнут новый. */
const MAX_CHAT_INPUT_TOKENS = 600_000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!config.claude.apiKey) throw new AppError(503, 'Не задан ключ Claude (CLAUDE_API_KEY)');
  client ??= new Anthropic({ apiKey: config.claude.apiKey });
  return client;
}

// ─── Идущие ответы ──────────────────────────────────────────────────────────

/**
 * Ответ агента занимает от десятков секунд до нескольких минут, поэтому вопрос
 * принимается сразу, а ответ считается в фоне. Фронт опрашивает статус и видит,
 * какие данные агент сейчас смотрит. После перезапуска сервера статус теряется —
 * вопрос остаётся без ответа, и его можно задать заново.
 */
type RunningTurn = { startedAt: number; steps: string[]; done?: Promise<void> };
const running = new Map<string, RunningTurn>();

/** Дождаться, пока агент ответит в чате (для Telegram, где нет опроса со страницы). */
export async function waitForTurn(chatId: string): Promise<void> {
  await running.get(chatId)?.done;
}

export function getTurnStatus(chatId: string) {
  const turn = running.get(chatId);
  return turn
    ? { running: true, startedAt: new Date(turn.startedAt).toISOString(), steps: turn.steps }
    : { running: false, steps: [] as string[] };
}

// ─── Чаты ───────────────────────────────────────────────────────────────────

async function getOwnChat(chatId: string, userId: string) {
  const chat = await prisma.ropAgentChat.findUnique({ where: { id: chatId } });
  if (!chat || chat.userId !== userId) throw new AppError(404, 'Чат не найден');
  return chat;
}

export function listChats(userId: string) {
  return prisma.ropAgentChat.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, channel: true, createdAt: true, updatedAt: true },
  });
}

export function createChat(userId: string, channel: 'web' | 'telegram' = 'web') {
  return prisma.ropAgentChat.create({
    data: { userId, channel, ...(channel === 'telegram' ? { title: 'Telegram' } : {}) },
  });
}

/** Разговор в Telegram — последний чат этого канала; /new начинает новый. */
export async function getTelegramChat(userId: string) {
  const chat = await prisma.ropAgentChat.findFirst({
    where: { userId, channel: 'telegram' },
    orderBy: { createdAt: 'desc' },
  });
  return chat ?? createChat(userId, 'telegram');
}

/** Последний ответ агента в чате — для отправки в Telegram. */
export function getLastAssistantMessage(chatId: string) {
  return prisma.ropAgentMessage.findFirst({
    where: { chatId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { text: true, isError: true, toolCalls: true },
  });
}

export async function renameChat(chatId: string, userId: string, title: string) {
  await getOwnChat(chatId, userId);
  return prisma.ropAgentChat.update({ where: { id: chatId }, data: { title } });
}

export async function deleteChat(chatId: string, userId: string) {
  await getOwnChat(chatId, userId);
  if (running.has(chatId)) throw new AppError(409, 'Агент ещё отвечает в этом чате');
  await prisma.ropAgentChat.delete({ where: { id: chatId } });
}

export async function getChatMessages(chatId: string, userId: string) {
  await getOwnChat(chatId, userId);
  const messages = await prisma.ropAgentMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, text: true, toolCalls: true, isError: true, createdAt: true },
  });
  return { messages, status: getTurnStatus(chatId) };
}

// ─── Ответ агента ───────────────────────────────────────────────────────────

function tashkentToday(): string {
  const t = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function titleFrom(question: string): string {
  const oneLine = question.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

/**
 * Принимает вопрос и запускает ответ в фоне. История для Claude собирается из
 * сохранённых `apiMessages` дословно и только дописывается.
 */
export async function askInChat(chatId: string, userId: string, question: string) {
  const chat = await getOwnChat(chatId, userId);
  if (running.has(chatId)) throw new AppError(409, 'Агент ещё отвечает на предыдущий вопрос');

  const last = await prisma.ropAgentMessage.findFirst({
    where: { chatId, role: 'assistant', inputTokens: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { inputTokens: true },
  });
  if ((last?.inputTokens ?? 0) > MAX_CHAT_INPUT_TOKENS) {
    throw new AppError(409, 'Чат стал слишком длинным. Начните новый — агент ответит быстрее и дешевле.');
  }

  // Память передаём, только если она изменилась с прошлой передачи в этот чат: иначе
  // каждая реплика тащила бы весь список заново.
  const memories = await activeMemories();
  const hash = memoryHash(memories);
  const memoryBlock = hash !== chat.memoryHash
    ? `[Память агента — действующие договорённости директора${chat.memoryHash ? ' (обновлено)' : ''}:\n${memoryText(memories)}]\n\n`
    : '';
  const userTurn: Anthropic.MessageParam = {
    role: 'user',
    content: [{ type: 'text', text: `${memoryBlock}[Сегодня ${tashkentToday()}, Ташкент]\n${question}` }],
  };
  const userMessage = await prisma.ropAgentMessage.create({
    data: {
      chatId,
      role: 'user',
      text: question,
      apiMessages: [userTurn] as unknown as Prisma.InputJsonValue,
    },
  });
  const isFirst = (await prisma.ropAgentMessage.count({ where: { chatId } })) === 1;
  await prisma.ropAgentChat.update({
    where: { id: chatId },
    data: {
      memoryHash: hash,
      ...(isFirst && (chat.title === 'Новый чат' || chat.title === 'Telegram')
        ? { title: chat.channel === 'telegram' ? `Telegram: ${titleFrom(question)}` : titleFrom(question) }
        : { updatedAt: new Date() }),
    },
  });

  const turn: RunningTurn = { startedAt: Date.now(), steps: [] };
  running.set(chatId, turn);
  turn.done = runTurn(chatId, userId, turn)
    .catch((err) => console.error('[rop-agent] turn failed:', (err as Error).message))
    .finally(() => running.delete(chatId));

  return userMessage;
}

async function loadHistory(chatId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await prisma.ropAgentMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    select: { apiMessages: true },
  });
  return rows.flatMap((r) => r.apiMessages as unknown as Anthropic.MessageParam[]);
}

const hasThinking = (messages: Anthropic.MessageParam[]) => messages.some((m) =>
  Array.isArray(m.content) && m.content.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking'));

function withoutThinking(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...m, content: content.length ? content : [{ type: 'text', text: '…' }] };
  });
}

/**
 * Блоки размышлений привязаны к системному промпту и набору инструментов, при
 * которых они появились. После обновления агента (новый промпт, новые инструменты)
 * старый чат API может отклонить. Тогда один раз убираем размышления из сохранённой
 * истории — модель ответит без своих прошлых рассуждений, но с полным текстом
 * переписки — и дальше чат живёт как новый.
 */
async function stripThinkingInChat(chatId: string): Promise<void> {
  const rows = await prisma.ropAgentMessage.findMany({ where: { chatId }, select: { id: true, apiMessages: true } });
  for (const r of rows) {
    const msgs = r.apiMessages as unknown as Anthropic.MessageParam[];
    if (!hasThinking(msgs)) continue;
    await prisma.ropAgentMessage.update({
      where: { id: r.id },
      data: { apiMessages: withoutThinking(msgs) as unknown as Prisma.InputJsonValue },
    });
  }
}

function errorText(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Ключ Claude недействителен. Проверьте CLAUDE_API_KEY.';
  if (err instanceof Anthropic.RateLimitError) return 'Claude перегружен или исчерпан лимит. Повторите через минуту.';
  if (err instanceof Anthropic.BadRequestError) return `Claude отклонил запрос: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Ошибка Claude (${err.status ?? 'сеть'}). Повторите вопрос.`;
  return `Ошибка агента: ${(err as Error).message}`;
}

async function runTurn(chatId: string, userId: string, turn: RunningTurn): Promise<void> {
  let history = await loadHistory(chatId);
  /** Всё, что добавится к истории за этот ответ, — сохраняется одной репликой. */
  const produced: Anthropic.MessageParam[] = [];
  const toolCalls: { name: string; label: string; isError: boolean; planId?: string }[] = [];
  let lastInputTokens: number | null = null;

  const saveAssistant = (text: string, isError: boolean) =>
    prisma.ropAgentMessage.create({
      data: {
        chatId,
        role: 'assistant',
        text,
        // Неудачный ответ в историю для Claude не попадает: незаконченный обмен
        // (вызов инструмента без результата) сломал бы следующий запрос.
        apiMessages: (isError ? [] : produced) as unknown as Prisma.InputJsonValue,
        toolCalls: toolCalls as unknown as Prisma.InputJsonValue,
        isError,
        inputTokens: lastInputTokens,
      },
    });

  try {
    const anthropic = getClient();
    const call = () => anthropic.messages.create({
      model: config.ropAgent.model,
      max_tokens: 16000,
      system: ROP_AGENT_SYSTEM_PROMPT,
      tools: ROP_AGENT_TOOLS,
      thinking: { type: 'adaptive' },
      output_config: { effort: config.ropAgent.effort },
      cache_control: { type: 'ephemeral' },
      messages: [...history, ...produced],
    });
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      let response: Anthropic.Message;
      try {
        response = await call();
      } catch (err) {
        if (!(round === 0 && err instanceof Anthropic.BadRequestError && hasThinking(history))) throw err;
        console.warn('[rop-agent] history rejected, retrying without old thinking blocks:', err.message);
        await stripThinkingInChat(chatId);
        history = withoutThinking(history);
        response = await call();
      }
      const usage = response.usage;
      lastInputTokens = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);

      if (response.stop_reason === 'refusal') {
        await saveAssistant('Модель отказалась отвечать на этот вопрос. Переформулируйте его.', true);
        return;
      }

      produced.push({ role: 'assistant', content: response.content });
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      if (response.stop_reason !== 'tool_use' || !toolUses.length) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n\n')
          .trim();
        if (toolUses.length) {
          // Обрезано посреди вызова инструмента: такой обмен нельзя оставить в истории.
          await saveAssistant('Ответ оборвался на середине. Повторите вопрос или сузьте его.', true);
        } else if (response.stop_reason === 'max_tokens') {
          await saveAssistant(`${text}\n\n_(ответ обрезан по длине — попросите продолжить)_`.trim(), false);
        } else {
          await saveAssistant(text || 'Агент не дал ответа. Повторите вопрос.', !text);
        }
        return;
      }

      if (round === MAX_TOOL_ROUNDS) {
        await saveAssistant('Агент сделал слишком много запросов к данным и не закончил. Сузьте вопрос.', true);
        return;
      }

      const results = await Promise.all(toolUses.map(async (tu) => {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        const label = describeToolCall(tu.name, input);
        turn.steps.push(label);
        const { content, isError, planId } = await executeTool(tu.name, input, { chatId, userId });
        toolCalls.push({ name: tu.name, label, isError, ...(planId ? { planId } : {}) });
        return { type: 'tool_result', tool_use_id: tu.id, content, is_error: isError } satisfies Anthropic.ToolResultBlockParam;
      }));
      produced.push({ role: 'user', content: results });
    }
  } catch (err) {
    console.error('[rop-agent] Claude call failed:', err);
    await saveAssistant(errorText(err), true);
  }
}
