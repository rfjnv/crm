import { useState, useEffect } from 'react';
import { Switch, Button, Space, Typography, Alert, message, theme, Card } from 'antd';
import {
  BellOutlined,
  DesktopOutlined,
  ExperimentOutlined,
  CheckOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';

export default function SystemNotificationsToggle() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isEnabled, setIsEnabled] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const { token: tk } = theme.useToken();

  const isSupported = 'Notification' in window && 'serviceWorker' in navigator;
  const canShow = permission === 'granted' && swReady;

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    // Проверяем Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => {
        setSwReady(true);
      });
    }

    const savedSetting = localStorage.getItem('system-notifications-enabled');
    if (savedSetting === 'true' && Notification.permission === 'granted') {
      setIsEnabled(true);
    }
  }, []);

  // Показать уведомление через Service Worker (как Telegram/Instagram)
  const showViaServiceWorker = async (title: string, body: string, tag?: string) => {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/vite.svg',
      badge: '/vite.svg',
      tag: tag || 'crm-notification',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url: '/notifications' }
    });
  };

  const handleToggle = async (checked: boolean) => {
    if (checked) {
      // Запрашиваем разрешение
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== 'granted') {
          message.warning('Разрешение на уведомления отклонено');
          return;
        }
      }

      setIsEnabled(true);
      localStorage.setItem('system-notifications-enabled', 'true');
      message.success('Системные уведомления включены');

      // Тестовое уведомление через Service Worker
      try {
        await showViaServiceWorker(
          'Системные уведомления включены!',
          'Теперь вы будете получать уведомления поверх других программ, как в Telegram'
        );
      } catch (err) {
        console.error('SW notification error:', err);
      }
    } else {
      setIsEnabled(false);
      localStorage.setItem('system-notifications-enabled', 'false');
      message.success('Системные уведомления отключены');
    }
  };

  const handleTest = async () => {
    // Запрашиваем разрешение если нет
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        message.error('Разрешение отклонено. Без разрешения уведомления не работают.');
        return;
      }
      setIsEnabled(true);
      localStorage.setItem('system-notifications-enabled', 'true');
    } else if (Notification.permission === 'denied') {
      message.error('Уведомления заблокированы в настройках браузера');
      return;
    }

    setTestLoading(true);

    try {
      // Уведомление через Service Worker - как Telegram и Instagram
      await showViaServiceWorker(
        'Тест системного уведомления',
        'Это настоящее системное уведомление! Оно появляется поверх всех программ, как в Telegram.',
        'test-1'
      );

      // Второе через 3 секунды
      setTimeout(async () => {
        try {
          await showViaServiceWorker(
            'Второй тест',
            'Если вы видите это на рабочем столе - все работает!',
            'test-2'
          );
        } catch (err) {
          console.error('Second notification error:', err);
        }
        setTestLoading(false);
      }, 3000);

    } catch (err) {
      console.error('Test notification error:', err);
      message.error('Ошибка: Service Worker не готов. Обновите страницу и попробуйте снова.');
      setTestLoading(false);
    }
  };

  if (!isSupported) {
    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        <Alert
          type="warning"
          showIcon
          message="Системные уведомления не поддерживаются"
          description="Ваш браузер не поддерживает системные уведомления. Используйте Chrome, Firefox или Edge."
        />
      </Card>
    );
  }

  const getPermissionStatus = () => {
    switch (permission) {
      case 'granted':
        return { color: 'success', text: 'Разрешены', icon: <CheckOutlined /> };
      case 'denied':
        return { color: 'error', text: 'Заблокированы', icon: <ExclamationCircleOutlined /> };
      default:
        return { color: 'warning', text: 'Не запрошены', icon: <BellOutlined /> };
    }
  };

  const status = getPermissionStatus();

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <DesktopOutlined />
          <span>Системные уведомления</span>
        </Space>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <Typography.Paragraph style={{ margin: 0, color: tk.colorTextSecondary }}>
          Уведомления поверх других программ через Service Worker (как в Telegram и Instagram).
        </Typography.Paragraph>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Typography.Text>
            Статус:
          </Typography.Text>
          <Typography.Text type={status.color as 'success' | 'warning' | 'danger'}>
            {status.icon} {status.text}
          </Typography.Text>
        </Space>

        <Space>
          <Button
            size="small"
            icon={<ExperimentOutlined />}
            onClick={handleTest}
            loading={testLoading}
          >
            Тест
          </Button>
          <Switch
            checked={isEnabled && canShow}
            onChange={handleToggle}
            disabled={permission === 'denied'}
          />
        </Space>
      </div>

      {permission === 'denied' && (
        <Alert
          type="info"
          message="Уведомления заблокированы"
          description={
            <div>
              <p>Чтобы включить:</p>
              <ol style={{ paddingLeft: 16, margin: 0 }}>
                <li>Нажмите на замок в адресной строке</li>
                <li>Разрешите уведомления</li>
                <li>Обновите страницу</li>
              </ol>
            </div>
          }
        />
      )}

      {isEnabled && canShow && (
        <Alert
          type="success"
          message="Системные уведомления активны"
          description="Уведомления будут показываться поверх других программ через Service Worker"
        />
      )}
    </Card>
  );
}
