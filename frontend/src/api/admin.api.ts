import client from './client';

export const adminApi = {
  purgeData: () =>
    client.post<{ success: boolean; message: string }>('/admin/purge-data').then((r) => r.data),
};
