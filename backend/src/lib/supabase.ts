import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, isSupabaseConfigured } from './config';

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)');
  }
  if (!adminClient) {
    adminClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

export function getSupabasePublic(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured');
  }
  if (!publicClient) {
    publicClient = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return publicClient;
}

export type SupabaseAuthRole = 'superadmin' | 'admin';

/** Нормализует role из user_metadata (допускает SUPER_ADMIN, Superadmin и т.п.). */
export function parseSupabaseRole(metadata: Record<string, unknown> | undefined): SupabaseAuthRole | null {
  const raw = metadata?.role;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'superadmin' || normalized === 'super_admin') return 'superadmin';
  if (normalized === 'admin') return 'admin';
  return null;
}
