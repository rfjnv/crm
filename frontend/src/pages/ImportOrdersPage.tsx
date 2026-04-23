import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, EyeOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { importOrdersApi, type CreateImportOrderPayload } from '../api/import-orders.api';
import { suppliersApi } from '../api/suppliers.api';
import {
  IMPORT_ORDER_STATUS_COLORS,
  IMPORT_ORDER_STATUS_LABELS,
  SUPPLIER_CURRENCIES,
  type ImportOrderListItem,
  type ImportOrderStatus,
  type SupplierCurrency,
} from '../types';
import { useAuthStore } from '../store/authStore';
import { matchesSearch } from '../utils/translit';
import CbuRatesWidget from '../components/CbuRatesWidget';

const ALL_STATUSES: ImportOrderStatus[] = [
  'DRAFT', 'ORDERED', 'IN_PRODUCTION', 'SHIPPED',
  'IN_TRANSIT', 'AT_CUSTOMS', 'CLEARED', 'RECEIVED', 'CANCELED',
];

export default function ImportOrdersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage =
    user?.role === 'SUPER_ADMIN'
    || user?.role === 'ADMIN'
    || (user?.permissions ?? []).includes('manage_import_orders');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ImportOrderStatus | undefined>();
  const [supplierFilter, setSupplierFilter] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<{
    number: string;
    supplierId: string;
    currency: SupplierCurrency;
    orderDate: dayjs.Dayjs;
    etd?: dayjs.Dayjs;
    eta?: dayjs.Dayjs;
    invoiceNumber?: string;
    containerNumber?: string;
    notes?: string;
  }>();

  const { data, isLoading } = useQuery({
    queryKey: ['import-orders', statusFilter, supplierFilter],
    queryFn: () => importOrdersApi.list({ status: statusFilter, supplierId: supplierFilter }),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', false],
    queryFn: () => suppliersApi.list({ includeArchived: false }),
  });

  const createMut = useMutation({
    mutationFn: (payload: CreateImportOrderPayload) => importOrdersApi.create(payload),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ['import-orders'] });
      message.success(`Заказ ${order.number} создан`);
      setModalOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  function openCreate() {
    form.resetFields();
    form.setFieldsValue({ currency: 'USD', orderDate: dayjs() });
    setModalOpen(true);
  }

  function handleSubmit() {
    form.validateFields().then((v) => {
      createMut.mutate({
        number: v.number,
        supplierId: v.supplierId,
        currency: v.currency,
        orderDate: v.orderDate.format('YYYY-MM-DD'),
        etd: v.etd ? v.etd.format('YYYY-MM-DD') : null,
        eta: v.eta ? v.eta.format('YYYY-MM-DD') : null,
        invoiceNumber: v.invoiceNumber || null,
        containerNumber: v.containerNumber || null,
        notes: v.notes || null,
        items: [],
      });
    });
  }

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (!search) return list;
    return list.filter((o) =>
      matchesSearch(
        [o.number, o.invoiceNumber ?? '', o.containerNumber ?? '', o.supplier.companyName].join(' '),
        search,
      ),
    );
  }, [data, search]);

  const columns = [
    {
      title: 'Номер',
      dataIndex: 'number',
      render: (v: string, r: ImportOrderListItem) => (
        <Link to={`/foreign-trade/import-orders/${r.id}`} style={{ fontWeight: 500 }}>{v}</Link>
      ),
    },
    {
      title: 'Поставщик',
      dataIndex: ['supplier', 'companyName'],
      render: (_: unknown, r: ImportOrderListItem) => (
        <Link to={`/foreign-trade/suppliers/${r.supplier.id}`}>{r.supplier.companyName}</Link>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 150,
      render: (v: ImportOrderStatus) => (
        <Tag color={IMPORT_ORDER_STATUS_COLORS[v]}>{IMPORT_ORDER_STATUS_LABELS[v]}</Tag>
      ),
    },
    {
      title: 'Дата заказа',
      dataIndex: 'orderDate',
      width: 110,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
    },
    {
      title: 'ETD',
      dataIndex: 'etd',
      width: 110,
      render: (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '—'),
    },
    {
      title: 'ETA',
      dataIndex: 'eta',
      width: 110,
      render: (v: string | null) => (v ? dayjs(v).format('DD.MM.YYYY') : '—'),
    },
    {
      title: 'Контейнер',
      dataIndex: 'containerNumber',
      width: 140,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'Позиций',
      dataIndex: 'itemsCount',
      width: 90,
      align: 'center' as const,
    },
    {
      title: 'Сумма',
      key: 'total',
      align: 'right' as const,
      render: (_: unknown, r: ImportOrderListItem) =>
        `${Number(r.totalAmount).toLocaleString('ru-RU')} ${r.currency}`,
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, r: ImportOrderListItem) => (
        <Link to={`/foreign-trade/import-orders/${r.id}`}>
          <Button type="text" size="small" icon={<EyeOutlined />} />
        </Link>
      ),
    },
  ];

  return (
    <div>
      <CbuRatesWidget />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Импортные заказы (ВЭД)</Typography.Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Поиск: номер / инвойс / контейнер / поставщик"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 340 }}
          />
          <Select
            allowClear
            placeholder="Все статусы"
            style={{ width: 200 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={ALL_STATUSES.map((s) => ({ value: s, label: IMPORT_ORDER_STATUS_LABELS[s] }))}
          />
          <Select
            allowClear
            showSearch
            placeholder="Все поставщики"
            style={{ width: 220 }}
            value={supplierFilter}
            onChange={setSupplierFilter}
            filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.companyName }))}
          />
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Новый заказ
            </Button>
          )}
        </Space>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      </Card>

      <Modal
        title="Новый импорт-заказ"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="Создать"
        confirmLoading={createMut.isPending}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="number" label="Номер заказа" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="Например, IMP-2026-001" />
            </Form.Item>
            <Form.Item name="currency" label="Валюта" style={{ width: 140, marginLeft: 8 }} initialValue="USD">
              <Select options={SUPPLIER_CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="supplierId" label="Поставщик" rules={[{ required: true }]}>
            <Select
              showSearch
              filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={(suppliers ?? []).map((s) => ({ value: s.id, label: `${s.companyName}${s.country ? ` (${s.country})` : ''}` }))}
              placeholder="Выберите поставщика"
            />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="orderDate" label="Дата заказа" rules={[{ required: true }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="etd" label="ETD" style={{ flex: 1, marginLeft: 8 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="eta" label="ETA" style={{ flex: 1, marginLeft: 8 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="invoiceNumber" label="Номер инвойса" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="containerNumber" label="Номер контейнера" style={{ flex: 1, marginLeft: 8 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={3} />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12 }}>
            Позиции, документы и смена статуса — на странице заказа после создания.
          </div>
        </Form>
      </Modal>
    </div>
  );
}
