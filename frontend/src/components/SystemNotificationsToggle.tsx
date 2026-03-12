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
    if (checked && !canShow) {
      const granted = await requestPermission();
      if (!granted) {
        message.warning('Разрешение на системные уведомления отклонено');
        return;
      }
    }

    setIsEnabled(checked);
    localStorage.setItem('system-notifications-enabled', checked.toString());

    if (checked) {
      message.success('Системные уведомления включены');
      // Показываем тестовое уведомление
      show({
        title: '🎉 Системные уведомления включены!',
        body: 'Теперь вы будете получать уведомления поверх других программ',
        onclick: () => {
          window.focus();
        }
      });
    } else {
      message.success('Системные уведомления отключены');
    }
  };

  const handleTest = async () => {
    if (!canShow) {
      message.warning('Сначала разрешите системные уведомления');
      return;
    }

    setTestLoading(true);

    try {
      // Тест обычного уведомления
      show({
        title: '✅ Тест системного уведомления',
        body: 'Это обычное уведомление CRM системы',
        onclick: () => {
          message.info('Уведомление работает!');
        }
      });

      // Через 2 секунды тест срочного уведомления
      setTimeout(() => {
        showUrgent({
          title: '🚨 СРОЧНОЕ уведомление!',
          body: 'Это срочное уведомление с высоким приоритетом',
          onclick: () => {
            message.warning('Срочное уведомление работает!');
          }
        });
        setTestLoading(false);
      }, 2000);

      message.success('Тестовые уведомления отправлены');
    } catch (error) {
      console.error('Test notification error:', error);
      message.error('Ошибка отправки тестового уведомления');
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
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Typography.Text>
            Статус разрешений:
          </Typography.Text>
          <Typography.Text type={status.color as any}>
            {status.icon} {status.text}
          </Typography.Text>
        </Space>

        <Space>
          {canShow && (
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              onClick={handleTest}
              loading={testLoading}
            >
              Тест
            </Button>
          )}
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