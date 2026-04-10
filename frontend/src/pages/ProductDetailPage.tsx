import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useQuery } from '@tanstack/react-query';
import {
  Typography, Card, Descriptions, Tag, Segmented, Spin, Row, Col,
  Statistic, Table, Space, theme,
} from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/charts';
import dayjs from 'dayjs';
import { inventoryApi } from '../api/warehouse.api';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { formatUZS, moneyFormatter } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import ProductAuditHistoryPanel from '../components/ProductAuditHistoryPanel';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';

type PeriodChoice = 30 | 90 | 365 | 'all';

const PERIODS: { label: string; value: PeriodChoice }[] = [
  { label: 'Месяц', value: 30 },
  { label: 'Квартал', value: 90 },
  { label: 'Год', value: 365 },
  { label: 'Все', value: 'all' },
];

type ChartGranularity = 'day' | 'month' | 'quarter' | 'year';

function formatMovementChartBucket(isoDay: string, g: ChartGranularity): string {
  const d = isoDay.slice(0, 10);
  const [Y, M, D] = d.split('-').map((x) => parseInt(x, 10));
  if (!Y || !M) return isoDay;
  if (g === 'day') return `${String(D).padStart(2, '0')}.${String(M).padStart(2, '0')}`;
  if (g === 'month') return `${String(M).padStart(2, '0')}.${Y}`;
  if (g === 'year') return String(Y);
  const q = Math.floor((M - 1) / 3) + 1;
  return `Q${q} ${Y}`;
}

export default function ProductDetailPage() {
  const isMobile = useIsMobile();
  const { id } = useParams<{ id: string }>();
  const { token: tk } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [period, setPeriod] = useState<PeriodChoice>(30);
  const [granularity, setGranularity] = useState<ChartGranularity>('day');
  const prevPeriodRef = useRef<PeriodChoice>(period);

  const chartGranularityOptions = useMemo(() => {
    if (period === 'all') {
      return [
        { label: 'По месяцам', value: 'month' as const },
        { label: 'По кварталам', value: 'quarter' as const },
        { label: 'По годам', value: 'year' as const },
      ];
    }
    if (period <= 35) {
      return [{ label: 'По дням', value: 'day' as const }];
    }
    if (period <= 120) {
      return [
        { label: 'По дням', value: 'day' as const },
        { label: 'По месяцам', value: 'month' as const },
      ];
    }
    return [
      { label: 'По дням', value: 'day' as const },
      { label: 'По месяцам', value: 'month' as const },
      { label: 'По кварталам', value: 'quarter' as const },
    ];
  }, [period]);

  useEffect(() => {
    const prev = prevPeriodRef.current;
    prevPeriodRef.current = period;

    if (period === 30) {
      setGranularity('day');
      return;
    }
    if (prev === 30) {
      setGranularity('month');
      return;
    }
    setGranularity((g) => {
      const allowed = chartGranularityOptions.map((o) => o.value);
      return allowed.includes(g) ? g : 'month';
    });
  }, [period, chartGranularityOptions]);

  const effectiveGranularity: ChartGranularity | undefined =
    period === 30 ? undefined : granularity;

  const { data, isLoading } = useQuery({
    queryKey: ['product-analytics', id, period, effectiveGranularity ?? 'day'],
    queryFn: () => inventoryApi.getProductAnalytics(id!, period, effectiveGranularity),
    enabled: !!id,
  });

  const { data: movements, isLoading: movLoading } = useQuery({
    queryKey: ['product-movements', id],
    queryFn: () => inventoryApi.getProductMovements(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  if (!data) {
    return <Typography.Text>Товар не найден</Typography.Text>;
  }

  const { product: p, sales, profitability, topClients } = data;

  const stockStatus = p.stock <= 0
    ? { color: 'red', label: 'Нет в наличии' }
    : p.stock < p.minStock
      ? { color: 'orange', label: 'Мало' }
      : { color: 'green', label: 'В наличии' };

  const chartGranularity: ChartGranularity = data.movements.chartGranularity ?? 'day';

  const chartData = (data.movements.movementsByDay || []).flatMap(
    (d: { day: string; inQty: number; outQty: number }) => [
      { period: d.day, type: 'Приход', qty: d.inQty },
      { period: d.day, type: 'Отгрузка (сделки)', qty: d.outQty },
    ],
  );

  /** Только группировка графика; период — в шапке страницы */
  const movementChartTitle = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        width: '100%',
        rowGap: 8,
      }}
    >
      <Typography.Title level={5} style={{ margin: 0 }}>
        Движение товара
      </Typography.Title>
      <Segmented<ChartGranularity>
        size="small"
        value={period === 30 ? 'day' : granularity}
        onChange={(v) => setGranularity(v)}
        options={chartGranularityOptions}
      />
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 16, gap: 8 }}>
        <Space wrap>
          <BackButton fallback="/inventory/products" />
          <Typography.Title level={4} style={{ margin: 0 }}>{p.name}</Typography.Title>
          <Tag>{p.sku}</Tag>
          <Tag color={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Активен' : 'Неактивен'}</Tag>
        </Space>
        <Segmented<PeriodChoice>
          value={period}
          onChange={(v) => setPeriod(v)}
          options={PERIODS}
        />
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Product Info */}
        <Card size="small" bordered={false}>
          <Descriptions column={{ xs: 2, sm: 4 }} size="small">
            <Descriptions.Item label="Ед. изм.">{p.unit}</Descriptions.Item>
            <Descriptions.Item label="Категория">{p.category || '—'}</Descriptions.Item>
            <Descriptions.Item label="Формат">{p.format || '—'}</Descriptions.Item>
            <Descriptions.Item label="Страна">{p.countryOfOrigin || '—'}</Descriptions.Item>
            <Descriptions.Item label="Остаток">
              <Tag color={stockStatus.color}>{p.stock} {p.unit}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Мин. остаток">{p.minStock} {p.unit}</Descriptions.Item>
            <Descriptions.Item label="Цена продажи">{p.salePrice ? formatUZS(Number(p.salePrice)) : '—'}</Descriptions.Item>
            {isSuperAdmin && (
              <Descriptions.Item label="Закупочная">{p.purchasePrice ? formatUZS(Number(p.purchasePrice)) : '—'}</Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        {/* Key Metrics */}
        <Row gutter={[12, 12]}>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Выручка" value={sales.totalRevenue} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Продано" value={sales.totalQuantitySold} suffix={p.unit} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Сделок" value={sales.dealsUsing} />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small">
              <Statistic title="Ср. цена" value={sales.avgPricePerUnit} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
            </Card>
          </Col>
        </Row>

        {/* Profitability - only for SUPER_ADMIN */}
        {isSuperAdmin && profitability.totalRevenue > 0 && (
          <Card title="Рентабельность" size="small" bordered={false}>
            <Row gutter={12}>
              <Col xs={12} sm={6}>
                <Statistic title="Себестоимость" value={profitability.totalCost} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="Выручка" value={profitability.totalRevenue} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Валовая прибыль"
                  value={profitability.grossProfit}
                  formatter={(v) => moneyFormatter(Number(v))}
                  suffix="so'm"
                  valueStyle={{ color: profitability.grossProfit >= 0 ? '#52c41a' : '#ff4d4f' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Маржа"
                  value={profitability.marginPercent}
                  precision={1}
                  suffix="%"
                  valueStyle={{ color: profitability.marginPercent >= 0 ? '#52c41a' : '#ff4d4f' }}
                />
              </Col>
            </Row>
          </Card>
        )}

        {/* Движение: график (группировка — только в заголовке карточки); период — в шапке страницы */}
        <Card
            title={movementChartTitle}
            size="small"
            bordered={false}
            styles={{
              header: { minHeight: 'auto' },
              body: { paddingTop: chartData.length > 0 ? 8 : 16 },
            }}
          >
            {chartData.length > 0 ? (
              <Column
                data={chartData}
                xField="period"
                yField="qty"
                seriesField="type"
                isGroup
                height={250}
                color={['#52c41a', '#ff4d4f']}
                legend={{ position: 'top' }}
                xAxis={{
                  label: {
                    formatter: (v: string) => formatMovementChartBucket(String(v), chartGranularity),
                  },
                }}
                theme={chartTheme}
                axis={{
                  x: { labelFill: tk.colorText },
                  y: { labelFill: tk.colorText },
                }}
              />
            ) : (
              <Typography.Text type="secondary">
                За выбранный период нет приходов и отгрузок по сделкам.
              </Typography.Text>
            )}
            <Row gutter={[12, 12]} style={{ marginTop: chartData.length > 0 ? 16 : 8 }}>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Поступило за период"
                  value={data.movements.totalIn}
                  suffix={p.unit}
                  prefix={<ArrowUpOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Statistic
                  title="Отгрузка по сделкам"
                  value={data.movements.totalOut}
                  suffix={p.unit}
                  prefix={<ArrowDownOutlined />}
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Col>
            </Row>
          </Card>

        {/* Top Clients */}
        {topClients.length > 0 && (
          <Card title="Топ клиенты" size="small" bordered={false}>
            <Table
              dataSource={topClients}
              rowKey="clientId"
              size="small"
              pagination={false}
              columns={[
                {
                  title: 'Клиент',
                  key: 'client',
                  render: (_: unknown, r: { clientId: string; companyName: string; isSvip?: boolean }) => (
                    <ClientCompanyDisplay client={{ id: r.clientId, companyName: r.companyName, isSvip: r.isSvip }} link />
                  ),
                },
                {
                  title: `Кол-во (${p.unit})`,
                  dataIndex: 'totalQty',
                  align: 'right' as const,
                  render: (v: number) => moneyFormatter(v),
                },
              ]}
            />
          </Card>
        )}

        {/* Recent Movements */}
        <Card title="История движения" size="small" bordered={false}>
          <Table
            dataSource={movements || []}
            rowKey="id"
            size="small"
            loading={movLoading}
            pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '15', '30', '50'] }}
            scroll={{ x: 600 }}
            columns={[
              {
                title: 'Дата',
                dataIndex: 'createdAt',
                width: 140,
                render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
              },
              {
                title: 'Тип',
                dataIndex: 'type',
                width: 120,
                render: (v: string) => {
                  const cfg =
                    v === 'IN'
                      ? { color: 'green' as const, label: 'Приход' }
                      : v === 'CORRECTION'
                        ? { color: 'orange' as const, label: 'Коррекция' }
                        : { color: 'red' as const, label: 'Расход' };
                  return <Tag color={cfg.color}>{cfg.label}</Tag>;
                },
              },
              {
                title: 'Кол-во',
                dataIndex: 'quantity',
                width: 100,
                align: 'right' as const,
              },
              {
                title: 'Сделка',
                dataIndex: ['deal', 'title'],
                render: (_v: string | undefined, r: { deal?: { id: string; title: string } | null }) =>
                  r.deal ? <Link to={`/deals/${r.deal.id}`}>{r.deal.title || r.deal.id.slice(0, 8)}</Link> : '—',
              },
              {
                title: 'Примечание',
                dataIndex: 'note',
                render: (v: string | null) => v || '—',
              },
            ]}
          />
        </Card>

        {isSuperAdmin && (
          <Card title="История изменений товара" size="small" bordered={false}>
            <ProductAuditHistoryPanel productId={id} />
          </Card>
        )}
      </Space>
    </div>
  );
}
