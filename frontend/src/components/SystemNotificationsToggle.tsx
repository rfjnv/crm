import { useState, useEffect } from 'react';
import { Switch, Button, Space, Typography, Alert, message, theme, Card } from 'antd';
import {
  DesktopOutlined,
  ExperimentOutlined,
  CheckOutlined,
  ExclamationCircleOutlined,
  BellOutlined
} from '@ant-design/icons';

export default function SystemNotificationsToggle() {
  const [permission, setPermission] = useState<string>('unknown');
  const [isEnabled, setIsEnabled] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [swReady, setSwReady] = useState(false);
  const [swStatus, setSwStatus] = useState('checking...');
  const { token: tk } = theme.useToken();

  const isSupported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;

  useEffect(() => {
    // Диагностика
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    } else {
      setPermission('not-supported');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        setSwReady(true);
        setSwStatus(`active (scope: ${reg.scope})`);
      }).catch(() => {
        setSwStatus('error');
      });

      // Также проверим текущую регистрацию
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) {
          setSwStatus('not registered');
        }
      });
    } else {
      setSwStatus('not supported');
    }

    const savedSetting = localStorage.getItem('system-notifications-enabled');
    if (savedSetting === 'true' && 'Notification' in window && Notification.permission === 'granted') {
      setIsEnabled(true);
    }
  }, []);

  // Запрос разрешения - большая заметная кнопка
  const handleRequestPermission = async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        message.success('Разрешение получено! Теперь нажмите "Тест"');
        setIsEnabled(true);
        localStorage.setItem('system-notifications-enabled', 'true');
      } else if (result === 'denied') {
        message.error('Вы заблокировали уведомления. Разблокируйте через замок в адресной строке.');
      } else {
        message.warning('Разрешение не дано. Попробуйте еще раз.');
      }
    } catch (err) {
      console.error('Permission request error:', err);
      message.error('Ошибка при запросе разрешения');
    }
  };

  // Тест уведомления через Service Worker
  const handleTest = async () => {
    // Если нет разрешения - сначала запросить
    if (Notification.permission !== 'granted') {
      await handleRequestPermission();
      if (Notification.permission !== 'granted') return;
    }

    if (!swReady) {
      message.error('Service Worker не готов. Обновите страницу (Ctrl+F5).');
      return;
    }

    setTestLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;

      // Отправляем уведомление через Service Worker
      await reg.showNotification('Тест CRM уведомления', {
        body: 'Это системное уведомление! Если вы видите это - все работает как Telegram!',
        icon: '/vite.svg',
        badge: '/vite.svg',
        tag: 'test-crm',
        requireInteraction: true,
        data: { url: '/notifications' }
      } as NotificationOptions);

      message.success('Уведомление отправлено через Service Worker! Смотрите рабочий стол.');

      setTimeout(() => setTestLoading(false), 2000);
    } catch (err) {
      console.error('SW notification error:', err);
      message.error(`Ошибка Service Worker: ${err instanceof Error ? err.message : String(err)}`);
      setTestLoading(false);
    }
  };

  const handleToggle = async (checked: boolean) => {
    if (checked) {
      if (Notification.permission !== 'granted') {
        await handleRequestPermission();
        if (Notification.permission !== 'granted') return;
      }
      setIsEnabled(true);
      localStorage.setItem('system-notifications-enabled', 'true');
    } else {
      setIsEnabled(false);
      localStorage.setItem('system-notifications-enabled', 'false');
    }
  };

  if (!isSupported) {
    return (
      <Card size="small" style={{ marginBottom: 16 }}>
        <Alert
          type="warning"
          showIcon
          message="Системные уведомления не поддерживаются"
          description="Ваш браузер не поддерживает уведомления. Используйте Chrome, Firefox или Edge."
        />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <DesktopOutlined />
          <span>Системные уведомления (как Telegram)</span>
        </Space>
      }
    >
      {/* Диагностика - показываем текущий статус */}
      <div style={{ marginBottom: 12, padding: 8, background: tk.colorFillQuaternary, borderRadius: 6, fontSize: 12 }}>
        <div>Разрешение браузера: <strong>{permission}</strong></div>
        <div>Service Worker: <strong>{swStatus}</strong></div>
        <div>Включено в CRM: <strong>{isEnabled ? 'да' : 'нет'}</strong></div>
      </div>

      {/* Если разрешение не дано - показать большую кнопку */}
      {permission !== 'granted' && permission !== 'denied' && (
        <Button
          type="primary"
          size="large"
          icon={<BellOutlined />}
          onClick={handleRequestPermission}
          block
          style={{ marginBottom: 12, height: 48, fontSize: 16 }}
        >
          Разрешить уведомления
        </Button>
      )}

      {/* Если заблокировано */}
      {permission === 'denied' && (
        <Alert
          type="error"
          style={{ marginBottom: 12 }}
          message="Уведомления заблокированы!"
          description={
            <div>
              <p style={{ margin: '4px 0' }}>Чтобы разблокировать:</p>
              <ol style={{ paddingLeft: 16, margin: 0 }}>
                <li>Нажмите на замок/иконку слева от адреса сайта</li>
                <li>Найдите "Уведомления" и выберите "Разрешить"</li>
                <li>Обновите страницу</li>
              </ol>
            </div>
          }
        />
      )}

      {/* Если разрешено - показать тест и переключатель */}
      {permission === 'granted' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Space>
            <CheckOutlined style={{ color: tk.colorSuccess }} />
            <Typography.Text type="success">Разрешение получено</Typography.Text>
          </Space>
          <Space>
            <Button
              size="small"
              type="primary"
              icon={<ExperimentOutlined />}
              onClick={handleTest}
              loading={testLoading}
            >
              Тест
            </Button>
            <Switch
              checked={isEnabled}
              onChange={handleToggle}
            />
          </Space>
        </div>
      )}

      {isEnabled && permission === 'granted' && swReady && (
        <Alert
          type="success"
          message="Системные уведомления активны"
          description="Уведомления будут появляться поверх всех программ, как в Telegram"
        />
      )}

      {isEnabled && permission === 'granted' && !swReady && (
        <Alert
          type="warning"
          message="Service Worker загружается..."
          description="Обновите страницу (Ctrl+F5) если уведомления не работают"
        />
      )}
    </Card>
  );
}
