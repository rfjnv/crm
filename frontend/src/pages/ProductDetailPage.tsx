import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Typography, Card, Descriptions, Tag, Segmented, Spin, Row, Col,
  Statistic, Table, Space, Button,
} from 'antd';
import { ArrowLeftOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/charts';
import dayjs from 'dayjs';
import { inventoryApi } from '../api/warehouse.api';
import { useAuthStore } from '../store/authStore';

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const PERIODS = [
  { label: 'Месяц', value: 30 },
  { label: 'Квартал', value: 90 },
  { label: 'Год', value: 365 },
];

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [periodDays, setPeriodDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['product-analytics', id, periodDays],
    queryFn: () => inventoryApi.getProductAnalytics(id!, periodDays),
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
    : p.stock <= p.minStock
      ? { color: 'orange', label: 'Мало' }
      : { color: 'green', label: 'В наличии' };

  const chartData = (data.movements.movementsByDay || []).flatMap((d) => [
    { day: d.day, type: 'Приход', qty: d.inQty },
    { day: d.day, type: 'Расход', qty: d.outQty },
  ]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/inventory/products')} />
          <Typography.Title level={4} style={{ margin: 0 }}>{p.name}</Typography.Title>
          <Tag>{p.sku}</Tag>
          <Tag color={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Активен' : 'Неактивен'}</Tag>
        </Space>
        <Segmented
          value={periodDays}
          onChange={(v) => setPeriodDays(v as number)}
          options={PERIODS}
        />
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Product Info */}
        <Card size="small" bordered={false}>
          <Descriptions column={4} size="small">
            <Descriptions.Item label="Ед. изм.">{p.unit}</Descriptions.Item>
            <Descriptions.Item label="Категория">{p.category || '—'}</Descriptions.Item>
            <Descriptions.Item label="Формат">{p.format || '—'}</Descriptions.Item>
            <Descriptions.Item label="Страна">{p.countryOfOrigin || '—'}</Descriptions.Item>
            <Descriptions.Item label="Остаток">
              <Tag color={stockStatus.color}>{p.stock} {p.unit}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Мин. остаток">{p.minStock} {p.unit}</Descriptions.Item>
            <Descriptions.Item label="Цена продажи">{p.salePrice ? `${fmt(Number(p.salePrice))} so'm` : '—'}</Descriptions.Item>
            {isSuperAdmin && (
              <Descriptions.Item label="Закупочная">{p.purchasePrice ? `${fmt(Number(p.purchasePrice))} so'm` : '—'}</Descriptions.Item>
            )}
          </Descriptions>
        </Card>

        {/* Key Metrics */}
        <Row gutter={[12, 12]}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Выручка" value={sales.totalRevenue} formatter={(v) => fmt(Number(v))} suffix="so'm" />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Продано" value={sales.totalQuantitySold} suffix={p.unit} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Сделок" value={sales.dealsUsing} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="Ср. цена" value={sales.avgPricePerUnit} formatter={(v) => fmt(Number(v))} suffix="so'm" />
            </Card>
          </Col>
        </Row>

        {/* Profitability - only for SUPER_ADMIN */}
        {isSuperAdmin && profitability.totalRevenue > 0 && (
          <Card title="Рентабельность" size="small" bordered={false}>
            <Row gutter={12}>
              <Col span={6}>
                <Statistic title="Себестоимость" value={profitability.totalCost} formatter={(v) => fmt(Number(v))} suffix="so'm" />
              </Col>
              <Col span={6}>
                <Statistic title="Выручка" value={profitability.totalRevenue} formatter={(v) => fmt(Number(v))} suffix="so'm" />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Валовая прибыль"
                  value={profitability.grossProfit}
                  formatter={(v) => fmt(Number(v))}
                  suffix="so'm"
                  valueStyle={{ color: profitability.grossProfit >= 0 ? '#52c41a' : '#ff4d4f' }}
                />
              </Col>
              <Col span={6}>
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

        {/* Movement Chart */}
        {chartData.length > 0 && (
          <Card title="Движение товара" size="small" bordered={false}>
            <Column
              data={chartData}
              xField="day"
              yField="qty"
              seriesField="type"
              isGroup
              height={250}
              color={['#52c41a', '#ff4d4f']}
              legend={{ position: 'top-right' }}
              xAxis={{ label: { formatter: (v: string) => dayjs(v).format('DD.MM') } }}
            />
            <Row gutter={12} style={{ marginTop: 12 }}>
              <Col span={12}>
                <Statistic
                  title="Поступило за период"
                  value={data.movements.totalIn}
                  suffix={p.unit}
                  prefix={<ArrowUpOutlined />}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="Отгружено за период"
                  value={data.movements.totalOut}
                  suffix={p.unit}
                  prefix={<ArrowDownOutlined />}
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Col>
            </Row>
          </Card>
        )}

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
                  dataIndex: 'companyName',
                  render: (v: string, r) => <Link to={`/clients/${r.clientId}`}>{v}</Link>,
                },
                {
                  title: `Кол-во (${p.unit})`,
                  dataIndex: 'totalQty',
                  align: 'right' as const,
                  render: (v: number) => fmt(v),
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
                width: 100,
                render: (v: 'IN' | 'OUT') => (
                  <Tag color={v === 'IN' ? 'green' : 'red'}>{v === 'IN' ? 'Приход' : 'Расход'}</Tag>
                ),
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
                render: (v: string | undefined, r: { deal?: { id: string; title: string } | null }) =>
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
      </Space>
    </div>
  );
}
