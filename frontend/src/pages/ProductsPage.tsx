import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Typography, message, Tag, Space, DatePicker, theme, Segmented, Popconfirm, Card, Pagination } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined, ApartmentOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '../api/warehouse.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { Product } from '../types';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { useIsMobile } from '../hooks/useIsMobile';
import ProductAuditHistoryPanel from '../components/ProductAuditHistoryPanel';
import ProductHierarchyPanel from '../components/ProductHierarchyPanel';

export default function ProductsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [countryFilter, setCountryFilter] = useState<string | undefined>();
  const [stockFilter, setStockFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('active');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [mobilePage, setMobilePage] = useState(1);
  const mobilePageSize = 20;
  const [listMode, setListMode] = useState<'table' | 'hierarchy'>('table');
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canManageProducts = isSuperAdmin || (user?.permissions ?? []).includes('manage_products');

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setMobilePage(1);
  }, [debouncedSearch, categoryFilter, countryFilter, stockFilter, activeFilter]);

  const filtered = useMemo(() => {
    return (products ?? []).filter((p) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const inName = p.name.toLowerCase().includes(q);
        const skuStr = (p.sku ?? '').trim();
        const inSku = skuStr.length > 0 && skuStr.toLowerCase().includes(q);
        if (!inName && !inSku) return false;
      }
      if (activeFilter === 'active' && !p.isActive) return false;
      if (activeFilter === 'inactive' && p.isActive) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (countryFilter && p.countryOfOrigin !== countryFilter) return false;
      if (stockFilter === 'zero' && Number(p.stock) !== 0) return false;
      if (stockFilter === 'low' && !(Number(p.stock) > 0 && Number(p.stock) < Number(p.minStock))) return false;
      return true;
    });
  }, [products, debouncedSearch, activeFilter, categoryFilter, countryFilter, stockFilter]);

  const filteredMobileSlice = useMemo(() => {
    const start = (mobilePage - 1) * mobilePageSize;
    return filtered.slice(start, start + mobilePageSize);
  }, [filtered, mobilePage, mobilePageSize]);

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
      render: (v: number, r: Product) => {
        const stock = Number(v);
        const min = Number(r.minStock || 10);
        return (
          <span style={{ fontWeight: 600, color: stock === 0 ? token.colorTextDisabled : stock < min ? token.colorError : token.colorSuccess }}>
            {stock}
          </span>
        );
      },
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
      <div style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="Поиск по названию или артикулу (SKU)..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: '100%', maxWidth: isMobile ? '100%' : 420 }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          justifyContent: 'space-between',
          gap: isMobile ? 12 : 16,
          marginBottom: 16,
        }}
      >
        <Space direction={isMobile ? 'vertical' : 'horizontal'} size={isMobile ? 8 : 12} style={{ width: isMobile ? '100%' : 'auto' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>Товары</Typography.Title>
          <Segmented
            value={listMode}
            onChange={(v) => setListMode(v as 'table' | 'hierarchy')}
            options={[
              { label: isMobile ? 'Список' : <><UnorderedListOutlined /> Список</>, value: 'table' },
              { label: isMobile ? 'Дерево' : <><ApartmentOutlined /> Иерархия</>, value: 'hierarchy' },
            ]}
          />
          <Select
            allowClear
            placeholder="Категория"
            style={{ width: isMobile ? '100%' : 160 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categories.map((c) => ({ label: c, value: c }))}
          />
          <Select
            allowClear
            placeholder="Страна"
            style={{ width: isMobile ? '100%' : 160 }}
            value={countryFilter}
            onChange={setCountryFilter}
            options={countries.map((c) => ({ label: c, value: c }))}
          />
          <Segmented
            value={stockFilter}
            onChange={(v) => setStockFilter(v as string)}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Мало', value: 'low' },
              { label: 'Нет', value: 'zero' },
            ]}
            block={isMobile}
          />
          <Select
            value={activeFilter}
            onChange={setActiveFilter}
            style={{ width: isMobile ? '100%' : 150 }}
            options={[
              { label: 'Активные', value: 'active' },
              { label: 'Неактивные', value: 'inactive' },
              { label: 'Все товары', value: 'all' },
            ]}
          />
        </Space>
        <Space wrap style={{ width: isMobile ? '100%' : 'auto' }}>
          {isSuperAdmin && (
            <Button onClick={() => setAuditOpen(true)} block={isMobile}>
              История аудита
            </Button>
          )}
          {canManageProducts && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)} block={isMobile}>
              Добавить
            </Button>
          )}
        </Space>
      </div>

      {listMode === 'hierarchy' ? (
        <ProductHierarchyPanel
          products={filtered}
          loading={isLoading}
          canManage={canManageProducts}
          searchHint={
            debouncedSearch || categoryFilter || countryFilter || stockFilter !== 'all' || activeFilter !== 'active'
              ? 'Показаны товары по текущим фильтрам и поиску.'
              : undefined
          }
          onEditProduct={(p) => {
            setEditProduct(p);
            editForm.setFieldsValue({
              name: p.name,
              sku: p.sku,
              unit: p.unit,
              format: p.format,
              category: p.category,
              countryOfOrigin: p.countryOfOrigin,
              minStock: p.minStock,
              purchasePrice: p.purchasePrice ? Number(p.purchasePrice) : undefined,
              salePrice: p.salePrice ? Number(p.salePrice) : undefined,
              installmentPrice: p.installmentPrice ? Number(p.installmentPrice) : undefined,
              manufacturedAt: p.manufacturedAt ? dayjs(p.manufacturedAt) : null,
              expiresAt: p.expiresAt ? dayjs(p.expiresAt) : null,
              isActive: p.isActive,
            });
          }}
          onAddProductInCategory={(category) => {
            setOpen(true);
            form.resetFields();
            form.setFieldsValue({ category, unit: 'шт', minStock: 0 });
          }}
        />
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredMobileSlice.map((p) => {
            const stock = Number(p.stock);
            const min = Number(p.minStock || 10);
            const stockColor =
              stock === 0 ? token.colorTextDisabled : stock < min ? token.colorError : token.colorSuccess;
            return (
              <Card
                key={p.id}
                size="small"
                hoverable
                styles={{ body: { padding: 12 } }}
                onClick={() => navigate(`/inventory/products/${p.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong ellipsis style={{ display: 'block' }}>
                      {p.name}
                    </Typography.Text>
                    <Tag style={{ marginTop: 4 }}>{p.sku}</Tag>
                    {p.category && (
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        {p.category}
                      </Typography.Text>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <Typography.Text strong style={{ fontSize: 16, color: stockColor }}>
                      {stock}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      мин {min}
                    </Typography.Text>
                    {p.salePrice != null && (
                      <Typography.Text style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                        {formatUZS(Number(p.salePrice))}
                      </Typography.Text>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
          {filtered.length === 0 && !isLoading && (
            <Typography.Text type="secondary">Нет товаров по фильтрам</Typography.Text>
          )}
          {filtered.length > mobilePageSize && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
              <Pagination
                size="small"
                current={mobilePage}
                pageSize={mobilePageSize}
                total={filtered.length}
                onChange={setMobilePage}
                showSizeChanger={false}
              />
            </div>
          )}
        </div>
      ) : (
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="middle"
          bordered={false}
          scroll={{ x: 600 }}
        />
      )}

      {/* Create Modal */}
      <Modal
        title="Новый товар"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
        width={isMobile ? '100%' : 560}
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
                { label: 'п/м', value: 'п/м' },
                { label: 'бабина', value: 'бабина' },
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
        width={isMobile ? '100%' : 560}
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
                { label: 'п/м', value: 'п/м' },
                { label: 'бабина', value: 'бабина' },
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

      {/* Audit History Modal */}
      <Modal
        title="История аудита товаров"
        open={auditOpen}
        onCancel={() => setAuditOpen(false)}
        footer={null}
        width={isMobile ? '100%' : 700}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <ProductAuditHistoryPanel />
      </Modal>
    </div>
  );
}
