import { useState, useMemo, useEffect } from 'react';
import {
  Form, Input, InputNumber, Select, DatePicker, Button, Alert,
  Typography, Popconfirm, message, theme,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dealsApi } from '../api/deals.api';
import { moneyFormatter, moneyParser, formatUZS } from '../utils/currency';
import { smartFilterOption } from '../utils/translit';
import { useIsMobile } from '../hooks/useIsMobile';
import { mobileMainContentBottomPadding } from '../config/mobileBottomNav';
import type { Deal, Product, PaymentRecord, PaymentMethod } from '../types';
import dayjs from 'dayjs';

const productsCellPad = '8px 10px';

export interface WarehouseOverridePanelProps {
  deal: Deal;
  payments: PaymentRecord[];
  products: Product[];
  onCancel: () => void;
  onSuccess: () => void;
}

interface OverrideItem {
  key: string;
  id?: string;
  productId: string;
  requestedQty?: number;
  price?: number;
  dealDate?: dayjs.Dayjs;
}

let nextKey = 0;

const PAYMENT_METHOD_OPTIONS: { label: string; value: PaymentMethod }[] = [
  { label: 'Наличные', value: 'CASH' },
  { label: 'Payme', value: 'PAYME' },
  { label: 'QR', value: 'QR' },
  { label: 'Click', value: 'CLICK' },
  { label: 'Терминал', value: 'TERMINAL' },
  { label: 'Перечисление', value: 'TRANSFER' },
  { label: 'Рассрочка', value: 'INSTALLMENT' },
  { label: 'Долг', value: 'DEBT' },
];

export default function WarehouseOverridePanel({
  deal,
  payments,
  products,
  onCancel,
  onSuccess,
}: WarehouseOverridePanelProps) {
  const [form] = Form.useForm();
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<OverrideItem[]>([]);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [deletePaymentReason, setDeletePaymentReason] = useState('');
  const queryClient = useQueryClient();
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!deal) return;
    setReason('');
    setDeletingPaymentId(null);
    setDeletePaymentReason('');

    form.setFieldsValue({
      createdAt: deal.createdAt ? dayjs(deal.createdAt) : undefined,
      paymentMethod: deal.paymentMethod || undefined,
    });

    setItems(
      (deal.items ?? []).map((i) => ({
        key: `wi-${nextKey++}`,
        id: i.id,
        productId: i.productId,
        requestedQty: i.requestedQty != null ? Number(i.requestedQty) : undefined,
        price: i.price != null ? Number(i.price) : undefined,
        dealDate: i.dealDate ? dayjs(i.dealDate) : undefined,
      })),
    );
  }, [deal, form]);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    (products ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['deal', deal.id] });
    queryClient.invalidateQueries({ queryKey: ['deals'] });
    queryClient.invalidateQueries({ queryKey: ['deal-logs', deal.id] });
    queryClient.invalidateQueries({ queryKey: ['deal-history', deal.id] });
    queryClient.invalidateQueries({ queryKey: ['deal-payments', deal.id] });
  };

  const overrideMut = useMutation({
    mutationFn: (data: Parameters<typeof dealsApi.warehouseOverrideDeal>[1]) =>
      dealsApi.warehouseOverrideDeal(deal.id, data),
    onSuccess: () => {
      message.success('Сделка обновлена (оверрайд склада)');
      invalidateAll();
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка оверрайда';
      message.error(msg);
    },
  });

  const deletePaymentMut = useMutation({
    mutationFn: ({ paymentId, reason: r }: { paymentId: string; reason: string }) =>
      dealsApi.warehouseDeletePayment(deal.id, paymentId, r),
    onSuccess: () => {
      message.success('Платёж удалён');
      setDeletingPaymentId(null);
      setDeletePaymentReason('');
      invalidateAll();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка удаления платежа';
      message.error(msg);
    },
  });

  function handleSubmit() {
    if (reason.trim().length < 3) {
      message.error('Укажите причину изменения (мин. 3 символа)');
      return;
    }

    form.validateFields().then((values) => {
      const data: Parameters<typeof dealsApi.warehouseOverrideDeal>[1] = { reason: reason.trim() };

      const formCreatedAt = values.createdAt ? values.createdAt.toISOString() : null;
      const dealCreatedAt = deal.createdAt ? dayjs(deal.createdAt).toISOString() : null;
      if (formCreatedAt !== dealCreatedAt) data.createdAt = formCreatedAt;

      const fPaymentMethod = values.paymentMethod;
      if ((fPaymentMethod || null) !== (deal.paymentMethod || null)) data.paymentMethod = fPaymentMethod || null;

      const hasItemChanges = items.length !== (deal.items?.length ?? 0) || items.some((item) => {
        const original = deal.items?.find((entry) => entry.id === item.id);
        if (!original) return true;
        return (
          item.productId !== original.productId
          || (item.requestedQty ?? null) !== (original.requestedQty != null ? Number(original.requestedQty) : null)
          || (item.price ?? null) !== (original.price != null ? Number(original.price) : null)
          || (item.dealDate ? item.dealDate.toISOString() : null) !== (original.dealDate ? dayjs(original.dealDate).toISOString() : null)
        );
      });

      if (hasItemChanges) {
        data.items = items
          .filter((i) => i.productId)
          .map((i) => ({
            id: i.id,
            productId: i.productId,
            requestedQty: i.requestedQty,
            price: i.price,
            dealDate: i.dealDate ? i.dealDate.toISOString() : null,
          }));
      }

      const hasChanges = data.createdAt !== undefined || data.paymentMethod !== undefined || !!data.items;
      if (!hasChanges) {
        message.error('Нет изменений для применения');
        return;
      }

      overrideMut.mutate(data);
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { key: `wi-${nextKey++}`, productId: '' }]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function updateItem(key: string, patch: Partial<OverrideItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  const itemsTotal = useMemo(() =>
    items.reduce((s, i) => s + (i.requestedQty || 0) * (i.price || 0), 0),
    [items]);

  const footerBottomPad = isMobile ? mobileMainContentBottomPadding() : 12;

  return (
    <>
      <Alert
        type="warning"
        showIcon
        message="Режим оверрайда (завсклад)"
        description="Изменения дат, сумм и количества товаров, способа оплаты и удаление платежей будут записаны в аудит с указанием причины."
        style={{ marginBottom: 16, padding: '10px 14px' }}
      />

      <div style={{ marginBottom: 20 }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>Причина изменения *</Typography.Text>
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Укажите причину оверрайда (обязательно, мин. 3 символа)..."
          status={reason.length > 0 && reason.length < 3 ? 'error' : undefined}
        />
      </div>

      <Form form={form} layout="vertical">
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 8 }}>
          <Form.Item name="createdAt" label="Дата создания сделки">
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="paymentMethod" label="Способ оплаты">
            <Select allowClear placeholder="Не указан" options={PAYMENT_METHOD_OPTIONS} />
          </Form.Item>
        </div>
      </Form>

      <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 12 }}>
        Товары ({items.length})
      </Typography.Title>
      <div style={{ width: '100%', overflowX: 'auto', marginBottom: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
              <th style={{ padding: productsCellPad, fontSize: 13, width: '32%', minWidth: 180 }}>Товар</th>
              <th style={{ padding: productsCellPad, fontSize: 13, width: 88 }}>Кол-во</th>
              <th style={{ padding: productsCellPad, fontSize: 13, width: 128 }}>Цена</th>
              <th style={{ padding: productsCellPad, fontSize: 13, width: 120 }}>Сумма</th>
              <th style={{ padding: productsCellPad, fontSize: 13, minWidth: 152 }}>Дата</th>
              <th style={{ padding: productsCellPad, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const lineTotal = (item.requestedQty || 0) * (item.price || 0);
              return (
                <tr key={item.key} style={{ borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                  <td style={{ padding: productsCellPad, verticalAlign: 'middle' }}>
                    <Select
                      showSearch
                      filterOption={smartFilterOption}
                      placeholder="Товар"
                      style={{ width: '100%', minWidth: 160 }}
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
                  <td style={{ padding: productsCellPad, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                    <InputNumber
                      min={0}
                      step={1}
                      styles={{ root: { width: 80, minWidth: 70, maxWidth: 90 }, input: { paddingInline: 8 } }}
                      value={item.requestedQty}
                      onChange={(v) => updateItem(item.key, { requestedQty: v ?? undefined })}
                    />
                  </td>
                  <td style={{ padding: productsCellPad, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                    <InputNumber
                      min={0}
                      styles={{ root: { width: 120, minWidth: 100, maxWidth: 140 }, input: { paddingInline: 8 } }}
                      formatter={moneyFormatter}
                      parser={(v) => moneyParser(v) as unknown as number}
                      value={item.price}
                      onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
                    />
                  </td>
                  <td style={{ padding: productsCellPad, whiteSpace: 'nowrap', verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' }}>
                    {lineTotal > 0 ? formatUZS(lineTotal) : '—'}
                  </td>
                  <td style={{ padding: productsCellPad, verticalAlign: 'middle' }}>
                    <DatePicker
                      showTime
                      style={{ width: '100%', minWidth: 148 }}
                      format="DD.MM.YYYY HH:mm"
                      value={item.dealDate}
                      onChange={(v) => updateItem(item.key, { dealDate: v ?? undefined })}
                    />
                  </td>
                  <td style={{ padding: productsCellPad, verticalAlign: 'middle' }}>
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeItem(item.key)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {itemsTotal > 0 && (
        <div style={{ textAlign: 'right', padding: '6px 2px 4px', borderTop: `1px solid ${tk.colorBorderSecondary}` }}>
          <Typography.Text strong>Итого: {formatUZS(itemsTotal)}</Typography.Text>
        </div>
      )}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addItem} style={{ marginTop: 8, marginBottom: 24 }}>
        Добавить товар
      </Button>

      <Typography.Title level={5} style={{ marginBottom: 12 }}>
        Платежи ({payments.length})
      </Typography.Title>
      <div style={{ display: 'grid', gap: 12, marginBottom: 88 }}>
        {payments.length === 0 ? (
          <Typography.Text type="secondary">Платежей по сделке нет.</Typography.Text>
        ) : payments.map((payment) => (
          <div key={payment.id} style={{ border: `1px solid ${tk.colorBorderSecondary}`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <Typography.Text strong>{formatUZS(Number(payment.amount))}</Typography.Text>
                {payment.method ? <Typography.Text type="secondary"> • {payment.method}</Typography.Text> : null}
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {dayjs(payment.paidAt).format('DD.MM.YYYY HH:mm')}
                </Typography.Text>
              </div>
              {deletingPaymentId !== payment.id && (
                <Button danger size="small" icon={<DeleteOutlined />} onClick={() => { setDeletingPaymentId(payment.id); setDeletePaymentReason(''); }}>
                  Удалить (с причиной)
                </Button>
              )}
            </div>
            {deletingPaymentId === payment.id && (
              <div style={{ marginTop: 10 }}>
                <Input.TextArea
                  rows={2}
                  value={deletePaymentReason}
                  onChange={(e) => setDeletePaymentReason(e.target.value)}
                  placeholder="Причина удаления платежа (обязательно, мин. 3 символа)..."
                  status={deletePaymentReason.length > 0 && deletePaymentReason.length < 3 ? 'error' : undefined}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => { setDeletingPaymentId(null); setDeletePaymentReason(''); }}>
                    Отмена
                  </Button>
                  <Popconfirm
                    title="Удалить платёж?"
                    description="Это действие будет записано в аудит."
                    onConfirm={() => {
                      if (deletePaymentReason.trim().length < 3) {
                        message.error('Укажите причину удаления (мин. 3 символа)');
                        return;
                      }
                      deletePaymentMut.mutate({ paymentId: payment.id, reason: deletePaymentReason.trim() });
                    }}
                  >
                    <Button danger type="primary" size="small" loading={deletePaymentMut.isPending}>
                      Подтвердить удаление
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'fixed',
          left: 'var(--app-sider-width, 0px)',
          right: 0,
          bottom: 0,
          zIndex: 90,
          padding: `12px clamp(16px, 3vw, 28px)`,
          paddingBottom: footerBottomPad,
          background: tk.colorBgContainer,
          borderTop: `1px solid ${tk.colorBorderSecondary}`,
          boxShadow: '0 -6px 16px rgba(0,0,0,0.06)',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 12,
          maxWidth: '100%',
        }}
      >
        <Button onClick={onCancel}>Отмена</Button>
        <Popconfirm
          title="Применить оверрайд?"
          description="Это действие будет записано в аудит."
          onConfirm={handleSubmit}
        >
          <Button type="primary" danger loading={overrideMut.isPending}>
            Применить оверрайд
          </Button>
        </Popconfirm>
      </div>
    </>
  );
}
