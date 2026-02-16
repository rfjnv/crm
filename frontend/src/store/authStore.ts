import { create } from 'zustand';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    const raw = JSON.parse(localStorage.getItem('crm_user') || 'null');
    if (raw && !raw.permissions) raw.permissions = [];
    return raw;
  })(),
  accessToken: localStorage.getItem('crm_access_token'),
  refreshToken: localStorage.getItem('crm_refresh_token'),

  setAuth: (user, accessToken, refreshToken) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
    localStorage.setItem('crm_access_token', accessToken);
    localStorage.setItem('crm_refresh_token', refreshToken);
    set({ user, accessToken, refreshToken });
  },

  setTokens: (accessToken, refreshToken) => {
    localStorage.setItem('crm_access_token', accessToken);
    localStorage.setItem('crm_refresh_token', refreshToken);
    set({ accessToken, refreshToken });
  },

  logout: () => {
    localStorage.removeItem('crm_user');
    localStorage.removeItem('crm_access_token');
    localStorage.removeItem('crm_refresh_token');
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
