import client from './client';
import type { User } from '../types';

export type SupabaseAuthRole = 'superadmin' | 'admin';

export interface SupabaseAuthUser {
  id: string;
  email: string;
  role: SupabaseAuthRole | null;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
}

export interface SupabaseExchangeResponse {
  accessToken: string;
  refreshToken: string;
  user: User & {
    supabaseRole?: SupabaseAuthRole;
    supabaseUserId?: string;
    authSource?: 'supabase';
  };
}

export const supabaseAuthApi = {
  exchange: (accessToken: string) =>
    client.post<SupabaseExchangeResponse>('/supabase-auth/exchange', { accessToken }).then((r) => r.data),

  listUsers: () => client.get<SupabaseAuthUser[]>('/supabase-auth/users').then((r) => r.data),

  createUser: (data: { email: string; password: string; role: SupabaseAuthRole }) =>
    client.post<SupabaseAuthUser>('/supabase-auth/users', data).then((r) => r.data),

  updateRole: (id: string, role: SupabaseAuthRole) =>
    client.patch<SupabaseAuthUser>(`/supabase-auth/users/${id}`, { role }).then((r) => r.data),

  deleteUser: (id: string) => client.delete(`/supabase-auth/users/${id}`).then((r) => r.data),
};
