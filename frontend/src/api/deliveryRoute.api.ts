import client from './client';
import type { DeliveryRoute } from '../types';

export interface DeliveryRoutePayload {
  stopIds: string[];
  startBase: DeliveryRoute['startBase'];
  roundtrip: boolean;
}

export const deliveryRouteApi = {
  get: () => client.get<DeliveryRoute>('/delivery-route').then((r) => r.data),
  save: (data: DeliveryRoutePayload) => client.put<DeliveryRoute>('/delivery-route', data).then((r) => r.data),
  markDelivered: (stopId: string, delivered: boolean) =>
    client.post<DeliveryRoute>(`/delivery-route/stops/${stopId}/delivered`, { delivered }).then((r) => r.data),
};
