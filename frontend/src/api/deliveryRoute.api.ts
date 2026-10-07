import client from './client';
import type { DeliveryRoute } from '../types';

export interface DeliveryRoutePayload {
  clientIds: string[];
  startBase: DeliveryRoute['startBase'];
  roundtrip: boolean;
}

export const deliveryRouteApi = {
  get: () => client.get<DeliveryRoute>('/delivery-route').then((r) => r.data),
  save: (data: DeliveryRoutePayload) => client.put<DeliveryRoute>('/delivery-route', data).then((r) => r.data),
};
