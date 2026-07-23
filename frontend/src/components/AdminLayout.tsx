import { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Typography, theme } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  LogoutOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  ShoppingOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth.api';
import { MARKETING_SITE_URL } from '../lib/marketingSite';
import { getFirstName } from '../lib/name-utils';
import logo from '../assets/logo.png';

const { Header, Sider, Content } = AntLayout;

const menuItems: MenuProps['items'] = [
  { key: '/admin', icon: <DashboardOutlined />, label: <Link to="/admin">Обзор</Link> },
  { type: 'divider' },
  { type: 'group', label: 'Сайт polygraph-business' },
  { key: '/admin/content', icon: <FileTextOutlined />, label: <Link to="/admin/content">Тексты</Link> },
  { key: '/admin/products', icon: <ShoppingOutlined />, label: <Link to="/admin/products">Продукция</Link> },
  { key: '/admin/services', icon: <AppstoreOutlined />, label: <Link to="/admin/services">Услуги</Link> },
  { key: '/admin/blog', icon: <ReadOutlined />, label: <Link to="/admin/blog">Блог</Link> },
  { key: '/admin/inquiries', icon: <MessageOutlined />, label: <Link to="/admin/inquiries">Заявки</Link> },
  { type: 'divider' },
  { key: '/admin/users', icon: <UserOutlined />, label: <Link to="/admin/users">Пользователи</Link> },
];

function resolveSelectedKey(pathname: string): string {
  const keys = ['/admin/users', '/admin/inquiries', '/admin/content', '/admin/products', '/admin/services', '/admin/blog'];
  const hit = keys.find((k) => pathname.startsWith(k));
  return hit ?? '/admin';
}

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

  return (
    <AntLayout style={{ minHeight: 'var(--app-vh, 100vh)' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={240}
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
              Админка сайта
            </Typography.Text>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[resolveSelectedKey(location.pathname)]}
          items={menuItems}
          style={{ background: 'transparent', border: 0 }}
        />
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
            <Typography.Text type="secondary">{user?.login || getFirstName(user?.fullName)}</Typography.Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button type="link" href={MARKETING_SITE_URL} target="_blank" rel="noreferrer" icon={<GlobalOutlined />}>
              Открыть сайт
            </Button>
            <Button type="text" danger icon={<LogoutOutlined />} onClick={() => void handleLogout()}>
              Выйти
            </Button>
          </div>
        </Header>

        <Content style={{ margin: 20, minHeight: 280 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
