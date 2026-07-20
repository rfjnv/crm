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
  HistoryOutlined,
  EyeOutlined,
  UserOutlined,
  DownOutlined,
  SoundOutlined,
  StopOutlined,
  ClockCircleOutlined,
  NodeIndexOutlined,
  GlobalOutlined,
  FileTextOutlined,
  ImportOutlined,
  MergeCellsOutlined,
  RobotOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import Icon from '@ant-design/icons';

const OpenAiSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);
const OpenAiIcon = (props: any) => <Icon component={OpenAiSvg} {...props} />;
import type { MenuProps } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth.api';
import { enrichUserFromMe, isSiteAdminUser } from '../lib/authUser';
import { useThemeStore } from '../store/themeStore';
import { conversationsApi } from '../api/conversations.api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTableScrollFade } from '../hooks/useTableScrollFade';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { APP_BUTTON } from './ui/AppClassNames';
import NotificationBell from './NotificationBell';
import NotificationPermissionBanner from './NotificationPermissionBanner';
import BottomTabBar from './BottomTabBar';
import logo from '../assets/logo.png';
import miniLogo from '../assets/mini-logo.png';
import type { UserRole, Permission } from '../types';

const { Header, Sider, Content } = AntLayout;

const SIDER_WIDTH = 220;
const SIDER_COLLAPSED_WIDTH = 64;

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuOpenKeys, setMenuOpenKeys] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, setUser } = useAuthStore();
  const syncedProfileOnce = useRef(false);

  // Права и роль в меню берутся из localStorage; после правок в «Пользователях» подтягиваем актуальный профиль с сервера.
  useEffect(() => {
    if (!user || isSiteAdminUser(user) || syncedProfileOnce.current) return;
    syncedProfileOnce.current = true;
    authApi
      .me()
      .then((fresh) => setUser(enrichUserFromMe(fresh, user)))
      .catch(() => {
        syncedProfileOnce.current = false;
      });
  }, [user, setUser]);

  useEffect(() => {
    let lastFocusSync = 0;
    const onFocus = () => {
      const current = useAuthStore.getState().user;
      if (!useAuthStore.getState().accessToken || isSiteAdminUser(current)) return;
      const now = Date.now();
      if (now - lastFocusSync < 45_000) return;
      lastFocusSync = now;
      authApi.me().then((fresh) => setUser(enrichUserFromMe(fresh, current))).catch(() => {});
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

  // Safety-net: guarantee the space key works inside Select/AutoComplete/TreeSelect
  // search inputs (role="combobox"). Rc-select 1.6.10+ already fixes this, but we
  // also neutralize any downstream preventDefault in case a custom handler swallows it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (e.key !== ' ') return;
      if (target.tagName !== 'INPUT') return;
      if (target.getAttribute('role') !== 'combobox') return;
      if ((target as HTMLInputElement).readOnly) return;
      e.preventDefault = () => {};
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Hotkey: Enter confirms the topmost open modal or popconfirm (clicks its
  // primary/OK button), Esc cancels the topmost open popconfirm (clicks its
  // cancel button). Both are skipped while focus is in a textarea/dropdown
  // where the key already has a meaning. Esc-to-close is already native to
  // antd Modal/Drawer, so only popconfirm needs explicit Esc handling here.
  useEffect(() => {
    const findTopVisible = (selector: string) => {
      const nodes = document.querySelectorAll<HTMLElement>(selector);
      let top: HTMLElement | null = null;
      nodes.forEach((node) => {
        if (node.style.display !== 'none') top = node;
      });
      return top;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      if (e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const openDropdown = document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden), ' +
        '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden), ' +
        '.ant-dropdown:not(.ant-dropdown-hidden), ' +
        '.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)'
      );
      if (openDropdown) return;

      const topPopconfirm = findTopVisible('.ant-popover.ant-popconfirm');
      if (topPopconfirm) {
        const btn = topPopconfirm.querySelector<HTMLButtonElement>(
          e.key === 'Enter' ? '.ant-popconfirm-buttons button.ant-btn-primary' : '.ant-popconfirm-buttons button:not(.ant-btn-primary)'
        );
        if (!btn || btn.disabled || btn.classList.contains('ant-btn-loading')) return;
        e.preventDefault();
        btn.click();
        return;
      }

      if (e.key !== 'Enter' || e.shiftKey) return;
      const topModal = findTopVisible('.ant-modal-wrap');
      if (!topModal) return;
      const confirmBtn = topModal.querySelector<HTMLButtonElement>('.ant-modal-footer button.ant-btn-primary');
      if (!confirmBtn || confirmBtn.disabled || confirmBtn.classList.contains('ant-btn-loading')) return;
      e.preventDefault();
      confirmBtn.click();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

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
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const hasPermission = (perm: string) => isAdmin || user?.permissions?.includes(perm as Permission);
  const canViewClients = hasPermission('view_all_clients');

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

  // Presence ping
  useEffect(() => {
    conversationsApi.ping();
    const interval = setInterval(() => conversationsApi.ping(), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Время в системе / просмотры страниц — для «Журнала действий» (только реальная активность, не просто открытая вкладка)
  useActivityTracking();

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
    ...(canViewClients
      ? [{
        key: '/clients',
        icon: <TeamOutlined />,
        label: <Link to="/clients">Клиенты</Link>,
      }]
      : []),
    ...(hasRole('SUPER_ADMIN', 'ADMIN')
      ? [{
        key: '/clients/duplicates',
        icon: <MergeCellsOutlined />,
        label: <Link to="/clients/duplicates">Дубликаты</Link>,
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
    ...((hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'WAREHOUSE', 'WAREHOUSE_MANAGER')
      || hasPermission('manage_products'))
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
        icon: <FileTextOutlined />,
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

    // ── АЛЬМАНАХ ──
    { type: 'divider' as const },
    ...(showGroupLabels ? [{ type: 'group' as const, label: 'АЛЬМАНАХ' }] : []),
    {
      key: 'almanac-group',
      icon: <ReadOutlined />,
      label: 'Альманах',
      children: [
        {
          key: '/almanac/sales',
          disabled: true,
          label: 'Продажи',
        },
        {
          key: '/almanac/clients',
          disabled: true,
          label: 'Клиенты',
        },
        {
          key: '/almanac/products',
          label: <Link to="/almanac/products">Товары</Link>,
        },
        {
          key: '/almanac/debts',
          disabled: true,
          label: 'Долги',
        },
      ],
    },

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

    // ── ВЭД ──
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'FOREIGN_TRADE', 'ACCOUNTANT') || hasPermission('view_import_orders')
      ? [
        { type: 'divider' as const },
        ...(showGroupLabels ? [{ type: 'group' as const, label: 'ВЭД' }] : []),
        {
          key: '/foreign-trade/suppliers',
          icon: <ImportOutlined />,
          label: <Link to="/foreign-trade/suppliers">Поставщики</Link>,
        },
        {
          key: '/foreign-trade/map',
          icon: <GlobalOutlined />,
          label: <Link to="/foreign-trade/map">Карта ВЭД</Link>,
        },
        {
          key: '/foreign-trade/import-orders',
          icon: <InboxOutlined />,
          label: <Link to="/foreign-trade/import-orders">Импорт-заказы</Link>,
        },
        {
          key: '/foreign-trade/process-board',
          icon: <NodeIndexOutlined />,
          label: <Link to="/foreign-trade/process-board">Трекинг и документы</Link>,
        },
        {
          key: '/foreign-trade/exchange-rates',
          icon: <DollarOutlined />,
          label: <Link to="/foreign-trade/exchange-rates">Курсы ЦБ</Link>,
        },
      ]
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
        key: '/deals/audit-check',
        icon: <AuditOutlined />,
        label: <Link to="/deals/audit-check">Аудит-проверка</Link>,
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
          key: '/manager/reanimation',
          icon: <SoundOutlined />,
          label: <Link to="/manager/reanimation">Реанимация</Link>,
        },
        {
          key: '/manager/dead-products',
          icon: <StopOutlined />,
          label: <Link to="/manager/dead-products">Мёртвые товары</Link>,
        },
        {
          key: '/manager/payment-overdue',
          icon: <ClockCircleOutlined />,
          label: <Link to="/manager/payment-overdue">Просрочка</Link>,
        },
        {
          key: '/analytics/calls',
          icon: <PhoneOutlined />,
          label: <Link to="/analytics/calls">Обзвоны</Link>,
        },
        ...(hasRole('SUPER_ADMIN', 'ADMIN')
          ? [{
              key: '/analytics/contact-matrix',
              icon: <NodeIndexOutlined />,
              label: <Link to="/analytics/contact-matrix">Матрица контактов</Link>,
            },
            {
              key: '/analytics/note-audit',
              icon: <RobotOutlined />,
              label: <Link to="/analytics/note-audit">AI Аудит заметок</Link>,
            }]
          : []),
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
              key: '/analytics/market',
              icon: <GlobalOutlined />,
              label: <Link to="/analytics/market">Анализ рынка</Link>,
            },
            {
              key: '/analytics/department-report',
              icon: <FileTextOutlined />,
              label: <Link to="/analytics/department-report">Отчёт отдела</Link>,
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
      key: '/changelog',
      icon: <HistoryOutlined />,
      label: <Link to="/changelog">Обновления</Link>,
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
            label: <Link to="/users">Сотрудники CRM</Link>,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            key: '/worker-audit',
            icon: <AuditOutlined />,
            label: <Link to="/worker-audit">Аудит сотрудников</Link>,
          },
        ]
      : []),
    ...(hasRole('SUPER_ADMIN')
      ? [
          {
            key: '/admin/activity-log',
            icon: <EyeOutlined />,
            label: <Link to="/admin/activity-log">Журнал действий</Link>,
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
    ...(hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'FOREIGN_TRADE')
      ? [
        {
          key: '/ai-assistant',
          icon: <OpenAiIcon />,
          label: <Link to="/ai-assistant">AI Ассистент</Link>,
        },
        {
          key: '/ai-assistant/transcribe',
          icon: <SoundOutlined />,
          label: <Link to="/ai-assistant/transcribe">Аудио в текст</Link>,
        },
        {
          key: '/ai-assistant/call-audits',
          icon: <PhoneOutlined />,
          label: <Link to="/ai-assistant/call-audits">История аудитов</Link>,
        },
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

  const selectedDilnoza = '/' + location.pathname.split('/').slice(1, 3).join('/');

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
        {user?.company?.name === 'grand-astra' ? (
          <span style={{
            fontWeight: 700,
            fontSize: (!isMobile && collapsed) ? 11 : 16,
            color: themeToken.colorPrimary,
            letterSpacing: 0.5,
            transition: 'all 0.3s',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {(!isMobile && collapsed) ? 'GA' : 'Grand Astra'}
          </span>
        ) : (
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
        )}
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

      {isMobile && (
        <BottomTabBar />
      )}
    </AntLayout>
  );
}
