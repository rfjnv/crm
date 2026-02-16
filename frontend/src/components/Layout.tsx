import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Typography, Switch, Badge, theme } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  FundProjectionScreenOutlined,
  ShopOutlined,
  SwapOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BulbOutlined,
  ContainerOutlined,
  DollarOutlined,
  BarChartOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  BellOutlined,
  SendOutlined,
  AuditOutlined,
  CarOutlined,
  CheckSquareOutlined,
  MessageOutlined,
  WalletOutlined,
  ProjectOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { authApi } from '../api/auth.api';
import { conversationsApi } from '../api/conversations.api';
import NotificationBell from './NotificationBell';
import logo from '../assets/logo.svg';
import miniLogo from '../assets/mini-logo.svg';
import type { UserRole, Permission } from '../types';

const { Header, Sider, Content } = AntLayout;

const SIDER_WIDTH = 220;
const SIDER_COLLAPSED_WIDTH = 64;

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshToken, logout } = useAuthStore();
  const { mode, toggle } = useThemeStore();
  const { token: themeToken } = theme.useToken();

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  const role = user?.role as UserRole | undefined;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const hasPermission = (perm: string) => isAdmin || user?.permissions?.includes(perm as Permission);

  const hasRole = (...roles: UserRole[]) => role ? roles.includes(role) : false;

  // Presence ping
  useEffect(() => {
    conversationsApi.ping();
    const interval = setInterval(() => conversationsApi.ping(), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Unread message counts
  const { data: unreadCounts } = useQuery({
    queryKey: ['unread-counts'],
    queryFn: conversationsApi.getUnreadCounts,
    refetchInterval: 10_000,
  });

  const totalUnread = unreadCounts
    ? Object.values(unreadCounts).reduce((sum, c) => sum + c, 0)
    : 0;

  const siderWidth = collapsed ? SIDER_COLLAPSED_WIDTH : SIDER_WIDTH;

  const menuItems: MenuProps['items'] = [
    // ── ОПЕРАЦИИ ──
    ...(collapsed
      ? []
      : [{ type: 'group' as const, label: 'ОПЕРАЦИИ' }]),
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: <Link to="/dashboard">Дашборд</Link>,
    },
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'MANAGER')
      ? [{
        key: '/clients',
        icon: <TeamOutlined />,
        label: <Link to="/clients">Клиенты</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'WAREHOUSE', 'ACCOUNTANT', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/deals',
        icon: <FundProjectionScreenOutlined />,
        label: <Link to="/deals">Сделки</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN')
      ? [{
        key: '/finance/deal-closing',
        icon: <CheckCircleOutlined />,
        label: <Link to="/finance/deal-closing">Закрытие сделок</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/inventory/products',
        icon: <AppstoreOutlined />,
        label: <Link to="/inventory/products">Товары</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/inventory/warehouse',
        icon: <ShopOutlined />,
        label: <Link to="/inventory/warehouse">Склад</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/shipment',
        icon: <CarOutlined />,
        label: <Link to="/shipment">Отгрузка</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/stock-confirmation',
        icon: <CheckSquareOutlined />,
        label: <Link to="/stock-confirmation">Подтв. склада</Link>,
      }]
      : []),

    // ── ЗАДАЧИ ──
    { type: 'divider' as const },
    {
      key: '/tasks',
      icon: <ProjectOutlined />,
      label: <Link to="/tasks">Задачи</Link>,
    },

    // ── ФИНАНСЫ ──
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
      ? [
        { type: 'divider' as const },
        ...(collapsed
          ? []
          : [{ type: 'group' as const, label: 'ФИНАНСЫ' }]),
        {
          key: '/finance/debts',
          icon: <DollarOutlined />,
          label: <Link to="/finance/debts">Долги</Link>,
        },
        {
          key: '/finance/review',
          icon: <AuditOutlined />,
          label: <Link to="/finance/review">На проверке</Link>,
        },
        {
          key: '/finance/expenses',
          icon: <WalletOutlined />,
          label: <Link to="/finance/expenses">Расходы</Link>,
        },
      ]
      : []),

    // ── АРХИВ ──
    { type: 'divider' as const },
    ...(collapsed
      ? []
      : [{ type: 'group' as const, label: 'АРХИВ' }]),
    {
      key: '/deals/closed',
      icon: <ContainerOutlined />,
      label: <Link to="/deals/closed">Закрытые сделки</Link>,
    },
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/inventory/movements',
        icon: <SwapOutlined />,
        label: <Link to="/inventory/movements">Движение склада</Link>,
      }]
      : []),

    // ── АНАЛИТИКА ──
    ...(hasRole('SUPER_ADMIN', 'ADMIN')
      ? [
        { type: 'divider' as const },
        ...(collapsed
          ? []
          : [{ type: 'group' as const, label: 'АНАЛИТИКА' }]),
        {
          key: '/analytics',
          icon: <BarChartOutlined />,
          label: <Link to="/analytics">Аналитика</Link>,
        },
      ]
      : []),

    // ── СИСТЕМА ──
    ...(hasPermission('manage_users')
      ? [
        { type: 'divider' as const },
        ...(collapsed
          ? []
          : [{ type: 'group' as const, label: 'СИСТЕМА' }]),
        {
          key: '/users',
          icon: <UserOutlined />,
          label: <Link to="/users">Пользователи</Link>,
        },
        ...(isAdmin
          ? [{
            key: '/notifications/broadcast',
            icon: <SendOutlined />,
            label: <Link to="/notifications/broadcast">Рассылка</Link>,
          }]
          : []),
      ]
      : []),
    // ── Уведомления (все роли) ──
    ...(role !== 'OPERATOR' ? [{
      key: '/messages',
      icon: <MessageOutlined />,
      label: (
        <Link to="/messages">
          <span>Сообщения</span>
          {totalUnread > 0 && <Badge count={totalUnread} size="small" style={{ marginLeft: 8 }} />}
        </Link>
      ),
    }] : []),
    {
      key: '/notifications',
      icon: <BellOutlined />,
      label: <Link to="/notifications">Уведомления</Link>,
    },
  ];

  const selectedKey = '/' + location.pathname.split('/').slice(1, 3).join('/');

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={SIDER_WIDTH}
        collapsedWidth={SIDER_COLLAPSED_WIDTH}
        style={{
          background: themeToken.colorBgContainer,
          borderRight: `1px solid ${themeToken.colorBorderSecondary}`,
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'auto',
        }}
      >
        <Link
          to="/dashboard"
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
            textDecoration: 'none',
            padding: collapsed ? '0' : '0 20px',
          }}
        >
          <img
            src={collapsed ? miniLogo : logo}
            alt="Polygraph Business"
            style={{
              height: collapsed ? 36 : 78,
              marginTop: collapsed ? 0 : 28,
              transition: 'height 0.3s',
            }}
          />
        </Link>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          style={{ borderRight: 0, paddingTop: 12 }}
        />
      </Sider>

      <AntLayout style={{ marginLeft: siderWidth, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            padding: '0 24px',
            background: themeToken.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
            zIndex: 99,
            height: 56,
            lineHeight: '56px',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <NotificationBell />
            <Switch
              checkedChildren={<BulbOutlined />}
              unCheckedChildren={<BulbOutlined />}
              checked={mode === 'dark'}
              onChange={toggle}
              size="small"
            />
            <Typography.Text strong>{user?.fullName}</Typography.Text>
            <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
              Выход
            </Button>
          </div>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
