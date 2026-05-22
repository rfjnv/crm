import type { User } from '../types';

/** После refresh /auth/me не всегда отдаёт authSource — не терять признак админа сайта. */
export function enrichUserFromMe(fresh: User, prev?: User | null): User {
  const siteAdmin =
    fresh.role === 'SITE_ADMIN'
    || Boolean(fresh.supabaseUserId)
    || prev?.authSource === 'supabase'
    || prev?.role === 'SITE_ADMIN';

  if (siteAdmin) {
    return {
      ...fresh,
      authSource: 'supabase',
      supabaseUserId: fresh.supabaseUserId ?? prev?.supabaseUserId,
    };
  }

  return { ...fresh, authSource: fresh.authSource ?? 'crm' };
}

export function isSiteAdminUser(user: { authSource?: string; role?: string } | null | undefined): boolean {
  return user?.authSource === 'supabase' || user?.role === 'SITE_ADMIN';
}
