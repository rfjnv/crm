import { Role } from '@prisma/client';

export interface AuthUser {
  userId: string;
  role: Role;
  permissions: string[];
  companyId?: string;
}

const FULL_ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE', 'WAREHOUSE_MANAGER', 'OPERATOR', 'DRIVER', 'LOADER', 'HR'];

/** Roles that have no business reason to browse the client list */
const CLIENT_BLOCKED_ROLES: Role[] = ['DRIVER', 'LOADER', 'WAREHOUSE', 'WAREHOUSE_MANAGER'];

export function ownerScope(user: AuthUser): { managerId?: string } {
  if (FULL_ACCESS_ROLES.includes(user.role) || user.permissions.includes('view_all_deals')) {
    return {};
  }
  return { managerId: user.userId };
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
