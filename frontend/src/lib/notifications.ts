/**
 * Доступ к Web Notifications API, безопасный там, где его вообще нет.
 *
 * Android WebView этот API не реализует — а CRM открывают именно из него:
 * со встроенных панелей и из Telegram. Обращение к глобальной `Notification`
 * там падает с ReferenceError, и если это происходит при рендере, React
 * размонтирует всё дерево и остаётся пустой экран.
 *
 * Проверять разрешение следует только через эти функции. Сам конструктор
 * `new Notification(...)` требует глобали, поэтому его вызовы допустимы, но
 * обязаны стоять после `canShowNotifications()` и внутри try/catch.
 */

/** Отдельное от 'granted'/'denied'/'default' состояние: API отсутствует как таковой. */
export type NotificationSupport = NotificationPermission | 'unsupported';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationSupport {
  return isNotificationSupported() ? Notification.permission : 'unsupported';
}

/** true только когда уведомления и поддерживаются, и разрешены. */
export function canShowNotifications(): boolean {
  return getNotificationPermission() === 'granted';
}

export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    // Некоторые встроенные браузеры объявляют API, но запрос запрещают.
    return 'denied';
  }
}
