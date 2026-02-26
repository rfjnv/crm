import { useState, useEffect, useCallback } from 'react';
import { Switch, Button, Space, Typography, Alert, message } from 'antd';
import { BellOutlined, ExperimentOutlined } from '@ant-design/icons';
import { pushApi } from '../api/push.api';
import { useAuthStore } from '../store/authStore';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushNotificationToggle() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const checkSubscription = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSupported(false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEnabled(!!sub);
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  const handleToggle = async (checked: boolean) => {
    setLoading(true);
    try {
      if (checked) {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          message.warning('Разрешение на уведомления отклонено');
          setLoading(false);
          return;
        }

        // Get VAPID key from backend
        const { publicKey } = await pushApi.getVapidPublicKey();
        if (!publicKey) {
          message.error('VAPID ключ не настроен на сервере');
          setLoading(false);
          return;
        }

        // Subscribe via PushManager
        const reg = await navigator.serviceWorker.ready;
        const keyArray = urlBase64ToUint8Array(publicKey);
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyArray,
        });

        const json = subscription.toJSON();
        await pushApi.subscribe({
          endpoint: json.endpoint!,
          keys: {
            p256dh: json.keys!.p256dh!,
            auth: json.keys!.auth!,
          },
        });

        setEnabled(true);
        message.success('Push-уведомления включены');
      } else {
        // Unsubscribe
        const reg = await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          await pushApi.unsubscribe(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setEnabled(false);
        message.success('Push-уведомления отключены');
      }
    } catch (err) {
      console.error('Push toggle error:', err);
      message.error('Ошибка при переключении push-уведомлений');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTestLoading(true);
    try {
      await pushApi.test();
      message.success('Тестовое push-уведомление отправлено');
    } catch {
      message.error('Ошибка отправки тестового уведомления');
    } finally {
      setTestLoading(false);
    }
  };

  if (!supported) {
    return (
      <Alert
        type="info"
        showIcon
        message="Push-уведомления не поддерживаются в этом браузере"
        style={{ marginBottom: 16 }}
      />
    );
  }

  return (
    <div style={{
      padding: '12px 16px',
      background: 'rgba(34, 96, 154, 0.04)',
      borderRadius: 8,
      marginBottom: 16,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <Space>
        <BellOutlined style={{ fontSize: 18 }} />
        <div>
          <Typography.Text strong>Push-уведомления</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {enabled ? 'Включены — вы будете получать уведомления даже при закрытом браузере' : 'Отключены'}
          </Typography.Text>
        </div>
      </Space>
      <Space>
        {isAdmin && enabled && (
          <Button
            size="small"
            icon={<ExperimentOutlined />}
            onClick={handleTest}
            loading={testLoading}
          >
            Тест
          </Button>
        )}
        <Switch checked={enabled} onChange={handleToggle} loading={loading} />
      </Space>
    </div>
  );
}
