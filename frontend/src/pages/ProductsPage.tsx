import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Typography, message, Tag, Space, DatePicker, theme, Segmented, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/warehouse.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { Product } from '../types';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';

export default function ProductsPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [countryFilter, setCountryFilter] = useState<string | undefined>();
  const [stockFilter, setStockFilter] = useState<string>('all');
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canManageProducts = isSuperAdmin || (user?.permissions ?? []).includes('manage_products');

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const filtered = (products ?? []).filter((p) => {
    if (categoryFilter && p.category !== categoryFilter) return false;
    if (countryFilter && p.countryOfOrigin !== countryFilter) return false;
    if (stockFilter === 'zero' && p.stock !== 0) return false;
    if (stockFilter === 'low' && !(p.stock > 0 && p.stock < p.minStock)) return false;
    return true;
  });

  const categories = [...new Set((products ?? []).map((p) => p.category).filter(Boolean))] as string[];
  const countries = [...new Set((products ?? []).map((p) => p.countryOfOrigin).filter(Boolean))] as string[];

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => inventoryApi.createProduct(data as Parameters<typeof inventoryApi.createProduct>[0]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар создан');
      setOpen(false);
      form.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      inventoryApi.updateProduct(id, data as Parameters<typeof inventoryApi.updateProduct>[1]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар обновлён');
      setEditProduct(null);
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
      const msg = resp?.details?.join(', ') || resp?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      message.success('Товар удалён');
    },
    onError: (err: unknown) => {
      const resp = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
      const msg = resp?.details?.join(', ') || resp?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const columns = [
    { title: 'Название', dataIndex: 'name', render: (v: string, r: Product) => <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/inventory/products/${r.id}`)}>{v}</Button> },
    { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Формат', dataIndex: 'format', render: (v: string | null) => v || '—' },
    { title: 'Категория', dataIndex: 'category', render: (v: string | null) => v || '—' },
    { title: 'Страна', dataIndex: 'countryOfOrigin', render: (v: string | null) => v || '—' },
    { title: 'Ед. изм.', dataIndex: 'unit', width: 80 },
    {
      title: 'Остаток',
      dataIndex: 'stock',
      align: 'right' as const,
      width: 90,
      render: (v: number, r: Product) => (
        <span style={{ fontWeight: 600, color: v === 0 ? token.colorTextDisabled : v < (r.minStock || 10) ? token.colorError : token.colorSuccess }}>
          {v}
        </span>
      ),
    },
    { title: 'Мин. остаток', dataIndex: 'minStock', align: 'right' as const, width: 100 },
    ...(isSuperAdmin ? [{
      title: 'Цена закупки',
      dataIndex: 'purchasePrice',
      align: 'right' as const,
      width: 130,
      render: (v: string | null) => v ? formatUZS(v) : '—',
    }] : []),
    {
      title: 'Цена продажи',
      dataIndex: 'salePrice',
      align: 'right' as const,
      width: 130,
      render: (v: string | null) => v ? formatUZS(v) : '—',
    },
    {
      title: 'Цена рассрочки',
      dataIndex: 'installmentPrice',
      align: 'right' as const,
      width: 130,
      render: (v: string | null) => v ? formatUZS(v) : '—',
    },
    {
      title: 'Статус',
      dataIndex: 'isActive',
      width: 100,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Активен' : 'Неактивен'}</Tag>,
    },
    ...(canManageProducts ? [{
      title: '',
      width: 110,
      render: (_: unknown, r: Product) => (
        <Space size={0}>
          <Button
            type="text"
            icon={<BarChartOutlined />}
            size="small"
            onClick={() => navigate(`/inventory/products/${r.id}`)}
          />
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => {
              setEditProduct(r);
              editForm.setFieldsValue({
                name: r.name,
                sku: r.sku,
                unit: r.unit,
                format: r.format,
                category: r.category,
                countryOfOrigin: r.countryOfOrigin,
                minStock: r.minStock,
                purchasePrice: r.purchasePrice ? Number(r.purchasePrice) : undefined,
                salePrice: r.salePrice ? Number(r.salePrice) : undefined,
                installmentPrice: r.installmentPrice ? Number(r.installmentPrice) : undefined,
                manufacturedAt: r.manufacturedAt ? dayjs(r.manufacturedAt) : null,
                expiresAt: r.expiresAt ? dayjs(r.expiresAt) : null,
                isActive: r.isActive,
              });
            }}
          />
          <Popconfirm
            title="Удалить товар?"
            description={`«${r.name}» будет удалён`}
            onConfirm={() => deleteMut.mutate(r.id)}
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>Товары</Typography.Title>
          <Select
            allowClear
            placeholder="Категория"
            style={{ width: 160 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categories.map((c) => ({ label: c, value: c }))}
          />
          <Select
            allowClear
            placeholder="Страна"
            style={{ width: 160 }}
            value={countryFilter}
            onChange={setCountryFilter}
            options={countries.map((c) => ({ label: c, value: c }))}
          />
          <Segmented
            value={stockFilter}
            onChange={(v) => setStockFilter(v as string)}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Мало на складе', value: 'low' },
              { label: 'Нет на складе', value: 'zero' },
            ]}
          />
        </Space>
        {canManageProducts && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Добавить</Button>
        )}
      </div>

      <Table
        dataSource={filtered}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        size="middle"
        bordered={false}
      />

      {/* Create Modal */}
      <Modal
        title="Новый товар"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={(v) => {
          const data = {
            ...v,
            manufacturedAt: v.manufacturedAt ? v.manufacturedAt.toISOString() : undefined,
            expiresAt: v.expiresAt ? v.expiresAt.toISOString() : undefined,
          };
          createMut.mutate(data);
        }}>
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sku" label="Артикул (SKU)" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="unit" label="Единица измерения" initialValue="шт" style={{ flex: 1 }}>
              <Select options={[
                { label: 'шт', value: 'шт' },
                { label: 'кг', value: 'кг' },
                { label: 'литр', value: 'литр' },
                { label: 'лист', value: 'лист' },
                { label: 'пачка', value: 'пачка' },
                { label: 'рулон', value: 'рулон' },
                { label: 'м²', value: 'м²' },
                { label: 'мп', value: 'мп' },
              ]} />
            </Form.Item>
            <Form.Item name="format" label="Формат" style={{ flex: 1 }}>
              <Input placeholder="A4, 72×104, 640мм..." />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="category" label="Категория" style={{ flex: 1 }}>
              <Input placeholder="Бумага, Тонер..." />
            </Form.Item>
            <Form.Item name="countryOfOrigin" label="Страна производства" style={{ flex: 1 }}>
              <Input placeholder="Узбекистан, Китай..." />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="minStock" label="Мин. остаток" initialValue={0} style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="salePrice" label="Цена продажи" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          </Space>
          {isSuperAdmin && (
            <Form.Item name="purchasePrice" label="Цена закупки">
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          )}
          <Form.Item name="installmentPrice" label="Цена рассрочки">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="manufacturedAt" label="Дата производства" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="expiresAt" label="Годен до" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="Редактирование товара"
        open={!!editProduct}
        onCancel={() => setEditProduct(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={560}
      >
        <Form form={editForm} layout="vertical" onFinish={(v) => {
          if (!editProduct) return;
          const data = {
            ...v,
            manufacturedAt: v.manufacturedAt ? v.manufacturedAt.toISOString() : null,
            expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
          };
          updateMut.mutate({ id: editProduct.id, data });
        }}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sku" label="Артикул (SKU)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="unit" label="Единица измерения" style={{ flex: 1 }}>
              <Select options={[
                { label: 'шт', value: 'шт' },
                { label: 'кг', value: 'кг' },
                { label: 'литр', value: 'литр' },
                { label: 'лист', value: 'лист' },
                { label: 'пачка', value: 'пачка' },
                { label: 'рулон', value: 'рулон' },
                { label: 'м²', value: 'м²' },
                { label: 'мп', value: 'мп' },
              ]} />
            </Form.Item>
            <Form.Item name="format" label="Формат" style={{ flex: 1 }}>
              <Input placeholder="A4, 72×104, 640мм..." />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="category" label="Категория" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="countryOfOrigin" label="Страна производства" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="minStock" label="Мин. остаток" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="salePrice" label="Цена продажи" style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          </Space>
          {isSuperAdmin && (
            <Form.Item name="purchasePrice" label="Цена закупки">
              <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
            </Form.Item>
          )}
          <Form.Item name="installmentPrice" label="Цена рассрочки">
            <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="manufacturedAt" label="Дата производства" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="expiresAt" label="Годен до" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Space>
          <Form.Item name="isActive" label="Статус">
            <Select options={[{ label: 'Активен', value: true }, { label: 'Неактивен', value: false }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
