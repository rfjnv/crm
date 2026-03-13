import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Tabs, Card, Col, Row, Statistic, Table, Typography, Spin, Tag, Segmented, theme, Tooltip, Badge } from 'antd';
import {
  DollarOutlined,
  RiseOutlined,
  PercentageOutlined,
  FallOutlined,
  WarningOutlined,
  StockOutlined,
  InfoCircleOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  ShoppingOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Pie, Bar, Line, Area } from '@ant-design/charts';
import { analyticsApi, type AnalyticsPeriod } from '../api/analytics.api';
import { statusConfig } from '../components/DealStatusTag';
import { formatUZS } from '../utils/currency';
import type { DealStatus, ClientLTVRow, CrossSellPair, DemandStabilityRow } from '../types';

const statusColorMap: Record<string, string> = {
  NEW: '#6b9bd2',
  IN_PROGRESS: '#7ba7d7',
  WAITING_STOCK_CONFIRMATION: '#d4b896',
  STOCK_CONFIRMED: '#8cbcb5',
  FINANCE_APPROVED: '#b5c9a0',
  ADMIN_APPROVED: '#a89bc4',
  READY_FOR_SHIPMENT: '#c9a0b5',
  CLOSED: '#7db88a',
  CANCELED: '#d4918f',
  REJECTED: '#c98a8a',
};

const segmentColorMap: Record<string, string> = {
  VIP: '#722ed1',
  Regular: '#1677ff',
  New: '#52c41a',
  'At-Risk': '#fa8c16',
  Churned: '#ff4d4f',
};

const segmentLabelMap: Record<string, string> = {
  VIP: 'VIP',
  Regular: 'Постоянные',
  New: 'Новые',
  'At-Risk': 'Под угрозой',
  Churned: 'Потерянные',
};

const methodLabelMap: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
  'Не указан': 'Не указан',
};

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const periodOptions = [
  { label: 'Неделя', value: 'week' },
  { label: 'Месяц', value: 'month' },
  { label: 'Квартал', value: 'quarter' },
  { label: 'Год', value: 'year' },
];

function FormulaHint({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined style={{ marginLeft: 4, fontSize: 12, opacity: 0.45 }} />
    </Tooltip>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const { token } = theme.useToken();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', period],
    queryFn: () => analyticsApi.getData(period),
  });

  const { data: intel } = useQuery({
    queryKey: ['analytics-intelligence', period],
    queryFn: () => analyticsApi.getIntelligence(period),
  });

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const { sales, finance, warehouse, managers, profitability } = data;

  // ──── Sales tab data ────
  const pieData = sales.dealsByStatus.map((d) => ({
    type: statusConfig[d.status as DealStatus]?.label || d.status,
    value: d.count,
    color: statusColorMap[d.status] || '#8c8c8c',
  }));
  const pieColorDomain = pieData.map((d) => d.type);
  const pieColorRange = pieData.map((d) => d.color);

  const buildRevenueChartData = (
    raw: { day: string; total: number }[],
  ): { day: string; total: number }[] => {
    if (raw.length === 0) return [];
    const map = new Map(raw.map((d) => [d.day, d.total]));
    const sorted = [...raw].sort((a, b) => a.day.localeCompare(b.day));
    const startDate = new Date(sorted[0].day + 'T12:00:00Z');
    const endDate = new Date(sorted[sorted.length - 1].day + 'T12:00:00Z');
    const filled: { day: string; total: number }[] = [];
    for (let dt = new Date(startDate); dt <= endDate; dt.setUTCDate(dt.getUTCDate() + 1)) {
      const key = dt.toISOString().slice(0, 10);
      filled.push({ day: key, total: map.get(key) ?? 0 });
    }
    return filled.map((d) => {
      const parts = d.day.split('-');
      const dayNum = parseInt(parts[2]);
      const monthIdx = parseInt(parts[1]) - 1;
      return { day: `${dayNum} ${MONTH_SHORT[monthIdx]}`, total: d.total };
    });
  };

  const lineData = buildRevenueChartData(sales.revenueByDay);

  const clientBarData = sales.topClients.map((c) => ({
    name: c.companyName,
    value: c.totalRevenue,
    clientId: c.clientId,
  }));

  const productBarData = sales.topProducts.map((p) => ({
    name: p.name,
    value: p.totalQuantity,
    productId: p.productId,
  }));

  const topSellingBarData = warehouse.topSelling.map((p) => ({
    name: p.name,
    value: p.totalSold,
    productId: p.productId,
  }));

  // ════════════════════════════════════════
  // ──── SALES TAB ────
  // ════════════════════════════════════════

  const salesTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Общая выручка<FormulaHint text="Сумма оплат по закрытым сделкам за период" /></span>}
              value={sales.totalRevenue}
              formatter={(v) => formatUZS(v as number)}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Средний чек<FormulaHint text="Общая выручка ÷ Кол-во завершённых сделок" /></span>}
              value={sales.avgDealAmount}
              formatter={(v) => formatUZS(v as number)}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        {sales.conversionNewToCompleted !== null && (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false} size="small">
              <Statistic
                title={<span>Конверсия<FormulaHint text="Завершённых сделок ÷ Всего созданных × 100%" /></span>}
                value={(sales.conversionNewToCompleted * 100).toFixed(1)}
                suffix="%"
                prefix={<PercentageOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        )}
        {sales.cancellationRate !== null && (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false} size="small">
              <Statistic
                title={<span>Отмены<FormulaHint text="Отменённых сделок ÷ Всего созданных × 100%" /></span>}
                value={(sales.cancellationRate * 100).toFixed(1)}
                suffix="%"
                prefix={<FallOutlined />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
        )}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Выручка по дням" bordered={false}>
            {lineData.length > 0 ? (
              <Line
                data={lineData}
                xField="day"
                yField="total"
                height={340}
                shapeField="smooth"
                style={{
                  stroke: '#5b8db8',
                  lineWidth: 2.5,
                }}
                point={{ size: 3, style: { fill: '#fff', stroke: '#5b8db8', lineWidth: 1.5 } }}
                axis={{
                  y: {
                    labelFormatter: (v: number) => formatUZS(v),
                    labelFill: token.colorTextSecondary,
                    grid: true,
                    gridStroke: token.colorBorderSecondary,
                    gridLineDash: [4, 4],
                  },
                  x: {
                    labelFill: token.colorTextSecondary,
                    labelAutoRotate: false,
                  },
                }}
                tooltip={{ items: [{ field: 'total', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Сделки по статусам" bordered={false}>
            {pieData.length > 0 ? (
              <Pie
                data={pieData}
                angleField="value"
                colorField="type"
                innerRadius={0.5}
                height={300}
                scale={{ color: { domain: pieColorDomain, range: pieColorRange } }}
                label={false}
                legend={{ color: { position: 'right', itemLabelFill: token.colorText } }}
                interaction={{ elementHighlight: { background: true } }}
                tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сделок', valueFormatter: (v: number) => `${v}` }] }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Топ 5 клиентов по выручке" bordered={false}>
            {clientBarData.length > 0 ? (
              <>
                <Bar
                  data={clientBarData}
                  xField="name"
                  yField="value"
                  height={300}
                  colorField="name"
                  axis={{
                    x: { labelFill: token.colorTextSecondary },
                    y: { labelFormatter: (v: number) => formatUZS(v), labelFill: token.colorTextSecondary },
                  }}
                  tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Выручка', valueFormatter: (v: number) => formatUZS(v) }] }}
                  theme={chartTheme}
                  onReady={(plot) => {
                    plot.chart.on('element:click', (evt: { data?: { data?: { clientId?: string } } }) => {
                      const id = evt?.data?.data?.clientId;
                      if (id) navigate(`/clients/${id}`);
                    });
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
                  Нажмите на столбец для перехода к клиенту
                </div>
              </>
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Топ 5 товаров по продажам" bordered={false}>
            {productBarData.length > 0 ? (
              <>
                <Bar
                  data={productBarData}
                  xField="name"
                  yField="value"
                  height={300}
                  colorField="name"
                  axis={{
                    x: { labelFill: token.colorTextSecondary },
                    y: { labelFill: token.colorTextSecondary },
                  }}
                  tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Продано' }] }}
                  theme={chartTheme}
                  onReady={(plot) => {
                    plot.chart.on('element:click', (evt: { data?: { data?: { productId?: string } } }) => {
                      const id = evt?.data?.data?.productId;
                      if (id) navigate(`/inventory/products/${id}`);
                    });
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
                  Нажмите на столбец для перехода к товару
                </div>
              </>
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );

  // ════════════════════════════════════════
  // ──── FINANCE TAB (extended) ────
  // ════════════════════════════════════════

  const methodPieData = (intel?.financial.revenueByMethod ?? []).map((r) => ({
    type: methodLabelMap[r.method] || r.method,
    value: r.total,
  }));

  const financeTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Link to="/finance/debts" style={{ display: 'block' }}>
            <Card bordered={false} hoverable>
              <Statistic
                title={<span>Общий долг<FormulaHint text="SUM(amount − paidAmount) по всем активным сделкам (живой расчёт)" /></span>}
                value={finance.totalDebt}
                formatter={(v) => formatUZS(v as number)}
                prefix={<WarningOutlined />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic
              title={<span>Реальный оборот<FormulaHint text="Сумма всех внесённых оплат (payments.amount) за период" /></span>}
              value={finance.realTurnover}
              formatter={(v) => formatUZS(v as number)}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic
              title={<span>Бумажный оборот<FormulaHint text="Сумма amount (суммы) всех закрытых сделок за период" /></span>}
              value={finance.paperTurnover}
              formatter={(v) => formatUZS(v as number)}
              prefix={<StockOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="Просроченные долги" bordered={false}>
            {finance.overdueDebts.length === 0 ? (
              <Typography.Text type="secondary">Нет просроченных долгов</Typography.Text>
            ) : (
              <Table
                dataSource={finance.overdueDebts}
                rowKey="dealId"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/deals/${r.dealId}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Сделка', dataIndex: 'title', render: (v: string, r) => <Link to={`/deals/${r.dealId}`}>{v}</Link> },
                  { title: 'Клиент', dataIndex: 'clientName' },
                  { title: 'Долг', dataIndex: 'debt', align: 'right' as const, render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{formatUZS(v)}</span> },
                  { title: 'Срок', dataIndex: 'dueDate' },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Топ должники" bordered={false}>
            {finance.topDebtors.length === 0 ? (
              <Typography.Text type="secondary">Нет должников</Typography.Text>
            ) : (
              <Table
                dataSource={finance.topDebtors}
                rowKey="clientId"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/clients/${r.clientId}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Клиент', dataIndex: 'companyName', render: (v: string, r) => <Link to={`/clients/${r.clientId}`}>{v}</Link> },
                  { title: 'Общий долг', dataIndex: 'totalDebt', align: 'right' as const, render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{formatUZS(v)}</span> },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* ──── Financial Intelligence extension ──── */}
      {intel && (
        <>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic
                  title={<span>Ср. задержка оплаты<FormulaHint text="Среднее кол-во дней от создания сделки до первого платежа" /></span>}
                  value={intel.financial.avgPaymentDelayDays}
                  precision={1}
                  suffix="дн."
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: intel.financial.avgPaymentDelayDays > 14 ? '#ff4d4f' : '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic
                  title={<span>Оплата в срок<FormulaHint text="% сделок с дедлайном, оплаченных до дедлайна" /></span>}
                  value={(intel.financial.onTimePaymentRate * 100).toFixed(1)}
                  suffix="%"
                  prefix={<CheckCircleOutlined />}
                  valueStyle={{ color: intel.financial.onTimePaymentRate >= 0.7 ? '#52c41a' : '#ff4d4f' }}
                />
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24}>
              <Card title="Выручка по способам оплаты" bordered={false}>
                {methodPieData.length > 0 ? (
                  <Pie
                    data={methodPieData}
                    angleField="value"
                    colorField="type"
                    innerRadius={0.5}
                    height={320}
                    label={{
                      text: (d: { type: string; value: number }) => `${d.type}: ${formatUZS(d.value)}`,
                      position: 'outside',
                      style: { fill: token.colorText, fontSize: 12 },
                    }}
                    legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                    tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => formatUZS(v) }] }}
                    theme={chartTheme}
                  />
                ) : (
                  <Typography.Text type="secondary">Нет данных</Typography.Text>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );

  // ════════════════════════════════════════
  // ──── CLIENT INTELLIGENCE TAB ────
  // ════════════════════════════════════════

  const clientsIntel = intel?.clients;

  const segmentPieData = (clientsIntel?.segments ?? []).map((s) => ({
    type: segmentLabelMap[s.segment] || s.segment,
    value: s.count,
    color: segmentColorMap[s.segment] || '#8c8c8c',
  }));
  const segPieColorDomain = segmentPieData.map((d) => d.type);
  const segPieColorRange = segmentPieData.map((d) => d.color);

  function riskBadge(score: number) {
    if (score <= 20) return <Badge color="#52c41a" text={`${score}`} />;
    if (score <= 50) return <Badge color="#fa8c16" text={`${score}`} />;
    return <Badge color="#ff4d4f" text={`${score}`} />;
  }

  function segmentTag(seg: string) {
    return <Tag color={segmentColorMap[seg] || 'default'}>{segmentLabelMap[seg] || seg}</Tag>;
  }

  const clientsTab = clientsIntel ? (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic title="Всего клиентов" value={clientsIntel.totalClients} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic title="Повторных клиентов" value={clientsIntel.repeatClients} prefix={<UserSwitchOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Процент повторных<FormulaHint text="Клиентов с 2+ завершёнными сделками ÷ Всего клиентов" /></span>}
              value={(clientsIntel.repeatRate * 100).toFixed(1)}
              suffix="%"
              prefix={<PercentageOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Ср. частота покупок<FormulaHint text="Среднее кол-во дней между сделками для повторных клиентов" /></span>}
              value={clientsIntel.avgFrequencyDays}
              precision={1}
              suffix="дн."
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <Card title="Сегменты клиентов" bordered={false}>
            {segmentPieData.length > 0 ? (
              <Pie
                data={segmentPieData}
                angleField="value"
                colorField="type"
                innerRadius={0.5}
                height={320}
                scale={{ color: { domain: segPieColorDomain, range: segPieColorRange } }}
                label={{
                  text: (d: { type: string; value: number }) => `${d.type}: ${d.value}`,
                  position: 'outside',
                  style: { fill: token.colorText, fontSize: 12 },
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Клиентов', valueFormatter: (v: number) => `${v}` }] }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Топ клиенты по LTV" bordered={false}>
            <Table
              dataSource={clientsIntel.topByLTV}
              rowKey="clientId"
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
              onRow={(r) => ({ onClick: () => navigate(`/clients/${r.clientId}`), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: 'Компания', dataIndex: 'companyName',
                  render: (v: string, r: ClientLTVRow) => <Link to={`/clients/${r.clientId}`}>{v}</Link>,
                },
                { title: 'LTV', dataIndex: 'ltv', align: 'right' as const, render: (v: number) => formatUZS(v), sorter: (a: ClientLTVRow, b: ClientLTVRow) => a.ltv - b.ltv },
                { title: 'Сделок', dataIndex: 'dealsCount', align: 'center' as const, width: 80 },
                { title: 'Ср. чек', dataIndex: 'avgDealAmount', align: 'right' as const, render: (v: number) => formatUZS(v), width: 120 },
                { title: 'Риск', dataIndex: 'riskScore', width: 70, align: 'center' as const, render: (v: number) => riskBadge(v), sorter: (a: ClientLTVRow, b: ClientLTVRow) => a.riskScore - b.riskScore },
                { title: 'Сегмент', dataIndex: 'segment', width: 120, render: (v: string) => segmentTag(v) },
                { title: 'Посл. сделка', dataIndex: 'lastDealDate', width: 110 },
              ]}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
              Нажмите на строку для перехода к клиенту
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  ) : (
    <Spin style={{ display: 'block', margin: '60px auto' }} />
  );

  // ════════════════════════════════════════
  // ──── PRODUCT INTELLIGENCE TAB ────
  // ════════════════════════════════════════

  const productsIntel = intel?.products;

  const stabilityBarData = (productsIntel?.demandStability ?? []).map((r) => ({
    name: r.name,
    value: r.avgMonthlySales,
    cv: r.coefficient,
    productId: r.productId,
  }));

  const seasonalityData = (productsIntel?.seasonality ?? []).flatMap((r) => [
    {
      month: MONTH_SHORT[r.month - 1] || `${r.month}`,
      value: r.totalQuantity,
      type: 'Количество' as const,
    },
    {
      month: MONTH_SHORT[r.month - 1] || `${r.month}`,
      value: r.totalRevenue,
      type: 'Выручка' as const,
    },
  ]);

  const productsTab = productsIntel ? (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<span>Кросс-продажи<FormulaHint text="Товары, которые чаще всего покупаются вместе в одной сделке" /></span>} bordered={false}>
            {productsIntel.crossSellPairs.length === 0 ? (
              <Typography.Text type="secondary">Нет данных о совместных покупках</Typography.Text>
            ) : (
              <Table
                dataSource={productsIntel.crossSellPairs}
                rowKey={(r: CrossSellPair) => `${r.product1Id}-${r.product2Id}`}
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'Товар 1', dataIndex: 'product1Name',
                    render: (v: string, r: CrossSellPair) => <Link to={`/inventory/products/${r.product1Id}`}>{v}</Link>,
                  },
                  {
                    title: 'Товар 2', dataIndex: 'product2Name',
                    render: (v: string, r: CrossSellPair) => <Link to={`/inventory/products/${r.product2Id}`}>{v}</Link>,
                  },
                  {
                    title: 'Совм. продаж', dataIndex: 'coOccurrences', width: 120, align: 'center' as const,
                    sorter: (a: CrossSellPair, b: CrossSellPair) => a.coOccurrences - b.coOccurrences,
                  },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span>Стабильность спроса<FormulaHint text="Товары с наиболее равномерными ежемесячными продажами (низкий коэффициент вариации)" /></span>} bordered={false}>
            {stabilityBarData.length > 0 ? (
              <>
                <Bar
                  data={stabilityBarData}
                  xField="name"
                  yField="value"
                  height={340}
                  colorField="name"
                  axis={{
                    x: { labelFill: token.colorTextSecondary },
                    y: { labelFill: token.colorTextSecondary, title: 'Ср. в месяц' },
                  }}
                  tooltip={{
                    items: [
                      { field: 'value', channel: 'y', name: 'Ср. в месяц', valueFormatter: (v: number) => `${v.toFixed(1)}` },
                    ],
                  }}
                  theme={chartTheme}
                  onReady={(plot) => {
                    plot.chart.on('element:click', (evt: { data?: { data?: { productId?: string } } }) => {
                      const id = evt?.data?.data?.productId;
                      if (id) navigate(`/inventory/products/${id}`);
                    });
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
                  Нажмите на столбец для перехода к товару
                </div>
                <Table
                  dataSource={productsIntel.demandStability}
                  rowKey="productId"
                  size="small"
                  pagination={false}
                  style={{ marginTop: 12 }}
                  columns={[
                    { title: 'Товар', dataIndex: 'name' },
                    { title: 'Ср./мес.', dataIndex: 'avgMonthlySales', align: 'right' as const, render: (v: number) => v.toFixed(1) },
                    {
                      title: <span>CV<FormulaHint text="Коэффициент вариации. Чем ниже, тем стабильнее спрос" /></span>,
                      dataIndex: 'coefficient', align: 'right' as const, width: 80,
                      render: (v: number) => <span style={{ color: v < 0.5 ? '#52c41a' : v < 1 ? '#fa8c16' : '#ff4d4f' }}>{v.toFixed(2)}</span>,
                      sorter: (a: DemandStabilityRow, b: DemandStabilityRow) => a.coefficient - b.coefficient,
                    },
                  ]}
                />
              </>
            ) : (
              <Typography.Text type="secondary">Недостаточно данных (нужно 3+ месяцев продаж)</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title={<span>Сезонность продаж<FormulaHint text="Суммарное количество и выручка по месяцам за последние 12 месяцев" /></span>} bordered={false}>
            {seasonalityData.length > 0 ? (
              <Area
                data={seasonalityData}
                xField="month"
                yField="value"
                colorField="type"
                height={300}
                shapeField="smooth"
                axis={{
                  y: {
                    labelFill: token.colorTextSecondary,
                    grid: true,
                    gridStroke: token.colorBorderSecondary,
                    gridLineDash: [4, 4],
                  },
                  x: { labelFill: token.colorTextSecondary },
                }}
                tooltip={{
                  items: [
                    { field: 'value', channel: 'y', name: 'Значение', valueFormatter: (v: number) => v > 10000 ? formatUZS(v) : `${v}` },
                  ],
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  ) : (
    <Spin style={{ display: 'block', margin: '60px auto' }} />
  );

  // ════════════════════════════════════════
  // ──── WAREHOUSE TAB ────
  // ════════════════════════════════════════

  const warehouseTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic
              title={<span>Замороженный капитал<FormulaHint text="Сумма (stock × purchasePrice) по всем товарам с остатком > 0" /></span>}
              value={warehouse.frozenCapital}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic title="Ниже минимума" value={warehouse.belowMinStock.length} valueStyle={{ color: warehouse.belowMinStock.length > 0 ? '#ff4d4f' : '#52c41a' }} suffix="товаров" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic title="Мёртвый остаток" value={warehouse.deadStock.length} valueStyle={{ color: warehouse.deadStock.length > 0 ? '#fa8c16' : '#52c41a' }} suffix="товаров" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={<span>Ниже минимального остатка<FormulaHint text="Товары где stock < minStock" /></span>} bordered={false}>
            {warehouse.belowMinStock.length === 0 ? (
              <Typography.Text type="secondary">Все товары в норме</Typography.Text>
            ) : (
              <Table
                dataSource={warehouse.belowMinStock}
                rowKey="id"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Товар', dataIndex: 'name' },
                  { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Остаток', dataIndex: 'stock', align: 'right' as const, render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{v}</span> },
                  { title: 'Минимум', dataIndex: 'minStock', align: 'right' as const },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span>Мёртвый остаток (&gt;30 дней)<FormulaHint text="Товары с остатком > 0, последний расход более 30 дней назад" /></span>} bordered={false}>
            {warehouse.deadStock.length === 0 ? (
              <Typography.Text type="secondary">Нет мёртвого остатка</Typography.Text>
            ) : (
              <Table
                dataSource={warehouse.deadStock}
                rowKey="id"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Товар', dataIndex: 'name' },
                  { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Остаток', dataIndex: 'stock', align: 'right' as const },
                  { title: 'Посл. списание', dataIndex: 'lastOutDate', render: (v: string | null) => v || 'Никогда' },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Топ продаваемых товаров" bordered={false} style={{ marginTop: 16 }}>
        {topSellingBarData.length > 0 ? (
          <>
            <Bar
              data={topSellingBarData}
              xField="name"
              yField="value"
              height={300}
              colorField="name"
              axis={{
                x: { labelFill: token.colorTextSecondary },
                y: { labelFill: token.colorTextSecondary },
              }}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Продано' }] }}
              theme={chartTheme}
              onReady={(plot) => {
                plot.chart.on('element:click', (evt: { data?: { data?: { productId?: string } } }) => {
                  const id = evt?.data?.data?.productId;
                  if (id) navigate(`/inventory/products/${id}`);
                });
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
              Нажмите на столбец для перехода к товару
            </div>
          </>
        ) : (
          <Typography.Text type="secondary">Нет данных</Typography.Text>
        )}
      </Card>
    </div>
  );

  // ════════════════════════════════════════
  // ──── MANAGERS TAB (extended) ────
  // ════════════════════════════════════════

  const managerRows = intel?.managers.rows ?? managers.rows.map((m) => ({
    ...m,
    uniqueClients: 0,
    repeatClients: 0,
    retentionRate: 0,
  }));

  const managersTab = (
    <Card bordered={false}>
      <Table
        dataSource={managerRows}
        rowKey="managerId"
        pagination={false}
        size="middle"
        scroll={{ x: 900 }}
        columns={[
          { title: 'Менеджер', dataIndex: 'fullName', fixed: 'left' as const, width: 160 },
          { title: 'Завершённых', dataIndex: 'completedCount', align: 'right' as const, width: 100 },
          { title: 'Общая сумма', dataIndex: 'totalRevenue', align: 'right' as const, render: (v: number) => formatUZS(v), width: 130 },
          {
            title: <span>Средний чек<FormulaHint text="Общая сумма ÷ Кол-во завершённых сделок" /></span>,
            dataIndex: 'avgDealAmount',
            align: 'right' as const,
            render: (v: number) => formatUZS(v),
            width: 120,
          },
          {
            title: <span>Конверсия<FormulaHint text="Завершённых ÷ Всего созданных × 100%" /></span>,
            dataIndex: 'conversionRate',
            align: 'right' as const,
            width: 100,
            render: (v: number) => {
              const pct = v * 100;
              return <span style={{ color: pct >= 50 ? '#52c41a' : pct >= 25 ? '#fa8c16' : '#ff4d4f' }}>{pct.toFixed(1)}%</span>;
            },
          },
          {
            title: <span>Ср. время<FormulaHint text="Среднее кол-во дней от создания до закрытия сделки" /></span>,
            dataIndex: 'avgDealDays',
            align: 'right' as const,
            width: 90,
            render: (v: number) => `${v.toFixed(1)} дн.`,
          },
          {
            title: <span>Уник. кл.<FormulaHint text="Количество уникальных клиентов с завершёнными сделками" /></span>,
            dataIndex: 'uniqueClients',
            align: 'right' as const,
            width: 90,
          },
          {
            title: <span>Повт. кл.<FormulaHint text="Клиенты с 2+ завершёнными сделками у этого менеджера" /></span>,
            dataIndex: 'repeatClients',
            align: 'right' as const,
            width: 90,
          },
          {
            title: <span>Удержание<FormulaHint text="Повторных клиентов ÷ Уникальных клиентов × 100%" /></span>,
            dataIndex: 'retentionRate',
            align: 'right' as const,
            width: 100,
            render: (v: number) => {
              const pct = v * 100;
              return <span style={{ color: pct >= 30 ? '#52c41a' : pct >= 15 ? '#fa8c16' : '#ff4d4f', fontWeight: 600 }}>{pct.toFixed(1)}%</span>;
            },
          },
        ]}
        locale={{ emptyText: 'Нет данных по менеджерам' }}
      />
    </Card>
  );

  // ════════════════════════════════════════
  // ──── PROFITABILITY TAB ────
  // ════════════════════════════════════════

  const expensePieData = (profitability?.expensesByCategory ?? []).map((e) => ({
    type: e.category,
    value: e.total,
  }));

  const grossMargin = profitability?.revenue ? ((profitability.grossProfit / profitability.revenue) * 100) : 0;
  const netMargin = profitability?.revenue ? ((profitability.netProfit / profitability.revenue) * 100) : 0;

  const profitabilityTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Выручка<FormulaHint text="Сумма оплат по закрытым сделкам" /></span>}
              value={profitability?.revenue ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Себестоимость<FormulaHint text="Сумма (purchasePrice × qty) по проданным товарам" /></span>}
              value={profitability?.cogs ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Вал. прибыль<FormulaHint text="Выручка − Себестоимость" /></span>}
              value={profitability?.grossProfit ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Расходы<FormulaHint text="Сумма всех расходов из раздела Расходы" /></span>}
              value={profitability?.expenses ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Чистая прибыль<FormulaHint text="Валовая прибыль − Расходы" /></span>}
              value={profitability?.netProfit ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: (profitability?.netProfit ?? 0) >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Маржа<FormulaHint text="Чистая прибыль ÷ Выручка × 100%" /></span>}
              value={netMargin}
              precision={1}
              suffix="%"
              valueStyle={{ color: netMargin >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
              Валовая: {grossMargin.toFixed(1)}%
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="Расходы по категориям" bordered={false}>
            {expensePieData.length > 0 ? (
              <Pie
                data={expensePieData}
                angleField="value"
                colorField="type"
                innerRadius={0.5}
                height={360}
                label={{
                  text: (d: { type: string; value: number }) => `${d.type}: ${formatUZS(d.value)}`,
                  position: 'outside',
                  style: { fill: token.colorText, fontSize: 12 },
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                tooltip={{
                  items: [
                    {
                      field: 'value',
                      channel: 'y',
                      name: 'Сумма',
                      valueFormatter: (v: number) => formatUZS(v),
                    },
                  ],
                }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Аналитика</Typography.Title>
        <Segmented
          options={periodOptions}
          value={period}
          onChange={(v) => setPeriod(v as AnalyticsPeriod)}
        />
      </div>

      <Tabs
        defaultActiveKey="sales"
        items={[
          { key: 'sales', label: 'Продажи', children: salesTab },
          { key: 'finance', label: 'Финансы', children: financeTab },
          { key: 'clients', label: 'Клиенты', icon: <TeamOutlined />, children: clientsTab },
          { key: 'products', label: 'Товары+', icon: <ShoppingOutlined />, children: productsTab },
          { key: 'warehouse', label: 'Склад', children: warehouseTab },
          { key: 'managers', label: 'Менеджеры', children: managersTab },
          { key: 'profitability', label: 'Рентабельность', children: profitabilityTab },
        ]}
      />
    </div>
  );
}
