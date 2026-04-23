import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Card, Descriptions, Table, Tag, Typography, Space, Empty, Skeleton } from 'antd';
import dayjs from 'dayjs';
import { suppliersApi } from '../api/suppliers.api';
import {
  IMPORT_ORDER_STATUS_COLORS,
  IMPORT_ORDER_STATUS_LABELS,
  type ImportOrderStatus,
  type SupplierCurrency,
  type SupplierOrderSummary,
  type SupplierProductSummary,
} from '../types';

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s, isLoading } = useQuery({
    queryKey: ['supplier-detail', id],
    queryFn: () => suppliersApi.getById(id!),
    enabled: !!id,
  });

  if (isLoading) return <Skeleton active />;
  if (!s) return <Empty description="Поставщик не найден" />;

  const productColumns = [
    {
      title: 'Товар',
      dataIndex: 'name',
      render: (v: string, r: SupplierProductSummary) => (
        <Link to={`/inventory/products/${r.id}`}>{v}</Link>
      ),
    },
    { title: 'SKU', dataIndex: 'sku', render: (v: string | null) => v || '—' },
    { title: 'Ед.', dataIndex: 'unit', width: 60, render: (v: string | null) => v || '—' },
    { title: 'Страна', dataIndex: 'countryOfOrigin', render: (v: string | null) => v || '—' },
    {
      title: 'Остаток',
      dataIndex: 'stock',
      width: 100,
      align: 'right' as const,
      render: (v: number | string) => Number(v).toLocaleString('ru-RU'),
    },
    {
      title: 'Активен',
      dataIndex: 'isActive',
      width: 100,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Да' : 'Нет'}</Tag>,
    },
  ];

  const orderColumns = [
    {
      title: 'Номер',
      dataIndex: 'number',
      render: (v: string, r: SupplierOrderSummary) => (
        <Link to={`/foreign-trade/import-orders/${r.id}`}>{v}</Link>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (v: ImportOrderStatus) => (
        <Tag color={IMPORT_ORDER_STATUS_COLORS[v]}>{IMPORT_ORDER_STATUS_LABELS[v]}</Tag>
      ),
    },
    {
      title: 'Дата заказа',
      dataIndex: 'orderDate',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'ETA',
      dataIndex: 'eta',
      render: (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '—'),
    },
    {
      title: 'Сумма',
      key: 'total',
      align: 'right' as const,
      render: (_: unknown, r: SupplierOrderSummary) =>
        `${Number(r.totalAmount).toLocaleString('ru-RU')} ${r.currency}`,
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <Space size={8}>
          {s.companyName}
          {s.isArchived && <Tag color="default">Архив</Tag>}
          <Tag color="blue">{s.currency as SupplierCurrency}</Tag>
          {s.incoterms && <Tag>{s.incoterms}</Tag>}
        </Space>
      </Typography.Title>

      <Card title="Реквизиты" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Страна">{s.country || '—'}</Descriptions.Item>
          <Descriptions.Item label="Контактное лицо">{s.contactPerson || '—'}</Descriptions.Item>
          <Descriptions.Item label="Email">{s.email || '—'}</Descriptions.Item>
          <Descriptions.Item label="Телефон">{s.phone || '—'}</Descriptions.Item>
          <Descriptions.Item label="Валюта">{s.currency}</Descriptions.Item>
          <Descriptions.Item label="Инкотермс">{s.incoterms || '—'}</Descriptions.Item>
          <Descriptions.Item label="SWIFT">{s.bankSwift || '—'}</Descriptions.Item>
          <Descriptions.Item label="IBAN">{s.iban || '—'}</Descriptions.Item>
          <Descriptions.Item label="Условия оплаты" span={2}>{s.paymentTerms || '—'}</Descriptions.Item>
          <Descriptions.Item label="Заметки" span={2}>{s.notes || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={`Товары поставщика (${s.products.length})`} size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={s.products}
          columns={productColumns}
          pagination={false}
          locale={{ emptyText: 'Нет связанных товаров' }}
        />
      </Card>

      <Card title={`Импортные заказы (${s.importOrders.length})`} size="small" bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={s.importOrders}
          columns={orderColumns}
          pagination={false}
          locale={{ emptyText: 'Заказов нет' }}
        />
      </Card>
    </div>
  );
}
