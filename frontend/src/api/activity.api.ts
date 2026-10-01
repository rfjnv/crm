import client, { API_URL } from './client';
import { useAuthStore } from '../store/authStore';
import { getDeviceId } from '../lib/deviceId';

export type ActivityEventType = 'PAGE_VIEW' | 'HEARTBEAT';

interface QueuedEvent {
  type: ActivityEventType;
  path: string;
  at: string;
}

/**
 * События активности копятся и уходят пачкой раз в 15 с (и при уходе со страницы),
 * а не отдельным запросом на каждый переход. Время каждого события сохраняется.
 */
const FLUSH_DELAY_MS = 15_000;
const queue: QueuedEvent[] = [];
let flushTimer: number | null = null;

function flush(onUnload = false) {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, queue.length);
  if (onUnload) {
    // Страница закрывается: keepalive даёт запросу дожить, axios тут уже не успеет
    const token = useAuthStore.getState().accessToken;
    void fetch(`${API_URL}/activity`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(token && token !== 'undefined' ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ events }),
    }).catch(() => {});
    return;
  }
  client.post('/activity', { events }).catch(() => {});
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}

export const activityApi = {
  report: (type: ActivityEventType, path: string) => {
    queue.push({ type, path, at: new Date().toISOString() });
    if (queue.length >= 50) flush();
    else if (flushTimer === null) flushTimer = window.setTimeout(() => flush(), FLUSH_DELAY_MS);
    return Promise.resolve();
  },
};
