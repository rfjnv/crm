import { useState, useEffect, type CSSProperties } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Typography, Switch, Badge, Drawer, theme } from 'antd';
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
  MenuOutlined,
  BulbOutlined,
  ContainerOutlined,
  DollarOutlined,
  BarChartOutlined,
  FieldTimeOutlined,
  CalendarOutlined,
  AppstoreOutlined,
  BellOutlined,
  SendOutlined,
  AuditOutlined,
  CarOutlined,
  TruckOutlined,
  CheckSquareOutlined,
  MessageOutlined,
  WalletOutlined,
  InboxOutlined,
  ProjectOutlined,
  SolutionOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { authApi } from '../api/auth.api';
import { conversationsApi } from '../api/conversations.api';
import { useIsMobile } from '../hooks/useIsMobile';
import NotificationBell from './NotificationBell';
import NotificationPermissionBanner from './NotificationPermissionBanner';
import BottomTabBar from './BottomTabBar';
import { mobileMainContentBottomPadding } from '../config/mobileBottomNav';
import logo from '../assets/logo.png';
import miniLogo from '../assets/mini-logo.png';
import type { UserRole, Permission } from '../types';
import { DILNOZA_PAYMENT_METHOD_OPTIONS } from '../constants/dilnozaPayments';

const { Header, Sider, Content } = AntLayout;

const SIDER_WIDTH = 220;
const SIDER_COLLAPSED_WIDTH = 64;

function isDilnozaUser(fullName?: string, login?: string): boolean {
  const f = (fullName || '').trim().toLowerCase();
  const l = (login || '').trim().toLowerCase();
  return f === 'dilnoza' || f.includes('дилноза') || l === 'dilnoza';
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshToken, logout } = useAuthStore();
  const { mode, toggle } = useThemeStore();
  const { token: themeToken } = theme.useToken();
  const isMobile = useIsMobile();

  // Close mobile drawer on navigation
  useEffect(() => {
    if (isMobile) setMobileMenuOpen(false);
  }, [location.pathname, isMobile]);

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  const role = user?.role as UserRole | undefined;
  const isDilnoza = isDilnozaUser(user?.fullName, user?.login);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const hasPermission = (perm: string) => isAdmin || user?.permissions?.includes(perm as Permission);
  const canViewClosedDealsHistory =
    role === 'SUPER_ADMIN'
    || role === 'ADMIN'
    || (user?.permissions ?? []).includes('view_closed_deals_history' as Permission);

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
  const showGroupLabels = isMobile || !collapsed;

  const menuItems: MenuProps['items'] = [
    // ── ОПЕРАЦИИ ──
    ...(showGroupLabels
      ? [{ type: 'group' as const, label: 'ОПЕРАЦИИ' }]
      : []),
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR')
      ? [{
        key: '/reviews',
        icon: <StarOutlined />,
        label: <Link to="/reviews">Отзывы</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT')
      ? [{
        key: '/contracts',
        icon: <SolutionOutlined />,
        label: <Link to="/contracts">Договоры</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
      ? [{
        key: '/power-of-attorney',
        icon: <SolutionOutlined />,
        label: <Link to="/power-of-attorney">Доверенности</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'WAREHOUSE', 'ACCOUNTANT', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/deals',
        icon: <FundProjectionScreenOutlined />,
        label: <Link to="/deals">{role === 'MANAGER' ? 'Заявки' : 'Сделки'}</Link>,
      }]
      : []),
    ...(isDilnoza && hasRole('MANAGER')
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels ? [{ type: 'group' as const, label: 'СДЕЛКИ (DILNOZA)' }] : []),
        ...DILNOZA_PAYMENT_METHOD_OPTIONS.map(({ value, label }) => ({
          key: `/deals?dilnozaPayment=${value}`,
          icon: <WalletOutlined />,
          label: <Link to={`/deals?dilnozaPayment=${value}`}>{label}</Link>,
        })),
        {
          key: '/deals?dilnozaPayment=ACCOUNTING',
          icon: <AuditOutlined />,
          label: <Link to="/deals?dilnozaPayment=ACCOUNTING">Бухгалтерия</Link>,
        },
      ]
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/shipment',
        icon: <TruckOutlined />,
        label: <Link to="/shipment">Накладные</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER', 'LOADER')
      ? [{
        key: '/stock-confirmation',
        icon: <CheckSquareOutlined />,
        label: <Link to="/stock-confirmation">Подтв. склада</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN')
      ? [{
        key: '/deals/approval',
        icon: <SafetyCertificateOutlined />,
        label: <Link to="/deals/approval">Одобрение</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/warehouse-manager',
        icon: <AppstoreOutlined />,
        label: <Link to="/warehouse-manager">Зав. склада</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE', 'DRIVER', 'LOADER')
      ? [{
        key: '/my-loading-tasks',
        icon: <CheckSquareOutlined />,
        label: <Link to="/my-loading-tasks">Мои отгрузки</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER', 'DRIVER')
      ? [{
        key: '/my-vehicle',
        icon: <CarOutlined />,
        label: <Link to="/my-vehicle">Моя машина</Link>,
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT') || hasPermission('manage_expenses')
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels
          ? [{ type: 'group' as const, label: 'ФИНАНСЫ' }]
          : []),
      ]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
      ? [
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
      ]
      : []),
    ...(hasPermission('manage_expenses')
      ? [
        {
          key: '/finance/expenses',
          icon: <WalletOutlined />,
          label: <Link to="/finance/expenses">Расходы</Link>,
        },
      ]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'OPERATOR')
      ? [{
        key: '/finance/cashbox',
        icon: <DollarOutlined />,
        label: <Link to="/finance/cashbox">Касса</Link>,
      }]
      : []),

    // ── Сделки: история закрытых / архив (скрытые) ──
    ...(canViewClosedDealsHistory || isAdmin
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels
          ? [{ type: 'group' as const, label: 'СДЕЛКИ — АРХИВ' }]
          : []),
      ]
      : []),
    ...(canViewClosedDealsHistory
      ? [{
        key: '/deals/closed',
        icon: <ContainerOutlined />,
        label: <Link to="/deals/closed">История закрытых сделок</Link>,
      }]
      : []),
    ...(isAdmin
      ? [{
        key: '/deals/archived',
        icon: <InboxOutlined />,
        label: <Link to="/deals/archived">Архив сделок</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/inventory/movements',
        icon: <SwapOutlined />,
        label: <Link to="/inventory/movements">Движение склада</Link>,
      }]
      : []),

    // ── АНАЛИТИКА ──
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER')
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels
          ? [{ type: 'group' as const, label: 'АНАЛИТИКА' }]
          : []),
        {
          key: '/manager/client-activity',
          icon: <CalendarOutlined />,
          label: <Link to="/manager/client-activity">Матрица активности клиентов</Link>,
        },
        {
          key: '/analytics/calls',
          icon: <PhoneOutlined />,
          label: <Link to="/analytics/calls">Обзвоны</Link>,
        },
        ...(hasRole('SUPER_ADMIN', 'ADMIN')
          ? [
            {
              key: '/analytics',
              icon: <BarChartOutlined />,
              label: <Link to="/analytics">Аналитика</Link>,
            },
            {
              key: '/history-analytics',
              icon: <FieldTimeOutlined />,
              label: <Link to="/history-analytics">Аналитика (история)</Link>,
            },
          ]
          : []),
      ]
      : []),

    // ── СИСТЕМА ──
    ...(hasPermission('manage_users')
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels
          ? [{ type: 'group' as const, label: 'СИСТЕМА' }]
          : []),
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
          },
          {
            key: '/settings/company',
            icon: <SettingOutlined />,
            label: <Link to="/settings/company">Настройки</Link>,
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

  const selectedPath = '/' + location.pathname.split('/').slice(1, 3).join('/');
  const selectedDilnoza = location.pathname === '/deals' && location.search.includes('dilnozaPayment=')
    ? `/deals?dilnozaPayment=${new URLSearchParams(location.search).get('dilnozaPayment')}`
    : selectedPath;

  const menuContent = (
    <>
      <Link
        to="/dashboard"
        style={{
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'flex-start' : (collapsed ? 'center' : 'flex-start'),
          borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
          textDecoration: 'none',
          padding: (!isMobile && collapsed) ? '0' : '0 14px',
          overflow: 'hidden',
          position: 'sticky',
          top: 0,
          zIndex: 101,
          background: themeToken.colorBgContainer,
        }}
      >
        <img
          src={(!isMobile && collapsed) ? miniLogo : logo}
          alt="Polygraph Business"
          style={{
            height: (!isMobile && collapsed) ? 40 : 52,
            maxWidth: (!isMobile && collapsed) ? 48 : 192,
            objectFit: 'contain',
            transition: 'all 0.3s',
          }}
        />
      </Link>
      <Menu
        mode="inline"
        selectedKeys={[selectedDilnoza]}
        items={menuItems}
        style={{ borderRight: 0, paddingTop: 12 }}
      />
    </>
  );

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          width={260}
          styles={{ body: { padding: 0 } }}
        >
          {menuContent}
          <div style={{ padding: '16px', borderTop: `1px solid ${themeToken.colorBorderSecondary}` }}>
            <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout} block>
              Выход
            </Button>
          </div>
        </Drawer>
      ) : (
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
          {menuContent}
        </Sider>
      )}

      <AntLayout
        style={{
          marginLeft: isMobile ? 0 : siderWidth,
          transition: 'margin-left 0.2s',
          ...({ '--app-sider-width': isMobile ? '0px' : `${siderWidth}px` } as CSSProperties),
        }}
      >
        <Header
          style={{
            padding: isMobile ? '0 12px' : '0 24px',
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
          {isMobile ? (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
            />
          ) : (
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
            <NotificationBell />
            <Switch
              checkedChildren={<BulbOutlined />}
              unCheckedChildren={<BulbOutlined />}
              checked={mode === 'dark'}
              onChange={toggle}
              size="small"
            />
            {!isMobile && <Typography.Text strong>{user?.fullName}</Typography.Text>}
            {!isMobile && (
              <Button type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
                Выход
              </Button>
            )}
          </div>
        </Header>
        <Content
          style={{
            margin: isMobile ? 12 : 24,
            paddingBottom: isMobile ? mobileMainContentBottomPadding() : 0,
          }}
        >
          <Outlet />
        </Content>
        <NotificationPermissionBanner />
      </AntLayout>

      {isMobile && (
        <BottomTabBar />
      )}
    </AntLayout>
  );
}
