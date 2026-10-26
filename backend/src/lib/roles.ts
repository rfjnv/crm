import { Prisma, Role } from '@prisma/client';

/**
 * Совмещение ролей. Роль у пользователя одна, но менеджеру можно выдать право
 * «Помощник бухгалтера» — тогда везде, где пускают бухгалтера, пускают и его,
 * а всё менеджерское (свои сделки, KPI, клиенты) остаётся как было.
 */
export const ACCOUNTANT_ASSISTANT = 'accountant_assistant';

type RoleHolder = { role: Role | string; permissions?: string[] | null };

/** Роль пользователя плюс роли, которые он исполняет по праву. */
export function effectiveRoles(user: RoleHolder): Role[] {
  const roles = [user.role as Role];
  if (user.role !== 'ACCOUNTANT' && (user.permissions ?? []).includes(ACCOUNTANT_ASSISTANT)) roles.push('ACCOUNTANT');
  return roles;
}

/** Исполняет ли пользователь хотя бы одну из ролей. */
export function hasRole(user: RoleHolder, ...roles: Role[]): boolean {
  return effectiveRoles(user).some((r) => roles.includes(r));
}

/** Фильтр Prisma «пользователи этих ролей» — включая тех, кто исполняет роль по праву. */
export function userRolesWhere(roles: Role[]): Prisma.UserWhereInput {
  if (!roles.includes('ACCOUNTANT')) return { role: { in: roles } };
  return { OR: [{ role: { in: roles } }, { permissions: { has: ACCOUNTANT_ASSISTANT } }] };
}
