import { useState, useEffect } from 'react';

export interface SystemNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  onclick?: () => void;
}

class SystemNotificationManager {
  private permission: NotificationPermission = 'default';

  constructor() {
    this.checkPermission();
  }

  private checkPermission() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Браузер не поддерживает уведомления');
      return false;
    }

    if (this.permission === 'granted') {
      return true;
    }

    try {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      return permission === 'granted';
    } catch (error) {
      console.error('Ошибка запроса разрешения:', error);
      return false;
    }
  }

  canShowNotifications(): boolean {
    return 'Notification' in window && this.permission === 'granted';
  }

  show(options: SystemNotificationOptions): Notification | null {
    if (!this.canShowNotifications()) {
      return null;
    }

    try {
      const notification = new Notification(options.title, {
        body: options.body,
        icon: options.icon || '/favicon.ico', // Используем иконку сайта по умолчанию
        badge: options.badge,
        tag: options.tag,
        requireInteraction: true, // Уведомление не исчезнет автоматически
        silent: false, // Звук уведомления
      });

      // Обработчик клика
      if (options.onclick) {
        notification.onclick = () => {
          window.focus(); // Фокус на окне браузера
          options.onclick?.();
          notification.close();
        };
      }

      // Автозакрытие через 10 секунд если не взаимодействовали
      setTimeout(() => {
        notification.close();
      }, 10000);

      return notification;
    } catch (error) {
      console.error('Ошибка показа уведомления:', error);
      return null;
    }
  }

  showUrgent(options: SystemNotificationOptions): Notification | null {
    return this.show({
      ...options,
      tag: 'urgent', // Группировка срочных уведомлений
      icon: '/favicon.ico',
    });
  }

  getPermission(): NotificationPermission {
    return this.permission;
  }

  isSupported(): boolean {
    return 'Notification' in window;
  }
}

// Singleton instance
export const systemNotifications = new SystemNotificationManager();

// React hook for system notifications
export function useSystemNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(systemNotifications.isSupported());
    setPermission(systemNotifications.getPermission());

    // Listen for permission changes
    const handleVisibilityChange = () => {
      setPermission(systemNotifications.getPermission());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const requestPermission = async () => {
    const granted = await systemNotifications.requestPermission();
    setPermission(systemNotifications.getPermission());
    return granted;
  };

  return {
    permission,
    isSupported,
    canShow: permission === 'granted',
    requestPermission,
    show: systemNotifications.show.bind(systemNotifications),
    showUrgent: systemNotifications.showUrgent.bind(systemNotifications),
  };
}