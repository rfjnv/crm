import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, InputNumber, Select, Input, Typography, message, Tag, Space, theme } from 'antd';
import { PlusOutlined, ArrowUpOutlined, ArrowDownOutlined, EditOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import { useAuthStore } from '../store/authStore';
import type { Product } from '../types';
import dayjs from 'dayjs';

type StockFilter = 'all' | 'zero' | 'low' | 'normal';
type ActiveFilter = 'all' | 'active' | 'inactive';

export default function WarehousePage() {
  const [inModal, setInModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [movementsProduct, setMovementsProduct] = useState<Product | null>(null);
  const [correctProduct, setCorrectProduct] = useState<Product | null>(null);
  const [searchText, setSearchText] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [unitFilter, setUnitFilter] = useState<string | undefined>(undefined);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [form] = Form.useForm();
  const [correctForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canCorrectStock = user?.role === 'SUPER_ADMIN' || user?.role === 'WAREHOUSE_MANAGER';
  const { token: tk } = theme.useToken();

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const { data: movements } = useQuery({
    queryKey: ['product-movements', movementsProduct?.id],
    queryFn: () => inventoryApi.getProductMovements(movementsProduct!.id),
    enabled: !!movementsProduct,
  });

  const incomeMut = useMutation({
    mutationFn: (data: { productId: string; type: 'IN'; quantity: number; note?: string }) =>
      inventoryApi.createMovement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-movements'] });
      message.success('Приход оформлен');
      setInModal(false);
      setSelectedProduct(null);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const correctMut = useMutation({
    mutationFn: (data: { id: string; newStock: number; reason: string }) =>
      inventoryApi.correctStock(data.id, { newStock: data.newStock, reason: data.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Остаток скорректирован');
      setCorrectProduct(null);
      correctForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const uniqueUnits = useMemo(() => {
    const allProducts = products ?? [];
    const units = [...new Set(allProducts.map((p) => p.unit).filter(Boolean))];
    return units.sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products ?? [];

    // Active/inactive filter
    if (activeFilter === 'active') {
      list = list.filter((p) => p.isActive);
    } else if (activeFilter === 'inactive') {
      list = list.filter((p) => !p.isActive);
    }

    // Search by name or SKU
    if (searchText.trim()) {
      const lower = searchText.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          (p.sku && p.sku.toLowerCase().includes(lower))
      );
    }

    // Stock filter (Number() for Decimal values from Prisma)
    if (stockFilter === 'zero') {
      list = list.filter((p) => Number(p.stock) === 0);
    } else if (stockFilter === 'low') {
      list = list.filter((p) => Number(p.stock) > 0 && Number(p.stock) < Number(p.minStock));
    } else if (stockFilter === 'normal') {
      list = list.filter((p) => Number(p.stock) >= Number(p.minStock));
    }

    // Unit filter
    if (unitFilter) {
      list = list.filter((p) => p.unit === unitFilter);
    }

    return list;
  }, [products, searchText, stockFilter, unitFilter, activeFilter]);

  const columns = [
    { title: 'Название', dataIndex: 'name', sorter: (a: Product, b: Product) => a.name.localeCompare(b.name) },
    { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Категория', dataIndex: 'category', render: (v: string | null) => v || '—' },
    { title: 'Ед.', dataIndex: 'unit', width: 60 },
    {
      title: 'Остаток',
      dataIndex: 'stock',
      align: 'right' as const,
      width: 100,
      sorter: (a: Product, b: Product) => Number(a.stock) - Number(b.stock),
      render: (v: number, r: Product) => {
        const stock = Number(v);
        const min = Number(r.minStock);
        let color = '#52c41a'; // green — normal
        if (stock === 0) {
          color = '#ff4d4f'; // red — zero stock
        } else if (stock < min) {
          color = '#faad14'; // orange — low stock warning
        }
        return (
          <span style={{ fontWeight: 600, color }}>
            {stock}
          </span>
        );
      },
    },
    {
      title: 'Мин.',
      dataIndex: 'minStock',
      align: 'right' as const,
      width: 60,
    },
    {
      title: 'Статус',
      key: 'stockStatus',
      width: 120,
      render: (_: unknown, r: Product) => {
        const stock = Number(r.stock);
        const min = Number(r.minStock);
        if (stock === 0) return <Tag color="red">Нет на складе</Tag>;
        if (stock < min) return <Tag color="orange">Мало</Tag>;
        return <Tag color="green">В норме</Tag>;
      },
    },
    {
      title: '',
      width: canCorrectStock ? 260 : 160,
      render: (_: unknown, r: Product) => (
        <Space>
          {['ADMIN', 'SUPER_ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER'].includes(user?.role ?? '') && (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => { setSelectedProduct(r); form.setFieldsValue({ productId: r.id }); setInModal(true); }}
            >
              Приход
            </Button>
          )}
          {canCorrectStock && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => { setCorrectProduct(r); correctForm.setFieldsValue({ newStock: Number(r.stock) }); }}
            >
              Коррекция
            </Button>
          )}
          <Button size="small" onClick={() => setMovementsProduct(r)}>История</Button>
        </Space>
      ),
    },
  ];

  const movementColumns = [
    {
      title: 'Тип',
      dataIndex: 'type',
      width: 80,
      render: (v: string) =>
        v === 'IN' ? (
          <Tag color="green" icon={<ArrowUpOutlined />}>Приход</Tag>
        ) : (
          <Tag color="red" icon={<ArrowDownOutlined />}>Расход</Tag>
        ),
    },
    { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 80 },
    { title: 'Сделка', dataIndex: ['deal', 'title'], render: (v: string | undefined) => v || '—' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
    { title: 'Дата', dataIndex: 'createdAt', width: 140, render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Склад</Typography.Title>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Поиск по названию или артикулу"
          allowClear
          style={{ width: 280 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <Select
          value={stockFilter}
          onChange={setStockFilter}
          style={{ width: 180 }}
          options={[
            { label: 'Все остатки', value: 'all' },
            { label: 'Нет на складе (0)', value: 'zero' },
            { label: 'Мало на складе', value: 'low' },
            { label: 'В норме', value: 'normal' },
          ]}
        />
        <Select
          value={unitFilter}
          onChange={setUnitFilter}
          allowClear
          placeholder="Ед. измерения"
          style={{ width: 160 }}
          options={uniqueUnits.map((u) => ({ label: u, value: u }))}
        />
        <Select
          value={activeFilter}
          onChange={setActiveFilter}
          style={{ width: 160 }}
          options={[
            { label: 'Все товары', value: 'all' },
            { label: 'Активные', value: 'active' },
            { label: 'Неактивные', value: 'inactive' },
          ]}
        />
      </div>

      <Table
        dataSource={filteredProducts}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{
          defaultPageSize: 30,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '30', '50', '100'],
          showTotal: (total) => `Всего: ${total}`,
        }}
        size="middle"
        rowClassName={(r) => Number(r.stock) < Number(r.minStock) ? 'low-stock-row' : ''}
      />

      {/* Income Modal */}
      <Modal
        title={`Приход: ${selectedProduct?.name ?? ''}`}
        open={inModal}
        onCancel={() => { setInModal(false); setSelectedProduct(null); }}
        onOk={() => form.submit()}
        confirmLoading={incomeMut.isPending}
        okText="Оформить"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical" onFinish={(v) => incomeMut.mutate({ ...v, type: 'IN' as const })}>
          <Form.Item name="productId" hidden>
            <input />
          </Form.Item>
          <Form.Item name="quantity" label="Количество" rules={[{ required: true, message: 'Обязательно' }]}>
            <InputNumber style={{ width: '100%' }} min={1} />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Select
              allowClear
              mode="tags"
              placeholder="Приход от поставщика, Возврат..."
              options={[
                { label: 'Приход от поставщика', value: 'Приход от поставщика' },
                { label: 'Возврат', value: 'Возврат' },
                { label: 'Инвентаризация', value: 'Инвентаризация' },
              ]}
              onChange={(v) => form.setFieldsValue({ note: v?.[v.length - 1] })}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Movements History Modal */}
      <Modal
        title={`История: ${movementsProduct?.name ?? ''}`}
        open={!!movementsProduct}
        onCancel={() => setMovementsProduct(null)}
        footer={null}
        width={700}
      >
        <Table
          dataSource={movements ?? []}
          columns={movementColumns}
          rowKey="id"
          pagination={{ pageSize: 15 }}
          size="small"
        />
      </Modal>

      {/* Stock Correction Modal */}
      <Modal
        title={`Коррекция остатка: ${correctProduct?.name ?? ''}`}
        open={!!correctProduct}
        onCancel={() => { setCorrectProduct(null); correctForm.resetFields(); }}
        onOk={() => correctForm.submit()}
        confirmLoading={correctMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        {correctProduct && (
          <div style={{ marginBottom: 16, color: tk.colorTextSecondary }}>
            Текущий остаток: <strong>{Number(correctProduct.stock)}</strong> {correctProduct.unit}
          </div>
        )}
        <Form form={correctForm} layout="vertical" onFinish={(v) => {
          if (!correctProduct) return;
          correctMut.mutate({ id: correctProduct.id, newStock: v.newStock, reason: v.reason });
        }}>
          <Form.Item name="newStock" label="Новый остаток" rules={[{ required: true, message: 'Обязательно' }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={3} />
          </Form.Item>
          <Form.Item name="reason" label="Причина коррекции" rules={[{ required: true, message: 'Укажите причину' }]}>
            <Input.TextArea rows={2} placeholder="Инвентаризация, ошибка учёта, брак..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
