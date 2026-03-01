import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Card, Col, Row, Statistic, Table, Typography, Spin, theme, Input, Select, Segmented,
  Tooltip, Tag, Tabs, Drawer,
} from 'antd';
import {
  DollarOutlined, TeamOutlined, ShoppingOutlined, RiseOutlined,
  WarningOutlined, BarChartOutlined, CalendarOutlined, SwapOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Area, Pie, Bar, Line } from '@ant-design/charts';
import { analyticsApi } from '../api/analytics.api';
import { useThemeStore } from '../store/themeStore';
import type {
  HistoryTopClient, HistoryTopProduct, HistoryManager, HistoryDebtor,
  HistoryClientActivity, HistoryClientSegment,
  ExchangeProduct, ExchangeClient, PrepaymentClient,
} from '../types';

const { Title } = Typography;

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные', TRANSFER: 'Перечисление', QR: 'QR',
  PAYME: 'Payme', CLICK: 'Click', TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка', 'Не указан': 'Не указан',
};

const SEGMENT_COLORS_LIGHT: Record<string, string> = {
  VIP: '#722ed1', Regular: '#1677ff', New: '#52c41a', 'At-Risk': '#fa8c16', Churned: '#ff4d4f',
};
const SEGMENT_COLORS_DARK: Record<string, string> = {
  VIP: '#9254de', Regular: '#4096ff', New: '#73d13d', 'At-Risk': '#ffc069', Churned: '#ff7875',
};
const SEGMENT_LABELS: Record<string, string> = {
  VIP: 'VIP', Regular: 'Постоянный', New: 'Новый', 'At-Risk': 'В зоне риска', Churned: 'Ушедший',
};

const OP_TYPE_LABELS: Record<string, string> = {
  K: 'Карз (к)', N: 'Наличные (н)', NK: 'Н/К', P: 'Перечисление (п)',
  PK: 'П/К', PP: 'Предоплата (пп)', EXCHANGE: 'Обмен', F: 'Фактура (ф)',
  UNKNOWN: 'Неизвестно', 'НЕ УКАЗАН': 'Не указан',
};

function fmtNum(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)} млрд`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} млн`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)} тыс`;
  return n.toLocaleString('ru-RU');
}

// Reverse-lookup: find original method key from its label
const METHOD_LABEL_TO_KEY: Record<string, string> = {};
for (const [k, v] of Object.entries(METHOD_LABELS)) METHOD_LABEL_TO_KEY[v] = k;

export default function HistoryAnalyticsPage() {
  const { token } = theme.useToken();
  const mode = useThemeStore((s) => s.mode);
  const isDark = mode === 'dark';
  const SEGMENT_COLORS = isDark ? SEGMENT_COLORS_DARK : SEGMENT_COLORS_LIGHT;
  const navigate = useNavigate();

  // ── All hooks before any conditional return ──
  const [activeTab, setActiveTab] = useState('overview');
  const [kpiDrawer, setKpiDrawer] = useState<string | null>(null);
  const [monthDrawer, setMonthDrawer] = useState<number | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [segmentFilter, setSegmentFilter] = useState<string[]>([]);
  const [dqSearch, setDqSearch] = useState('');
  const [dqOpTypeFilter, setDqOpTypeFilter] = useState<string[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());

  // New drawer states
  const [cellDrawer, setCellDrawer] = useState<{ clientId: string; clientName: string; month: number } | null>(null);
  const [productDrawer, setProductDrawer] = useState<{ productId: string; productName: string } | null>(null);
  const [managerDrawer, setManagerDrawer] = useState<{ managerId: string; managerName: string } | null>(null);
  const [methodDrawer, setMethodDrawer] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['analytics-history', year], queryFn: () => analyticsApi.getHistory(year) });

  const needExtended = activeTab === 'analytics' || activeTab === 'segments';
  const { data: extended } = useQuery({
    queryKey: ['analytics-history-extended', year],
    queryFn: () => analyticsApi.getHistoryExtended(year),
    enabled: needExtended,
  });

  const drillType = kpiDrawer === 'deals' || kpiDrawer === 'revenue' || kpiDrawer === 'avg'
    ? 'deals' : kpiDrawer === 'paid' ? 'payments' : null;
  const { data: drilldown } = useQuery({
    queryKey: ['analytics-history-drilldown', drillType, year],
    queryFn: () => analyticsApi.getHistoryDrilldown(drillType!, undefined, year),
    enabled: !!drillType,
  });

  const { data: monthDetail } = useQuery({
    queryKey: ['analytics-history-month', monthDrawer, year],
    queryFn: () => analyticsApi.getHistoryMonth(monthDrawer!, year),
    enabled: !!monthDrawer,
  });

  // Client-month purchases drawer query
  const { data: clientMonthData, isLoading: clientMonthLoading } = useQuery({
    queryKey: ['analytics-history-client-month', cellDrawer?.clientId, cellDrawer?.month, year],
    queryFn: () => analyticsApi.getHistoryClientMonth(cellDrawer!.clientId, cellDrawer!.month, year),
    enabled: !!cellDrawer,
  });

  // Product buyers drawer query
  const { data: productBuyersData, isLoading: productBuyersLoading } = useQuery({
    queryKey: ['analytics-history-product-buyers', productDrawer?.productId, year],
    queryFn: () => analyticsApi.getHistoryProductBuyers(productDrawer!.productId, year),
    enabled: !!productDrawer,
  });

  // Manager drilldown query
  const { data: managerDrilldown, isLoading: managerDrillLoading } = useQuery({
    queryKey: ['analytics-history-drilldown-manager', managerDrawer?.managerId, year],
    queryFn: () => analyticsApi.getHistoryDrilldown('deals', { managerId: managerDrawer!.managerId }, year),
    enabled: !!managerDrawer,
  });

  // Method drilldown query
  const { data: methodDrilldown, isLoading: methodDrillLoading } = useQuery({
    queryKey: ['analytics-history-drilldown-method', methodDrawer, year],
    queryFn: () => analyticsApi.getHistoryDrilldown('payments', { method: methodDrawer! }, year),
    enabled: !!methodDrawer,
  });

  // Data quality queries (loaded only when tab is active)
  const needDataQuality = activeTab === 'dataQuality';
  const { data: dataQuality } = useQuery({
    queryKey: ['analytics-history-data-quality', year],
    queryFn: () => analyticsApi.getHistoryDataQuality(year),
    enabled: needDataQuality,
  });
  const { data: exchangeData } = useQuery({
    queryKey: ['analytics-history-exchange', year],
    queryFn: () => analyticsApi.getHistoryExchange(year),
    enabled: needDataQuality,
  });
  const { data: prepaymentData } = useQuery({
    queryKey: ['analytics-history-prepayments', year],
    queryFn: () => analyticsApi.getHistoryPrepayments(year),
    enabled: needDataQuality,
  });

  const filteredActivity = useMemo(() => {
    let list = data?.clientActivity || [];
    if (selectedClients.length > 0) list = list.filter((c) => selectedClients.includes(c.clientId));
    if (activitySearch.trim()) {
      const lower = activitySearch.trim().toLowerCase();
      list = list.filter((c) => c.companyName.toLowerCase().includes(lower));
    }
    return list;
  }, [data?.clientActivity, selectedClients, activitySearch]);

  const filteredSegments = useMemo(() => {
    let list = extended?.clientSegments || [];
    if (segmentFilter.length > 0) list = list.filter((c) => segmentFilter.includes(c.segment));
    return list;
  }, [extended?.clientSegments, segmentFilter]);

  const filteredProblemRows = useMemo(() => {
    let list = dataQuality?.problemRows || [];
    if (dqOpTypeFilter.length > 0) list = list.filter((r) => dqOpTypeFilter.includes(r.opType));
    if (dqSearch.trim()) {
      const lower = dqSearch.trim().toLowerCase();
      list = list.filter((r) =>
        r.productName.toLowerCase().includes(lower) ||
        r.companyName.toLowerCase().includes(lower) ||
        r.managerName.toLowerCase().includes(lower)
      );
    }
    return list;
  }, [dataQuality?.problemRows, dqOpTypeFilter, dqSearch]);

  // Compute max monthly revenue for activity matrix color gradient
  const maxMonthRevenue = useMemo(() => {
    const allRevenues = (data?.clientActivity || []).flatMap((c) => c.monthlyData.map((md) => md.revenue));
    return allRevenues.reduce((a, b) => Math.max(a, b), 1);
  }, [data?.clientActivity]);

  // Only show months that have data (e.g. for 2026 with Jan+Feb only → [1, 2])
  const visibleMonths = useMemo(() => {
    if (!data?.monthlyTrend?.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const maxMonth = Math.max(...data.monthlyTrend.map((m) => m.month));
    return Array.from({ length: maxMonth }, (_, i) => i + 1);
  }, [data?.monthlyTrend]);

  if (isLoading || !data) {
    return <div style={{ textAlign: 'center', marginTop: 120 }}><Spin size="large" /></div>;
  }

  const { overview, monthlyTrend, topClients, topProducts, managers, paymentMethods, debtors, clientActivity } = data;

  console.log('monthlyTrend from API', monthlyTrend);

  const chartTheme = isDark ? 'classicDark' : 'classic';
  const axisStyle = { x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => fmtNum(v) } };
  const axisStyleNoFmt = { x: { labelFill: token.colorText }, y: { labelFill: token.colorText } };
  const clickableRow = { cursor: 'pointer' };

  // ── Chart data ──
  const areaData = monthlyTrend.flatMap((m) => [
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.revenue, type: 'Выручка', _month: m.month },
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.collected, type: 'Оплачено', _month: m.month },
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.shipped, type: 'Отгружено', _month: m.month },
  ]);
  console.log('chartData used by chart', areaData);
  const clientBarData = monthlyTrend.map((m) => ({
    month: MONTH_LABELS[m.month] || `${m.month}`, clients: m.activeClients, _month: m.month,
  }));
  const pieData = paymentMethods.map((pm) => ({
    type: METHOD_LABELS[pm.method] || pm.method, value: pm.total, _method: pm.method,
  }));

  // ── Activity matrix helpers ──
  function getMonthRevenue(record: HistoryClientActivity, month: number): number {
    const md = record.monthlyData.find((d) => d.month === month);
    return md ? md.revenue : 0;
  }
  function getRevenueColor(revenue: number): string {
    if (revenue <= 0) return isDark ? '#2a2a2a' : '#f5f5f5';
    const intensity = Math.min(revenue / maxMonthRevenue, 1);
    return `rgba(56,218,17,${0.2 + intensity * 0.8})`;
  }

  // ── KPI cards config ──
  const kpiCards = [
    { key: 'deals', title: 'Сделок', value: overview.totalDeals, prefix: <ShoppingOutlined />, style: {} },
    { key: 'clients', title: 'Клиентов', value: overview.totalClients, prefix: <TeamOutlined />, style: {} },
    { key: 'revenue', title: 'Выручка', value: overview.totalRevenue, prefix: <DollarOutlined />, style: {}, fmt: true },
    { key: 'paid', title: 'Оплачено', value: overview.totalPaid, prefix: <RiseOutlined />, style: { color: token.colorSuccess }, fmt: true },
    { key: 'debt', title: 'Долг', value: overview.totalDebt, prefix: <WarningOutlined />, style: { color: overview.totalDebt > 0 ? token.colorError : token.colorSuccess }, fmt: true },
    { key: 'avg', title: 'Ср. сделка', value: overview.avgDeal, prefix: <DollarOutlined />, style: {}, fmt: true },
  ];

  // ── Drawer KPI title ──
  const kpiDrawerTitle: Record<string, string> = {
    deals: `Все сделки ${year}`, clients: 'Топ клиенты', revenue: 'Сделки по сумме',
    paid: `Платежи ${year}`, debt: 'Должники', avg: 'Сделки по сумме',
  };

  // ── Drill-down table columns ──
  const dealDrillCols = [
    { title: 'Сделка', dataIndex: 'title', key: 'title', ellipsis: true },
    { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    { title: 'Менеджер', dataIndex: 'managerName', key: 'managerName', width: 130 },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 110, render: (v: number) => fmtNum(v) },
    { title: 'Оплачено', dataIndex: 'paidAmount', key: 'paidAmount', width: 110, render: (v: number) => fmtNum(v) },
    { title: 'Статус', dataIndex: 'status', key: 'status', width: 100 },
  ];
  const paymentDrillCols = [
    { title: 'Сделка', dataIndex: 'dealTitle', key: 'dealTitle', ellipsis: true },
    { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    { title: 'Сумма', dataIndex: 'amount', key: 'amount', width: 120, render: (v: number) => fmtNum(v) },
    { title: 'Метод', dataIndex: 'method', key: 'method', width: 120, render: (v: string) => METHOD_LABELS[v] || v },
    { title: 'Дата', dataIndex: 'paidAt', key: 'paidAt', width: 110, render: (v: string) => new Date(v).toLocaleDateString('ru-RU') },
  ];

  // ── Standard table columns ──
  const clientCols = [
    { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80, sorter: (a: HistoryTopClient, b: HistoryTopClient) => a.dealsCount - b.dealsCount },
    { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => fmtNum(v), sorter: (a: HistoryTopClient, b: HistoryTopClient) => a.revenue - b.revenue },
    { title: 'Оплачено', dataIndex: 'paid', key: 'paid', width: 120, render: (v: number) => fmtNum(v) },
    { title: 'Долг', dataIndex: 'debt', key: 'debt', width: 120, render: (v: number) => <span style={{ color: v > 0 ? token.colorError : token.colorSuccess }}>{fmtNum(v)}</span>, sorter: (a: HistoryTopClient, b: HistoryTopClient) => a.debt - b.debt },
  ];
  const productCols = [
    { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
    { title: 'Товар', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
    { title: 'Кол-во', dataIndex: 'totalQty', key: 'totalQty', width: 100, render: (v: number) => v.toLocaleString('ru-RU'), sorter: (a: HistoryTopProduct, b: HistoryTopProduct) => a.totalQty - b.totalQty },
    { title: 'Выручка', dataIndex: 'totalRevenue', key: 'totalRevenue', width: 120, render: (v: number) => fmtNum(v), sorter: (a: HistoryTopProduct, b: HistoryTopProduct) => a.totalRevenue - b.totalRevenue },
    { title: 'Покупатели', dataIndex: 'uniqueBuyers', key: 'uniqueBuyers', width: 100, sorter: (a: HistoryTopProduct, b: HistoryTopProduct) => a.uniqueBuyers - b.uniqueBuyers },
  ];
  const managerCols = [
    { title: 'Менеджер', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80, sorter: (a: HistoryManager, b: HistoryManager) => a.dealsCount - b.dealsCount },
    { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => fmtNum(v), sorter: (a: HistoryManager, b: HistoryManager) => a.revenue - b.revenue },
    { title: 'Собрано', dataIndex: 'collected', key: 'collected', width: 120, render: (v: number) => fmtNum(v) },
    { title: 'Клиенты', dataIndex: 'clients', key: 'clients', width: 90, sorter: (a: HistoryManager, b: HistoryManager) => a.clients - b.clients },
  ];
  const debtorCols = [
    { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    { title: 'Сумма сделок', dataIndex: 'totalAmount', key: 'totalAmount', width: 130, render: (v: number) => fmtNum(v) },
    { title: 'Оплачено', dataIndex: 'totalPaid', key: 'totalPaid', width: 130, render: (v: number) => fmtNum(v) },
    { title: 'Долг', dataIndex: 'debt', key: 'debt', width: 130, render: (v: number) => <span style={{ color: token.colorError, fontWeight: 600 }}>{fmtNum(v)}</span>, sorter: (a: HistoryDebtor, b: HistoryDebtor) => a.debt - b.debt, defaultSortOrder: 'descend' as const },
  ];

  // ── Activity matrix columns (revenue gradient + clickable) ──
  const activityCols = [
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', fixed: 'left' as const, width: 180, ellipsis: true },
    ...visibleMonths.map((m) => ({
      title: MONTH_LABELS[m], key: `m${m}`, width: 50, align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => {
        const revenue = getMonthRevenue(record, m);
        const bgColor = getRevenueColor(revenue);
        const isClickable = revenue > 0;
        const intensity = revenue > 0 ? Math.min(revenue / maxMonthRevenue, 1) : 0;
        return (
          <Tooltip title={`${MONTH_LABELS[m]}: ${revenue > 0 ? fmtNum(revenue) : 'Нет данных'}`}>
            <div
              style={{
                width: 28, height: 28, borderRadius: 4, backgroundColor: bgColor, margin: '0 auto',
                cursor: isClickable ? 'pointer' : 'default',
                color: intensity > 0.5 ? '#fff' : undefined,
              }}
              onClick={isClickable ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: m }) : undefined}
            />
          </Tooltip>
        );
      },
    })),
    {
      title: 'Мес.', key: 'total', width: 55, align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => <Tag color="blue">{record.activeMonths.length}</Tag>,
      sorter: (a: HistoryClientActivity, b: HistoryClientActivity) => a.activeMonths.length - b.activeMonths.length,
    },
  ];

  // ── Segment activity columns (with segment tag + clickable) ──
  const segmentActivityCols = [
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', fixed: 'left' as const, width: 180, ellipsis: true },
    {
      title: 'Сегмент', dataIndex: 'segment', key: 'segment', width: 120,
      render: (v: string) => <Tag color={SEGMENT_COLORS[v]}>{SEGMENT_LABELS[v] || v}</Tag>,
    },
    ...visibleMonths.map((m) => ({
      title: MONTH_LABELS[m], key: `m${m}`, width: 50, align: 'center' as const,
      render: (_: unknown, record: HistoryClientSegment) => {
        const isActive = record.activeMonths.includes(m);
        return (
          <Tooltip title={`${MONTH_LABELS[m]}: ${isActive ? 'Активен' : 'Неактивен'}`}>
            <div style={{ width: 28, height: 28, borderRadius: 4, backgroundColor: isActive ? SEGMENT_COLORS[record.segment] : (token.colorBgContainerDisabled || '#f0f0f0'), margin: '0 auto' }} />
          </Tooltip>
        );
      },
    })),
    {
      title: 'Мес.', key: 'total', width: 55, align: 'center' as const,
      render: (_: unknown, record: HistoryClientSegment) => <Tag color="blue">{record.activeMonths.length}</Tag>,
      sorter: (a: HistoryClientSegment, b: HistoryClientSegment) => a.activeMonths.length - b.activeMonths.length,
    },
  ];

  // ── Render KPI drawer content ──
  function renderKpiDrawerContent() {
    if (!kpiDrawer) return null;
    if (kpiDrawer === 'clients') {
      return <Table dataSource={topClients} columns={clientCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 600 }}
        onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })} />;
    }
    if (kpiDrawer === 'debt') {
      return <Table dataSource={debtors} columns={debtorCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 550 }}
        onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })} />;
    }
    if (drillType === 'deals' && drilldown?.deals) {
      return <Table dataSource={drilldown.deals} columns={dealDrillCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 700 }} />;
    }
    if (drillType === 'payments' && drilldown?.payments) {
      return <Table dataSource={drilldown.payments} columns={paymentDrillCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 600 }} />;
    }
    return <Spin />;
  }

  // ── Client-month drawer columns ──
  const clientMonthCols = [
    { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
    { title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 80, render: (v: number) => v.toLocaleString('ru-RU') },
    { title: 'Цена', dataIndex: 'price', key: 'price', width: 100, render: (v: number) => fmtNum(v) },
    { title: 'Итого', dataIndex: 'total', key: 'total', width: 110, render: (v: number) => fmtNum(v) },
    { title: 'Сделка', dataIndex: 'dealTitle', key: 'dealTitle', ellipsis: true },
  ];

  // ── Product buyers drawer columns ──
  const productBuyersCols = [
    { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    { title: 'Кол-во', dataIndex: 'totalQty', key: 'totalQty', width: 100, render: (v: number) => v.toLocaleString('ru-RU') },
    { title: 'Выручка', dataIndex: 'totalRevenue', key: 'totalRevenue', width: 120, render: (v: number) => fmtNum(v) },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80 },
  ];

  // ── TAB 1: Overview ──
  const overviewTab = (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {kpiCards.map((kpi) => (
          <Col xs={12} sm={8} lg={4} key={kpi.key}>
            <Card size="small" hoverable onClick={() => setKpiDrawer(kpi.key)} style={{ cursor: 'pointer' }}>
              <Statistic
                title={kpi.title}
                value={kpi.value}
                prefix={kpi.prefix}
                valueStyle={kpi.style}
                formatter={kpi.fmt ? (val) => fmtNum(Number(val)) : undefined}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Динамика по месяцам" size="small" style={{ marginBottom: 24 }}>
        <Area data={areaData} xField="month" yField="value" colorField="type" height={300}
          shapeField="smooth" style={{ fillOpacity: 0.15 }}
          axis={axisStyle}
          tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => fmtNum(v) }] }}
          legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
          theme={chartTheme}
          onReady={({ chart }) => {
            chart.on('element:click', (ev: { data?: { data?: { _month?: number } } }) => {
              const m = ev?.data?.data?._month;
              if (m) setMonthDrawer(m);
            });
          }}
        />
      </Card>

      <Card title="Активные клиенты по месяцам" size="small" style={{ marginBottom: 24 }}>
        <Bar data={clientBarData} xField="month" yField="clients" height={350} colorField="month"
          axis={axisStyleNoFmt}
          tooltip={{ items: [{ field: 'clients', channel: 'y', name: 'Клиенты' }] }}
          theme={chartTheme}
          onReady={({ chart }) => {
            chart.on('element:click', (ev: { data?: { data?: { _month?: number } } }) => {
              const m = ev?.data?.data?._month;
              if (m) setMonthDrawer(m);
            });
          }}
        />
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="Топ-30 клиентов по выручке" size="small" style={{ height: '100%' }}>
            <Table dataSource={topClients} columns={clientCols} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 600 }}
              onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Способы оплаты" size="small" style={{ height: '100%' }}>
            <Pie data={pieData} angleField="value" colorField="type" innerRadius={0.5} height={420}
              label={false}
              legend={{ color: { position: 'right', itemLabelFill: token.colorText } }}
              interaction={{ elementHighlight: { background: true } }}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => fmtNum(v) }] }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _method?: string; type?: string } } }) => {
                  const method = ev?.data?.data?._method;
                  if (method) setMethodDrawer(method);
                  else {
                    const label = ev?.data?.data?.type;
                    if (label) setMethodDrawer(METHOD_LABEL_TO_KEY[label] || label);
                  }
                });
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="Топ-30 товаров по объёму" size="small" style={{ height: '100%' }}>
            <Table dataSource={topProducts} columns={productCols} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 550 }}
              onRow={(record) => ({ onClick: () => setProductDrawer({ productId: record.id, productName: record.name }), style: clickableRow })} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Менеджеры" size="small" style={{ height: '100%' }}>
            <Table dataSource={managers} columns={managerCols} rowKey="id" size="small" pagination={false} scroll={{ x: 450 }}
              onRow={(record) => ({ onClick: () => setManagerDrawer({ managerId: record.id, managerName: record.fullName }), style: clickableRow })} />
          </Card>
        </Col>
      </Row>

      <Card title="Должники" size="small" style={{ marginBottom: 24 }}>
        <Table dataSource={debtors} columns={debtorCols} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 550 }}
          onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })} />
      </Card>

      <Card title={<><CalendarOutlined /> Матрица активности клиентов</>} size="small"
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input.Search placeholder="Поиск..." allowClear style={{ width: 200 }} onSearch={setActivitySearch} onChange={(e) => !e.target.value && setActivitySearch('')} />
            <Select mode="multiple" placeholder="Выбрать клиентов" allowClear style={{ minWidth: 200 }} maxTagCount={2}
              value={selectedClients} onChange={setSelectedClients}
              options={(clientActivity || []).map((c) => ({ label: c.companyName, value: c.clientId }))}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,0.2)' }} /> Мало</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,0.6)' }} /></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,1)' }} /> Много</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5' }} /> Нет данных</span>
        </div>
        <Table dataSource={filteredActivity} columns={activityCols} rowKey="clientId" size="small" pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0, showTotal: (t) => `${t} клиентов` }} scroll={{ x: 900 }} />
      </Card>
    </>
  );

  // ── TAB 2: Advanced Analytics ──
  const analyticsTab = extended ? (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Удержание клиентов (MoM)" size="small">
            <Line
              data={extended.retention.map((r) => ({ month: MONTH_LABELS[r.month], rate: Math.round(r.retentionRate * 100), _month: r.month }))}
              xField="month" yField="rate" height={280}
              point={{ shapeField: 'circle', sizeField: 4 }}
              axis={{ x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => `${v}%` } }}
              tooltip={{ items: [{ field: 'rate', channel: 'y', name: 'Удержание', valueFormatter: (v: number) => `${v}%` }] }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _month?: number } } }) => {
                  const m = ev?.data?.data?._month;
                  if (m) setMonthDrawer(m);
                });
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Концентрация выручки (топ-20 клиентов)" size="small">
            <Bar
              data={extended.concentration.map((r) => ({ client: r.companyName.substring(0, 20), percent: r.cumulativePercent, _clientId: r.clientId }))}
              xField="client" yField="percent" height={280}
              axis={{ x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => `${v}%` } }}
              tooltip={{ items: [{ field: 'percent', channel: 'y', name: 'Кумулятивно', valueFormatter: (v: number) => `${v}%` }] }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _clientId?: string } } }) => {
                  const id = ev?.data?.data?._clientId;
                  if (id) navigate(`/clients/${id}`);
                });
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Тренд менеджеров по месяцам" size="small">
            <Line
              data={extended.managerTrend.map((r) => ({ month: MONTH_LABELS[r.month], revenue: r.revenue, manager: r.fullName, _managerId: r.managerId, _managerName: r.fullName }))}
              xField="month" yField="revenue" colorField="manager" height={280}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'revenue', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => fmtNum(v) }] }}
              legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _managerId?: string; _managerName?: string } } }) => {
                  const id = ev?.data?.data?._managerId;
                  const name = ev?.data?.data?._managerName;
                  if (id && name) setManagerDrawer({ managerId: id, managerName: name });
                });
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Сезонность" size="small">
            <Line
              data={extended.seasonality.map((r) => ({ month: MONTH_LABELS[r.month], value: r.revenue, _month: r.month }))}
              xField="month" yField="value" height={280}
              point={{ shapeField: 'circle', sizeField: 4 }}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => fmtNum(v) }] }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _month?: number } } }) => {
                  const m = ev?.data?.data?._month;
                  if (m) setMonthDrawer(m);
                });
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Повторные покупки товаров" size="small">
            <Bar
              data={extended.productRecurring.slice(0, 15).map((r) => ({ product: r.name.substring(0, 25), rate: Math.round(r.recurringRate * 100), _productId: r.productId, _productName: r.name }))}
              xField="product" yField="rate" height={280}
              axis={{ x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => `${v}%` } }}
              tooltip={{ items: [{ field: 'rate', channel: 'y', name: 'Повторные', valueFormatter: (v: number) => `${v}%` }] }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _productId?: string; _productName?: string } } }) => {
                  const id = ev?.data?.data?._productId;
                  const name = ev?.data?.data?._productName;
                  if (id && name) setProductDrawer({ productId: id, productName: name });
                });
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Долговой риск" size="small">
            <Bar
              data={extended.debtRisk.slice(0, 15).map((r) => ({ client: r.companyName.substring(0, 20), debt: r.debt, _clientId: r.clientId }))}
              xField="client" yField="debt" height={280}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'debt', channel: 'y', name: 'Долг', valueFormatter: (v: number) => fmtNum(v) }] }}
              style={{ fill: token.colorError }}
              theme={chartTheme}
              onReady={({ chart }) => {
                chart.on('element:click', (ev: { data?: { data?: { _clientId?: string } } }) => {
                  const id = ev?.data?.data?._clientId;
                  if (id) navigate(`/clients/${id}`);
                });
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* Cohort heatmap table */}
      <Card title="Когортный анализ" size="small">
        {(() => {
          const cohortMonths = [...new Set(extended.cohort.map((r) => r.cohortMonth))].sort((a, b) => a - b);
          const activeMonths = [...new Set(extended.cohort.map((r) => r.activeMonth))].sort((a, b) => a - b);
          const cohortMap = new Map<string, number>();
          for (const r of extended.cohort) cohortMap.set(`${r.cohortMonth}-${r.activeMonth}`, r.clientCount);

          const columns = [
            { title: 'Когорта', key: 'cohort', width: 80, render: (_: unknown, record: { cohort: number }) => MONTH_LABELS[record.cohort] },
            ...activeMonths.map((am) => ({
              title: MONTH_LABELS[am], key: `a${am}`, width: 60, align: 'center' as const,
              render: (_: unknown, record: { cohort: number }) => {
                const count = cohortMap.get(`${record.cohort}-${am}`) || 0;
                if (!count) return <span style={{ color: token.colorTextDisabled }}>—</span>;
                const maxCount = Math.max(...Array.from(cohortMap.values()));
                const intensity = maxCount > 0 ? count / maxCount : 0;
                return (
                  <Tooltip title={`${MONTH_LABELS[record.cohort]} → ${MONTH_LABELS[am]}: ${count} клиентов`}>
                    <div
                      style={{ backgroundColor: `rgba(22,119,255,${0.1 + intensity * 0.8})`, borderRadius: 3, padding: '4px 0', textAlign: 'center', fontWeight: 600, color: intensity > 0.5 ? '#fff' : token.colorText, cursor: 'pointer' }}
                      onClick={() => setMonthDrawer(am)}
                    >{count}</div>
                  </Tooltip>
                );
              },
            })),
          ];
          const dataSource = cohortMonths.map((c) => ({ cohort: c, key: c }));
          return <Table dataSource={dataSource} columns={columns} size="small" pagination={false} scroll={{ x: 600 }} />;
        })()}
      </Card>
    </>
  ) : (
    <div style={{ textAlign: 'center', marginTop: 60 }}><Spin size="large" /></div>
  );

  // ── TAB 3: Segments ──
  const segmentsTab = extended ? (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {(extended.segmentSummary || []).map((seg) => (
          <Col xs={12} sm={8} lg={4} key={seg.segment}>
            <Card size="small" hoverable onClick={() => setSegmentFilter([seg.segment])}
              style={{ borderLeft: `4px solid ${SEGMENT_COLORS[seg.segment] || token.colorBorder}`, cursor: 'pointer' }}>
              <Statistic title={SEGMENT_LABELS[seg.segment] || seg.segment} value={seg.count} suffix="клиентов" />
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
                Выручка: {fmtNum(seg.totalRevenue)}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={10}>
          <Card title="Распределение по сегментам" size="small">
            {(() => {
              const segPieData = (extended.segmentSummary || []).map((s) => ({ type: SEGMENT_LABELS[s.segment] || s.segment, value: s.count }));
              const segPieDomain = segPieData.map((d) => d.type);
              const segPieRange = segPieData.map((d) => {
                const seg = Object.entries(SEGMENT_LABELS).find(([, v]) => v === d.type);
                return seg ? SEGMENT_COLORS[seg[0]] : token.colorBorder;
              });
              return (
                <Pie
                  data={segPieData}
                  angleField="value" colorField="type" innerRadius={0.5} height={300}
                  scale={{ color: { domain: segPieDomain, range: segPieRange } }}
                  label={false}
                  legend={{ color: { position: 'right', itemLabelFill: token.colorText } }}
                  tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Клиентов' }] }}
                  theme={chartTheme}
                />
              );
            })()}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Выручка по сегментам" size="small">
            {(() => {
              const segBarData = (extended.segmentSummary || []).map((s) => ({ segment: SEGMENT_LABELS[s.segment] || s.segment, revenue: s.totalRevenue }));
              const segBarDomain = segBarData.map((d) => d.segment);
              const segBarRange = segBarData.map((d) => {
                const seg = Object.entries(SEGMENT_LABELS).find(([, v]) => v === d.segment);
                return seg ? SEGMENT_COLORS[seg[0]] : token.colorBorder;
              });
              return (
                <Bar
                  data={segBarData}
                  xField="segment" yField="revenue" colorField="segment" height={300}
                  scale={{ color: { domain: segBarDomain, range: segBarRange } }}
                  axis={axisStyle}
                  tooltip={{ items: [{ field: 'revenue', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => fmtNum(v) }] }}
                  theme={chartTheme}
                />
              );
            })()}
          </Card>
        </Col>
      </Row>

      <Card title="Клиенты по сегментам" size="small"
        extra={
          <Select mode="multiple" placeholder="Фильтр по сегменту" allowClear style={{ minWidth: 200 }} maxTagCount={2}
            value={segmentFilter} onChange={setSegmentFilter}
            options={Object.entries(SEGMENT_LABELS).map(([k, v]) => ({ label: v, value: k }))} />
        }
      >
        <Table dataSource={filteredSegments} columns={segmentActivityCols} rowKey="clientId" size="small"
          pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0, showTotal: (t) => `${t} клиентов` }} scroll={{ x: 1000 }}
          onRow={(record) => ({ onClick: () => navigate(`/clients/${record.clientId}`), style: clickableRow })} />
      </Card>
    </>
  ) : (
    <div style={{ textAlign: 'center', marginTop: 60 }}><Spin size="large" /></div>
  );

  // ── TAB 4: Data Quality ──
  const dataQualityTab = dataQuality ? (
    <>
      {/* KPI cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={6}>
          <Card size="small">
            <Statistic title="Проблемных строк" value={dataQuality.totalProblemRows} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: token.colorError }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={6}>
          <Card size="small">
            <Statistic title="Объём без цены" value={dataQuality.totalQtyInProblem} formatter={(val) => Number(val).toLocaleString('ru-RU')} />
          </Card>
        </Col>
        <Col xs={24} sm={8} lg={12}>
          <Card size="small" title="По типу операции">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {dataQuality.problemByOpType.map((item) => (
                <Tag key={item.opType} color="orange">{OP_TYPE_LABELS[item.opType] || item.opType}: {item.count}</Tag>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      {/* Exchange block */}
      {exchangeData && exchangeData.totalExchanges > 0 && (
        <Card title={<><SwapOutlined /> Обменные операции</>} size="small" style={{ marginBottom: 24 }}>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}><Statistic title="Операций" value={exchangeData.totalExchanges} /></Col>
            <Col xs={12} sm={6}><Statistic title="Объём (ед.)" value={exchangeData.totalQty} formatter={(val) => Number(val).toLocaleString('ru-RU')} /></Col>
            <Col xs={12} sm={6}><Statistic title="Клиентов" value={exchangeData.uniqueClients} /></Col>
            <Col xs={12} sm={6}><Statistic title="Товаров" value={exchangeData.uniqueProducts} /></Col>
          </Row>
          {exchangeData.byMonth.length > 0 && (
            <Bar
              data={exchangeData.byMonth.map((m) => ({ month: MONTH_LABELS[m.month] || `${m.month}`, qty: m.totalQty }))}
              xField="month" yField="qty" height={200}
              axis={axisStyleNoFmt}
              tooltip={{ items: [{ field: 'qty', channel: 'y', name: 'Объём' }] }}
              theme={chartTheme}
            />
          )}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <Table dataSource={exchangeData.products} rowKey="id" size="small" pagination={false}
                columns={[
                  { title: 'Товар', dataIndex: 'name', key: 'name', ellipsis: true },
                  { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
                  { title: 'Объём', dataIndex: 'totalQty', key: 'totalQty', width: 100, render: (v: number) => v.toLocaleString('ru-RU'), sorter: (a: ExchangeProduct, b: ExchangeProduct) => a.totalQty - b.totalQty },
                  { title: 'Клиентов', dataIndex: 'uniqueClients', key: 'uniqueClients', width: 90 },
                ]}
              />
            </Col>
            <Col xs={24} lg={12}>
              <Table dataSource={exchangeData.clients} rowKey="id" size="small" pagination={false}
                columns={[
                  { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
                  { title: 'Кол-во', dataIndex: 'exchangeCount', key: 'exchangeCount', width: 80, sorter: (a: ExchangeClient, b: ExchangeClient) => a.exchangeCount - b.exchangeCount },
                  { title: 'Объём', dataIndex: 'totalQty', key: 'totalQty', width: 100, render: (v: number) => v.toLocaleString('ru-RU') },
                ]}
                onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })}
              />
            </Col>
          </Row>
        </Card>
      )}

      {/* Prepayment block */}
      {prepaymentData && prepaymentData.totalRows > 0 && (
        <Card title={<><DollarOutlined /> Предоплаты (ПП)</>} size="small" style={{ marginBottom: 24 }}>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={8}><Statistic title="Позиций" value={prepaymentData.totalRows} /></Col>
            <Col xs={12} sm={8}><Statistic title="Сумма" value={prepaymentData.totalAmount} formatter={(val) => fmtNum(Number(val))} /></Col>
          </Row>
          {prepaymentData.byMonth.length > 0 && (
            <Bar
              data={prepaymentData.byMonth.map((m) => ({ month: MONTH_LABELS[m.month] || `${m.month}`, amount: m.amount }))}
              xField="month" yField="amount" height={200}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'amount', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => fmtNum(v) }] }}
              theme={chartTheme}
            />
          )}
          <Table dataSource={prepaymentData.topClients} rowKey="id" size="small" pagination={false} style={{ marginTop: 16 }}
            columns={[
              { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
              { title: 'Позиций', dataIndex: 'ppCount', key: 'ppCount', width: 80, sorter: (a: PrepaymentClient, b: PrepaymentClient) => a.ppCount - b.ppCount },
              { title: 'Сумма', dataIndex: 'totalAmount', key: 'totalAmount', width: 120, render: (v: number) => fmtNum(v), sorter: (a: PrepaymentClient, b: PrepaymentClient) => a.totalAmount - b.totalAmount },
            ]}
            onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })}
          />
        </Card>
      )}

      {/* Top products by problem qty + Top clients */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Топ-20 товаров (без цены)" size="small">
            <Table dataSource={dataQuality.topProducts} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
                { title: 'Товар', dataIndex: 'name', key: 'name', ellipsis: true },
                { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
                { title: 'Объём', dataIndex: 'totalQty', key: 'totalQty', width: 100, render: (v: number) => v.toLocaleString('ru-RU') },
                { title: 'Строк', dataIndex: 'problemCount', key: 'problemCount', width: 70 },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Топ клиентов по проблемным строкам" size="small">
            <Table dataSource={dataQuality.topClients} rowKey="id" size="small" pagination={false}
              columns={[
                { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
                { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
                { title: 'Строк', dataIndex: 'problemCount', key: 'problemCount', width: 70 },
                { title: 'Объём', dataIndex: 'totalQty', key: 'totalQty', width: 100, render: (v: number) => v.toLocaleString('ru-RU') },
              ]}
              onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })}
            />
          </Card>
        </Col>
      </Row>

      {/* Problem rows table */}
      <Card title="Проблемные строки (qty > 0, цена = 0)" size="small"
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input.Search placeholder="Поиск..." allowClear style={{ width: 200 }} onSearch={setDqSearch} onChange={(e) => !e.target.value && setDqSearch('')} />
            <Select mode="multiple" placeholder="Тип операции" allowClear style={{ minWidth: 160 }} maxTagCount={2}
              value={dqOpTypeFilter} onChange={setDqOpTypeFilter}
              options={Object.entries(OP_TYPE_LABELS).map(([k, v]) => ({ label: v, value: k }))} />
          </div>
        }
      >
        <Table dataSource={filteredProblemRows} rowKey="id" size="small"
          pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0, showTotal: (t) => `${t} строк` }}
          scroll={{ x: 900 }}
          columns={[
            { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
            { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
            { title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 80, render: (v: number) => v.toLocaleString('ru-RU') },
            { title: 'Тип', dataIndex: 'opType', key: 'opType', width: 100, render: (v: string) => <Tag>{OP_TYPE_LABELS[v] || v}</Tag> },
            { title: 'Клиент', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
            { title: 'Менеджер', dataIndex: 'managerName', key: 'managerName', width: 120 },
            { title: 'Сделка', dataIndex: 'dealTitle', key: 'dealTitle', ellipsis: true },
            { title: 'Дата', dataIndex: 'createdAt', key: 'createdAt', width: 100, render: (v: string) => new Date(v).toLocaleDateString('ru-RU') },
          ]}
        />
      </Card>
    </>
  ) : (
    <div style={{ textAlign: 'center', marginTop: 60 }}><Spin size="large" /></div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BarChartOutlined /> Аналитика {year} (Исторические данные)
        </Title>
        <Segmented
          value={year}
          onChange={(val) => setYear(val as number)}
          options={Array.from({ length: new Date().getFullYear() - 2025 + 1 }, (_, i) => ({
            label: String(2025 + i),
            value: 2025 + i,
          }))}
        />
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: 'overview', label: 'Обзор' },
        { key: 'analytics', label: 'Аналитика' },
        { key: 'segments', label: 'Сегменты' },
        { key: 'dataQuality', label: 'Качество данных' },
      ]} />
      {activeTab === 'overview' && overviewTab}
      {activeTab === 'analytics' && analyticsTab}
      {activeTab === 'segments' && segmentsTab}
      {activeTab === 'dataQuality' && dataQualityTab}

      {/* KPI Drill-down Drawer */}
      <Drawer title={kpiDrawerTitle[kpiDrawer || ''] || ''} open={!!kpiDrawer} onClose={() => setKpiDrawer(null)} width={720}>
        {renderKpiDrawerContent()}
      </Drawer>

      {/* Month Detail Drawer */}
      <Drawer title={`${MONTH_LABELS[monthDrawer || 0] || ''} ${year} — Детализация`} open={!!monthDrawer} onClose={() => setMonthDrawer(null)} width={720}>
        {monthDetail ? (
          <Tabs items={[
            {
              key: 'deals', label: `Сделки (${monthDetail.deals.length})`, children: (
                <Table dataSource={monthDetail.deals} columns={dealDrillCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 700 }} />
              )
            },
            {
              key: 'products', label: `Товары (${monthDetail.products.length})`, children: (
                <Table dataSource={monthDetail.products} rowKey="id" size="small" pagination={false}
                  columns={[
                    { title: 'Товар', dataIndex: 'name', key: 'name' },
                    { title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 100 },
                    { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => fmtNum(v) },
                  ]}
                />
              )
            },
            {
              key: 'managers', label: `Менеджеры (${monthDetail.managers.length})`, children: (
                <Table dataSource={monthDetail.managers} rowKey="id" size="small" pagination={false}
                  columns={[
                    { title: 'Менеджер', dataIndex: 'fullName', key: 'fullName' },
                    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80 },
                    { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => fmtNum(v) },
                  ]}
                />
              )
            },
            {
              key: 'payments', label: `Поступления (${monthDetail.payments?.length || 0})`, children: (
                <Table dataSource={monthDetail.payments || []} columns={paymentDrillCols} rowKey="id" size="small"
                  pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 600 }} />
              )
            },
            {
              key: 'debt', label: 'Долг', children: (
                <>
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col span={12}>
                      <Card size="small">
                        <Statistic title="Входящий остаток" value={monthDetail.debtSnapshot?.openingBalance || 0}
                          formatter={(val) => fmtNum(Number(val))} />
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small">
                        <Statistic title="Исходящий остаток" value={monthDetail.debtSnapshot?.closingBalance || 0}
                          formatter={(val) => fmtNum(Number(val))} />
                      </Card>
                    </Col>
                  </Row>
                  <Table dataSource={monthDetail.debtSnapshot?.debtors || []} rowKey="id" size="small"
                    pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 550 }}
                    columns={[
                      { title: '#', key: 'idx', width: 40, render: (_: unknown, __: unknown, i: number) => i + 1 },
                      { title: 'Компания', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
                      { title: 'Сумма', dataIndex: 'totalAmount', key: 'totalAmount', width: 120, render: (v: number) => fmtNum(v) },
                      { title: 'Оплачено', dataIndex: 'totalPaid', key: 'totalPaid', width: 120, render: (v: number) => fmtNum(v) },
                      { title: 'Долг', dataIndex: 'debt', key: 'debt', width: 120, render: (v: number) => <span style={{ color: token.colorError, fontWeight: 600 }}>{fmtNum(v)}</span> },
                    ]}
                    onRow={(record) => ({ onClick: () => navigate(`/clients/${record.id}`), style: clickableRow })}
                  />
                </>
              )
            },
          ]} />
        ) : <Spin />}
      </Drawer>

      {/* Client-Month Purchases Drawer */}
      <Drawer
        title={cellDrawer ? `${cellDrawer.clientName} — ${MONTH_LABELS[cellDrawer.month]} ${year}` : ''}
        open={!!cellDrawer} onClose={() => setCellDrawer(null)} width={720}
      >
        {clientMonthLoading ? <Spin /> : clientMonthData ? (
          <>
            <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 600 }}>
              Итого: {fmtNum(clientMonthData.totalRevenue)}
            </div>
            <Table dataSource={clientMonthData.items} columns={clientMonthCols} rowKey="id" size="small"
              pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 600 }} />
          </>
        ) : null}
      </Drawer>

      {/* Product Buyers Drawer */}
      <Drawer
        title={productDrawer ? `Покупатели: ${productDrawer.productName}` : ''}
        open={!!productDrawer} onClose={() => setProductDrawer(null)} width={720}
      >
        {productBuyersLoading ? <Spin /> : productBuyersData ? (
          <Table dataSource={productBuyersData.buyers} columns={productBuyersCols} rowKey="clientId" size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 500 }}
            onRow={(record) => ({ onClick: () => navigate(`/clients/${record.clientId}`), style: clickableRow })} />
        ) : null}
      </Drawer>

      {/* Manager Deals Drawer */}
      <Drawer
        title={managerDrawer ? `Сделки: ${managerDrawer.managerName}` : ''}
        open={!!managerDrawer} onClose={() => setManagerDrawer(null)} width={720}
      >
        {managerDrillLoading ? <Spin /> : managerDrilldown?.deals ? (
          <Table dataSource={managerDrilldown.deals} columns={dealDrillCols} rowKey="id" size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 700 }} />
        ) : null}
      </Drawer>

      {/* Payment Method Drawer */}
      <Drawer
        title={methodDrawer ? `Платежи: ${METHOD_LABELS[methodDrawer] || methodDrawer}` : ''}
        open={!!methodDrawer} onClose={() => setMethodDrawer(null)} width={720}
      >
        {methodDrillLoading ? <Spin /> : methodDrilldown?.payments ? (
          <Table dataSource={methodDrilldown.payments} columns={paymentDrillCols} rowKey="id" size="small"
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], totalBoundaryShowSizeChanger: 0 }} scroll={{ x: 600 }} />
        ) : null}
      </Drawer>
    </div>
  );
}
