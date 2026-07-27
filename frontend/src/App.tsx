import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, theme as antTheme, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { authApi } from './api/auth.api';
import { useAuthStore } from './store/authStore';
import { getTelegramInitData, initTelegramWebApp } from './lib/telegramWebApp';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import DefaultHomeRedirect from './components/DefaultHomeRedirect';
import LoginPage from './pages/LoginPage';
import RatePage from './pages/RatePage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import DuplicateClientsPage from './pages/DuplicateClientsPage';
import DealsPage from './pages/DealsPage';
import DealCreatePage from './pages/DealCreatePage';
import DealDetailPage from './pages/DealDetailPage';
import DealOverridePage from './pages/DealOverridePage';
import ClosedDealsPage from './pages/ClosedDealsPage';
import DealApprovalPage from './pages/DealApprovalPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ProductsPage from './pages/ProductsPage';
import WarehousePage from './pages/WarehousePage';
import MovementsPage from './pages/MovementsPage';
import UsersPage from './pages/UsersPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminInquiriesPage from './pages/AdminInquiriesPage';
import AdminSiteContentPage from './pages/site-admin/AdminSiteContentPage';
import AdminSiteProductsPage from './pages/site-admin/AdminSiteProductsPage';
import AdminSiteServicesPage from './pages/site-admin/AdminSiteServicesPage';
import AdminSiteBlogPage from './pages/site-admin/AdminSiteBlogPage';
import TeamPage from './pages/TeamPage';
import ProfilePage from './pages/ProfilePage';
import AnalyticsPage from './pages/AnalyticsPage';
import DebtsPage from './pages/DebtsPage';
import NotificationsPage from './pages/NotificationsPage';
import BroadcastPage from './pages/BroadcastPage';
import FinanceReviewPage from './pages/FinanceReviewPage';
import WarehouseShipmentsPage from './pages/WarehouseShipmentsPage';
import StockConfirmationPage from './pages/StockConfirmationPage';
import MessagesPage from './pages/MessagesPage';
import RevenueTodayPage from './pages/RevenueTodayPage';
import ExpensesPage from './pages/ExpensesPage';
import AttendancePage from './pages/AttendancePage';
import TasksPage from './pages/TasksPage';
import ContractsPage from './pages/ContractsPage';
import ArchivedDealsPage from './pages/ArchivedDealsPage';
import CashboxPage from './pages/CashboxPage';
import CompanyBalancePage from './pages/CompanyBalancePage';
import ContractDetailPage from './pages/ContractDetailPage';
import PowerOfAttorneyPage from './pages/PowerOfAttorneyPage';
import ProductDetailPage from './pages/ProductDetailPage';
import CompanySettingsPage from './pages/CompanySettingsPage';
import HistoryAnalyticsPage from './pages/HistoryAnalyticsPage';
import CallActivityPage from './pages/CallActivityPage';
import ContactMatrixPage from './pages/ContactMatrixPage';
import ClientActivityMatrixPage from './pages/ClientActivityMatrixPage';
import ReanimationPage from './pages/ReanimationPage';
import DeadProductsPage from './pages/DeadProductsPage';
import LaminationKgUsagePage from './pages/LaminationKgUsagePage';
import PaymentOverduePage from './pages/PaymentOverduePage';
import MarketAnalysisPage from './pages/MarketAnalysisPage';
import ReviewsPage from './pages/ReviewsPage';
import WarehouseManagerPage from './pages/WarehouseManagerPage';
import MyLoadingTasksPage from './pages/MyLoadingTasksPage';
import MyVehiclePage from './pages/MyVehiclePage';
import AiAssistantPage from './pages/AiAssistantPage';
import AiTrainingPage from './pages/AiTrainingPage';
import AudioTranscriptionPage from './pages/AudioTranscriptionPage';
import CallAuditDashboardPage from './pages/CallAuditDashboardPage';
import NoteAuditPage from './pages/NoteAuditPage';
import NotesBoardPage from './pages/NotesBoardPage';
import SuppliersPage from './pages/SuppliersPage';
import SupplierDetailPage from './pages/SupplierDetailPage';
import ImportOrdersPage from './pages/ImportOrdersPage';
import ImportOrderDetailPage from './pages/ImportOrderDetailPage';
import ExchangeRatesHistoryPage from './pages/ExchangeRatesHistoryPage';
import VedProcessBoardPage from './pages/VedProcessBoardPage';
import VedMapPage from './pages/VedMapPage';
import WorkerAuditPage from './pages/WorkerAuditPage';
import AuditCheckPage from './pages/AuditCheckPage';
import AuditStockPage from './pages/AuditStockPage';
import ActivityLogPage from './pages/ActivityLogPage';
import AlmanacSalesPage from './pages/AlmanacSalesPage';
import AlmanacClientsPage from './pages/AlmanacClientsPage';
import AlmanacProductsPage from './pages/AlmanacProductsPage';
import AlmanacDebtsPage from './pages/AlmanacDebtsPage';
import AlmanacProductDetailPage from './pages/AlmanacProductDetailPage';
import DepartmentReportPage from './pages/DepartmentReportPage';
import ChangelogPage from './pages/ChangelogPage';
import { useThemeStore } from './store/themeStore';
import { applyDocumentTheme } from './theme/applyDocumentTheme';
import { antDesignTokens } from './theme/tokens';
import type { ThemeMode } from './theme/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

export default function App() {
  const mode = useThemeStore((s) => s.mode);
  const [tgAuthChecking, setTgAuthChecking] = useState(true);

  useEffect(() => {
    applyDocumentTheme(mode as ThemeMode);
  }, [mode]);

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
      theme={{
        algorithm: mode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#22609A',
          ...antDesignTokens[mode as ThemeMode],
        },
        components: {
          Menu: {
            itemMarginBlock: 2,
            groupTitleFontSize: 11,
            groupTitleColor: mode === 'dark' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.35)',
            itemSelectedBg: mode === 'dark' ? 'rgba(34, 96, 154, 0.35)' : 'rgba(34, 96, 154, 0.12)',
            itemSelectedColor: mode === 'dark' ? '#5BA4DE' : '#1A4F80',
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/rate/:token" element={<RatePage />} />
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
                <Route path="/revenue/today" element={<RevenueTodayPage />} />
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
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/history-analytics" element={<HistoryAnalyticsPage />} />
                  <Route path="/analytics/market" element={<MarketAnalysisPage />} />
                  <Route path="/analytics/department-report" element={<DepartmentReportPage />} />
                  <Route path="/analytics/price-comparison" element={<Navigate to="/analytics/market" replace />} />
                  <Route path="/analytics/unique-products" element={<Navigate to="/analytics/market" replace />} />
                  <Route path="/settings/company" element={<CompanySettingsPage />} />
                  <Route path="/deals/archived" element={<ArchivedDealsPage />} />
                  <Route path="/attendance" element={<AttendancePage />} />
                </Route>
                <Route path="/finance/debts" element={<DebtsPage />} />
                <Route path="/finance/review" element={<FinanceReviewPage />} />
                <Route path="/finance/expenses" element={<ExpensesPage />} />
                <Route path="/finance/cashbox" element={<CashboxPage />} />
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE_MANAGER']} />}>
                  <Route path="/finance/balance" element={<CompanyBalancePage />} />
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
                  <Route path="/ai-assistant" element={<AiAssistantPage />} />
                  <Route path="/ai-assistant/training" element={<AiTrainingPage />} />
                  <Route path="/ai-assistant/transcribe" element={<AudioTranscriptionPage />} />
                  <Route path="/ai-assistant/call-audits" element={<CallAuditDashboardPage />} />
                </Route>
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
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
