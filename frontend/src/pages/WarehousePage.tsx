import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, InputNumber, Select, Typography, message, Tag, Space } from 'antd';
import { PlusOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { inventoryApi } from '../api/warehouse.api';
import { useAuthStore } from '../store/authStore';
import type { Product } from '../types';
import dayjs from 'dayjs';

export default function WarehousePage() {
  const [inModal, setInModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [movementsProduct, setMovementsProduct] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

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

  const activeProducts = (products ?? []).filter((p) => p.isActive);

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
      sorter: (a: Product, b: Product) => a.stock - b.stock,
      render: (v: number, r: Product) => {
        const isLow = v < r.minStock;
        return (
          <span style={{ fontWeight: 600, color: v === 0 ? '#999' : isLow ? '#f5222d' : '#52c41a' }}>
            {v}
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
        if (r.stock === 0) return <Tag color="default">Нет на складе</Tag>;
        if (r.stock < r.minStock) return <Tag color="red">Нужен приход</Tag>;
        return <Tag color="green">В норме</Tag>;
      },
    },
    {
      title: '',
      width: 160,
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

      <Table
        dataSource={activeProducts}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 30 }}
        size="middle"
        rowClassName={(r) => r.stock < r.minStock ? 'low-stock-row' : ''}
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
    </div>
  );
}
