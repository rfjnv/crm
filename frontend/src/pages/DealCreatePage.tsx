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
import { CaretDown, CaretRight, Minus, Plus, X } from '@phosphor-icons/react';
import PickerSheet, { type PickerRow } from '../components/deals/PickerSheet';
import { theme } from 'antd';
import { dealsApi } from '../api/deals.api';
import { clientsApi } from '../api/clients.api';
import { innRegistryApi } from '../api/innRegistry.api';
import { inventoryApi } from '../api/warehouse.api';
import DealStatusTag from '../components/DealStatusTag';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { getFirstName } from '../lib/name-utils';
import { smartFilterOption, matchesSearch, buildClientSearchHaystack } from '../utils/translit';
import { LAMINATION_CATEGORY } from '../utils/lamination';
import type { Product, DealStatus, PaymentMethod } from '../types';
import dayjs from 'dayjs';
import './DealCreatePage.css';
import './DealCreateMobile.css';

interface DraftItem {
  key: string;
  productId?: string;
  requestedQty?: number;
  price?: number;
  /** Ламинация: кол-во рулонов — отдельное число, а не цифра в начале комментария. */
  rollCount?: number;
  requestComment: string;
}

let nextKey = 0;
function makeKey() { return `ci-${nextKey++}`; }

/** Units that are discrete (integer-only) */
const INTEGER_UNITS = new Set(['шт', 'шт.', 'pcs', 'рулон', 'рул', 'упак', 'уп', 'бабина']);

/** Ламинационная пленка продаётся по весу (кг), но клиенты заказывают её рулонами —
 * менеджер вводит оба числа: вес в кг (обычное поле «Кол-во») и количество рулонов рядом.
 * Категория и разбор легаси-комментариев — в utils/lamination (зеркало бэкенда). */
/** Для этого товара нужен выбор микрона кнопкой, а не свободный текст — чтобы не путали загрузчики. */
const SPRAY_POWDER_NAME = 'Противоотмарывающий порошок Spray Powder';
const MICRON_OPTIONS = ['15мкр', '25мкр'];

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
  /** Филиал клиента, куда везти; нет — основной адрес. Запоминаем, чей он: сменили клиента — сброс. */
  const [deliveryLocation, setDeliveryLocation] = useState<{ clientId: string; id: string }>();
  const deliveryLocationId = deliveryLocation && deliveryLocation.clientId === clientId ? deliveryLocation.id : undefined;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentNote, setPaymentNote] = useState('');
  const [transferInn, setTransferInn] = useState('');
  const [transferDocuments, setTransferDocuments] = useState<string[]>(() => [...DEFAULT_TRANSFER_DOCUMENTS]);
  const [transferType, setTransferType] = useState<'ONE_TIME' | 'ANNUAL'>('ONE_TIME');
  const [isSessionDeal, setIsSessionDeal] = useState(false);
  const [isDebt, setIsDebt] = useState(false);
  const [debtPaymentType, setDebtPaymentType] = useState<'PARTIAL' | 'INSTALLMENT'>('PARTIAL');
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  /** Телефон: листы выбора и свёрнутые блоки */
  const [clientSheet, setClientSheet] = useState(false);
  const [productSheet, setProductSheet] = useState(false);
  const [showVehicle, setShowVehicle] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [openComments, setOpenComments] = useState<Set<string>>(() => new Set());

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
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
    // Здесь важны актуальные остатки — не 5 минут, как у справочника товаров по умолчанию
    staleTime: 30_000,
  });

  const { data: clientTransferInns } = useQuery({
    queryKey: ['client-transfer-inns', clientId],
    queryFn: () => clientsApi.getTransferInns(clientId!),
    enabled: !!clientId && paymentMethod === 'TRANSFER',
  });
  const { data: innNames } = useQuery({
    queryKey: ['inn-names', clientTransferInns],
    queryFn: () => innRegistryApi.names(clientTransferInns ?? []),
    enabled: (clientTransferInns?.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
  });
  const innLegalName = (inn: string) => innNames?.[inn.replace(/\D/g, '')];

  const selectedClient = useMemo(() => clients?.find((c) => c.id === clientId), [clients, clientId]);

  const { data: clientLocations } = useQuery({
    queryKey: ['client-locations', clientId],
    queryFn: () => clientsApi.locations(clientId!),
    enabled: !!clientId && deliveryType === 'DELIVERY',
  });
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
    updateItem(key, { productId, price: autoPrice || undefined, rollCount: undefined, requestComment: '' });
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

    // Склад: нельзя заказать больше, чем есть на остатке.
    for (const item of validItems) {
      const p = productMap.get(item.productId!);
      if (p && item.requestedQty && item.requestedQty > Number(p.stock)) {
        message.error(
          `Недостаточно «${p.name}» на складе: остаток ${formatQty(p.stock)} ${p.unit}, запрошено ${formatQty(item.requestedQty)} ${p.unit}`,
        );
        return;
      }
    }

    // Ламинация: кол-во рулонов обязательно, без него позицию не создать.
    for (const item of validItems) {
      const p = productMap.get(item.productId!);
      if (p?.category === LAMINATION_CATEGORY && !(item.rollCount && item.rollCount > 0)) {
        message.error(`Укажите кол-во рулонов для "${p.name}"`);
        return;
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
      ...(deliveryType === 'DELIVERY' && deliveryLocationId ? { deliveryLocationId } : {}),
      ...(deliveryType !== 'DELIVERY' ? {
        vehicleNumber: vehicleNumber.trim() || undefined,
        vehicleType: vehicleType.trim() || undefined,
        deliveryComment: deliveryComment.trim() || undefined,
      } : {}),
      items: validItems.map((i) => ({
        productId: i.productId!,
        requestedQty: i.requestedQty || undefined,
        price: i.price || undefined,
        rollCount: i.rollCount || undefined,
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

  /** Ламинация: рулоны — отдельное числовое поле позиции (уходит на бэкенд как rollCount).
   * Раньше значение писалось строкой «N рул.» в комментарий, и комментарий был единственным
   * носителем складского учёта — из-за чего пояснение без цифр обнуляло списание рулонов. */
  function renderRollInput(item: DraftItem) {
    return (
      <InputNumber
        min={1}
        step={1}
        precision={0}
        placeholder="Рул."
        style={{ width: '100%' }}
        value={item.rollCount}
        onChange={(v) => updateItem(item.key, { rollCount: v ?? undefined })}
      />
    );
  }

  /** Ламинация: вес в кг — обычное поле requestedQty, как у всех товаров. */
  function renderKgInput(item: DraftItem, intUnit: boolean) {
    return <InputNumber {...qtyInputProps(item, intUnit)} placeholder="Кг" style={{ width: '100%' }} />;
  }

  /** Первая (главная) ячейка позиции — сразу после товара, используется в мобильной карточке
   * (в десктопной таблице ламинация вместо этого занимает две отдельные колонки «Рулоны» / «Кг»,
   * см. renderRollInput/renderKgInput): ламинация → рулоны и кг рядом; Spray Powder → выбор
   * микрона + кол-во(кг) тут же рядом; всё остальное → обычное кол-во. */
  function renderPrimaryControl(item: DraftItem, p: Product | null | undefined, intUnit: boolean) {
    if (p?.category === LAMINATION_CATEGORY) {
      return (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', width: '100%', fontSize: 10, lineHeight: '12px', color: tk.colorTextSecondary, marginBottom: 2 }}>
            <span style={{ width: '50%' }}>Рулоны *</span>
            <span style={{ width: '50%' }}>Кг</span>
          </div>
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <div style={{ width: '50%' }}>{renderRollInput(item)}</div>
            <div style={{ width: '50%' }}>{renderKgInput(item, intUnit)}</div>
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

  /** Цветной бейдж типа товара рядом с выбором — чтобы особая строка (ламинация/тальк) была
   * видна с первого взгляда, не читая все ячейки ряда. */
  function productTypeBadge(p: Product | null | undefined) {
    if (p?.category === LAMINATION_CATEGORY) return <Tag color="blue" style={{ marginInlineEnd: 0 }}>плёнка · рулоны</Tag>;
    if (p?.name === SPRAY_POWDER_NAME) return <Tag color="gold" style={{ marginInlineEnd: 0 }}>микрон</Tag>;
    return null;
  }

  /** Вторая (доп.) ячейка позиции — в конце строки:
   * Spray Powder → ничего (микрон и кг уже введены слева, доп. коммент не нужен);
   * всё остальное (включая ламинацию) → обычный необязательный комментарий к позиции.
   * У ламинации он раньше был скрыт, потому что то же поле служило носителем кол-ва
   * рулонов; теперь рулоны — отдельное число, и комментарий снова просто комментарий. */
  function renderSecondaryControl(item: DraftItem, p: Product | null | undefined) {
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

  /* ── Телефон: отдельная раскладка (клиент → товары → оплата → доставка, итог снизу) ── */

  // Форма на весь экран: нижние вкладки приложения прячем, на их месте — панель «Создать сделку»
  useEffect(() => {
    if (!isMobile) return undefined;
    document.documentElement.classList.add('deal-create-open');
    return () => document.documentElement.classList.remove('deal-create-open');
  }, [isMobile]);

  const pickedItems = useMemo(() => draftItems.filter((i) => i.productId), [draftItems]);

  /** Чего не хватает, чтобы создать сделку — пишем на кнопке, а не после нажатия */
  const missing = useMemo(() => {
    if (!clientId) return 'выберите клиента';
    if (pickedItems.length === 0) return 'добавьте товар';
    for (const item of pickedItems) {
      const p = productMap.get(item.productId!);
      if (p?.category === LAMINATION_CATEGORY && !(item.rollCount && item.rollCount > 0)) return `рулоны — ${p.name}`;
      if (p && item.requestedQty && item.requestedQty > Number(p.stock)) return `не хватает на складе — ${p.name}`;
      if (item.requestedQty && item.requestedQty > 0 && !(item.price && item.price > 0)) return `цена — ${p?.name ?? 'товар'}`;
    }
    if (paymentMethod === 'TRANSFER' && transferInn.trim() && transferDocuments.length === 0) return 'документы для перечисления';
    return null;
  }, [clientId, pickedItems, productMap, paymentMethod, transferInn, transferDocuments]);

  const routeHint: Partial<Record<DealStatus, string>> = {
    WAITING_WAREHOUSE_MANAGER: 'Сразу уйдёт к зав. склада',
    WAITING_FINANCE: 'С ИНН сразу уйдёт к бухгалтеру',
    WAITING_STOCK_CONFIRMATION: 'Без количества — сначала подтверждение склада',
    IN_PROGRESS: paymentMethod === 'TRANSFER'
      ? 'Без ИНН — сначала «В работе», ИНН можно добавить позже'
      : 'Останется «В работе» до уточнения оплаты',
  };

  const clientRows: PickerRow[] = useMemo(() => (clients ?? []).map((c) => ({
    id: c.id,
    haystack: buildClientSearchHaystack({
      companyName: c.companyName, contactName: c.contactName, phone: c.phone, email: c.email, inn: c.inn, managerName: c.manager?.fullName,
    }),
    render: (
      <span className="dcm-pick-row">
        <span className="dcm-ava">{(c.companyName || '?').slice(0, 2).toUpperCase()}</span>
        <span className="dcm-pick-row__t">
          <b><ClientCompanyDisplay client={c} /></b>
          <small>{[c.contactName, c.phone, c.manager && getFirstName(c.manager.fullName)].filter(Boolean).join(' · ')}</small>
        </span>
      </span>
    ),
  })), [clients]);

  const productRows: PickerRow[] = useMemo(() => (products ?? []).filter((p: Product) => p.isActive).map((p: Product) => {
    const stock = Number(p.stock);
    const level = stock <= 0 ? 'zero' : stock < Number(p.minStock || 0) ? 'low' : 'ok';
    return {
      id: p.id,
      haystack: `${p.name} ${p.sku} ${p.category ?? ''}`,
      group: p.category,
      render: (
        <span className="dcm-pick-row">
          <span className="dcm-pick-row__t">
            <b>{p.name}</b>
            <small>{[p.sku, p.salePrice ? formatUZS(Number(p.salePrice)) : null, p.category === LAMINATION_CATEGORY ? 'рулоны + кг' : null].filter(Boolean).join(' · ')}</small>
          </span>
          <span className={`dcm-stock dcm-stock--${level}`}>
            <b>{formatQty(p.stock)}</b>
            <small>{p.rollStock != null ? `${formatQty(p.rollStock)} рул.` : level === 'zero' ? 'нет' : level === 'low' ? 'мало' : p.unit}</small>
          </span>
        </span>
      ),
    };
  }), [products]);

  function addProduct(productId: string) {
    const product = productMap.get(productId);
    const autoPrice = product?.salePrice ? Number(product.salePrice) : undefined;
    // Пустая заготовка строки (её создаёт форма для компьютера) на телефоне не нужна
    setDraftItems((prev) => [
      ...prev.filter((i) => i.productId),
      { key: makeKey(), productId, price: autoPrice || undefined, requestComment: '' },
    ]);
  }

  /** Тот же выбор оплаты, что и на компьютере: «Долг» включает режим «В долг», другой способ — выключает */
  function setPayment(method: PaymentMethod) {
    setPaymentMethod(method);
    if (method === 'DEBT') {
      setIsDebt(true);
    } else if (paymentMethod === 'DEBT' || isDebt) {
      setIsDebt(false);
      setDueDate(null);
    }
  }

  const PAYMENT_CHIPS: { value: PaymentMethod; label: string }[] = [
    { value: 'CASH', label: 'Наличные' },
    { value: 'CLICK', label: 'Click' },
    { value: 'PAYME', label: 'Payme' },
    { value: 'QR', label: 'QR' },
    { value: 'TERMINAL', label: 'Терминал' },
    { value: 'TRANSFER', label: 'Перечисл.' },
    { value: 'INSTALLMENT', label: 'Рассрочка' },
    { value: 'DEBT', label: 'Долг' },
  ];
  const DOCUMENTS = ['Договор', 'Спецификация', 'Счет', 'Счет-фактура', 'Накладная'];

  function renderQtyStepper(item: DraftItem, intUnit: boolean) {
    const value = item.requestedQty ?? 0;
    return (
      <div className="dcm-stepper">
        <button
          type="button"
          aria-label="Меньше"
          onClick={() => updateItem(item.key, { requestedQty: Math.max(0, +(value - 1).toFixed(3)) || undefined })}
        >
          <Minus size={15} weight="bold" />
        </button>
        <InputNumber {...qtyInputProps(item, intUnit)} precision={intUnit ? 0 : undefined} placeholder="0" controls={false} inputMode="decimal" variant="borderless" />
        <button type="button" aria-label="Больше" onClick={() => updateItem(item.key, { requestedQty: +(value + 1).toFixed(3) })}>
          <Plus size={15} weight="bold" />
        </button>
      </div>
    );
  }

  function renderPriceInput(item: DraftItem) {
    return (
      <InputNumber
        className="dcm-input"
        min={0}
        placeholder="Цена"
        controls={false}
        inputMode="numeric"
        formatter={moneyFormatter}
        parser={(v) => moneyParser(v) as unknown as number}
        value={item.price}
        onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
      />
    );
  }

  function renderMobileItem(item: DraftItem) {
    const p = productMap.get(item.productId!);
    const intUnit = isIntegerUnit(p?.unit);
    const lineTotal = item.requestedQty && item.price ? item.requestedQty * item.price : 0;
    const short = !!p && !!item.requestedQty && item.requestedQty > Number(p.stock);
    const isLam = p?.category === LAMINATION_CATEGORY;
    const isSpray = p?.name === SPRAY_POWDER_NAME;
    const commentOpen = openComments.has(item.key) || !!item.requestComment;
    return (
      <div key={item.key} className="dcm-item">
        <div className="dcm-item__top">
          <span className="dcm-item__name">{p?.name ?? 'Товар'}</span>
          <button type="button" className="dcm-icon-btn" aria-label="Убрать товар" onClick={() => removeItemRow(item.key)}>
            <X size={16} />
          </button>
        </div>
        <div className="dcm-item__meta">
          {p?.sku && <span>{p.sku}</span>}
          {p && <span className="dcm-pill">на складе {stockLabel(p)}</span>}
          {isLam && <span className="dcm-pill dcm-pill--accent">рулоны + кг</span>}
          {short && <span className="dcm-pill dcm-pill--neg">не хватает на складе</span>}
        </div>

        {isSpray && (
          <div className="dcm-micron">
            {MICRON_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={`dcm-chip${item.requestComment === m ? ' is-on' : ''}`}
                onClick={() => updateItem(item.key, { requestComment: m })}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {isLam ? (
          <div className="dcm-item__row dcm-item__row--lam">
            <label>
              <span className="dcm-lbl">Рулоны *</span>
              <InputNumber
                className="dcm-input"
                min={1}
                precision={0}
                controls={false}
                inputMode="numeric"
                placeholder="0"
                value={item.rollCount}
                onChange={(v) => updateItem(item.key, { rollCount: v ?? undefined })}
              />
            </label>
            <label>
              <span className="dcm-lbl">Кг</span>
              <InputNumber {...qtyInputProps(item, intUnit)} precision={intUnit ? 0 : undefined} className="dcm-input" placeholder="0" controls={false} inputMode="decimal" />
            </label>
            <label><span className="dcm-lbl">Цена</span>{renderPriceInput(item)}</label>
          </div>
        ) : (
          <div className="dcm-item__row">
            <label>
              <span className="dcm-lbl">Кол-во{isSpray ? ', кг' : p?.unit ? `, ${p.unit}` : ''}</span>
              {renderQtyStepper(item, intUnit)}
            </label>
            <label><span className="dcm-lbl">Цена</span>{renderPriceInput(item)}</label>
          </div>
        )}

        {!isSpray && commentOpen && (
          <Input
            className="dcm-input dcm-item__comment"
            placeholder="Комментарий к позиции"
            value={item.requestComment}
            autoFocus={!item.requestComment}
            onChange={(e) => updateItem(item.key, { requestComment: e.target.value })}
          />
        )}
        <div className="dcm-item__foot">
          {!isSpray && !commentOpen ? (
            <button type="button" className="dcm-link" onClick={() => setOpenComments((prev) => new Set(prev).add(item.key))}>
              + комментарий
            </button>
          ) : <span />}
          <span className="dcm-item__sum">{lineTotal > 0 ? formatUZS(lineTotal) : '—'}</span>
        </div>
      </div>
    );
  }

  function renderMobile() {
    const draftSaved = !!clientId || pickedItems.length > 0;
    const vehicleOpen = showVehicle || !!vehicleNumber || !!vehicleType || !!deliveryComment;
    const extraOpen = showExtra || !!title || !!commentText || isSessionDeal;
    const n = pickedItems.length;
    return (
      <div className="dcm">
        <div className="dcm-head">
          <BackButton fallback="/deals" />
          <div className="dcm-head__t">
            <h1>Новая сделка</h1>
            {draftSaved && <span className="dcm-head__draft">черновик сохраняется</span>}
          </div>
        </div>

        {draftBanner && (
          <div className="dcm-draft">
            <div className="dcm-draft__t">
              <b>Есть незавершённый черновик</b>
              <small>от {dayjs(draftBanner.savedAt).format('DD.MM HH:mm')}</small>
            </div>
            <Button size="small" type="primary" onClick={() => restoreDraft(draftBanner)}>Восстановить</Button>
            <Button size="small" type="text" danger onClick={discardDraft}>Удалить</Button>
          </div>
        )}

        <section className="dcm-sec">
          <div className="dcm-sec__h"><b>Клиент</b></div>
          <button type="button" className={`dcm-client${selectedClient ? '' : ' dcm-client--empty'}`} onClick={() => setClientSheet(true)}>
            {selectedClient ? (
              <>
                <span className="dcm-ava">{(selectedClient.companyName || '?').slice(0, 2).toUpperCase()}</span>
                <span className="dcm-client__t">
                  <b><ClientCompanyDisplay client={selectedClient} /></b>
                  <small>
                    {[selectedClient.contactName, selectedClient.manager && `менеджер ${getFirstName(selectedClient.manager.fullName)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
              </>
            ) : (
              <span className="dcm-client__t"><b>Выберите клиента</b><small>поиск по названию, контакту, телефону, ИНН</small></span>
            )}
            <CaretRight size={16} className="dcm-chev" />
          </button>
        </section>

        <section className="dcm-sec">
          <div className="dcm-sec__h"><b>Товары{n ? ` · ${n}` : ''}</b></div>
          {pickedItems.map((item) => renderMobileItem(item))}
          <button type="button" className="dcm-add" onClick={() => setProductSheet(true)}>
            <Plus size={16} weight="bold" /> {n ? 'Добавить ещё товар' : 'Добавить товар'}
          </button>
        </section>

        <section className="dcm-sec">
          <div className="dcm-sec__h"><b>Оплата</b></div>
          <div className="dcm-chips">
            {PAYMENT_CHIPS.map((c) => (
              <button key={c.value} type="button" className={`dcm-chip${paymentMethod === c.value ? ' is-on' : ''}`} onClick={() => setPayment(c.value)}>
                {c.label}
              </button>
            ))}
          </div>

          {paymentMethod === 'DEBT' && (
            <div className="dcm-sub">
              <div className="dcm-seg">
                <button type="button" className={debtPaymentType === 'PARTIAL' ? 'is-on' : ''} onClick={() => setDebtPaymentType('PARTIAL')}>Есть аванс</button>
                <button type="button" className={debtPaymentType === 'INSTALLMENT' ? 'is-on' : ''} onClick={() => setDebtPaymentType('INSTALLMENT')}>Полностью в долг</button>
              </div>
              <label>
                <span className="dcm-lbl">Срок оплаты</span>
                <DatePicker className="dcm-input" value={dueDate} onChange={setDueDate} format="DD.MM.YYYY" placeholder="Выберите дату" inputReadOnly allowClear />
              </label>
            </div>
          )}

          {paymentMethod === 'TRANSFER' && (
            <div className="dcm-sub">
              <label>
                <span className="dcm-lbl">ИНН компании <i>· можно позже</i></span>
                <Input
                  className="dcm-input"
                  inputMode="numeric"
                  placeholder="ИНН клиента"
                  value={transferInn}
                  onChange={(e) => { autoFilledInnRef.current = null; setTransferInn(e.target.value); }}
                  maxLength={50}
                  allowClear
                  suffix={transferInn && innLegalName(transferInn) ? <span className="dcm-inn-name">{innLegalName(transferInn)}</span> : undefined}
                />
              </label>
              {!selectedClientInn && (clientTransferInns?.length || 0) > 1 && (
                <label>
                  <span className="dcm-lbl">ИНН из прошлых сделок</span>
                  <Select
                    className="dcm-input"
                    value={transferInn || undefined}
                    onChange={(v) => { autoFilledInnRef.current = v; setTransferInn(v); }}
                    options={clientTransferInns!.map((inn) => ({ value: inn, label: innLegalName(inn) ? `${inn} — ${innLegalName(inn)}` : inn }))}
                    placeholder="Выберите ИНН"
                  />
                </label>
              )}
              <div>
                <span className="dcm-lbl">Документы{transferInn.trim() ? ' *' : ''}</span>
                <div className="dcm-docs">
                  {DOCUMENTS.map((d) => {
                    const on = transferDocuments.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`dcm-doc${on ? ' is-on' : ''}`}
                        onClick={() => setTransferDocuments((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span className="dcm-lbl">Договор</span>
                <div className="dcm-seg">
                  <button type="button" className={transferType === 'ONE_TIME' ? 'is-on' : ''} onClick={() => setTransferType('ONE_TIME')}>Разовый</button>
                  <button type="button" className={transferType === 'ANNUAL' ? 'is-on' : ''} onClick={() => setTransferType('ANNUAL')}>Годовой</button>
                </div>
              </div>
              <label>
                <span className="dcm-lbl">Номер операции / комментарий</span>
                <Input.TextArea className="dcm-input" autoSize={{ minRows: 1, maxRows: 4 }} placeholder="необязательно" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
              </label>
            </div>
          )}

          {routeHint[previewStatus] && <div className="dcm-hint"><span className="dcm-dot" />{routeHint[previewStatus]}</div>}
        </section>

        <section className="dcm-sec">
          <div className="dcm-sec__h"><b>Доставка</b></div>
          <div className="dcm-seg dcm-seg--3">
            {([['SELF_PICKUP', 'Самовывоз'], ['YANDEX', 'Яндекс'], ['DELIVERY', 'Доставка']] as const).map(([v, l]) => (
              <button key={v} type="button" className={deliveryType === v ? 'is-on' : ''} onClick={() => setDeliveryType(v)}>{l}</button>
            ))}
          </div>
          {deliveryType === 'DELIVERY' ? (
            clientId ? (
              <div className="dcm-sub">
                <label>
                  <span className="dcm-lbl">Куда везти</span>
                  <Select
                    className="dcm-input"
                    value={deliveryLocationId ?? ''}
                    onChange={(v) => setDeliveryLocation(v ? { clientId, id: v } : undefined)}
                    options={[
                      { value: '', label: `Основной адрес${selectedClient?.address ? ` — ${selectedClient.address}` : ''}` },
                      ...(clientLocations ?? []).map((l) => ({ value: l.id, label: `${l.name}${l.address ? ` — ${l.address}` : ''}` })),
                    ]}
                  />
                </label>
              </div>
            ) : <div className="dcm-hint">Сначала выберите клиента — подставим его адрес</div>
          ) : (
            <>
              <button type="button" className="dcm-fold" onClick={() => setShowVehicle((v) => !v)}>
                <span>Машина и примечание</span>
                <span className="dcm-fold__r">{vehicleOpen ? <CaretDown size={14} /> : <>необязательно <CaretRight size={14} /></>}</span>
              </button>
              {vehicleOpen && (
                <div className="dcm-sub dcm-sub--2">
                  <label><span className="dcm-lbl">Номер машины</span><Input className="dcm-input" placeholder="01 A 123 AA" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} /></label>
                  <label><span className="dcm-lbl">Тип машины</span><Input className="dcm-input" placeholder="Газель…" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} /></label>
                  <label className="dcm-span"><span className="dcm-lbl">Примечание</span><Input className="dcm-input" placeholder="Например: заехать со двора" value={deliveryComment} onChange={(e) => setDeliveryComment(e.target.value)} /></label>
                </div>
              )}
            </>
          )}
        </section>

        <section className="dcm-sec">
          <button type="button" className="dcm-fold dcm-fold--top" onClick={() => setShowExtra((v) => !v)}>
            <span>Название, комментарий, сессионная</span>
            {extraOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
          </button>
          {extraOpen && (
            <div className="dcm-sub">
              <label>
                <span className="dcm-lbl">Название</span>
                <Input className="dcm-input" placeholder={`Авто: Сделка от ${dayjs().format('DD.MM.YYYY')}`} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                <span className="dcm-lbl">Комментарий к сделке</span>
                <Input.TextArea className="dcm-input" autoSize={{ minRows: 2, maxRows: 6 }} placeholder="необязательно" value={commentText} onChange={(e) => setCommentText(e.target.value)} />
              </label>
              <Checkbox checked={isSessionDeal} onChange={(e) => setIsSessionDeal(e.target.checked)}>
                Сессионная сделка
                <span className="dcm-check-hint">выручка в отчётах по дню позиции, до закрытия сделки</span>
              </Checkbox>
            </div>
          )}
        </section>

        <div className="dcm-bar">
          <div className="dcm-bar__line">
            <span className={missing ? 'dcm-bar__missing' : undefined}>
              {missing ? `Не хватает: ${missing}` : `Итого · ${n} ${n === 1 ? 'позиция' : n > 1 && n < 5 ? 'позиции' : 'позиций'}`}
            </span>
            <b>{formatUZS(totalAmount)}</b>
          </div>
          <Button type="primary" block className="dcm-bar__cta" loading={createMut.isPending} disabled={!!missing} onClick={handleSubmit}>
            Создать сделку
          </Button>
        </div>

        <PickerSheet
          open={clientSheet}
          title="Клиент"
          placeholder="Название, контакт, телефон, ИНН"
          rows={clientRows}
          selected={clientId ? new Set([clientId]) : undefined}
          onPick={(id) => setClientId(id)}
          onClose={() => setClientSheet(false)}
          emptyText="Клиент не найден"
        />
        <PickerSheet
          open={productSheet}
          title="Добавить товар"
          placeholder="Название или артикул (можно латиницей)"
          rows={productRows}
          selected={usedProductIds}
          multi
          onPick={addProduct}
          onClose={() => setProductSheet(false)}
          emptyText="Товар не найден"
        />
      </div>
    );
  }

  if (isMobile) return renderMobile();

  return (
    <div className="deal-create-page">
      <div className="deal-create-header">
        <Space align="center" className="deal-create-header__title">
          <BackButton fallback="/deals" />
          <Typography.Title level={4} style={{ margin: 0 }}>Новая сделка</Typography.Title>
        </Space>
        <Space className="deal-create-header__actions">
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
          <div className="deal-create-grid">
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
            <div style={{ gridColumn: '1 / -1' }}>
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
            <div style={{ gridColumn: '1 / -1' }}>
              <Checkbox checked={isSessionDeal} onChange={(e) => setIsSessionDeal(e.target.checked)}>
                Сессионная сделка (выручка в отчётах по дню позиции, до закрытия сделки)
              </Checkbox>
            </div>
          </div>
          <div className="deal-create-delivery-block">
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Как доставим? *
            </Typography.Text>
            <Radio.Group value={deliveryType} onChange={(e) => setDeliveryType(e.target.value)}>
              <Radio.Button value="SELF_PICKUP">Самовывоз</Radio.Button>
              <Radio.Button value="YANDEX">Яндекс</Radio.Button>
              <Radio.Button value="DELIVERY">Доставка</Radio.Button>
            </Radio.Group>
            {deliveryType === 'DELIVERY' && clientId && (
              <div style={{ marginTop: 12, maxWidth: 520 }}>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Куда везти</Typography.Text>
                <Select
                  style={{ width: '100%' }}
                  value={deliveryLocationId ?? ''}
                  onChange={(v) => setDeliveryLocation(v ? { clientId, id: v } : undefined)}
                  options={[
                    {
                      value: '',
                      label: `Основной адрес${selectedClient?.address ? ` — ${selectedClient.address}` : ''}`,
                    },
                    ...(clientLocations ?? []).map((l) => ({
                      value: l.id,
                      label: `📍 ${l.name}${l.address ? ` — ${l.address}` : ''}`,
                    })),
                  ]}
                />
                {clientLocations && clientLocations.length === 0 && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                    Везти в филиал или на другой склад клиента? Добавьте точку в карточке клиента → «Адреса доставки».
                  </Typography.Text>
                )}
              </div>
            )}
            {deliveryType !== 'DELIVERY' && (
              <div className="deal-create-grid deal-create-grid--triple">
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
                        options={clientTransferInns!.map((inn) => ({ value: inn, label: innLegalName(inn) ? `${inn} — ${innLegalName(inn)}` : inn }))}
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
            <Space>
              {totalAmount > 0 && <Typography.Text strong>Итого: {formatUZS(totalAmount)}</Typography.Text>}
            </Space>
          }
          bordered={false}
        >
          <>
              <table className="deal-create-items-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: `1px solid ${tk.colorBorderSecondary}` }}>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3 }}>Товар</th>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3, width: 75 }}>Рулоны</th>
                    <th style={{ padding: '8px', fontWeight: 600, fontSize: 12, color: tk.colorTextSecondary, textTransform: 'uppercase', letterSpacing: 0.3, width: 75 }}>Кг</th>
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
                        <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }}>
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
                              {item.requestedQty && item.requestedQty > Number(p.stock) && (
                                <Tag color="red" style={{ margin: 0 }}>Не хватает на складе</Tag>
                              )}
                            </div>
                          )}
                        </td>
                        {p?.category === LAMINATION_CATEGORY ? (
                          <>
                            <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }}>{renderRollInput(item)}</td>
                            <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }}>{renderKgInput(item, intUnit)}</td>
                          </>
                        ) : (
                          <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }} colSpan={2}>
                            {renderPrimaryControl(item, p, intUnit)}
                          </td>
                        )}
                        <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }}>
                          <InputNumber min={0} placeholder="Цена" style={{ width: '100%' }}
                            formatter={moneyFormatter} parser={(v) => moneyParser(v) as unknown as number}
                            value={item.price}
                            onChange={(v) => updateItem(item.key, { price: v ?? undefined })}
                          />
                        </td>
                        <td style={{ padding: '16px 8px 10px', verticalAlign: 'top', textAlign: 'right' }}>
                          <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                            <Typography.Text style={{ whiteSpace: 'nowrap' }} strong={lineTotal > 0}>
                              {lineTotal > 0 ? formatUZS(lineTotal) : '—'}
                            </Typography.Text>
                          </div>
                        </td>
                        <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }}>
                          {renderSecondaryControl(item, p)}
                        </td>
                        <td style={{ padding: '16px 8px 10px', verticalAlign: 'top' }}>
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeItemRow(item.key)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {totalAmount > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${tk.colorBorderSecondary}` }}>
                      <td colSpan={4} style={{ padding: '8px', textAlign: 'right' }}>
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
