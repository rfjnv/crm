import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Descriptions, Card, Table, Typography, Spin, Tag, Space, Button,
  Modal, Form, Input, DatePicker, Tabs, Row, Col, Statistic, Segmented,
  message, theme, Collapse, Dropdown, Select, InputNumber, Popconfirm,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined, DollarOutlined, ShoppingCartOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, EditOutlined,
  CommentOutlined, IdcardOutlined, CrownFilled,
} from '@ant-design/icons';
import { Line, Bar } from '@ant-design/charts';
import { clientsApi } from '../api/clients.api';
import { adminApi } from '../api/admin.api';
import BackButton from '../components/BackButton';
import { smartFilterOption } from '../utils/translit';
import { contractsApi } from '../api/contracts.api';
import { inventoryApi } from '../api/warehouse.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import DealStatusTag from '../components/DealStatusTag';
import ClientAuditHistoryPanel from '../components/ClientAuditHistoryPanel';
import ClientNotesPanel from '../components/ClientNotesPanel';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import type {
  DealStatus,
  DealShort,
  PaymentStatus,
  PaymentRecord,
  Product,
  ClientStockPosition,
  ClientStockEvent,
} from '../types';
import type { CreateClientData } from '../api/clients.api';
import {
  CLIENT_PORTRAIT_TEMPLATES,
  appendPortraitSnippet,
  type ClientPortraitField,
} from '../constants/clientPortraitTemplates';
import dayjs from 'dayjs';

const paymentStatusLabels: Record<PaymentStatus, { color: string; label: string }> = {
  UNPAID: { color: 'default', label: 'Не оплачено' },
  PARTIAL: { color: 'orange', label: 'Частично' },
  PAID: { color: 'green', label: 'Оплачено' },
};

type PaymentFilter = 'ALL' | 'DEBT' | 'PAID' | 'PARTIAL';

const paymentFilterOptions: { label: string; value: PaymentFilter }[] = [
  { label: 'Все', value: 'ALL' },
  { label: 'Долг', value: 'DEBT' },
  { label: 'Оплачено', value: 'PAID' },
  { label: 'Частично', value: 'PARTIAL' },
];

function getPaymentCategory(deal: DealShort): PaymentFilter {
  const amount = Number(deal.amount);
  const paid = Number(deal.paidAmount ?? 0);
  if (paid >= amount) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return 'DEBT';
}

function buildYandexMapUrlByAddress(address: string): string {
  const encoded = encodeURIComponent(address);
  return `https://yandex.ru/map-widget/v1/?text=${encoded}&z=15`;
}

type StockPositionTableRow = ClientStockPosition & { key: string };
type StockEventTableRow = ClientStockEvent & { key: string };

function buildYandexMapsOpenUrlByAddress(address: string): string {
  const encoded = encodeURIComponent(address);
  return `https://yandex.ru/maps/?text=${encoded}&z=15`;
}

function buildYandexMapUrlByCoords(latitude: number, longitude: number): string {
  return `https://yandex.ru/map-widget/v1/?ll=${longitude}%2C${latitude}&z=15&pt=${longitude},${latitude},pm2rdm`;
}

function buildYandexMapsOpenUrlByCoords(latitude: number, longitude: number): string {
  return `https://yandex.ru/maps/?ll=${longitude}%2C${latitude}&z=15&pt=${longitude},${latitude},pm2rdm`;
}

function parseCoordinatesText(raw: string): { latitude: number; longitude: number } | null {
  const matches = raw.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) return null;
  const first = Number(matches[0].replace(',', '.'));
  const second = Number(matches[1].replace(',', '.'));
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  let latitude = first;
  let longitude = second;

  if (Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) {
    latitude = second;
    longitude = first;
  }

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contractModal, setContractModal] = useState(false);
  const [contractForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [portraitForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();

  // Client-side payment status filter (no API call on change)
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('ALL');

  // Analytics period
  const [analyticsPeriod, setAnalyticsPeriod] = useState<number>(30);
  const [stockProductId, setStockProductId] = useState<string>();
  const [stockQty, setStockQty] = useState<number>(1);
  const [stockPrice, setStockPrice] = useState<number | undefined>(undefined);
  const [stockComment, setStockComment] = useState('');
  const [stockSendModalOpen, setStockSendModalOpen] = useState(false);
  const [stockSendProductId, setStockSendProductId] = useState<string | null>(null);
  const [stockSendQty, setStockSendQty] = useState<number>(0);
  const [stockCorrectOpen, setStockCorrectOpen] = useState(false);
  const [stockCorrectEventId, setStockCorrectEventId] = useState<string | null>(null);
  const [stockCorrectForm] = Form.useForm();
  const watchedCorrectQty = Form.useWatch('qty', stockCorrectForm);
  const watchedCorrectPrice = Form.useWatch('unitPrice', stockCorrectForm);

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.getById(id!),
    enabled: !!id,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['client-history', id],
    queryFn: () => clientsApi.history(id!),
    enabled: !!id,
  });

  const { data: contracts } = useQuery({
    queryKey: ['contracts', id],
    queryFn: () => contractsApi.list(id!),
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ['client-payments', id],
    queryFn: () => clientsApi.payments(id!),
    enabled: !!id,
  });

  const { data: analytics } = useQuery({
    queryKey: ['client-analytics', id, analyticsPeriod],
    queryFn: () => clientsApi.analytics(id!, analyticsPeriod),
    enabled: !!id,
  });

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['client-stock', id],
    queryFn: () => clientsApi.stock(id!, { historyLimit: 100 }),
    enabled: !!id,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: inventoryApi.listProducts,
  });

  const createContractMut = useMutation({
    mutationFn: (data: { clientId: string; contractNumber: string; startDate: string; endDate?: string; notes?: string }) =>
      contractsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts', id] });
      message.success('Договор создан');
      setContractModal(false);
      contractForm.resetFields();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка создания договора';
      message.error(msg);
    },
  });

  const updateClientMut = useMutation({
    mutationFn: (data: Partial<CreateClientData>) => clientsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Клиент обновлён');
      setEditOpen(false);
      setPortraitOpen(false);
    },
    onError: () => message.error('Ошибка обновления клиента'),
  });

  const svipMut = useMutation({
    mutationFn: () => clientsApi.toggleSvip(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success(client?.isSvip ? 'Статус SVIP снят' : 'Клиент отмечен как SVIP');
    },
    onError: () => message.error('Ошибка изменения статуса'),
  });

  const creditStatusMut = useMutation({
    mutationFn: (creditStatus: 'NORMAL' | 'SATISFACTORY' | 'NEGATIVE') =>
      clientsApi.setCreditStatus(id!, creditStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Кредитный статус клиента обновлён');
    },
    onError: () => message.error('Ошибка изменения кредитного статуса'),
  });

  const addStockMut = useMutation({
    mutationFn: (data: Parameters<typeof clientsApi.addStock>[1]) => clientsApi.addStock(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-stock', id] });
      queryClient.invalidateQueries({ queryKey: ['client-analytics', id] });
      message.success('Товар добавлен в накопление клиента');
      setStockQty(1);
      setStockComment('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка добавления товара';
      message.error(msg);
    },
  });

  const sendStockPartialMut = useMutation({
    mutationFn: (payload: Parameters<typeof clientsApi.sendStockPartial>[1]) => clientsApi.sendStockPartial(id!, payload),
    onSuccess: (deal) => {
      queryClient.invalidateQueries({ queryKey: ['client-stock', id] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['client-analytics', id] });
      message.success('Часть остатков отправлена в работу');
      navigate(`/deals/${deal.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка отправки в работу';
      message.error(msg);
    },
  });

  const sendStockAllMut = useMutation({
    mutationFn: () => clientsApi.sendStockAll(id!, {}),
    onSuccess: (deal) => {
      queryClient.invalidateQueries({ queryKey: ['client-stock', id] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['client-analytics', id] });
      message.success('Все остатки отправлены в работу');
      navigate(`/deals/${deal.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка отправки всех остатков';
      message.error(msg);
    },
  });

  const invalidateAfterStockAdmin = () => {
    queryClient.invalidateQueries({ queryKey: ['client-stock', id] });
    queryClient.invalidateQueries({ queryKey: ['client-analytics', id] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    queryClient.invalidateQueries({ queryKey: ['revenue-today'] });
  };

  const correctStockAddMut = useMutation({
    mutationFn: (payload: {
      eventId: string;
      qty: number;
      occurredAt: string;
      unitPrice: number | null;
      reason?: string;
    }) => {
      if (!id) throw new Error('Клиент не выбран');
      return adminApi.correctClientStockAdd(id, payload.eventId, {
        qty: payload.qty,
        occurredAt: payload.occurredAt,
        unitPrice: payload.unitPrice,
        ...(payload.reason ? { reason: payload.reason } : {}),
      });
    },
    onSuccess: () => {
      message.success('Поступление обновлено');
      setStockCorrectOpen(false);
      setStockCorrectEventId(null);
      stockCorrectForm.resetFields();
      invalidateAfterStockAdmin();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка сохранения';
      message.error(msg);
    },
  });

  const deleteStockAddMut = useMutation({
    mutationFn: (payload: { eventId: string; reason?: string }) => {
      if (!id) throw new Error('Клиент не выбран');
      return adminApi.deleteClientStockAdd(id, payload.eventId, payload.reason ? { reason: payload.reason } : {});
    },
    onSuccess: () => {
      message.success('Поступление удалено, товар возвращён на основной склад');
      setStockCorrectOpen(false);
      setStockCorrectEventId(null);
      stockCorrectForm.resetFields();
      invalidateAfterStockAdmin();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка удаления';
      message.error(msg);
    },
  });

  const stockEventColumns: ColumnsType<StockEventTableRow> = useMemo(() => {
    const base: ColumnsType<StockEventTableRow> = [
      { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
      {
        title: 'Тип',
        dataIndex: 'type',
        render: (v: string) =>
          v === 'ADD' ? <Tag color="green">Добавление</Tag> : v === 'RESERVE_TO_DEAL' ? <Tag color="blue">Отправка в работу</Tag> : <Tag>Коррекция</Tag>,
      },
      {
        title: 'Товар',
        dataIndex: ['product', 'name'],
        render: (_: unknown, r: StockEventTableRow) => (r.product ? `${r.product.name} (${r.product.sku})` : '—'),
      },
      {
        title: 'Изменение',
        dataIndex: 'qtyDelta',
        align: 'right' as const,
        render: (v: number, r: StockEventTableRow) => `${v > 0 ? '+' : ''}${v} ${r.product?.unit ?? ''}`.trim(),
      },
      {
        title: 'Цена',
        dataIndex: 'unitPrice',
        align: 'right' as const,
        render: (v: number | null | undefined) => (v != null ? formatUZS(v) : '—'),
      },
      {
        title: 'Сумма',
        dataIndex: 'lineTotal',
        align: 'right' as const,
        render: (v: number | null | undefined) => (v != null ? formatUZS(v) : '—'),
      },
      {
        title: 'Было → Стало',
        key: 'beforeAfter',
        render: (_: unknown, r: StockEventTableRow) => `${r.qtyBefore} → ${r.qtyAfter} ${r.product?.unit ?? ''}`.trim(),
      },
      { title: 'Кто', dataIndex: ['author', 'fullName'], render: (v: string | undefined) => v || '—' },
      {
        title: 'Сделка',
        dataIndex: ['sourceDeal', 'id'],
        render: (_: unknown, r: StockEventTableRow) =>
          r.sourceDeal ? <Link to={`/deals/${r.sourceDeal.id}`}>{r.sourceDeal.title}</Link> : '—',
      },
      { title: 'Комментарий', dataIndex: 'comment', render: (v: string | null | undefined) => v || '—' },
    ];
    if (user?.role !== 'SUPER_ADMIN') {
      return base;
    }
    return [
      ...base,
      {
        title: 'Супер',
        key: 'superStockCorrect',
        width: 96,
        render: (_: unknown, r: StockEventTableRow) =>
          r.type === 'ADD' ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setStockCorrectEventId(r.id);
                stockCorrectForm.setFieldsValue({
                  qty: r.qtyDelta,
                  occurredAt: dayjs(r.createdAt),
                  unitPrice: r.unitPrice ?? null,
                  reason: undefined,
                });
                setStockCorrectOpen(true);
              }}
            >
              Дата/кол-во
            </Button>
          ) : (
            '—'
          ),
      },
    ];
  }, [user?.role, stockCorrectForm]);

  // Client-side filtering of deals by payment status
  const filteredDeals = useMemo(() => {
    const deals = client?.deals ?? [];
    if (paymentFilter === 'ALL') return deals;
    return deals.filter((d) => getPaymentCategory(d) === paymentFilter);
  }, [client?.deals, paymentFilter]);

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!client) return <Typography.Text>Клиент не найден</Typography.Text>;

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.permissions?.includes('edit_client');

  const openPortraitEdit = () => {
    portraitForm.setFieldsValue({
      portraitProfile: client.portraitProfile || '',
      portraitGoals: client.portraitGoals || '',
      portraitPains: client.portraitPains || '',
      portraitFears: client.portraitFears || '',
      portraitObjections: client.portraitObjections || '',
    });
    setPortraitOpen(true);
  };

  const portraitTemplateMenu = (field: ClientPortraitField) => ({
    items: CLIENT_PORTRAIT_TEMPLATES[field].map((t, i) => ({
      key: `${field}-${i}`,
      label: t.label,
      onClick: () => {
        const cur = portraitForm.getFieldValue(field) as string | undefined;
        portraitForm.setFieldValue(field, appendPortraitSnippet(cur, t.text));
      },
    })),
  });

  const portraitBlocks: { field: keyof CreateClientData; title: string; hint: string }[] = [
    { field: 'portraitProfile', title: 'Кто клиент', hint: 'Сегмент, роль ЛПР, контекст бизнеса' },
    { field: 'portraitGoals', title: 'Цели', hint: 'Чего хотят достичь в закупке / проекте' },
    { field: 'portraitPains', title: 'Боли', hint: 'Что сейчас не устраивает' },
    { field: 'portraitFears', title: 'Страхи', hint: 'Чего опасаются при смене поставщика или крупной сделке' },
    { field: 'portraitObjections', title: 'Возражения', hint: 'Типичные ответы «нет» и формулировки' },
  ];

  const openEdit = () => {
    editForm.setFieldsValue({
      companyName: client.companyName,
      contactName: client.contactName,
      phone: client.phone || '+998',
      email: client.email || '',
      address: client.address || '',
      latitude: client.latitude ?? undefined,
      longitude: client.longitude ?? undefined,
      notes: client.notes || '',
      inn: client.inn || '',
      bankName: client.bankName || '',
      bankAccount: client.bankAccount || '',
      mfo: client.mfo || '',
      vatRegCode: client.vatRegCode || '',
      oked: client.oked || '',
    });
    setEditOpen(true);
  };

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const contractColumns = [
    { title: 'Номер', dataIndex: 'contractNumber', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Дата начала', dataIndex: 'startDate', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    { title: 'Дата окончания', dataIndex: 'endDate', render: (v: string | null) => v ? dayjs(v).format('DD.MM.YYYY') : '—' },
    { title: 'Статус', dataIndex: 'isActive', render: (v: boolean) => v ? <Tag color="green">Активен</Tag> : <Tag>Неактивен</Tag> },
    { title: 'Примечание', dataIndex: 'notes', render: (v: string | null) => v || '—' },
  ];

  const dealColumns = [
    { title: 'Сделка', dataIndex: 'title', render: (v: string, r: DealShort) => <Link to={`/deals/${r.id}`}>{v}</Link> },
    { title: 'Статус', dataIndex: 'status', render: (s: DealStatus) => <DealStatusTag status={s} /> },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Оплачено', dataIndex: 'paidAmount', align: 'right' as const, render: (v: string | undefined) => formatUZS(v ?? 0) },
    {
      title: 'Остаток', key: 'remaining', align: 'right' as const,
      render: (_: unknown, r: DealShort) => {
        const diff = Number(r.amount) - Number(r.paidAmount ?? 0);
        if (diff > 0) {
          return <Typography.Text type="danger">{formatUZS(diff)}</Typography.Text>;
        }
        if (diff < 0) {
          return <Typography.Text type="success">Переплата: {formatUZS(Math.abs(diff))}</Typography.Text>;
        }
        return <Typography.Text type="success">{formatUZS(0)}</Typography.Text>;
      },
    },
    { title: 'Дата', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY') },
    {
      title: 'Оплата', dataIndex: 'paymentStatus', render: (s: PaymentStatus | undefined) => {
        if (!s) return '—';
        const cfg = paymentStatusLabels[s];
        return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
      },
    },
  ];

  const paymentColumns = [
    { title: 'Сделка', dataIndex: ['deal', 'title'], render: (v: string, r: PaymentRecord) => r.deal ? <Link to={`/deals/${r.dealId}`}>{v}</Link> : '—' },
    { title: 'Сумма', dataIndex: 'amount', align: 'right' as const, render: (v: string) => formatUZS(v) },
    { title: 'Способ', dataIndex: 'method', render: (v: string | null) => v || '—' },
    { title: 'Дата оплаты', dataIndex: 'paidAt', render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm') },
    { title: 'Кем внесено', dataIndex: ['creator', 'fullName'], render: (v: string) => v || '—' },
    { title: 'Примечание', dataIndex: 'note', render: (v: string | null) => v || '—' },
  ];

  const submitAddStock = () => {
    if (!stockProductId) {
      message.error('Выберите товар');
      return;
    }
    if (!stockQty || stockQty <= 0) {
      message.error('Укажите корректное количество');
      return;
    }
    addStockMut.mutate({
      items: [{ productId: stockProductId, qty: stockQty, price: stockPrice, comment: stockComment || undefined }],
    });
  };

  const sendOnePositionToWork = (productId: string) => {
    const position = stockData?.positions.find((p) => p.productId === productId);
    if (!position || position.qtyTotal <= 0) {
      message.error('Нет доступного остатка');
      return;
    }
    setStockSendProductId(productId);
    setStockSendQty(Number(position.qtyTotal));
    setStockSendModalOpen(true);
  };

  const confirmSendOnePositionToWork = () => {
    if (!stockSendProductId) return;
    const position = stockData?.positions.find((p) => p.productId === stockSendProductId);
    if (!position || position.qtyTotal <= 0) {
      message.error('Нет доступного остатка');
      return;
    }
    if (!stockSendQty || stockSendQty <= 0) {
      message.error('Укажите корректное количество');
      return;
    }
    if (stockSendQty > Number(position.qtyTotal)) {
      message.error('Нельзя отправить больше, чем доступный остаток');
      return;
    }
    sendStockPartialMut.mutate({
      items: [{
        productId: stockSendProductId,
        qty: stockSendQty,
        price: position.product?.salePrice ?? undefined,
      }],
    });
    setStockSendModalOpen(false);
  };

  /** Оценка стоимости остатков: Σ (кол-во × цена из карточки товара), где цена задана. */
  const stockPositionsEstimatedTotal = useMemo(() => {
    let s = 0;
    for (const p of stockData?.positions ?? []) {
      const px = p.product?.salePrice;
      if (px != null) s += Number(p.qtyTotal) * Number(px);
    }
    return s;
  }, [stockData?.positions]);

  const stockPositionsColumns = useMemo((): ColumnsType<StockPositionTableRow> => {
    const cols: ColumnsType<StockPositionTableRow> = [
      {
        title: 'Товар',
        dataIndex: ['product', 'name'],
        render: (_: unknown, r: StockPositionTableRow) => (r.product ? `${r.product.name} (${r.product.sku})` : '—'),
      },
      {
        title: 'Остаток',
        dataIndex: 'qtyTotal',
        align: 'right' as const,
        render: (v: number, r: StockPositionTableRow) => `${v} ${r.product?.unit ?? ''}`.trim(),
      },
      {
        title: 'Цена',
        key: 'unitPrice',
        align: 'right' as const,
        render: (_: unknown, r: StockPositionTableRow) =>
          r.product?.salePrice != null ? formatUZS(r.product.salePrice) : '—',
      },
      {
        title: 'Сумма',
        key: 'lineTotal',
        align: 'right' as const,
        render: (_: unknown, r: StockPositionTableRow) => {
          const px = r.product?.salePrice;
          if (px == null) return '—';
          return formatUZS(Number(r.qtyTotal) * Number(px));
        },
      },
    ];
    if (user?.role === 'SUPER_ADMIN') {
      cols.push({
        title: 'Поступления',
        key: 'addEvents',
        width: 140,
        render: (_: unknown, r: StockPositionTableRow) => {
          const adds = (stockData?.events ?? []).filter((e) => e.type === 'ADD' && e.productId === r.productId);
          if (!adds.length) return '—';
          return (
            <Space direction="vertical" size={0}>
              {adds.map((e) => (
                <Button
                  key={e.id}
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto', textAlign: 'left' }}
                  onClick={() => {
                    setStockCorrectEventId(e.id);
                    stockCorrectForm.setFieldsValue({
                      qty: e.qtyDelta,
                      occurredAt: dayjs(e.createdAt),
                      unitPrice: e.unitPrice ?? null,
                      reason: undefined,
                    });
                    setStockCorrectOpen(true);
                  }}
                >
                  {dayjs(e.createdAt).format('DD.MM')} (+{e.qtyDelta})
                </Button>
              ))}
            </Space>
          );
        },
      });
    }
    cols.push({
      title: 'Действие',
      key: 'action',
      render: (_: unknown, r: StockPositionTableRow) => (
        <Button size="small" onClick={() => sendOnePositionToWork(r.productId)} loading={sendStockPartialMut.isPending}>
          Отправить в работу
        </Button>
      ),
    });
    return cols;
  }, [user?.role, stockData?.events, stockData?.positions, stockCorrectForm, sendStockPartialMut.isPending]);

  // ── Analytics chart data ──
  const lineData = (analytics?.revenueByDay ?? []).map((d) => ({
    date: d.date.slice(5),
    amount: d.amount,
  }));

  const barData = (analytics?.topProducts ?? []).map((p) => ({
    name: p.productName,
    value: p.totalQuantity,
  }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space size={8} align="center">
          <BackButton fallback="/clients" />
          <Typography.Title level={4} style={{ margin: 0 }}>
            <ClientCompanyDisplay
              client={{
                id: client.id,
                companyName: client.companyName,
                isSvip: client.isSvip,
                creditStatus: client.creditStatus,
              }}
              variant="full"
            />
          </Typography.Title>
        </Space>
        <Space>
          {isAdmin && (
            <Button
              icon={<CrownFilled style={{ color: client.isSvip ? '#faad14' : '#d9d9d9' }} />}
              onClick={() => svipMut.mutate()}
              loading={svipMut.isPending}
            >
              {client.isSvip ? 'Убрать SVIP' : 'Сделать SVIP'}
            </Button>
          )}
          {isAdmin && (
            <Select<'NORMAL' | 'SATISFACTORY' | 'NEGATIVE'>
              size="middle"
              value={client.creditStatus || 'NORMAL'}
              style={{ width: 180 }}
              onChange={(value) => creditStatusMut.mutate(value)}
              options={[
                { value: 'NORMAL', label: 'Статус: обычный' },
                { value: 'SATISFACTORY', label: 'Статус: У (огранич.)' },
                { value: 'NEGATIVE', label: 'Статус: Н (без долга)' },
              ]}
            />
          )}
          {canEdit && <Button type="primary" icon={<EditOutlined />} onClick={openEdit}>Редактировать</Button>}
        </Space>
      </div>

      <Tabs
        defaultActiveKey="info"
        items={[
          {
            key: 'info',
            label: 'Информация',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card bordered={false}>
                  <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                    <Descriptions.Item label="Контакт">{client.contactName}</Descriptions.Item>
                    <Descriptions.Item label="Телефон">{client.phone || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Telegram">{client.email || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Адрес">{client.address || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Координаты">
                      {(client.latitude != null && client.longitude != null)
                        ? `${client.latitude.toFixed(6)}, ${client.longitude.toFixed(6)}`
                        : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Менеджер">{client.manager?.fullName}</Descriptions.Item>
                    <Descriptions.Item label="Кредитный статус">
                      {client.creditStatus === 'NEGATIVE'
                        ? 'Н — Негатив (без долга)'
                        : client.creditStatus === 'SATISFACTORY'
                          ? 'У — Удовлетворительный (ограниченный долг)'
                          : 'Обычный'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Заметки">{client.notes || '—'}</Descriptions.Item>
                  </Descriptions>
                  {(client.inn || client.bankName || client.bankAccount || client.mfo || client.vatRegCode || client.oked) && (
                    <Collapse size="small" ghost style={{ marginTop: 12 }} items={[{
                      key: 'requisites',
                      label: 'Реквизиты',
                      children: (
                        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                          <Descriptions.Item label="ИНН">{client.inn || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Банк">{client.bankName || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Р/С">{client.bankAccount || '—'}</Descriptions.Item>
                          <Descriptions.Item label="МФО">{client.mfo || '—'}</Descriptions.Item>
                          <Descriptions.Item label="Рег. код НДС">{client.vatRegCode || '—'}</Descriptions.Item>
                          <Descriptions.Item label="ОКЭД">{client.oked || '—'}</Descriptions.Item>
                        </Descriptions>
                      ),
                    }]} />
                  )}
                </Card>
                {(client.latitude != null && client.longitude != null) || client.address?.trim() ? (
                  <Card title="Местоположение" bordered={false}>
                    <iframe
                      title="Карта клиента"
                      src={
                        (client.latitude != null && client.longitude != null)
                          ? buildYandexMapUrlByCoords(client.latitude, client.longitude)
                          : buildYandexMapUrlByAddress(client.address!)
                      }
                      style={{ border: 0, borderRadius: 8 }}
                      width="100%"
                      height={280}
                      loading="lazy"
                    />
                    <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                      <a
                        href={
                          (client.latitude != null && client.longitude != null)
                            ? buildYandexMapsOpenUrlByCoords(client.latitude, client.longitude)
                            : buildYandexMapsOpenUrlByAddress(client.address!)
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть в Яндекс.Картах
                      </a>
                    </Typography.Paragraph>
                  </Card>
                ) : null}

                <Card title="Договоры" extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setContractModal(true)}>Создать</Button>} bordered={false}>
                  <Table
                    dataSource={contracts ?? []}
                    columns={contractColumns}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    bordered={false}
                    locale={{ emptyText: 'Нет договоров' }}
                    scroll={{ x: 500 }}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'portrait',
            label: (
              <span>
                <IdcardOutlined /> Портрет клиента
              </span>
            ),
            children: (
              <Card
                bordered={false}
                extra={
                  canEdit ? (
                    <Button type="primary" icon={<EditOutlined />} onClick={openPortraitEdit}>
                      Редактировать
                    </Button>
                  ) : null
                }
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  Отдельно от заметок: фиксированные блоки для подготовки к звонкам, КП и сделкам.
                </Typography.Paragraph>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {portraitBlocks.map(({ field, title, hint }) => {
                    const text = client[field as keyof typeof client] as string | null | undefined;
                    return (
                      <Card key={field} size="small" title={title}>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                          {hint}
                        </Typography.Text>
                        <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                          {text?.trim() ? text : '—'}
                        </Typography.Paragraph>
                      </Card>
                    );
                  })}
                </Space>
              </Card>
            ),
          },
          {
            key: 'deals',
            label: 'Сделки',
            children: (
              <Card
                bordered={false}
                extra={
                  <Segmented
                    value={paymentFilter}
                    onChange={(v) => setPaymentFilter(v as PaymentFilter)}
                    options={paymentFilterOptions}
                  />
                }
              >
                <Table
                  dataSource={filteredDeals}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  bordered={false}
                  columns={dealColumns}
                  locale={{ emptyText: 'Нет сделок' }}
                  scroll={{ x: 500 }}
                  summary={() => {
                    const deals = filteredDeals.filter((d) => d.status !== 'CANCELED');
                    if (deals.length === 0) return null;
                    const totalAmount = deals.reduce((s, d) => s + Number(d.amount), 0);
                    const totalPaid = deals.reduce((s, d) => s + Number(d.paidAmount ?? 0), 0);
                    const totalDiff = totalAmount - totalPaid;
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}>
                          <Typography.Text strong>Итого (без отмен): {deals.length} сделок</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          <Typography.Text strong>{formatUZS(totalAmount)}</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right">
                          <Typography.Text strong>{formatUZS(totalPaid)}</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">
                          <Typography.Text strong type={totalDiff > 0 ? 'danger' : 'success'}>
                            {totalDiff < 0 ? `Переплата: ${formatUZS(Math.abs(totalDiff))}` : formatUZS(Math.max(totalDiff, 0))}
                          </Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} colSpan={2} />
                      </Table.Summary.Row>
                    );
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'stock',
            label: 'Товары клиента',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Card
                  title="Добавить в накопление"
                  bordered={false}
                  extra={(
                    <Button type="primary" onClick={submitAddStock} loading={addStockMut.isPending}>
                      Добавить
                    </Button>
                  )}
                >
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={10}>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Товар</Typography.Text>
                      <Select
                        showSearch
                        filterOption={smartFilterOption}
                        placeholder="Выберите товар"
                        value={stockProductId}
                        onChange={(v) => {
                          setStockProductId(v);
                          const p = (products ?? []).find((x: Product) => x.id === v);
                          setStockPrice(p?.salePrice != null ? Number(p.salePrice) : undefined);
                        }}
                        style={{ width: '100%' }}
                        options={(products ?? []).filter((p: Product) => p.isActive).map((p: Product) => ({
                          value: p.id,
                          label: `${p.name} (${p.sku})`,
                        }))}
                      />
                    </Col>
                    <Col xs={24} sm={8} md={4}>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Количество</Typography.Text>
                      <InputNumber min={0.001} step={0.1} precision={3} value={stockQty} onChange={(v) => setStockQty(Number(v ?? 0))} style={{ width: '100%' }} />
                    </Col>
                    <Col xs={24} sm={8} md={5}>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Цена</Typography.Text>
                      <InputNumber min={0} value={stockPrice} onChange={(v) => setStockPrice(v == null ? undefined : Number(v))} formatter={(v) => formatUZS(Number(v || 0)).replace(' UZS', '')} parser={(v) => Number((v || '').toString().replace(/[^\d.]/g, '')) as unknown as number} style={{ width: '100%' }} />
                    </Col>
                    <Col xs={24} sm={8} md={5}>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>Комментарий</Typography.Text>
                      <Input value={stockComment} onChange={(e) => setStockComment(e.target.value)} placeholder="Примечание" />
                    </Col>
                  </Row>
                </Card>

                <Card
                  title={`Остатки (${stockData?.totals.distinctProducts ?? 0})`}
                  bordered={false}
                  loading={stockLoading}
                  extra={(
                    <Space wrap>
                      <Typography.Text strong>Всего: {stockData?.totals.totalQty ?? 0}</Typography.Text>
                      {stockPositionsEstimatedTotal > 0 && (
                        <Typography.Text type="secondary">
                          Оценка: <Typography.Text strong>{formatUZS(stockPositionsEstimatedTotal)}</Typography.Text>
                        </Typography.Text>
                      )}
                      <Button type="primary" onClick={() => sendStockAllMut.mutate()} loading={sendStockAllMut.isPending} disabled={!stockData?.positions?.length}>
                        Отправить все в работу
                      </Button>
                    </Space>
                  )}
                >
                  <Table<StockPositionTableRow>
                    dataSource={(stockData?.positions ?? []).map((p) => ({ ...p, key: p.id }))}
                    columns={stockPositionsColumns}
                    pagination={false}
                    size="small"
                    scroll={{ x: user?.role === 'SUPER_ADMIN' ? 980 : 820 }}
                  />
                </Card>

                <Card title="История изменений" bordered={false} loading={stockLoading}>
                  <Table<StockEventTableRow>
                    dataSource={(stockData?.events ?? []).map((e) => ({ ...e, key: e.id }))}
                    columns={stockEventColumns}
                    pagination={{ pageSize: 10 }}
                    size="small"
                    scroll={{ x: 1000 }}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'analytics',
            label: 'Аналитика',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Segmented
                    value={analyticsPeriod}
                    onChange={(v) => setAnalyticsPeriod(v as number)}
                    options={[
                      { label: '30 дней', value: 30 },
                      { label: '90 дней', value: 90 },
                      { label: 'Год', value: 365 },
                    ]}
                  />
                </div>

                {analytics && (
                  <>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Всего сделок" value={analytics.metrics.totalDeals} prefix={<ShoppingCartOutlined />} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Завершено" value={analytics.metrics.completedDeals} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Отменено" value={analytics.metrics.canceledDeals} prefix={<CloseCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Общая сумма" value={analytics.metrics.totalSpent} formatter={(v) => formatUZS(v as number)} prefix={<DollarOutlined />} valueStyle={{ color: '#52c41a' }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Долг" value={analytics.metrics.currentDebt} formatter={(v) => formatUZS(v as number)} prefix={<WarningOutlined />} valueStyle={{ color: analytics.metrics.currentDebt > 0 ? '#ff4d4f' : undefined }} />
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} lg={4}>
                        <Card bordered={false} size="small">
                          <Statistic title="Последняя оплата" value={analytics.metrics.lastPaymentDate ? dayjs(analytics.metrics.lastPaymentDate).format('DD.MM.YYYY') : '—'} />
                        </Card>
                      </Col>
                    </Row>

                    {/* Debt breakdown: total amount, total paid, overpayment info */}
                    {(() => {
                      const allDeals = client?.deals ?? [];
                      const activeDeals = allDeals.filter((d) => d.status !== 'CANCELED' && d.status !== 'REJECTED');
                      const unpaidDeals = activeDeals.filter((d) => (d.paymentStatus === 'UNPAID' || d.paymentStatus === 'PARTIAL'));
                      const debtFromUnpaid = unpaidDeals.reduce((s, d) => s + Math.max(0, Number(d.amount) - Number(d.paidAmount ?? 0)), 0);
                      const overpaid = activeDeals.reduce((s, d) => {
                        const diff = Number(d.paidAmount ?? 0) - Number(d.amount);
                        return diff > 0 ? s + diff : s;
                      }, 0);
                      const netDebt = debtFromUnpaid - overpaid;
                      if (unpaidDeals.length === 0 && overpaid === 0) return null;
                      return (
                        <Card bordered={false} size="small" style={{ marginTop: 8 }}>
                          <Row gutter={[16, 8]}>
                            <Col xs={24} sm={8}>
                              <Typography.Text type="secondary">Общий долг: </Typography.Text>
                              <Typography.Text strong style={{ color: netDebt > 0 ? '#ff4d4f' : netDebt < 0 ? '#52c41a' : undefined }}>
                                {netDebt > 0 ? formatUZS(netDebt) : netDebt < 0 ? `Переплата: ${formatUZS(Math.abs(netDebt))}` : formatUZS(0)}
                              </Typography.Text>
                            </Col>
                            <Col xs={24} sm={8}>
                              <Typography.Text type="secondary">Неопл. сделок: </Typography.Text>
                              <Typography.Text strong>{unpaidDeals.length}</Typography.Text>
                              <Typography.Text type="secondary"> на {formatUZS(debtFromUnpaid)}</Typography.Text>
                            </Col>
                            {overpaid > 0 && (
                              <Col xs={24} sm={8}>
                                <Tag color="green">Переплата: {formatUZS(overpaid)}</Tag>
                              </Col>
                            )}
                          </Row>
                        </Card>
                      );
                    })()}

                    <Row gutter={[16, 16]}>
                      <Col xs={24} lg={14}>
                        <Card title="Выручка по дням" bordered={false}>
                          {lineData.length > 0 ? (
                            <Line
                              data={lineData}
                              xField="date"
                              yField="amount"
                              height={280}
                              smooth
                              point={{ size: 3, shape: 'circle' }}
                              yAxis={{ label: { formatter: (v: string) => formatUZS(Number(v)) } }}
                              theme={chartTheme}
                              axis={{
                                x: { labelFill: token.colorText },
                                y: { labelFill: token.colorText },
                              }}
                            />
                          ) : (
                            <Typography.Text type="secondary">Нет данных за период</Typography.Text>
                          )}
                        </Card>
                      </Col>
                      <Col xs={24} lg={10}>
                        <Card title="Топ товаров" bordered={false}>
                          {barData.length > 0 ? (
                            <Bar
                              data={barData}
                              xField="name"
                              yField="value"
                              height={280}
                              theme={chartTheme}
                              axis={{
                                x: { labelFill: token.colorText },
                                y: { labelFill: token.colorText },
                              }}
                            />
                          ) : (
                            <Typography.Text type="secondary">Нет данных</Typography.Text>
                          )}
                        </Card>
                      </Col>
                    </Row>
                  </>
                )}
              </Space>
            ),
          },
          {
            key: 'payments',
            label: 'Платежи',
            children: (
              <Card bordered={false}>
                <Table
                  dataSource={payments ?? []}
                  columns={paymentColumns}
                  rowKey="id"
                  pagination={{ pageSize: 20 }}
                  size="small"
                  bordered={false}
                  locale={{ emptyText: 'Нет платежей' }}
                  scroll={{ x: 500 }}
                  summary={() => {
                    const list = payments ?? [];
                    if (list.length === 0) return null;
                    const total = list.reduce((s, p) => s + Number(p.amount), 0);
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0}><Typography.Text strong>Итого: {list.length}</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><Typography.Text strong>{formatUZS(total)}</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} colSpan={4} />
                      </Table.Summary.Row>
                    );
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'notes',
            label: (
              <span>
                <CommentOutlined /> Заметки
              </span>
            ),
            children: <ClientNotesPanel clientId={id!} />,
          },
          {
            key: 'history',
            label: 'История',
            children: (
              <Card bordered={false}>
                <ClientAuditHistoryPanel logs={history} isLoading={historyLoading} />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title="Новый договор"
        open={contractModal}
        onCancel={() => setContractModal(false)}
        onOk={() => contractForm.submit()}
        confirmLoading={createContractMut.isPending}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form form={contractForm} layout="vertical" onFinish={(v) => createContractMut.mutate({ ...v, clientId: id!, startDate: v.startDate.format('YYYY-MM-DD'), endDate: v.endDate ? v.endDate.format('YYYY-MM-DD') : undefined })}>
          <Form.Item name="contractNumber" label="Номер договора" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="startDate" label="Дата начала" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="endDate" label="Дата окончания">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="notes" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Портрет клиента"
        open={portraitOpen}
        onCancel={() => setPortraitOpen(false)}
        onOk={() => portraitForm.submit()}
        confirmLoading={updateClientMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={720}
      >
        <Form
          form={portraitForm}
          layout="vertical"
          onFinish={(v) =>
            updateClientMut.mutate({
              portraitProfile: v.portraitProfile,
              portraitGoals: v.portraitGoals,
              portraitPains: v.portraitPains,
              portraitFears: v.portraitFears,
              portraitObjections: v.portraitObjections,
            })
          }
        >
          {portraitBlocks.map(({ field, title, hint }) => (
            <Form.Item
              key={field}
              name={field}
              label={
                <Space wrap size="small" align="baseline">
                  <Typography.Text strong>{title}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                    {hint}
                  </Typography.Text>
                  <Dropdown menu={portraitTemplateMenu(field as ClientPortraitField)} trigger={['click']}>
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }}>
                      Вставить шаблон
                    </Button>
                  </Dropdown>
                </Space>
              }
            >
              <Input.TextArea rows={4} placeholder="Кратко, для себя и команды…" />
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <Modal
        title="Отправить в работу"
        open={stockSendModalOpen}
        onCancel={() => setStockSendModalOpen(false)}
        onOk={confirmSendOnePositionToWork}
        okText="Отправить"
        cancelText="Отмена"
        confirmLoading={sendStockPartialMut.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Typography.Text type="secondary">
            Доступный остаток: {stockData?.positions.find((p) => p.productId === stockSendProductId)?.qtyTotal ?? 0}
          </Typography.Text>
          <InputNumber
            min={0.001}
            precision={3}
            step={0.1}
            value={stockSendQty}
            onChange={(v) => setStockSendQty(Number(v ?? 0))}
            style={{ width: '100%' }}
          />
        </Space>
      </Modal>

      <Modal
        title="Правка поступления на склад клиента"
        open={stockCorrectOpen}
        onCancel={() => {
          setStockCorrectOpen(false);
          setStockCorrectEventId(null);
          stockCorrectForm.resetFields();
        }}
        onOk={() => stockCorrectForm.submit()}
        confirmLoading={correctStockAddMut.isPending || deleteStockAddMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        width={520}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
          Количество, дата и цена влияют на выручку и движение склада. Итоговая сумма = количество × цена. Удаление возвращает количество на основной склад (нельзя, если уже списали больше, чем осталось бы после удаления).
        </Typography.Paragraph>
        <Form
          form={stockCorrectForm}
          layout="vertical"
          onFinish={(v) => {
            if (!stockCorrectEventId || !id) return;
            const qty = Number(v.qty);
            if (!qty || qty <= 0) {
              message.error('Укажите количество больше 0');
              return;
            }
            if (!v.occurredAt) {
              message.error('Укажите дату поступления');
              return;
            }
            const nextAt = dayjs(v.occurredAt).toISOString();
            const rawP = v.unitPrice as number | null | undefined;
            const nextPrice = rawP === undefined || rawP === null ? null : Number(rawP);
            const orig = stockData?.events?.find((e) => e.id === stockCorrectEventId);
            const origP = orig?.unitPrice != null ? Number(orig.unitPrice) : null;
            if (
              orig &&
              qty === orig.qtyDelta &&
              dayjs(nextAt).valueOf() === dayjs(orig.createdAt).valueOf() &&
              (nextPrice ?? null) === (origP ?? null)
            ) {
              message.info('Нет изменений');
              return;
            }
            correctStockAddMut.mutate({
              eventId: stockCorrectEventId,
              qty,
              occurredAt: nextAt,
              unitPrice: nextPrice,
              reason: (v.reason as string | undefined)?.trim() || undefined,
            });
          }}
        >
          <Form.Item name="qty" label="Количество" rules={[{ required: true, message: 'Обязательно' }]}>
            <InputNumber min={0.001} step={0.1} precision={3} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="occurredAt" label="Дата и время поступления" rules={[{ required: true, message: 'Обязательно' }]}>
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="unitPrice" label="Цена за ед.">
            <InputNumber min={0} step={1000} style={{ width: '100%' }} placeholder="Пусто — без суммы в выручке" />
          </Form.Item>
          <Typography.Paragraph style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">Итоговая сумма: </Typography.Text>
            <Typography.Text strong>
              {watchedCorrectQty != null &&
              watchedCorrectPrice != null &&
              !Number.isNaN(Number(watchedCorrectQty)) &&
              !Number.isNaN(Number(watchedCorrectPrice))
                ? formatUZS(Number(watchedCorrectQty) * Number(watchedCorrectPrice))
                : '—'}
            </Typography.Text>
          </Typography.Paragraph>
          <Form.Item name="reason" label="Причина (аудит)">
            <Input placeholder="Необязательно" />
          </Form.Item>
          <Popconfirm
            title="Удалить это поступление?"
            description="Товар вернётся на основной склад. Действие необратимо в смысле истории (запись удалится)."
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              if (!stockCorrectEventId || !id) return;
              const reason = (stockCorrectForm.getFieldValue('reason') as string | undefined)?.trim();
              deleteStockAddMut.mutate({ eventId: stockCorrectEventId, ...(reason ? { reason } : {}) });
            }}
          >
            <Button danger loading={deleteStockAddMut.isPending} disabled={correctStockAddMut.isPending}>
              Удалить поступление
            </Button>
          </Popconfirm>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="Редактировать клиента"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={updateClientMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={editForm} layout="vertical" onFinish={(v) => updateClientMut.mutate(v)}>
          <Form.Item name="companyName" label="Компания" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="Контактное лицо" rules={[{ required: true, message: 'Обязательное поле' }]}>
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="phone" label="Телефон" style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
              <Input placeholder="+998 99 999 99 99" />
            </Form.Item>
            <Form.Item name="email" label="Telegram" style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
              <Input placeholder="@username" />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="Адрес">
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="latitude" label="Широта" style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
              <InputNumber min={-90} max={90} precision={6} step={0.000001} style={{ width: '100%' }} placeholder="41.311081" />
            </Form.Item>
            <Form.Item name="longitude" label="Долгота" style={{ flex: 1, width: isMobile ? '100%' : undefined }}>
              <InputNumber min={-180} max={180} precision={6} step={0.000001} style={{ width: '100%' }} placeholder="69.240562" />
            </Form.Item>
          </Space>
          <Form.Item label="Вставить координаты">
            <Input
              placeholder="41.273454, 69.286142"
              onBlur={(e) => {
                const text = e.target.value.trim();
                if (!text) return;
                const parsed = parseCoordinatesText(text);
                if (!parsed) {
                  message.warning('Не удалось распознать координаты');
                  return;
                }
                editForm.setFieldsValue({
                  latitude: parsed.latitude,
                  longitude: parsed.longitude,
                });
              }}
            />
          </Form.Item>
          <Form.Item name="notes" label="Заметки">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Collapse size="small" ghost items={[{
            key: 'requisites',
            label: 'Реквизиты (ИНН, банк, МФО)',
            children: (
              <>
                <Form.Item name="inn" label="ИНН">
                  <Input placeholder="123456789" />
                </Form.Item>
                <Form.Item name="bankName" label="Банк">
                  <Input placeholder="АКБ ..." />
                </Form.Item>
                <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
                  <Form.Item name="bankAccount" label="Расчётный счёт" style={{ flex: 1 }}>
                    <Input placeholder="20208000..." />
                  </Form.Item>
                  <Form.Item name="mfo" label="МФО" style={{ flex: 1 }}>
                    <Input placeholder="00000" />
                  </Form.Item>
                </Space>
                <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
                  <Form.Item name="vatRegCode" label="Рег. код НДС" style={{ flex: 1 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="oked" label="ОКЭД" style={{ flex: 1 }}>
                    <Input />
                  </Form.Item>
                </Space>
              </>
            ),
          }]} />
        </Form>
      </Modal>
    </div>
  );
}
