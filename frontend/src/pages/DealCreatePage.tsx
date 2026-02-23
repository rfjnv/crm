import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Typography, Space, Button, Select, Input, InputNumber,
  DatePicker, message, Descriptions,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { inventoryApi } from '../api/warehouse.api';
import DealStatusTag from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import type { Product } from '../types';
import dayjs from 'dayjs';

interface DraftItem {
  key: string;
  productId?: string;
  requestedQty?: number;
  price?: number;
  requestComment: string;
}

let nextKey = 0;
function makeKey() { return `ci-${nextKey++}`; }

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function DealCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [clientId, setClientId] = useState<string>();
  const [title, setTitle] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ key: makeKey(), requestComment: '' }]);
  const [paymentType, setPaymentType] = useState<'FULL' | 'PARTIAL' | 'INSTALLMENT'>('FULL');
  const [discount, setDiscount] = useState<number>(0);
  const [dueDate, setDueDate] = useState<dayjs.Dayjs | null>(null);
  const [terms, setTerms] = useState('');

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: inventoryApi.listProducts });

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof dealsApi.create>[0]) => dealsApi.create(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      message.success('Сделка создана');
      navigate(`/deals/${result.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка создания сделки';
      message.error(msg);
    },
  });

  const usedProductIds = useMemo(
    () => new Set(draftItems.filter((i) => i.productId).map((i) => i.productId!)),
    [draftItems],
  );

  const subtotal = useMemo(
    () => draftItems.reduce((s, i) => s + (i.requestedQty ?? 0) * (i.price ?? 0), 0),
    [draftItems],
  );
  const finalAmount = Math.max(0, subtotal - discount);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    (products ?? []).forEach((p: Product) => m.set(p.id, p));
    return m;
  }, [products]);

  function addItemRow() {
    setDraftItems((prev) => [...prev, { key: makeKey(), requestComment: '' }]);
  }

  function removeItemRow(key: string) {
    setDraftItems((prev) => {
      const next = prev.filter((i) => i.key !== key);
      return next.length === 0 ? [{ key: makeKey(), requestComment: '' }] : next;
    });
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setDraftItems((prev) => prev.map((i) => i.key === key ? { ...i, ...patch } : i));
  }

  function handleProductSelect(key: string, productId: string) {
    const p = productMap.get(productId);
    updateItem(key, {
      productId,
      price: p?.salePrice ? Number(p.salePrice) : undefined,
    });
  }

  async function handleSubmit() {
    if (!clientId) { message.error('Выберите клиента'); return; }
    const validItems = draftItems.filter((i) => i.productId);
    if (validItems.length === 0) { message.error('Добавьте хотя бы один товар'); return; }

    createMut.mutate({
      title: title || undefined,
      clientId,
      paymentType,
      discount: discount || undefined,
      dueDate: dueDate ? dueDate.format('YYYY-MM-DD') : undefined,
      terms: terms || undefined,
      items: validItems.map((i) => ({
        productId: i.productId!,
        requestedQty: i.requestedQty || undefined,
        price: i.price || undefined,
        requestComment: i.requestComment || undefined,
      })),
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Новая сделка</Typography.Title>
        <Space>
          <Button onClick={() => navigate('/deals')}>Отмена</Button>
          <Button type="primary" loading={createMut.isPending} onClick={handleSubmit}>Сохранить сделку</Button>
        </Space>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="Основное" bordered={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Клиент *</Typography.Text>
              <Select showSearch placeholder="Выберите клиента" optionFilterProp="label" style={{ width: '100%' }}
                value={clientId} onChange={setClientId}
                options={(clients ?? []).map((c) => ({ label: c.companyName, value: c.id }))}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Название</Typography.Text>
              <Input placeholder={`Авто: Сделка от ${dayjs().format('DD.MM.YYYY')}`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Менеджер</Typography.Text>
              <Typography.Text>{user?.fullName}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Статус</Typography.Text>
              <DealStatusTag status="NEW" />
            </div>
          </div>
        </Card>

        <Card title={`Товары (${draftItems.filter((i) => i.productId).length})`} bordered={false}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Товар</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13, width: 100 }}>Кол-во</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13, width: 140 }}>Цена</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13, width: 130 }}>Сумма</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Комментарий</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {draftItems.map((item) => {
                const p = item.productId ? productMap.get(item.productId) : null;
                const lineTotal = (item.requestedQty ?? 0) * (item.price ?? 0);
                return (
                  <tr key={item.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <Select showSearch optionFilterProp="label" placeholder="Выберите товар" style={{ width: '100%' }}
                        value={item.productId}
                        onChange={(v) => handleProductSelect(item.key, v)}
                        options={(products ?? []).filter((pr: Product) => pr.isActive).map((pr: Product) => ({
                          label: `${pr.name} (${pr.sku}) — ${pr.stock} ${pr.unit}`,
                          value: pr.id,
                          disabled: usedProductIds.has(pr.id) && pr.id !== item.productId,
                        }))}
                      />
                      {p && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Ост: {p.stock} {p.unit}</div>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <InputNumber min={1} style={{ width: '100%' }} placeholder="Кол"
                        value={item.requestedQty} onChange={(v) => updateItem(item.key, { requestedQty: v ?? undefined })}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <InputNumber min={0} style={{ width: '100%' }} placeholder="Цена"
                        value={item.price} onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', fontWeight: 500 }}>
                      {lineTotal > 0 ? fmt(lineTotal) : '—'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <Input placeholder="Коммент" value={item.requestComment}
                        onChange={(e) => updateItem(item.key, { requestComment: e.target.value })}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeItemRow(item.key)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={addItemRow}>
            Добавить позицию
          </Button>

          {subtotal > 0 && (
            <div style={{ marginTop: 16, textAlign: 'right', fontSize: 14 }}>
              <div>Подитог: <strong>{fmt(subtotal)}</strong> so'm</div>
              {discount > 0 && <div>Скидка: <strong>-{fmt(discount)}</strong> so'm</div>}
              <div style={{ fontSize: 18, marginTop: 4 }}>Итого: <strong>{fmt(finalAmount)}</strong> so'm</div>
            </div>
          )}
        </Card>

        <Card title="Оплата и условия" bordered={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Тип оплаты</Typography.Text>
              <Select style={{ width: '100%' }} value={paymentType} onChange={setPaymentType}
                options={[
                  { label: 'Полная оплата', value: 'FULL' },
                  { label: 'Частичная оплата', value: 'PARTIAL' },
                  { label: 'Рассрочка', value: 'INSTALLMENT' },
                ]}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Скидка</Typography.Text>
              <InputNumber min={0} style={{ width: '100%' }} value={discount} onChange={(v) => setDiscount(v ?? 0)} />
            </div>
            {(paymentType === 'PARTIAL' || paymentType === 'INSTALLMENT') && (
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Срок оплаты</Typography.Text>
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" value={dueDate} onChange={setDueDate} />
              </div>
            )}
          </div>
          {(paymentType === 'PARTIAL' || paymentType === 'INSTALLMENT') && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Условия</Typography.Text>
              <Input.TextArea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Условия оплаты..." />
            </div>
          )}
        </Card>

        <Card title="Комментарии" bordered={false}>
          <Descriptions>
            <Descriptions.Item>
              <Typography.Text type="secondary">Комментарии будут доступны после сохранения сделки</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Space>
    </div>
  );
}
