import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, InputNumber, Select, Input, DatePicker, Typography, message, Tag, Space, Tooltip, theme, Card, Popconfirm, Checkbox, Dropdown } from 'antd';
import { PlusOutlined, ArrowUpOutlined, ArrowDownOutlined, EditOutlined, LockOutlined, MoreOutlined, HistoryOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { inventoryApi } from '../api/warehouse.api';
import { clientsApi } from '../api/clients.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import type { Product, ProductReservation } from '../types';
import { matchesSearch } from '../utils/translit';
import dayjs from 'dayjs';

type StockFilter = 'all' | 'zero' | 'low' | 'normal';
type ActiveFilter = 'all' | 'active' | 'inactive';

/** Товары с параллельным остатком в рулонах (ламинация) показываем как «N рул. (кг)». */
function formatStockCell(stock: number | string | null | undefined, rollStock?: number | string | null): string {
  const kgNum = Number(stock) || 0;
  const kg = Number.isInteger(kgNum) ? kgNum : parseFloat(kgNum.toFixed(3));
  if (rollStock == null) return String(kg);
  const rollNum = Number(rollStock) || 0;
  const rolls = Number.isInteger(rollNum) ? rollNum : parseFloat(rollNum.toFixed(3));
  return `${rolls} рул. (${kg} кг)`;
}

export default function WarehousePage() {
  const [inModal, setInModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [movementsProduct, setMovementsProduct] = useState<Product | null>(null);
  const [correctProduct, setCorrectProduct] = useState<Product | null>(null);
  const [reserveProduct, setReserveProduct] = useState<Product | null>(null);
  const [reservationsProduct, setReservationsProduct] = useState<Product | null>(null);
  const [searchText, setSearchText] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [unitFilter, setUnitFilter] = useState<string | undefined>(undefined);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active');
  const [form] = Form.useForm();
  const [correctForm] = Form.useForm();
  const [reserveForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canCorrectStock = user?.role === 'SUPER_ADMIN' || user?.role === 'WAREHOUSE_MANAGER';
  const canReserve = !!user?.permissions?.includes('manage_inventory');
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
    enabled: canReserve,
  });

  const { data: movements } = useQuery({
    queryKey: ['product-movements', movementsProduct?.id],
    queryFn: () => inventoryApi.getProductMovements(movementsProduct!.id),
    enabled: !!movementsProduct,
  });

  const { data: reservations } = useQuery({
    queryKey: ['product-reservations', reservationsProduct?.id],
    queryFn: () => inventoryApi.getProductReservations(reservationsProduct!.id),
    enabled: !!reservationsProduct,
  });

  const incomeMut = useMutation({
    mutationFn: (data: { productId: string; type: 'IN'; quantity: number; note?: string; affectStock?: boolean }) =>
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

  const reserveMut = useMutation({
    mutationFn: (data: { productId: string; clientId: string; quantity: number; expiresAt: string; note?: string }) =>
      inventoryApi.createReservation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-reservations'] });
      message.success('Товар забронирован');
      setReserveProduct(null);
      reserveForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const cancelReserveMut = useMutation({
    mutationFn: (id: string) => inventoryApi.cancelReservation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-reservations'] });
      message.success('Бронь отменена');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const fulfillReserveMut = useMutation({
    mutationFn: (id: string) => inventoryApi.fulfillReservation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-reservations'] });
      message.success('Бронь закрыта как использованная');
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

    if (searchText.trim()) {
      const q = searchText.trim();
      list = list.filter(
        (p) =>
          matchesSearch(p.name, q) ||
          matchesSearch(p.sku, q)
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

  const canAddIncome = ['ADMIN', 'SUPER_ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER'].includes(user?.role ?? '');

  /** Второстепенные действия строки — прячем в «...», чтобы колонка не расползалась. */
  const buildRowActions = (r: Product): MenuProps['items'] => {
    const items: MenuProps['items'] = [];
    if (canReserve) {
      items.push({
        key: 'reserve',
        icon: <LockOutlined />,
        label: 'Бронь',
        onClick: () => { setReserveProduct(r); reserveForm.resetFields(); reserveForm.setFieldsValue({ productId: r.id }); },
      });
    }
    if (canCorrectStock) {
      items.push({
        key: 'correct',
        icon: <EditOutlined />,
        label: 'Коррекция',
        onClick: () => { setCorrectProduct(r); correctForm.setFieldsValue({ newStock: Number(r.stock) }); },
      });
    }
    items.push({
      key: 'history',
      icon: <HistoryOutlined />,
      label: 'История',
      onClick: () => setMovementsProduct(r),
    });
    if (Number(r.reservedQty) > 0) {
      items.push({
        key: 'reservations',
        icon: <UnorderedListOutlined />,
        label: 'Брони',
        onClick: () => setReservationsProduct(r),
      });
    }
    return items;
  };

  const columns = [
    { title: 'Название', dataIndex: 'name', sorter: (a: Product, b: Product) => a.name.localeCompare(b.name) },
    { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Категория', dataIndex: 'category', render: (v: string | null) => v || '—' },
    { title: 'Ед.', dataIndex: 'unit', width: 60 },
    {
      title: 'Остаток',
      dataIndex: 'stock',
      align: 'right' as const,
      width: 140,
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
            {formatStockCell(stock, r.rollStock)}
          </span>
        );
      },
    },
    {
      title: 'Забронировано',
      dataIndex: 'reservedQty',
      align: 'right' as const,
      width: 130,
      render: (v: number | undefined, r: Product) => {
        const reserved = Number(v) || 0;
        if (reserved <= 0) return <span style={{ color: tk.colorTextTertiary }}>—</span>;
        return (
          <Tooltip title={`Доступно к продаже: ${Number(r.availableStock ?? 0)} ${r.unit}`}>
            <Tag color="gold" icon={<LockOutlined />}>{reserved} {r.unit}</Tag>
          </Tooltip>
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
      width: 130,
      align: 'right' as const,
      render: (_: unknown, r: Product) => (
        <Space size={4}>
          {canAddIncome && (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => { setSelectedProduct(r); form.setFieldsValue({ productId: r.id }); setInModal(true); }}
            >
              Приход
            </Button>
          )}
          <Dropdown menu={{ items: buildRowActions(r) }} trigger={['click']} placement="bottomRight">
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
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
        ) : v === 'CORRECTION' ? (
          <Tag color="orange" icon={<EditOutlined />}>Коррекция</Tag>
        ) : (
          <Tag color="red" icon={<ArrowDownOutlined />}>Расход</Tag>
        ),
    },
    { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 80 },
    { title: 'Сделка', dataIndex: ['deal', 'title'], render: (v: string | undefined) => v || '—' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
    {
      title: 'Дата',
      dataIndex: 'eventDate',
      width: 140,
      render: (_v: string, r: { eventDate?: string; createdAt: string }) => {
        const event = r.eventDate ?? r.createdAt;
        const sameDay = dayjs(event).isSame(r.createdAt, 'day');
        return (
          <Tooltip
            title={
              sameDay
                ? `Запись создана: ${dayjs(r.createdAt).format('DD.MM.YYYY HH:mm')}`
                : `Бизнес-дата: ${dayjs(event).format('DD.MM.YYYY')} • запись создана: ${dayjs(r.createdAt).format('DD.MM.YYYY HH:mm')}`
            }
          >
            <span>{dayjs(event).format('DD.MM.YYYY')}</span>
          </Tooltip>
        );
      },
    },
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
          style={{ width: isMobile ? '100%' : 280 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <Select
          value={stockFilter}
          onChange={setStockFilter}
          style={{ width: isMobile ? '100%' : 180 }}
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
          style={{ width: isMobile ? '100%' : 160 }}
          options={uniqueUnits.map((u) => ({ label: u, value: u }))}
        />
        <Select
          value={activeFilter}
          onChange={setActiveFilter}
          style={{ width: isMobile ? '100%' : 160 }}
          options={[
            { label: 'Все товары', value: 'all' },
            { label: 'Активные', value: 'active' },
            { label: 'Неактивные', value: 'inactive' },
          ]}
        />
      </div>

      {isMobile ? (
        <MobileCardList<Product>
          data={filteredProducts}
          loading={isLoading}
          rowKey="id"
          emptyText="Нет товаров"
          renderCard={(record) => {
            const stock = Number(record.stock);
            const min = Number(record.minStock);
            let stockColor = '#52c41a';
            if (stock === 0) stockColor = '#ff4d4f';
            else if (stock < min) stockColor = '#faad14';
            return (
              <Card size="small">
                <div style={{ marginBottom: 6 }}>
                  <Typography.Text strong style={{ fontSize: 15 }}>{record.name}</Typography.Text>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <Tag>{record.sku}</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Typography.Text type="secondary">Остаток</Typography.Text>
                  <span style={{ fontWeight: 600, color: stockColor }}>{formatStockCell(stock, record.rollStock)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Typography.Text type="secondary">Ед.</Typography.Text>
                  <Typography.Text>{record.unit}</Typography.Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Typography.Text type="secondary">Статус</Typography.Text>
                  {stock === 0 ? <Tag color="red">Нет на складе</Tag> : stock < min ? <Tag color="orange">Мало</Tag> : <Tag color="green">В норме</Tag>}
                </div>
                {Number(record.reservedQty) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Typography.Text type="secondary">Забронировано</Typography.Text>
                    <Tag color="gold" icon={<LockOutlined />}>{Number(record.reservedQty)} {record.unit}</Tag>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['ADMIN', 'SUPER_ADMIN', 'WAREHOUSE', 'WAREHOUSE_MANAGER'].includes(user?.role ?? '') && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => { setSelectedProduct(record); form.setFieldsValue({ productId: record.id }); setInModal(true); }}
                    >
                      Приход
                    </Button>
                  )}
                  {canReserve && (
                    <Button
                      size="small"
                      icon={<LockOutlined />}
                      onClick={() => { setReserveProduct(record); reserveForm.resetFields(); reserveForm.setFieldsValue({ productId: record.id }); }}
                    >
                      Бронь
                    </Button>
                  )}
                  {canCorrectStock && (
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => { setCorrectProduct(record); correctForm.setFieldsValue({ newStock: Number(record.stock) }); }}
                    >
                      Коррекция
                    </Button>
                  )}
                  <Button size="small" onClick={() => setMovementsProduct(record)}>История</Button>
                  {Number(record.reservedQty) > 0 && (
                    <Button size="small" onClick={() => setReservationsProduct(record)}>Брони</Button>
                  )}
                </div>
              </Card>
            );
          }}
        />
      ) : (
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
      )}

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
        <Form
          form={form}
          layout="vertical"
          initialValues={{ skipStock: false }}
          onFinish={({ skipStock, ...v }) => incomeMut.mutate({ ...v, type: 'IN' as const, affectStock: !skipStock })}
        >
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
          <Form.Item name="skipStock" valuePropName="checked" extra="Включите, если этот приход уже учтён в текущем остатке (например, задним числом восстанавливаете запись в историю) — тогда сама цифра остатка не изменится, останется только запись в истории.">
            <Checkbox>
              <span style={{ opacity: 0.85 }}>Не менять остаток (только для истории)</span>
            </Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* Movements History Modal */}
      <Modal
        title={`История: ${movementsProduct?.name ?? ''}`}
        open={!!movementsProduct}
        onCancel={() => setMovementsProduct(null)}
        footer={null}
        width={isMobile ? '100%' : 700}
      >
        <Table
          dataSource={movements ?? []}
          columns={movementColumns}
          rowKey="id"
          pagination={{ pageSize: 15 }}
          size="small"
          scroll={{ x: 600 }}
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
            Текущий остаток: <strong>{formatStockCell(Number(correctProduct.stock), correctProduct.rollStock)}</strong>{correctProduct.rollStock == null ? ` ${correctProduct.unit}` : ''}
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

      {/* Reservation Modal */}
      <Modal
        title={`Бронирование: ${reserveProduct?.name ?? ''}`}
        open={!!reserveProduct}
        onCancel={() => { setReserveProduct(null); reserveForm.resetFields(); }}
        onOk={() => reserveForm.submit()}
        confirmLoading={reserveMut.isPending}
        okText="Забронировать"
        cancelText="Отмена"
      >
        {reserveProduct && (
          <div style={{ marginBottom: 16, color: tk.colorTextSecondary }}>
            Доступно к брони: <strong>{Number(reserveProduct.availableStock ?? reserveProduct.stock)} {reserveProduct.unit}</strong>
            {Number(reserveProduct.reservedQty) > 0 && ` (уже забронировано ${Number(reserveProduct.reservedQty)} ${reserveProduct.unit})`}
          </div>
        )}
        <Form
          form={reserveForm}
          layout="vertical"
          onFinish={(v) => {
            if (!reserveProduct) return;
            reserveMut.mutate({
              productId: reserveProduct.id,
              clientId: v.clientId,
              quantity: v.quantity,
              expiresAt: v.expiresAt.endOf('day').toISOString(),
              note: v.note,
            });
          }}
        >
          <Form.Item name="productId" hidden>
            <input />
          </Form.Item>
          <Form.Item name="clientId" label="Клиент" rules={[{ required: true, message: 'Выберите клиента' }]}>
            <Select
              showSearch
              placeholder="Выберите клиента"
              optionFilterProp="label"
              options={(clients ?? []).map((c) => ({ label: c.companyName, value: c.id }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label="Количество"
            rules={[
              { required: true, message: 'Обязательно' },
              {
                validator: (_, value) => {
                  const max = Number(reserveProduct?.availableStock ?? reserveProduct?.stock ?? 0);
                  if (value == null || value <= max) return Promise.resolve();
                  return Promise.reject(new Error(`Максимум доступно: ${max}`));
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} min={0.001} precision={3} />
          </Form.Item>
          <Form.Item name="expiresAt" label="Забронировано до" rules={[{ required: true, message: 'Укажите срок брони' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea rows={2} placeholder="Причина брони, договорённость с клиентом..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reservations List Modal */}
      <Modal
        title={`Брони: ${reservationsProduct?.name ?? ''}`}
        open={!!reservationsProduct}
        onCancel={() => setReservationsProduct(null)}
        footer={null}
        width={isMobile ? '100%' : 700}
      >
        <Table
          dataSource={reservations ?? []}
          rowKey="id"
          pagination={{ pageSize: 15 }}
          size="small"
          scroll={{ x: 600 }}
          columns={[
            { title: 'Клиент', dataIndex: ['client', 'companyName'], render: (v: string | undefined) => v || '—' },
            { title: 'Кол-во', dataIndex: 'quantity', align: 'right' as const, width: 90 },
            {
              title: 'Статус',
              dataIndex: 'status',
              width: 110,
              render: (v: ProductReservation['status']) => {
                const map: Record<ProductReservation['status'], { color: string; text: string }> = {
                  ACTIVE: { color: 'gold', text: 'Активна' },
                  CANCELLED: { color: 'default', text: 'Отменена' },
                  FULFILLED: { color: 'green', text: 'Использована' },
                  EXPIRED: { color: 'red', text: 'Истекла' },
                };
                return <Tag color={map[v].color}>{map[v].text}</Tag>;
              },
            },
            {
              title: 'До',
              dataIndex: 'expiresAt',
              width: 110,
              render: (v: string) => dayjs(v).format('DD.MM.YYYY'),
            },
            { title: 'Менеджер', dataIndex: ['manager', 'fullName'], render: (v: string | undefined) => v || '—' },
            { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
            {
              title: '',
              width: 140,
              render: (_: unknown, r: ProductReservation) =>
                r.status === 'ACTIVE' && canReserve ? (
                  <Space>
                    <Popconfirm title="Отметить бронь как использованную?" onConfirm={() => fulfillReserveMut.mutate(r.id)}>
                      <Button size="small">Выдано</Button>
                    </Popconfirm>
                    <Popconfirm title="Отменить бронь?" onConfirm={() => cancelReserveMut.mutate(r.id)}>
                      <Button size="small" danger>Отменить</Button>
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Modal>
    </div>
  );
}
