import client from './client';
import type { User, Permission, UserKPI } from '../types';

export const usersApi = {
  list: () => client.get<User[]>('/users').then((r) => r.data),

  create: (data: { login: string; password: string; fullName: string; role: string; permissions?: Permission[] }) =>
    client.post<User>('/users', data).then((r) => r.data),

  update: (id: string, data: Partial<{ login: string; fullName: string; role: string; isActive: boolean; password: string; permissions: Permission[] }>) =>
    client.patch<User>(`/users/${id}`, data).then((r) => r.data),

  deactivate: (id: string) => client.delete<User>(`/users/${id}`).then((r) => r.data),

  activate: (id: string) => client.patch<User>(`/users/${id}/activate`).then((r) => r.data),

  kpi: (id: string, period: string = 'month') =>
    client.get<UserKPI>(`/users/${id}/kpi`, { params: { period } }).then((r) => r.data),
};
