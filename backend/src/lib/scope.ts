import { Role } from '@prisma/client';
import { hasRole } from './roles';

export interface AuthUser {
  userId: string;
  role: Role;
  permissions: string[];
}

const FULL_ACCESS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE', 'WAREHOUSE_MANAGER', 'OPERATOR', 'DRIVER', 'LOADER', 'HR'];

/** Roles that have no business reason to browse the client list */
const CLIENT_BLOCKED_ROLES: Role[] = ['DRIVER', 'LOADER', 'WAREHOUSE', 'WAREHOUSE_MANAGER'];

export function ownerScope(user: AuthUser): { managerId?: string } {
  if (hasRole(user, ...FULL_ACCESS_ROLES) || user.permissions.includes('view_all_deals')) {
    return {};
  }
  return { managerId: user.userId };
}

export function clientOwnerScope(user: AuthUser): { managerId?: string } {
  if (user.permissions.includes('view_all_clients')) {
    return {};
  }
  if (CLIENT_BLOCKED_ROLES.includes(user.role)) {
    return { managerId: '__NO_ACCESS__' };
  }
  return {};
}
