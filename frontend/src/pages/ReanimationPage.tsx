import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
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
  Skeleton,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowRightOutlined,
  LoadingOutlined,
  ReloadOutlined,
  RobotOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { APP_INPUT } from '../components/ui/AppClassNames';
import { useIsMobile } from '../hooks/useIsMobile';
import { matchesSearch, smartFilterOption } from '../utils/translit';
import './ReanimationPage.css';
import type {
  ReanimationAiReport,
  ReanimationClientDetail,
  ReanimationClientProductStat,
  ReanimationClientRow,
  ReanimationProductPreview,
  ReanimationStatus,
} from '../types';

const { Title, Text, Paragraph } = Typography;

const CANDIDATE_STATUSES: ReanimationStatus[] = ['ONE_TIME_LOST', 'SLEEPING', 'CHURNED'];

type ReanimationStatusFilter = 'all' | 'CHURNED' | 'ONE_TIME_LOST';

const STATUS_FILTER_OPTIONS: { value: ReanimationStatusFilter; label: string }[] = [
  { value: 'all', label: 'Все статусы' },
  { value: 'CHURNED', label: 'Перестал покупать' },
  { value: 'ONE_TIME_LOST', label: 'Раз купил и пропал' },
];

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
  page: number;
  pageSize: number;
  clientId: string | null;
}

const FILTER_PATCH_KEYS: (keyof ReanimationListUrlState)[] = [
  'q',
  'statuses',
  'managerIds',
  'departments',
  'productNames',
  'debtFilter',
  'contactFilter',
  'sortBy',
  'minDays',
  'maxDays',
];

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

function statusesFromFilter(filter: ReanimationStatusFilter): ReanimationStatus[] {
  if (filter === 'CHURNED') return ['CHURNED'];
  if (filter === 'ONE_TIME_LOST') return ['ONE_TIME_LOST'];
  return [...CANDIDATE_STATUSES];
}

function statusFilterFromStatuses(statuses: ReanimationStatus[]): ReanimationStatusFilter {
  const set = new Set(statuses);
  if (set.size === 1 && set.has('CHURNED')) return 'CHURNED';
  if (set.size === 1 && set.has('ONE_TIME_LOST')) return 'ONE_TIME_LOST';
  return 'all';
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
    contactRaw === 'no_contact' || contactRaw === 'stale_7' || contactRaw === 'stale_30'
      ? contactRaw
      : 'all';

  const sortRaw = sp.get('sort');
  const sortBy: ReanimationSortBy =
    sortRaw && (SORT_OPTIONS as string[]).includes(sortRaw)
      ? (sortRaw as ReanimationSortBy)
      : 'inactive_desc';

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

  const rawPage = parseInt(sp.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPs = parseInt(sp.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPs)
    ? rawPs
    : DEFAULT_PAGE_SIZE;

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
    page,
    pageSize,
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
  if (s.page !== 1) n.set('page', String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) n.set('pageSize', String(s.pageSize));
  if (s.clientId) n.set('client', s.clientId);
  return n;
}

function mergeReanimationListParams(
  prev: URLSearchParams,
  patch: Partial<ReanimationListUrlState>,
): URLSearchParams {
  const cur = parseReanimationListParams(prev);
  const filterTouched = FILTER_PATCH_KEYS.some((k) => patch[k] !== undefined);
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
    page: patch.page !== undefined ? patch.page : filterTouched ? 1 : cur.page,
    pageSize: patch.pageSize !== undefined ? patch.pageSize : cur.pageSize,
    clientId: patch.clientId !== undefined ? patch.clientId : cur.clientId,
  };
  return serializeReanimationListState(next);
}

const STATUS_META: Record<ReanimationStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Активный', color: 'default' },
  ONE_TIME_LOST: { label: 'Раз купил и пропал', color: 'orange' },
  SLEEPING: { label: 'Повторный, уснул', color: 'gold' },
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

/** Urgency color for "days since last purchase" */
function getDaysStyle(days: number | null | undefined): CSSProperties {
  if (days === null || days === undefined) return {};
  if (days >= 90) return { color: '#cf1322', fontWeight: 600 };
  if (days >= 60) return { color: '#d46b08', fontWeight: 500 };
  return { color: '#d48806' };
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

// ─── AI Report Card ────────────────────────────────────────────────────────────

interface AiReportCardProps {
  report: ReanimationAiReport | null;
  isLoading: boolean;
  isGenerating: boolean;
  error: Error | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onGenerate: () => void;
}

function AiReportCard({
  report,
  isLoading,
  isGenerating,
  error,
  expanded,
  onToggleExpand,
  onGenerate,
}: AiReportCardProps) {
  const generatedAt = report?.generatedAt ? new Date(report.generatedAt) : null;
  const ageMs = generatedAt ? Date.now() - generatedAt.getTime() : null;
  const ageTxt =
    ageMs !== null
      ? ageMs < 60_000
        ? 'только что'
        : ageMs < 3_600_000
          ? `${Math.round(ageMs / 60_000)} мин. назад`
          : ageMs < 86_400_000
            ? `${Math.round(ageMs / 3_600_000)} ч. назад`
            : generatedAt!.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : null;

  const cardExtra = report ? (
    <Space size={8}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {report.generatedBy} · {ageTxt}
      </Text>
      <Tooltip title="Сгенерировать новый отчёт">
        <Button
          size="small"
          icon={<RobotOutlined />}
          loading={isGenerating}
          onClick={(e) => {
            e.stopPropagation();
            onGenerate();
          }}
        >
          Обновить
        </Button>
      </Tooltip>
      <Button size="small" type="link" style={{ padding: 0 }} onClick={onToggleExpand}>
        {expanded ? 'Свернуть' : 'Развернуть'}
      </Button>
    </Space>
  ) : (
    <Button
      type="primary"
      icon={<RobotOutlined />}
      loading={isGenerating}
      onClick={onGenerate}
      disabled={isLoading}
    >
      {isGenerating ? 'Генерация...' : 'Сгенерировать AI-отчёт'}
    </Button>
  );

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <RobotOutlined />
          <span>AI-анализ реанимации</span>
          {!report && !isLoading && !isGenerating && (
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              — нажмите кнопку справа для получения отчёта
            </Text>
          )}
        </Space>
      }
      extra={cardExtra}
      style={{ marginBottom: 12 }}
    >
      {error && (
        <Alert
          type="error"
          message={
            (error as Error & { response?: { data?: { message?: string } } })?.response?.data
              ?.message || error.message
          }
          showIcon
          style={{ marginBottom: 8 }}
        />
      )}

      {isGenerating && (
        <div className="ai-report-generating">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 28 }} />} />
          <div>
            <Text>Анализирую данные с помощью Claude AI...</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Это может занять 30–60 секунд
            </Text>
          </div>
        </div>
      )}

      {report && !isGenerating && expanded && (
        <div className="ai-report-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
        </div>
      )}

      {report && !isGenerating && !expanded && (
        <button className="ai-report-collapsed-hint" onClick={onToggleExpand} type="button">
          <RobotOutlined />
          <span>Отчёт готов — нажмите чтобы развернуть</span>
          <ArrowRightOutlined style={{ fontSize: 11 }} />
        </button>
      )}
    </Card>
  );
}

// ─── Row card skeleton ─────────────────────────────────────────────────────────

function RowCardSkeleton() {
  return (
    <Card size="small" className="reanimation-row-card">
      <Skeleton active paragraph={{ rows: 3 }} />
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ReanimationPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseReanimationListParams(searchParams), [searchParams]);
  const [aiReportExpanded, setAiReportExpanded] = useState(false);

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

  const { page, pageSize } = listState;

  const flushSearchToUrl = useCallback(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === listState.q.trim()) return;
    patchListState({ q: trimmed });
  }, [searchDraft, listState.q, patchListState]);

  const goToClientCard = useCallback(
    (clientId: string) => {
      flushSearchToUrl();
      navigate(`/clients/${clientId}`);
    },
    [flushSearchToUrl, navigate],
  );

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['analytics-reanimation'],
    queryFn: analyticsApi.getReanimationClients,
    staleTime: 15 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });

  const drawerClientId = listState.clientId;

  const drawerQuery = useQuery({
    queryKey: ['analytics-reanimation-detail', drawerClientId],
    queryFn: () => analyticsApi.getReanimationClientDetail(drawerClientId!),
    enabled: Boolean(drawerClientId),
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const aiReportQuery = useQuery({
    queryKey: ['analytics-reanimation-ai-report'],
    queryFn: analyticsApi.getReanimationAiReport,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const generateReportMutation = useMutation({
    mutationFn: analyticsApi.generateReanimationAiReport,
    onSuccess: (data) => {
      queryClient.setQueryData(['analytics-reanimation-ai-report'], data);
      setAiReportExpanded(true);
    },
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
      rows = rows.filter(
        (row) => row.managerDepartment && departments.includes(row.managerDepartment),
      );
    }
    if (productNames.length > 0) {
      rows = rows.filter((row) =>
        productNames.every((productName) => row.productNames.includes(productName)),
      );
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
      if (sortBy === 'inactive_desc')
        return (b.daysSinceLastPurchase ?? 0) - (a.daysSinceLastPurchase ?? 0);
      if (sortBy === 'inactive_asc')
        return (a.daysSinceLastPurchase ?? 0) - (b.daysSinceLastPurchase ?? 0);
      if (sortBy === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
      if (sortBy === 'deals_desc') return b.closedDealsCount - a.closedDealsCount;
      if (sortBy === 'debt_desc') return b.currentDebt - a.currentDebt;
      return (
        (b.daysSinceLastContact ?? Number.POSITIVE_INFINITY) -
        (a.daysSinceLastContact ?? Number.POSITIVE_INFINITY)
      );
    });

    return rows;
  }, [data, listState, searchDraft]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRows.length / pageSize) || 1);
    if (page > maxPage) patchListState({ page: maxPage }, { replace: true });
  }, [filteredRows.length, page, pageSize, patchListState]);

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

  /** Count of non-default active filters for the badge */
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (listState.q.trim()) n++;
    if (!statusSelectionIsDefault(listState.statuses)) n++;
    if (listState.managerIds.length > 0) n++;
    if (listState.departments.length > 0) n++;
    if (listState.productNames.length > 0) n++;
    if (listState.debtFilter !== 'all') n++;
    if (listState.contactFilter !== 'all') n++;
    if (listState.minDays !== null && listState.minDays !== 30) n++;
    if (listState.maxDays !== null) n++;
    return n;
  }, [listState]);

  const resetFilters = () => {
    setSearchDraft('');
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
            <Space size={[6, 6]} wrap>
              <Tag color={STATUS_META[row.status].color}>{STATUS_META[row.status].label}</Tag>
              {row.phone ? <Text type="secondary">{row.phone}</Text> : null}
              {row.currentDebt > 0 ? <Tag color="red">Долг</Tag> : null}
              {!row.lastContactAt ? <Tag color="orange">Без контакта</Tag> : null}
            </Space>
          </div>
        </div>

        {/* Single action: go to full client card. Opening the drawer = click anywhere on card. */}
        <div
          className="reanimation-row-card__actions"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="small"
            onClick={() => goToClientCard(row.clientId)}
          >
            Карточка
          </Button>
        </div>
      </div>

      <div className="reanimation-row-card__grid">
        <div className="reanimation-row-card__item">
          <Text type="secondary" className="reanimation-item-label">Ответственный</Text>
          <Text strong>{row.managerName}</Text>
          <Text type="secondary">{row.managerDepartment || 'Без отдела'}</Text>
        </div>

        <div className="reanimation-row-card__item">
          <Text type="secondary" className="reanimation-item-label">Последняя покупка</Text>
          <Text>{formatDate(row.lastPurchaseAt)}</Text>
          <Text style={getDaysStyle(row.daysSinceLastPurchase)}>
            {formatDays(row.daysSinceLastPurchase)}
          </Text>
        </div>

        <div className="reanimation-row-card__item">
          <Text type="secondary" className="reanimation-item-label">Последний контакт</Text>
          <Text>{row.lastContactAt ? formatDateTime(row.lastContactAt) : 'Не было'}</Text>
          <Text type="secondary">
            {row.lastContactAt
              ? `${row.lastContactByName || 'Без автора'}${
                  row.daysSinceLastContact != null ? ` · ${formatDays(row.daysSinceLastContact)}` : ''
                }`
              : 'Нужен первый контакт'}
          </Text>
        </div>

        <div className="reanimation-row-card__item">
          <Text type="secondary" className="reanimation-item-label">Показатели</Text>
          <Text>{row.closedDealsCount} сделок</Text>
          <Text type="secondary">{formatMoney(row.totalRevenue)} сум</Text>
          {row.currentDebt > 0 && (
            <Text type="danger">Долг: {formatMoney(row.currentDebt)}</Text>
          )}
        </div>
      </div>
    </Card>
  );

  const drawerData = drawerQuery.data as ReanimationClientDetail | undefined;

  const productStatColumns = [
    { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
    {
      title: 'Сделок',
      dataIndex: 'dealsCount',
      key: 'dealsCount',
      width: 80,
      align: 'right' as const,
    },
    {
      title: 'Кол-во',
      dataIndex: 'totalQty',
      key: 'totalQty',
      width: 100,
      align: 'right' as const,
    },
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
      width: 130,
      render: (value: string) => formatDate(value),
    },
  ];

  const recentDealColumns = [
    { title: 'Сделка', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: 'Дата',
      dataIndex: 'effectiveAt',
      key: 'effectiveAt',
      width: 110,
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
    {
      title: 'Статус',
      dataIndex: 'paymentStatus',
      key: 'paymentStatus',
      width: 120,
    },
  ];

  const filterCardTitle = (
    <Space size={8}>
      <span>Фильтры</span>
      {activeFilterCount > 0 && (
        <Badge
          count={activeFilterCount}
          size="small"
          style={{ backgroundColor: 'var(--ant-color-primary)' }}
        />
      )}
    </Space>
  );

  return (
    <div className="reanimation-page">
      {/* ── Header ── */}
      <Row justify="space-between" align="middle" gutter={[12, 8]} style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={4} style={{ margin: 0 }}>
            <SoundOutlined style={{ marginRight: 8 }} />
            Реанимация клиентов
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Клиенты, которые купили один раз и пропали, или перестали покупать.
          </Text>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
            Обновить
          </Button>
        </Col>
      </Row>

      {/* ── AI Report ── */}
      <AiReportCard
        report={aiReportQuery.data ?? null}
        isLoading={aiReportQuery.isLoading}
        isGenerating={generateReportMutation.isPending}
        error={generateReportMutation.error as Error | null}
        expanded={aiReportExpanded}
        onToggleExpand={() => setAiReportExpanded((v) => !v)}
        onGenerate={() => generateReportMutation.mutate()}
      />

      {/* ── Summary stats ── */}
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="Кандидаты"
              value={summary.visible}
              suffix={<Text type="secondary" style={{ fontSize: 13 }}>/ {allCandidates.length}</Text>}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="Разовые" value={summary.lostSingle} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="Уснувшие" value={summary.sleeping} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic
              title="С долгом"
              value={summary.withDebt}
              valueStyle={summary.withDebt > 0 ? { color: '#cf1322' } : undefined}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Filters ──
          Layout (12-col grid, 3 clean rows):
          Row 1: Search (6) + Status (6)
          Row 2: Managers (3) + Dept (3) + Products (3) + Days range (3)
          Row 3: Debt (3) + Contact (3) + Sort (3) + Reset (3)
      */}
      <Card
        size="small"
        title={filterCardTitle}
        className="reanimation-filters-card"
        style={{ marginBottom: 12 }}
      >
        <div className="reanimation-filters-grid">
          {/* Row 1 */}
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
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Статус"
              value={statusFilterFromStatuses(listState.statuses)}
              onChange={(value) =>
                patchListState({
                  statuses: statusesFromFilter((value ?? 'all') as ReanimationStatusFilter),
                })
              }
              options={STATUS_FILTER_OPTIONS}
            />
          </div>

          {/* Row 2 */}
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
          {/* Combined days-since-purchase range — single span-3 item */}
          <div className="reanimation-filter-item">
            <div className="reanimation-days-range">
              <InputNumber
                className={APP_INPUT}
                style={{ flex: 1, minWidth: 0 }}
                min={0}
                value={listState.minDays}
                onChange={(value) =>
                  patchListState({ minDays: typeof value === 'number' ? value : null })
                }
                placeholder="Дней от"
              />
              <span className="reanimation-days-range__sep">—</span>
              <InputNumber
                className={APP_INPUT}
                style={{ flex: 1, minWidth: 0 }}
                min={0}
                value={listState.maxDays}
                onChange={(value) =>
                  patchListState({ maxDays: typeof value === 'number' ? value : null })
                }
                placeholder="до"
              />
            </div>
            <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: 'block' }}>
              Дней без покупки
            </Text>
          </div>

          {/* Row 3 */}
          <div className="reanimation-filter-item">
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Долг"
              value={listState.debtFilter}
              onChange={(value) => patchListState({ debtFilter: value as DebtFilter })}
              options={[
                { value: 'all', label: 'Любой долг' },
                { value: 'with_debt', label: 'Есть долг' },
                { value: 'without_debt', label: 'Нет долга' },
              ]}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Контакты"
              value={listState.contactFilter}
              onChange={(value) => patchListState({ contactFilter: value as ContactFilter })}
              options={[
                { value: 'all', label: 'Все контакты' },
                { value: 'no_contact', label: 'Без заметок' },
                { value: 'stale_7', label: 'Нет контакта 7+ дн.' },
                { value: 'stale_30', label: 'Нет контакта 30+ дн.' },
              ]}
            />
          </div>
          <div className="reanimation-filter-item">
            <Select
              className={APP_INPUT}
              style={{ width: '100%' }}
              placeholder="Сортировка"
              value={listState.sortBy}
              onChange={(value) => patchListState({ sortBy: value as ReanimationSortBy })}
              options={[
                { value: 'inactive_desc', label: 'Дольше без покупки' },
                { value: 'inactive_asc', label: 'Ближе к активности' },
                { value: 'revenue_desc', label: 'По выручке' },
                { value: 'deals_desc', label: 'По числу сделок' },
                { value: 'debt_desc', label: 'По долгу' },
                { value: 'contact_oldest', label: 'Старейший контакт' },
              ]}
            />
          </div>
          <div className="reanimation-filter-item reanimation-filter-item--action">
            <Button
              block
              onClick={resetFilters}
              disabled={activeFilterCount === 0}
            >
              {activeFilterCount > 0 ? `Сбросить (${activeFilterCount})` : 'Сбросить'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Client list ── */}
      <Card
        size="small"
        title={`Список клиентов (${filteredRows.length})`}
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            Только кандидаты на возврат
          </Text>
        }
      >
        {isLoading ? (
          <div className="reanimation-row-list">
            {[1, 2, 3].map((i) => (
              <RowCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <Empty
            description={
              activeFilterCount > 0
                ? 'По текущим фильтрам клиентов не найдено'
                : 'Нет клиентов для реанимации'
            }
          />
        ) : (
          <div className="reanimation-row-list">
            {paginatedRows.map((row) => renderClientRowCard(row))}
          </div>
        )}
      </Card>

      {/* ── Pagination ── */}
      {!isLoading && filteredRows.length > pageSize ? (
        <div
          className="reanimation-pagination-bar"
          role="navigation"
          aria-label="Пагинация списка клиентов"
        >
          <Pagination
            current={page}
            pageSize={pageSize}
            total={filteredRows.length}
            showSizeChanger
            pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
            showTotal={(total, range) => `${range[0]}–${range[1]} из ${total}`}
            onChange={(nextPage, nextPageSize) => {
              patchListState({
                page: nextPage,
                ...(nextPageSize !== pageSize ? { pageSize: nextPageSize } : {}),
              });
            }}
            size={isMobile ? 'small' : 'middle'}
          />
        </div>
      ) : null}

      {/* ── Client detail drawer ── */}
      <Drawer
        width={isMobile ? '100%' : Math.min(960, window.innerWidth - 64)}
        open={Boolean(drawerClientId)}
        onClose={() => patchListState({ clientId: null })}
        title={drawerData?.client.companyName || 'Карточка клиента'}
        extra={
          drawerData && (
            <Button
              size="small"
              type="link"
              onClick={() => goToClientCard(drawerData.client.clientId)}
            >
              Открыть полную карточку →
            </Button>
          )
        }
      >
        {!drawerClientId || drawerQuery.isLoading || !drawerData ? (
          <div style={{ paddingTop: 8 }}>
            <Skeleton active paragraph={{ rows: 6 }} />
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
                        children: (
                          <Tag color={STATUS_META[drawerData.client.status].color}>
                            {STATUS_META[drawerData.client.status].label}
                          </Tag>
                        ),
                      },
                      {
                        key: 'manager',
                        label: 'Менеджер',
                        children: `${drawerData.client.managerName}${
                          drawerData.client.managerDepartment
                            ? ` · ${drawerData.client.managerDepartment}`
                            : ''
                        }`,
                      },
                      {
                        key: 'contact',
                        label: 'Контакт',
                        children: drawerData.client.contactName || '—',
                      },
                      {
                        key: 'phone',
                        label: 'Телефон',
                        children: drawerData.client.phone || '—',
                      },
                      {
                        key: 'telegram',
                        label: 'Telegram',
                        children: drawerData.client.email || '—',
                      },
                      {
                        key: 'address',
                        label: 'Адрес',
                        children: drawerData.client.address || '—',
                      },
                      {
                        key: 'purchase',
                        label: 'Последняя покупка',
                        children: (
                          <span style={getDaysStyle(drawerData.client.daysSinceLastPurchase)}>
                            {formatDate(drawerData.client.lastPurchaseAt)} ·{' '}
                            {formatDays(drawerData.client.daysSinceLastPurchase)}
                          </span>
                        ),
                      },
                      {
                        key: 'contactAt',
                        label: 'Последний контакт',
                        children: `${formatDateTime(drawerData.client.lastContactAt)}${
                          drawerData.client.lastContactByName
                            ? ` · ${drawerData.client.lastContactByName}`
                            : ''
                        }`,
                      },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Row gutter={[10, 10]}>
                  <Col span={12}>
                    <Card size="small">
                      <Statistic title="Сделок" value={drawerData.client.closedDealsCount} />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small">
                      <Statistic
                        title="Активных мес."
                        value={drawerData.client.activeMonthsCount}
                      />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small">
                      <Statistic
                        title="Выручка"
                        value={drawerData.client.totalRevenue}
                        formatter={(value) => formatMoney(Number(value))}
                      />
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card size="small">
                      <Statistic
                        title="Средний чек"
                        value={drawerData.client.avgDealAmount}
                        formatter={(value) => formatMoney(Number(value))}
                      />
                    </Card>
                  </Col>
                  <Col span={24}>
                    <Card size="small">
                      <Statistic
                        title="Текущий долг"
                        value={drawerData.client.currentDebt}
                        formatter={(value) => formatMoney(Number(value))}
                        valueStyle={
                          drawerData.client.currentDebt > 0 ? { color: '#cf1322' } : undefined
                        }
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
                        <Button
                          type="link"
                          style={{ padding: 0, height: 'auto' }}
                          onClick={() =>
                            navigate(`/deals/${drawerData.client.lastDeal!.dealId}`)
                          }
                        >
                          {drawerData.client.lastDeal.title}
                        </Button>
                        <Text type="secondary">
                          {formatDate(drawerData.client.lastDeal.effectiveAt)} ·{' '}
                          {formatMoney(drawerData.client.lastDeal.revenue)} сум
                        </Text>
                      </Space>
                      {renderProductButtons(
                        drawerData.client.lastDealProducts,
                        navigate,
                        'Товары последней сделки не найдены',
                      )}
                    </Space>
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Последняя сделка не найдена"
                    />
                  )}
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="Что важно сейчас" className="reanimation-drawer-card">
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Последний контакт
                      </Text>
                      <div>
                        {drawerData.client.lastContactAt
                          ? formatDateTime(drawerData.client.lastContactAt)
                          : 'Контакта ещё не было'}
                      </div>
                      <Text type="secondary">
                        {drawerData.client.lastContactByName || 'Без ответственного'}
                      </Text>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Последняя заметка
                      </Text>
                      <Paragraph style={{ margin: '4px 0 0' }}>
                        {drawerData.client.lastContactPreview || 'Краткой заметки пока нет'}
                      </Paragraph>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Хит-товары клиента
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        {renderProductButtons(
                          drawerData.client.topProducts,
                          navigate,
                          'Нет часто покупаемых товаров',
                        )}
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
                  label: 'Заметки',
                  children:
                    drawerData.notes.length === 0 ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="Заметок по клиенту пока нет"
                      />
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
