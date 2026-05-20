import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API_URL } from '../api/client';

const buildUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const buildAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let runtimeUrl: string | undefined;
let runtimeAnonKey: string | undefined;
let client: SupabaseClient | null = null;
let configPromise: Promise<boolean> | null = null;

function resolvedUrl() {
  return buildUrl || runtimeUrl;
}

function resolvedAnonKey() {
  return buildAnonKey || runtimeAnonKey;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(resolvedUrl() && resolvedAnonKey());
}

/** Подтянуть url + anon key с бэкенда (если не заданы в VITE_* при сборке). */
export async function ensureSupabaseConfig(): Promise<boolean> {
  if (isSupabaseConfigured()) return true;
  if (!configPromise) {
    configPromise = fetch(`${API_URL}/supabase-auth/config`)
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { configured?: boolean; url?: string; anonKey?: string };
        if (data.configured && data.url && data.anonKey) {
          runtimeUrl = data.url;
          runtimeAnonKey = data.anonKey;
          client = null;
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        configPromise = null;
      });
  }
  return configPromise;
}

export function getSupabase(): SupabaseClient | null {
  const url = resolvedUrl();
  const anonKey = resolvedAnonKey();
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export type SupabaseAuthRole = 'superadmin' | 'admin';
