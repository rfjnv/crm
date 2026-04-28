import client from './client';
import type { AuthTokens, User } from '../types';

export const authApi = {
  login: (login: string, password: string) =>
    client.post<AuthTokens>('/auth/login', { login, password }).then((r) => r.data),

  me: () => client.get<User>('/auth/me').then((r) => r.data),

  // refreshToken comes from HttpOnly cookie automatically
  refresh: () =>
    client.post<AuthTokens>('/auth/refresh', {}).then((r) => r.data),

  logout: () =>
    client.post('/auth/logout', {}).then((r) => r.data),
};
