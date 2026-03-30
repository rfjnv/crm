import { useState, useMemo, useEffect } from 'react';
import {
  Modal, Tabs, Form, Input, InputNumber, Select, DatePicker, Button, Alert,
  Typography, Popconfirm, message, Tag, theme,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, type OverrideDealData } from '../api/admin.api';
import { moneyFormatter, moneyParser, formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import DealStatusTag from './DealStatusTag';
import type { Deal, Product, DealStatus, User, PaymentRecord, DealComment } from '../types';
import dayjs from 'dayjs';

const ALL_STATUSES: DealStatus[] = [
  'NEW', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED', 'IN_PROGRESS',
  'WAITING_FINANCE', 'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT',
  'SHIPMENT_ON_HOLD', 'CLOSED', 'CANCELED', 'REJECTED',
];

interface Props {
  open: boolean;
  deal: Deal;
  payments: PaymentRecord[];
  products: Product[];
  users: User[];
  clients: { id: string; companyName: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

interface OverrideItem {
  key: string;
  id?: string;
  productId: string;
  requestedQty?: number;
  price?: number;
  requestComment?: string;
  warehouseComment?: string;
  dealDate?: dayjs.Dayjs;
  confirmedAt?: dayjs.Dayjs;
  createdAt?: dayjs.Dayjs;
}

interface OverridePayment {
  id: string;
  paidAt?: dayjs.Dayjs;
  createdAt?: dayjs.Dayjs;
}

interface OverrideComment {
  id: string;
  text: string;
  createdAt?: dayjs.Dayjs;
}

let nextKey = 0;

export default function SuperOverrideModal({ open, deal, payments, products, users, clients, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const [shipmentForm] = Form.useForm();
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<OverrideItem[]>([]);
  const [paymentDates, setPaymentDates] = useState<OverridePayment[]>([]);
  const [commentDates, setCommentDates] = useState<OverrideComment[]>([]);
  const [editItems, setEditItems] = useState(false);
  const [editShipment, setEditShipment] = useState(false);
  const queryClient = useQueryClient();
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();

  // Pre-populate on open
  useEffect(() => {
    if (open && deal) {
      setReason('');
      setEditItems(false);
      setEditShipment(false);

      form.setFieldsValue({
        title: deal.title,
        status: deal.status,
        clientId: deal.clientId,
        managerId: deal.managerId,
        contractId: deal.contractId || undefined,
        paymentMethod: deal.paymentMethod || undefined,
        paymentType: deal.paymentType,
        paidAmount: Number(deal.paidAmount),
        discount: Number(deal.discount || 0),
        dueDate: deal.dueDate ? dayjs(deal.dueDate) : undefined,
        createdAt: deal.createdAt ? dayjs(deal.createdAt) : undefined,
        terms: deal.terms || '',
      });

      // Pre-populate items
      const dealItems: OverrideItem[] = (deal.items ?? []).map((i) => ({
        key: `oi-${nextKey++}`,
        id: i.id,
        productId: i.productId,
        requestedQty: i.requestedQty != null ? Number(i.requestedQty) : undefined,
        price: i.price != null ? Number(i.price) : undefined,
        requestComment: i.requestComment || undefined,
        warehouseComment: i.warehouseComment || undefined,
        dealDate: i.dealDate ? dayjs(i.dealDate) : undefined,
        confirmedAt: i.confirmedAt ? dayjs(i.confirmedAt) : undefined,
        createdAt: i.createdAt ? dayjs(i.createdAt) : undefined,
      }));
      setItems(dealItems);

      setPaymentDates(
        (payments ?? []).map((payment) => ({
          id: payment.id,
          paidAt: payment.paidAt ? dayjs(payment.paidAt) : undefined,
          createdAt: payment.createdAt ? dayjs(payment.createdAt) : undefined,
        })),
      );

      setCommentDates(
        ((deal.comments ?? []) as DealComment[]).map((comment) => ({
          id: comment.id,
          text: comment.text,
          createdAt: comment.createdAt ? dayjs(comment.createdAt) : undefined,
        })),
      );

      if (deal.shipment) {
        setEditShipment(true);
        shipmentForm.setFieldsValue({
          vehicleType: deal.shipment.vehicleType,
          vehicleNumber: deal.shipment.vehicleNumber,
          driverName: deal.shipment.driverName,
          departureTime: dayjs(deal.shipment.departureTime),
          shippedAt: deal.shipment.shippedAt ? dayjs(deal.shipment.shippedAt) : undefined,
          deliveryNoteNumber: deal.shipment.deliveryNoteNumber,
          shipmentComment: deal.shipment.shipmentComment || '',
        });
      } else {
        shipmentForm.resetFields();
      }
    }
  }, [open, deal, payments, form, shipmentForm]);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    (products ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const overrideMut = useMutation({
    mutationFn: (data: OverrideDealData) => adminApi.overrideDeal(deal.id, data),
    onSuccess: () => {
      message.success('Сделка обновлена (SUPER OVERRIDE)');
      queryClient.invalidateQueries({ queryKey: ['deal', deal.id] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка override';
      message.error(msg);
    },
  });

  function handleSubmit() {
    if (reason.trim().length < 3) {
      message.error('Укажите причину изменения (мин. 3 символа)');
      return;
    }

    form.validateFields().then((values) => {
      const data: OverrideDealData = { reason: reason.trim() };

      // Only include changed fields
      if (values.title !== deal.title) data.title = values.title;
      if (values.status !== deal.status) data.status = values.status;
      if (values.clientId !== deal.clientId) data.clientId = values.clientId;
      if (values.managerId !== deal.managerId) data.managerId = values.managerId;
      if ((values.contractId || null) !== (deal.contractId || null)) data.contractId = values.contractId || null;
      if ((values.paymentMethod || null) !== (deal.paymentMethod || null)) data.paymentMethod = values.paymentMethod || null;
      if (values.paymentType !== deal.paymentType) data.paymentType = values.paymentType;
      if (values.paidAmount !== Number(deal.paidAmount)) data.paidAmount = values.paidAmount;
      if (values.discount !== Number(deal.discount || 0)) data.discount = values.discount;
      if (values.terms !== (deal.terms || '')) data.terms = values.terms || null;

      const formDueDate = values.dueDate ? values.dueDate.toISOString() : null;
      const dealDueDate = deal.dueDate ? dayjs(deal.dueDate).toISOString() : null;
      if (formDueDate !== dealDueDate) data.dueDate = formDueDate;

      const formCreatedAt = values.createdAt ? values.createdAt.toISOString() : null;
      const dealCreatedAt = deal.createdAt ? dayjs(deal.createdAt).toISOString() : null;
      if (formCreatedAt !== dealCreatedAt) data.createdAt = formCreatedAt;

      const hasItemDateChanges = items.some((item) => {
        const original = deal.items?.find((entry) => entry.id === item.id);
        return (
          (item.dealDate ? item.dealDate.toISOString() : null) !== (original?.dealDate ? dayjs(original.dealDate).toISOString() : null)
          || (item.confirmedAt ? item.confirmedAt.toISOString() : null) !== (original?.confirmedAt ? dayjs(original.confirmedAt).toISOString() : null)
          || (item.createdAt ? item.createdAt.toISOString() : null) !== (original?.createdAt ? dayjs(original.createdAt).toISOString() : null)
        );
      });

      if (editItems || hasItemDateChanges) {
        data.items = items
          .filter((i) => i.productId)
          .map((i) => ({
            id: i.id,
            productId: i.productId,
            requestedQty: i.requestedQty,
            price: i.price,
            requestComment: i.requestComment,
            warehouseComment: i.warehouseComment,
            dealDate: i.dealDate ? i.dealDate.toISOString() : null,
            confirmedAt: i.confirmedAt ? i.confirmedAt.toISOString() : null,
            createdAt: i.createdAt ? i.createdAt.toISOString() : null,
          }));
      }

      const changedPayments = paymentDates
        .map((payment) => {
          const original = payments.find((entry) => entry.id === payment.id);
          const paidAt = payment.paidAt ? payment.paidAt.toISOString() : null;
          const createdAt = payment.createdAt ? payment.createdAt.toISOString() : null;
          const originalPaidAt = original?.paidAt ? dayjs(original.paidAt).toISOString() : null;
          const originalCreatedAt = original?.createdAt ? dayjs(original.createdAt).toISOString() : null;
          if (paidAt === originalPaidAt && createdAt === originalCreatedAt) return null;
          return { id: payment.id, paidAt, createdAt };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);
      if (changedPayments.length > 0) data.payments = changedPayments;

      const changedComments = commentDates
        .map((comment) => {
          const original = deal.comments?.find((entry) => entry.id === comment.id);
          const createdAt = comment.createdAt ? comment.createdAt.toISOString() : null;
          const originalCreatedAt = original?.createdAt ? dayjs(original.createdAt).toISOString() : null;
          if (createdAt === originalCreatedAt) return null;
          return { id: comment.id, createdAt };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);
      if (changedComments.length > 0) data.comments = changedComments;

      // Shipment
      if (editShipment && !deal.shipment) {
        // New shipment
        shipmentForm.validateFields().then((sv) => {
          data.shipment = {
            vehicleType: sv.vehicleType,
            vehicleNumber: sv.vehicleNumber,
            driverName: sv.driverName,
            departureTime: sv.departureTime.toISOString(),
            shippedAt: sv.shippedAt ? sv.shippedAt.toISOString() : null,
            deliveryNoteNumber: sv.deliveryNoteNumber,
            shipmentComment: sv.shipmentComment || undefined,
          };
          overrideMut.mutate(data);
        }).catch(() => message.error('Заполните все поля отгрузки'));
        return;
      } else if (editShipment && deal.shipment) {
        const sv = shipmentForm.getFieldsValue();
        if (sv.vehicleType && sv.vehicleNumber && sv.driverName && sv.departureTime && sv.deliveryNoteNumber) {
          data.shipment = {
            vehicleType: sv.vehicleType,
            vehicleNumber: sv.vehicleNumber,
            driverName: sv.driverName,
            departureTime: sv.departureTime.toISOString(),
            shippedAt: sv.shippedAt ? sv.shippedAt.toISOString() : null,
            deliveryNoteNumber: sv.deliveryNoteNumber,
            shipmentComment: sv.shipmentComment || undefined,
          };
        }
      }

      overrideMut.mutate(data);
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { key: `oi-${nextKey++}`, productId: '' }]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function updateItem(key: string, patch: Partial<OverrideItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function updatePaymentDate(id: string, patch: Partial<OverridePayment>) {
    setPaymentDates((prev) => prev.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)));
  }

  function updateCommentDate(id: string, patch: Partial<OverrideComment>) {
    setCommentDates((prev) => prev.map((comment) => (comment.id === id ? { ...comment, ...patch } : comment)));
  }

  const itemsTotal = useMemo(() =>
    items.reduce((s, i) => s + (i.requestedQty || 0) * (i.price || 0), 0),
    [items]);

  return (
    <Modal
      title={<><Tag color="red">SUPER ADMIN</Tag> Override: {deal.title}</>}
      open={open}
      onCancel={onClose}
      width={isMobile ? '100%' : 900}
      footer={[
        <Button key="cancel" onClick={onClose}>Отмена</Button>,
        <Popconfirm
          key="submit"
          title="Применить override?"
          description="Это действие будет записано в аудит."
          onConfirm={handleSubmit}
        >
          <Button type="primary" danger loading={overrideMut.isPending}>
            Применить Override
          </Button>
        </Popconfirm>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        message="Режим суперредактирования"
        description="Все изменения будут записаны в аудит с указанием причины. Это действие обходит стандартный workflow."
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 16 }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Причина изменения *</Typography.Text>
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Укажите причину override (обязательно, мин. 3 символа)..."
          status={reason.length > 0 && reason.length < 3 ? 'error' : undefined}
        />
      </div>

      <Tabs items={[
        {
          key: 'basic',
          label: 'Основное',
          children: (
            <Form form={form} layout="vertical">
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                <Form.Item name="createdAt" label="Дата создания сделки">
                  <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                </Form.Item>
                <Form.Item name="title" label="Название">
                  <Input />
                </Form.Item>
                <Form.Item name="status" label="Статус">
                  <Select>
                    {ALL_STATUSES.map((s) => (
                      <Select.Option key={s} value={s}>
                        <DealStatusTag status={s} />
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item name="clientId" label="Клиент">
                  <Select showSearch optionFilterProp="label"
                    options={clients.map((c) => ({ label: c.companyName, value: c.id }))}
                  />
                </Form.Item>
                <Form.Item name="managerId" label="Менеджер">
                  <Select showSearch optionFilterProp="label"
                    options={(users ?? []).filter((u) => u.isActive).map((u) => ({ label: `${u.fullName} (${u.role})`, value: u.id }))}
                  />
                </Form.Item>
              </div>
            </Form>
          ),
        },
        {
          key: 'items',
          label: `Товары (${items.length})`,
          children: (
            <div>
              {!editItems ? (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    Редактирование товаров полностью заменит текущий список.
                  </Typography.Text>
                  <Button type="primary" onClick={() => setEditItems(true)}>
                    Редактировать товары
                  </Button>
                </div>
              ) : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                        <th style={{ padding: '4px 6px', fontSize: 12 }}>Товар</th>
                        <th style={{ padding: '4px 6px', fontSize: 12, width: 90 }}>Кол-во</th>
                        <th style={{ padding: '4px 6px', fontSize: 12, width: 120 }}>Цена</th>
                        <th style={{ padding: '4px 6px', fontSize: 12, width: 100 }}>Сумма</th>
                        <th style={{ padding: '4px 6px', fontSize: 12, width: 180 }}>Deal Date</th>
                        <th style={{ padding: '4px 6px', fontSize: 12, width: 180 }}>Confirmed At</th>
                        <th style={{ padding: '4px 6px', fontSize: 12, width: 180 }}>Item Created</th>
                        <th style={{ width: 32 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const lineTotal = (item.requestedQty || 0) * (item.price || 0);
                        return (
                          <tr key={item.key} style={{ borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                            <td style={{ padding: '4px 6px' }}>
                              <Select
                                showSearch optionFilterProp="label"
                                placeholder="Товар"
                                style={{ width: '100%' }}
                                value={item.productId || undefined}
                                onChange={(v) => {
                                  const p = productMap.get(v);
                                  updateItem(item.key, {
                                    productId: v,
                                    price: p?.salePrice ? Number(p.salePrice) : item.price,
                                  });
                                }}
                                options={(products ?? []).filter((p) => p.isActive).map((p) => ({
                                  label: `${p.name} (${p.sku})`,
                                  value: p.id,
                                }))}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <InputNumber
                                min={0.001} step={1} style={{ width: '100%' }}
                                value={item.requestedQty}
                                onChange={(v) => updateItem(item.key, { requestedQty: v ?? undefined })}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <InputNumber
                                min={0} style={{ width: '100%' }}
                                formatter={moneyFormatter} parser={(v) => moneyParser(v) as unknown as number}
                                value={item.price}
                                onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
                              />
                            </td>
                            <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                              {lineTotal > 0 ? formatUZS(lineTotal) : '—'}
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <DatePicker
                                showTime
                                style={{ width: '100%' }}
                                format="DD.MM.YYYY HH:mm"
                                value={item.dealDate}
                                onChange={(v) => updateItem(item.key, { dealDate: v ?? undefined })}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <DatePicker
                                showTime
                                style={{ width: '100%' }}
                                format="DD.MM.YYYY HH:mm"
                                value={item.confirmedAt}
                                onChange={(v) => updateItem(item.key, { confirmedAt: v ?? undefined })}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <DatePicker
                                showTime
                                style={{ width: '100%' }}
                                format="DD.MM.YYYY HH:mm"
                                value={item.createdAt}
                                onChange={(v) => updateItem(item.key, { createdAt: v ?? undefined })}
                              />
                            </td>
                            <td style={{ padding: '4px 6px' }}>
                              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeItem(item.key)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {itemsTotal > 0 && (
                    <Typography.Text strong style={{ display: 'block', textAlign: 'right', marginBottom: 8 }}>
                      Итого: {formatUZS(itemsTotal)}
                    </Typography.Text>
                  )}
                  <Button type="dashed" block icon={<PlusOutlined />} onClick={addItem}>
                    Добавить товар
                  </Button>
                </>
              )}
            </div>
          ),
        },
        {
          key: 'payment',
          label: 'Оплата',
          children: (
            <Form form={form} layout="vertical">
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                <Form.Item name="paymentMethod" label="Способ оплаты">
                  <Select allowClear placeholder="Не указан" options={[
                    { label: 'Наличные', value: 'CASH' },
                    { label: 'Payme', value: 'PAYME' },
                    { label: 'QR', value: 'QR' },
                    { label: 'Click', value: 'CLICK' },
                    { label: 'Терминал', value: 'TERMINAL' },
                    { label: 'Перечисление', value: 'TRANSFER' },
                  ]} />
                </Form.Item>
                <Form.Item name="paymentType" label="Тип оплаты">
                  <Select options={[
                    { label: 'Полная', value: 'FULL' },
                    { label: 'Частичная', value: 'PARTIAL' },
                    { label: 'Рассрочка', value: 'INSTALLMENT' },
                  ]} />
                </Form.Item>
                <Form.Item name="paidAmount" label="Оплачено">
                  <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                </Form.Item>
                <Form.Item name="discount" label="Скидка">
                  <InputNumber style={{ width: '100%' }} min={0} formatter={moneyFormatter} parser={moneyParser} />
                </Form.Item>
                <Form.Item name="dueDate" label="Срок оплаты">
                  <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                </Form.Item>
              </div>
              <Form.Item name="terms" label="Условия">
                <Input.TextArea rows={2} placeholder="Условия оплаты..." />
              </Form.Item>
            </Form>
          ),
        },
        {
          key: 'payment-dates',
          label: `Payment Dates (${paymentDates.length})`,
          children: (
            <div style={{ display: 'grid', gap: 12 }}>
              {paymentDates.length === 0 ? (
                <Typography.Text type="secondary">No payments for this deal.</Typography.Text>
              ) : paymentDates.map((payment) => {
                const original = payments.find((entry) => entry.id === payment.id);
                return (
                  <div key={payment.id} style={{ border: `1px solid ${tk.colorBorderSecondary}`, borderRadius: 8, padding: 12 }}>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                      {(original?.amount ? formatUZS(Number(original.amount)) : 'Payment')} {original?.method ? `• ${original.method}` : ''}
                    </Typography.Text>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                      <div>
                        <Typography.Text type="secondary">Paid At</Typography.Text>
                        <DatePicker
                          showTime
                          style={{ width: '100%', marginTop: 4 }}
                          format="DD.MM.YYYY HH:mm"
                          value={payment.paidAt}
                          onChange={(v) => updatePaymentDate(payment.id, { paidAt: v ?? undefined })}
                        />
                      </div>
                      <div>
                        <Typography.Text type="secondary">Created At</Typography.Text>
                        <DatePicker
                          showTime
                          style={{ width: '100%', marginTop: 4 }}
                          format="DD.MM.YYYY HH:mm"
                          value={payment.createdAt}
                          onChange={(v) => updatePaymentDate(payment.id, { createdAt: v ?? undefined })}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ),
        },
        {
          key: 'comment-dates',
          label: `Comment Dates (${commentDates.length})`,
          children: (
            <div style={{ display: 'grid', gap: 12 }}>
              {commentDates.length === 0 ? (
                <Typography.Text type="secondary">No comments for this deal.</Typography.Text>
              ) : commentDates.map((comment) => (
                <div key={comment.id} style={{ border: `1px solid ${tk.colorBorderSecondary}`, borderRadius: 8, padding: 12 }}>
                  <Typography.Text style={{ display: 'block', marginBottom: 8 }}>
                    {comment.text || 'Комментарий'}
                  </Typography.Text>
                  <Typography.Text type="secondary">Created At</Typography.Text>
                  <DatePicker
                    showTime
                    style={{ width: '100%', marginTop: 4 }}
                    format="DD.MM.YYYY HH:mm"
                    value={comment.createdAt}
                    onChange={(v) => updateCommentDate(comment.id, { createdAt: v ?? undefined })}
                  />
                </div>
              ))}
            </div>
          ),
        },
        {
          key: 'shipment',
          label: 'Отгрузка',
          children: (
            <div>
              {!editShipment ? (
                <div style={{ textAlign: 'center', padding: 24 }}>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    {deal.shipment ? 'Отгрузка уже оформлена. Нажмите для редактирования.' : 'Отгрузка не оформлена.'}
                  </Typography.Text>
                  <Button type="primary" onClick={() => setEditShipment(true)}>
                    {deal.shipment ? 'Редактировать отгрузку' : 'Добавить отгрузку'}
                  </Button>
                </div>
              ) : (
                <Form form={shipmentForm} layout="vertical">
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                    <Form.Item name="vehicleType" label="Тип транспорта" rules={[{ required: true }]}>
                      <Input placeholder="Грузовик / Фура / ..." />
                    </Form.Item>
                    <Form.Item name="vehicleNumber" label="Номер транспорта" rules={[{ required: true }]}>
                      <Input placeholder="01 A 123 AA" />
                    </Form.Item>
                    <Form.Item name="driverName" label="Водитель" rules={[{ required: true }]}>
                      <Input placeholder="ФИО водителя" />
                    </Form.Item>
                    <Form.Item name="departureTime" label="Время отправления" rules={[{ required: true }]}>
                      <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                    </Form.Item>
                    <Form.Item name="shippedAt" label="Shipped At">
                      <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
                    </Form.Item>
                    <Form.Item name="deliveryNoteNumber" label="Номер накладной" rules={[{ required: true }]}>
                      <Input placeholder="Номер накладной" />
                    </Form.Item>
                    <Form.Item name="shipmentComment" label="Комментарий">
                      <Input placeholder="Комментарий к отгрузке" />
                    </Form.Item>
                  </div>
                </Form>
              )}
            </div>
          ),
        },
      ]} />
    </Modal>
  );
}
