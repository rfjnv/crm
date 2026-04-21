import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Layout as AntLayout,
  Menu,
  Button,
  Typography,
  Switch,
  Badge,
  Drawer,
  theme,
  Dropdown,
  List,
  Tag,
  Space,
  Divider,
  Checkbox,
  Modal,
  Form,
  Select,
  DatePicker,
  Input,
  message,
} from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  FundProjectionScreenOutlined,
  ShopOutlined,
  SwapOutlined,
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
  IdcardOutlined,
  UserOutlined,
  DownOutlined,
  EditOutlined,
} from '@ant-design/icons';
import Icon from '@ant-design/icons';

const OpenAiSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);
const OpenAiIcon = (props: any) => <Icon component={OpenAiSvg} {...props} />;
import type { MenuProps } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth.api';
import { useThemeStore } from '../store/themeStore';
import { conversationsApi } from '../api/conversations.api';
import { tasksApi } from '../api/tasks.api';
import { notesBoardApi } from '../api/notes-board.api';
import { clientsApi } from '../api/clients.api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTableScrollFade } from '../hooks/useTableScrollFade';
import { APP_BUTTON } from './ui/AppClassNames';
import NotificationBell from './NotificationBell';
import NotificationPermissionBanner from './NotificationPermissionBanner';
import BottomTabBar from './BottomTabBar';
import logo from '../assets/logo.png';
import miniLogo from '../assets/mini-logo.png';
import type { UserRole, Permission, Task } from '../types';
import { DILNOZA_PAYMENT_METHOD_OPTIONS } from '../constants/dilnozaPayments';
import { smartFilterOption } from '../utils/translit';
import dayjs from 'dayjs';

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
  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>([]);
  const [quickTasksOpen, setQuickTasksOpen] = useState(false);
  const [selectedQuickTaskId, setSelectedQuickTaskId] = useState<string | null>(null);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNoteForm] = Form.useForm();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshToken, logout, setUser } = useAuthStore();
  const syncedProfileOnce = useRef(false);

  // Права и роль в меню берутся из localStorage; после правок в «Пользователях» подтягиваем актуальный профиль с сервера.
  useEffect(() => {
    if (!user || syncedProfileOnce.current) return;
    syncedProfileOnce.current = true;
    authApi
      .me()
      .then((fresh) => setUser(fresh))
      .catch(() => {
        syncedProfileOnce.current = false;
      });
  }, [user, setUser]);

  useEffect(() => {
    let lastFocusSync = 0;
    const onFocus = () => {
      if (!useAuthStore.getState().accessToken) return;
      const now = Date.now();
      if (now - lastFocusSync < 45_000) return;
      lastFocusSync = now;
      authApi.me().then((fresh) => setUser(fresh)).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [setUser]);
  const { mode, toggle } = useThemeStore();
  const { token: themeToken } = theme.useToken();
  const isMobile = useIsMobile();
  const mainScrollRef = useRef<HTMLDivElement>(null);
  useTableScrollFade(mainScrollRef);

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

  const profileMenuItems: MenuProps['items'] = [
    { key: 'profile', icon: <IdcardOutlined />, label: 'Профиль' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Выход', danger: true },
  ];

  const onProfileMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'profile') navigate('/profile');
    if (key === 'logout') void handleLogout();
  };

  const role = user?.role as UserRole | undefined;
  const isDilnoza = isDilnozaUser(user?.fullName, user?.login);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const hasPermission = (perm: string) => isAdmin || user?.permissions?.includes(perm as Permission);

  useEffect(() => {
    if (isAdmin && location.pathname.startsWith('/notifications')) {
      setMenuOpenKeys((prev) => (prev.includes('notifications-group') ? prev : [...prev, 'notifications-group']));
    }
  }, [location.pathname, isAdmin]);
  const canViewClosedDealsHistory =
    role === 'SUPER_ADMIN'
    || role === 'ADMIN'
    || (user?.permissions ?? []).includes('view_closed_deals_history' as Permission);

  const hasRole = (...roles: UserRole[]) => role ? roles.includes(role) : false;
  const canQuickNote = hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR');

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
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
    enabled: canQuickNote,
  });
  const { data: myTasks = [] } = useQuery({
    queryKey: ['quick-my-tasks', user?.id],
    queryFn: () => tasksApi.list({ assigneeId: user?.id }),
    enabled: Boolean(user?.id),
    refetchInterval: 30_000,
  });
  const hasMyTasks = myTasks.length > 0;
  const activeMyTasks = myTasks.filter((task) => task.status !== 'APPROVED');
  const quickTaskCount = activeMyTasks.length;
  const quickTaskList: Task[] = (activeMyTasks.length > 0 ? activeMyTasks : myTasks)
    .slice()
    .sort((a, b) => {
      const aDate = a.plannedDate || a.dueDate || a.createdAt;
      const bDate = b.plannedDate || b.dueDate || b.createdAt;
      return new Date(aDate).getTime() - new Date(bDate).getTime();
    })
    .slice(0, 8);
  const selectedQuickTask = quickTaskList.find((task) => task.id === selectedQuickTaskId) ?? quickTaskList[0] ?? null;
  const quickTaskChecklistMut = useMutation({
    mutationFn: ({ id, checklist }: { id: string; checklist: NonNullable<Task['checklist']> }) =>
      tasksApi.update(id, { checklist }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quick-my-tasks', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: () => message.error('Не удалось обновить чеклист'),
  });
  const quickNoteMut = useMutation({
    mutationFn: notesBoardApi.create,
    onSuccess: () => {
      message.success('Заметка сохранена');
      setQuickNoteOpen(false);
      quickNoteForm.resetFields();
    },
    onError: () => message.error('Не удалось сохранить заметку'),
  });

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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'MANAGER', 'HR')
      ? [{
        key: '/clients',
        icon: <TeamOutlined />,
        label: <Link to="/clients">Клиенты</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'OPERATOR')
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'WAREHOUSE', 'ACCOUNTANT', 'WAREHOUSE_MANAGER')
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
    ...(hasRole('WAREHOUSE', 'LOADER') && !hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/warehouse-manager-incoming',
        icon: <InboxOutlined />,
        label: <Link to="/warehouse-manager">Входящие к админу</Link>,
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR')
      ? [{
        key: '/notes-board',
        icon: <ContainerOutlined />,
        label: <Link to="/notes-board">Заметки</Link>,
      }]
      : []),

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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER')
      ? [{
        key: '/finance/balance',
        icon: <DollarOutlined />,
        label: <Link to="/finance/balance">Баланс компании</Link>,
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR')
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels
          ? [{ type: 'group' as const, label: 'АНАЛИТИКА' }]
          : []),
        {
          key: '/manager/client-activity',
          icon: <CalendarOutlined />,
          label: <Link to="/manager/client-activity">Аналитика для менеджеров</Link>,
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
            {
              key: '/analytics/price-comparison',
              icon: <BarChartOutlined />,
              label: <Link to="/analytics/price-comparison">Сравнение цен</Link>,
            },
          ]
          : []),
      ]
      : []),

    // ── СИСТЕМА (профиль и команда — у всех; рассылка/настройки — у админов) ──
    { type: 'divider' as const },
    ...(showGroupLabels
      ? [{ type: 'group' as const, label: 'СИСТЕМА' }]
      : []),
    {
      key: '/profile',
      icon: <IdcardOutlined />,
      label: <Link to="/profile">Профиль</Link>,
    },
    {
      key: '/team',
      icon: <TeamOutlined />,
      label: <Link to="/team">Команда</Link>,
    },
    ...(isAdmin
      ? [
          {
            key: '/users',
            icon: <UserOutlined />,
            label: <Link to="/users">Пользователи</Link>,
          },
        ]
      : []),
    ...(isAdmin && hasPermission('manage_users')
      ? [{
          key: '/settings/company',
          icon: <SettingOutlined />,
          label: <Link to="/settings/company">Настройки</Link>,
        }]
      : []),
    // ── AI-ассистент ──
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR')
      ? [{
        key: '/ai-assistant',
        icon: <OpenAiIcon />,
        label: <Link to="/ai-assistant">AI Ассистент</Link>,
      }]
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
    ...(isAdmin
      ? [{
          key: 'notifications-group',
          icon: <BellOutlined />,
          label: 'Уведомления',
          children: [
            {
              key: '/notifications',
              label: <Link to="/notifications">Лента</Link>,
            },
            {
              key: '/notifications/broadcast',
              icon: <SendOutlined />,
              label: <Link to="/notifications/broadcast">Рассылка</Link>,
            },
          ],
        }]
      : [{
          key: '/notifications',
          icon: <BellOutlined />,
          label: <Link to="/notifications">Уведомления</Link>,
        }]),
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
        openKeys={menuOpenKeys}
        onOpenChange={setMenuOpenKeys}
        items={menuItems}
        style={{ borderRight: 0, paddingTop: 12 }}
      />
    </>
  );

  return (
    <AntLayout style={{ minHeight: 'var(--app-vh, 100vh)', minWidth: 0 }}>
      {isMobile ? (
        <Drawer
          placement="left"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          width={260}
          styles={{ body: { padding: 0 } }}
        >
          {menuContent}
          <div style={{ padding: 'var(--space-3)', borderTop: `1px solid ${themeToken.colorBorderSecondary}` }}>
            <Dropdown
              menu={{ items: profileMenuItems, onClick: onProfileMenuClick }}
              trigger={['click']}
              placement="topLeft"
            >
              <Button type="text" className={APP_BUTTON} icon={<IdcardOutlined />} block style={{ justifyContent: 'flex-start' }}>
                {user?.fullName ?? 'Профиль'}
                <DownOutlined style={{ fontSize: 10, marginLeft: 'auto' }} />
              </Button>
            </Dropdown>
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
          minWidth: 0,
          transition: 'margin-left 0.2s',
          ...({ '--app-sider-width': isMobile ? '0px' : `${siderWidth}px` } as CSSProperties),
        }}
      >
        <Header
          style={{
            padding: isMobile ? `0 var(--space-3)` : '0 24px',
            paddingTop: isMobile ? 'max(env(safe-area-inset-top, 0px), 0px)' : undefined,
            background: themeToken.colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
            zIndex: 99,
            minHeight: isMobile ? 'calc(56px + env(safe-area-inset-top, 0px))' : 56,
            height: isMobile ? undefined : 56,
            lineHeight: isMobile ? undefined : '56px',
          }}
        >
          {isMobile ? (
            <Button
              type="text"
              className={APP_BUTTON}
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            />
          ) : (
            <Button
              type="text"
              className={APP_BUTTON}
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
            {!isMobile && (
              <Dropdown
                menu={{ items: profileMenuItems, onClick: onProfileMenuClick }}
                trigger={['click']}
                placement="bottomRight"
              >
                <Button type="text" className={APP_BUTTON} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 280 }}>
                  <Typography.Text strong ellipsis style={{ maxWidth: 220 }}>
                    {user?.fullName ?? 'Профиль'}
                  </Typography.Text>
                  <DownOutlined style={{ fontSize: 10 }} />
                </Button>
              </Dropdown>
            )}
          </div>
        </Header>
        <Content
          className={isMobile ? 'app-main-content app-main-content--mobile-shell' : 'app-main-content'}
          style={{
            margin: isMobile ? 0 : 24,
            paddingLeft: isMobile ? 0 : undefined,
            paddingRight: isMobile ? 0 : undefined,
            paddingTop: isMobile ? 0 : undefined,
            paddingBottom: isMobile ? undefined : 0,
            minWidth: 0,
            background: isMobile ? 'transparent' : undefined,
          }}
        >
          {isMobile && <div className="top-hero" aria-hidden />}
          <div
            ref={mainScrollRef}
            className={isMobile ? 'main-scroll-wrap' : undefined}
            style={{ minWidth: 0 }}
          >
            {isMobile ? (
              <div className="main-container">
                <Outlet />
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </Content>
        <NotificationPermissionBanner />
      </AntLayout>

      {canQuickNote && (
        <>
          <Button
            type="default"
            icon={<EditOutlined />}
            onClick={() => {
              quickNoteForm.setFieldsValue({
                callResult: 'ANSWERED',
                lastCallAt: dayjs(),
              });
              setQuickNoteOpen(true);
            }}
            style={{
              position: 'fixed',
              right: 16,
              bottom: (isMobile ? 92 : 24) + (hasMyTasks ? 56 : 0),
              zIndex: 1200,
              borderRadius: 999,
              boxShadow: themeToken.boxShadowSecondary,
            }}
          >
            Заметка
          </Button>

          <Modal
            title="Быстрая заметка"
            open={quickNoteOpen}
            onCancel={() => setQuickNoteOpen(false)}
            onOk={() => quickNoteForm.submit()}
            confirmLoading={quickNoteMut.isPending}
            okText="Сохранить"
            cancelText="Отмена"
          >
            <Form
              form={quickNoteForm}
              layout="vertical"
              onFinish={(v) => {
                quickNoteMut.mutate({
                  clientId: v.clientId,
                  callResult: v.callResult,
                  status: v.status?.trim() || undefined,
                  comment: (v.comment || '').trim(),
                  lastCallAt: v.lastCallAt.toISOString(),
                  nextCallAt: v.nextCallAt ? v.nextCallAt.toISOString() : null,
                });
              }}
            >
              <Form.Item name="clientId" label="Клиент" rules={[{ required: true, message: 'Выберите клиента' }]}>
                <Select
                  showSearch
                  filterOption={smartFilterOption}
                  placeholder="Выберите клиента"
                  options={clients.map((c) => ({ value: c.id, label: c.companyName }))}
                />
              </Form.Item>
              <Form.Item name="callResult" label="Дозвон" rules={[{ required: true, message: 'Выберите статус дозвона' }]}>
                <Select
                  options={[
                    { value: 'ANSWERED', label: 'Взял трубку' },
                    { value: 'NO_ANSWER', label: 'Не взял' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="lastCallAt" label="Дата обзвона" rules={[{ required: true, message: 'Укажите дату' }]}>
                <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
              </Form.Item>
              <Form.Item name="nextCallAt" label="Напомнить на дату">
                <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
              </Form.Item>
              <Form.Item name="status" label="Статус">
                <Input placeholder="Например: Пока думает" />
              </Form.Item>
              <Form.Item name="comment" label="Комментарий" rules={[{ required: true, message: 'Введите комментарий' }]}>
                <Input.TextArea rows={4} placeholder="Введите заметку..." />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}

      {hasMyTasks && (
        <>
          <Button
            type="primary"
            icon={<ProjectOutlined />}
            onClick={() => {
              setSelectedQuickTaskId(quickTaskList[0]?.id ?? null);
              setQuickTasksOpen(true);
            }}
            style={{
              position: 'fixed',
              right: 16,
              bottom: isMobile ? 92 : 24,
              zIndex: 1200,
              borderRadius: 999,
              boxShadow: themeToken.boxShadowSecondary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            Мои задачи
            <Badge
              count={quickTaskCount}
              showZero
              style={{ backgroundColor: '#fff', color: themeToken.colorPrimary, marginInlineStart: 4 }}
            />
          </Button>

          <Drawer
            title="Быстрый доступ к задачам"
            placement="right"
            open={quickTasksOpen}
            onClose={() => setQuickTasksOpen(false)}
            width={isMobile ? '100%' : 420}
            extra={(
              <Button
                size="small"
                onClick={() => {
                  setQuickTasksOpen(false);
                  navigate('/tasks');
                }}
              >
                Все задачи
              </Button>
            )}
          >
            <List
              dataSource={quickTaskList}
              locale={{ emptyText: 'Задач нет' }}
              renderItem={(task) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    borderRadius: 10,
                    paddingInline: 8,
                    background: selectedQuickTask?.id === task.id ? themeToken.colorPrimaryBg : undefined,
                  }}
                  onClick={() => setSelectedQuickTaskId(task.id)}
                >
                  <List.Item.Meta
                    title={<Typography.Text strong>{task.title}</Typography.Text>}
                    description={(
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {task.plannedDate
                          ? `План: ${dayjs(task.plannedDate).format('DD.MM.YYYY')}`
                          : task.dueDate
                            ? `Срок: ${dayjs(task.dueDate).format('DD.MM.YYYY')}`
                            : 'Без даты'}
                      </Typography.Text>
                    )}
                  />
                </List.Item>
              )}
            />
            {selectedQuickTask && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <Typography.Text strong style={{ fontSize: 16, lineHeight: 1.3 }}>
                      {selectedQuickTask.title}
                    </Typography.Text>
                    <Tag color={selectedQuickTask.status === 'IN_PROGRESS' ? 'processing' : selectedQuickTask.status === 'DONE' ? 'warning' : 'default'}>
                      {selectedQuickTask.status === 'TODO' ? 'К выполнению' : selectedQuickTask.status === 'IN_PROGRESS' ? 'В работе' : selectedQuickTask.status === 'DONE' ? 'Готово' : 'Утверждено'}
                    </Tag>
                  </div>
                  {selectedQuickTask.description ? (
                    <Typography.Text>{selectedQuickTask.description}</Typography.Text>
                  ) : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Исполнитель: {selectedQuickTask.assignee?.fullName || '—'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Постановщик: {selectedQuickTask.createdBy?.fullName || '—'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {selectedQuickTask.plannedDate
                      ? `План: ${dayjs(selectedQuickTask.plannedDate).format('DD.MM.YYYY')}`
                      : selectedQuickTask.dueDate
                        ? `Срок: ${dayjs(selectedQuickTask.dueDate).format('DD.MM.YYYY')}`
                        : 'Без даты'}
                  </Typography.Text>
                  <Divider style={{ margin: '8px 0' }}>Чеклист</Divider>
                  {selectedQuickTask.checklist?.length ? (
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {selectedQuickTask.checklist.map((item, idx) => (
                        <Checkbox
                          key={`${selectedQuickTask.id}-${idx}-${item.text}`}
                          checked={item.checked}
                          disabled={quickTaskChecklistMut.isPending}
                          onChange={(e) => {
                            const current = selectedQuickTask.checklist || [];
                            const nextChecklist = current.map((entry, entryIdx) =>
                              entryIdx === idx ? { ...entry, checked: e.target.checked } : entry,
                            );
                            quickTaskChecklistMut.mutate({ id: selectedQuickTask.id, checklist: nextChecklist });
                          }}
                        >
                          {item.text}
                        </Checkbox>
                      ))}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">Чеклист не добавлен.</Typography.Text>
                  )}
                </Space>
              </>
            )}
          </Drawer>
        </>
      )}

      {isMobile && (
        <BottomTabBar />
      )}
    </AntLayout>
  );
}
