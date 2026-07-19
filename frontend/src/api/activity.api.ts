import client from './client';

export type ActivityEventType = 'PAGE_VIEW' | 'HEARTBEAT';

export const activityApi = {
  report: (type: ActivityEventType, path: string) =>
    client.post('/activity', { type, path }).then((r) => r.data),
};
