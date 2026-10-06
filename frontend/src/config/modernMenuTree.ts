import type { Icon } from '@phosphor-icons/react';
import {
  BellSimple,
  BookOpen,
  ChartBar,
  ChatCircle,
  CurrencyCircleDollar,
  Files,
  Gauge,
  GearSix,
  Handshake,
  Kanban,
  Notepad,
  Package,
  ShieldCheck,
  Sparkle,
  Robot,
  Newspaper,
  Truck,
  Users,
  UsersFour,
  UsersThree,
  Warehouse,
  Bank,
  CashRegister,
  Receipt,
  Scales,
  Wallet,
  Factory,
  Boat,
  FlowArrow,
  GlobeHemisphereEast,
} from '@phosphor-icons/react';
import type { UserRole } from '../types';

/**
 * Боковое меню нового дизайна: разделы → пункты → подпункты, как в сайдбаре
 * shadcn / Animate UI. Права доступа — те же, что в старом меню (Layout.tsx).
 *
 * Дерево собирается для конкретного человека из видимых ему пунктов
 * (`buildModernMenu`), поэтому одиночных и пустых группировок не бывает:
 *  - пункт со стрелкой без видимых подпунктов убирается;
 *  - пункт со стрелкой с одним подпунктом становится обычным пунктом;
 *  - раздел без пунктов убирается, раздел с одним пунктом — без заголовка,
 *    а соседние такие разделы сливаются в один блок.
 */

export interface MenuAccess {
  role: UserRole | undefined;
  isAdmin: boolean;
  hasRole: (...roles: UserRole[]) => boolean;
  /** Как в Layout: у администраторов — любое право. */
  hasPermission: (perm: string) => boolean;
  /** Права пользователя как есть, без поблажки администраторам. */
  ownPermissions: string[];
  canViewClients: boolean;
  canViewClosedDealsHistory: boolean;
  moneyFull: boolean;
}

export interface MenuLeaf {
  key: string;
  /** Куда ведёт; без `to` пункт показывается неактивным («скоро»). */
  to?: string;
  text: string;
  /** Название, если пункт остался один и встал на место своей группы. */
  soloText?: string;
  icon?: Icon;
  /** Показать счётчик непрочитанных (сообщения). */
  unreadBadge?: boolean;
}

export interface MenuParent {
  key: string;
  text: string;
  icon: Icon;
  children: MenuLeaf[];
}

export type MenuNode = MenuLeaf | MenuParent;

export interface MenuSection {
  key: string;
  /** Заголовок раздела; пустой, если в разделе остался один пункт. */
  title?: string;
  items: MenuNode[];
}

export const isParent = (node: MenuNode): node is MenuParent => 'children' in node;

type Draft<T> = T & { show: boolean };
type DraftParent = Omit<MenuParent, 'children'> & { children: Draft<MenuLeaf>[] };
type DraftNode = Draft<MenuLeaf> | DraftParent;

function tree(a: MenuAccess): { key: string; title: string; items: DraftNode[] }[] {
  const { hasRole, hasPermission, isAdmin, role } = a;
  const warehouseStaff = hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER');
  const productsAccess = hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'WAREHOUSE', 'WAREHOUSE_MANAGER') || hasPermission('manage_products');
  const managerAnalytics = hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR');

  return [
    {
      key: 'main',
      title: 'Главное',
      items: [
        { key: '/dashboard', to: '/dashboard', text: 'Дашборд', icon: Gauge, show: true },
        { key: '/tasks', to: '/tasks', text: 'Задачи', icon: Kanban, show: true },
        { key: '/messages', to: '/messages', text: 'Сообщения', icon: ChatCircle, unreadBadge: true, show: role !== 'OPERATOR' },
        {
          key: 'notifications-group',
          text: 'Уведомления',
          icon: BellSimple,
          children: [
            { key: '/notifications', to: '/notifications', text: 'Лента', soloText: 'Уведомления', show: true },
            { key: '/notifications/broadcast', to: '/notifications/broadcast', text: 'Рассылка', show: isAdmin },
          ],
        },
      ],
    },
    {
      key: 'sales',
      title: 'Продажи',
      items: [
        {
          key: 'grp:clients',
          text: 'Клиенты',
          icon: UsersThree,
          children: [
            { key: '/clients', to: '/clients', text: 'Все клиенты', soloText: 'Клиенты', show: a.canViewClients },
            { key: '/clients/duplicates', to: '/clients/duplicates', text: 'Дубликаты', show: hasRole('SUPER_ADMIN', 'ADMIN') },
            { key: '/reviews', to: '/reviews', text: 'Отзывы', show: hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'OPERATOR') },
            { key: '/calls', to: '/calls', text: 'Звонки', show: hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER') || hasPermission('use_rop_agent') },
          ],
        },
        {
          key: 'grp:deals',
          text: role === 'MANAGER' ? 'Заявки' : 'Сделки',
          icon: Handshake,
          children: [
            {
              key: '/deals',
              to: '/deals',
              text: role === 'MANAGER' ? 'Все заявки' : 'Все сделки',
              soloText: role === 'MANAGER' ? 'Заявки' : 'Сделки',
              show: hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'WAREHOUSE', 'ACCOUNTANT', 'WAREHOUSE_MANAGER'),
            },
            { key: '/deals/approval', to: '/deals/approval', text: 'Одобрение', show: hasRole('SUPER_ADMIN', 'ADMIN') },
            { key: '/deals/closed', to: '/deals/closed', text: 'История закрытых', soloText: 'История закрытых сделок', show: a.canViewClosedDealsHistory },
            { key: '/deals/audit-check', to: '/deals/audit-check', text: 'Аудит-проверка', show: isAdmin },
            { key: '/deals/archived', to: '/deals/archived', text: 'Архив', soloText: 'Архив сделок', show: isAdmin },
          ],
        },
        {
          key: 'grp:docs',
          text: 'Документы',
          icon: Files,
          children: [
            { key: '/contracts', to: '/contracts', text: 'Договоры', show: hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT') },
            { key: '/power-of-attorney', to: '/power-of-attorney', text: 'Доверенности', show: hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT') },
          ],
        },
        { key: '/notes-board', to: '/notes-board', text: 'Заметки', icon: Notepad, show: managerAnalytics },
      ],
    },
    {
      key: 'stock',
      title: 'Склад',
      items: [
        {
          key: 'grp:products',
          text: 'Товары',
          icon: Package,
          children: [
            { key: '/inventory/products', to: '/inventory/products', text: 'Все товары', soloText: 'Товары', show: productsAccess },
            { key: '/inventory/groups', to: '/inventory/groups', text: 'Группировки', soloText: 'Группировки товаров', show: productsAccess },
          ],
        },
        {
          key: 'grp:warehouse',
          text: 'Склад',
          icon: Warehouse,
          children: [
            { key: '/inventory/warehouse', to: '/inventory/warehouse', text: 'Остатки', soloText: 'Склад', show: warehouseStaff },
            { key: '/inventory/audit-check', to: '/inventory/audit-check', text: 'Аудит остатков', show: warehouseStaff },
            { key: '/inventory/movements', to: '/inventory/movements', text: 'Движение', soloText: 'Движение склада', show: warehouseStaff },
            { key: '/stock-confirmation', to: '/stock-confirmation', text: 'Подтверждение', soloText: 'Подтверждение склада', show: hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER', 'LOADER') },
            { key: '/shipment', to: '/shipment', text: 'Накладные', show: warehouseStaff },
            { key: '/warehouse-manager', to: '/warehouse-manager', text: 'Зав. склада', show: hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER') },
            {
              key: '/warehouse-manager-incoming',
              to: '/warehouse-manager',
              text: 'Входящие к админу',
              show: hasRole('WAREHOUSE', 'LOADER') && !hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER'),
            },
          ],
        },
        {
          key: 'grp:logistics',
          text: 'Логистика',
          icon: Truck,
          children: [
            { key: '/my-loading-tasks', to: '/my-loading-tasks', text: 'Мои отгрузки', show: hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE', 'DRIVER', 'LOADER') },
            { key: '/my-vehicle', to: '/my-vehicle', text: 'Моя машина', show: hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER', 'DRIVER') },
          ],
        },
      ],
    },
    {
      key: 'finance',
      title: 'Финансы',
      items: [
        { key: '/finance/cashbox', to: '/finance/cashbox', text: 'Касса', icon: CashRegister, show: hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'OPERATOR') },
        { key: '/finance/cashbox?tab=debtors', to: '/finance/cashbox?tab=debtors', text: 'Долги', icon: Receipt, show: hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT') },
        { key: '/finance/review', to: '/finance/review', text: 'На проверке', icon: Scales, show: hasRole('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT') },
        { key: '/finance/expenses', to: '/finance/expenses', text: 'Расходы', icon: Wallet, show: hasPermission('manage_expenses') },
        { key: '/finance/balance', to: '/finance/balance', text: 'Баланс компании', icon: Bank, show: hasRole('SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER') },
      ],
    },
    {
      key: 'ved',
      title: 'ВЭД',
      items: (() => {
        const ved = hasRole('SUPER_ADMIN', 'ADMIN', 'FOREIGN_TRADE', 'ACCOUNTANT') || hasPermission('view_import_orders');
        return [
          { key: '/foreign-trade/suppliers', to: '/foreign-trade/suppliers', text: 'Поставщики', icon: Factory, show: ved },
          { key: '/foreign-trade/import-orders', to: '/foreign-trade/import-orders', text: 'Импорт-заказы', icon: Boat, show: ved },
          { key: '/foreign-trade/process-board', to: '/foreign-trade/process-board', text: 'Трекинг и документы', icon: FlowArrow, show: ved },
          { key: '/foreign-trade/map', to: '/foreign-trade/map', text: 'Карта ВЭД', icon: GlobeHemisphereEast, show: ved },
          { key: '/foreign-trade/exchange-rates', to: '/foreign-trade/exchange-rates', text: 'Курсы ЦБ', icon: CurrencyCircleDollar, show: ved },
        ];
      })(),
    },
    {
      key: 'analytics',
      title: 'Аналитика',
      items: [
        {
          key: 'grp:analytics',
          text: 'Аналитика',
          icon: ChartBar,
          children: [
            { key: '/analytics', to: '/analytics', text: 'Общая', soloText: 'Аналитика', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
            { key: '/history-analytics', to: '/history-analytics', text: 'История', soloText: 'Аналитика (история)', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
            { key: '/analytics/market', to: '/analytics/market', text: 'Анализ рынка', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
            { key: '/analytics/department-report', to: '/analytics/department-report', text: 'Отчёт отдела', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
          ],
        },
        {
          key: 'grp:managers',
          text: 'Менеджерам',
          icon: UsersFour,
          children: [
            { key: '/manager/client-activity', to: '/manager/client-activity', text: 'Активность клиентов', soloText: 'Аналитика для менеджеров', show: managerAnalytics },
            { key: '/manager/reanimation', to: '/manager/reanimation', text: 'Реанимация', show: managerAnalytics },
            { key: '/manager/dead-products', to: '/manager/dead-products', text: 'Мёртвые товары', show: managerAnalytics },
            { key: '/manager/payment-overdue', to: '/manager/payment-overdue', text: 'Просрочка', show: managerAnalytics },
            { key: '/analytics/calls', to: '/analytics/calls', text: 'Обзвоны', show: managerAnalytics },
            { key: '/analytics/contact-matrix', to: '/analytics/contact-matrix', text: 'Матрица контактов', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
          ],
        },
        {
          key: 'almanac-group',
          text: 'Альманах',
          icon: BookOpen,
          children: [
            { key: '/almanac/sales', text: 'Продажи', show: true },
            { key: '/almanac/clients', text: 'Клиенты', show: true },
            { key: '/almanac/products', to: '/almanac/products', text: 'Товары', show: true },
            { key: '/almanac/debts', text: 'Долги', show: true },
          ],
        },
        {
          key: 'grp:control',
          text: 'Контроль',
          icon: ShieldCheck,
          children: [
            { key: '/analytics/note-audit', to: '/analytics/note-audit', text: 'AI-аудит заметок', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
            { key: '/analytics/lamination-kg-usage', to: '/analytics/lamination-kg-usage', text: 'Ввод кг (ламинация)', show: managerAnalytics && hasRole('SUPER_ADMIN', 'ADMIN') },
          ],
        },
      ],
    },
    {
      key: 'ai',
      title: 'AI',
      items: [
        {
          key: 'grp:ai',
          text: 'AI-ассистент',
          icon: Sparkle,
          children: (() => {
            // Новичкам (ограниченный доступ к деньгам) не показываем: ИИ может пересказать суммы.
            const ai = hasRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'FOREIGN_TRADE') && a.moneyFull;
            return [
              { key: '/ai-assistant', to: '/ai-assistant', text: 'Ассистент', soloText: 'AI-ассистент', show: ai },
              { key: '/ai-assistant/transcribe', to: '/ai-assistant/transcribe', text: 'Аудио в текст', show: ai },
              { key: '/ai-assistant/call-audits', to: '/ai-assistant/call-audits', text: 'История аудитов', show: ai },
            ];
          })(),
        },
        {
          key: '/rop-agent',
          to: '/rop-agent',
          text: 'РОП-агент',
          icon: Robot,
          show: (role === 'SUPER_ADMIN' || a.ownPermissions.includes('use_rop_agent')) && a.moneyFull,
        },
      ],
    },
    {
      key: 'system',
      title: 'Система',
      items: [
        {
          key: 'grp:team',
          text: 'Команда',
          icon: Users,
          children: [
            { key: '/team', to: '/team', text: 'Команда', show: true },
            { key: '/users', to: '/users', text: 'Сотрудники CRM', show: isAdmin },
            { key: '/worker-audit', to: '/worker-audit', text: 'Аудит сотрудников', show: isAdmin },
            { key: '/attendance', to: '/attendance', text: 'Посещаемость', show: isAdmin },
          ],
        },
        {
          key: 'grp:settings',
          text: 'Настройки',
          icon: GearSix,
          children: [
            { key: '/settings/company', to: '/settings/company', text: 'Компания', soloText: 'Настройки', show: isAdmin && hasPermission('manage_users') },
            { key: '/mobile-devices', to: '/mobile-devices', text: 'Телефоны (CallSync)', show: hasPermission('use_rop_agent') },
            { key: '/admin/activity-log', to: '/admin/activity-log', text: 'Журнал действий', show: hasRole('SUPER_ADMIN') },
          ],
        },
        { key: '/changelog', to: '/changelog', text: 'Обновления', icon: Newspaper, show: true },
      ],
    },
  ];
}

/** Меню для конкретного человека: только видимое, без пустых и одиночных группировок. */
export function buildModernMenu(access: MenuAccess): MenuSection[] {
  const sections: MenuSection[] = [];
  for (const section of tree(access)) {
    const items: MenuNode[] = [];
    for (const node of section.items) {
      if ('children' in node) {
        const visible = node.children.filter((c) => c.show);
        if (visible.length === 0) continue;
        if (visible.length === 1) {
          const only = visible[0];
          items.push({ ...stripShow(only), text: only.soloText ?? only.text, icon: only.icon ?? node.icon });
          continue;
        }
        items.push({ key: node.key, text: node.text, icon: node.icon, children: visible.map(stripShow) });
      } else if (node.show) {
        items.push(stripShow(node));
      }
    }
    if (items.length === 0) continue;
    const title = items.length > 1 ? section.title : undefined;
    // Соседние разделы, оставшиеся без заголовка, сливаются в один блок,
    // чтобы одинокие пункты не шли каждый отдельной «группой»
    const prev = sections[sections.length - 1];
    if (!title && prev && !prev.title) prev.items.push(...items);
    else sections.push({ key: section.key, title, items });
  }
  return sections;
}

function stripShow(leaf: Draft<MenuLeaf>): MenuLeaf {
  const { show: _show, ...rest } = leaf;
  return rest;
}

/** Ключ раскрывающегося пункта, в котором лежит `leafKey` (чтобы раскрыть его на этой странице). */
export function parentKeyOf(sections: MenuSection[], leafKey: string): string | undefined {
  for (const section of sections) {
    for (const node of section.items) {
      if (isParent(node) && node.children.some((c) => c.key === leafKey)) return node.key;
    }
  }
  return undefined;
}
