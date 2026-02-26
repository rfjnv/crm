import client from './client';
import type { CompanySettings } from '../types';

export const settingsApi = {
  getCompanySettings: () =>
    client.get<CompanySettings>('/settings/company').then((r) => r.data),

  updateCompanySettings: (data: Partial<Omit<CompanySettings, 'id' | 'logoPath' | 'updatedAt'>>) =>
    client.put<CompanySettings>('/settings/company', data).then((r) => r.data),

  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return client.post<CompanySettings>('/settings/company/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};
