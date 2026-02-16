import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Space, theme } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { token } = theme.useToken();

  const onFinish = async (values: { login: string; password: string }) => {
    setLoading(true);
    try {
      const tokens = await authApi.login(values.login, values.password);
      // Store tokens first so the interceptor can use them for /me request
      useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);
      const user = await authApi.me();
      setAuth(user, tokens.accessToken, tokens.refreshToken);
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка входа';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: token.colorBgLayout }}>
      <Card style={{ width: 400 }} bordered={false}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 0, color: token.colorTextHeading }}>
            CRM System
          </Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>
            Вход в систему
          </Typography.Text>
          <Form layout="vertical" onFinish={onFinish} autoComplete="off">
            <Form.Item name="login" rules={[{ required: true, message: 'Введите логин' }]}>
              <Input prefix={<UserOutlined />} placeholder="Логин" size="large" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="Пароль" size="large" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                Войти
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
