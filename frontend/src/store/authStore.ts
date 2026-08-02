import { create } from 'zustand';
import { safeStorage } from '../lib/safeStorage';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** @deprecated refreshToken is now stored in HttpOnly cookie — do not use */
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken?: string) => void;
  setTokens: (accessToken: string, refreshToken?: string) => void;
  /** Обновить профиль (роль, permissions) с сервера, не меняя токены — после смены прав админом. */
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    try {
      const raw = JSON.parse(safeStorage.getItem('crm_user') || 'null');
      if (raw && !raw.permissions) raw.permissions = [];
      return raw;
    } catch {
      safeStorage.removeItem('crm_user');
      return null;
    }
  })(),
  accessToken: safeStorage.getItem('crm_access_token'),
  refreshToken: null,

  setAuth: (user, accessToken) => {
    safeStorage.setItem('crm_user', JSON.stringify(user));
    safeStorage.setItem('crm_access_token', accessToken);
    safeStorage.removeItem('crm_refresh_token');
    set({ user, accessToken, refreshToken: null });
  },

  setTokens: (accessToken) => {
    safeStorage.setItem('crm_access_token', accessToken);
    safeStorage.removeItem('crm_refresh_token');
    set({ accessToken, refreshToken: null });
  },

  setUser: (user) => {
    safeStorage.setItem('crm_user', JSON.stringify(user));
    set({ user });
  },

  logout: () => {
    safeStorage.removeItem('crm_user');
    safeStorage.removeItem('crm_access_token');
    safeStorage.removeItem('crm_refresh_token');
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
