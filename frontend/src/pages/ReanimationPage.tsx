import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  List,
  Pagination,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  Typography,
} from 'antd';
import { ReloadOutlined, SoundOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { APP_INPUT } from '../components/ui/AppClassNames';
import { useIsMobile } from '../hooks/useIsMobile';
import { matchesSearch, smartFilterOption } from '../utils/translit';
import './ReanimationPage.css';
import type {
  ReanimationClientDetail,
  ReanimationClientProductStat,
  ReanimationClientRow,
  ReanimationProductPreview,
  ReanimationStatus,
} from '../types';

const { Title, Text, Paragraph } = Typography;

const CANDIDATE_STATUSES: ReanimationStatus[] = ['ONE_TIME_LOST', 'SLEEPING', 'CHURNED'];

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

const ALL_STATUSES: ReanimationStatus[] = ['ACTIVE', 'ONE_TIME_LOST', 'SLEEPING', 'CHURNED'];

type ReanimationSortBy =
  | 'inactive_desc'
  | 'inactive_asc'
  | 'revenue_desc'
  | 'deals_desc'
  | 'debt_desc'
  | 'contact_oldest';

type DebtFilter = 'all' | 'with_debt' | 'without_debt';
type ContactFilter = 'all' | 'no_contact' | 'stale_7' | 'stale_30';

const SORT_OPTIONS: ReanimationSortBy[] = [
  'inactive_desc',
  'inactive_asc',
  'revenue_desc',
  'deals_desc',
  'debt_desc',
  'contact_oldest',
];

interface ReanimationListUrlState {
  q: string;
  statuses: ReanimationStatus[];
  managerIds: string[];
  departments: string[];
  productNames: string[];
  debtFilter: DebtFilter;
  contactFilter: ContactFilter;
  sortBy: ReanimationSortBy;
  minDays: number | null;
  maxDays: number | null;
  clientId: string | null;
}

function normalizeStatuses(value: ReanimationStatus[]): ReanimationStatus[] {
  const picked = value.filter((s): s is ReanimationStatus => ALL_STATUSES.includes(s));
  if (picked.length === 0) return [...CANDIDATE_STATUSES];
  return picked;
}

function statusSelectionIsDefault(statuses: ReanimationStatus[]): boolean {
  if (statuses.length !== CANDIDATE_STATUSES.length) return false;
  const set = new Set(statuses);
  return CANDIDATE_STATUSES.every((s) => set.has(s));
}

function parseReanimationListParams(sp: URLSearchParams): ReanimationListUrlState {
  const q = sp.get('q') ?? '';
  const statusRaw = sp.get('status');
  const statuses = !statusRaw?.trim()
    ? [...CANDIDATE_STATUSES]
    : normalizeStatuses(
        statusRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as ReanimationStatus[],
      );

  const mgrRaw = sp.get('mgr');
  const managerIds = mgrRaw ? mgrRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const departments = sp.getAll('dept').filter(Boolean);
  const productNames = sp.getAll('prod').filter(Boolean);

  const debtRaw = sp.get('debt');
  const debtFilter: DebtFilter =
    debtRaw === 'with_debt' || debtRaw === 'without_debt' ? debtRaw : 'all';

  const contactRaw = sp.get('contact');
  const contactFilter: ContactFilter =
    contactRaw === 'no_contact' || contactRaw === 'stale_7' || contactRaw === 'stale_30' ? contactRaw : 'all';

  const sortRaw = sp.get('sort');
  const sortBy: ReanimationSortBy =
    sortRaw && (SORT_OPTIONS as string[]).includes(sortRaw) ? (sortRaw as ReanimationSortBy) : 'inactive_desc';

  const minRaw = sp.get('min');
  let minDays: number | null = 30;
  if (minRaw === 'any' || minRaw === 'none') minDays = null;
  else if (minRaw !== null && minRaw !== '') {
    const n = parseInt(minRaw, 10);
    minDays = Number.isFinite(n) && n >= 0 ? n : 30;
  }

  const maxRaw = sp.get('max');
  let maxDays: number | null = null;
  if (maxRaw !== null && maxRaw !== '') {
    const n = parseInt(maxRaw, 10);
    maxDays = Number.isFinite(n) && n >= 0 ? n : null;
  }

  const clientRaw = sp.get('client');
  const clientId = clientRaw?.trim() || null;

  return {
    q,
    statuses,
    managerIds,
    departments,
    productNames,
    debtFilter,
    contactFilter,
    sortBy,
    minDays,
    maxDays,
    clientId,
  };
}

function serializeReanimationListState(s: ReanimationListUrlState): URLSearchParams {
  const n = new URLSearchParams();
  if (s.q.trim()) n.set('q', s.q.trim());
  if (!statusSelectionIsDefault(s.statuses)) {
    n.set('status', [...new Set(s.statuses)].sort().join(','));
  }
  if (s.managerIds.length > 0) n.set('mgr', s.managerIds.join(','));
  for (const d of s.departments) n.append('dept', d);
  for (const p of s.productNames) n.append('prod', p);
  if (s.debtFilter !== 'all') n.set('debt', s.debtFilter);
  if (s.contactFilter !== 'all') n.set('contact', s.contactFilter);
  if (s.sortBy !== 'inactive_desc') n.set('sort', s.sortBy);
  if (s.minDays === null) n.set('min', 'any');
  else if (s.minDays !== 30) n.set('min', String(s.minDays));
  if (s.maxDays !== null) n.set('max', String(s.maxDays));
  if (s.clientId) n.set('client', s.clientId);
  return n;
}

function mergeReanimationListParams(
  prev: URLSearchParams,
  patch: Partial<ReanimationListUrlState>,
): URLSearchParams {
  const cur = parseReanimationListParams(prev);
  const next: ReanimationListUrlState = {
    q: patch.q !== undefined ? patch.q : cur.q,
    statuses: patch.statuses !== undefined ? normalizeStatuses(patch.statuses) : cur.statuses,
    managerIds: patch.managerIds !== undefined ? patch.managerIds : cur.managerIds,
    departments: patch.departments !== undefined ? patch.departments : cur.departments,
    productNames: patch.productNames !== undefined ? patch.productNames : cur.productNames,
    debtFilter: patch.debtFilter !== undefined ? patch.debtFilter : cur.debtFilter,
    contactFilter: patch.contactFilter !== undefined ? patch.contactFilter : cur.contactFilter,
    sortBy: patch.sortBy !== undefined ? patch.sortBy : cur.sortBy,
    minDays: patch.minDays !== undefined ? patch.minDays : cur.minDays,
    maxDays: patch.maxDays !== undefined ? patch.maxDays : cur.maxDays,
    clientId: patch.clientId !== undefined ? patch.clientId : cur.clientId,
  };
  return serializeReanimationListState(next);
}

const STATUS_META: Record<ReanimationStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Активный', color: 'default' },
  ONE_TIME_LOST: { label: 'Раз купил и пропал', color: 'orange' },
  SLEEPING: { label: 'Повторный, но уснул', color: 'gold' },
  CHURNED: { label: 'Перестал покупать', color: 'red' },
};

function formatMoney(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY HH:mm');
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value} дн.`;
}

function buildSearchHaystack(row: ReanimationClientRow) {
  return [
    row.companyName,
    row.contactName,
    row.phone || '',
    row.email || '',
    row.managerName,
    row.managerDepartment || '',
    row.productNames.join(' '),
    row.lastDeal?.title || '',
    row.lastContactPreview || '',
  ].join(' ');
}

function renderProductButtons(
  items: ReanimationProductPreview[],
  navigate: ReturnType<typeof useNavigate>,
  emptyLabel: string,
) {
  if (items.length === 0) {
    return <Text type="secondary">{emptyLabel}</Text>;
  }
  return (
    <Space size={[4, 4]} wrap>
      {items.map((item) => (
        <Tag
          key={`${item.productId}-${item.productName}`}
          style={{ cursor: 'pointer', marginInlineEnd: 0 }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/inventory/products/${item.productId}`);
          }}
        >
          {item.productName}
        </Tag>
      ))}
    </Space>
  );
}

export default function ReanimationPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseReanimationListParams(searchParams), [searchParams]);

  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('q') ?? '');
  const patchListState = useCallback(
    (patch: Partial<ReanimationListUrlState>, nav?: { replace?: boolean }) => {
      setSearchParams((prev) => mergeReanimationListParams(prev, patch), nav ?? { replace: true });
    },
    [setSearchParams],
  );

  useEffect(() => {
    setSearchDraft(listState.q);
  }, [listState.q]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchDraft.trim() === listState.q.trim()) return;
      patchListState({ q: searchDraft });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft, listState.q, patchListState]);

  const tableFilterKey = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(Object.entries(listState).filter(([k]) => k !== 'clientId')),
      ),
    [listState],
  );

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['analytics-reanimation'],
    queryFn: analyticsApi.getReanimationClients,
    staleTime: 120_000,
  });

  const drawerClientId = listState.clientId;

  const drawerQuery = useQuery({
    queryKey: ['analytics-reanimation-detail', drawerClientId],
    queryFn: () => analyticsApi.getReanimationClientDetail(drawerClientId!),
    enabled: Boolean(drawerClientId),
    staleTime: 60_000,
  });

  const managerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          data.map((row) => [row.managerId, { label: row.managerName, value: row.managerId }]),
        ).values(),
      ).sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [data],
  );

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(data.map((row) => (row.managerDepartment || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map((value) => ({ label: value, value })),
    [data],
  );

  const productOptions = useMemo(
    () =>
      Array.from(new Set(data.flatMap((row) => row.productNames).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map((value) => ({ label: value, value })),
    [data],
  );

  const filteredRows = useMemo(() => {
    let rows = [...data];
    const query = searchDraft.trim();
    const {
      statuses,
      managerIds,
      departments,
      productNames,
      debtFilter,
      contactFilter,
      sortBy,
      minDays,
      maxDays,
    } = listState;

    rows = rows.filter((row) => statuses.includes(row.status));
    if (managerIds.length > 0) {
      rows = rows.filter((row) => managerIds.includes(row.managerId));
    }
    if (departments.length > 0) {
      rows = rows.filter((row) => row.managerDepartment && departments.includes(row.managerDepartment));
    }
    if (productNames.length > 0) {
      rows = rows.filter((row) => productNames.every((productName) => row.productNames.includes(productName)));
    }
    if (debtFilter === 'with_debt') {
      rows = rows.filter((row) => row.currentDebt > 0);
    }
    if (debtFilter === 'without_debt') {
      rows = rows.filter((row) => row.currentDebt <= 0);
    }
    if (contactFilter === 'no_contact') {
      rows = rows.filter((row) => !row.lastContactAt);
    }
    if (contactFilter === 'stale_7') {
      rows = rows.filter((row) => (row.daysSinceLastContact ?? Number.POSITIVE_INFINITY) >= 7);
    }
    if (contactFilter === 'stale_30') {
      rows = rows.filter((row) => (row.daysSinceLastContact ?? Number.POSITIVE_INFINITY) >= 30);
    }
    if (minDays !== null) {
      rows = rows.filter((row) => (row.daysSinceLastPurchase ?? 0) >= minDays);
    }
    if (maxDays !== null) {
      rows = rows.filter((row) => (row.daysSinceLastPurchase ?? 0) <= maxDays);
    }
    if (query) {
      rows = rows.filter((row) => matchesSearch(buildSearchHaystack(row), query));
    }

    rows.sort((a, b) => {
      if (sortBy === 'inactive_desc') return (b.daysSinceLastPurchase ?? 0) - (a.daysSinceLastPurchase ?? 0);
      if (sortBy === 'inactive_asc') return (a.daysSinceLastPurchase ?? 0) - (b.daysSinceLastPurchase ?? 0);
      if (sortBy === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'deals_desc') return b.closedDealsCount - a.closedDealsCount;
      if (sortBy === 'debt_desc') return b.currentDebt - a.currentDebt;
      return (b.daysSinceLastContact ?? Number.POSITIVE_INFINITY) - (a.daysSinceLastContact ?? Number.POSITIVE_INFINITY);
    });

    return rows;
  }, [data, listState, searchDraft]);

  useEffect(() => {
    setPage(1);
  }, [tableFilterKey]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRows.length / pageSize) || 1);
    if (page > maxPage) setPage(maxPage);
  }, [filteredRows.length, page, pageSize]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const allCandidates = useMemo(
    () => data.filter((row) => CANDIDATE_STATUSES.includes(row.status)),
    [data],
  );

  const summary = useMemo(() => {
    const visible = filteredRows;
    const lostSingle = visible.filter((row) => row.status === 'ONE_TIME_LOST').length;
    const sleeping = visible.filter((row) => row.status === 'SLEEPING').length;
    const churned = visible.filter((row) => row.status === 'CHURNED').length;
    const withDebt = visible.filter((row) => row.currentDebt > 0).length;
    return { visible: visible.length, lostSingle, sleeping, churned, withDebt };
  }, [filteredRows]);

  const resetFilters = () => {
    setSearchDraft('');
    setPage(1);
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const renderClientRowCard = (row: ReanimationClientRow) => (
    <Card
      key={row.clientId}
      size="small"
      hoverable
      className="reanimation-row-card"
      onClick={() => patchListState({ clientId: row.clientId })}
    >
      <div className="reanimation-row-card__top">
        <div className="reanimation-row-card__client">
          <ClientCompanyDisplay
            client={{
              id: row.clientId,
              companyName: row.companyName,
              isSvip: row.isSvip,
              creditStatus: row.creditStatus,
            }}
            variant="full"
          />
          <div className="reanimation-client-cell__meta">
            <Text type="secondary">{row.contactName || 'Контакт не указан'}</Text>
          </div>
          <div className="reanimation-client-cell__meta">
            <Space size={[8, 6]} wrap>
              <Tag color={STATUS_META[row.status].color}>{STATUS_META[row.status].label}</Tag>
              {row.phone ? <Text type="secondary">{row.phone}</Text> : null}
              {row.currentDebt > 0 ? <Tag color="red">Долг</Tag> : null}
              {!row.lastContactAt ? <Tag>Без контакта</Tag> : null}
            </Space>
          </div>
        </div>

        <div className="reanimation-row-card__actions" onClick={(e) => e.stopPropagation()}>
          <Button size="small" type="primary" onClick={() => patchListState({ clientId: row.clientId })}>
            Открыть
          </Button>
          <Button size="small" type="link" onClick={() => navigate(`/clients/${row.clientId}`)}>
            Карточка
          </Button>
        </div>
      </div>

      <div className="reanimation-row-card__grid">
        <div className="reanimation-row-card__item">
          <Text type="secondary">Ответственный</Text>
          <div>{row.managerName}</div>
          <Text type="secondary">{row.managerDepartment || 'Без отдела'}</Text>
        </div>

        <div className="reanimation-row-card__item">
          <Text type="secondary">Последняя покупка</Text>
          <div>{formatDate(row.lastPurchaseAt)}</div>
          <Text strong>{formatDays(row.daysSinceLastPurchase)}</Text>
        </div>

        <div className="reanimation-row-card__item">
          <Text type="secondary">Последний контакт</Text>
          <div>{row.lastContactAt ? formatDateTime(row.lastContactAt) : 'Не было'}</div>
          <Text type="secondary">
            {row.lastContactAt
              ? `${row.lastContactByName || 'Без автора'}${
                  row.daysSinceLastContact !== null && row.daysSinceLastContact !== undefined
                    ? ` • ${formatDays(row.daysSinceLastContact)}`
                    : ''
                }`
              : 'Нужен первый контакт'}
          </Text>
        </div>

        <div className="reanimation-row-card__item">
          <Text type="secondary">Ключевые цифры</Text>
          <div>Сделок: {row.closedDealsCount}</div>
          <div>Выручка: {formatMoney(row.totalRevenue)}</div>
          <Text type={row.currentDebt > 0 ? 'danger' : 'secondary'}>
            Долг: {formatMoney(row.currentDebt)}
          </Text>
        </div>
      </div>
    </Card>
  );

  const drawerData = drawerQuery.data as ReanimationClientDetail | undefined;

  const productStatColumns = [
    { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
    { title: 'Сделок', dataIndex: 'dealsCount', key: 'dealsCount', width: 90, align: 'right' as const },
    { title: 'Кол-во', dataIndex: 'totalQty', key: 'totalQty', width: 110, align: 'right' as const },
    {
      title: 'Выручка',
      dataIndex: 'totalRevenue',
      key: 'totalRevenue',
      width: 130,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Последняя покупка',
      dataIndex: 'lastPurchasedAt',
      key: 'lastPurchasedAt',
      width: 140,
      render: (value: string) => formatDate(value),
    },
  ];

  const recentDealColumns = [
    { title: 'Сделка', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: 'Дата',
      dataIndex: 'effectiveAt',
      key: 'effectiveAt',
      width: 130,
      render: (value: string) => formatDate(value),
    },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Оплачено',
      dataIndex: 'paidAmount',
      key: 'paidAmount',
      width: 120,
      align: 'right' as const,
      render: (value: number) => formatMoney(value),
    },
    { title: 'Статус оплаты', dataIndex: 'paymentStatus', key: 'paymentStatus', width: 140 },
  ];

  return (
    <div className="reanimation-page">
      <Row justify="space-between" align="middle" gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={4} style={{ margin: 0 }}>
            <SoundOutlined style={{ marginRight: 8 }} />
            Реанимация клиентов
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            Одна страница для поиска клиентов, которые купили один раз и пропали или перестали покупать. Все ключевые данные, товары и последние сделки доступны без выхода со страницы.
          </Paragraph>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
            Обновить
          </Button>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Кандидаты" value={summary.visible} suffix={`/ ${allCandidates.length}`} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Разовые пропали" value={summary.lostSingle} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Повторные уснули" value={summary.sleeping} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="С долгом" value={summary.withDebt} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="Фильтры"
        className="reanimation-filters-card"
        style={{ marginBottom: 12 }}
      >
        <div className="reanimation-filters-grid">
          <div className="reanimation-filter-item reanimation-filter-item--wide">
            <Input.Search
              className={APP_INPUT}
              allowClear
              placeholder="Клиент, контакт, телефон, товар, сделка..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onSearch={(value) => {
                setSearchDraft(value);
                patchListState({ q: value });
              }}
            />
          </div>
          <div className="reanimation-filter-item reanimation-filter-item--wide">
            <Select
              mode="multiple"
              allowClear
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Статус реанимации"
              value={listState.statuses}
              onChange={(value) =>
                patchListState({
                  statuses: normalizeStatuses((value ?? []) as ReanimationStatus[]),
                })
              }
              options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
              maxTagCount={2}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={smartFilterOption}
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Менеджеры"
              value={listState.managerIds}
              onChange={(value) => patchListState({ managerIds: value ?? [] })}
              options={managerOptions}
              maxTagCount={2}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={smartFilterOption}
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Отдел"
              value={listState.departments}
              onChange={(value) => patchListState({ departments: value ?? [] })}
              options={departmentOptions}
              maxTagCount={2}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={smartFilterOption}
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Товары"
              value={listState.productNames}
              onChange={(value) => patchListState({ productNames: value ?? [] })}
              options={productOptions}
              maxTagCount={2}
            />
          </div>
          <div className="reanimation-filter-item reanimation-filter-item--compact">
            <InputNumber
              className={APP_INPUT}
              style={{ width: '100%' }}
              min={0}
              value={listState.minDays}
              onChange={(value) =>
                patchListState({ minDays: typeof value === 'number' ? value : null })
              }
              placeholder="От, дней"
            />
          </div>
          <div className="reanimation-filter-item reanimation-filter-item--compact">
            <InputNumber
              className={APP_INPUT}
              style={{ width: '100%' }}
              min={0}
              value={listState.maxDays}
              onChange={(value) =>
                patchListState({ maxDays: typeof value === 'number' ? value : null })
              }
              placeholder="До, дней"
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              value={listState.debtFilter}
              onChange={(value) => patchListState({ debtFilter: value as DebtFilter })}
              options={[
                { value: 'all', label: 'Долг: все' },
                { value: 'with_debt', label: 'Только с долгом' },
                { value: 'without_debt', label: 'Без долга / переплата' },
              ]}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              value={listState.contactFilter}
              onChange={(value) => patchListState({ contactFilter: value as ContactFilter })}
              options={[
                { value: 'all', label: 'Контакты: все' },
                { value: 'no_contact', label: 'Без заметок' },
                { value: 'stale_7', label: 'Контакт не был 7+ дней' },
                { value: 'stale_30', label: 'Контакт не был 30+ дней' },
              ]}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              value={listState.sortBy}
              onChange={(value) => patchListState({ sortBy: value as ReanimationSortBy })}
              options={[
                { value: 'inactive_desc', label: 'Сорт: дольше всего без покупки' },
                { value: 'inactive_asc', label: 'Сорт: ближе к активности' },
                { value: 'revenue_desc', label: 'Сорт: по выручке' },
                { value: 'deals_desc', label: 'Сорт: по числу сделок' },
                { value: 'debt_desc', label: 'Сорт: по долгу' },
                { value: 'contact_oldest', label: 'Сорт: самый старый контакт' },
              ]}
            />
          </div>
          <div className="reanimation-filter-item reanimation-filter-item--action">
            <Button block onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          </div>
        </div>
      </Card>

      <Card
        size="small"
        title={`Список клиентов (${filteredRows.length})`}
        extra={<Text type="secondary">По умолчанию показаны только кандидаты на возврат</Text>}
      >
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Text type="secondary">Загрузка данных...</Text>
          </div>
        ) : filteredRows.length === 0 ? (
          <Empty description="По текущим фильтрам клиентов не найдено" />
        ) : (
          <div key={tableFilterKey} className="reanimation-row-list">
            {paginatedRows.map((row) => renderClientRowCard(row))}
          </div>
        )}
      </Card>

      {!isLoading && filteredRows.length > 0 ? (
        <div className="reanimation-pagination-bar" role="navigation" aria-label="Пагинация списка клиентов">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={filteredRows.length}
            showSizeChanger
            pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
            showTotal={(total, range) => `${range[0]}-${range[1]} из ${total}`}
            onChange={(nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize !== pageSize) setPageSize(nextPageSize);
            }}
            size={isMobile ? 'small' : 'middle'}
          />
        </div>
      ) : null}

      <Drawer
        width={isMobile ? '100%' : 1120}
        open={Boolean(drawerClientId)}
        onClose={() => patchListState({ clientId: null })}
        title={drawerData?.client.companyName || 'Карточка клиента'}
      >
        {!drawerClientId || drawerQuery.isLoading || !drawerData ? (
          <div style={{ paddingTop: 24 }}>
            <Text type="secondary">Загрузка деталей...</Text>
          </div>
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={24} md={12}>
                <Card size="small">
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      {
                        key: 'status',
                        label: 'Статус',
                        children: <Tag color={STATUS_META[drawerData.client.status].color}>{STATUS_META[drawerData.client.status].label}</Tag>,
                      },
                      { key: 'manager', label: 'Менеджер', children: `${drawerData.client.managerName}${drawerData.client.managerDepartment ? ` • ${drawerData.client.managerDepartment}` : ''}` },
                      { key: 'contact', label: 'Контакт', children: drawerData.client.contactName || '—' },
                      { key: 'phone', label: 'Телефон', children: drawerData.client.phone || '—' },
                      { key: 'telegram', label: 'Telegram', children: drawerData.client.email || '—' },
                      { key: 'address', label: 'Адрес', children: drawerData.client.address || '—' },
                      { key: 'purchase', label: 'Последняя покупка', children: `${formatDate(drawerData.client.lastPurchaseAt)} • ${formatDays(drawerData.client.daysSinceLastPurchase)}` },
                      { key: 'contactAt', label: 'Последний контакт', children: `${formatDateTime(drawerData.client.lastContactAt)}${drawerData.client.lastContactByName ? ` • ${drawerData.client.lastContactByName}` : ''}` },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Сделок" value={drawerData.client.closedDealsCount} /></Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Активных месяцев" value={drawerData.client.activeMonthsCount} /></Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Выручка" value={drawerData.client.totalRevenue} formatter={(value) => formatMoney(Number(value))} /></Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small"><Statistic title="Средний чек" value={drawerData.client.avgDealAmount} formatter={(value) => formatMoney(Number(value))} /></Card>
                  </Col>
                  <Col span={24}>
                    <Card size="small">
                      <Statistic
                        title="Текущий долг"
                        value={drawerData.client.currentDebt}
                        formatter={(value) => formatMoney(Number(value))}
                        valueStyle={drawerData.client.currentDebt > 0 ? { color: '#cf1322' } : undefined}
                      />
                    </Card>
                  </Col>
                </Row>
              </Col>
            </Row>

            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={24} lg={12}>
                <Card size="small" title="Последний заказ" className="reanimation-drawer-card">
                  {drawerData.client.lastDeal ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space wrap>
                        <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => navigate(`/deals/${drawerData.client.lastDeal!.dealId}`)}>
                          {drawerData.client.lastDeal.title}
                        </Button>
                        <Text type="secondary">
                          {formatDate(drawerData.client.lastDeal.effectiveAt)} • {formatMoney(drawerData.client.lastDeal.revenue)}
                        </Text>
                      </Space>
                      {renderProductButtons(drawerData.client.lastDealProducts, navigate, 'Товары последней сделки не найдены')}
                    </Space>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Последняя сделка не найдена" />
                  )}
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="Что важно сейчас" className="reanimation-drawer-card">
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div>
                      <Text type="secondary">Последний контакт</Text>
                      <div>{drawerData.client.lastContactAt ? formatDateTime(drawerData.client.lastContactAt) : 'Контакта ещё не было'}</div>
                      <Text type="secondary">
                        {drawerData.client.lastContactByName || 'Без ответственного'}
                      </Text>
                    </div>
                    <div>
                      <Text type="secondary">Последняя заметка</Text>
                      <Paragraph style={{ margin: '4px 0 0' }}>
                        {drawerData.client.lastContactPreview || 'Краткой заметки пока нет'}
                      </Paragraph>
                    </div>
                    <div>
                      <Text type="secondary">Хит-товары клиента</Text>
                      <div style={{ marginTop: 4 }}>
                        {renderProductButtons(drawerData.client.topProducts, navigate, 'Нет часто покупаемых товаров')}
                      </div>
                    </div>
                  </Space>
                </Card>
              </Col>
            </Row>

            <Tabs
              items={[
                {
                  key: 'products',
                  label: 'Все товары',
                  children: (
                    <Table<ReanimationClientProductStat>
                      rowKey="productId"
                      size="small"
                      dataSource={drawerData.productStats}
                      columns={productStatColumns}
                      pagination={{ pageSize: 10, showSizeChanger: false }}
                      onRow={(row) => ({
                        onClick: () => navigate(`/inventory/products/${row.productId}`),
                        style: { cursor: 'pointer' },
                      })}
                    />
                  ),
                },
                {
                  key: 'deals',
                  label: 'История сделок',
                  children: (
                    <Table
                      rowKey="dealId"
                      size="small"
                      dataSource={drawerData.recentDeals}
                      columns={recentDealColumns}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      onRow={(row) => ({
                        onClick: () => navigate(`/deals/${row.dealId}`),
                        style: { cursor: 'pointer' },
                      })}
                    />
                  ),
                },
                {
                  key: 'notes',
                  label: 'Контакты и заметки',
                  children: drawerData.notes.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Заметок по клиенту пока нет" />
                  ) : (
                    <List
                      size="small"
                      dataSource={drawerData.notes}
                      renderItem={(item) => (
                        <List.Item>
                          <div style={{ width: '100%' }}>
                            <Space wrap size={8}>
                              <Text strong>{item.authorName}</Text>
                              <Text type="secondary">{formatDateTime(item.createdAt)}</Text>
                            </Space>
                            <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
                              {item.preview}
                            </Paragraph>
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
