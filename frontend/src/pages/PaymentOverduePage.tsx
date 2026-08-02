import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CalendarOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { useAuthStore } from '../store/authStore';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import ReceiptPunchedTag from '../components/ReceiptPunchedTag';
import { APP_INPUT } from '../components/ui/AppClassNames';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS } from '../utils/currency';
import { matchesSearch, smartFilterOption } from '../utils/translit';
import type { PaymentOverdueBucket, PaymentOverdueDealRow } from '../types';
import { getFirstName } from '../lib/name-utils';
import './PaymentOverduePage.css';

const { Title, Text } = Typography;

const ALL_BUCKETS: PaymentOverdueBucket[] = ['OVERDUE', 'DUE_SOON', 'UPCOMING', 'NO_DUE_DATE'];

const BUCKET_META: Record<PaymentOverdueBucket, { label: string; color: string }> = {
  OVERDUE: { label: 'Просрочено', color: 'red' },
  DUE_SOON: { label: 'Срок скоро', color: 'orange' },
  UPCOMING: { label: 'В сроке', color: 'blue' },
  NO_DUE_DATE: { label: 'Без срока', color: 'default' },
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  FULL: 'Полная (остаток долга)',
  PARTIAL: 'Частично в долг',
  INSTALLMENT: 'Рассрочка',
};

/** По умолчанию: просрочка + скоро срок + долги без даты (без далёких сроков). */
const ATTENTION_BUCKETS: PaymentOverdueBucket[] = ['OVERDUE', 'DUE_SOON', 'NO_DUE_DATE'];

/** 'custom' — произвольный набор бакетов из селекта, ни одна кнопка-пресет не активна. */
type PresetKey = 'attention' | 'overdue' | 'due_soon' | 'no_due' | 'all' | 'custom';

const PRESET_KEYS: PresetKey[] = ['attention', 'overdue', 'due_soon', 'no_due', 'all', 'custom'];

type SortBy = 'overdue_desc' | 'due_asc' | 'remaining_desc' | 'client_asc';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

/** Кто может проставлять срок оплаты (совпадает с authorize на бэкенде). */
const DUE_DATE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'];

const DUE_DATE_PRESETS: { label: string; get: () => Dayjs }[] = [
  { label: 'Сегодня', get: () => dayjs() },
  { label: '+3 дня', get: () => dayjs().add(3, 'day') },
  { label: '+7 дней', get: () => dayjs().add(7, 'day') },
  { label: '+14 дней', get: () => dayjs().add(14, 'day') },
  { label: '+30 дней', get: () => dayjs().add(30, 'day') },
  { label: 'Конец месяца', get: () => dayjs().endOf('month') },
];

/** Что редактируем: одну сделку из строки или все выделенные. */
type DueDateEditor =
  | { mode: 'single'; row: PaymentOverdueDealRow }
  | { mode: 'bulk'; rows: PaymentOverdueDealRow[] };

interface UrlState {
  q: string;
  buckets: PaymentOverdueBucket[];
  managerIds: string[];
  paymentTypes: string[];
  dealStatus: 'all' | 'closed' | 'open';
  dueSoonDays: number;
  sortBy: SortBy;
  preset: PresetKey;
  page: number;
  pageSize: number;
}

const FILTER_PATCH_KEYS: (keyof UrlState)[] = [
  'q',
  'buckets',
  'managerIds',
  'paymentTypes',
  'dealStatus',
  'dueSoonDays',
  'sortBy',
  'preset',
];

function bucketsFromPreset(preset: PresetKey): PaymentOverdueBucket[] | null {
  if (preset === 'attention') return [...ATTENTION_BUCKETS];
  if (preset === 'overdue') return ['OVERDUE'];
  if (preset === 'due_soon') return ['DUE_SOON'];
  if (preset === 'no_due') return ['NO_DUE_DATE'];
  if (preset === 'all') return [...ALL_BUCKETS];
  return null;
}

function sameBuckets(a: PaymentOverdueBucket[], b: PaymentOverdueBucket[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Набор бакетов — единственный источник истины; пресет из него выводится.
 * Так кнопка-пресет и селект «Статус срока» физически не могут разойтись.
 */
function presetForBuckets(buckets: PaymentOverdueBucket[]): PresetKey {
  for (const key of PRESET_KEYS) {
    const pb = bucketsFromPreset(key);
    if (pb && sameBuckets(pb, buckets)) return key;
  }
  return 'custom';
}

function parseBuckets(raw: string | null): PaymentOverdueBucket[] {
  if (!raw?.trim()) return [...ALL_BUCKETS];
  const picked = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PaymentOverdueBucket => (ALL_BUCKETS as string[]).includes(s));
  return picked.length > 0 ? picked : [...ALL_BUCKETS];
}

function parseParams(sp: URLSearchParams): UrlState {
  // `bucket` главнее: `preset` остаётся только для старых сохранённых ссылок.
  const bucketRaw = sp.get('bucket');
  const presetRaw = sp.get('preset');
  const legacyPreset: PresetKey =
    presetRaw && (PRESET_KEYS as string[]).includes(presetRaw) ? (presetRaw as PresetKey) : 'attention';

  const buckets = bucketRaw
    ? parseBuckets(bucketRaw)
    : bucketsFromPreset(legacyPreset) ?? [...ATTENTION_BUCKETS];
  const preset = presetForBuckets(buckets);

  const mgrRaw = sp.get('mgr');
  const managerIds = mgrRaw ? mgrRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const ptRaw = sp.get('ptype');
  const paymentTypes = ptRaw ? ptRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const statusRaw = sp.get('dstatus');
  const dealStatus: UrlState['dealStatus'] =
    statusRaw === 'closed' || statusRaw === 'open' ? statusRaw : 'all';

  const dueSoonDays = parseInt(sp.get('soon') || '7', 10);

  const sortRaw = sp.get('sort');
  const sortBy: SortBy =
    sortRaw === 'due_asc' || sortRaw === 'remaining_desc' || sortRaw === 'client_asc'
      ? sortRaw
      : 'overdue_desc';

  const rawPage = parseInt(sp.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPs = parseInt(sp.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPs) ? rawPs : DEFAULT_PAGE_SIZE;

  return {
    q: sp.get('q') ?? '',
    buckets,
    managerIds,
    paymentTypes,
    dealStatus,
    dueSoonDays: Number.isFinite(dueSoonDays) && dueSoonDays >= 0 ? dueSoonDays : 7,
    sortBy,
    preset,
    page,
    pageSize,
  };
}

function serializeState(s: UrlState): URLSearchParams {
  const n = new URLSearchParams();
  if (s.q.trim()) n.set('q', s.q.trim());
  // Пишем только бакеты; пресет вычисляется при разборе (иначе выбор в селекте терялся).
  if (!sameBuckets(s.buckets, ATTENTION_BUCKETS)) {
    n.set('bucket', [...new Set(s.buckets)].sort().join(','));
  }
  if (s.managerIds.length > 0) n.set('mgr', s.managerIds.join(','));
  if (s.paymentTypes.length > 0) n.set('ptype', s.paymentTypes.join(','));
  if (s.dealStatus !== 'all') n.set('dstatus', s.dealStatus);
  if (s.dueSoonDays !== 7) n.set('soon', String(s.dueSoonDays));
  if (s.sortBy !== 'overdue_desc') n.set('sort', s.sortBy);
  if (s.page !== 1) n.set('page', String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) n.set('pageSize', String(s.pageSize));
  return n;
}

function mergeParams(prev: URLSearchParams, patch: Partial<UrlState>): URLSearchParams {
  const cur = parseParams(prev);
  const filterTouched = FILTER_PATCH_KEYS.some((k) => patch[k] !== undefined);
  const next: UrlState = {
    q: patch.q !== undefined ? patch.q : cur.q,
    buckets: patch.buckets !== undefined ? patch.buckets : cur.buckets,
    managerIds: patch.managerIds !== undefined ? patch.managerIds : cur.managerIds,
    paymentTypes: patch.paymentTypes !== undefined ? patch.paymentTypes : cur.paymentTypes,
    dealStatus: patch.dealStatus !== undefined ? patch.dealStatus : cur.dealStatus,
    dueSoonDays: patch.dueSoonDays !== undefined ? patch.dueSoonDays : cur.dueSoonDays,
    sortBy: patch.sortBy !== undefined ? patch.sortBy : cur.sortBy,
    preset: patch.preset !== undefined ? patch.preset : cur.preset,
    page: patch.page !== undefined ? patch.page : filterTouched ? 1 : cur.page,
    pageSize: patch.pageSize !== undefined ? patch.pageSize : cur.pageSize,
  };
  if (patch.preset !== undefined) {
    const pb = bucketsFromPreset(patch.preset);
    if (pb) next.buckets = pb;
  }
  if (next.buckets.length === 0) next.buckets = [...ALL_BUCKETS];
  next.preset = presetForBuckets(next.buckets);
  return serializeState(next);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY');
}

function sortRows(rows: PaymentOverdueDealRow[], sortBy: SortBy): PaymentOverdueDealRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sortBy) {
      case 'due_asc': {
        const ad = a.dueDate || '9999';
        const bd = b.dueDate || '9999';
        return ad.localeCompare(bd);
      }
      case 'remaining_desc':
        return b.remaining - a.remaining;
      case 'client_asc':
        return a.clientName.localeCompare(b.clientName, 'ru');
      case 'overdue_desc':
      default: {
        // Просрочка → горящий срок → долг без даты → всё остальное по близости срока.
        const score = (r: PaymentOverdueDealRow) => {
          if (r.bucket === 'OVERDUE') return 300_000 + (r.daysOverdue ?? 0);
          if (r.bucket === 'DUE_SOON') return 200_000 - (r.daysUntilDue ?? 0);
          if (r.bucket === 'NO_DUE_DATE') return 100_000;
          return 50_000 - (r.daysUntilDue ?? 999);
        };
        return score(b) - score(a);
      }
    }
  });
  return copy;
}

export default function PaymentOverduePage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const userRole = useAuthStore((s) => s.user?.role);
  const canEditDueDate = !!userRole && DUE_DATE_ROLES.includes(userRole);
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseParams(searchParams), [searchParams]);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editor, setEditor] = useState<DueDateEditor | null>(null);
  const [editorDate, setEditorDate] = useState<Dayjs | null>(null);

  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('q') ?? '');
  const patchState = useCallback(
    (patch: Partial<UrlState>) => {
      setSearchParams((prev) => mergeParams(prev, patch), { replace: true });
    },
    [setSearchParams],
  );

  useEffect(() => {
    setSearchDraft(listState.q);
  }, [listState.q]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchDraft.trim() === listState.q.trim()) return;
      patchState({ q: searchDraft });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft, listState.q, patchState]);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payment-overdue', listState.dueSoonDays],
    queryFn: () => analyticsApi.getPaymentOverdue({ dueSoonDays: listState.dueSoonDays }),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const rows = data?.deals ?? [];
    const bucketSet = new Set(listState.buckets);
    const mgrSet = new Set(listState.managerIds);
    const ptSet = new Set(listState.paymentTypes);

    return rows.filter((row) => {
      if (!bucketSet.has(row.bucket)) return false;
      if (mgrSet.size > 0 && (!row.managerId || !mgrSet.has(row.managerId))) return false;
      if (ptSet.size > 0 && !ptSet.has(row.paymentType)) return false;
      if (listState.dealStatus === 'closed' && row.status !== 'CLOSED') return false;
      if (listState.dealStatus === 'open' && row.status === 'CLOSED') return false;
      if (listState.q.trim()) {
        const haystack = [
          row.clientName,
          row.title,
          row.managerName ?? '',
          row.terms ?? '',
          PAYMENT_TYPE_LABELS[row.paymentType] ?? row.paymentType,
        ].join(' ');
        if (!matchesSearch(haystack, listState.q)) return false;
      }
      return true;
    });
  }, [data?.deals, listState]);

  const sorted = useMemo(() => sortRows(filtered, listState.sortBy), [filtered, listState.sortBy]);
  const pageRows = useMemo(() => {
    const start = (listState.page - 1) * listState.pageSize;
    return sorted.slice(start, start + listState.pageSize);
  }, [sorted, listState.page, listState.pageSize]);

  const filteredRemaining = useMemo(
    () => sorted.reduce((sum, r) => sum + r.remaining, 0),
    [sorted],
  );

  /** Выделение живёт только среди видимых строк: сменили фильтр — снимаем лишнее. */
  const selectedRows = useMemo(() => {
    const ids = new Set(selectedIds);
    return sorted.filter((r) => ids.has(r.dealId));
  }, [sorted, selectedIds]);
  const selectedRemaining = useMemo(
    () => selectedRows.reduce((sum, r) => sum + r.remaining, 0),
    [selectedRows],
  );

  const openDueDateEditor = useCallback((next: DueDateEditor) => {
    const current =
      next.mode === 'single' && next.row.dueDate ? dayjs(next.row.dueDate) : null;
    setEditorDate(current);
    setEditor(next);
  }, []);

  const dueDateMutation = useMutation({
    mutationFn: (payload: { dealIds: string[]; dueDate: string | null }) =>
      analyticsApi.setPaymentOverdueDueDate(payload),
    onSuccess: (res) => {
      message.success(
        res.dueDate === null
          ? `Срок снят: ${res.updated} сдел.`
          : `Срок проставлен: ${res.updated} сдел.`,
      );
      if (res.skipped > 0) message.warning(`Пропущено (нет доступа): ${res.skipped}`);
      setEditor(null);
      setSelectedIds([]);
      void queryClient.invalidateQueries({ queryKey: ['payment-overdue'] });
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      message.error(msg || 'Не удалось изменить срок оплаты');
    },
  });

  const submitDueDate = useCallback(
    (dueDate: string | null) => {
      if (!editor) return;
      const dealIds =
        editor.mode === 'single' ? [editor.row.dealId] : editor.rows.map((r) => r.dealId);
      dueDateMutation.mutate({ dealIds, dueDate });
    },
    [editor, dueDateMutation],
  );

  /** Выгружаем ровно то, что отфильтровано на экране (все страницы), в текущем порядке. */
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await analyticsApi.exportPaymentOverdue({
        dueSoonDays: listState.dueSoonDays,
        dealIds: sorted.map((r) => r.dealId),
      });
    } finally {
      setIsExporting(false);
    }
  }, [listState.dueSoonDays, sorted]);

  const columns = [
    {
      title: 'Клиент',
      key: 'client',
      fixed: isMobile ? undefined : ('left' as const),
      width: 200,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        // Без stopPropagation клик по клиенту перебивался переходом строки на сделку.
        <span onClick={(e) => e.stopPropagation()}>
          <ClientCompanyDisplay
            client={{ id: row.clientId, companyName: row.clientName, isSvip: row.clientIsSvip }}
            link
          />
        </span>
      ),
    },
    {
      title: 'Сделка',
      key: 'deal',
      width: 180,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <Space size={4} wrap>
          <Link to={`/deals/${row.dealId}`} onClick={(e) => e.stopPropagation()}>
            {row.title || 'Без названия'}
          </Link>
          <ReceiptPunchedTag isReceiptPunched={row.isReceiptPunched} />
        </Space>
      ),
    },
    {
      title: 'Статус',
      key: 'bucket',
      width: 120,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <Tag color={BUCKET_META[row.bucket].color}>{BUCKET_META[row.bucket].label}</Tag>
      ),
    },
    {
      title: 'Срок оплаты',
      key: 'dueDate',
      width: canEditDueDate ? 170 : 130,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <Space size={4} align="start">
          <div>
            <div>{formatDate(row.dueDate)}</div>
            {row.bucket === 'OVERDUE' && row.daysOverdue != null && (
              <Text type="danger" style={{ fontSize: 12 }}>
                +{row.daysOverdue} дн.
              </Text>
            )}
            {row.bucket === 'DUE_SOON' && row.daysUntilDue != null && (
              <Text type="warning" style={{ fontSize: 12 }}>
                через {row.daysUntilDue} дн.
              </Text>
            )}
          </div>
          {canEditDueDate && (
            <Tooltip title={row.dueDate ? 'Изменить срок оплаты' : 'Поставить срок оплаты'}>
              <Button
                size="small"
                type={row.dueDate ? 'text' : 'link'}
                icon={<CalendarOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  openDueDateEditor({ mode: 'single', row });
                }}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Условия',
      key: 'terms',
      width: 140,
      ellipsis: true,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <span title={row.terms ?? undefined}>
          {row.terms?.trim() || PAYMENT_TYPE_LABELS[row.paymentType] || row.paymentType}
        </span>
      ),
    },
    {
      title: 'Остаток',
      key: 'remaining',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <Text type="danger">{formatUZS(row.remaining)}</Text>
      ),
    },
    {
      title: 'Менеджер',
      key: 'manager',
      width: 130,
      render: (_: unknown, row: PaymentOverdueDealRow) => row.managerName || '—',
    },
    {
      title: 'Контур',
      key: 'dealStatus',
      width: 100,
      render: (_: unknown, row: PaymentOverdueDealRow) =>
        row.status === 'CLOSED' ? <Tag>Закрыта</Tag> : <Tag color="processing">В работе</Tag>,
    },
  ];

  // Счётчик на кнопке = сумма её же бакетов, иначе цифра расходится с таблицей.
  const bucketCounts = data?.summary.bucketCounts;
  const presetCount = (key: PresetKey): string => {
    if (!bucketCounts) return '…';
    const pb = bucketsFromPreset(key);
    if (!pb) return '…';
    return String(pb.reduce((sum, b) => sum + (bucketCounts[b] ?? 0), 0));
  };

  const presetOptions = [
    { key: 'attention' as const, label: `Нужно внимание (${presetCount('attention')})` },
    { key: 'overdue' as const, label: `Просрочка (${presetCount('overdue')})` },
    { key: 'due_soon' as const, label: `Скоро срок (${presetCount('due_soon')})` },
    { key: 'no_due' as const, label: `Без даты (${presetCount('no_due')})` },
    { key: 'all' as const, label: `Все в долг (${data?.summary.dealsCount ?? '…'})` },
  ];

  const apiError =
    isError && error && typeof error === 'object' && 'response' in error
      ? String((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Ошибка загрузки')
      : isError
        ? 'Не удалось загрузить просрочку'
        : null;

  return (
    <div className="payment-overdue-page">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            <ClockCircleOutlined style={{ marginRight: 8, color: '#cf1322' }} />
            Просрочка
          </Title>
          <Text type="secondary">
            Все сделки с непогашенным остатком: срок оплаты, просрочка в днях, менеджер. Включая долги без указанной даты.
          </Text>
        </div>

        {apiError && (
          <Alert
            type="error"
            showIcon
            message={apiError}
            action={
              <Button size="small" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        )}

        {data?.summary && (
          <Row gutter={[12, 12]}>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="Просрочено" value={data.summary.overdueCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic
                  title="Сумма просрочки"
                  value={data.summary.overdueRemaining}
                  formatter={(v) => formatUZS(Number(v))}
                  loading={isLoading}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic
                  title={`Скоро срок (${listState.dueSoonDays} дн.)`}
                  value={data.summary.bucketCounts.DUE_SOON}
                  loading={isLoading}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="Без даты срока" value={data.summary.noDueDateCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic title="Всего в долг" value={data.summary.dealsCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card size="small">
                <Statistic
                  title="Общий остаток"
                  value={data.summary.totalRemaining}
                  formatter={(v) => formatUZS(Number(v))}
                  loading={isLoading}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Card size="small" className="payment-overdue-filters-card">
          <Space wrap style={{ marginBottom: 12 }}>
            {presetOptions.map((opt) => (
              <Button
                key={opt.key}
                type={listState.preset === opt.key ? 'primary' : 'default'}
                size="small"
                onClick={() => patchState({ preset: opt.key })}
              >
                {opt.label}
              </Button>
            ))}
            <Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => void refetch()}>
              Обновить
            </Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={isExporting}
              disabled={sorted.length === 0}
              title={`Выгрузить ${sorted.length} строк по текущим фильтрам`}
              onClick={() => void handleExport()}
            >
              Excel ({sorted.length})
            </Button>
          </Space>

          <div className="payment-overdue-filters-grid">
            <div className="payment-overdue-filter-item payment-overdue-filter-item--wide">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Поиск
              </Text>
              <Input
                className={APP_INPUT}
                allowClear
                placeholder="Клиент, сделка, менеджер, условия…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
            <div className="payment-overdue-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Статус срока
              </Text>
              <Select
                className={APP_INPUT}
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                style={{ width: '100%' }}
                value={listState.buckets}
                options={ALL_BUCKETS.map((b) => ({
                  value: b,
                  label: bucketCounts
                    ? `${BUCKET_META[b].label} (${bucketCounts[b] ?? 0})`
                    : BUCKET_META[b].label,
                }))}
                onChange={(v) => patchState({ buckets: v as PaymentOverdueBucket[] })}
              />
            </div>
            <div className="payment-overdue-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Менеджер
              </Text>
              <Select
                className={APP_INPUT}
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                style={{ width: '100%' }}
                value={listState.managerIds}
                options={(data?.managers ?? []).map((m) => ({ value: m.id, label: getFirstName(m.fullName) }))}
                filterOption={smartFilterOption}
                onChange={(v) => patchState({ managerIds: v })}
              />
            </div>
            <div className="payment-overdue-filter-item payment-overdue-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Тип оплаты
              </Text>
              <Select
                className={APP_INPUT}
                mode="multiple"
                allowClear
                style={{ width: '100%' }}
                value={listState.paymentTypes}
                options={[
                  { value: 'PARTIAL', label: 'В долг' },
                  { value: 'INSTALLMENT', label: 'Рассрочка' },
                  { value: 'FULL', label: 'Полная (остаток)' },
                ]}
                onChange={(v) => patchState({ paymentTypes: v })}
              />
            </div>
            <div className="payment-overdue-filter-item payment-overdue-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Сделка
              </Text>
              <Select
                className={APP_INPUT}
                style={{ width: '100%' }}
                value={listState.dealStatus}
                options={[
                  { value: 'all', label: 'Все' },
                  { value: 'closed', label: 'Закрытые' },
                  { value: 'open', label: 'В работе' },
                ]}
                onChange={(v) => patchState({ dealStatus: v })}
              />
            </div>
            <div className="payment-overdue-filter-item payment-overdue-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                «Скоро», дн.
              </Text>
              <InputNumber
                className={APP_INPUT}
                min={0}
                max={90}
                style={{ width: '100%' }}
                value={listState.dueSoonDays}
                onChange={(v) => patchState({ dueSoonDays: v ?? 7 })}
              />
            </div>
            <div className="payment-overdue-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Сортировка
              </Text>
              <Select
                className={APP_INPUT}
                style={{ width: '100%' }}
                value={listState.sortBy}
                options={[
                  { value: 'overdue_desc', label: 'Сначала просрочка' },
                  { value: 'due_asc', label: 'По сроку оплаты' },
                  { value: 'remaining_desc', label: 'По остатку' },
                  { value: 'client_asc', label: 'По клиенту' },
                ]}
                onChange={(v) => patchState({ sortBy: v })}
              />
            </div>
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 10 }}>
            Показано {sorted.length} · остаток по фильтру {formatUZS(filteredRemaining)} · сегодня{' '}
            {data?.today ?? '—'}
            {isFetching ? ' · обновление…' : ''}
          </Text>
        </Card>

        {canEditDueDate && selectedRows.length > 0 && (
          <Alert
            type="info"
            showIcon={false}
            message={
              <Space wrap>
                <Text strong>Выбрано {selectedRows.length}</Text>
                <Text type="secondary">остаток {formatUZS(selectedRemaining)}</Text>
                <Button
                  size="small"
                  type="primary"
                  icon={<CalendarOutlined />}
                  onClick={() => openDueDateEditor({ mode: 'bulk', rows: selectedRows })}
                >
                  Поставить срок
                </Button>
                <Button size="small" onClick={() => setSelectedIds([])}>
                  Снять выделение
                </Button>
              </Space>
            }
          />
        )}

        <Card size="small" styles={{ body: { padding: isMobile ? 8 : 16 } }}>
          <Table<PaymentOverdueDealRow>
            rowKey="dealId"
            size="small"
            loading={isLoading}
            columns={columns}
            dataSource={pageRows}
            rowSelection={
              canEditDueDate
                ? {
                    selectedRowKeys: selectedIds,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => setSelectedIds(keys as string[]),
                    columnWidth: 40,
                  }
                : undefined
            }
            scroll={{ x: isMobile ? 1060 : undefined }}
            pagination={false}
            onRow={(row) => ({
              style: { cursor: 'pointer' },
              onClick: () => navigate(`/deals/${row.dealId}`),
            })}
            locale={{
              emptyText:
                (data?.deals.length ?? 0) > 0 ? (
                  <Empty
                    description="По фильтрам ничего не найдено"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    <Button size="small" onClick={() => patchState({ preset: 'all', buckets: [...ALL_BUCKETS] })}>
                      Показать все в долг
                    </Button>
                  </Empty>
                ) : (
                  <Empty description="Нет сделок с непогашенным остатком" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ),
            }}
          />
          {sorted.length > listState.pageSize && (
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <Pagination
                current={listState.page}
                pageSize={listState.pageSize}
                total={sorted.length}
                showSizeChanger
                pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
                showTotal={(total) => `Всего ${total}`}
                onChange={(page, pageSize) => patchState({ page, pageSize })}
              />
            </div>
          )}
        </Card>
      </Space>

      <Modal
        open={editor !== null}
        title={editor?.mode === 'bulk' ? `Срок оплаты для ${editor.rows.length} сдел.` : 'Срок оплаты'}
        onCancel={() => setEditor(null)}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setEditor(null)}>
            Отмена
          </Button>,
          <Button
            key="clear"
            danger
            loading={dueDateMutation.isPending}
            onClick={() => submitDueDate(null)}
          >
            Убрать срок
          </Button>,
          <Button
            key="save"
            type="primary"
            disabled={!editorDate}
            loading={dueDateMutation.isPending}
            onClick={() => editorDate && submitDueDate(editorDate.format('YYYY-MM-DD'))}
          >
            Сохранить
          </Button>,
        ]}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {editor?.mode === 'single' && (
            <Text type="secondary">
              {editor.row.clientName} · {editor.row.title || 'Без названия'} ·{' '}
              остаток {formatUZS(editor.row.remaining)}
            </Text>
          )}
          {editor?.mode === 'bulk' && (
            <Text type="secondary">
              Один срок будет проставлен всем выделенным сделкам · остаток{' '}
              {formatUZS(editor.rows.reduce((s, r) => s + r.remaining, 0))}
            </Text>
          )}
          <DatePicker
            className={APP_INPUT}
            style={{ width: '100%' }}
            format="DD.MM.YYYY"
            placeholder="Выберите дату"
            value={editorDate}
            onChange={(d) => setEditorDate(d)}
          />
          <Space wrap>
            {DUE_DATE_PRESETS.map((p) => (
              <Button key={p.label} size="small" onClick={() => setEditorDate(p.get())}>
                {p.label}
              </Button>
            ))}
          </Space>
        </Space>
      </Modal>
    </div>
  );
}
