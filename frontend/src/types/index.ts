export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'MANAGER' | 'ACCOUNTANT' | 'WAREHOUSE' | 'WAREHOUSE_MANAGER';

export type Permission =
  | 'manage_users'
  | 'view_all_deals'
  | 'manage_deals'
  | 'manage_leads'
  | 'close_deals'
  | 'archive_deals'
  | 'stock_confirm'
  | 'finance_approve'
  | 'admin_approve'
  | 'confirm_shipment'
  | 'manage_inventory'
  | 'manage_products'
  | 'view_all_clients';

export const ALL_PERMISSIONS: { key: Permission; label: string }[] = [
  { key: 'manage_users', label: 'Управление пользователями' },
  { key: 'view_all_deals', label: 'Просмотр всех сделок' },
  { key: 'manage_deals', label: 'Управление сделками' },
  { key: 'manage_leads', label: 'Управление лидами' },
  { key: 'close_deals', label: 'Закрытие сделок' },
  { key: 'archive_deals', label: 'Архивирование сделок' },
  { key: 'stock_confirm', label: 'Подтверждение склада' },
  { key: 'finance_approve', label: 'Финансовое одобрение' },
  { key: 'admin_approve', label: 'Админ одобрение' },
  { key: 'confirm_shipment', label: 'Подтверждение отгрузки' },
  { key: 'manage_inventory', label: 'Управление складом' },
  { key: 'manage_products', label: 'Добавление товаров' },
  { key: 'view_all_clients', label: 'Просмотр всех клиентов' },
];

export const DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: ['manage_users', 'view_all_deals', 'manage_deals', 'manage_leads', 'close_deals', 'archive_deals', 'stock_confirm', 'finance_approve', 'admin_approve', 'confirm_shipment', 'manage_inventory', 'manage_products', 'view_all_clients'],
  OPERATOR: ['manage_leads', 'view_all_clients'],
  MANAGER: ['manage_deals', 'manage_inventory', 'view_all_clients'],
  ACCOUNTANT: ['finance_approve', 'view_all_deals'],
  WAREHOUSE: ['stock_confirm', 'manage_inventory', 'view_all_deals'],
  WAREHOUSE_MANAGER: ['confirm_shipment', 'manage_inventory', 'view_all_deals'],
};

export interface User {
  id: string;
  login: string;
  fullName: string;
  role: UserRole;
  permissions: Permission[];
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Client {
  id: string;
  companyName: string;
  contactName: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  managerId: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  manager?: { id: string; fullName: string };
  deals?: DealShort[];
  contracts?: Contract[];
}

export interface DealShort {
  id: string;
  title: string;
  status: DealStatus;
  amount: string;
  paidAmount?: string;
  paymentStatus?: PaymentStatus;
  paymentType?: PaymentType;
  createdAt: string;
}

export type DealStatus =
  | 'NEW'
  | 'IN_PROGRESS'
  | 'WAITING_STOCK_CONFIRMATION'
  | 'STOCK_CONFIRMED'
  | 'FINANCE_APPROVED'
  | 'ADMIN_APPROVED'
  | 'READY_FOR_SHIPMENT'
  | 'SHIPMENT_ON_HOLD'
  | 'SHIPPED'
  | 'CLOSED'
  | 'CANCELED'
  | 'REJECTED';

export type PaymentType = 'FULL' | 'PARTIAL' | 'DEBT';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface Contract {
  id: string;
  clientId: string;
  contractNumber: string;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; companyName: string };
  deals?: DealShort[];
}

export interface ContractListItem extends Contract {
  dealsCount: number;
  totalAmount: number;
  totalPaid: number;
  remaining: number;
}

export interface ContractDetail extends Contract {
  totalAmount: number;
  totalPaid: number;
  remaining: number;
  payments: {
    id: string;
    dealId: string;
    amount: number;
    paidAt: string;
    method?: string | null;
    note?: string | null;
    createdBy: string;
    createdAt: string;
    deal?: { id: string; title: string };
    creator?: { id: string; fullName: string };
  }[];
}

export interface DealItem {
  id: string;
  dealId: string;
  productId: string;
  requestedQty?: number | null;
  price?: string | null;
  requestComment?: string | null;
  warehouseComment?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  product?: { id: string; name: string; sku: string; unit: string; stock?: number };
  confirmer?: { id: string; fullName: string } | null;
}

export interface Shipment {
  id: string;
  dealId: string;
  vehicleType: string;
  vehicleNumber: string;
  driverName: string;
  departureTime: string;
  deliveryNoteNumber: string;
  shipmentComment?: string | null;
  shippedBy: string;
  shippedAt: string;
  user?: { id: string; fullName: string };
}

export interface Deal {
  id: string;
  title: string;
  status: DealStatus;
  amount: string;
  discount?: string;
  clientId: string;
  managerId: string;
  contractId?: string | null;
  paymentType: PaymentType;
  paidAmount: string;
  dueDate?: string | null;
  paymentStatus: PaymentStatus;
  terms?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; companyName: string; contactName?: string };
  manager?: { id: string; fullName: string };
  contract?: { id: string; contractNumber: string } | null;
  items?: DealItem[];
  comments?: DealComment[];
  shipment?: Shipment | null;
  _count?: { comments: number; items: number };
}

export interface DealComment {
  id: string;
  dealId: string;
  authorId: string;
  text: string;
  createdAt: string;
  author?: { id: string; fullName: string };
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  unit: string;
  format?: string | null;
  category?: string | null;
  countryOfOrigin?: string | null;
  stock: number;
  minStock: number;
  purchasePrice?: string | null;
  salePrice?: string | null;
  installmentPrice?: string | null;
  specifications?: Record<string, unknown> | null;
  isActive: boolean;
  manufacturedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  type: 'IN' | 'OUT';
  quantity: number;
  dealId?: string | null;
  note?: string | null;
  createdBy: string;
  createdAt: string;
  product?: { id: string; name: string; sku: string; stock?: number };
  deal?: { id: string; title: string } | null;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: string;
  user?: { id: string; fullName: string };
}

export interface DashboardSummary {
  revenueToday: number;
  revenueYesterday: number;
  revenueMonth: number;
  activeDealsCount: number;
  totalDebt: number;
  closedDealsToday: number;
  closedDealsYesterday: number;
  zeroStockCount: number;
  zeroStockProducts: { id: string; name: string; sku: string; stock: number; minStock: number }[];
  lowStockProducts: { id: string; name: string; sku: string; stock: number; minStock: number }[];
  revenueLast30Days: { day: string; total: number }[];
  dealsByStatusCounts: { status: string; count: number }[];
}

export interface RevenueTodayPayment {
  id: string;
  amount: string;
  paidAt: string;
  method: string | null;
  deal: { id: string; title: string };
  client: { id: string; companyName: string };
  creator: { id: string; fullName: string };
}

export interface RevenueTodayResponse {
  payments: RevenueTodayPayment[];
  total: number;
}

// ──── Analytics ────

export interface AnalyticsSales {
  totalRevenue: number;
  avgDealAmount: number;
  conversionNewToCompleted: number | null;
  cancellationRate: number | null;
  totalDeals: number;
  completedDeals: number;
  canceledDeals: number;
  revenueByDay: { day: string; total: number }[];
  dealsByStatus: { status: string; count: number }[];
  topClients: { clientId: string; companyName: string; totalRevenue: number }[];
  topProducts: { productId: string; name: string; totalQuantity: number }[];
}

export interface AnalyticsFinance {
  totalDebt: number;
  overdueDebts: { dealId: string; title: string; clientName: string; debt: number; dueDate: string | null }[];
  topDebtors: { clientId: string; companyName: string; totalDebt: number }[];
  realTurnover: number;
  paperTurnover: number;
}

export interface AnalyticsWarehouse {
  belowMinStock: { id: string; name: string; sku: string; stock: number; minStock: number }[];
  deadStock: { id: string; name: string; sku: string; stock: number; lastOutDate: string | null }[];
  topSelling: { productId: string; name: string; totalSold: number }[];
  frozenCapital: number;
}

export interface AnalyticsManagers {
  rows: {
    managerId: string;
    fullName: string;
    completedCount: number;
    totalRevenue: number;
    avgDealAmount: number;
    conversionRate: number;
    avgDealDays: number;
  }[];
}

export interface AnalyticsProfitability {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  expensesByCategory: { category: string; total: number }[];
}

export interface AnalyticsData {
  sales: AnalyticsSales;
  finance: AnalyticsFinance;
  warehouse: AnalyticsWarehouse;
  managers: AnalyticsManagers;
  profitability: AnalyticsProfitability;
}

// ──── Daily Closing ────

export interface DailyClosing {
  id: string;
  date: string;
  totalAmount: string;
  closedDealsCount: number;
  closedById: string;
  createdAt: string;
  closedBy?: { id: string; fullName: string };
  deals?: Deal[];
}

export interface DayClosingListResponse {
  closings: DailyClosing[];
}

// ──── Finance ────

export interface DebtsResponse {
  deals: Deal[];
  totals: {
    count: number;
    totalAmount: number;
    totalPaid: number;
    totalDebt: number;
  };
}

export interface DayClosingResponse {
  date: string;
  summary: {
    totalDeals: number;
    totalAmount: number;
    byManager: { managerId: string; fullName: string; count: number; amount: number }[];
  };
  deals: {
    id: string;
    title: string;
    client: { id: string; companyName: string };
    amount: string;
    paymentStatus: PaymentStatus;
    manager: { id: string; fullName: string };
    closedAt: string;
  }[];
}

// ──── Deal History ────

export interface DealHistoryAudit {
  kind: 'audit';
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: string;
  user?: { id: string; fullName: string };
}

export interface DealHistoryMovement {
  kind: 'movement';
  id: string;
  productId: string;
  type: 'IN' | 'OUT';
  quantity: number;
  dealId?: string | null;
  note?: string | null;
  createdBy: string;
  createdAt: string;
  product?: { id: string; name: string; sku: string };
}

export type DealHistoryEntry = DealHistoryAudit | DealHistoryMovement;

// ──── Payments ────

export interface PaymentRecord {
  id: string;
  dealId: string;
  clientId: string;
  amount: string;
  paidAt: string;
  method?: string | null;
  note?: string | null;
  createdBy: string;
  createdAt: string;
  deal?: { id: string; title: string };
  creator?: { id: string; fullName: string };
}

// ──── Client Analytics ────

export interface ClientAnalytics {
  metrics: {
    totalDeals: number;
    completedDeals: number;
    canceledDeals: number;
    totalSpent: number;
    currentDebt: number;
    lastPaymentDate: string | null;
  };
  revenueByDay: { date: string; amount: number }[];
  topProducts: { productId: string; productName: string; totalQuantity: number }[];
  recentPayments: PaymentRecord[];
}

// ──── Notifications ────

export type NotificationSeverity = 'INFO' | 'WARNING' | 'URGENT';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  link?: string | null;
  isRead: boolean;
  readAt?: string | null;
  createdByUserId: string;
  batchId?: string | null;
  createdAt: string;
  createdBy?: { id: string; fullName: string };
}

export interface NotificationBatch {
  id: string;
  createdByUserId: string;
  targetType: string;
  targetPayload: Record<string, unknown>;
  title: string;
  recipientCount: number;
  createdAt: string;
}

export interface BroadcastTargets {
  type: 'ALL' | 'USERS' | 'ROLES' | 'DEALS_COUNT';
  userIds?: string[];
  roles?: string[];
  periodDays?: number;
  operator?: 'LT' | 'GT' | 'LTE' | 'GTE';
  value?: number;
  roleFilter?: string;
}

export interface BroadcastData {
  title: string;
  body: string;
  severity: NotificationSeverity;
  link?: string;
  targets: BroadcastTargets;
}

// ──── Chat / Conversations ────

export type ConversationType = 'SALES' | 'WAREHOUSE' | 'ACCOUNTING' | 'SHIPMENT';

export interface MessageAttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  conversationType: ConversationType;
  senderId: string;
  text: string;
  dealId?: string | null;
  replyToId?: string | null;
  editedAt?: string | null;
  isDeleted: boolean;
  createdAt: string;
  sender?: { id: string; fullName: string };
  deal?: { id: string; title: string } | null;
  replyTo?: {
    id: string;
    text: string;
    senderId: string;
    isDeleted: boolean;
    sender?: { id: string; fullName: string };
  } | null;
  attachments?: MessageAttachmentInfo[];
}

export interface Conversation {
  type: ConversationType;
  label: string;
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

export interface OnlineUser {
  id: string;
  fullName: string;
  role: string;
  lastSeenAt: string;
}

// ──── Expenses ────

export interface Expense {
  id: string;
  date: string;
  category: string;
  amount: string;
  note?: string | null;
  createdBy: string;
  createdAt: string;
  creator?: { id: string; fullName: string };
}

// ──── Tasks ────

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'APPROVED';

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  assigneeId: string;
  createdById: string;
  report?: string | null;
  dueDate?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  assignee?: { id: string; fullName: string };
  createdBy?: { id: string; fullName: string };
  approvedBy?: { id: string; fullName: string } | null;
  attachments?: TaskAttachment[];
  _count?: { attachments: number };
}

// ──── Client Debt Detail ────

export interface ClientDebtDetail {
  client: { id: string; companyName: string; contactName: string; phone: string | null };
  deals: Deal[];
  payments: PaymentRecord[];
  totalDebt: number;
  discipline: {
    onTimeRate: number;
    avgPaymentDelay: number;
    tag: 'good' | 'pays_late' | 'chronic';
    totalClosedDeals: number;
    dealsWithDueDate: number;
  };
}

// ──── User KPI ────

export interface UserKPI {
  dealsCreated: number;
  dealsCompleted: number;
  revenue: number;
  shipmentsCount: number;
  avgDealDays: number;
  activityByDay: { day: string; count: number }[];
}

// ──── Product Analytics ────

export interface ProductAnalytics {
  product: Product;
  movements: {
    totalIn: number;
    totalOut: number;
    movementsByDay: { day: string; inQty: number; outQty: number }[];
  };
  sales: {
    totalRevenue: number;
    totalQuantitySold: number;
    dealsUsing: number;
    avgPricePerUnit: number;
  };
  profitability: {
    totalCost: number;
    totalRevenue: number;
    grossProfit: number;
    marginPercent: number;
  };
  topClients: { clientId: string; companyName: string; totalQty: number }[];
}
