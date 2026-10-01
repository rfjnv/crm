import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { authApi } from './api/auth.api';
import { useAuthStore } from './store/authStore';
import { getTelegramInitData, initTelegramWebApp } from './lib/telegramWebApp';
import PrivateRoute from './components/PrivateRoute';
import MoneyAccessGuard from './components/MoneyAccessGuard';
import { AI_ACCESS_TEXT } from './lib/moneyAccess';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import DefaultHomeRedirect from './components/DefaultHomeRedirect';
import LoginPage from './pages/LoginPage';
import ViewportInfoPage from './pages/ViewportInfoPage';
import { useThemeStore } from './store/themeStore';
import { applyDocumentTheme } from './theme/applyDocumentTheme';
import { antThemeConfig } from './theme/tokens';
import type { ThemeMode } from './theme/tokens';

// Страницы грузятся отдельными чанками: иначе весь CRM (~5 МБ JS) скачивается и разбирается при первом открытии.
const RatePage = lazy(() => import('./pages/RatePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'));
const DuplicateClientsPage = lazy(() => import('./pages/DuplicateClientsPage'));
const DealsPage = lazy(() => import('./pages/DealsPage'));
const DealCreatePage = lazy(() => import('./pages/DealCreatePage'));
const DealDetailPage = lazy(() => import('./pages/DealDetailPage'));
const DealOverridePage = lazy(() => import('./pages/DealOverridePage'));
const ClosedDealsPage = lazy(() => import('./pages/ClosedDealsPage'));
const DealApprovalPage = lazy(() => import('./pages/DealApprovalPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const ProductGroupsPage = lazy(() => import('./pages/ProductGroupsPage'));
const WarehousePage = lazy(() => import('./pages/WarehousePage'));
const MovementsPage = lazy(() => import('./pages/MovementsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const AdminInquiriesPage = lazy(() => import('./pages/AdminInquiriesPage'));
const AdminSiteContentPage = lazy(() => import('./pages/site-admin/AdminSiteContentPage'));
const AdminSiteProductsPage = lazy(() => import('./pages/site-admin/AdminSiteProductsPage'));
const AdminSiteServicesPage = lazy(() => import('./pages/site-admin/AdminSiteServicesPage'));
const AdminSiteBlogPage = lazy(() => import('./pages/site-admin/AdminSiteBlogPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage'));
const FinanceReviewPage = lazy(() => import('./pages/FinanceReviewPage'));
const WarehouseShipmentsPage = lazy(() => import('./pages/WarehouseShipmentsPage'));
const StockConfirmationPage = lazy(() => import('./pages/StockConfirmationPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const RevenueTodayPage = lazy(() => import('./pages/RevenueTodayPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const ArchivedDealsPage = lazy(() => import('./pages/ArchivedDealsPage'));
const CashboxPage = lazy(() => import('./pages/CashboxPage'));
const CompanyBalancePage = lazy(() => import('./pages/CompanyBalancePage'));
const ContractDetailPage = lazy(() => import('./pages/ContractDetailPage'));
const PowerOfAttorneyPage = lazy(() => import('./pages/PowerOfAttorneyPage'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const CompanySettingsPage = lazy(() => import('./pages/CompanySettingsPage'));
const HistoryAnalyticsPage = lazy(() => import('./pages/HistoryAnalyticsPage'));
const CallActivityPage = lazy(() => import('./pages/CallActivityPage'));
const ContactMatrixPage = lazy(() => import('./pages/ContactMatrixPage'));
const ClientActivityMatrixPage = lazy(() => import('./pages/ClientActivityMatrixPage'));
const ReanimationPage = lazy(() => import('./pages/ReanimationPage'));
const DeadProductsPage = lazy(() => import('./pages/DeadProductsPage'));
const LaminationKgUsagePage = lazy(() => import('./pages/LaminationKgUsagePage'));
const PaymentOverduePage = lazy(() => import('./pages/PaymentOverduePage'));
const MarketAnalysisPage = lazy(() => import('./pages/MarketAnalysisPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const WarehouseManagerPage = lazy(() => import('./pages/WarehouseManagerPage'));
const MyLoadingTasksPage = lazy(() => import('./pages/MyLoadingTasksPage'));
const MyVehiclePage = lazy(() => import('./pages/MyVehiclePage'));
const AiAssistantPage = lazy(() => import('./pages/AiAssistantPage'));
const RopAgentPage = lazy(() => import('./pages/RopAgentPage'));
const RopDigestPage = lazy(() => import('./pages/RopDigestPage'));
const AiTrainingPage = lazy(() => import('./pages/AiTrainingPage'));
const AudioTranscriptionPage = lazy(() => import('./pages/AudioTranscriptionPage'));
const CallAuditDashboardPage = lazy(() => import('./pages/CallAuditDashboardPage'));
const NoteAuditPage = lazy(() => import('./pages/NoteAuditPage'));
const NotesBoardPage = lazy(() => import('./pages/NotesBoardPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const SupplierDetailPage = lazy(() => import('./pages/SupplierDetailPage'));
const ImportOrdersPage = lazy(() => import('./pages/ImportOrdersPage'));
const ImportOrderDetailPage = lazy(() => import('./pages/ImportOrderDetailPage'));
const ExchangeRatesHistoryPage = lazy(() => import('./pages/ExchangeRatesHistoryPage'));
const VedProcessBoardPage = lazy(() => import('./pages/VedProcessBoardPage'));
const VedMapPage = lazy(() => import('./pages/VedMapPage'));
const WorkerAuditPage = lazy(() => import('./pages/WorkerAuditPage'));
const AuditCheckPage = lazy(() => import('./pages/AuditCheckPage'));
const AuditStockPage = lazy(() => import('./pages/AuditStockPage'));
const ActivityLogPage = lazy(() => import('./pages/ActivityLogPage'));
const AlmanacSalesPage = lazy(() => import('./pages/AlmanacSalesPage'));
const AlmanacClientsPage = lazy(() => import('./pages/AlmanacClientsPage'));
const AlmanacProductsPage = lazy(() => import('./pages/AlmanacProductsPage'));
const AlmanacDebtsPage = lazy(() => import('./pages/AlmanacDebtsPage'));
const AlmanacProductDetailPage = lazy(() => import('./pages/AlmanacProductDetailPage'));
const DepartmentReportPage = lazy(() => import('./pages/DepartmentReportPage'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Раньше каждый возврат на вкладку разом перезапрашивал всё открытое, а при
      // переходах между страницами те же данные качались заново. Бэкенд один и слабый —
      // свежесть обеспечивают точечные refetchInterval и инвалидация после мутаций.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
// Справочник товаров (~250 КБ) нужен на многих страницах и меняется редко; после правок
// товаров он и так инвалидируется — иначе каждая страница перекачивала его заново.
queryClient.setQueryDefaults(['products'], { staleTime: 5 * 60_000 });

export default function App() {
  const mode = useThemeStore((s) => s.mode);
  const design = useThemeStore((s) => s.design);
  const antTheme = useMemo(() => antThemeConfig(design, mode as ThemeMode), [design, mode]);
  const [tgAuthChecking, setTgAuthChecking] = useState(true);

  useEffect(() => {
    applyDocumentTheme(mode as ThemeMode, design);
  }, [mode, design]);

  // Автовход, если CRM открыта как Telegram Web App (кнопка меню бота)
  useEffect(() => {
    initTelegramWebApp();
    const initData = getTelegramInitData();
    if (!initData || useAuthStore.getState().user) {
      setTgAuthChecking(false);
      return;
    }
    (async () => {
      try {
        const tokens = await authApi.telegramWebApp(initData);
        useAuthStore.getState().setTokens(tokens.accessToken, tokens.refreshToken);
        const user = await authApi.me();
        useAuthStore.getState().setAuth({ ...user, authSource: 'crm' }, tokens.accessToken, tokens.refreshToken);
      } catch {
        // Telegram-аккаунт не привязан к CRM — пользователь увидит обычный экран входа
      } finally {
        setTgAuthChecking(false);
      }
    })();
  }, []);

  if (tgAuthChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ConfigProvider
      locale={ruRU}
      theme={antTheme}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense
            fallback={(
              <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" />
              </div>
            )}
          >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/rate/:token" element={<RatePage />} />
            {/* Без авторизации: цифры нужны с панели и WebView, где нет консоли */}
            <Route path="/viewport" element={<ViewportInfoPage />} />
            <Route element={<PrivateRoute />}>
              <Route element={<PrivateRoute supabaseAuthOnly />}>
                <Route element={<AdminLayout />}>
                  <Route path="/admin" element={<AdminDashboardPage />} />
                  <Route path="/admin/content" element={<AdminSiteContentPage />} />
                  <Route path="/admin/products" element={<AdminSiteProductsPage />} />
                  <Route path="/admin/services" element={<AdminSiteServicesPage />} />
                  <Route path="/admin/blog" element={<AdminSiteBlogPage />} />
                  <Route path="/admin/inquiries" element={<AdminInquiriesPage />} />
                  <Route path="/admin/users" element={<AdminUsersPage />} />
                </Route>
              </Route>
              <Route element={<PrivateRoute crmStaffOnly />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/revenue/today" element={<MoneyAccessGuard><RevenueTodayPage /></MoneyAccessGuard>} />
                <Route element={<PrivateRoute permission="view_all_clients" />}>
                  <Route path="/clients" element={<ClientsPage />} />
                  <Route path="/clients/:id" element={<ClientDetailPage />} />
                </Route>
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN']} />}>
                  <Route path="/clients/duplicates" element={<DuplicateClientsPage />} />
                </Route>
                <Route path="/reviews" element={<ReviewsPage />} />
                <Route path="/contracts" element={<ContractsPage />} />
                <Route path="/contracts/:id" element={<ContractDetailPage />} />
                <Route path="/power-of-attorney" element={<PowerOfAttorneyPage />} />
                <Route path="/deals" element={<DealsPage />} />
                <Route path="/deals/new" element={<DealCreatePage />} />
                <Route path="/deals/approval" element={<DealApprovalPage />} />
                <Route path="/deals/:id" element={<DealDetailPage />} />
                <Route path="/inventory/products" element={<ProductsPage />} />
                <Route path="/inventory/groups" element={<ProductGroupsPage />} />
                <Route path="/inventory/products/:id" element={<ProductDetailPage />} />
                <Route path="/inventory/warehouse" element={<WarehousePage />} />
                <Route path="/inventory/audit-check" element={<AuditStockPage />} />
                <Route path="/inventory/movements" element={<MovementsPage />} />
                <Route path="/inventory/approvals" element={<ApprovalsPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN']} />}>
                  <Route path="/users" element={<UsersPage />} />
                </Route>
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/changelog" element={<ChangelogPage />} />
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR']} />}>
                  <Route path="/manager/client-activity" element={<ClientActivityMatrixPage />} />
                  <Route path="/manager/reanimation" element={<ReanimationPage />} />
                  <Route path="/manager/dead-products" element={<DeadProductsPage />} />
                  <Route path="/manager/payment-overdue" element={<PaymentOverduePage />} />
                  <Route path="/analytics/calls" element={<CallActivityPage />} />
                </Route>
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN']} />}>
                  <Route path="/analytics/contact-matrix" element={<ContactMatrixPage />} />
                  <Route path="/analytics/note-audit" element={<NoteAuditPage />} />
                  <Route path="/analytics/lamination-kg-usage" element={<LaminationKgUsagePage />} />
                </Route>
                <Route element={<PrivateRoute permission="view_closed_deals_history" />}>
                  <Route path="/deals/closed" element={<ClosedDealsPage />} />
                </Route>
                <Route element={<PrivateRoute roles={['SUPER_ADMIN']} />}>
                  <Route path="/admin/activity-log" element={<ActivityLogPage />} />
                </Route>
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN']} />}>
                  <Route path="/worker-audit" element={<WorkerAuditPage />} />
                  <Route path="/deals/audit-check" element={<AuditCheckPage />} />
                  <Route path="/deals/:id/override" element={<DealOverridePage />} />
                  <Route path="/analytics" element={<MoneyAccessGuard><AnalyticsPage /></MoneyAccessGuard>} />
                  <Route path="/history-analytics" element={<HistoryAnalyticsPage />} />
                  <Route path="/analytics/market" element={<MarketAnalysisPage />} />
                  <Route path="/analytics/department-report" element={<MoneyAccessGuard><DepartmentReportPage /></MoneyAccessGuard>} />
                  <Route path="/analytics/price-comparison" element={<Navigate to="/analytics/market" replace />} />
                  <Route path="/analytics/unique-products" element={<Navigate to="/analytics/market" replace />} />
                  <Route path="/settings/company" element={<CompanySettingsPage />} />
                  <Route path="/deals/archived" element={<ArchivedDealsPage />} />
                  <Route path="/attendance" element={<AttendancePage />} />
                </Route>
                <Route path="/finance/review" element={<FinanceReviewPage />} />
                <Route path="/finance/expenses" element={<MoneyAccessGuard><ExpensesPage /></MoneyAccessGuard>} />
                {/* Роли совпадают с FINANCE_ROLES на бэкенде и с условием показа пункта меню:
                    иначе по прямой ссылке страница открывалась, а API отвечал 403. */}
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'WAREHOUSE_MANAGER', 'OPERATOR']} />}>
                  {/* Отдельная страница долгов дублировала вкладку в Кассе и уже разошлась
                      с ней по поведению. Ссылки продолжают работать через редирект. */}
                  <Route path="/finance/debts" element={<Navigate to="/finance/cashbox?tab=debtors" replace />} />
                  <Route path="/finance/cashbox" element={<MoneyAccessGuard><CashboxPage /></MoneyAccessGuard>} />
                </Route>
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER']} />}>
                  <Route path="/finance/balance" element={<MoneyAccessGuard><CompanyBalancePage /></MoneyAccessGuard>} />
                </Route>
                <Route path="/almanac/sales" element={<AlmanacSalesPage />} />
                <Route path="/almanac/clients" element={<AlmanacClientsPage />} />
                <Route path="/almanac/products" element={<AlmanacProductsPage />} />
                <Route path="/almanac/products/:id" element={<AlmanacProductDetailPage />} />
                <Route path="/almanac/debts" element={<AlmanacDebtsPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR']} />}>
                  <Route path="/notes-board" element={<NotesBoardPage />} />
                </Route>
                <Route path="/shipment" element={<WarehouseShipmentsPage />} />
                <Route path="/warehouse/shipments" element={<Navigate to="/shipment" replace />} />
                <Route path="/stock-confirmation" element={<StockConfirmationPage />} />
                <Route path="/warehouse-manager" element={<WarehouseManagerPage />} />
                <Route path="/pending-admin" element={<Navigate to="/deals/approval?tab=wm" replace />} />
                <Route path="/my-loading-tasks" element={<MyLoadingTasksPage />} />
                <Route path="/my-vehicle" element={<MyVehiclePage />} />
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR', 'FOREIGN_TRADE']} />}>
                  <Route path="/ai-assistant" element={<MoneyAccessGuard text={AI_ACCESS_TEXT}><AiAssistantPage /></MoneyAccessGuard>} />
                  <Route path="/ai-assistant/training" element={<MoneyAccessGuard text={AI_ACCESS_TEXT}><AiTrainingPage /></MoneyAccessGuard>} />
                  <Route path="/ai-assistant/transcribe" element={<MoneyAccessGuard text={AI_ACCESS_TEXT}><AudioTranscriptionPage /></MoneyAccessGuard>} />
                  <Route path="/ai-assistant/call-audits" element={<MoneyAccessGuard text={AI_ACCESS_TEXT}><CallAuditDashboardPage /></MoneyAccessGuard>} />
                </Route>
                {/* Доступ поимённо (право use_rop_agent) проверяет сервер; меню показывает пункт только им. */}
                <Route path="/rop-agent" element={<MoneyAccessGuard text={AI_ACCESS_TEXT}><RopAgentPage /></MoneyAccessGuard>} />
                <Route path="/rop-agent/digest" element={<MoneyAccessGuard text={AI_ACCESS_TEXT}><RopDigestPage /></MoneyAccessGuard>} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/notifications/broadcast" element={<BroadcastPage />} />
                <Route element={<PrivateRoute permission="view_import_orders" />}>
                  <Route path="/foreign-trade/suppliers" element={<SuppliersPage />} />
                  <Route path="/foreign-trade/suppliers/:id" element={<SupplierDetailPage />} />
                  <Route path="/foreign-trade/import-orders" element={<ImportOrdersPage />} />
                  <Route path="/foreign-trade/import-orders/:id" element={<ImportOrderDetailPage />} />
                  <Route path="/foreign-trade/exchange-rates" element={<ExchangeRatesHistoryPage />} />
                  <Route path="/foreign-trade/process-board" element={<VedProcessBoardPage />} />
                  <Route path="/foreign-trade/map" element={<VedMapPage />} />
                </Route>
              </Route>
              </Route>
            </Route>
            <Route path="*" element={<DefaultHomeRedirect />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
