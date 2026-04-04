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
  | 'view_all_clients'
  | 'create_inventory_in'
  | 'edit_client'
  | 'edit_closed_deal'
  | 'manage_contract'
  | 'approve_deal'
  | 'shipment_execute'
  | 'super_deal_override'
  | 'delete_any_deal'
  | 'view_audit_history'
  | 'manage_expenses';

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
  { key: 'create_inventory_in', label: 'Приход товаров' },
  { key: 'edit_client', label: 'Редактирование клиентов' },
  { key: 'edit_closed_deal', label: 'Редактирование закрытых сделок' },
  { key: 'manage_contract', label: 'Управление договорами' },
  { key: 'approve_deal', label: 'Одобрение сделок' },
  { key: 'shipment_execute', label: 'Оформление отгрузки' },
  { key: 'super_deal_override', label: 'Суперредактирование сделок' },
  { key: 'delete_any_deal', label: 'Удаление любых сделок' },
  { key: 'view_audit_history', label: 'Просмотр истории аудита' },
  { key: 'manage_expenses', label: 'Управление расходами' },
];

const SUPER_ONLY: Permission[] = ['super_deal_override', 'delete_any_deal', 'view_audit_history'];

export const DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: ALL_PERMISSIONS.map((p) => p.key).filter((p) => !SUPER_ONLY.includes(p)),
  OPERATOR: ['manage_leads', 'view_all_clients'],
  MANAGER: ['manage_deals', 'manage_inventory', 'view_all_clients', 'edit_client'],
  ACCOUNTANT: ['finance_approve', 'view_all_deals', 'manage_contract', 'manage_expenses'],
  WAREHOUSE: ['stock_confirm', 'manage_inventory', 'view_all_deals', 'create_inventory_in'],
  WAREHOUSE_MANAGER: ['stock_confirm', 'confirm_shipment', 'manage_inventory', 'view_all_deals', 'create_inventory_in', 'shipment_execute', 'manage_expenses'],
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

export interface ClientNote {
  id: string;
  clientId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  user: { id: string; fullName: string };
}

export interface ClientLastNote {
  id: string;
  preview: string | null;
  createdAt: string;
  authorName: string;
}

export interface Client {
  id: string;
  companyName: string;
  contactName: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  inn?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  mfo?: string | null;
  vatRegCode?: string | null;
  oked?: string | null;
  portraitProfile?: string | null;
  portraitGoals?: string | null;
  portraitPains?: string | null;
  portraitFears?: string | null;
  portraitObjections?: string | null;
  managerId: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Max of client updatedAt, latest deal createdAt, latest payment paidAt (from list API). */
  lastContactAt?: string | null;
  /** Latest non-deleted client note (from list API). */
  lastNote?: ClientLastNote | null;
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
  | 'WAITING_FINANCE'
  | 'FINANCE_APPROVED'
  | 'ADMIN_APPROVED'
  | 'READY_FOR_SHIPMENT'
  | 'SHIPMENT_ON_HOLD'
  | 'CLOSED'
  | 'CANCELED'
  | 'REJECTED'
  | 'REOPENED';

export type PaymentType = 'FULL' | 'PARTIAL' | 'INSTALLMENT';
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'PAYME' | 'QR' | 'CLICK' | 'TERMINAL' | 'INSTALLMENT';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export type ContractType = 'ANNUAL' | 'ONE_TIME';

export interface Contract {
  id: string;
  clientId: string;
  contractNumber: string;
  contractType: ContractType;
  amount: number;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
  notes?: string | null;
  deletedAt?: string | null;
  deletedById?: string | null;
  deleteReason?: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; companyName: string; contactName?: string; phone?: string | null; address?: string | null };
  deals?: DealShort[];
}

export interface ContractListItem extends Contract {
  dealsCount: number;
  totalAmount: number;
  totalPaid: number;
  remaining: number;
}

export interface ContractAttachment {
  id: string;
  contractId: string;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  uploader?: { id: string; fullName: string };
}

export interface ContractDealItem {
  id: string;
  requestedQty: number | null;
  price: string | null;
  product: { id: string; name: string; sku: string; unit: string };
}

export interface ContractDealWithItems extends DealShort {
  items?: ContractDealItem[];
}

export interface ContractDetail extends Contract {
  totalAmount: number;
  totalPaid: number;
  remaining: number;
  attachments?: ContractAttachment[];
  deals?: ContractDealWithItems[];
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
  sourceOpType?: string | null;
  isProblem?: boolean;
  requestComment?: string | null;
  warehouseComment?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  dealDate?: string | null;
  product?: { id: string; name: string; sku: string; unit: string; stock?: number; salePrice?: string | null };
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
  paymentMethod?: PaymentMethod | null;
  paymentType: PaymentType;
  paidAmount: string;
  dueDate?: string | null;
  paymentStatus: PaymentStatus;
  terms?: string | null;
  includeVat?: boolean;
  transferInn?: string | null;
  transferDocuments?: string[] | null;
  transferType?: 'ONE_TIME' | 'ANNUAL' | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; companyName: string; contactName?: string; inn?: string | null };
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
  deal?: { id: string; title: string; client?: { companyName: string } } | null;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; role?: string };
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
  /** Operational line revenue (active deals, effective item date). */
  totalRevenue: number;
  /** SHIPPED/CLOSED line revenue (same date rules). */
  shippedRevenue: number;
  avgDealAmount: number;
  conversionNewToCompleted: number | null;
  cancellationRate: number | null;
  totalDeals: number;
  completedDeals: number;
  canceledDeals: number;
  /** `total` = operational; `shippedTotal` = shipped/closed (same calendar day, Tashkent). */
  revenueByDay: { day: string; total: number; shippedTotal: number }[];
  dealsByStatus: { status: string; count: number }[];
  topClients: {
    clientId: string;
    companyName: string;
    totalRevenue: number;
    shippedRevenue: number;
  }[];
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

/** Подсказка для менеджера (RU), без изменения логики ABC/XYZ. */
export interface AbcXyzRecommendation {
  title: string;
  description: string;
  action: string;
  risk?: string;
}

/** ABC/XYZ классификация: выручка = закрытые сделки, строки deal_items за период; XYZ — CV по месяцам за 12 мес. */
export interface AbcXyzRow {
  entityId: string;
  name: string;
  revenue: number;
  sharePercent: number;
  cumulativeSharePercent: number;
  abc: 'A' | 'B' | 'C';
  xyz: 'X' | 'Y' | 'Z' | 'NEW';
  combined: string;
  recommendation: AbcXyzRecommendation;
}

export interface AbcXyzResponse {
  period: string;
  products: AbcXyzRow[];
  clients: AbcXyzRow[];
}

export interface AnalyticsData {
  sales: AnalyticsSales;
  finance: AnalyticsFinance;
  warehouse: AnalyticsWarehouse;
  managers: AnalyticsManagers;
  profitability: AnalyticsProfitability;
}

// ──── Finance ────

export interface ClientDebtRow {
  clientId: string;
  clientName: string;
  totalDebt: number;
  totalAmount: number;
  totalPaid: number;
  dealsCount: number;
  lastPaymentDate: string | null;
  manager: { id: string; fullName: string } | null;
  newestDealDate: string;
  oldestUnpaidDueDate: string | null;
  paymentStatus: 'UNPAID' | 'PARTIAL';
}

export interface DebtsResponse {
  clients: ClientDebtRow[];
  totals: {
    clientCount: number;
    dealsCount: number;
    totalDebtGiven: number;      // Общий долг (К+НК+ПК+Ф)
    totalDebtOwed: number;       // Чистый долг (К+НК+ПК+Ф+ПП)
    prepayments: number;         // Передоплаты
  };
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
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedReason?: string | null;
  createdBy: string;
  createdAt: string;
  creator?: { id: string; fullName: string };
  approver?: { id: string; fullName: string } | null;
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
    /** Отгрузки по сделкам (реальный «расход» для аналитики), без коррекций остатка. */
    totalOut: number;
    movementsByDay: { day: string; inQty: number; outQty: number }[];
    /** Фактическая детализация графика движений (после валидации по периоду). */
    chartGranularity?: 'day' | 'month' | 'quarter' | 'year';
    /** Допустимые значения granularity для текущего периода. */
    allowedChartGranularities?: ('day' | 'month' | 'quarter' | 'year')[];
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

export interface CompanySettings {
  id: string;
  companyName: string;
  inn: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  mfo: string;
  director: string;
  vatRegCode: string;
  oked: string;
  logoPath: string | null;
  updatedAt: string;
}

// ──── Intelligence Analytics ────

export interface ClientSegmentRow {
  segment: string;
  count: number;
}

export interface ClientLTVRow {
  clientId: string;
  companyName: string;
  ltv: number;
  dealsCount: number;
  avgDealAmount: number;
  riskScore: number;
  lastDealDate: string;
  segment: string;
}

export interface ClientIntelligence {
  repeatRate: number;
  avgFrequencyDays: number;
  totalClients: number;
  repeatClients: number;
  segments: ClientSegmentRow[];
  topByLTV: ClientLTVRow[];
}

export interface CrossSellPair {
  product1Id: string;
  product1Name: string;
  product2Id: string;
  product2Name: string;
  coOccurrences: number;
}

export interface DemandStabilityRow {
  productId: string;
  name: string;
  avgMonthlySales: number;
  coefficient: number;
}

export interface SeasonalityRow {
  month: number;
  totalQuantity: number;
  totalRevenue: number;
}

export interface ProductIntelligence {
  crossSellPairs: CrossSellPair[];
  demandStability: DemandStabilityRow[];
  seasonality: SeasonalityRow[];
}

export interface ManagerIntelligenceRow {
  managerId: string;
  fullName: string;
  completedCount: number;
  totalRevenue: number;
  avgDealAmount: number;
  conversionRate: number;
  avgDealDays: number;
  uniqueClients: number;
  repeatClients: number;
  retentionRate: number;
}

export interface ManagerIntelligence {
  rows: ManagerIntelligenceRow[];
}

export interface RevenueByMethodRow {
  method: string;
  total: number;
  count: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  amount: number;
}

export interface AgingData {
  buckets: AgingBucket[];
  noDueDateCount: number;
  noDueDateAmount: number;
}

export interface FinancialIntelligence {
  revenueByMethod: RevenueByMethodRow[];
  avgPaymentDelayDays: number;
  onTimePaymentRate: number;
  aging: AgingData;
}

export interface IntelligenceData {
  clients: ClientIntelligence;
  products: ProductIntelligence;
  managers: ManagerIntelligence;
  financial: FinancialIntelligence;
}

// ─── History Analytics ───

export interface HistoryOverview {
  totalDeals: number;
  totalClients: number;
  totalRevenue: number;
  totalPaid: number;
  totalDebt: number;
  totalDebtPositive: number;
  totalOverpayments: number;
  netBalance: number;
  avgDeal: number;
}

export interface HistoryMonthlyTrend {
  month: number;
  revenue: number;
  collected: number;
  /** Line totals by warehouse `shipped_at` month (logistics). */
  shipped: number;
  /** SHIPPED/CLOSED line revenue by effective item date (same rules as Analytics «отгружено»). */
  shippedRevenue?: number;
  activeClients: number;
  openingBalance: number;
  closingBalance: number;
}

export interface HistoryTopClient {
  id: string;
  companyName: string;
  dealsCount: number;
  revenue: number;
  paid: number;
  debt: number;
}

export interface HistoryTopProduct {
  id: string;
  name: string;
  unit: string;
  totalQty: number;
  totalRevenue: number;
  uniqueBuyers: number;
}

export interface HistoryManager {
  id: string;
  fullName: string;
  dealsCount: number;
  revenue: number;
  collected: number;
  clients: number;
}

export interface HistoryPaymentMethod {
  method: string;
  total: number;
  count: number;
}

export interface HistoryDebtor {
  id: string;
  companyName: string;
  totalAmount: number;
  totalPaid: number;
  debt: number;
}

export interface HistoryClientActivity {
  clientId: string;
  companyName: string;
  activeMonths: number[];
  monthlyData: { month: number; revenue: number }[];
}

export interface HistoryData {
  overview: HistoryOverview;
  monthlyTrend: HistoryMonthlyTrend[];
  topClients: HistoryTopClient[];
  topProducts: HistoryTopProduct[];
  managers: HistoryManager[];
  paymentMethods: HistoryPaymentMethod[];
  debtors: HistoryDebtor[];
  clientActivity: HistoryClientActivity[];
}

// ─── History Drilldown ───

export interface HistoryDealRow {
  id: string;
  title: string;
  amount: number;
  paidAmount: number;
  paymentStatus: string;
  status: string;
  createdAt: string;
  companyName: string;
  managerName: string;
}

export interface HistoryPaymentRow {
  id: string;
  amount: number;
  paidAt: string;
  method: string;
  dealTitle: string;
  companyName: string;
}

export interface HistoryDrilldownData {
  deals?: HistoryDealRow[];
  payments?: HistoryPaymentRow[];
}

export interface HistoryMonthProduct {
  id: string;
  name: string;
  qty: number;
  revenue: number;
}

export interface HistoryMonthManager {
  id: string;
  fullName: string;
  dealsCount: number;
  revenue: number;
}

export interface HistoryMonthPayment {
  id: string;
  amount: number;
  paidAt: string;
  method: string;
  dealTitle: string;
  companyName: string;
}

export interface HistoryMonthDebtor {
  id: string;
  companyName: string;
  totalAmount: number;
  totalPaid: number;
  debt: number;
}

export interface HistoryMonthDebtSnapshot {
  openingBalance: number;
  closingBalance: number;
  debtors: HistoryMonthDebtor[];
}

export interface HistoryMonthDetail {
  deals: HistoryDealRow[];
  products: HistoryMonthProduct[];
  managers: HistoryMonthManager[];
  payments: HistoryMonthPayment[];
  debtSnapshot: HistoryMonthDebtSnapshot;
}

// ─── History Extended Analytics ───

export interface HistoryRetentionRow {
  month: number;
  totalClients: number;
  retainedClients: number;
  retentionRate: number;
}

export interface HistoryConcentrationRow {
  clientId: string;
  companyName: string;
  revenue: number;
  cumulativePercent: number;
  rank: number;
}

export interface HistoryProductRecurringRow {
  productId: string;
  name: string;
  monthsActive: number;
  totalBuyers: number;
  recurringBuyers: number;
  recurringRate: number;
}

export interface HistoryManagerTrendRow {
  managerId: string;
  fullName: string;
  month: number;
  revenue: number;
  dealsCount: number;
}

export interface HistoryCohortRow {
  cohortMonth: number;
  activeMonth: number;
  clientCount: number;
  revenueTotal: number;
}

export interface HistoryDebtRiskRow {
  clientId: string;
  companyName: string;
  debt: number;
  revenue: number;
  debtRatio: number;
  lastDealMonth: number;
}

export interface HistorySeasonalityRow {
  month: number;
  revenue: number;
  dealsCount: number;
  avgDealSize: number;
}

export interface HistoryClientSegment {
  clientId: string;
  companyName: string;
  segment: string;
  totalRevenue: number;
  dealsCount: number;
  lastActiveMonth: number;
  activeMonths: number[];
}

export interface HistorySegmentSummary {
  segment: string;
  count: number;
  totalRevenue: number;
}

export interface HistoryExtendedData {
  retention: HistoryRetentionRow[];
  concentration: HistoryConcentrationRow[];
  productRecurring: HistoryProductRecurringRow[];
  managerTrend: HistoryManagerTrendRow[];
  cohort: HistoryCohortRow[];
  debtRisk: HistoryDebtRiskRow[];
  seasonality: HistorySeasonalityRow[];
  clientSegments: HistoryClientSegment[];
  segmentSummary: HistorySegmentSummary[];
}

// ─── History Client-Month Purchases ───

export interface HistoryClientMonthItem {
  id: string;
  productName: string;
  unit: string;
  qty: number;
  price: number;
  total: number;
  dealTitle: string;
  dealId: string;
  createdAt?: string;
}

export interface HistoryClientMonthData {
  items: HistoryClientMonthItem[];
  totalRevenue: number;
}

// ─── History Cohort Clients ───

export interface HistoryCohortClient {
  clientId: string;
  companyName: string;
  revenue: number;
  dealsCount: number;
}

export interface HistoryCohortClientsData {
  cohortMonth: number;
  activeMonth: number;
  clients: HistoryCohortClient[];
}

// ─── History Product Buyers ───

export interface HistoryProductBuyer {
  clientId: string;
  companyName: string;
  totalQty: number;
  totalRevenue: number;
  dealsCount: number;
}

export interface HistoryProductBuyersData {
  productName: string;
  buyers: HistoryProductBuyer[];
}

// ─── History Cashflow ───

export interface HistoryCashflowMonthly {
  month: number;
  collected: number;
  paymentsCount: number;
}

export interface HistoryCashflowClient {
  id: string;
  companyName: string;
  collected: number;
  paymentsCount: number;
}

export interface HistoryCashflowData {
  monthly: HistoryCashflowMonthly[];
  topClients: HistoryCashflowClient[];
  totalCollected: number;
  totalPayments: number;
}

// ─── Data Quality ───

export interface DataQualityProblemByOpType {
  opType: string;
  count: number;
}

export interface DataQualityProduct {
  id: string;
  name: string;
  unit: string;
  totalQty: number;
  problemCount: number;
}

export interface DataQualityClient {
  id: string;
  companyName: string;
  problemCount: number;
  totalQty: number;
}

export interface DataQualityProblemRow {
  id: string;
  productName: string;
  unit: string;
  qty: number;
  opType: string;
  dealId: string;
  dealTitle: string;
  companyName: string;
  managerName: string;
  createdAt: string;
}

export interface DataQualityData {
  totalProblemRows: number;
  totalQtyInProblem: number;
  problemByOpType: DataQualityProblemByOpType[];
  topProducts: DataQualityProduct[];
  topClients: DataQualityClient[];
  problemRows: DataQualityProblemRow[];
}

// ─── Exchange ───

export interface ExchangeByMonth {
  month: number;
  count: number;
  totalQty: number;
}

export interface ExchangeProduct {
  id: string;
  name: string;
  unit: string;
  totalQty: number;
  uniqueClients: number;
}

export interface ExchangeClient {
  id: string;
  companyName: string;
  exchangeCount: number;
  totalQty: number;
}

export interface ExchangeData {
  totalExchanges: number;
  totalQty: number;
  uniqueClients: number;
  uniqueProducts: number;
  byMonth: ExchangeByMonth[];
  products: ExchangeProduct[];
  clients: ExchangeClient[];
}

// ─── Prepayments ───

export interface PrepaymentByMonth {
  month: number;
  count: number;
  amount: number;
}

export interface PrepaymentClient {
  id: string;
  companyName: string;
  ppCount: number;
  totalAmount: number;
}

export interface PrepaymentData {
  totalRows: number;
  totalAmount: number;
  byMonth: PrepaymentByMonth[];
  topClients: PrepaymentClient[];
}
