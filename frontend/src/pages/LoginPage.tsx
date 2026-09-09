import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Space, theme } from 'antd';
import { LockOutlined, UserOutlined, IdcardOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/authStore';
import { homePathForUser } from '../lib/authUser';
import { APP_BUTTON, APP_INPUT } from '../components/ui/AppClassNames';

/** Ответа от сервера не пришло вовсе: обрыв связи или таймаут просыпающегося бэкенда. */
function loginErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; code?: string; message?: string };
  const fromServer = e?.response?.data?.error;
  if (fromServer) return fromServer;
  if (!e?.response && (e?.code === 'ERR_NETWORK' || e?.code === 'ECONNABORTED' || e?.message === 'Network Error')) {
    return 'Сервер не отвечает. Проверьте интернет и попробуйте ещё раз.';
  }
  return fallback;
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { token } = theme.useToken();

  const onCrmLogin = async (values: { login: string; password: string }) => {
    setLoading(true);
    try {
      const tokens = await authApi.login(values.login, values.password);
      useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);

      // Пароль уже принят и сессия создана: сбой одного лишь профиля — не отказ во
      // входе, поэтому повторяем запрос, а не показываем «Ошибка входа».
      let user;
      try {
        user = await authApi.me();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 800));
        try {
          user = await authApi.me();
        } catch (meErr) {
          // Половинчатое состояние «токен есть, профиля нет» путает следующий вход —
          // сбрасываем его целиком и просим повторить.
          useAuthStore.getState().logout();
          message.error(loginErrorMessage(meErr, 'Вход выполнен, но профиль не загрузился. Попробуйте ещё раз.'));
          return;
        }
      }

      const fullUser = { ...user, authSource: 'crm' as const };
      setAuth(fullUser, tokens.accessToken, tokens.refreshToken);
      navigate(homePathForUser(fullUser));
    } catch (err: unknown) {
      message.error(loginErrorMessage(err, 'Ошибка входа'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="login-page"
      style={{ minHeight: 'var(--app-vh, 100vh)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <Card style={{ width: '100%', maxWidth: 420 }} bordered={false}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space direction="vertical" size={12} style={{ width: '100%', alignItems: 'center' }}>
            <div className="login-logo">
              <IdcardOutlined />
            </div>
            <Typography.Title level={3} style={{ textAlign: 'center', margin: 0, color: token.colorTextHeading }}>
              CRM System
            </Typography.Title>
          </Space>
          <Form layout="vertical" onFinish={onCrmLogin} autoComplete="off" requiredMark={false}>
            <Form.Item label="Логин" name="login" rules={[{ required: true, message: 'Введите логин' }]}>
              <Input className={APP_INPUT} prefix={<UserOutlined />} placeholder="Введите логин" size="large" />
            </Form.Item>
            <Form.Item label="Пароль" name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
              <Input.Password className={APP_INPUT} prefix={<LockOutlined />} placeholder="Введите пароль" size="large" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
              <Button type="primary" className={APP_BUTTON} htmlType="submit" loading={loading} block size="large">
                Войти
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
