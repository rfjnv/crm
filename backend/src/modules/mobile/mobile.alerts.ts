import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { telegramService } from '../telegram/telegram.service';
import { callLeaderIds } from './mobile.access';
import { formatTashkentTime, isWorkingTime, workingMsBetween } from './mobile.mapping';
import { getMobileSettings } from './mobile.settings';

/**
 * Алерты руководителю о телефонах. Каждая проблема — одно сообщение на эпизод: отметка
 * в MobileDevice снимается, когда проблема ушла (телефон вышел на связь, пришла запись,
 * разрешения вернули), и только тогда следующий эпизод снова даст сообщение.
 */

const HOUR_MS = 60 * 60 * 1000;
const SILENT_AFTER_MS = 2 * HOUR_MS;
const NO_RECORDINGS_WINDOW_MS = 48 * HOUR_MS;
/** Свежим звонкам даём время: запись может ждать Wi-Fi */
const NO_RECORDINGS_GRACE_MS = 2 * HOUR_MS;
const MIN_ANSWERED_SEC = 30;

export const PERMISSION_LABELS: Record<string, string> = {
  call_log: 'журнал звонков',
  phone_state: 'состояние телефона',
  contacts: 'контакты',
  recordings: 'доступ к записям',
  battery_unrestricted: 'работа без ограничений батареи',
  notifications: 'уведомления',
  recordings_dir: 'папка записей не найдена',
};

/** Проблемы телефона: выключенные разрешения и ненайденная папка записей. */
export function deviceProblems(d: { permissions: Prisma.JsonValue | null; recordingsDirFound: boolean | null }): string[] {
  const problems: string[] = [];
  if (d.permissions && typeof d.permissions === 'object' && !Array.isArray(d.permissions)) {
    for (const [key, value] of Object.entries(d.permissions)) {
      if (value === false) problems.push(key);
    }
  }
  if (d.recordingsDirFound === false) problems.push('recordings_dir');
  return problems.sort();
}

export function problemLabels(problems: string[]): string {
  return problems.map((p) => PERMISSION_LABELS[p] ?? p).join(', ');
}

async function notifyLeaders(title: string, body: string): Promise<void> {
  const ids = await callLeaderIds();
  await Promise.allSettled(ids.map((id) => telegramService.sendToUser(id, { title, body, url: '/mobile-devices', severity: 'WARNING' })));
}

export interface MobileChecksResult {
  skipped?: string;
  silent: number;
  noRecordings: number;
  problems: number;
}

export async function runMobileChecks(now: Date = new Date()): Promise<MobileChecksResult> {
  const result: MobileChecksResult = { silent: 0, noRecordings: 0, problems: 0 };
  const settings = await getMobileSettings();
  if (!isWorkingTime(now, settings)) return { ...result, skipped: 'нерабочее время' };

  const devices = await prisma.mobileDevice.findMany({
    where: { active: true, user: { isActive: true } },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      lastSeenAt: true,
      permissions: true,
      recordingsDirFound: true,
      silentAlertedAt: true,
      noRecordingsAlertedAt: true,
      problemsAlertKey: true,
      user: { select: { fullName: true } },
    },
  });

  for (const d of devices) {
    const name = d.user.fullName;

    // Телефон молчит больше 2 часов рабочего времени
    const since = d.lastSeenAt ?? d.createdAt;
    if (!d.silentAlertedAt && workingMsBetween(since, now, settings) >= SILENT_AFTER_MS) {
      await notifyLeaders('Телефон менеджера не на связи', `${name}: CallSync не выходил на связь с ${formatTashkentTime(since, now)}. Телефон выключен, нет интернета или приложение остановлено.`);
      await prisma.mobileDevice.update({ where: { id: d.id }, data: { silentAlertedAt: now } });
      result.silent += 1;
    }

    // Разрешения и папка записей — при первом появлении
    const problems = deviceProblems(d);
    const key = problems.length > 0 ? problems.join(',') : null;
    if (key && key !== d.problemsAlertKey) {
      await notifyLeaders('Проблема на телефоне менеджера', `${name}: ${problemLabels(problems)}. Звонки или записи могут не попадать в CRM.`);
      result.problems += 1;
    }
    if (key !== d.problemsAlertKey) {
      await prisma.mobileDevice.update({ where: { id: d.id }, data: { problemsAlertKey: key } });
    }

    // Отвеченные звонки есть, записей нет
    if (!d.noRecordingsAlertedAt) {
      const from = new Date(now.getTime() - NO_RECORDINGS_WINDOW_MS);
      const answered = await prisma.callSession.count({
        where: {
          managerUserId: d.userId,
          provider: 'MOBILE',
          status: 'COMPLETED',
          durationSec: { gt: MIN_ANSWERED_SEC },
          startedAt: { gte: from, lt: new Date(now.getTime() - NO_RECORDINGS_GRACE_MS) },
        },
      });
      if (answered > 0) {
        const recordings = await prisma.callRecording.count({ where: { userId: d.userId, createdAt: { gte: from } } });
        if (recordings === 0) {
          await notifyLeaders('Записи разговоров не приходят', `${name}: за 2 дня ${answered} отвеченных звонков длиннее ${MIN_ANSWERED_SEC} с и ни одной записи. Проверьте запись звонков и папку записей на телефоне.`);
          await prisma.mobileDevice.update({ where: { id: d.id }, data: { noRecordingsAlertedAt: now } });
          result.noRecordings += 1;
        }
      }
    }
  }
  return result;
}
