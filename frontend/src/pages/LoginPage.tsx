import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Form, Input, Button, Card, Typography, message, Space, theme, Tabs, Alert, Spin } from 'antd';
import { LockOutlined, UserOutlined, MailOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth.api';
import { supabaseAuthApi } from '../api/supabaseAuth.api';
import { useAuthStore } from '../store/authStore';
import { ensureSupabaseConfig, getSupabase } from '../lib/supabase';
import { homePathForUser } from '../lib/authUser';
import { APP_BUTTON, APP_INPUT } from '../components/ui/AppClassNames';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const { token } = theme.useToken();

  const { data: supabaseReady = false, isLoading: supabaseLoading } = useQuery({
    queryKey: ['supabase-config'],
    queryFn: ensureSupabaseConfig,
    staleTime: 5 * 60 * 1000,
  });

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

  const onAdminLogin = async (values: { email: string; password: string }) => {
    const ready = supabaseReady || (await ensureSupabaseConfig());
    const supabase = ready ? getSupabase() : null;
    if (!supabase) {
      message.error('Supabase не настроен на сервере (SUPABASE_URL, SUPABASE_ANON_KEY)');
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
      navigate('/admin');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка входа';
      message.error(msg);
      await getSupabase()?.auth.signOut();
    } finally {
      setLoading(false);
    }
  };

  const adminTabContent = supabaseLoading ? (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Spin />
    </div>
  ) : supabaseReady ? (
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
  ) : (
    <Alert
      type="warning"
      showIcon
      message="Supabase не настроен"
      description="Добавьте SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY в переменные backend на Render и перезапустите сервис."
    />
  );

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
    {
      key: 'admin',
      label: 'Админ',
      children: adminTabContent,
    },
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
            Сотрудники — логин CRM · Админ — email (панель управления)
          </Typography.Text>
          <Tabs items={tabItems} centered />
        </Space>
      </Card>
    </div>
  );
}
