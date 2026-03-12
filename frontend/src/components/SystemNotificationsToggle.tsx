import { useState, useEffect } from 'react';
import { Switch, Button, Space, Typography, Alert, message, theme, Card } from 'antd';
import {
  BellOutlined,
  DesktopOutlined,
  ExperimentOutlined,
  CheckOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { useSystemNotifications } from '../hooks/useSystemNotifications';

export default function SystemNotificationsToggle() {
  const {
    permission,
    isSupported,
    canShow,
    requestPermission,
    show
  } = useSystemNotifications();

  const [isEnabled, setIsEnabled] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const { token: tk } = theme.useToken();

  useEffect(() => {
    // Проверяем сохраненную настройку пользователя
    const savedSetting = localStorage.getItem('system-notifications-enabled');
    setIsEnabled(savedSetting === 'true' && canShow);
  }, [canShow]);

  const handleToggle = async (checked: boolean) => {
    console.log('Toggle clicked. Current state:', { checked, canShow, permission });

    if (checked && !canShow) {
      console.log('Requesting notification permission...');
      const granted = await requestPermission();
      console.log('Permission result:', granted);

      if (!granted) {
        message.warning('Разрешение на системные уведомления отклонено');
        console.log('Permission was denied by user');
        return;
      }
    }

    setIsEnabled(checked);
    localStorage.setItem('system-notifications-enabled', checked.toString());
    console.log('Saved setting to localStorage:', checked);

    if (checked) {
      message.success('Системные уведомления включены');
      // Показываем тестовое уведомление
      console.log('Showing welcome notification...');
      const notification = show({
        title: '🎉 Системные уведомления включены!',
        body: 'Теперь вы будете получать уведомления поверх других программ',
        onclick: () => {
          console.log('Welcome notification clicked');
          window.focus();
        }
      });
      console.log('Welcome notification result:', notification);
    } else {
      message.success('Системные уведомления отключены');
      console.log('System notifications disabled');
    }
  };

  const handleTest = async () => {
    console.log('Test button clicked. Current state:', {
      permission,
      canShow,
      isSupported,
      isEnabled,
      'Notification.permission': 'Notification' in window ? Notification.permission : 'not supported'
    });

    // Проверяем поддержку уведомлений
    if (!('Notification' in window)) {
      message.error('Ваш браузер не поддерживает системные уведомления');
      return;
    }

    console.log('Current Notification.permission:', Notification.permission);

    // Запрашиваем разрешение, если его нет
    if (Notification.permission === 'default') {
      console.log('Permission is default, requesting...');
      try {
        const permission = await Notification.requestPermission();
        console.log('Permission request result:', permission);

        if (permission === 'granted') {
          message.success('Разрешение получено! Тестируем системное уведомление...');
          setIsEnabled(true);
          localStorage.setItem('system-notifications-enabled', 'true');
        } else {
          message.error('Разрешение отклонено. Системные уведомления работать не будут.');
          return;
        }
      } catch (error) {
        console.error('Error requesting permission:', error);
        message.error('Ошибка при запросе разрешения');
        return;
      }
    } else if (Notification.permission === 'denied') {
      message.error('Системные уведомления заблокированы в браузере');
      console.log('Permission denied by user earlier');
      return;
    }

    setTestLoading(true);

    try {
      console.log('Creating system notification...');

      // Создаем НАСТОЯЩЕЕ системное уведомление
      const notification = new Notification('🔔 Тест системного уведомления', {
        body: 'Это настоящее системное уведомление как у Telegram! Оно должно появиться поверх всех программ.',
        icon: '/favicon.ico',
        requireInteraction: true, // Не исчезает автоматически
        silent: false, // Со звуком
        tag: 'test-notification' // Для группировки
      });

      console.log('Notification object created:', notification);

      notification.onclick = () => {
        console.log('System notification clicked!');
        window.focus();
        message.success('✅ Системное уведомление сработало!');
        notification.close();
      };

      notification.onshow = () => {
        console.log('System notification shown successfully');
      };

      notification.onerror = (error) => {
        console.error('System notification error:', error);
        message.error('Ошибка показа системного уведомления');
      };

      // Через 5 секунд - второе тестовое уведомление
      setTimeout(() => {
        console.log('Creating second test notification...');
        const notification2 = new Notification('🚨 Второй тест', {
          body: 'Если вы видите это уведомление на рабочем столе - все работает правильно!',
          icon: '/favicon.ico',
          requireInteraction: false,
          tag: 'test-2'
        });

        notification2.onclick = () => {
          window.focus();
          notification2.close();
        };

        setTestLoading(false);
      }, 5000);

      message.info('Системные уведомления отправлены! Проверьте рабочий стол.');

    } catch (error) {
      console.error('Error creating notification:', error);
      message.error(`Ошибка создания уведомления: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
          Показывает уведомления поверх других программ, даже когда браузер свернут или неактивен.
        </Typography.Paragraph>
        {isSupported && (
          <Typography.Paragraph style={{ margin: '4px 0 0 0', color: tk.colorTextTertiary, fontSize: 11 }}>
            💡 Совет: Нажмите "Тест" - браузер запросит разрешение и покажет настоящее системное уведомление на рабочем столе.
          </Typography.Paragraph>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Typography.Text>
            Статус разрешений:
          </Typography.Text>
          <Typography.Text type={status.color as any}>
            {status.icon} {status.text}
          </Typography.Text>
          {permission !== 'granted' && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              (Нажмите "Тест" чтобы браузер запросил разрешение)
            </Typography.Text>
          )}
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
              <p>Чтобы включить уведомления:</p>
              <ol style={{ paddingLeft: 16, margin: 0 }}>
                <li>Нажмите на иконку 🔒 (замок) в адресной строке</li>
                <li>Выберите "Разрешить" для уведомлений</li>
                <li>Обновите страницу</li>
              </ol>
            </div>
          }
        />
      )}

      {isEnabled && canShow && (
        <Alert
          type="success"
          message="✅ Системные уведомления активны"
          description="Вы будете получать уведомления поверх других программ"
        />
      )}
    </Card>
  );
}