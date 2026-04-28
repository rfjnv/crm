import { create } from 'zustand';
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
      const raw = JSON.parse(localStorage.getItem('crm_user') || 'null');
      if (raw && !raw.permissions) raw.permissions = [];
      return raw;
    } catch {
      localStorage.removeItem('crm_user');
      return null;
    }
  })(),
  accessToken: localStorage.getItem('crm_access_token'),
  refreshToken: null,

  setAuth: (user, accessToken) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
    localStorage.setItem('crm_access_token', accessToken);
    localStorage.removeItem('crm_refresh_token');
    set({ user, accessToken, refreshToken: null });
  },

  setTokens: (accessToken) => {
    localStorage.setItem('crm_access_token', accessToken);
    localStorage.removeItem('crm_refresh_token');
    set({ accessToken, refreshToken: null });
  },

  setUser: (user) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
    set({ user });
  },

  logout: () => {
    localStorage.removeItem('crm_user');
    localStorage.removeItem('crm_access_token');
    localStorage.removeItem('crm_refresh_token');
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
