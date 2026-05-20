import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Space, theme, Tabs } from 'antd';
import { LockOutlined, UserOutlined, MailOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth.api';
import { supabaseAuthApi } from '../api/supabaseAuth.api';
import { useAuthStore } from '../store/authStore';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
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
      setAuth({ ...user, authSource: 'crm' }, tokens.accessToken, tokens.refreshToken);
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка входа';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const onAdminLogin = async (values: { email: string; password: string }) => {
    const supabase = getSupabase();
    if (!supabase) {
      message.error('Supabase не настроен (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });
      if (error || !data.session?.access_token) {
        message.error('Неверный email или пароль');
        return;
      }

      const exchanged = await supabaseAuthApi.exchange(data.session.access_token);
      setAuth(exchanged.user, exchanged.accessToken, exchanged.refreshToken);
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка входа';
      message.error(msg);
      await getSupabase()?.auth.signOut();
    } finally {
      setLoading(false);
    }
  };

  const tabItems = [
    {
      key: 'crm',
      label: 'Сотрудники',
      children: (
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
      ),
    },
    ...(isSupabaseConfigured
      ? [{
          key: 'admin',
          label: 'Admin (email)',
          children: (
            <Form layout="vertical" onFinish={onAdminLogin} autoComplete="off">
              <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Введите email' }]}>
                <Input className={APP_INPUT} prefix={<MailOutlined />} placeholder="Email" size="large" />
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
          ),
        }]
      : []),
  ];

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
          <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>
            Вход в систему
          </Typography.Text>
          <Tabs items={tabItems} centered={tabItems.length > 1} />
        </Space>
      </Card>
    </div>
  );
}
