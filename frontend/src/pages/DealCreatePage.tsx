import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Typography, Space, Button, Select, Input, InputNumber,
  message, Alert, Checkbox, Radio, DatePicker, Switch, Tag,
} from 'antd';
import type { Dayjs } from 'dayjs';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { inventoryApi } from '../api/warehouse.api';
import DealStatusTag from '../components/DealStatusTag';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { getFirstName } from '../lib/name-utils';
import { smartFilterOption, matchesSearch, buildClientSearchHaystack } from '../utils/translit';
import type { Product, DealStatus, PaymentMethod } from '../types';
import dayjs from 'dayjs';
import './DealCreatePage.css';

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
const INTEGER_UNITS = new Set(['шт', 'шт.', 'pcs', 'рулон', 'рул', 'упак', 'уп', 'бабина']);

/** Ламинационная пленка продаётся по весу (кг), но клиенты заказывают её рулонами —
 * менеджер вводит оба числа: вес в кг (обычное поле «Кол-во») и количество рулонов рядом. */
const LAMINATION_CATEGORY = 'Ламинационная пленка';
/** Для этого товара нужен выбор микрона кнопкой, а не свободный текст — чтобы не путали загрузчики. */
const SPRAY_POWDER_NAME = 'Противоотмарывающий порошок Spray Powder';
const MICRON_OPTIONS = ['15мкр', '25мкр'];

function parseRollCount(comment: string): number | undefined {
  const m = (comment || '').match(/^(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Остаток товара для отображения: кг + рулоны рядом, если второй счётчик отслеживается. */
function stockLabel(p: Pick<Product, 'stock' | 'unit' | 'rollStock'>): string {
  const base = `${formatQty(p.stock)} ${p.unit}`;
  return p.rollStock != null ? `${base} / ${formatQty(p.rollStock)} рул.` : base;
}

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

const DEFAULT_TRANSFER_DOCUMENTS = ['Договор'];

interface DraftData {
  clientId?: string;
  title: string;
  commentText: string;
  isSessionDeal?: boolean;
  items: Omit<DraftItem, 'key'>[];
  paymentMethod?: PaymentMethod;
  /** единое поле деталей по оплате (номер операции, комментарий) */
  paymentNote?: string;
  /** миграция со старых черновиков */
  cashNote?: string;
  clickTransactionId?: string;
  transferInn?: string;
  transferDocuments?: string[];
  transferType?: 'ONE_TIME' | 'ANNUAL';
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
  if (d.paymentNote?.trim()) return false;
  if (d.cashNote?.trim()) return false;
  if (d.clickTransactionId?.trim()) return false;
  if (d.transferInn?.trim()) return false;
  // only treat documents as "filled" if they differ from the default ['Договор']
  if (d.transferDocuments && (
    d.transferDocuments.length !== DEFAULT_TRANSFER_DOCUMENTS.length ||
    d.transferDocuments.some((doc) => !DEFAULT_TRANSFER_DOCUMENTS.includes(doc))
  )) return false;
  if (d.isSessionDeal) return false;
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
  const [draftBanner, setDraftBanner] = useState<DraftData | null>(() => {
    const saved = loadDraft();
    return saved && !isDraftEmpty(saved) ? saved : null;
  });
  const [deliveryType, setDeliveryType] = useState<'SELF_PICKUP' | 'YANDEX' | 'DELIVERY'>('SELF_PICKUP');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [deliveryComment, setDeliveryComment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentNote, setPaymentNote] = useState('');
  const [transferInn, setTransferInn] = useState('');
  const [transferDocuments, setTransferDocuments] = useState<string[]>(() => [...DEFAULT_TRANSFER_DOCUMENTS]);
  const [transferType, setTransferType] = useState<'ONE_TIME' | 'ANNUAL'>('ONE_TIME');
  const [isSessionDeal, setIsSessionDeal] = useState(false);
  const [isDebt, setIsDebt] = useState(false);
  const [debtPaymentType, setDebtPaymentType] = useState<'PARTIAL' | 'INSTALLMENT'>('PARTIAL');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);

  const restoreDraft = useCallback((draft: DraftData) => {
    setClientId(draft.clientId);
    setTitle(draft.title);
    setCommentText(draft.commentText);
    if (draft.paymentMethod) setPaymentMethod(draft.paymentMethod);
    setPaymentNote(
      draft.paymentNote?.trim()
        || [draft.cashNote, draft.clickTransactionId].filter((x) => x?.trim()).join(' ').trim()
        || '',
    );
    setTransferInn(draft.transferInn ?? '');
    setTransferDocuments(draft.transferDocuments?.length ? [...draft.transferDocuments] : [...DEFAULT_TRANSFER_DOCUMENTS]);
    setTransferType(draft.transferType ?? 'ONE_TIME');
    setIsSessionDeal(!!draft.isSessionDeal);
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
      paymentMethod,
      paymentNote,
      transferInn,
      transferDocuments,
      transferType,
      isSessionDeal: isSessionDeal || undefined,
      savedAt: Date.now(),
    };
    if (isDraftEmpty(data)) {
      clearDraft();
    } else {
      saveDraft(data);
    }
  }, [clientId, title, commentText, draftItems, draftBanner, paymentMethod, paymentNote, transferInn, transferDocuments, transferType, isSessionDeal]);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: inventoryApi.listProducts });

  const { data: clientTransferInns } = useQuery({
    queryKey: ['client-transfer-inns', clientId],
    queryFn: () => clientsApi.getTransferInns(clientId!),
    enabled: !!clientId && paymentMethod === 'TRANSFER',
  });

  const selectedClient = useMemo(() => clients?.find((c) => c.id === clientId), [clients, clientId]);
  const selectedClientInn = (selectedClient?.inn || '').trim();

  // Auto-fill transfer INN from client requisites, falling back to the client's most
  // recently used INN when requisites are empty. Only touches the field while it still
  // holds our own previous auto-fill (or is empty) — never overwrites a manual edit or a
  // restored draft value.
  const autoFilledInnRef = useRef<string | null>(null);
  useEffect(() => {
    if (paymentMethod !== 'TRANSFER') return;
    if (transferInn.trim() && transferInn !== autoFilledInnRef.current) return;
    const history = clientTransferInns || [];
    const next = selectedClientInn || (history.length > 0 ? history[0] : '');
    autoFilledInnRef.current = next || null;
    if (next !== transferInn) setTransferInn(next);
  }, [paymentMethod, clientId, selectedClientInn, clientTransferInns]);

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

  const previewStatus: DealStatus = useMemo(() => {
    const validItems = draftItems.filter((i) => i.productId);
    if (validItems.length === 0) return 'WAITING_STOCK_CONFIRMATION';
    const allHaveQty = validItems.every((i) => i.requestedQty && i.requestedQty > 0);
    if (!allHaveQty) return 'WAITING_STOCK_CONFIRMATION';
    if (paymentMethod) {
      if (paymentMethod !== 'TRANSFER' && paymentMethod !== 'INSTALLMENT' && paymentMethod !== 'DEBT') {
        return 'WAITING_WAREHOUSE_MANAGER';
      }
      if (paymentMethod === 'TRANSFER' && transferInn.trim()) {
        return 'WAITING_FINANCE';
      }
    }
    return 'IN_PROGRESS';
  }, [draftItems, paymentMethod, transferInn]);

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
    updateItem(key, { productId, price: autoPrice || undefined, requestComment: '' });
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

    // Ламинация: кол-во рулонов обязательно, без него позицию не создать.
    for (const item of validItems) {
      const p = productMap.get(item.productId!);
      if (p?.category === LAMINATION_CATEGORY) {
        const rollCount = parseRollCount(item.requestComment);
        if (!rollCount || rollCount <= 0) {
          message.error(`Укажите кол-во рулонов для "${p.name}"`);
          return;
        }
      }
    }

    if (paymentMethod === 'TRANSFER' && transferInn.trim()) {
      if (transferDocuments.length === 0) {
        message.error('Выберите минимум один документ для перечисления');
        return;
      }
    }

    createMut.mutate({
      title: title || undefined,
      clientId,
      comment: commentText || undefined,
      ...(isSessionDeal ? { isSessionDeal: true } : {}),
      ...(isDebt ? { paymentType: debtPaymentType, ...(dueDate ? { dueDate: dueDate.format('YYYY-MM-DD') } : {}) } : {}),
      deliveryType,
      ...(deliveryType !== 'DELIVERY' ? {
        vehicleNumber: vehicleNumber.trim() || undefined,
        vehicleType: vehicleType.trim() || undefined,
        deliveryComment: deliveryComment.trim() || undefined,
      } : {}),
      items: validItems.map((i) => ({
        productId: i.productId!,
        requestedQty: i.requestedQty || undefined,
        price: i.price || undefined,
        requestComment: i.requestComment || undefined,
      })),
      paymentMethod,
      ...(paymentNote.trim() ? { paymentNote: paymentNote.trim() } : {}),
      ...(paymentMethod === 'TRANSFER' && transferInn.trim()
        ? { transferInn: transferInn.trim(), transferDocuments, transferType }
        : {}),
    });
  }

  function qtyInputProps(item: DraftItem, intUnit: boolean) {
    return {
      min: intUnit ? 1 : 0.001,
      step: intUnit ? 1 : 0.1,
      precision: intUnit ? 0 : 3,
      placeholder: 'Кол-во',
      style: { width: '100%' as const },
      value: item.requestedQty,
      onChange: (v: number | null) => updateItem(item.key, { requestedQty: v ?? undefined }),
      parser: (v: string | undefined) => {
        const s = (v || '').replace(',', '.');
        return Number(s) as unknown as 0;
      },
    };
  }

  /** Первая (главная) ячейка позиции — сразу после товара:
   * ламинация → рулоны и кг рядом в один компактный ряд (порядок фиксирован: сначала рулоны,
   * потом кг), Spray Powder → выбор микрона + кол-во(кг) тут же рядом; всё остальное → обычное кол-во. */
  function renderPrimaryControl(item: DraftItem, p: Product | null | undefined, intUnit: boolean) {
    if (p?.category === LAMINATION_CATEGORY) {
      return (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', width: '100%', fontSize: 10, lineHeight: '12px', color: tk.colorTextSecondary, marginBottom: 2 }}>
            <span style={{ width: '50%' }}>Рулоны *</span>
            <span style={{ width: '50%' }}>Кг</span>
          </div>
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <InputNumber
              min={1}
              step={1}
              precision={0}
              placeholder="Рул."
              style={{ width: '50%' }}
              value={parseRollCount(item.requestComment)}
              onChange={(v) => updateItem(item.key, { requestComment: v ? `${v} рул.` : '' })}
            />
            <InputNumber {...qtyInputProps(item, intUnit)} placeholder="Кг" style={{ width: '50%' }} />
          </div>
        </div>
      );
    }
    if (p?.name === SPRAY_POWDER_NAME) {
      return (
        <Space
          direction="vertical"
          size={6}
          style={{
            width: '100%',
            padding: 6,
            borderRadius: 8,
            border: `1px dashed ${tk.colorBorder}`,
            background: tk.colorFillQuaternary,
          }}
        >
          <Radio.Group
            size="large"
            value={item.requestComment || undefined}
            onChange={(e) => updateItem(item.key, { requestComment: e.target.value })}
            optionType="button"
            buttonStyle="solid"
            style={{ display: 'flex' }}
            options={MICRON_OPTIONS.map((m) => ({ label: m, value: m }))}
          />
          <InputNumber {...qtyInputProps(item, intUnit)} placeholder="Кол-во (кг)" />
        </Space>
      );
    }
    return <InputNumber {...qtyInputProps(item, intUnit)} />;
  }

  function primaryControlLabel(p: Product | null | undefined) {
    if (p?.category === LAMINATION_CATEGORY) return '';
    if (p?.name === SPRAY_POWDER_NAME) return 'Микрон / Кол-во (кг)';
    return 'Кол-во';
  }

  /** Цветной бейдж типа товара рядом с выбором — чтобы особая строка (ламинация/тальк) была
   * видна с первого взгляда, не читая все ячейки ряда. */
  function productTypeBadge(p: Product | null | undefined) {
    if (p?.category === LAMINATION_CATEGORY) return <Tag color="blue" style={{ marginInlineEnd: 0 }}>плёнка · рулоны</Tag>;
    if (p?.name === SPRAY_POWDER_NAME) return <Tag color="gold" style={{ marginInlineEnd: 0 }}>микрон</Tag>;
    return null;
  }

  /** Вторая (доп.) ячейка позиции — в конце строки:
   * ламинация → ничего (рулоны и кг уже введены слева, в первой ячейке);
   * Spray Powder → ничего (микрон и кг уже введены слева, доп. коммент не нужен);
   * всё остальное → обычный необязательный комментарий к позиции. */
  function renderSecondaryControl(item: DraftItem, p: Product | null | undefined) {
    if (p?.category === LAMINATION_CATEGORY) {
      return null;
    }
    if (p?.name === SPRAY_POWDER_NAME) {
      return null;
    }
    return (
      <Input
        placeholder="Коммент"
        value={item.requestComment}
        onChange={(e) => updateItem(item.key, { requestComment: e.target.value })}
      />
    );
  }

  const renderItemMobileCard = (item: DraftItem) => {
    const p = item.productId ? productMap.get(item.productId) : null;
    const lineTotal = (item.requestedQty && item.price) ? item.requestedQty * item.price : 0;
    const intUnit = isIntegerUnit(p?.unit);

    return (
      <Card key={item.key} size="small" className="deal-create-item-card">
        <div className="deal-create-item-card__top">
          <Typography.Text strong>
            {p?.name || 'Позиция'}
          </Typography.Text>
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => removeItemRow(item.key)}
            className="deal-create-item-card__remove"
          />
        </div>

        <div>
          <Typography.Text type="secondary" className="deal-create-field-label">Товар</Typography.Text>
          <Select
            showSearch
            filterOption={smartFilterOption}
            placeholder="Выберите товар"
            style={{ width: '100%' }}
            value={item.productId}
            onChange={(v) => handleProductChange(item.key, v)}
            options={(products ?? []).filter((pr: Product) => pr.isActive).map((pr: Product) => ({
              label: `${pr.name} (${pr.sku}) — ${stockLabel(pr)}`,
              value: pr.id,
              disabled: usedProductIds.has(pr.id) && pr.id !== item.productId,
            }))}
          />
          {p && (
            <div className="deal-create-item-card__stock" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>Остаток: {stockLabel(p)}</span>
              {productTypeBadge(p)}
            </div>
          )}
        </div>

        <div className="deal-create-item-card__grid">
          <div>
            <Typography.Text type="secondary" className="deal-create-field-label">{primaryControlLabel(p)}</Typography.Text>
            {renderPrimaryControl(item, p, intUnit)}
          </div>
          <div>
            <Typography.Text type="secondary" className="deal-create-field-label">Цена</Typography.Text>
            <InputNumber
              min={0}
              placeholder="Цена"
              style={{ width: '100%' }}
              formatter={moneyFormatter}
              parser={(v) => moneyParser(v) as unknown as number}
              value={item.price}
              onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
            />
          </div>
        </div>

        <div className="deal-create-item-card__summary">
          <Typography.Text type="secondary">Сумма</Typography.Text>
          <Typography.Text strong>{lineTotal > 0 ? formatUZS(lineTotal) : '—'}</Typography.Text>
        </div>

        {renderSecondaryControl(item, p) != null && (
          <div>
            {renderSecondaryControl(item, p)}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className={isMobile ? 'deal-create-page deal-create-page--mobile' : 'deal-create-page'}>
      <div className={isMobile ? 'deal-create-header deal-create-header--mobile' : 'deal-create-header'}>
        <Space align="center" className="deal-create-header__title">
          <BackButton fallback="/deals" />
          <Typography.Title level={4} style={{ margin: 0 }}>Новая сделка</Typography.Title>
        </Space>
        <Space className={isMobile ? 'deal-create-header__actions deal-create-header__actions--mobile' : 'deal-create-header__actions'}>
          <Button onClick={() => navigate('/deals')} className={isMobile ? 'deal-create-action-btn' : undefined}>Отмена</Button>
          <Button type="primary" loading={createMut.isPending} onClick={handleSubmit} className={isMobile ? 'deal-create-action-btn' : undefined}>Сохранить сделку</Button>
        </Space>
      </div>

      {draftBanner && (
        <Alert
          type="info"
          showIcon
          message="Найден незавершённый черновик сделки"
          description={`Сохранён ${dayjs(draftBanner.savedAt).format('DD.MM.YYYY HH:mm')}`}
          action={
            <Space className={isMobile ? 'deal-create-draft-actions' : undefined}>
              <Button size={isMobile ? 'middle' : 'small'} type="primary" onClick={() => restoreDraft(draftBanner)}>Восстановить</Button>
              <Button size={isMobile ? 'middle' : 'small'} danger onClick={discardDraft}>Удалить</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
          className={isMobile ? 'deal-create-draft-alert' : undefined}
        />
      )}

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="Основное" bordered={false} className={isMobile ? 'deal-create-section-card' : undefined}>
          <div className={isMobile ? 'deal-create-grid deal-create-grid--single' : 'deal-create-grid'}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Клиент *</Typography.Text>
              <Select
                showSearch
                placeholder="Выберите клиента"
                style={{ width: '100%' }}
                value={clientId}
                onChange={setClientId}
                options={(clients ?? []).map((c) => ({
                  value: c.id,
                  label: (
                    <Space size={6} align="center">
                      <ClientCompanyDisplay client={c} />
                      {c.manager && (
                        <Typography.Text type="secondary">({getFirstName(c.manager.fullName)})</Typography.Text>
                      )}
                    </Space>
                  ),
                }))}
                filterOption={(input, option) => {
                  const c = clients?.find((x) => x.id === option?.value);
                  if (!c) return false;
                  return matchesSearch(
                    buildClientSearchHaystack({
                      companyName: c.companyName,
                      contactName: c.contactName,
                      phone: c.phone,
                      email: c.email,
                      inn: c.inn,
                      managerName: c.manager?.fullName,
                    }),
                    input,
                  );
                }}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Название</Typography.Text>
              <Input placeholder={`Авто: Сделка от ${dayjs().format('DD.MM.YYYY')}`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Менеджер</Typography.Text>
              <Typography.Text>{getFirstName(user?.fullName)}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Статус</Typography.Text>
              <DealStatusTag status={previewStatus} />
            </div>
            <div style={{ gridColumn: isMobile ? undefined : '1 / -1' }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 8,
                background: isDebt ? tk.colorErrorBg : 'transparent',
                border: isDebt
                  ? `1px solid ${tk.colorErrorBorder}`
                  : `1px dashed ${tk.colorBorder}`,
                transition: 'all 0.2s',
              }}>
                <Switch
                  checked={isDebt}
                  onChange={(v) => {
                    setIsDebt(v);
                    if (v) {
                      setPaymentMethod('DEBT');
                    } else {
                      setDueDate(null);
                      if (paymentMethod === 'DEBT') setPaymentMethod('CASH');
                    }
                  }}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isDebt ? 12 : 0 }}>
                    <Typography.Text strong style={{ color: isDebt ? tk.colorError : undefined }}>
                      В долг
                    </Typography.Text>
                    {isDebt && <Tag color="red" style={{ margin: 0 }}>Клиент платит позже</Tag>}
                  </div>
                  {isDebt && (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                      <div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                          Тип оплаты *
                        </Typography.Text>
                        <Select
                          style={{ width: '100%' }}
                          value={debtPaymentType}
                          onChange={setDebtPaymentType}
                          options={[
                            { value: 'PARTIAL', label: 'Частичная оплата (есть аванс)' },
                            { value: 'INSTALLMENT', label: 'Рассрочка (полностью в долг)' },
                          ]}
                        />
                      </div>
                      <div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                          Срок оплаты
                        </Typography.Text>
                        <DatePicker
                          style={{ width: '100%' }}
                          value={dueDate}
                          onChange={setDueDate}
                          format="DD.MM.YYYY"
                          placeholder="Дата погашения долга"
                          allowClear
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style={{ gridColumn: isMobile ? undefined : '1 / -1' }} className={isMobile ? 'deal-create-checkbox-row' : undefined}>
              <Checkbox checked={isSessionDeal} onChange={(e) => setIsSessionDeal(e.target.checked)}>
                Сессионная сделка (выручка в отчётах по дню позиции, до закрытия сделки)
              </Checkbox>
            </div>
          </div>
          <div className="deal-create-delivery-block">
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Как доставим? *
            </Typography.Text>
            <Radio.Group value={deliveryType} onChange={(e) => setDeliveryType(e.target.value)} className={isMobile ? 'deal-create-delivery-group' : undefined}>
              <Radio.Button value="SELF_PICKUP">Самовывоз</Radio.Button>
              <Radio.Button value="YANDEX">Яндекс</Radio.Button>
              <Radio.Button value="DELIVERY">Доставка</Radio.Button>
            </Radio.Group>
            {deliveryType !== 'DELIVERY' && (
              <div className={isMobile ? 'deal-create-grid deal-create-grid--single deal-create-grid--compact' : 'deal-create-grid deal-create-grid--triple'}>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Номер машины</Typography.Text>
                  <Input placeholder="01 A 123 AA" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Тип машины</Typography.Text>
                  <Input placeholder="Газель, Ларгус…" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Комментарий</Typography.Text>
                  <Input placeholder="Примечание…" value={deliveryComment} onChange={(e) => setDeliveryComment(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }} className="deal-create-payment-block">
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Способ оплаты
            </Typography.Text>
            <Radio.Group
              value={paymentMethod}
              onChange={(e) => {
                const method = e.target.value as PaymentMethod;
                setPaymentMethod(method);
                if (method === 'DEBT') {
                  setIsDebt(true);
                } else if (paymentMethod === 'DEBT') {
                  setIsDebt(false);
                  setDueDate(null);
                }
              }}
              optionType="button"
              buttonStyle="solid"
              style={{ flexWrap: 'wrap' }}
            >
              <Radio.Button value="CASH">Наличные</Radio.Button>
              <Radio.Button value="PAYME">Payme</Radio.Button>
              <Radio.Button value="QR">QR</Radio.Button>
              <Radio.Button value="CLICK">Click</Radio.Button>
              <Radio.Button value="TERMINAL">Терминал</Radio.Button>
              <Radio.Button value="TRANSFER">Перечисление</Radio.Button>
              <Radio.Button value="INSTALLMENT">Рассрочка (безнал)</Radio.Button>
              <Radio.Button value="DEBT">Долг</Radio.Button>
            </Radio.Group>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>
              Нал/безнал (кроме перечисления и долга) — сделка сразу перейдёт к зав. склада. Перечисление с ИНН — сразу к бухгалтеру. Без ИНН — сначала «В работе». «Долг» включает режим «В долг» и остаётся в работе до уточнения способа оплаты.
            </Typography.Text>
            {paymentMethod === 'TRANSFER' && (
              <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    ИНН компании{' '}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>(необязательно — можно заполнить позже)</Typography.Text>
                  </Typography.Text>
                  <Input
                    placeholder="Введите ИНН клиента"
                    value={transferInn}
                    onChange={(e) => { autoFilledInnRef.current = null; setTransferInn(e.target.value); }}
                    maxLength={50}
                    allowClear
                  />
                  {!selectedClientInn && (clientTransferInns?.length || 0) > 1 && (
                    <div style={{ marginTop: 8 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        У клиента нет ИНН в реквизитах. Ранее использовались разные ИНН — выберите нужный:
                      </Typography.Text>
                      <Select
                        style={{ width: '100%', marginTop: 4 }}
                        value={transferInn || undefined}
                        onChange={(v) => { autoFilledInnRef.current = v; setTransferInn(v); }}
                        options={clientTransferInns!.map((inn) => ({ value: inn, label: inn }))}
                        placeholder="Выберите ИНН из истории"
                      />
                    </div>
                  )}
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    Документы{transferInn.trim() ? <span style={{ color: 'red' }}> *</span> : <Typography.Text type="secondary" style={{ fontSize: 12 }}> (если есть ИНН)</Typography.Text>}
                  </Typography.Text>
                  <Checkbox.Group
                    value={transferDocuments}
                    onChange={(vals) => setTransferDocuments(vals as string[])}
                    options={[
                      { label: 'Договор', value: 'Договор' },
                      { label: 'Спецификация', value: 'Спецификация' },
                      { label: 'Счет', value: 'Счет' },
                      { label: 'Счет-фактура', value: 'Счет-фактура' },
                      { label: 'Накладная', value: 'Накладная' },
                    ]}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    Тип договора{transferInn.trim() ? <span style={{ color: 'red' }}> *</span> : <Typography.Text type="secondary" style={{ fontSize: 12 }}> (если есть ИНН)</Typography.Text>}
                  </Typography.Text>
                  <Radio.Group
                    value={transferType}
                    onChange={(e) => setTransferType(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                  >
                    <Radio.Button value="ONE_TIME">Разовый</Radio.Button>
                    <Radio.Button value="ANNUAL">Годовой</Radio.Button>
                  </Radio.Group>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                    Комментарий / номер операции (необязательно)
                  </Typography.Text>
                  <Input.TextArea
                    rows={2}
                    placeholder="Например: номер платёжного поручения, уточнение…"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card
          title={`Товары (${draftItems.filter((i) => i.productId).length})`}
          extra={
            <Space className={isMobile ? 'deal-create-items-extra' : undefined}>
              {totalAmount > 0 && <Typography.Text strong>Итого: {formatUZS(totalAmount)}</Typography.Text>}
            </Space>
          }
          bordered={false}
          className={isMobile ? 'deal-create-section-card deal-create-items-card' : undefined}
        >
          {isMobile ? (
            <div className="deal-create-items-mobile">
              <div className="deal-create-items-mobile__list">
                {draftItems.map((item) => renderItemMobileCard(item))}
              </div>
              {totalAmount > 0 && (
                <div className="deal-create-items-total">
                  <Typography.Text type="secondary">Итого</Typography.Text>
                  <Typography.Text strong>{formatUZS(totalAmount)}</Typography.Text>
                </div>
              )}
              <Button type="dashed" block icon={<PlusOutlined />} className="deal-create-add-btn" onClick={addItemRow}>
                Добавить позицию
              </Button>
            </div>
          ) : (
            <>
              <table className="deal-create-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3 }}>Товар</th>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3, width: 150 }}>Кол-во</th>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3, width: 150, textAlign: 'right' }}>Цена (UZS)</th>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3, width: 130, textAlign: 'right' }}>Сумма</th>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, width: 100 }} />
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
                        <td style={{ padding: '10px 8px' }}>
                          <Select showSearch filterOption={smartFilterOption} placeholder="Выберите товар" style={{ width: '100%' }}
                            value={item.productId}
                            onChange={(v) => handleProductChange(item.key, v)}
                            options={(products ?? []).filter((pr: Product) => pr.isActive).map((pr: Product) => ({
                              label: `${pr.name} (${pr.sku}) — ${stockLabel(pr)}`,
                              value: pr.id,
                              disabled: usedProductIds.has(pr.id) && pr.id !== item.productId,
                            }))}
                          />
                          {p && (
                            <div style={{ fontSize: 11, color: tk.colorTextSecondary, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span>Ост: {stockLabel(p)}</span>
                              {productTypeBadge(p)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          {renderPrimaryControl(item, p, intUnit)}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <InputNumber min={0} placeholder="Цена" style={{ width: '100%' }}
                            formatter={moneyFormatter} parser={(v) => moneyParser(v) as unknown as number}
                            value={item.price}
                            onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
                          />
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          <Typography.Text style={{ whiteSpace: 'nowrap' }} strong={lineTotal > 0}>
                            {lineTotal > 0 ? formatUZS(lineTotal) : '—'}
                          </Typography.Text>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          {renderSecondaryControl(item, p)}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
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
                      <td style={{ padding: '8px', textAlign: 'right' }}>
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
            </>
          )}
        </Card>

        <Card title="Комментарий" bordered={false} className={isMobile ? 'deal-create-section-card' : undefined}>
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
