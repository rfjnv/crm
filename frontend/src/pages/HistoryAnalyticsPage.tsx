import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card, Col, Row, Statistic, Table, Typography, Spin, theme, Input, Select,
  Tooltip, Tag, Tabs, Drawer,
} from 'antd';
import {
  DollarOutlined, TeamOutlined, ShoppingOutlined, RiseOutlined,
  WarningOutlined, BarChartOutlined, CalendarOutlined,
} from '@ant-design/icons';
import { Area, Pie, Bar, Line } from '@ant-design/charts';
import { analyticsApi } from '../api/analytics.api';
import type {
  HistoryTopClient, HistoryTopProduct, HistoryManager, HistoryDebtor,
  HistoryClientActivity, HistoryClientSegment,
} from '../types';

const { Title } = Typography;

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные', TRANSFER: 'Перечисление', QR: 'QR',
  PAYME: 'Click', TERMINAL: 'Терминал', 'Не указан': 'Не указан',
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

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} млрд`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} тыс`;
  return n.toLocaleString('ru-RU');
}

export default function HistoryAnalyticsPage() {
  const { token } = theme.useToken();
  const isDark = token.colorBgBase !== '#ffffff';
  const SEGMENT_COLORS = isDark ? SEGMENT_COLORS_DARK : SEGMENT_COLORS_LIGHT;

  // ── All hooks before any conditional return ──
  const [activeTab, setActiveTab] = useState('overview');
  const [kpiDrawer, setKpiDrawer] = useState<string | null>(null);
  const [monthDrawer, setMonthDrawer] = useState<number | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [segmentFilter, setSegmentFilter] = useState<string[]>([]);

  const { data, isLoading } = useQuery({ queryKey: ['analytics-history'], queryFn: analyticsApi.getHistory });

  const needExtended = activeTab === 'analytics' || activeTab === 'segments';
  const { data: extended } = useQuery({
    queryKey: ['analytics-history-extended'],
    queryFn: analyticsApi.getHistoryExtended,
    enabled: needExtended,
  });

  const drillType = kpiDrawer === 'deals' || kpiDrawer === 'revenue' || kpiDrawer === 'avg'
    ? 'deals' : kpiDrawer === 'paid' ? 'payments' : null;
  const { data: drilldown } = useQuery({
    queryKey: ['analytics-history-drilldown', drillType],
    queryFn: () => analyticsApi.getHistoryDrilldown(drillType!),
    enabled: !!drillType,
  });

  const { data: monthDetail } = useQuery({
    queryKey: ['analytics-history-month', monthDrawer],
    queryFn: () => analyticsApi.getHistoryMonth(monthDrawer!),
    enabled: !!monthDrawer,
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

  if (isLoading || !data) {
    return <div style={{ textAlign: 'center', marginTop: 120 }}><Spin size="large" /></div>;
  }

  const { overview, monthlyTrend, topClients, topProducts, managers, paymentMethods, debtors, clientActivity } = data;

  const chartTheme = token.colorBgBase === '#ffffff' ? 'classic' : 'classicDark';
  const axisStyle = { x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => fmtNum(v) } };
  const axisStyleNoFmt = { x: { labelFill: token.colorText }, y: { labelFill: token.colorText } };

  // ── Chart data ──
  const areaData = monthlyTrend.flatMap((m) => [
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.revenue, type: 'Выручка' },
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.paid, type: 'Оплачено' },
  ]);
  const clientBarData = monthlyTrend.map((m) => ({
    month: MONTH_LABELS[m.month] || `${m.month}`, clients: m.activeClients, _month: m.month,
  }));
  const pieData = paymentMethods.map((pm) => ({
    type: METHOD_LABELS[pm.method] || pm.method, value: pm.total,
  }));

  // ── Activity matrix helpers ──
  function getMonthStatus(activeMonths: number[], month: number): 'active' | 'inactive' | 'returned' {
    if (!activeMonths.includes(month)) return 'inactive';
    const firstActive = Math.min(...activeMonths);
    if (month > firstActive) {
      for (let m = firstActive; m < month; m++) {
        if (!activeMonths.includes(m)) return 'returned';
      }
    }
    return 'active';
  }
  const STATUS_COLORS = { active: '#52c41a', inactive: token.colorBgContainerDisabled || '#f0f0f0', returned: '#1890ff' };
  const STATUS_LABELS_MAP = { active: 'Активен', inactive: 'Неактивен', returned: 'Вернулся' };

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
    deals: 'Все сделки 2025', clients: 'Топ клиенты', revenue: 'Сделки по сумме',
    paid: 'Платежи 2025', debt: 'Должники', avg: 'Сделки по сумме',
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

  // ── Activity matrix columns ──
  const activityCols = [
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', fixed: 'left' as const, width: 180, ellipsis: true },
    ...[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => ({
      title: MONTH_LABELS[m], key: `m${m}`, width: 50, align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => {
        const status = getMonthStatus(record.activeMonths, m);
        return (
          <Tooltip title={`${MONTH_LABELS[m]}: ${STATUS_LABELS_MAP[status]}`}>
            <div style={{ width: 28, height: 28, borderRadius: 4, backgroundColor: STATUS_COLORS[status], margin: '0 auto' }} />
          </Tooltip>
        );
      },
    })),
    { title: 'Мес.', key: 'total', width: 55, align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => <Tag color="blue">{record.activeMonths.length}</Tag>,
      sorter: (a: HistoryClientActivity, b: HistoryClientActivity) => a.activeMonths.length - b.activeMonths.length,
    },
  ];

  // ── Segment activity columns (with segment tag) ──
  const segmentActivityCols = [
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', fixed: 'left' as const, width: 180, ellipsis: true },
    { title: 'Сегмент', dataIndex: 'segment', key: 'segment', width: 120,
      render: (v: string) => <Tag color={SEGMENT_COLORS[v]}>{SEGMENT_LABELS[v] || v}</Tag>,
    },
    ...[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => ({
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
    { title: 'Мес.', key: 'total', width: 55, align: 'center' as const,
      render: (_: unknown, record: HistoryClientSegment) => <Tag color="blue">{record.activeMonths.length}</Tag>,
      sorter: (a: HistoryClientSegment, b: HistoryClientSegment) => a.activeMonths.length - b.activeMonths.length,
    },
  ];

  // ── Render KPI drawer content ──
  function renderKpiDrawerContent() {
    if (!kpiDrawer) return null;
    if (kpiDrawer === 'clients') {
      return <Table dataSource={topClients} columns={clientCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 600 }} />;
    }
    if (kpiDrawer === 'debt') {
      return <Table dataSource={debtors} columns={debtorCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 550 }} />;
    }
    if (drillType === 'deals' && drilldown?.deals) {
      return <Table dataSource={drilldown.deals} columns={dealDrillCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 700 }} />;
    }
    if (drillType === 'payments' && drilldown?.payments) {
      return <Table dataSource={drilldown.payments} columns={paymentDrillCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 600 }} />;
    }
    return <Spin />;
  }

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
            <Table dataSource={topClients} columns={clientCols} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 600 }} />
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
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="Топ-30 товаров по объёму" size="small" style={{ height: '100%' }}>
            <Table dataSource={topProducts} columns={productCols} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 550 }} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Менеджеры" size="small" style={{ height: '100%' }}>
            <Table dataSource={managers} columns={managerCols} rowKey="id" size="small" pagination={false} scroll={{ x: 450 }} />
          </Card>
        </Col>
      </Row>

      <Card title="Должники" size="small" style={{ marginBottom: 24 }}>
        <Table dataSource={debtors} columns={debtorCols} rowKey="id" size="small" pagination={{ pageSize: 10, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 550 }} />
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
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: STATUS_COLORS.active }} /> Активен</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: STATUS_COLORS.returned }} /> Вернулся</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: STATUS_COLORS.inactive, border: '1px solid #d9d9d9' }} /> Неактивен</span>
        </div>
        <Table dataSource={filteredActivity} columns={activityCols} rowKey="clientId" size="small" pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: (t) => `${t} клиентов` }} scroll={{ x: 900 }} />
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
              data={extended.retention.map((r) => ({ month: MONTH_LABELS[r.month], rate: Math.round(r.retentionRate * 100) }))}
              xField="month" yField="rate" height={280}
              point={{ shapeField: 'circle', sizeField: 4 }}
              axis={{ x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => `${v}%` } }}
              tooltip={{ items: [{ field: 'rate', channel: 'y', name: 'Удержание', valueFormatter: (v: number) => `${v}%` }] }}
              theme={chartTheme}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Концентрация выручки (топ-20 клиентов)" size="small">
            <Bar
              data={extended.concentration.map((r) => ({ client: r.companyName.substring(0, 20), percent: r.cumulativePercent }))}
              xField="client" yField="percent" height={280}
              axis={{ x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => `${v}%` } }}
              tooltip={{ items: [{ field: 'percent', channel: 'y', name: 'Кумулятивно', valueFormatter: (v: number) => `${v}%` }] }}
              theme={chartTheme}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Тренд менеджеров по месяцам" size="small">
            <Line
              data={extended.managerTrend.map((r) => ({ month: MONTH_LABELS[r.month], revenue: r.revenue, manager: r.fullName }))}
              xField="month" yField="revenue" colorField="manager" height={280}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'revenue', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => fmtNum(v) }] }}
              legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
              theme={chartTheme}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Сезонность" size="small">
            <Line
              data={extended.seasonality.map((r) => ({ month: MONTH_LABELS[r.month], value: r.revenue }))}
              xField="month" yField="value" height={280}
              point={{ shapeField: 'circle', sizeField: 4 }}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => fmtNum(v) }] }}
              theme={chartTheme}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="Повторные покупки товаров" size="small">
            <Bar
              data={extended.productRecurring.slice(0, 15).map((r) => ({ product: r.name.substring(0, 25), rate: Math.round(r.recurringRate * 100) }))}
              xField="product" yField="rate" height={280}
              axis={{ x: { labelFill: token.colorText }, y: { labelFill: token.colorText, labelFormatter: (v: number) => `${v}%` } }}
              tooltip={{ items: [{ field: 'rate', channel: 'y', name: 'Повторные', valueFormatter: (v: number) => `${v}%` }] }}
              theme={chartTheme}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Долговой риск" size="small">
            <Bar
              data={extended.debtRisk.slice(0, 15).map((r) => ({ client: r.companyName.substring(0, 20), debt: r.debt }))}
              xField="client" yField="debt" height={280}
              axis={axisStyle}
              tooltip={{ items: [{ field: 'debt', channel: 'y', name: 'Долг', valueFormatter: (v: number) => fmtNum(v) }] }}
              style={{ fill: token.colorError }}
              theme={chartTheme}
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
                if (!count) return <span style={{ color: '#ccc' }}>—</span>;
                const maxCount = Math.max(...Array.from(cohortMap.values()));
                const intensity = maxCount > 0 ? count / maxCount : 0;
                return (
                  <Tooltip title={`${MONTH_LABELS[record.cohort]} → ${MONTH_LABELS[am]}: ${count} клиентов`}>
                    <div style={{ backgroundColor: `rgba(22,119,255,${0.1 + intensity * 0.8})`, borderRadius: 3, padding: '4px 0', textAlign: 'center', fontWeight: 600, color: intensity > 0.5 ? '#fff' : token.colorText }}>{count}</div>
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
            <Card size="small" style={{ borderLeft: `4px solid ${SEGMENT_COLORS[seg.segment] || '#ccc'}` }}>
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
            <Pie
              data={(extended.segmentSummary || []).map((s) => ({ type: SEGMENT_LABELS[s.segment] || s.segment, value: s.count }))}
              angleField="value" colorField="type" innerRadius={0.5} height={300}
              color={({ type }: { type: string }) => {
                const seg = Object.entries(SEGMENT_LABELS).find(([, v]) => v === type);
                return seg ? SEGMENT_COLORS[seg[0]] : '#ccc';
              }}
              label={false}
              legend={{ color: { position: 'right', itemLabelFill: token.colorText } }}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Клиентов' }] }}
              theme={chartTheme}
            />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Выручка по сегментам" size="small">
            <Bar
              data={(extended.segmentSummary || []).map((s) => ({ segment: SEGMENT_LABELS[s.segment] || s.segment, revenue: s.totalRevenue }))}
              xField="segment" yField="revenue" height={300}
              axis={axisStyle}
              style={{ fill: ({ segment }: { segment: string }) => {
                const seg = Object.entries(SEGMENT_LABELS).find(([, v]) => v === segment);
                return seg ? SEGMENT_COLORS[seg[0]] : '#ccc';
              }}}
              tooltip={{ items: [{ field: 'revenue', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => fmtNum(v) }] }}
              theme={chartTheme}
            />
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
          pagination={{ pageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: (t) => `${t} клиентов` }} scroll={{ x: 1000 }} />
      </Card>
    </>
  ) : (
    <div style={{ textAlign: 'center', marginTop: 60 }}><Spin size="large" /></div>
  );

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <BarChartOutlined /> Аналитика 2025 (Исторические данные)
      </Title>

      <Tabs activeKey={activeTab} onChange={setActiveTab} destroyInactiveTabPane items={[
        { key: 'overview', label: 'Обзор', children: overviewTab },
        { key: 'analytics', label: 'Аналитика', children: analyticsTab },
        { key: 'segments', label: 'Сегменты', children: segmentsTab },
      ]} />

      {/* KPI Drill-down Drawer */}
      <Drawer title={kpiDrawerTitle[kpiDrawer || ''] || ''} open={!!kpiDrawer} onClose={() => setKpiDrawer(null)} width={720}>
        {renderKpiDrawerContent()}
      </Drawer>

      {/* Month Detail Drawer */}
      <Drawer title={`${MONTH_LABELS[monthDrawer || 0] || ''} 2025 — Детализация`} open={!!monthDrawer} onClose={() => setMonthDrawer(null)} width={720}>
        {monthDetail ? (
          <Tabs items={[
            { key: 'deals', label: `Сделки (${monthDetail.deals.length})`, children: (
              <Table dataSource={monthDetail.deals} columns={dealDrillCols} rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }} scroll={{ x: 700 }} />
            )},
            { key: 'products', label: `Товары (${monthDetail.products.length})`, children: (
              <Table dataSource={monthDetail.products} rowKey="name" size="small" pagination={false}
                columns={[
                  { title: 'Товар', dataIndex: 'name', key: 'name' },
                  { title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 100 },
                  { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => fmtNum(v) },
                ]}
              />
            )},
            { key: 'managers', label: `Менеджеры (${monthDetail.managers.length})`, children: (
              <Table dataSource={monthDetail.managers} rowKey="fullName" size="small" pagination={false}
                columns={[
                  { title: 'Менеджер', dataIndex: 'fullName', key: 'fullName' },
                  { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80 },
                  { title: 'Выручка', dataIndex: 'revenue', key: 'revenue', width: 120, render: (v: number) => fmtNum(v) },
                ]}
              />
            )},
          ]} />
        ) : <Spin />}
      </Drawer>
    </div>
  );
}
