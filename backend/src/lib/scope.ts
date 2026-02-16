import { Role } from '@prisma/client';

export interface AuthUser {
  userId: string;
  role: Role;
  permissions: string[];
}

const FULL_ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE', 'WAREHOUSE_MANAGER'];

export function ownerScope(user: AuthUser): { managerId?: string } {
  if (FULL_ACCESS_ROLES.includes(user.role) || user.permissions.includes('view_all_deals')) {
    return {};
  }
  return { managerId: user.userId };
}

export function clientOwnerScope(user: AuthUser): { managerId?: string } {
  if (FULL_ACCESS_ROLES.includes(user.role) || user.permissions.includes('view_all_clients')) {
    return {};
  }
  return { managerId: user.userId };
}
