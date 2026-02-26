import client from './client';

export const pushApi = {
  getVapidPublicKey: () =>
    client.get<{ publicKey: string }>('/push/vapid-key').then((r) => r.data),

  subscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    client.post('/push/subscribe', subscription).then((r) => r.data),

  unsubscribe: (endpoint: string) =>
    client.delete('/push/unsubscribe', { data: { endpoint } }).then((r) => r.data),

  test: () =>
    client.post('/push/test').then((r) => r.data),
};
