import { Role } from '@prisma/client';

/** Пути API, доступные админам сайта (Supabase / SITE_ADMIN). */
const SITE_ADMIN_API_PREFIXES = [
  '/api/auth/me',
  '/api/supabase-auth',
  '/api/site-cms',
];

const PUBLIC_API_PREFIXES = [
  '/api/health',
  '/api/public/',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/supabase-auth/config',
  '/api/supabase-auth/exchange',
];

export function normalizeApiPath(url: string): string {
  const path = url.split('?')[0] ?? url;
  if (!path.startsWith('/api')) {
    const idx = path.indexOf('/api');
    if (idx >= 0) return path.slice(idx);
  }
  return path;
}

export function isSiteAdminApiAllowed(path: string): boolean {
  const p = normalizeApiPath(path);
  if (PUBLIC_API_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix))) {
    return true;
  }
  return SITE_ADMIN_API_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function isSiteAdminOnlyUser(role: Role, supabaseUserId?: string): boolean {
  return role === Role.SITE_ADMIN || Boolean(supabaseUserId);
}

/** false — админ сайта пытается вызвать CRM API */
export function canAccessCrmApi(path: string, role: Role, supabaseUserId?: string): boolean {
  if (!isSiteAdminOnlyUser(role, supabaseUserId)) return true;
  return isSiteAdminApiAllowed(path);
}
