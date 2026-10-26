import type { UserRole } from '../types';

/**
 * Совмещение ролей — как lib/roles.ts на сервере: менеджер с правом «Помощник
 * бухгалтера» видит и делает всё, что бухгалтер, оставаясь менеджером.
 */
export const ACCOUNTANT_ASSISTANT = 'accountant_assistant';

type RoleHolder = { role?: string | null; permissions?: string[] | null } | null | undefined;

export function effectiveRoles(user: RoleHolder): UserRole[] {
  if (!user?.role) return [];
  const roles = [user.role as UserRole];
  if (user.role !== 'ACCOUNTANT' && (user.permissions ?? []).includes(ACCOUNTANT_ASSISTANT)) roles.push('ACCOUNTANT');
  return roles;
}

export function userHasRole(user: RoleHolder, ...roles: UserRole[]): boolean {
  return effectiveRoles(user).some((r) => roles.includes(r));
}
