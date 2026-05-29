import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Col,
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
import {
  BarChartOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { APP_INPUT } from '../components/ui/AppClassNames';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatUZS } from '../utils/currency';
import { matchesSearch, smartFilterOption } from '../utils/translit';
import type { DeadProductIssue, DeadProductRow } from '../types';
import './DeadProductsPage.css';

const { Title, Text } = Typography;

const ALL_ISSUES: DeadProductIssue[] = ['STAGNANT', 'ZERO_STOCK', 'ZERO_LONG', 'NEVER_SOLD', 'NO_SALES'];

const ISSUE_META: Record<DeadProductIssue, { label: string; color: string; short: string }> = {
  STAGNANT: { label: 'Завис на складе', color: 'gold', short: 'Завис' },
  ZERO_STOCK: { label: 'Нулевой остаток', color: 'default', short: 'Ноль' },
  ZERO_LONG: { label: 'Долго на нуле', color: 'orange', short: 'Долго 0' },
  NEVER_SOLD: { label: 'Никогда не продавался', color: 'purple', short: 'Без продаж' },
  NO_SALES: { label: 'Нет продаж давно', color: 'red', short: 'Нет продаж' },
};

type StockFilter = 'all' | 'zero' | 'positive' | 'low';
type ActiveFilter = 'active' | 'all' | 'inactive';
type DeadProductsSortBy =
  | 'dead_first'
  | 'no_sales_desc'
  | 'zero_days_desc'
  | 'stock_desc'
  | 'frozen_desc'
  | 'revenue90_desc'
  | 'name_asc';

type PresetKey = 'dead' | 'no_sales' | 'zero' | 'stagnant' | 'all';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

interface DeadProductsUrlState {
  q: string;
  issues: DeadProductIssue[];
  categories: string[];
  countries: string[];
  stockFilter: StockFilter;
  activeFilter: ActiveFilter;
  deadOnly: boolean;
  noSalesDays: number;
  zeroStockDays: number;
  sortBy: DeadProductsSortBy;
  preset: PresetKey;
  page: number;
  pageSize: number;
}

const FILTER_PATCH_KEYS: (keyof DeadProductsUrlState)[] = [
  'q',
  'issues',
  'categories',
  'countries',
  'stockFilter',
  'activeFilter',
  'deadOnly',
  'noSalesDays',
  'zeroStockDays',
  'sortBy',
  'preset',
];

function parseIssues(raw: string | null): DeadProductIssue[] {
  if (!raw?.trim()) return [...ALL_ISSUES];
  const picked = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DeadProductIssue => (ALL_ISSUES as string[]).includes(s));
  return picked.length > 0 ? picked : [...ALL_ISSUES];
}

function issuesFromPreset(preset: PresetKey): DeadProductIssue[] | null {
  if (preset === 'no_sales') return ['NO_SALES', 'NEVER_SOLD'];
  if (preset === 'zero') return ['ZERO_STOCK', 'ZERO_LONG'];
  if (preset === 'stagnant') return ['STAGNANT'];
  return null;
}

function presetFromState(s: DeadProductsUrlState): PresetKey {
  if (s.preset !== 'dead' && s.preset !== 'all') return s.preset;
  if (!s.deadOnly) return 'all';
  return 'dead';
}

function parseDeadProductsParams(sp: URLSearchParams): DeadProductsUrlState {
  const presetRaw = sp.get('preset');
  const preset: PresetKey =
    presetRaw === 'no_sales' || presetRaw === 'zero' || presetRaw === 'stagnant' || presetRaw === 'all'
      ? presetRaw
      : 'dead';

  const presetIssues = issuesFromPreset(preset);
  const issues = presetIssues ?? parseIssues(sp.get('issues'));

  const catRaw = sp.get('cat');
  const categories = catRaw ? catRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const countryRaw = sp.get('country');
  const countries = countryRaw ? countryRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  const stockRaw = sp.get('stock');
  const stockFilter: StockFilter =
    stockRaw === 'zero' || stockRaw === 'positive' || stockRaw === 'low' ? stockRaw : 'all';

  const activeRaw = sp.get('active');
  const activeFilter: ActiveFilter =
    activeRaw === 'all' || activeRaw === 'inactive' ? activeRaw : 'active';

  const deadOnly = sp.get('deadOnly') !== '0' && preset !== 'all';

  const noSalesDays = parseInt(sp.get('noSales') || '90', 10);
  const zeroStockDays = parseInt(sp.get('zeroDays') || '30', 10);

  const sortRaw = sp.get('sort');
  const sortBy: DeadProductsSortBy =
    sortRaw === 'no_sales_desc' ||
    sortRaw === 'zero_days_desc' ||
    sortRaw === 'stock_desc' ||
    sortRaw === 'frozen_desc' ||
    sortRaw === 'revenue90_desc' ||
    sortRaw === 'name_asc'
      ? sortRaw
      : 'dead_first';

  const rawPage = parseInt(sp.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPs = parseInt(sp.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPs) ? rawPs : DEFAULT_PAGE_SIZE;

  return {
    q: sp.get('q') ?? '',
    issues,
    categories,
    countries,
    stockFilter,
    activeFilter,
    deadOnly,
    noSalesDays: Number.isFinite(noSalesDays) && noSalesDays >= 0 ? noSalesDays : 90,
    zeroStockDays: Number.isFinite(zeroStockDays) && zeroStockDays >= 0 ? zeroStockDays : 30,
    sortBy,
    preset,
    page,
    pageSize,
  };
}

function serializeDeadProductsState(s: DeadProductsUrlState): URLSearchParams {
  const n = new URLSearchParams();
  if (s.q.trim()) n.set('q', s.q.trim());
  if (s.preset !== 'dead') n.set('preset', s.preset);
  else if (s.issues.length > 0 && s.issues.length < ALL_ISSUES.length) {
    n.set('issues', [...new Set(s.issues)].sort().join(','));
  }
  if (s.categories.length > 0) n.set('cat', s.categories.join(','));
  if (s.countries.length > 0) n.set('country', s.countries.join(','));
  if (s.stockFilter !== 'all') n.set('stock', s.stockFilter);
  if (s.activeFilter !== 'active') n.set('active', s.activeFilter);
  if (!s.deadOnly) n.set('deadOnly', '0');
  if (s.noSalesDays !== 90) n.set('noSales', String(s.noSalesDays));
  if (s.zeroStockDays !== 30) n.set('zeroDays', String(s.zeroStockDays));
  if (s.sortBy !== 'dead_first') n.set('sort', s.sortBy);
  if (s.page !== 1) n.set('page', String(s.page));
  if (s.pageSize !== DEFAULT_PAGE_SIZE) n.set('pageSize', String(s.pageSize));
  return n;
}

function mergeDeadProductsParams(
  prev: URLSearchParams,
  patch: Partial<DeadProductsUrlState>,
): URLSearchParams {
  const cur = parseDeadProductsParams(prev);
  const filterTouched = FILTER_PATCH_KEYS.some((k) => patch[k] !== undefined);
  const next: DeadProductsUrlState = {
    q: patch.q !== undefined ? patch.q : cur.q,
    issues: patch.issues !== undefined ? patch.issues : cur.issues,
    categories: patch.categories !== undefined ? patch.categories : cur.categories,
    countries: patch.countries !== undefined ? patch.countries : cur.countries,
    stockFilter: patch.stockFilter !== undefined ? patch.stockFilter : cur.stockFilter,
    activeFilter: patch.activeFilter !== undefined ? patch.activeFilter : cur.activeFilter,
    deadOnly: patch.deadOnly !== undefined ? patch.deadOnly : cur.deadOnly,
    noSalesDays: patch.noSalesDays !== undefined ? patch.noSalesDays : cur.noSalesDays,
    zeroStockDays: patch.zeroStockDays !== undefined ? patch.zeroStockDays : cur.zeroStockDays,
    sortBy: patch.sortBy !== undefined ? patch.sortBy : cur.sortBy,
    preset: patch.preset !== undefined ? patch.preset : cur.preset,
    page: patch.page !== undefined ? patch.page : filterTouched ? 1 : cur.page,
    pageSize: patch.pageSize !== undefined ? patch.pageSize : cur.pageSize,
  };

  if (patch.preset !== undefined) {
    const presetIssues = issuesFromPreset(patch.preset);
    if (presetIssues) next.issues = presetIssues;
    if (patch.preset === 'all') next.deadOnly = false;
    else if (patch.preset === 'dead') next.deadOnly = true;
  }

  return serializeDeadProductsState(next);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return dayjs(value).format('DD.MM.YYYY');
}

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value} дн.`;
}

function buildHaystack(row: DeadProductRow) {
  return [row.name, row.sku, row.category ?? '', row.countryOfOrigin ?? ''].join(' ');
}

function sortRows(rows: DeadProductRow[], sortBy: DeadProductsSortBy): DeadProductRow[] {
  const copy = [...rows];
  const deadScore = (r: DeadProductRow) => (r.isDead ? 1 : 0);
  const noSalesKey = (r: DeadProductRow) => r.daysSinceLastSale ?? 999_999;

  copy.sort((a, b) => {
    switch (sortBy) {
      case 'name_asc':
        return a.name.localeCompare(b.name, 'ru');
      case 'stock_desc':
        return b.stock - a.stock;
      case 'frozen_desc':
        return b.frozenValue - a.frozenValue;
      case 'revenue90_desc':
        return b.revenue90d - a.revenue90d;
      case 'zero_days_desc':
        return (b.daysAtZero ?? -1) - (a.daysAtZero ?? -1);
      case 'no_sales_desc':
        return noSalesKey(b) - noSalesKey(a);
      case 'dead_first':
      default:
        if (deadScore(b) !== deadScore(a)) return deadScore(b) - deadScore(a);
        return noSalesKey(b) - noSalesKey(a);
    }
  });
  return copy;
}

function renderIssueTags(issues: DeadProductIssue[]) {
  if (issues.length === 0) return <Text type="secondary">—</Text>;
  return (
    <Space size={[4, 4]} wrap>
      {issues.map((issue) => (
        <Tag key={issue} color={ISSUE_META[issue].color}>
          {ISSUE_META[issue].short}
        </Tag>
      ))}
    </Space>
  );
}

export default function DeadProductsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseDeadProductsParams(searchParams), [searchParams]);

  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('q') ?? '');
  const patchListState = useCallback(
    (patch: Partial<DeadProductsUrlState>) => {
      setSearchParams((prev) => mergeDeadProductsParams(prev, patch), { replace: true });
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

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dead-products', listState.noSalesDays, listState.zeroStockDays],
    queryFn: () =>
      analyticsApi.getDeadProducts({
        noSalesDays: listState.noSalesDays,
        zeroStockDays: listState.zeroStockDays,
      }),
  });

  const filtered = useMemo(() => {
    const rows = data?.products ?? [];
    const issueSet = new Set(listState.issues);
    const issuesFiltered =
      listState.issues.length < ALL_ISSUES.length || listState.preset !== 'all';

    return rows.filter((row) => {
      if (listState.deadOnly && !row.isDead) return false;
      if (issuesFiltered && !row.issues.some((i) => issueSet.has(i))) return false;

      if (listState.activeFilter === 'active' && !row.isActive) return false;
      if (listState.activeFilter === 'inactive' && row.isActive) return false;

      if (listState.categories.length > 0) {
        const cat = row.category || '';
        if (!listState.categories.includes(cat)) return false;
      }
      if (listState.countries.length > 0) {
        const c = row.countryOfOrigin || '';
        if !listState.countries.includes(c)) return false;
      }

      if (listState.stockFilter === 'zero' && row.stock > 0) return false;
      if (listState.stockFilter === 'positive' && row.stock <= 0) return false;
      if (listState.stockFilter === 'low' && !(row.stock > 0 && row.stock < row.minStock)) return false;

      if (listState.q.trim() && !matchesSearch(buildHaystack(row), listState.q)) return false;
      return true;
    });
  }, [data?.products, listState]);

  const sorted = useMemo(() => sortRows(filtered, listState.sortBy), [filtered, listState.sortBy]);

  const pageRows = useMemo(() => {
    const start = (listState.page - 1) * listState.pageSize;
    return sorted.slice(start, start + listState.pageSize);
  }, [sorted, listState.page, listState.pageSize]);

  const activePreset = presetFromState(listState);

  const presetOptions = [
    { key: 'dead' as const, label: `Мёртвые (${data?.summary.deadCount ?? '…'})` },
    { key: 'no_sales' as const, label: 'Не продаётся' },
    { key: 'zero' as const, label: 'Ноль на складе' },
    { key: 'stagnant' as const, label: 'Зависший остаток' },
    { key: 'all' as const, label: 'Все товары' },
  ];

  const columns = [
    {
      title: 'Товар',
      dataIndex: 'name',
      key: 'name',
      fixed: isMobile ? undefined : ('left' as const),
      width: isMobile ? 180 : 240,
      render: (_: unknown, row: DeadProductRow) => (
        <div>
          <Text strong>{row.name}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.sku}
              {row.category ? ` · ${row.category}` : ''}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Проблемы',
      key: 'issues',
      width: 160,
      render: (_: unknown, row: DeadProductRow) => renderIssueTags(row.issues),
    },
    {
      title: 'Остаток',
      key: 'stock',
      width: 100,
      render: (_: unknown, row: DeadProductRow) => (
        <span>
          {row.stock} {row.unit}
          {row.stock > 0 && row.stock < row.minStock ? (
            <Tag color="orange" style={{ marginLeft: 4 }}>
              мало
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: 'Без продаж',
      key: 'daysSinceLastSale',
      width: 110,
      render: (_: unknown, row: DeadProductRow) => formatDays(row.daysSinceLastSale),
    },
    {
      title: 'На нуле',
      key: 'daysAtZero',
      width: 90,
      render: (_: unknown, row: DeadProductRow) => formatDays(row.daysAtZero),
    },
    {
      title: 'Посл. продажа',
      key: 'lastSaleAt',
      width: 120,
      render: (_: unknown, row: DeadProductRow) => formatDate(row.lastSaleAt),
    },
    {
      title: '90 дн.',
      key: 'revenue90d',
      width: 110,
      render: (_: unknown, row: DeadProductRow) => (
        <span>
          {row.qtySold90d > 0 ? `${row.qtySold90d} шт` : '—'}
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {row.revenue90d > 0 ? formatUZS(row.revenue90d) : ''}
          </Text>
        </span>
      ),
    },
    {
      title: 'Заморожено',
      key: 'frozenValue',
      width: 120,
      render: (_: unknown, row: DeadProductRow) =>
        row.frozenValue > 0 ? formatUZS(row.frozenValue) : '—',
    },
    {
      title: '',
      key: 'actions',
      width: 88,
      fixed: isMobile ? undefined : ('right' as const),
      render: (_: unknown, row: DeadProductRow) => (
        <Button
          type="link"
          size="small"
          icon={<BarChartOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/inventory/products/${row.productId}`);
          }}
        >
          Карточка
        </Button>
      ),
    },
  ];

  return (
    <div className="dead-products-page">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            <WarningOutlined style={{ marginRight: 8, color: '#cf1322' }} />
            Мёртвые товары
          </Title>
          <Text type="secondary">
            Товары без продаж или с длительным нулевым остатком — для решений по закупке, цене и выводу из ассортимента.
          </Text>
        </div>

        {data?.summary && (
          <Row gutter={[12, 12]} className="dead-products-summary-row">
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic title="Мёртвых позиций" value={data.summary.deadCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic title="Нулевой остаток" value={data.summary.zeroStockCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic title="Зависло на складе" value={data.summary.stagnantCount} loading={isLoading} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card size="small">
                <Statistic
                  title="Замороженный капитал"
                  value={data.summary.frozenCapital}
                  formatter={(v) => formatUZS(Number(v))}
                  loading={isLoading}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Card size="small" className="dead-products-filters-card">
          <div className="dead-products-preset-tabs">
            <Space wrap>
              {presetOptions.map((opt) => (
                <Button
                  key={opt.key}
                  type={activePreset === opt.key ? 'primary' : 'default'}
                  size="small"
                  onClick={() => patchListState({ preset: opt.key })}
                >
                  {opt.label}
                </Button>
              ))}
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={isFetching}
                onClick={() => void refetch()}
              >
                Обновить
              </Button>
            </Space>
          </div>

          <div className="dead-products-filters-grid">
            <div className="dead-products-filter-item dead-products-filter-item--wide">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Поиск
              </Text>
              <Input
                className={APP_INPUT}
                allowClear
                placeholder="Название, артикул, категория…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onPressEnter={() => patchListState({ q: searchDraft })}
              />
            </div>

            <div className="dead-products-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Тип проблемы
              </Text>
              <Select
                className={APP_INPUT}
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder="Все типы"
                style={{ width: '100%' }}
                value={listState.issues}
                options={ALL_ISSUES.map((i) => ({ value: i, label: ISSUE_META[i].label }))}
                onChange={(v) => patchListState({ issues: v as DeadProductIssue[], preset: 'dead' })}
              />
            </div>

            <div className="dead-products-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Категория
              </Text>
              <Select
                className={APP_INPUT}
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder="Все"
                style={{ width: '100%' }}
                value={listState.categories}
                options={(data?.categories ?? []).map((c) => ({ value: c, label: c }))}
                filterOption={smartFilterOption}
                onChange={(v) => patchListState({ categories: v })}
              />
            </div>

            <div className="dead-products-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Страна
              </Text>
              <Select
                className={APP_INPUT}
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder="Все"
                style={{ width: '100%' }}
                value={listState.countries}
                options={(data?.countries ?? []).map((c) => ({ value: c, label: c }))}
                filterOption={smartFilterOption}
                onChange={(v) => patchListState({ countries: v })}
              />
            </div>

            <div className="dead-products-filter-item dead-products-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Остаток
              </Text>
              <Select
                className={APP_INPUT}
                style={{ width: '100%' }}
                value={listState.stockFilter}
                options={[
                  { value: 'all', label: 'Любой' },
                  { value: 'zero', label: 'Ноль' },
                  { value: 'positive', label: 'Есть на складе' },
                  { value: 'low', label: 'Ниже мин.' },
                ]}
                onChange={(v) => patchListState({ stockFilter: v })}
              />
            </div>

            <div className="dead-products-filter-item dead-products-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Статус
              </Text>
              <Select
                className={APP_INPUT}
                style={{ width: '100%' }}
                value={listState.activeFilter}
                options={[
                  { value: 'active', label: 'Активные' },
                  { value: 'inactive', label: 'Неактивные' },
                  { value: 'all', label: 'Все' },
                ]}
                onChange={(v) => patchListState({ activeFilter: v })}
              />
            </div>

            <div className="dead-products-filter-item dead-products-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Нет продаж, дн.
              </Text>
              <InputNumber
                className={APP_INPUT}
                min={0}
                max={730}
                style={{ width: '100%' }}
                value={listState.noSalesDays}
                onChange={(v) => patchListState({ noSalesDays: v ?? 90 })}
              />
            </div>

            <div className="dead-products-filter-item dead-products-filter-item--compact">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Ноль на складе, дн.
              </Text>
              <InputNumber
                className={APP_INPUT}
                min={0}
                max={730}
                style={{ width: '100%' }}
                value={listState.zeroStockDays}
                onChange={(v) => patchListState({ zeroStockDays: v ?? 30 })}
              />
            </div>

            <div className="dead-products-filter-item">
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Сортировка
              </Text>
              <Select
                className={APP_INPUT}
                style={{ width: '100%' }}
                value={listState.sortBy}
                options={[
                  { value: 'dead_first', label: 'Сначала проблемные' },
                  { value: 'no_sales_desc', label: 'Дольше без продаж' },
                  { value: 'zero_days_desc', label: 'Дольше на нуле' },
                  { value: 'stock_desc', label: 'Больше остаток' },
                  { value: 'frozen_desc', label: 'Больше заморожено' },
                  { value: 'revenue90_desc', label: 'Продажи за 90 дн.' },
                  { value: 'name_asc', label: 'По названию' },
                ]}
                onChange={(v) => patchListState({ sortBy: v })}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <Text type="secondary">
              Показано {sorted.length} из {data?.products.length ?? 0}
              {listState.deadOnly ? ' · только мёртвые' : ''}
              {isFetching ? ' · обновление…' : ''}
            </Text>
          </div>
        </Card>

        <Card size="small" styles={{ body: { padding: isMobile ? 8 : 16 } }}>
          <Table<DeadProductRow>
            rowKey="productId"
            size="small"
            loading={isLoading}
            columns={columns}
            dataSource={pageRows}
            scroll={{ x: isMobile ? 900 : undefined }}
            pagination={false}
            onRow={(row) => ({
              style: { cursor: 'pointer' },
              onClick: () => navigate(`/inventory/products/${row.productId}`),
            })}
            locale={{
              emptyText: listState.deadOnly
                ? 'Нет товаров по выбранным фильтрам'
                : 'Нет данных',
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
                onChange={(page, pageSize) => patchListState({ page, pageSize })}
              />
            </div>
          )}
        </Card>

        {data?.summary && (
          <Card size="small" title="Сводка по типам проблем">
            <Space wrap>
              {ALL_ISSUES.map((issue) => (
                <Tag
                  key={issue}
                  color={ISSUE_META[issue].color}
                  style={{ cursor: 'pointer', padding: '4px 10px' }}
                  onClick={() => patchListState({ issues: [issue], preset: 'dead', deadOnly: true })}
                >
                  <ShoppingOutlined style={{ marginRight: 4 }} />
                  {ISSUE_META[issue].label}: {data.summary.issueCounts[issue]}
                </Tag>
              ))}
            </Space>
          </Card>
        )}
      </Space>
    </div>
  );
}
