import { useState, useEffect } from 'react';
import { Button, theme } from 'antd';
import { BellOutlined, CloseOutlined } from '@ant-design/icons';

/**
 * Баннер запроса разрешения на системные уведомления.
 * Показывается автоматически при первом входе на сайт.
 * Как у Telegram/Instagram — просит разрешение на уведомления.
 */
export default function NotificationPermissionBanner() {
  const [visible, setVisible] = useState(false);
  const { token: tk } = theme.useToken();

  useEffect(() => {
    // Не показывать если браузер не поддерживает
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    // Не показывать если разрешение уже дано или заблокировано
    if (Notification.permission !== 'default') return;

    // Не показывать если пользователь уже закрыл баннер
    const dismissed = localStorage.getItem('notification-banner-dismissed');
    if (dismissed) return;

    // Показать баннер через 2 секунды после загрузки
    const timer = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleAllow = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem('system-notifications-enabled', 'true');
        // Показать приветственное уведомление через Service Worker
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification('Уведомления включены!', {
            body: 'Теперь вы будете получать уведомления как в Telegram',
            icon: '/logo-icon.svg',
            badge: '/logo-icon.svg',
            tag: 'welcome',
          } as NotificationOptions);
        }
      }
    } catch (err) {
      console.error('Permission request error:', err);
    }
    setVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('notification-banner-dismissed', 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 12,
      right: 12,
      zIndex: 1000,
      background: tk.colorBgElevated,
      border: `1px solid ${tk.colorBorderSecondary}`,
      borderRadius: 12,
      padding: '16px 20px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
      maxWidth: 360,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BellOutlined style={{ fontSize: 20, color: tk.colorPrimary }} />
          <strong>Включить уведомления?</strong>
        </div>
        <CloseOutlined
          onClick={handleDismiss}
          style={{ fontSize: 12, color: tk.colorTextTertiary, cursor: 'pointer', padding: 4 }}
        />
      </div>
      <div style={{ color: tk.colorTextSecondary, fontSize: 13, lineHeight: 1.5 }}>
        Получайте уведомления о новых сделках, платежах и задачах — даже когда браузер свернут. Как в Telegram.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="primary" onClick={handleAllow} block>
          Разрешить
        </Button>
        <Button onClick={handleDismiss}>
          Позже
        </Button>
      </div>
    </div>
  );
}
