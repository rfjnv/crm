import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { PERMISSIONS } from '../../lib/permissions';

interface CallsUser {
  userId: string;
  role: string;
  permissions?: string[];
}

/**
 * Кто видит звонки всех менеджеров: директор и админы, а также руководитель отдела продаж.
 * Отдельной роли РОП в CRM нет — его, как и в модуле rop-agent, отличает право use_rop_agent.
 * Остальные видят только свои звонки.
 */
export function canSeeAllCalls(user: CallsUser): boolean {
  return user.role === 'SUPER_ADMIN'
    || user.role === 'ADMIN'
    || (user.permissions ?? []).includes(PERMISSIONS.USE_ROP_AGENT);
}

/** Видимые пользователю звонки; удалённые руководителем не видны никому. */
export function callScope(user: CallsUser): Prisma.CallSessionWhereInput {
  return canSeeAllCalls(user) ? { deletedAt: null } : { deletedAt: null, managerUserId: user.userId };
}

/** Кому идут алерты по телефонам: РОП (use_rop_agent) и директор. */
export async function callLeaderIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      telegramChatId: { not: null },
      OR: [{ role: 'SUPER_ADMIN' }, { permissions: { has: PERMISSIONS.USE_ROP_AGENT } }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
