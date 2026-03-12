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
    show,
    showUrgent
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
      isEnabled
    });

    // Запрашиваем разрешение, если его нет
    if (!canShow) {
      console.log('Permission not granted, requesting...');
      const granted = await requestPermission();
      console.log('Permission request result:', granted);

      if (!granted) {
        message.warning('Разрешение на системные уведомления отклонено. Без разрешения тест невозможен.');
        console.log('Cannot proceed: permission was denied');
        return;
      }

      // Включаем уведомления после получения разрешения
      setIsEnabled(true);
      localStorage.setItem('system-notifications-enabled', 'true');
      message.success('Разрешение получено! Теперь тестируем уведомления...');
    }

    setTestLoading(true);

    try {
      console.log('Sending test notification...');

      // Простой тест уведомления
      const notification = show({
        title: '🔔 Тест уведомления',
        body: 'Если вы видите это - системные уведомления работают!',
        onclick: () => {
          console.log('Notification clicked!');
          window.focus();
          message.success('✅ Уведомление работает отлично!');
        }
      });

      console.log('Notification result:', notification);

      if (notification) {
        message.success('Тестовое уведомление отправлено! Проверьте рабочий стол.');
      } else {
        message.error('Не удалось создать уведомление. Проверьте разрешения браузера.');
        console.error('Notification creation failed');
      }

      // Через 3 секунды отправляем срочное
      setTimeout(() => {
        console.log('Sending urgent notification...');
        const urgentNotif = showUrgent({
          title: '🚨 Срочное уведомление',
          body: 'Это тест срочного уведомления с приоритетом',
          onclick: () => {
            console.log('Urgent notification clicked!');
            window.focus();
            message.warning('🚨 Срочное уведомление сработало!');
          }
        });
        console.log('Urgent notification result:', urgentNotif);
        setTestLoading(false);
      }, 3000);

    } catch (error) {
      console.error('Test notification error:', error);
      message.error(`Ошибка: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
            💡 Совет: Нажмите "Тест" - браузер запросит разрешение и покажет тестовое уведомление на рабочем столе.
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