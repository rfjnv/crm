import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag,
  Typography, Upload, message, Popconfirm, Empty, Skeleton, DatePicker,
} from 'antd';
import {
  EditOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined,
  ArrowRightOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';
import { importOrdersApi, type ImportOrderItemPayload } from '../api/import-orders.api';
import { productsApi } from '../api/products.api';
import { cbuApi } from '../api/cbu.api';
import type { Product } from '../types';
import CbuRatesWidget from '../components/CbuRatesWidget';
import { API_URL } from '../api/client';
import {
  IMPORT_DOCUMENT_TYPE_LABELS,
  IMPORT_ORDER_STATUS_COLORS,
  IMPORT_ORDER_STATUS_LABELS,
  IMPORT_ORDER_STATUS_PIPELINE,
  SUPPLIER_CURRENCIES,
  type ImportDocumentType,
  type ImportOrderAttachment,
  type ImportOrderItem,
  type ImportOrderStatus,
  type SupplierCurrency,
} from '../types';
import { useAuthStore } from '../store/authStore';

const DOCUMENT_TYPES: ImportDocumentType[] = [
  'INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'CMR',
  'CERT_OF_ORIGIN', 'CUSTOMS_DECLARATION', 'SWIFT', 'OTHER',
];

function fileUrl(p: string): string {
  const base = (API_URL || '').replace(/\/api\/?$/, '');
  return `${base}/${p.replace(/^\/+/, '')}`;
}

export default function ImportOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage =
    user?.role === 'SUPER_ADMIN'
    || user?.role === 'ADMIN'
    || (user?.permissions ?? []).includes('manage_import_orders');

  const { data: order, isLoading } = useQuery({
    queryKey: ['import-order-detail', id],
    queryFn: () => importOrdersApi.getById(id!),
    enabled: !!id,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: productsApi.list,
    enabled: canManage,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm<{
    number: string;
    currency: SupplierCurrency;
    orderDate: dayjs.Dayjs;
    etd?: dayjs.Dayjs | null;
    eta?: dayjs.Dayjs | null;
    invoiceNumber?: string | null;
    containerNumber?: string | null;
    invoiceRate?: number | null;
    notes?: string | null;
  }>();

  const [itemsOpen, setItemsOpen] = useState(false);
  const [itemsDraft, setItemsDraft] = useState<ImportOrderItemPayload[]>([]);

  const [uploadType, setUploadType] = useState<ImportDocumentType>('INVOICE');

  useEffect(() => {
    if (editOpen && order) {
      editForm.setFieldsValue({
        number: order.number,
        currency: order.currency,
        orderDate: dayjs(order.orderDate),
        etd: order.etd ? dayjs(order.etd) : null,
        eta: order.eta ? dayjs(order.eta) : null,
        invoiceNumber: order.invoiceNumber,
        containerNumber: order.containerNumber,
        invoiceRate: order.invoiceRate ? Number(order.invoiceRate) : null,
        notes: order.notes,
      });
    }
  }, [editOpen, order, editForm]);

  useEffect(() => {
    if (itemsOpen && order) {
      setItemsDraft(
        order.items.map((i) => ({
          productId: i.productId,
          qty: Number(i.qty),
          unitPrice: Number(i.unitPrice),
          comment: i.comment,
        })),
      );
    }
  }, [itemsOpen, order]);

  const updateMut = useMutation({
    mutationFn: (payload: Parameters<typeof importOrdersApi.update>[1]) =>
      importOrdersApi.update(id!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['import-order-detail', id] });
      qc.invalidateQueries({ queryKey: ['import-orders'] });
      message.success('Сохранено');
      setEditOpen(false);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const itemsMut = useMutation({
    mutationFn: (items: ImportOrderItemPayload[]) => importOrdersApi.replaceItems(id!, items),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['import-order-detail', id] });
      qc.invalidateQueries({ queryKey: ['import-orders'] });
      message.success('Позиции обновлены');
      setItemsOpen(false);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const statusMut = useMutation({
    mutationFn: (status: ImportOrderStatus) => importOrdersApi.changeStatus(id!, status),
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ['import-order-detail', id] });
      qc.invalidateQueries({ queryKey: ['import-orders'] });
      message.success(`Статус: ${IMPORT_ORDER_STATUS_LABELS[o.status as ImportOrderStatus]}`);
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const uploadMut = useMutation({
    mutationFn: ({ file, type }: { file: File; type: ImportDocumentType }) =>
      importOrdersApi.uploadAttachment(id!, file, type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['import-order-detail', id] });
      message.success('Документ загружен');
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const delAttachMut = useMutation({
    mutationFn: (attachmentId: string) => importOrdersApi.deleteAttachment(id!, attachmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['import-order-detail', id] });
      message.success('Документ удалён');
    },
    onError: (err: unknown) => {
      message.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка');
    },
  });

  const productOptions = useMemo(
    () =>
      ((products ?? []) as Product[]).map((p) => ({
        value: p.id,
        label: `${p.name}${p.sku ? ` [${p.sku}]` : ''}`,
      })),
    [products],
  );

  if (isLoading) return <Skeleton active />;
  if (!order) return <Empty description="Заказ не найден" />;

  const allowedNext = IMPORT_ORDER_STATUS_PIPELINE[order.status];

  const itemColumns = [
    {
      title: 'Товар',
      key: 'product',
      render: (_: unknown, r: ImportOrderItem) => (
        r.product ? (
          <>
            <Link to={`/inventory/products/${r.product.id}`}>{r.product.name}</Link>
            {r.product.sku && <span style={{ color: '#888', marginLeft: 4 }}>[{r.product.sku}]</span>}
          </>
        ) : '—'
      ),
    },
    { title: 'Ед.', width: 60, render: (_: unknown, r: ImportOrderItem) => r.product?.unit || '—' },
    {
      title: 'Кол-во',
      dataIndex: 'qty',
      width: 120,
      align: 'right' as const,
      render: (v: number | string) => Number(v).toLocaleString('ru-RU'),
    },
    {
      title: 'Цена',
      dataIndex: 'unitPrice',
      width: 140,
      align: 'right' as const,
      render: (v: number | string) => `${Number(v).toLocaleString('ru-RU')} ${order.currency}`,
    },
    {
      title: 'Сумма',
      dataIndex: 'lineTotal',
      width: 160,
      align: 'right' as const,
      render: (v: number | string) => `${Number(v).toLocaleString('ru-RU')} ${order.currency}`,
    },
    { title: 'Комментарий', dataIndex: 'comment', render: (v: string | null) => v || '—' },
  ];

  const attachColumns = [
    {
      title: 'Тип',
      dataIndex: 'documentType',
      width: 200,
      render: (v: ImportDocumentType) => <Tag color="blue">{IMPORT_DOCUMENT_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: 'Файл',
      dataIndex: 'filename',
      render: (_v: string, r: ImportOrderAttachment) => (
        <a href={fileUrl(r.path)} target="_blank" rel="noreferrer">
          <DownloadOutlined /> {r.filename}
        </a>
      ),
    },
    {
      title: 'Размер',
      dataIndex: 'size',
      width: 110,
      render: (v: number) => `${(v / 1024).toFixed(1)} КБ`,
    },
    {
      title: 'Загрузил',
      key: 'uploader',
      render: (_: unknown, r: ImportOrderAttachment) => r.uploader?.fullName || '—',
    },
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
    ...(canManage
      ? [{
        title: '',
        key: 'actions',
        width: 50,
        render: (_: unknown, r: ImportOrderAttachment) => (
          <Popconfirm title="Удалить документ?" onConfirm={() => delAttachMut.mutate(r.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ),
      }]
      : []),
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <Space wrap size={8}>
          {`Импорт-заказ ${order.number}`}
          <Tag color={IMPORT_ORDER_STATUS_COLORS[order.status]}>
            {IMPORT_ORDER_STATUS_LABELS[order.status]}
          </Tag>
          <Tag color="blue">{order.currency}</Tag>
        </Space>
      </Typography.Title>

      <Card
        size="small"
        title="Информация"
        extra={canManage && order.status !== 'RECEIVED' && order.status !== 'CANCELED' && (
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
            Редактировать
          </Button>
        )}
        style={{ marginBottom: 16 }}
      >
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Поставщик">
            <Link to={`/foreign-trade/suppliers/${order.supplier.id}`}>
              {order.supplier.companyName}
            </Link>
            {order.supplier.country && <span style={{ color: '#888', marginLeft: 6 }}>({order.supplier.country})</span>}
          </Descriptions.Item>
          <Descriptions.Item label="Создал">{order.createdBy.fullName}</Descriptions.Item>
          <Descriptions.Item label="Дата заказа">{dayjs(order.orderDate).format('DD.MM.YYYY')}</Descriptions.Item>
          <Descriptions.Item label="Создан">{dayjs(order.createdAt).format('DD.MM.YYYY HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="ETD">{order.etd ? dayjs(order.etd).format('DD.MM.YYYY') : '—'}</Descriptions.Item>
          <Descriptions.Item label="ETA">{order.eta ? dayjs(order.eta).format('DD.MM.YYYY') : '—'}</Descriptions.Item>
          <Descriptions.Item label="Инвойс">{order.invoiceNumber || '—'}</Descriptions.Item>
          <Descriptions.Item label="Контейнер">{order.containerNumber || '—'}</Descriptions.Item>
          <Descriptions.Item label="Курс инвойса">
            {order.invoiceRate ? Number(order.invoiceRate).toLocaleString('ru-RU') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Итог">
            <b>{Number(order.totalAmount).toLocaleString('ru-RU')} {order.currency}</b>
            {order.totalAmountUzs != null && order.currency !== 'UZS' ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                ≈ {Number(order.totalAmountUzs).toLocaleString('ru-RU')} UZS
              </div>
            ) : null}
          </Descriptions.Item>
          {order.currency !== 'UZS' && (order.currentRate != null || order.currencyDiffUzs != null) ? (
            <Descriptions.Item label="Курс сейчас / разница" span={2}>
              {order.currentRate != null ? (
                <span>
                  {Number(order.currentRate).toLocaleString('ru-RU', { maximumFractionDigits: 4 })} UZS
                  {order.currentRateDate ? (
                    <Typography.Text type="secondary" style={{ marginLeft: 6 }}>
                      на {dayjs(order.currentRateDate).format('DD.MM.YYYY')}
                    </Typography.Text>
                  ) : null}
                </span>
              ) : '—'}
              {order.currencyDiffUzs != null ? (
                <Tag
                  style={{ marginLeft: 8 }}
                  color={order.currencyDiffUzs > 0 ? 'volcano' : order.currencyDiffUzs < 0 ? 'green' : 'default'}
                >
                  Δ {order.currencyDiffUzs > 0 ? '+' : ''}
                  {Number(order.currencyDiffUzs).toLocaleString('ru-RU')} UZS
                </Tag>
              ) : null}
            </Descriptions.Item>
          ) : null}
          <Descriptions.Item label="Overhead (UZS)">
            {order.overheadUzs != null
              ? Number(order.overheadUzs).toLocaleString('ru-RU')
              : '0'}
          </Descriptions.Item>
          <Descriptions.Item label="Landed cost (UZS)">
            {order.landedCostUzs != null
              ? <b>{Number(order.landedCostUzs).toLocaleString('ru-RU')}</b>
              : <Typography.Text type="secondary">недоступно (нет курса)</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Заметки" span={2}>{order.notes || '—'}</Descriptions.Item>
        </Descriptions>

        <LandedCostSection orderId={order.id} currency={order.currency} />
      </Card>

      {canManage && allowedNext.length > 0 && (
        <Card size="small" title="Пайплайн" style={{ marginBottom: 16 }}>
          <Space wrap>
            {allowedNext.map((s) => (
              <Popconfirm
                key={s}
                title={`Перевести в статус "${IMPORT_ORDER_STATUS_LABELS[s]}"?`}
                onConfirm={() => statusMut.mutate(s)}
              >
                <Button
                  icon={s === 'CANCELED' ? <CloseCircleOutlined /> : <ArrowRightOutlined />}
                  danger={s === 'CANCELED'}
                >
                  {IMPORT_ORDER_STATUS_LABELS[s]}
                </Button>
              </Popconfirm>
            ))}
          </Space>
        </Card>
      )}

      <Card
        size="small"
        title={`Позиции (${order.items.length})`}
        extra={canManage && order.status !== 'RECEIVED' && order.status !== 'CANCELED' && (
          <Button size="small" icon={<EditOutlined />} onClick={() => setItemsOpen(true)}>
            Редактировать позиции
          </Button>
        )}
        style={{ marginBottom: 16 }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={order.items}
          columns={itemColumns}
          pagination={false}
          locale={{ emptyText: 'Позиции ещё не добавлены' }}
          summary={() => order.items.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4} align="right">
                <b>Итого:</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <b>{Number(order.totalAmount).toLocaleString('ru-RU')} {order.currency}</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} />
            </Table.Summary.Row>
          ) : null}
        />
      </Card>

      <Card
        size="small"
        title={`Документы (${order.attachments.length})`}
        extra={canManage && (
          <Space>
            <Select
              size="small"
              value={uploadType}
              onChange={setUploadType}
              style={{ width: 220 }}
              options={DOCUMENT_TYPES.map((t) => ({ value: t, label: IMPORT_DOCUMENT_TYPE_LABELS[t] }))}
            />
            <Upload
              showUploadList={false}
              accept=".pdf,.jpg,.jpeg,.png,.zip"
              beforeUpload={(file) => {
                uploadMut.mutate({ file, type: uploadType });
                return false;
              }}
              fileList={[] as UploadFile[]}
            >
              <Button size="small" icon={<UploadOutlined />} loading={uploadMut.isPending}>
                Загрузить
              </Button>
            </Upload>
          </Space>
        )}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={order.attachments}
          columns={attachColumns}
          pagination={false}
          locale={{ emptyText: 'Документов нет. Выберите тип и загрузите файл.' }}
        />
      </Card>

      {/* ---------- Edit modal ---------- */}
      <Modal
        title="Редактировать заказ"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.validateFields().then((v) => {
          updateMut.mutate({
            number: v.number,
            currency: v.currency,
            orderDate: v.orderDate.format('YYYY-MM-DD'),
            etd: v.etd ? v.etd.format('YYYY-MM-DD') : null,
            eta: v.eta ? v.eta.format('YYYY-MM-DD') : null,
            invoiceNumber: v.invoiceNumber || null,
            containerNumber: v.containerNumber || null,
            invoiceRate: v.invoiceRate ?? null,
            notes: v.notes || null,
          });
        })}
        confirmLoading={updateMut.isPending}
        width={720}
        destroyOnClose
      >
        <CbuRatesWidget
          compact
          onPick={(ccy, rate) => {
            const currentCurrency = editForm.getFieldValue('currency') as SupplierCurrency | undefined;
            if (currentCurrency && currentCurrency !== ccy) {
              message.warning(`Валюта заказа: ${currentCurrency}. Курс ${ccy} не подставлен.`);
              return;
            }
            editForm.setFieldsValue({ invoiceRate: Number(rate.toFixed(6)) });
            message.success(`Курс ${ccy} подставлен`);
          }}
        />
        <Form form={editForm} layout="vertical">
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="number" label="Номер" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="currency" label="Валюта" style={{ width: 140, marginLeft: 8 }}>
              <Select options={SUPPLIER_CURRENCIES.map((c) => ({ value: c, label: c }))} />
            </Form.Item>
          </Space.Compact>
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
            <Form.Item name="invoiceNumber" label="Инвойс" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="containerNumber" label="Контейнер" style={{ flex: 1, marginLeft: 8 }}>
              <Input />
            </Form.Item>
            <Form.Item name="invoiceRate" label="Курс" style={{ flex: 1, marginLeft: 8 }}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.0001} />
            </Form.Item>
          </Space.Compact>
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) =>
              prev.orderDate !== curr.orderDate || prev.currency !== curr.currency
            }
          >
            {({ getFieldValue, setFieldsValue }) => (
              <CbuRateHint
                orderDate={getFieldValue('orderDate')}
                currency={getFieldValue('currency')}
                onApply={(rate) => {
                  setFieldsValue({ invoiceRate: Number(rate.toFixed(6)) });
                  message.success('Курс ЦБ подставлен');
                }}
              />
            )}
          </Form.Item>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- Items modal ---------- */}
      <Modal
        title="Редактировать позиции"
        open={itemsOpen}
        onCancel={() => setItemsOpen(false)}
        onOk={() => itemsMut.mutate(itemsDraft)}
        okText="Сохранить"
        confirmLoading={itemsMut.isPending}
        width={900}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {itemsDraft.map((it, idx) => (
            <Space key={idx} align="start" style={{ width: '100%' }} wrap>
              <Select
                showSearch
                style={{ width: 320 }}
                value={it.productId || undefined}
                placeholder="Товар"
                options={productOptions}
                filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                onChange={(v) => setItemsDraft((d) => d.map((r, i) => i === idx ? { ...r, productId: v } : r))}
              />
              <InputNumber
                placeholder="Кол-во"
                min={0}
                step={1}
                style={{ width: 120 }}
                value={it.qty}
                onChange={(v) => setItemsDraft((d) => d.map((r, i) => i === idx ? { ...r, qty: Number(v) || 0 } : r))}
              />
              <InputNumber
                placeholder="Цена"
                min={0}
                step={0.01}
                style={{ width: 140 }}
                value={it.unitPrice}
                onChange={(v) => setItemsDraft((d) => d.map((r, i) => i === idx ? { ...r, unitPrice: Number(v) || 0 } : r))}
              />
              <Input
                placeholder="Комментарий"
                style={{ width: 220 }}
                value={it.comment ?? ''}
                onChange={(e) => setItemsDraft((d) => d.map((r, i) => i === idx ? { ...r, comment: e.target.value } : r))}
              />
              <span style={{ color: '#888' }}>
                {(it.qty * it.unitPrice).toLocaleString('ru-RU')} {order.currency}
              </span>
              <Button danger size="small" icon={<DeleteOutlined />} onClick={() => setItemsDraft((d) => d.filter((_, i) => i !== idx))} />
            </Space>
          ))}
          <Button
            onClick={() => setItemsDraft((d) => [...d, { productId: '', qty: 1, unitPrice: 0, comment: null }])}
          >
            + Добавить позицию
          </Button>
          <div style={{ textAlign: 'right', fontWeight: 500 }}>
            Итого: {itemsDraft.reduce((s, i) => s + Number(i.qty) * Number(i.unitPrice), 0).toLocaleString('ru-RU')} {order.currency}
          </div>
        </Space>
      </Modal>
    </div>
  );
}

/**
 * Мини-подсказка под полем «Курс» в модалке редактирования импортного заказа.
 * При изменении orderDate/currency подтягивает курс ЦБ из БД (таблица ExchangeRate)
 * и предлагает одной кнопкой подставить.
 */
function CbuRateHint(props: {
  orderDate: dayjs.Dayjs | string | null | undefined;
  currency: SupplierCurrency | undefined;
  onApply: (rate: number) => void;
}) {
  const { orderDate, currency, onApply } = props;
  const dateIso = useMemo(() => {
    if (!orderDate) return null;
    const d = dayjs.isDayjs(orderDate) ? orderDate : dayjs(orderDate);
    return d.isValid() ? d.format('YYYY-MM-DD') : null;
  }, [orderDate]);

  const enabled = !!dateIso && !!currency && currency !== 'UZS';

  const { data, isFetching } = useQuery({
    queryKey: ['exchange-rate', dateIso, currency],
    queryFn: () => cbuApi.findStored(dateIso!, currency!),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!enabled) {
    return (
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: -8, marginBottom: 8 }}>
        Курс ЦБ подставится автоматически, когда выбрана дата и валюта (кроме UZS).
      </div>
    );
  }

  if (isFetching) {
    return (
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: -8, marginBottom: 8 }}>
        Ищу курс ЦБ на {dateIso}…
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ fontSize: 12, color: '#d4b106', marginTop: -8, marginBottom: 8 }}>
        Курс {currency} на {dateIso} ещё не загружен в БД. Нажмите «В БД» в виджете сверху, чтобы
        синхронизировать.
      </div>
    );
  }

  const display = data.rate.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  return (
    <div
      style={{
        fontSize: 12,
        color: 'rgba(0,0,0,0.65)',
        marginTop: -8,
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      Курс ЦБ на {data.sourceDate}:{' '}
      <b>
        {display} UZS / 1 {currency}
      </b>
      <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onApply(data.rate)}>
        подставить
      </Button>
    </div>
  );
}

/**
 * MVP-4: Блок «Landed cost» на странице импорт-заказа.
 * Показывает распределение накладных расходов по позициям и полную себестоимость в UZS.
 */
function LandedCostSection({
  orderId,
  currency,
}: {
  orderId: string;
  currency: SupplierCurrency;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['import-order-landed', orderId],
    queryFn: () => importOrdersApi.getLandedCost(orderId),
  });

  if (isLoading) return <Skeleton active />;
  if (!data) return null;

  const { items, overheadItems, overheadUzs, landedCostUzs } = data;

  return (
    <Card
      size="small"
      title="Landed cost (полная себестоимость)"
      style={{ marginTop: 16 }}
      bodyStyle={{ paddingTop: 8 }}
    >
      {items.length === 0 ? (
        <Empty description="Нет позиций" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          size="small"
          rowKey="itemId"
          dataSource={items}
          pagination={false}
          columns={[
            {
              title: 'Товар',
              dataIndex: ['product', 'name'],
              render: (_, r) => (
                <div>
                  <div>{r.product.name}</div>
                  {r.product.sku ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.product.sku}
                    </Typography.Text>
                  ) : null}
                </div>
              ),
            },
            { title: 'Кол-во', dataIndex: 'qty', width: 80, align: 'right' },
            {
              title: `Цена, ${currency}`,
              dataIndex: 'unitPrice',
              align: 'right',
              render: (v: number) => v.toLocaleString('ru-RU'),
            },
            {
              title: `Линия, ${currency}`,
              dataIndex: 'lineTotal',
              align: 'right',
              render: (v: number) => v.toLocaleString('ru-RU'),
            },
            {
              title: 'Доля',
              dataIndex: 'sharePct',
              width: 80,
              align: 'right',
              render: (v: number) => `${v.toFixed(1)} %`,
            },
            {
              title: 'Линия, UZS',
              dataIndex: 'lineTotalUzs',
              align: 'right',
              render: (v: number | null) =>
                v == null ? <Typography.Text type="secondary">—</Typography.Text> : v.toLocaleString('ru-RU'),
            },
            {
              title: '+Overhead, UZS',
              dataIndex: 'allocatedOverheadUzs',
              align: 'right',
              render: (v: number) => v.toLocaleString('ru-RU'),
            },
            {
              title: 'Landed, UZS',
              dataIndex: 'landedUzs',
              align: 'right',
              render: (v: number | null) =>
                v == null ? <Typography.Text type="secondary">—</Typography.Text> : <b>{v.toLocaleString('ru-RU')}</b>,
            },
            {
              title: 'За ед., UZS',
              dataIndex: 'unitLandedUzs',
              align: 'right',
              render: (v: number | null) =>
                v == null ? <Typography.Text type="secondary">—</Typography.Text> : v.toLocaleString('ru-RU'),
            },
          ]}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}>
                  <b>Итого</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  <b>{Number(overheadUzs).toLocaleString('ru-RU')}</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">
                  <b>
                    {landedCostUzs != null
                      ? Number(landedCostUzs).toLocaleString('ru-RU')
                      : '—'}
                  </b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      )}

      <div style={{ marginTop: 16 }}>
        <Typography.Title level={5} style={{ marginBottom: 8 }}>
          Накладные расходы по заказу
        </Typography.Title>
        {overheadItems.length === 0 ? (
          <Typography.Text type="secondary">
            Привяжите расходы к этому импорт-заказу на странице «Расходы», чтобы они попали в
            landed cost.
          </Typography.Text>
        ) : (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={overheadItems}
            columns={[
              { title: 'Дата', dataIndex: 'date', width: 110, render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
              { title: 'Категория', dataIndex: 'category' },
              {
                title: 'Сумма',
                dataIndex: 'amount',
                align: 'right',
                render: (v: number, r) =>
                  `${v.toLocaleString('ru-RU')} ${r.currency}`,
              },
              {
                title: 'В UZS',
                dataIndex: 'amountUzs',
                align: 'right',
                render: (v: number | null) =>
                  v == null ? '—' : v.toLocaleString('ru-RU'),
              },
              { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
