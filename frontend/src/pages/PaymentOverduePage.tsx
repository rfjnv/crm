import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Pagination,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ClockCircleOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
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

type PresetKey = 'attention' | 'overdue' | 'due_soon' | 'all' | 'no_due';

type SortBy = 'overdue_desc' | 'due_asc' | 'remaining_desc' | 'client_asc';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

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
  if (preset === 'due_soon') return ['DUE_SOON', 'OVERDUE'];
  if (preset === 'no_due') return ['NO_DUE_DATE'];
  return null;
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
  const presetRaw = sp.get('preset');
  const preset: PresetKey =
    presetRaw === 'overdue' ||
    presetRaw === 'due_soon' ||
    presetRaw === 'all' ||
    presetRaw === 'no_due'
      ? presetRaw
      : 'attention';

  const presetBuckets = bucketsFromPreset(preset);
  const buckets = presetBuckets ?? parseBuckets(sp.get('bucket'));

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
  if (s.preset !== 'attention') n.set('preset', s.preset);
  else if (s.buckets.length > 0 && s.buckets.length < ALL_BUCKETS.length) {
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
        const score = (r: PaymentOverdueDealRow) => {
          if (r.bucket === 'OVERDUE') return 100_000 + (r.daysOverdue ?? 0);
          if (r.bucket === 'NO_DUE_DATE') return 50_000;
          if (r.bucket === 'DUE_SOON') return 10_000 - (r.daysUntilDue ?? 0);
          return (r.daysUntilDue ?? 999);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseParams(searchParams), [searchParams]);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await analyticsApi.exportPaymentOverdue({ dueSoonDays: listState.dueSoonDays });
    } finally {
      setIsExporting(false);
    }
  }, [listState.dueSoonDays]);

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

  const columns = [
    {
      title: 'Клиент',
      key: 'client',
      fixed: isMobile ? undefined : ('left' as const),
      width: 200,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <ClientCompanyDisplay
          client={{ id: row.clientId, companyName: row.clientName, isSvip: row.clientIsSvip }}
          link
        />
      ),
    },
    {
      title: 'Сделка',
      key: 'deal',
      width: 180,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
        <Link to={`/deals/${row.dealId}`} onClick={(e) => e.stopPropagation()}>
          {row.title || 'Без названия'}
        </Link>
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
      width: 130,
      render: (_: unknown, row: PaymentOverdueDealRow) => (
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

  const presetOptions = [
    {
      key: 'attention' as const,
      label: data
        ? `Нужно внимание (${data.summary.overdueCount + data.summary.noDueDateCount})`
        : 'Нужно внимание',
    },
    { key: 'overdue' as const, label: `Просрочка (${data?.summary.overdueCount ?? '…'})` },
    { key: 'due_soon' as const, label: 'Скоро срок' },
    { key: 'no_due' as const, label: `Без даты (${data?.summary.noDueDateCount ?? '…'})` },
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
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic title="Просрочено" value={data.summary.overdueCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic
                  title="Сумма просрочки"
                  value={data.summary.overdueRemaining}
                  formatter={(v) => formatUZS(Number(v))}
                  loading={isLoading}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic title="Без даты срока" value={data.summary.noDueDateCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic title="Всего в долг" value={data.summary.dealsCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
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
              onClick={() => void handleExport()}
            >
              Excel
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
                options={ALL_BUCKETS.map((b) => ({ value: b, label: BUCKET_META[b].label }))}
                onChange={(v) => patchState({ buckets: v as PaymentOverdueBucket[], preset: 'all' })}
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
            Показано {sorted.length} · сегодня {data?.today ?? '—'}
            {isFetching ? ' · обновление…' : ''}
          </Text>
        </Card>

        <Card size="small" styles={{ body: { padding: isMobile ? 8 : 16 } }}>
          <Table<PaymentOverdueDealRow>
            rowKey="dealId"
            size="small"
            loading={isLoading}
            columns={columns}
            dataSource={pageRows}
            scroll={{ x: isMobile ? 960 : undefined }}
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
    </div>
  );
}
