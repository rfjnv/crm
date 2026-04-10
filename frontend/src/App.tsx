import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, theme as antTheme } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RatePage from './pages/RatePage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
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
import TasksPage from './pages/TasksPage';
import ContractsPage from './pages/ContractsPage';
import ArchivedDealsPage from './pages/ArchivedDealsPage';
import CashboxPage from './pages/CashboxPage';
import ContractDetailPage from './pages/ContractDetailPage';
import PowerOfAttorneyPage from './pages/PowerOfAttorneyPage';
import ProductDetailPage from './pages/ProductDetailPage';
import CompanySettingsPage from './pages/CompanySettingsPage';
import HistoryAnalyticsPage from './pages/HistoryAnalyticsPage';
import CallActivityPage from './pages/CallActivityPage';
import ClientActivityMatrixPage from './pages/ClientActivityMatrixPage';
import ReviewsPage from './pages/ReviewsPage';
import WarehouseManagerPage from './pages/WarehouseManagerPage';
import MyLoadingTasksPage from './pages/MyLoadingTasksPage';
import MyVehiclePage from './pages/MyVehiclePage';
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

  useEffect(() => {
    applyDocumentTheme(mode as ThemeMode);
  }, [mode]);

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
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/revenue/today" element={<RevenueTodayPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientDetailPage />} />
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
                <Route path="/inventory/movements" element={<MovementsPage />} />
                <Route path="/inventory/approvals" element={<ApprovalsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN', 'MANAGER']} />}>
                  <Route path="/manager/client-activity" element={<ClientActivityMatrixPage />} />
                  <Route path="/analytics/calls" element={<CallActivityPage />} />
                </Route>
                <Route element={<PrivateRoute permission="view_closed_deals_history" />}>
                  <Route path="/deals/closed" element={<ClosedDealsPage />} />
                </Route>
                <Route element={<PrivateRoute roles={['SUPER_ADMIN', 'ADMIN']} />}>
                  <Route path="/deals/:id/override" element={<DealOverridePage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/history-analytics" element={<HistoryAnalyticsPage />} />
                  <Route path="/settings/company" element={<CompanySettingsPage />} />
                  <Route path="/deals/archived" element={<ArchivedDealsPage />} />
                </Route>
                <Route path="/finance/debts" element={<DebtsPage />} />
                <Route path="/finance/review" element={<FinanceReviewPage />} />
                <Route path="/finance/expenses" element={<ExpensesPage />} />
                <Route path="/finance/cashbox" element={<CashboxPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/shipment" element={<WarehouseShipmentsPage />} />
                <Route path="/warehouse/shipments" element={<Navigate to="/shipment" replace />} />
                <Route path="/stock-confirmation" element={<StockConfirmationPage />} />
                <Route path="/warehouse-manager" element={<WarehouseManagerPage />} />
                <Route path="/pending-admin" element={<Navigate to="/deals/approval?tab=wm" replace />} />
                <Route path="/my-loading-tasks" element={<MyLoadingTasksPage />} />
                <Route path="/my-vehicle" element={<MyVehiclePage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/notifications/broadcast" element={<BroadcastPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  );
}
