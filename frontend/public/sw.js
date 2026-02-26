// Polygraph CRM Service Worker — push notifications + offline shell

const CACHE_NAME = 'crm-v1';

// Install: cache shell assets
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push: show native notification
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Уведомление', body: event.data.text() };
  }

  const { title, body, url, severity } = payload;

  const options = {
    body: body || '',
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: url || 'crm-notification',
    data: { url: url || '/notifications' },
    requireInteraction: severity === 'URGENT',
    vibrate: severity === 'URGENT' ? [200, 100, 200, 100, 200] : [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title || 'CRM', options));
});

// Notification click: focus or open CRM tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing CRM tab
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // No existing tab — open new one
      return self.clients.openWindow(targetUrl);
    }),
  );
});
