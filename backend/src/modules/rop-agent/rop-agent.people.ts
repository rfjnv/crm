import prisma from '../../lib/prisma';
import { config } from '../../lib/config';

/**
 * Кто есть кто для бота РОП-агента: Telegram ID → сотрудник CRM, и кто из них
 * директор. Директор принимает решения (раздать план, поставить задачу), ему не
 * ставят задачи, общий разговор в группе — его. Остальные из HOS_ALLOWED_IDS
 * читают, спрашивают, но решений не принимают.
 */

export type AgentUser = { id: string; fullName: string };

export function isAllowedTelegramId(telegramId: number | string | undefined): boolean {
  return telegramId != null && config.hos.allowedIds.includes(String(telegramId));
}

export function isDirectorTelegramId(telegramId: number | string | undefined): boolean {
  return telegramId != null && config.hos.directorIds.includes(String(telegramId));
}

/**
 * Сотрудник CRM по Telegram ID (без проверки доступа): сначала HOS_USERS
 * («telegramId=логин»), иначе привязанный в CRM Telegram — его chat id в личке
 * и есть Telegram ID.
 */
export async function crmUserByTelegramId(telegramId: number | string | undefined): Promise<AgentUser | null> {
  if (telegramId == null) return null;
  const login = config.hos.users[String(telegramId)];
  const user = await prisma.user.findFirst({
    where: login ? { login } : { telegramChatId: String(telegramId) },
    select: { id: true, fullName: true, isActive: true },
  });
  return user?.isActive ? { id: user.id, fullName: user.fullName } : null;
}

/** Сотрудники CRM, которые директора (HOS_DIRECTOR_IDS). Кто не найден — пропускается. */
export async function directorUsers(): Promise<AgentUser[]> {
  const found = await Promise.all(config.hos.directorIds.map((id) => crmUserByTelegramId(id)));
  return found.filter((u): u is AgentUser => !!u);
}

export async function directorUserIds(): Promise<Set<string>> {
  return new Set((await directorUsers()).map((u) => u.id));
}
