import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Typography, Space, Button, Select, Input, InputNumber,
  message, Alert,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { inventoryApi } from '../api/warehouse.api';
import DealStatusTag from '../components/DealStatusTag';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { Product, DealStatus } from '../types';
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

/** Units that are discrete (integer-only) */
const INTEGER_UNITS = new Set(['шт', 'шт.', 'pcs', 'рулон', 'рул', 'упак', 'уп']);

function isIntegerUnit(unit?: string): boolean {
  if (!unit) return false;
  return INTEGER_UNITS.has(unit.toLowerCase());
}

/** Format qty: integers show without .0, decimals show up to 3 digits */
function formatQty(value: number | string | null | undefined): string {
  if (value == null) return '—';
  const n = Number(value);
  if (isNaN(n)) return '—';
  if (Number.isInteger(n)) return n.toString();
  return parseFloat(n.toFixed(3)).toString();
}

const DRAFT_STORAGE_KEY = 'deal_create_draft';

interface DraftData {
  clientId?: string;
  title: string;
  commentText: string;
  items: Omit<DraftItem, 'key'>[];
  savedAt: number;
}

function saveDraft(data: DraftData) {
  try { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data)); } catch { /* quota exceeded — ignore */ }
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch { return null; }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}

function isDraftEmpty(d: DraftData): boolean {
  if (d.clientId) return false;
  if (d.title) return false;
  if (d.commentText) return false;
  if (d.items.some((i) => i.productId || i.requestedQty || i.price || i.requestComment)) return false;
  return true;
}

export default function DealCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();

  const [clientId, setClientId] = useState<string>();
  const [title, setTitle] = useState('');
  const [commentText, setCommentText] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([{ key: makeKey(), requestComment: '' }]);
  const [draftBanner, setDraftBanner] = useState<DraftData | null>(null);

  // On mount: check for existing draft
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const saved = loadDraft();
    if (saved && !isDraftEmpty(saved)) {
      setDraftBanner(saved);
    }
  }, []);

  const restoreDraft = useCallback((draft: DraftData) => {
    setClientId(draft.clientId);
    setTitle(draft.title);
    setCommentText(draft.commentText);
    setDraftItems(
      draft.items.length > 0
        ? draft.items.map((i) => ({ ...i, key: makeKey() }))
        : [{ key: makeKey(), requestComment: '' }],
    );
    setDraftBanner(null);
    message.success('Черновик восстановлен');
  }, []);

  const discardDraft = useCallback(() => {
    clearDraft();
    setDraftBanner(null);
    message.info('Черновик удалён');
  }, []);

  // Auto-save draft on every field change (skip during banner display)
  const skipSaveRef = useRef(false);
  useEffect(() => {
    if (draftBanner) return; // don't overwrite while banner is shown
    if (skipSaveRef.current) { skipSaveRef.current = false; return; }
    const data: DraftData = {
      clientId,
      title,
      commentText,
      items: draftItems.map(({ key: _key, ...rest }) => rest),
      savedAt: Date.now(),
    };
    if (isDraftEmpty(data)) {
      clearDraft();
    } else {
      saveDraft(data);
    }
  }, [clientId, title, commentText, draftItems, draftBanner]);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: inventoryApi.listProducts });

  const createMut = useMutation({
    mutationFn: (data: Parameters<typeof dealsApi.create>[0]) => dealsApi.create(data),
    onSuccess: (result) => {
      clearDraft();
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

  // Compute total amount from items
  const totalAmount = useMemo(() => {
    return draftItems.reduce((sum, item) => {
      if (item.requestedQty && item.price) {
        return sum + item.requestedQty * item.price;
      }
      return sum;
    }, 0);
  }, [draftItems]);

  // Smart status preview: all items with qty → IN_PROGRESS, otherwise → WAITING_STOCK_CONFIRMATION
  const previewStatus: DealStatus = useMemo(() => {
    const validItems = draftItems.filter((i) => i.productId);
    if (validItems.length === 0) return 'WAITING_STOCK_CONFIRMATION';
    const allHaveQty = validItems.every((i) => i.requestedQty && i.requestedQty > 0);
    return allHaveQty ? 'IN_PROGRESS' : 'WAITING_STOCK_CONFIRMATION';
  }, [draftItems]);

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

  /** When product is selected, auto-fill price from salePrice */
  function handleProductChange(key: string, productId: string) {
    const product = productMap.get(productId);
    const autoPrice = product?.salePrice ? Number(product.salePrice) : undefined;
    updateItem(key, { productId, price: autoPrice || undefined });
  }

  async function handleSubmit() {
    if (!clientId) { message.error('Выберите клиента'); return; }
    const validItems = draftItems.filter((i) => i.productId);
    if (validItems.length === 0) { message.error('Добавьте хотя бы один товар'); return; }

    // Validation: if qty is set, price must also be set
    for (const item of validItems) {
      if (item.requestedQty && item.requestedQty > 0 && (!item.price || item.price <= 0)) {
        const p = productMap.get(item.productId!);
        message.error(`Укажите цену для "${p?.name || 'товар'}"`);
        return;
      }
    }

    createMut.mutate({
      title: title || undefined,
      clientId,
      comment: commentText || undefined,
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

      {draftBanner && (
        <Alert
          type="info"
          showIcon
          message="Найден незавершённый черновик сделки"
          description={`Сохранён ${dayjs(draftBanner.savedAt).format('DD.MM.YYYY HH:mm')}`}
          action={
            <Space>
              <Button size="small" type="primary" onClick={() => restoreDraft(draftBanner)}>Восстановить</Button>
              <Button size="small" danger onClick={discardDraft}>Удалить</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="Основное" bordered={false}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Клиент *</Typography.Text>
              <Select showSearch placeholder="Выберите клиента" optionFilterProp="label" style={{ width: '100%' }}
                value={clientId} onChange={setClientId}
                options={(clients ?? []).map((c) => ({ label: `${c.companyName}${c.manager ? ` (${c.manager.fullName})` : ''}`, value: c.id }))}
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
              <DealStatusTag status={previewStatus} />
            </div>
          </div>
        </Card>

        <Card
          title={`Товары (${draftItems.filter((i) => i.productId).length})`}
          extra={totalAmount > 0 ? <Typography.Text strong>Итого: {formatUZS(totalAmount)}</Typography.Text> : null}
          bordered={false}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Товар</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13, width: 100 }}>Кол-во</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13, width: 150 }}>Цена (UZS)</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13, width: 130 }}>Сумма</th>
                <th style={{ padding: '6px 8px', fontWeight: 500, fontSize: 13 }}>Коммент</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {draftItems.map((item) => {
                const p = item.productId ? productMap.get(item.productId) : null;
                const lineTotal = (item.requestedQty && item.price) ? item.requestedQty * item.price : 0;
                const intUnit = isIntegerUnit(p?.unit);
                return (
                  <tr key={item.key} style={{ borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                    <td style={{ padding: '6px 8px' }}>
                      <Select showSearch optionFilterProp="label" placeholder="Выберите товар" style={{ width: '100%' }}
                        value={item.productId}
                        onChange={(v) => handleProductChange(item.key, v)}
                        options={(products ?? []).filter((pr: Product) => pr.isActive).map((pr: Product) => ({
                          label: `${pr.name} (${pr.sku}) — ${pr.stock} ${pr.unit}`,
                          value: pr.id,
                          disabled: usedProductIds.has(pr.id) && pr.id !== item.productId,
                        }))}
                      />
                      {p && <div style={{ fontSize: 11, color: tk.colorTextSecondary, marginTop: 2 }}>Ост: {formatQty(p.stock)} {p.unit}</div>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <InputNumber
                        min={intUnit ? 1 : 0.001}
                        step={intUnit ? 1 : 0.1}
                        precision={intUnit ? 0 : 3}
                        placeholder="Кол-во"
                        style={{ width: '100%' }}
                        value={item.requestedQty}
                        onChange={(v) => updateItem(item.key, { requestedQty: v ?? undefined })}
                        parser={(v) => {
                          const s = (v || '').replace(',', '.');
                          return Number(s) as unknown as 0;
                        }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <InputNumber min={0} placeholder="Цена" style={{ width: '100%' }}
                        formatter={moneyFormatter} parser={(v) => moneyParser(v) as unknown as number}
                        value={item.price}
                        onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <Typography.Text style={{ whiteSpace: 'nowrap' }}>
                        {lineTotal > 0 ? formatUZS(lineTotal) : '—'}
                      </Typography.Text>
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
            {totalAmount > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${tk.colorBorderSecondary}` }}>
                  <td colSpan={3} style={{ padding: '8px', textAlign: 'right' }}>
                    <Typography.Text strong>Итого:</Typography.Text>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <Typography.Text strong>{formatUZS(totalAmount)}</Typography.Text>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
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
