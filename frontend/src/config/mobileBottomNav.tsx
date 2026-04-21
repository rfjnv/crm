import type { ComponentType, CSSProperties } from 'react';
import {
  DashboardOutlined,
  FundProjectionScreenOutlined,
  TeamOutlined,
  ShopOutlined,
  BarChartOutlined,
  ProjectOutlined,
  StarOutlined,
  SolutionOutlined,
  AuditOutlined,
  DollarOutlined,
  CheckSquareOutlined,
  TruckOutlined,
  AppstoreOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import type { UserRole, Permission } from '../types';

export type MobileNavIcon = ComponentType<{ style?: CSSProperties }>;

export interface MobileNavItem {
  path: string;
  label: string;
  Icon: MobileNavIcon;
  /** Shown in docs / debug only */
  rationale?: string;
}

type NavCtx = {
  role: UserRole;
  isAdmin: boolean;
  hasPermission: (p: Permission) => boolean;
};

function hasRole(role: UserRole | undefined, ...allowed: UserRole[]): boolean {
  return role ? allowed.includes(role) : false;
}

/**
 * Role-based primary mobile destinations (max 5). Rules mirror `Layout.tsx` sidebar access.
 * Order = daily frequency for that persona; rare items stay in the drawer menu.
 */
export function getMobileBottomNavItems(ctx: NavCtx): MobileNavItem[] {
  const { role, isAdmin, hasPermission } = ctx;

  const dealsRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'WAREHOUSE', 'ACCOUNTANT', 'WAREHOUSE_MANAGER'];
  const clientsRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'MANAGER', 'HR'];
  const productsRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'WAREHOUSE', 'WAREHOUSE_MANAGER'];
  const warehouseRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER'];

  const dealsLabel = role === 'MANAGER' ? 'Заявки' : 'Сделки';

  // ── OPERATOR: no deals/products/warehouse in sidebar — front office + cashbox
  if (role === 'OPERATOR') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Сводка дня' },
      { path: '/clients', label: 'Клиенты', Icon: TeamOutlined, rationale: 'Основная работа оператора' },
      { path: '/reviews', label: 'Отзывы', Icon: StarOutlined, rationale: 'Бот-отзывы из меню' },
      { path: '/tasks', label: 'Задачи', Icon: ProjectOutlined, rationale: 'Операционные задачи' },
      { path: '/finance/cashbox', label: 'Касса', Icon: DollarOutlined, rationale: 'Единственный фин. пункт в меню' },
    ];
  }

  // ── ACCOUNTANT
  if (role === 'ACCOUNTANT') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Контекст' },
      { path: '/deals', label: dealsLabel, Icon: FundProjectionScreenOutlined, rationale: 'Сделки / оплаты' },
      { path: '/contracts', label: 'Договоры', Icon: SolutionOutlined, rationale: 'Юр. блок' },
      { path: '/finance/review', label: 'Проверка', Icon: AuditOutlined, rationale: 'Очередь «На проверке»' },
      { path: '/finance/debts', label: 'Долги', Icon: DollarOutlined, rationale: 'Задолженность' },
    ];
  }

  // ── WAREHOUSE (без отгрузки менеджера)
  if (role === 'WAREHOUSE') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Проблемные остатки' },
      { path: '/deals', label: dealsLabel, Icon: FundProjectionScreenOutlined, rationale: 'Статусы для комплектации' },
      { path: '/warehouse-manager', label: 'Входящие', Icon: InboxOutlined, rationale: 'Запрос одобрения у админа' },
      { path: '/inventory/warehouse', label: 'Склад', Icon: ShopOutlined, rationale: 'Остатки' },
      { path: '/stock-confirmation', label: 'Подтвержд.', Icon: CheckSquareOutlined, rationale: 'Подтв. склада' },
      { path: '/shipment', label: 'Накладные', Icon: TruckOutlined, rationale: 'Отгрузочные документы' },
    ];
  }

  // ── WAREHOUSE_MANAGER
  if (role === 'WAREHOUSE_MANAGER') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Сводка' },
      { path: '/deals', label: dealsLabel, Icon: FundProjectionScreenOutlined, rationale: 'Сделки' },
      { path: '/shipment', label: 'Накладные', Icon: TruckOutlined, rationale: 'Отгрузочные документы' },
      { path: '/inventory/warehouse', label: 'Склад', Icon: ShopOutlined, rationale: 'Остатки' },
      { path: '/stock-confirmation', label: 'Подтвержд.', Icon: CheckSquareOutlined, rationale: 'Подтв. склада' },
    ];
  }

  // ── MANAGER (sales): нет склада в sidebar — убираем из нижней панели
  if (role === 'MANAGER') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Пульс продаж' },
      { path: '/deals', label: 'Заявки', Icon: FundProjectionScreenOutlined, rationale: 'Основной конвейер' },
      { path: '/clients', label: 'Клиенты', Icon: TeamOutlined, rationale: 'База и визиты' },
      { path: '/inventory/products', label: 'Товары', Icon: AppstoreOutlined, rationale: 'Прайс / наличие для КП' },
      { path: '/tasks', label: 'Задачи', Icon: ProjectOutlined, rationale: 'Ежедневные задачи' },
    ];
  }

  // ── HR: close to manager workflow + notes board
  if (role === 'HR') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Ежедневная сводка' },
      { path: '/deals', label: 'Сделки', Icon: FundProjectionScreenOutlined, rationale: 'Помощь в продажах' },
      { path: '/clients', label: 'Клиенты', Icon: TeamOutlined, rationale: 'Работа с базой клиентов' },
      { path: '/notes-board', label: 'Заметки', Icon: AuditOutlined, rationale: 'Контроль обзвонов' },
      { path: '/tasks', label: 'Задачи', Icon: ProjectOutlined, rationale: 'План на день' },
    ];
  }

  // ── SUPER_ADMIN / ADMIN
  if (isAdmin) {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'KPI и алерты' },
      { path: '/deals', label: 'Сделки', Icon: FundProjectionScreenOutlined, rationale: 'Полный контур' },
      { path: '/clients', label: 'Клиенты', Icon: TeamOutlined, rationale: 'Управление базой' },
      { path: '/analytics', label: 'Аналитика', Icon: BarChartOutlined, rationale: 'Отчёты (только ADMIN*)' },
      { path: '/tasks', label: 'Задачи', Icon: ProjectOutlined, rationale: 'Кросс-функционально' },
    ];
  }

  // ── LOADER: подтверждение склада + мои отгрузки
  if (role === 'LOADER') {
    return [
      { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined, rationale: 'Сводка' },
      { path: '/warehouse-manager', label: 'Входящие', Icon: InboxOutlined, rationale: 'Запрос одобрения у админа' },
      { path: '/stock-confirmation', label: 'Подтвержд.', Icon: CheckSquareOutlined, rationale: 'Подтв. склада' },
      { path: '/my-loading-tasks', label: 'Отгрузки', Icon: TruckOutlined, rationale: 'Мои отгрузки' },
    ];
  }

  // Fallback: any role that reached Layout but not listed above — safe minimal set
  const out: MobileNavItem[] = [
    { path: '/dashboard', label: 'Главная', Icon: DashboardOutlined },
  ];
  if (hasRole(role, ...dealsRoles)) {
    out.push({ path: '/deals', label: dealsLabel, Icon: FundProjectionScreenOutlined });
  }
  if (hasRole(role, ...clientsRoles)) {
    out.push({ path: '/clients', label: 'Клиенты', Icon: TeamOutlined });
  }
  if (hasRole(role, ...productsRoles)) {
    out.push({ path: '/inventory/products', label: 'Товары', Icon: AppstoreOutlined });
  }
  if (hasRole(role, ...warehouseRoles)) {
    out.push({ path: '/inventory/warehouse', label: 'Склад', Icon: ShopOutlined });
  }
  if (hasPermission('manage_expenses')) {
    out.push({ path: '/finance/expenses', label: 'Расходы', Icon: DollarOutlined });
  }
  return out.slice(0, 5);
}

/** Longest matching path wins (e.g. /inventory/products vs /inventory). */
export function resolveActiveMobileNavPath(pathname: string, items: MobileNavItem[]): string | undefined {
  const sorted = [...items].sort((a, b) => b.path.length - a.path.length);
  const hit = sorted.find((t) => pathname === t.path || pathname.startsWith(`${t.path}/`));
  return hit?.path;
}

/**
 * Vertical space reserved above the home indicator so content clears the floating tab bar.
 * Matches `.app-main-content--mobile-shell` in `mobile.css`.
 */
export const MOBILE_MAIN_BOTTOM_PADDING_PX = 96;

/** @deprecated Use MOBILE_MAIN_BOTTOM_PADDING_PX */
export const MOBILE_TAB_BAR_BASE_PX = MOBILE_MAIN_BOTTOM_PADDING_PX;

export function mobileMainContentBottomPadding(): string {
  return `calc(${MOBILE_MAIN_BOTTOM_PADDING_PX}px + env(safe-area-inset-bottom, 0px))`;
}
