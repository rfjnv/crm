import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, theme as antTheme } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import PrivateRoute from './components/PrivateRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import DealsPage from './pages/DealsPage';
import DealCreatePage from './pages/DealCreatePage';
import DealDetailPage from './pages/DealDetailPage';
import ClosedDealsPage from './pages/ClosedDealsPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ProductsPage from './pages/ProductsPage';
import WarehousePage from './pages/WarehousePage';
import MovementsPage from './pages/MovementsPage';
import UsersPage from './pages/UsersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DebtsPage from './pages/DebtsPage';
import DayClosingPage from './pages/DayClosingPage';
import DealClosingPage from './pages/DealClosingPage';
import NotificationsPage from './pages/NotificationsPage';
import BroadcastPage from './pages/BroadcastPage';
import FinanceReviewPage from './pages/FinanceReviewPage';
import ShipmentPage from './pages/ShipmentPage';
import StockConfirmationPage from './pages/StockConfirmationPage';
import MessagesPage from './pages/MessagesPage';
import RevenueTodayPage from './pages/RevenueTodayPage';
import ExpensesPage from './pages/ExpensesPage';
import TasksPage from './pages/TasksPage';
import { useThemeStore } from './store/themeStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

export default function App() {
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    const bg = mode === 'dark' ? '#1e1e1e' : '#f5f6f8';
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  }, [mode]);

  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        algorithm: mode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#22609A',
          colorBgLayout: mode === 'dark' ? '#1e1e1e' : '#f5f6f8',
          colorBorderSecondary: mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
          colorSplit: mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
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
            <Route element={<PrivateRoute />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/revenue/today" element={<RevenueTodayPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientDetailPage />} />
                <Route path="/deals" element={<DealsPage />} />
                <Route path="/deals/new" element={<DealCreatePage />} />
                <Route path="/deals/closed" element={<ClosedDealsPage />} />
                <Route path="/deals/:id" element={<DealDetailPage />} />
                <Route path="/inventory/products" element={<ProductsPage />} />
                <Route path="/inventory/warehouse" element={<WarehousePage />} />
                <Route path="/inventory/movements" element={<MovementsPage />} />
                <Route path="/inventory/approvals" element={<ApprovalsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/finance/debts" element={<DebtsPage />} />
                <Route path="/finance/review" element={<FinanceReviewPage />} />
                <Route path="/finance/expenses" element={<ExpensesPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/finance/deal-closing" element={<DealClosingPage />} />
                <Route path="/finance/day-closing" element={<DayClosingPage />} />
                <Route path="/shipment" element={<ShipmentPage />} />
                <Route path="/stock-confirmation" element={<StockConfirmationPage />} />
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
