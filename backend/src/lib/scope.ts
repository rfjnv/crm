import { Role } from '@prisma/client';

export interface AuthUser {
  userId: string;
  role: Role;
  permissions: string[];
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

export function clientOwnerScope(user: AuthUser): { managerId?: string } {
  if (CLIENT_BLOCKED_ROLES.includes(user.role)) {
    // Return impossible condition — effectively returns zero results
    return { managerId: '__NO_ACCESS__' };
  }
  // All sales roles (MANAGER, OPERATOR, ADMIN, etc.) see all clients;
  // managerId in clients tracks "last served by", not ownership
  return {};
}
