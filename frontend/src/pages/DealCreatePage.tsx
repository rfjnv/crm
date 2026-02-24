import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Typography, Space, Button, Select, Input, InputNumber,
  message, Descriptions,
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
  requestComment: string;
}

let nextKey = 0;
function makeKey() { return `ci-${nextKey++}`; }

export default function DealCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [clientId, setClientId] = useState<string>();
  const [title, setTitle] = useState('');
  const [commentText, setCommentText] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ key: makeKey(), requestComment: '' }]);

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

  async function handleSubmit() {
    if (!clientId) { message.error('Выберите клиента'); return; }
    const validItems = draftItems.filter((i) => i.productId);
    if (validItems.length === 0) { message.error('Добавьте хотя бы один товар'); return; }

    createMut.mutate({
      title: title || undefined,
      clientId,
      comment: commentText || undefined,
      items: validItems.map((i) => ({
        productId: i.productId!,
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
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Комментарий</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {draftItems.map((item) => {
                const p = item.productId ? productMap.get(item.productId) : null;
                return (
                  <tr key={item.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <Select showSearch optionFilterProp="label" placeholder="Выберите товар" style={{ width: '100%' }}
                        value={item.productId}
                        onChange={(v) => updateItem(item.key, { productId: v })}
                        options={(products ?? []).filter((pr: Product) => pr.isActive).map((pr: Product) => ({
                          label: `${pr.name} (${pr.sku}) — ${pr.stock} ${pr.unit}`,
                          value: pr.id,
                          disabled: usedProductIds.has(pr.id) && pr.id !== item.productId,
                        }))}
                      />
                      {p && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Ост: {p.stock} {p.unit}</div>}
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
        </Card>

        <Card title="Комментарий" bordered={false}>
          <Input.TextArea
            rows={3}
            placeholder="Комментарий к сделке (необязательно)..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
        </Card>
      </Space>
    </div>
  );
}
