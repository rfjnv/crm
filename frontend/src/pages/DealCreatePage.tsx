import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Typography, Space, Button, Select, Input,
  Segmented, DatePicker, message, Descriptions,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { contractsApi } from '../api/contracts.api';
import { inventoryApi } from '../api/warehouse.api';
import DealStatusTag from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import type { Product } from '../types';
import dayjs from 'dayjs';

// ──── Draft item type ────

interface DraftItem {
  key: string;
  productId?: string;
  requestComment: string;
}

let nextKey = 0;
function makeKey() { return `ci-${nextKey++}`; }

// ──── Page ────

export default function DealCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // ── Basic info ──
  const [clientId, setClientId] = useState<string>();
  const [title, setTitle] = useState('');

  // ── Contract ──
  const [contractMode, setContractMode] = useState<'none' | 'existing' | 'new'>('none');
  const [contractId, setContractId] = useState<string>();
  const [newContract, setNewContract] = useState({
    number: '',
    startDate: dayjs(),
    endDate: null as dayjs.Dayjs | null,
    notes: '',
  });

  // ── Items ──
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ key: makeKey(), requestComment: '' }]);

  // ── Queries ──
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const { data: contracts } = useQuery({
    queryKey: ['contracts', clientId],
    queryFn: () => contractsApi.list(clientId),
    enabled: !!clientId,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  // Reset contract when client changes
  useEffect(() => {
    setContractId(undefined);
    if (contractMode === 'existing') setContractMode('none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // ── Mutations ──
  const contractMut = useMutation({
    mutationFn: (data: Parameters<typeof contractsApi.create>[0]) => contractsApi.create(data),
  });

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

  // ── Item helpers ──
  const usedProductIds = useMemo(
    () => new Set(draftItems.filter((i) => i.productId).map((i) => i.productId!)),
    [draftItems],
  );

  function addItemRow() {
    setDraftItems((prev) => [...prev, { key: makeKey(), requestComment: '' }]);
  }

  function removeItemRow(key: string) {
    setDraftItems((prev) => {
      const next = prev.filter((i) => i.key !== key);
      return next.length === 0 ? [{ key: makeKey(), requestComment: '' }] : next;
    });
  }

  // ── Submit ──
  async function handleSubmit() {
    if (!clientId) { message.error('Выберите клиента'); return; }
    const validItems = draftItems.filter((i) => i.productId);
    if (validItems.length === 0) { message.error('Добавьте хотя бы один товар'); return; }

    let resolvedContractId = contractMode === 'existing' ? contractId : undefined;

    // Create contract first if needed
    if (contractMode === 'new') {
      if (!newContract.number.trim()) { message.error('Укажите номер договора'); return; }
      try {
        const created = await contractMut.mutateAsync({
          clientId: clientId!,
          contractNumber: newContract.number.trim(),
          startDate: newContract.startDate.format('YYYY-MM-DD'),
          endDate: newContract.endDate ? newContract.endDate.format('YYYY-MM-DD') : undefined,
          notes: newContract.notes || undefined,
        });
        resolvedContractId = created.id;
      } catch {
        message.error('Ошибка создания договора');
        return;
      }
    }

    createMut.mutate({
      title: title || undefined,
      clientId,
      contractId: resolvedContractId,
      items: validItems.map((i) => ({
        productId: i.productId!,
        requestComment: i.requestComment || undefined,
      })),
    });
  }

  const isSaving = contractMut.isPending || createMut.isPending;

  // ──── Render ────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Новая сделка</Typography.Title>
        <Space>
          <Button onClick={() => navigate('/deals')}>Отмена</Button>
          <Button type="primary" loading={isSaving} onClick={handleSubmit}>Сохранить сделку</Button>
        </Space>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>

        {/* ── Card 1: Основное ── */}
        <Card title="Основное" bordered={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Клиент *</Typography.Text>
              <Select
                showSearch
                placeholder="Выберите клиента"
                optionFilterProp="label"
                style={{ width: '100%' }}
                value={clientId}
                onChange={setClientId}
                options={(clients ?? []).map((c) => ({ label: c.companyName, value: c.id }))}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Название</Typography.Text>
              <Input
                placeholder={`Авто: Сделка от ${dayjs().format('DD.MM.YYYY')}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Менеджер</Typography.Text>
              <Typography.Text>{user?.fullName}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Дата</Typography.Text>
              <Typography.Text>{dayjs().format('DD.MM.YYYY')}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Статус</Typography.Text>
              <DealStatusTag status="NEW" />
            </div>
          </div>
        </Card>

        {/* ── Card 2: Договор ── */}
        <Card title="Договор" bordered={false}>
          <Segmented
            value={contractMode}
            onChange={(v) => { setContractMode(v as 'none' | 'existing' | 'new'); setContractId(undefined); }}
            options={[
              { label: 'Без договора', value: 'none' },
              { label: 'Выбрать', value: 'existing' },
              { label: 'Создать новый', value: 'new' },
            ]}
            style={{ marginBottom: 16 }}
          />

          {contractMode === 'existing' && (
            <Select
              allowClear
              placeholder="Выберите договор"
              style={{ width: '100%', maxWidth: 400 }}
              disabled={!clientId}
              value={contractId}
              onChange={setContractId}
              options={(contracts ?? []).map((c) => ({ label: c.contractNumber, value: c.id }))}
            />
          )}

          {contractMode === 'new' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 600 }}>
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Номер договора *</Typography.Text>
                <Input
                  value={newContract.number}
                  onChange={(e) => setNewContract((p) => ({ ...p, number: e.target.value }))}
                />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Дата начала</Typography.Text>
                <DatePicker
                  style={{ width: '100%' }}
                  format="DD.MM.YYYY"
                  value={newContract.startDate}
                  onChange={(d) => setNewContract((p) => ({ ...p, startDate: d || dayjs() }))}
                />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Дата окончания</Typography.Text>
                <DatePicker
                  style={{ width: '100%' }}
                  format="DD.MM.YYYY"
                  value={newContract.endDate}
                  onChange={(d) => setNewContract((p) => ({ ...p, endDate: d }))}
                />
              </div>
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Примечание</Typography.Text>
                <Input
                  value={newContract.notes}
                  onChange={(e) => setNewContract((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
          )}
        </Card>

        {/* ── Card 3: Товары (only product + comment) ── */}
        <Card title={`Товары (${draftItems.filter((i) => i.productId).length})`} bordered={false}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Выберите товары и укажите комментарий для склада. Количество и цены указываются после ответа склада.
          </Typography.Text>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Товар</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Комментарий / запрос</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {draftItems.map((item) => (
                <tr key={item.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '6px 8px', width: '45%' }}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="Выберите товар"
                      style={{ width: '100%' }}
                      value={item.productId}
                      onChange={(v) => setDraftItems((prev) => prev.map((i) => i.key === item.key ? { ...i, productId: v } : i))}
                      options={(products ?? []).filter((p: Product) => p.isActive).map((p: Product) => ({
                        label: `${p.name} (${p.sku}) — ${p.stock} ${p.unit}`,
                        value: p.id,
                        disabled: usedProductIds.has(p.id) && p.id !== item.productId,
                      }))}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <Input.TextArea
                      rows={1}
                      placeholder="Например: нужно 50 тонн, уточнить наличие"
                      value={item.requestComment}
                      onChange={(e) => setDraftItems((prev) => prev.map((i) => i.key === item.key ? { ...i, requestComment: e.target.value } : i))}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeItemRow(item.key)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={addItemRow}>
            Добавить позицию
          </Button>
        </Card>

        {/* ── Card 4: Комментарии ── */}
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
