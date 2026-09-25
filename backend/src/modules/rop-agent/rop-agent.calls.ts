import type TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { analyzeSalesCallTranscript, transcribeAudioFile } from '../ai-assistant/ai-assistant.service';
import { telegramService, type TgButton } from '../telegram/telegram.service';
import { listManagers } from './rop-agent.analysis';
import { STAGES } from './rop-agent.call-reviews';
import { agentUserByChat, askAgentFromTelegram } from './rop-agent.telegram';

/**
 * Разбор звонков. Менеджеры звонят с мобильных, поэтому записей в CRM нет — их
 * присылают вручную: файлом в Telegram-бот (или через «Аудио в текст» в CRM).
 * Звонок расшифровывается и проходит тот же аудит, что в CRM, но сохраняется
 * с привязкой к менеджеру и клиенту, этапами продажи и советами. Агент по запросу
 * собирает из этих аудитов картину по менеджеру: что проваливает и что тренировать.
 */

// ─── Запись звонка в Telegram ───────────────────────────────────────────────

const AUDIO_EXT = /\.(m4a|mp3|amr|ogg|oga|opus|wav|aac|3gp|3gpp|flac|webm|mp4)$/i;
/** Telegram отдаёт ботам файлы до 20 МБ. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CALL_SEC = 30 * 60;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Файл из сообщения, если это запись звонка (аудио или документ-аудио). */
function callFile(msg: TelegramBot.Message): { fileId: string; name: string; size: number; duration: number | null } | null {
  if (msg.audio) {
    // file_name Telegram присылает, но в типах библиотеки его нет.
    const name = (msg.audio as TelegramBot.Audio & { file_name?: string }).file_name ?? 'call.mp3';
    return { fileId: msg.audio.file_id, name, size: msg.audio.file_size ?? 0, duration: msg.audio.duration ?? null };
  }
  const d = msg.document;
  if (d && ((d.mime_type ?? '').startsWith('audio/') || AUDIO_EXT.test(d.file_name ?? ''))) {
    return { fileId: d.file_id, name: d.file_name ?? 'call', size: d.file_size ?? 0, duration: null };
  }
  return null;
}

/**
 * Чей звонок и с каким клиентом — по подписи к файлу («Дилноза, Print House»).
 * Менеджер — если в подписи ровно одно имя активного сотрудника; клиент — самое
 * длинное название компании, которое встречается в подписи.
 */
async function attributionFromCaption(caption: string) {
  const text = caption.toLowerCase();
  if (!text.trim()) return { managerId: null as string | null, managerName: null as string | null, clientId: null as string | null, clientName: null as string | null };
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true } });
  const matchedUsers = users.filter((u) => {
    const first = u.fullName.trim().split(/\s+/)[0]?.toLowerCase();
    return (first && first.length >= 3 && new RegExp(`(^|[^\\p{L}])${first}`, 'u').test(text)) || text.includes(u.fullName.toLowerCase());
  });
  const clients = await prisma.$queryRaw<{ id: string; company_name: string }[]>(Prisma.sql`
    SELECT id, company_name FROM clients
    WHERE is_archived = false AND length(company_name) >= 3 AND ${text} LIKE '%' || lower(company_name) || '%'
    ORDER BY length(company_name) DESC LIMIT 1`);
  const manager = matchedUsers.length === 1 ? matchedUsers[0] : null;
  return {
    managerId: manager?.id ?? null,
    managerName: manager?.fullName ?? null,
    clientId: clients[0]?.id ?? null,
    clientName: clients[0]?.company_name ?? null,
  };
}

function auditHtml(a: {
  managerName: string | null; clientName: string | null; score: number | null; saleProbability: number | null;
  stageChecklist?: Record<string, boolean>; mentorTips?: string[];
}): string {
  const who = [a.managerName ?? 'менеджер не указан', a.clientName].filter(Boolean).join(' — ');
  const lines = [`🎧 <b>Разбор звонка</b>: ${esc(who)}`];
  const score = a.score != null ? `Оценка: <b>${a.score}/10</b>` : 'Оценка: —';
  lines.push(a.saleProbability != null ? `${score} · вероятность продажи ${a.saleProbability}%` : score);
  if (a.stageChecklist) {
    lines.push('', Object.entries(STAGES).map(([k, label]) => `${a.stageChecklist![k] ? '✅' : '❌'} ${label}`).join('\n'));
  }
  if (a.mentorTips?.length) {
    lines.push('', '<b>Что улучшить</b>', ...a.mentorTips.slice(0, 4).map((t) => `• ${esc(t)}`));
  }
  return lines.join('\n');
}

async function auditButtons(auditId: string, managerId: string | null): Promise<TgButton[][]> {
  const rows: TgButton[][] = [];
  if (!managerId) {
    // Не поняли, чей звонок, — предлагаем выбрать; id сотрудника коротко (callback_data до 64 байт).
    const { managers } = await listManagers();
    const pick = managers.slice(0, 8).map((m) => ({ text: m.name.split(/\s+/)[0], callback: `rop:m:${auditId}:${m.id.slice(0, 8)}` }));
    for (let i = 0; i < pick.length; i += 4) rows.push(pick.slice(i, i + 4));
  } else {
    rows.push([{ text: '🤖 Что тренировать менеджеру', callback: `rop:t:${auditId}` }]);
  }
  rows.push([{ text: '📄 Полный разбор в CRM', url: `/ai-assistant/call-audits?audit=${auditId}` }]);
  return rows;
}

async function onCallRecording(msg: TelegramBot.Message): Promise<void> {
  const user = await agentUserByChat(msg.chat.id);
  if (!user) return;
  const f = callFile(msg);
  if (!f) return;
  if (f.size > MAX_FILE_BYTES) {
    await telegramService.sendHtmlToChat(msg.chat.id, '⚠️ Файл больше 20 МБ — Telegram не отдаёт такие ботам. Загрузите его в CRM: «Аудио в текст».');
    return;
  }
  if (f.duration && f.duration > MAX_CALL_SEC) {
    await telegramService.sendHtmlToChat(msg.chat.id, `⚠️ Запись длиннее ${MAX_CALL_SEC / 60} минут — загрузите её в CRM: «Аудио в текст».`);
    return;
  }

  const statusId = await telegramService.sendHtmlToChat(msg.chat.id, '🎧 Разбираю звонок: расшифровка и аудит займут 1–3 минуты…');
  const typing = setInterval(() => { telegramService.sendTyping(msg.chat.id); }, 5000);
  const dir = path.resolve(config.uploads.dir, 'tg-calls');
  let file: string | null = null;
  try {
    await fs.mkdir(dir, { recursive: true });
    file = await telegramService.downloadFile(f.fileId, dir);
    const who = await attributionFromCaption(msg.caption ?? '');
    // transcribeAudioFile берёт из файла только путь — остальное для типа.
    const stt = await transcribeAudioFile(
      { path: file, originalname: f.name, mimetype: 'audio/mpeg', size: f.size } as Express.Multer.File,
      { languageMode: 'auto' },
    );
    const audit = await analyzeSalesCallTranscript(stt.text, 'mixed', {
      userId: user.id,
      managerId: who.managerId ?? undefined,
      managerName: who.managerName ?? undefined,
      clientId: who.clientId ?? undefined,
      audioDuration: f.duration ?? stt.audioQuality.durationSec ?? undefined,
      qualityScore: stt.qualityScore,
      source: 'telegram',
    });
    if (!audit.auditId) throw new Error('аудит не сохранён');
    const html = auditHtml({ ...who, score: audit.score ?? null, saleProbability: audit.saleProbability ?? null, stageChecklist: audit.stageChecklist as unknown as Record<string, boolean>, mentorTips: audit.mentorTips });
    const hint = who.managerId ? '' : '\n\nЧей это звонок? Нажмите имя — аудит попадёт в статистику менеджера. В следующий раз можно подписать файл: «Дилноза, Print House».';
    if (statusId) await telegramService.deleteChatMessage(msg.chat.id, statusId);
    await telegramService.sendHtmlToChat(msg.chat.id, html + hint, await auditButtons(audit.auditId, who.managerId));
  } catch (err) {
    const reason = err instanceof AppError ? err.message : 'Не получилось разобрать запись. Проверьте файл или загрузите его в CRM: «Аудио в текст».';
    if (!(err instanceof AppError)) console.error('[rop-calls] failed:', (err as Error).message);
    if (statusId) await telegramService.editHtmlMessage(msg.chat.id, statusId, `⚠️ ${esc(reason)}`);
  } finally {
    clearInterval(typing);
    if (file) await fs.unlink(file).catch(() => {});
  }
}

/** «Чей звонок?» — привязать аудит к менеджеру. */
async function onPickManager(query: TelegramBot.CallbackQuery): Promise<void> {
  const [, , auditId, short] = (query.data ?? '').split(':');
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const user = chatId != null ? await agentUserByChat(chatId) : null;
  if (!user || !auditId || !short || chatId == null || messageId == null) {
    await telegramService.answerCallback(query.id, 'Нет доступа');
    return;
  }
  const managers = await prisma.user.findMany({ where: { id: { startsWith: short }, isActive: true }, select: { id: true, fullName: true } });
  if (managers.length !== 1) {
    await telegramService.answerCallback(query.id, 'Сотрудник не найден');
    return;
  }
  const audit = await prisma.callAudit.update({
    where: { id: auditId },
    data: { managerId: managers[0].id, managerName: managers[0].fullName },
    select: { id: true, score: true, saleProbability: true, stageChecklist: true, mentorTips: true, client: { select: { companyName: true } } },
  });
  await telegramService.answerCallback(query.id, `Звонок ${managers[0].fullName}`);
  await telegramService.editHtmlMessage(chatId, messageId, auditHtml({
    managerName: managers[0].fullName,
    clientName: audit.client?.companyName ?? null,
    score: audit.score,
    saleProbability: audit.saleProbability,
    stageChecklist: (audit.stageChecklist as Record<string, boolean> | null) ?? undefined,
    mentorTips: (audit.mentorTips as string[] | null) ?? undefined,
  }), await auditButtons(audit.id, managers[0].id));
}

/** «Что тренировать менеджеру» — агент смотрит все аудиты менеджера, не только этот звонок. */
async function onCoachManager(query: TelegramBot.CallbackQuery): Promise<void> {
  const [, , auditId] = (query.data ?? '').split(':');
  const chatId = query.message?.chat.id;
  const user = chatId != null ? await agentUserByChat(chatId) : null;
  if (!user || !auditId || chatId == null) {
    await telegramService.answerCallback(query.id, 'Нет доступа');
    return;
  }
  const audit = await prisma.callAudit.findUnique({ where: { id: auditId }, select: { managerId: true, manager: { select: { fullName: true } } } });
  if (!audit?.managerId || !audit.manager) {
    await telegramService.answerCallback(query.id, 'Сначала укажите, чей звонок');
    return;
  }
  await telegramService.answerCallback(query.id, 'Спрашиваю агента');
  await askAgentFromTelegram(chatId, user.id,
    `Разбери звонки менеджера ${audit.manager.fullName} (manager_id ${audit.managerId}), начиная с последнего аудита ${auditId}: `
    + 'какие этапы он проваливает постоянно, что получается, 2–3 конкретных упражнения или фразы на неделю. Если аудитов мало — скажи, сколько записей ещё прислать.');
}

telegramService.onPrivateFile(onCallRecording);
telegramService.onCallback('rop:m:', onPickManager);
telegramService.onCallback('rop:t:', onCoachManager);
