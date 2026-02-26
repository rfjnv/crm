import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Typography, Spin, theme } from 'antd';
import {
  DollarOutlined,
  TeamOutlined,
  ShoppingOutlined,
  RiseOutlined,
  WarningOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { Area, Pie, Bar } from '@ant-design/charts';
import { analyticsApi } from '../api/analytics.api';
import type {
  HistoryTopClient,
  HistoryTopProduct,
  HistoryManager,
  HistoryDebtor,
} from '../types';

const { Title } = Typography;

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв',
  2: 'Фев',
  3: 'Мар',
  4: 'Апр',
  5: 'Май',
  6: 'Июн',
  7: 'Июл',
  8: 'Авг',
  9: 'Сен',
  10: 'Окт',
  11: 'Ноя',
  12: 'Дек',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  QR: 'QR',
  PAYME: 'Click',
  TERMINAL: 'Терминал',
  'Не указан': 'Не указан',
};

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} млрд`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} тыс`;
  return n.toLocaleString('ru-RU');
}

export default function HistoryAnalyticsPage() {
  const { token } = theme.useToken();

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-history'],
    queryFn: analyticsApi.getHistory,
  });

  if (isLoading || !data) {
    return (
      <div style={{ textAlign: 'center', marginTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  const { overview, monthlyTrend, topClients, topProducts, managers, paymentMethods, debtors } =
    data;

  // ── Area chart data ──
  const areaData = monthlyTrend.flatMap((m) => [
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.revenue, type: 'Выручка' },
    { month: MONTH_LABELS[m.month] || `${m.month}`, value: m.paid, type: 'Оплачено' },
  ]);

  // ── Clients bar chart ──
  const clientBarData = monthlyTrend.map((m) => ({
    month: MONTH_LABELS[m.month] || `${m.month}`,
    clients: m.activeClients,
  }));

  // ── Pie chart data ──
  const pieData = paymentMethods.map((pm) => ({
    type: METHOD_LABELS[pm.method] || pm.method,
    value: pm.total,
  }));

  // ── Table columns ──
  const clientCols = [
    {
      title: '#',
      key: 'idx',
      width: 40,
      render: (_: unknown, __: unknown, i: number) => i + 1,
    },
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80, sorter: (a: HistoryTopClient, b: HistoryTopClient) => a.dealsCount - b.dealsCount },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      render: (v: number) => fmtNum(v),
      sorter: (a: HistoryTopClient, b: HistoryTopClient) => a.revenue - b.revenue,
    },
    {
      title: 'Оплачено',
      dataIndex: 'paid',
      key: 'paid',
      width: 120,
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Долг',
      dataIndex: 'debt',
      key: 'debt',
      width: 120,
      render: (v: number) => (
        <span style={{ color: v > 0 ? token.colorError : token.colorSuccess }}>{fmtNum(v)}</span>
      ),
      sorter: (a: HistoryTopClient, b: HistoryTopClient) => a.debt - b.debt,
    },
  ];

  const productCols = [
    {
      title: '#',
      key: 'idx',
      width: 40,
      render: (_: unknown, __: unknown, i: number) => i + 1,
    },
    { title: 'Товар', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
    {
      title: 'Кол-во',
      dataIndex: 'totalQty',
      key: 'totalQty',
      width: 100,
      render: (v: number) => v.toLocaleString('ru-RU'),
      sorter: (a: HistoryTopProduct, b: HistoryTopProduct) => a.totalQty - b.totalQty,
    },
    {
      title: 'Выручка',
      dataIndex: 'totalRevenue',
      key: 'totalRevenue',
      width: 120,
      render: (v: number) => fmtNum(v),
      sorter: (a: HistoryTopProduct, b: HistoryTopProduct) => a.totalRevenue - b.totalRevenue,
    },
    {
      title: 'Покупатели',
      dataIndex: 'uniqueBuyers',
      key: 'uniqueBuyers',
      width: 100,
      sorter: (a: HistoryTopProduct, b: HistoryTopProduct) => a.uniqueBuyers - b.uniqueBuyers,
    },
  ];

  const managerCols = [
    { title: 'Менеджер', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 80, sorter: (a: HistoryManager, b: HistoryManager) => a.dealsCount - b.dealsCount },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      render: (v: number) => fmtNum(v),
      sorter: (a: HistoryManager, b: HistoryManager) => a.revenue - b.revenue,
    },
    {
      title: 'Собрано',
      dataIndex: 'collected',
      key: 'collected',
      width: 120,
      render: (v: number) => fmtNum(v),
    },
    { title: 'Клиенты', dataIndex: 'clients', key: 'clients', width: 90, sorter: (a: HistoryManager, b: HistoryManager) => a.clients - b.clients },
  ];

  const debtorCols = [
    {
      title: '#',
      key: 'idx',
      width: 40,
      render: (_: unknown, __: unknown, i: number) => i + 1,
    },
    { title: 'Компания', dataIndex: 'companyName', key: 'companyName', ellipsis: true },
    {
      title: 'Сумма сделок',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 130,
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Оплачено',
      dataIndex: 'totalPaid',
      key: 'totalPaid',
      width: 130,
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Долг',
      dataIndex: 'debt',
      key: 'debt',
      width: 130,
      render: (v: number) => (
        <span style={{ color: token.colorError, fontWeight: 600 }}>{fmtNum(v)}</span>
      ),
      sorter: (a: HistoryDebtor, b: HistoryDebtor) => a.debt - b.debt,
      defaultSortOrder: 'descend' as const,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        <BarChartOutlined /> Аналитика 2025 (Исторические данные)
      </Title>

      {/* ── Row 1: KPIs ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Сделок"
              value={overview.totalDeals}
              prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Клиентов"
              value={overview.totalClients}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Выручка"
              value={overview.totalRevenue}
              prefix={<DollarOutlined />}
              formatter={(val) => fmtNum(Number(val))}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Оплачено"
              value={overview.totalPaid}
              prefix={<RiseOutlined />}
              valueStyle={{ color: token.colorSuccess }}
              formatter={(val) => fmtNum(Number(val))}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Долг"
              value={overview.totalDebt}
              prefix={<WarningOutlined />}
              valueStyle={{ color: overview.totalDebt > 0 ? token.colorError : token.colorSuccess }}
              formatter={(val) => fmtNum(Number(val))}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Ср. сделка"
              value={overview.avgDeal}
              prefix={<DollarOutlined />}
              formatter={(val) => fmtNum(Number(val))}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Row 2: Monthly trend area chart ── */}
      <Card title="Динамика по месяцам" size="small" style={{ marginBottom: 24 }}>
        <Area
          data={areaData}
          xField="month"
          yField="value"
          colorField="type"
          height={300}
          shapeField="smooth"
          style={{ fillOpacity: 0.15 }}
          axis={{
            y: { labelFormatter: (v: number) => fmtNum(v) },
            x: {},
          }}
          tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => fmtNum(v) }] }}
          legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
          theme={token.colorBgBase === '#ffffff' ? 'classic' : 'classicDark'}
        />
      </Card>

      {/* ── Row 3: Active clients bar chart ── */}
      <Card title="Активные клиенты по месяцам" size="small" style={{ marginBottom: 24 }}>
        <Bar
          data={clientBarData}
          xField="month"
          yField="clients"
          height={260}
          colorField="month"
          axis={{
            x: { labelFill: token.colorTextSecondary },
            y: { labelFill: token.colorTextSecondary },
          }}
          tooltip={{ items: [{ field: 'clients', channel: 'y', name: 'Клиенты' }] }}
          theme={token.colorBgBase === '#ffffff' ? 'classic' : 'classicDark'}
        />
      </Card>

      {/* ── Row 4: Top Clients + Payment Methods ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="Топ-30 клиентов по выручке" size="small">
            <Table
              dataSource={topClients}
              columns={clientCols}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10, size: 'small' }}
              scroll={{ x: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Способы оплаты" size="small">
            <Pie
              data={pieData}
              angleField="value"
              colorField="type"
              innerRadius={0.5}
              height={320}
              label={{
                text: (d: { type: string; value: number }) => `${d.type}: ${fmtNum(d.value)}`,
                position: 'outside',
                style: { fontSize: 12 },
              }}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => fmtNum(v) }] }}
              theme={token.colorBgBase === '#ffffff' ? 'classic' : 'classicDark'}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Row 5: Top Products + Managers ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="Топ-30 товаров по объёму" size="small">
            <Table
              dataSource={topProducts}
              columns={productCols}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10, size: 'small' }}
              scroll={{ x: 550 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Менеджеры" size="small">
            <Table
              dataSource={managers}
              columns={managerCols}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 450 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Row 6: Debtors ── */}
      <Card title="Должники" size="small" style={{ marginBottom: 24 }}>
        <Table
          dataSource={debtors}
          columns={debtorCols}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, size: 'small' }}
          scroll={{ x: 550 }}
        />
      </Card>
    </div>
  );
}
