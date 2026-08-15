import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Space, theme } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/authStore';
import { homePathForUser } from '../lib/authUser';
import { APP_BUTTON, APP_INPUT } from '../components/ui/AppClassNames';

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
      const user = await authApi.me();
      const fullUser = { ...user, authSource: 'crm' as const };
      setAuth(fullUser, tokens.accessToken, tokens.refreshToken);
      navigate(homePathForUser(fullUser));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка входа';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="login-page"
      style={{ minHeight: 'var(--app-vh, 100vh)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}
    >
      <Card style={{ width: '100%', maxWidth: 420 }} bordered={false}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 0, color: token.colorTextHeading }}>
            CRM System
          </Typography.Title>
          <Form layout="vertical" onFinish={onCrmLogin} autoComplete="off">
            <Form.Item name="login" rules={[{ required: true, message: 'Введите логин' }]}>
              <Input className={APP_INPUT} prefix={<UserOutlined />} placeholder="Логин" size="large" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
              <Input.Password className={APP_INPUT} prefix={<LockOutlined />} placeholder="Пароль" size="large" />
            </Form.Item>
            <Form.Item>
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
