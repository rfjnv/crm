import { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Typography, theme } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth.api';
import logo from '../assets/logo.png';

const { Header, Sider, Content } = AntLayout;

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch { /* ignore */ }
    try {
      const { getSupabase } = await import('../lib/supabase');
      await getSupabase()?.auth.signOut();
    } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  const menuItems: MenuProps['items'] = [
    {
      key: '/admin',
      icon: <DashboardOutlined />,
      label: <Link to="/admin">Обзор</Link>,
    },
    {
      key: '/admin/users',
      icon: <UserOutlined />,
      label: <Link to="/admin/users">Пользователи</Link>,
    },
    {
      key: '/admin/inquiries',
      icon: <MessageOutlined />,
      label: <Link to="/admin/inquiries">Заявки</Link>,
    },
  ];

  const selectedKey = (() => {
    if (location.pathname.startsWith('/admin/users')) return '/admin/users';
    if (location.pathname.startsWith('/admin/inquiries')) return '/admin/inquiries';
    return '/admin';
  })();

  return (
    <AntLayout style={{ minHeight: 'var(--app-vh, 100vh)' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        theme="dark"
        style={{ background: '#0f2744' }}
      >
        <div style={{ padding: collapsed ? '12px 8px' : '16px', textAlign: 'center' }}>
          <img
            src={logo}
            alt="Admin"
            style={{ maxWidth: collapsed ? 36 : 140, maxHeight: 40, objectFit: 'contain' }}
          />
          {!collapsed && (
            <Typography.Text style={{ display: 'block', color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 8 }}>
              Панель администратора
            </Typography.Text>
          )}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={menuItems} style={{ background: 'transparent', border: 0 }} />
      </Sider>

      <AntLayout>
        <Header
          style={{
            padding: '0 20px',
            background: token.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((v) => !v)}
            />
            <Typography.Text type="secondary">{user?.login || user?.fullName}</Typography.Text>
          </div>
          <Button type="text" danger icon={<LogoutOutlined />} onClick={() => void handleLogout()}>
            Выйти
          </Button>
        </Header>

        <Content style={{ margin: 20, minHeight: 280 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
