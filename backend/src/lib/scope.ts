import { Role } from '@prisma/client';
import { AppError } from './errors';

export interface AuthUser {
  userId: string;
  role: Role;
  permissions: string[];
  companyId?: string;
}

const FULL_ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE', 'WAREHOUSE_MANAGER', 'OPERATOR', 'DRIVER', 'LOADER', 'HR'];

/** Roles that have no business reason to browse the client list */
const CLIENT_BLOCKED_ROLES: Role[] = ['DRIVER', 'LOADER', 'WAREHOUSE', 'WAREHOUSE_MANAGER'];

export function ownerScope(user: AuthUser): { managerId?: string; client?: { companyId: string } } {
  const clientCompany = (user.role !== 'SUPER_ADMIN' && user.companyId)
    ? { client: { companyId: user.companyId } }
    : {};
  if (FULL_ACCESS_ROLES.includes(user.role) || user.permissions.includes('view_all_deals')) {
    return { ...clientCompany };
  }
  return { managerId: user.userId, ...clientCompany };
}

/**
 * Требует, чтобы пользователь был привязан к компании.
 *
 * `ownerScope` при отсутствии `companyId` возвращает пустой фильтр — то есть отдаёт
 * данные всех компаний. Для справочников это терпимо, для финансовых реестров (долги,
 * активные сделки, карточка долга клиента) — утечка. Поэтому финансовые маршруты
 * проверяют привязку явно.
 *
 * Намеренно не встроено в сам `ownerScope`: глобальная смена поведения затронула бы
 * всё приложение, включая учётки без компании, созданные импортом.
 */
export function assertCompanyScoped(user: AuthUser): void {
  if (user.role === 'SUPER_ADMIN') return;
  if (!user.companyId) {
    throw new AppError(403, 'Учётная запись не привязана к компании — доступ к финансовым данным закрыт');
  }
}

/** Prisma.sql clause for filtering deals by company in raw SQL queries */
export function ownerScopeCompanySql(user: AuthUser) {
  if (user.role === 'SUPER_ADMIN' || !user.companyId) return null;
  return user.companyId;
}

/** Returns company filter clause — SUPER_ADMIN sees all companies */
export function companyScope(user: AuthUser): { companyId?: string } {
  if (user.role === 'SUPER_ADMIN' || !user.companyId) return {};
  return { companyId: user.companyId };
}

export function clientOwnerScope(user: AuthUser): { managerId?: string; companyId?: string } {
  const company = companyScope(user);

  if (user.permissions.includes('view_all_clients')) {
    return { ...company };
  }
  if (CLIENT_BLOCKED_ROLES.includes(user.role)) {
    return { managerId: '__NO_ACCESS__', ...company };
  }
  return { ...company };
}
