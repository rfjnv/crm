import client from './client';
import type {
  SupplierSite,
  SupplierSitePayload,
  VedMapRoute,
  VedMapRoutePayload,
} from '../types';

export const vedMapApi = {
  listSites: (params?: { supplierId?: string; siteType?: string; includeArchivedSuppliers?: boolean }) =>
    client
      .get<SupplierSite[]>('/foreign-trade/map/sites', {
        params: {
          ...(params?.supplierId ? { supplierId: params.supplierId } : {}),
          ...(params?.siteType ? { siteType: params.siteType } : {}),
          ...(params?.includeArchivedSuppliers ? { includeArchivedSuppliers: 'true' } : {}),
        },
      })
      .then((r) => r.data),

  createSite: (data: SupplierSitePayload) =>
    client.post<SupplierSite>('/foreign-trade/map/sites', data).then((r) => r.data),

  updateSite: (id: string, data: Partial<SupplierSitePayload>) =>
    client.patch<SupplierSite>(`/foreign-trade/map/sites/${id}`, data).then((r) => r.data),

  deleteSite: (id: string) => client.delete(`/foreign-trade/map/sites/${id}`),

  listRoutes: (params?: { supplierId?: string }) =>
    client
      .get<VedMapRoute[]>('/foreign-trade/map/routes', {
        params: params?.supplierId ? { supplierId: params.supplierId } : {},
      })
      .then((r) => r.data),

  createRoute: (data: VedMapRoutePayload) =>
    client.post<VedMapRoute>('/foreign-trade/map/routes', data).then((r) => r.data),

  updateRoute: (id: string, data: Partial<VedMapRoutePayload>) =>
    client.patch<VedMapRoute>(`/foreign-trade/map/routes/${id}`, data).then((r) => r.data),

  deleteRoute: (id: string) => client.delete(`/foreign-trade/map/routes/${id}`),
};
