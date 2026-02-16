import client from './client';
import type { AuthTokens, User } from '../types';

export const authApi = {
  login: (login: string, password: string) =>
    client.post<AuthTokens>('/auth/login', { login, password }).then((r) => r.data),

  me: () => client.get<User>('/auth/me').then((r) => r.data),

  refresh: (refreshToken: string) =>
    client.post<AuthTokens>('/auth/refresh', { refreshToken }).then((r) => r.data),

  logout: (refreshToken: string) =>
    client.post('/auth/logout', { refreshToken }).then((r) => r.data),
};
