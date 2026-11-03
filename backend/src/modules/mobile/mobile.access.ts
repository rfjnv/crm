import type { CallChannel, Prisma } from '@prisma/client';
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

/**
 * Звонки продаж. Звонки HR (кандидаты, сотрудники) — отдельный поток: их нет ни в журнале
 * «Звонки», ни в KPI, аналитике, карточках клиентов и РОП-агенте. Этот фильтр — во всех таких местах.
 */
export function salesChannelWhere(): Prisma.CallSessionWhereInput {
  return { channel: 'SALES' };
}

/** Видимые пользователю звонки продаж; удалённые руководителем не видны никому. */
export function callScope(user: CallsUser): Prisma.CallSessionWhereInput {
  return canSeeAllCalls(user)
    ? { deletedAt: null, channel: 'SALES' }
    : { deletedAt: null, channel: 'SALES', managerUserId: user.userId };
}

/** Все звонки HR видят директор и те, кому выдано view_hr_calls. ADMIN и РОП — нет. */
export function canSeeAllHrCalls(user: CallsUser): boolean {
  return user.role === 'SUPER_ADMIN' || (user.permissions ?? []).includes(PERMISSIONS.VIEW_HR_CALLS);
}

/** Звонки HR, видимые пользователю: все — директору и с view_hr_calls, свои — сотруднику HR. null — доступа нет. */
export function hrCallScope(user: CallsUser): Prisma.CallSessionWhereInput | null {
  if (canSeeAllHrCalls(user)) return { deletedAt: null, channel: 'HR' };
  if (user.role === 'HR') return { deletedAt: null, channel: 'HR', managerUserId: user.userId };
  return null;
}

/** Есть ли у пользователя раздел «Звонки HR». */
export function canUseHrCalls(user: CallsUser): boolean {
  return hrCallScope(user) !== null;
}

/**
 * Кому идут алерты по телефонам. Продажи — РОП (use_rop_agent) и директор;
 * телефон HR — только директор: РОП звонки HR не касаются.
 */
export async function callLeaderIds(channel: CallChannel = 'SALES'): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      telegramChatId: { not: null },
      OR: channel === 'HR'
        ? [{ role: 'SUPER_ADMIN' }]
        : [{ role: 'SUPER_ADMIN' }, { permissions: { has: PERMISSIONS.USE_ROP_AGENT } }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
