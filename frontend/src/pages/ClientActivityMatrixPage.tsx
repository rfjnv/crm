import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Select, Spin, Table, Tooltip, Tag, Typography, theme,
  DatePicker, Pagination, Tabs, Input, Button, Space, AutoComplete,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CalendarOutlined, ApartmentOutlined, SearchOutlined, ArrowLeftOutlined, LineChartOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { productsApi } from '../api/products.api';
import HierarchyClientsAnalyticsPanel from '../components/HierarchyClientsAnalyticsPanel';
import HistoryCohortPanel from '../components/HistoryCohortPanel';
import ActivityPeriodBar, { ActivityLegend } from '../components/activity/ActivityPeriodBar';
import ClientPeriodDrawer, { type ClientPeriodTarget } from '../components/activity/ClientPeriodDrawer';
import { buildActivityColumns, heatColor, heatTooltip } from '../components/activity/activityColumns';
import { useIsMobile } from '../hooks/useIsMobile';
import { useClientActivityDays } from '../hooks/useClientActivityDays';
import { smartFilterOption, matchesSearch } from '../utils/translit';
import { isStrategicHidden } from '../utils/currency';
import {
  GRANULARITY_UNIT, addMonths, buildBuckets, daysBetween, monthFirstDay, monthLastDay, sumDaysByBucket, weeksOfMonth,
  type ActivityBucket, type ActivityGranularity,
} from '../utils/activityPeriods';
import type { HistoryClientActivity, Product } from '../types';

const { Title } = Typography;

/** Недели по дням тянем не дальше двух лет — дальше колонок слишком много, чтобы что-то увидеть. */
const MAX_WEEK_RANGE_MONTHS = 24;

/** Быстрые значения фильтра «ровно N периодов» под каждый масштаб. */
const ACTIVE_COUNT_PRESETS: Record<ActivityGranularity, number[]> = {
  month: [0, 1, 3, 6, 12],
  week: [0, 1, 2, 4, 8],
  day: [0, 1, 2, 3, 5],
};

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_CELLS = new Map<string, number>();

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type MatrixTabView = 'matrix' | 'hierarchy-clients' | 'cohorts';

// ── URL params ──────────────────────────────────────────────────────────────

const CY = new Date().getFullYear();
const CM = new Date().getMonth() + 1;

type ListParams = {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
  selectedClients: string[];
  clientSearch: string;
  page: number;
  pageSize: number;
  view: MatrixTabView;
  granularity: ActivityGranularity;
  /** Режим «Дни»: месяц `YYYY-MM` и, если выбрана, неделя внутри него (первый день). */
  dayMonth: string;
  dayWeek: string | null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseParams(sp: URLSearchParams): ListParams {
  const fromRaw = sp.get('from') || `${CY}-01`;
  const toRaw = sp.get('to') || `${CY}-${String(CM).padStart(2, '0')}`;

  const [fy, fm] = fromRaw.split('-').map(Number);
  const [ty, tm] = toRaw.split('-').map(Number);

  const fromYear = fy >= 2020 && fy <= 2035 ? fy : CY;
  const fromMonth = fm >= 1 && fm <= 12 ? fm : 1;
  const toYear = ty >= 2020 && ty <= 2035 ? ty : CY;
  const toMonth = tm >= 1 && tm <= 12 ? tm : CM;

  const clientsPart = sp.get('clients');
  const selectedClients = clientsPart
    ? [...new Set(clientsPart.split(',').map((s) => s.trim()).filter(Boolean))]
    : [];
  const clientSearch = sp.get('clientSearch') || '';
  const rawPage = parseInt(sp.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPs = parseInt(sp.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPs) ? rawPs : DEFAULT_PAGE_SIZE;
  const tabRaw = sp.get('view');
  const view: MatrixTabView =
    tabRaw === 'hierarchy-clients' ? 'hierarchy-clients' : tabRaw === 'cohorts' ? 'cohorts' : 'matrix';

  const gRaw = sp.get('g');
  const granularity: ActivityGranularity = gRaw === 'week' || gRaw === 'day' ? gRaw : 'month';
  const rest = { selectedClients, clientSearch, page, pageSize, view, granularity };

  // Ensure from <= to
  const startTs = fromYear * 100 + fromMonth;
  const endTs = toYear * 100 + toMonth;
  const range = startTs > endTs
    ? { fromYear: toYear, fromMonth: toMonth, toYear: fromYear, toMonth: fromMonth }
    : { fromYear, fromMonth, toYear, toMonth };

  const dmRaw = sp.get('dm') || '';
  const dayMonth = /^20(2\d|3[0-5])-(0[1-9]|1[0-2])$/.test(dmRaw) ? dmRaw : `${range.toYear}-${pad2(range.toMonth)}`;
  const dwRaw = sp.get('dw');
  const dayWeek = dwRaw && weeksOfMonth(dayMonth).some((w) => w.key === dwRaw) ? dwRaw : null;

  return { ...range, ...rest, dayMonth, dayWeek };
}

function mergeParams(prev: URLSearchParams, patch: Partial<ListParams>): URLSearchParams {
  const cur = parseParams(prev);
  const next: ListParams = { ...cur, ...patch };
  const sp = new URLSearchParams(prev);

  const defaultFrom = `${CY}-01`;
  const defaultTo = `${CY}-${String(CM).padStart(2, '0')}`;
  const fromStr = `${next.fromYear}-${String(next.fromMonth).padStart(2, '0')}`;
  const toStr = `${next.toYear}-${String(next.toMonth).padStart(2, '0')}`;

  fromStr !== defaultFrom ? sp.set('from', fromStr) : sp.delete('from');
  toStr !== defaultTo ? sp.set('to', toStr) : sp.delete('to');
  next.selectedClients.length ? sp.set('clients', next.selectedClients.join(',')) : sp.delete('clients');
  next.clientSearch.trim() ? sp.set('clientSearch', next.clientSearch) : sp.delete('clientSearch');
  next.page !== 1 ? sp.set('page', String(next.page)) : sp.delete('page');
  next.pageSize !== DEFAULT_PAGE_SIZE ? sp.set('pageSize', String(next.pageSize)) : sp.delete('pageSize');
  next.view !== 'matrix' ? sp.set('view', next.view) : sp.delete('view');
  next.granularity !== 'month' ? sp.set('g', next.granularity) : sp.delete('g');
  if (next.granularity === 'day') {
    sp.set('dm', next.dayMonth);
    next.dayWeek ? sp.set('dw', next.dayWeek) : sp.delete('dw');
  } else {
    sp.delete('dm');
    sp.delete('dw');
  }

  return sp;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type UnifiedRow = {
  clientId: string;
  companyName: string;
  managerDepartment: string | null;
  lastContactAt: string | null;
  lastContactByName: string | null;
  /** Выручка по месяцам, ключ `YYYY-MM`. */
  revenueByMonth: Map<string, number>;
};

function mergeYearData(
  years: number[],
  dataByYear: Map<number, HistoryClientActivity[]>,
): UnifiedRow[] {
  const map = new Map<string, UnifiedRow>();
  for (const yr of years) {
    const activity = dataByYear.get(yr) ?? [];
    for (const c of activity) {
      let row = map.get(c.clientId);
      if (!row) {
        row = {
          clientId: c.clientId,
          companyName: c.companyName,
          managerDepartment: c.managerDepartment?.trim() || null,
          lastContactAt: c.lastContactAt ?? null,
          lastContactByName: c.lastContactByName ?? null,
          revenueByMonth: new Map(),
        };
        map.set(c.clientId, row);
      }
      for (const md of c.monthlyData) {
        // null — сервер вырезал сумму (ограниченный доступ к деньгам). Месяц в monthlyData
        // всё равно означает покупку: ставим 1, чтобы ячейка светилась как активная.
        row.revenueByMonth.set(`${yr}-${pad2(md.month)}`, md.revenue ?? 1);
      }
      if (!row.managerDepartment && c.managerDepartment?.trim()) row.managerDepartment = c.managerDepartment.trim();
      if (c.lastContactAt && (!row.lastContactAt || c.lastContactAt > row.lastContactAt)) {
        row.lastContactAt = c.lastContactAt;
        row.lastContactByName = c.lastContactByName ?? null;
      }
    }
  }
  return Array.from(map.values());
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ClientActivityMatrixPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseParams(searchParams), [searchParams]);
  const {
    fromYear, fromMonth, toYear, toMonth, selectedClients, clientSearch, page, pageSize, view,
    granularity, dayMonth, dayWeek,
  } = params;

  const isMobile = useIsMobile();
  const moneyHidden = isStrategicHidden();
  const [cellDrawer, setCellDrawer] = useState<ClientPeriodTarget | null>(null);
  const [listSort, setListSort] = useState<'name_asc' | 'name_desc' | 'revenue_desc' | 'revenue_asc' | 'active_desc' | 'active_asc'>('name_asc');
  const [revenueFilter, setRevenueFilter] = useState<'all' | 'gt_0' | 'gte_1m' | 'gte_10m'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  /** Ровно столько активных периодов (месяцев / недель / дней) — вводится вручную или из подсказок. */
  const [activeCountFilter, setActiveCountFilter] = useState<string>('');

  const matrixStale = 120_000;
  const unit = GRANULARITY_UNIT[granularity];

  // ── Период на экране ─────────────────────────────────────────────────────────

  const toYM = `${toYear}-${pad2(toMonth)}`;
  const period = useMemo(() => {
    if (granularity === 'day') {
      const week = dayWeek ? weeksOfMonth(dayMonth).find((w) => w.key === dayWeek) : undefined;
      return {
        from: week?.start ?? monthFirstDay(dayMonth),
        to: week?.end ?? monthLastDay(dayMonth),
        // Грузим весь месяц: переключение недель внутри него — без запросов.
        fetchFrom: monthFirstDay(dayMonth),
        fetchTo: monthLastDay(dayMonth),
        clamped: false,
      };
    }
    let from = monthFirstDay(`${fromYear}-${pad2(fromMonth)}`);
    const to = monthLastDay(toYM);
    let clamped = false;
    if (granularity === 'week' && daysBetween(from, to) > MAX_WEEK_RANGE_MONTHS * 31) {
      from = monthFirstDay(addMonths(toYM, -(MAX_WEEK_RANGE_MONTHS - 1)));
      clamped = true;
    }
    return { from, to, fetchFrom: from, fetchTo: to, clamped };
  }, [granularity, dayMonth, dayWeek, fromYear, fromMonth, toYM]);

  const buckets = useMemo(
    () => buildBuckets(granularity, period.from, period.to),
    [granularity, period.from, period.to],
  );

  // Список клиентов, отдел и последний контакт — из годовых данных; в режиме «Дни» — за год этого месяца.
  const rowYears = useMemo(() => {
    if (granularity === 'day') return [Number(dayMonth.slice(0, 4))];
    const ys: number[] = [];
    for (let y = fromYear; y <= toYear; y++) ys.push(y);
    return ys;
  }, [granularity, dayMonth, fromYear, toYear]);

  const yearQueries = useQueries({
    queries: rowYears.map((yr) => ({
      queryKey: ['manager-client-activity', yr],
      queryFn: () => analyticsApi.getHistory(yr),
      staleTime: matrixStale,
    })),
  });

  const days = useClientActivityDays(period.fetchFrom, period.fetchTo, view === 'matrix' && granularity !== 'month');
  const isLoading = yearQueries.some((q) => q.isLoading) || days.isLoading;

  const dataByYear = useMemo(() => {
    const map = new Map<number, HistoryClientActivity[]>();
    rowYears.forEach((yr, i) => {
      const activity = yearQueries[i]?.data?.clientActivity;
      if (activity) map.set(yr, activity);
    });
    return map;
  }, [yearQueries, rowYears]);

  const { data: allProducts = EMPTY_PRODUCTS } = useQuery({
    queryKey: ['products', 'hierarchy-clients'],
    queryFn: () => productsApi.list(),
    staleTime: 300_000,
  });

  const visibleProducts = useMemo(
    () => (allProducts as Product[]).filter((p) => p.isActive),
    [allProducts],
  );

  // ── Data ─────────────────────────────────────────────────────────────────────

  const unifiedRows = useMemo(
    () => mergeYearData(rowYears, dataByYear),
    [rowYears, dataByYear],
  );

  /** Недели и дни: дневная выручка, сложенная по колонкам. */
  const cellsByClient = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    if (granularity === 'month') return map;
    for (const [clientId, list] of days.byClient) map.set(clientId, sumDaysByBucket(list, granularity));
    return map;
  }, [days.byClient, granularity]);

  const valueOf = useCallback(
    (row: UnifiedRow, b: ActivityBucket): number =>
      (granularity === 'month' ? row.revenueByMonth : (cellsByClient.get(row.clientId) ?? EMPTY_CELLS)).get(b.key) ?? 0,
    [granularity, cellsByClient],
  );

  // ── Filtering / sorting ───────────────────────────────────────────────────────

  const departmentOptions = useMemo(() => {
    const depts = Array.from(
      new Set(unifiedRows.map((r) => r.managerDepartment || '').filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'ru'));
    return depts.map((d) => ({ label: d, value: d }));
  }, [unifiedRows]);

  const filteredRows = useMemo(() => {
    let rows = unifiedRows;
    if (selectedClients.length > 0) rows = rows.filter((r) => selectedClients.includes(r.clientId));
    const q = clientSearch.trim();
    if (q) rows = rows.filter((r) => matchesSearch(r.companyName, q));
    if (departmentFilter !== 'all') rows = rows.filter((r) => r.managerDepartment === departmentFilter);
    return rows;
  }, [unifiedRows, selectedClients, clientSearch, departmentFilter]);

  const { listRows, maxRevenue } = useMemo(() => {
    let max = 1;
    let rows = filteredRows.map((r) => {
      let periodRevenue = 0;
      let periodActive = 0;
      for (const b of buckets) {
        const v = valueOf(r, b);
        if (v > 0) { periodRevenue += v; periodActive++; if (v > max) max = v; }
      }
      return { ...r, periodRevenue, periodActive };
    });

    if (revenueFilter === 'gt_0') rows = rows.filter((r) => r.periodRevenue > 0);
    if (revenueFilter === 'gte_1m') rows = rows.filter((r) => r.periodRevenue >= 1_000_000);
    if (revenueFilter === 'gte_10m') rows = rows.filter((r) => r.periodRevenue >= 10_000_000);

    const exactActive = Number(activeCountFilter);
    if (activeCountFilter.trim() && Number.isFinite(exactActive) && exactActive >= 0) {
      rows = rows.filter((r) => r.periodActive === exactActive);
    }

    rows.sort((a, b) => {
      if (listSort === 'name_asc') return a.companyName.localeCompare(b.companyName, 'ru');
      if (listSort === 'name_desc') return b.companyName.localeCompare(a.companyName, 'ru');
      if (listSort === 'revenue_desc') return b.periodRevenue - a.periodRevenue;
      if (listSort === 'revenue_asc') return a.periodRevenue - b.periodRevenue;
      if (listSort === 'active_desc') return b.periodActive - a.periodActive;
      return a.periodActive - b.periodActive;
    });
    return { listRows: rows, maxRevenue: max };
  }, [filteredRows, buckets, valueOf, revenueFilter, activeCountFilter, listSort]);

  type ListRow = (typeof listRows)[number];

  /** Сколько клиентов из списка купили в каждом периоде. */
  const buyersByBucket = useMemo(
    () => buckets.map((b) => listRows.reduce((n, r) => n + (valueOf(r, b) > 0 ? 1 : 0), 0)),
    [buckets, listRows, valueOf],
  );
  const buyersInPeriod = useMemo(() => listRows.filter((r) => r.periodActive > 0).length, [listRows]);

  const patchParams = useCallback(
    (patch: Partial<ListParams>, nav?: { replace?: boolean }) => {
      setSearchParams((prev) => mergeParams(prev, patch), nav);
    },
    [setSearchParams],
  );

  const totalPages = Math.max(1, Math.ceil(listRows.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (listRows.length === 0) return;
    if (page !== safePage) patchParams({ page: safePage }, { replace: true });
  }, [listRows.length, page, safePage, patchParams]);

  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return listRows.slice(start, start + pageSize);
  }, [listRows, safePage, pageSize]);

  // ── Переходы между масштабами ────────────────────────────────────────────────

  const openDays = useCallback(
    (month: string, week: string | null) => patchParams({ granularity: 'day', dayMonth: month, dayWeek: week, page: 1 }),
    [patchParams],
  );

  const changeGranularity = useCallback((g: ActivityGranularity) => {
    setActiveCountFilter('');
    patchParams({ granularity: g, dayWeek: null, page: 1 });
  }, [patchParams]);

  const drill = useMemo(() => {
    if (granularity === 'month') {
      return {
        onBucketClick: (b: ActivityBucket) => openDays(b.key, null),
        bucketClickHint: 'Открыть месяц по дням',
      };
    }
    if (granularity === 'week') {
      return {
        onBucketClick: (b: ActivityBucket) => openDays(b.start.slice(0, 7), b.key),
        bucketClickHint: 'Открыть дни этой недели',
        onGroupClick: (g: ActivityBucket[]) => openDays(g[0].groupKey, null),
        groupClickHint: 'Открыть месяц по дням',
      };
    }
    return dayWeek
      ? { onGroupClick: () => openDays(dayMonth, null), groupClickHint: 'Вернуться ко всему месяцу' }
      : { onGroupClick: (g: ActivityBucket[]) => openDays(dayMonth, g[0].groupKey), groupClickHint: 'Показать только эту неделю' };
  }, [granularity, dayMonth, dayWeek, openDays]);

  // ── Table columns ─────────────────────────────────────────────────────────────

  const activityCols = useMemo<ColumnsType<ListRow>>(() => [
    {
      title: 'Клиент',
      dataIndex: 'companyName',
      key: 'companyName',
      fixed: 'left' as const,
      width: 240,
      render: (_: string, r: ListRow) => (
        <a onClick={() => navigate(`/clients/${r.clientId}`)}>{r.companyName}</a>
      ),
    },
    {
      title: 'Посл. контакт',
      key: 'lastContact',
      width: 132,
      fixed: 'left' as const,
      sorter: (a: ListRow, b: ListRow) =>
        (a.lastContactAt ?? '').localeCompare(b.lastContactAt ?? ''),
      render: (_: unknown, r: ListRow) => {
        if (!r.lastContactAt) return <Typography.Text type="secondary">—</Typography.Text>;
        const when = dayjs(r.lastContactAt);
        return (
          <Tooltip title={`${when.format('DD.MM.YYYY HH:mm')} — ${r.lastContactByName || '—'}`}>
            <div style={{ fontSize: 12, lineHeight: 1.35 }}>
              <div>{when.format('DD.MM.YYYY')}</div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                {r.lastContactByName || '—'}
              </Typography.Text>
            </div>
          </Tooltip>
        );
      },
    },
    ...buildActivityColumns<ListRow>({
      buckets,
      valueOf,
      max: maxRevenue,
      token,
      moneyHidden,
      onCellClick: (r, b) => setCellDrawer({ clientId: r.clientId, clientName: r.companyName, bucket: b }),
      ...drill,
    }),
    {
      title: 'Активных',
      key: 'active',
      width: 90,
      align: 'center' as const,
      render: (_: unknown, r: ListRow) => <Tag color={r.periodActive > 0 ? 'blue' : 'default'}>{r.periodActive} {unit}</Tag>,
    },
  ], [buckets, valueOf, maxRevenue, token, moneyHidden, drill, unit, navigate]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const clientOptions = useMemo(
    () => unifiedRows.map((c) => ({ label: c.companyName, value: c.clientId })),
    [unifiedRows],
  );

  const rangeValue: [Dayjs, Dayjs] = [
    dayjs(`${fromYear}-${pad2(fromMonth)}-01`),
    dayjs(`${toYear}-${pad2(toMonth)}-01`),
  ];

  const rangePicker = granularity !== 'day' && (
    <DatePicker.RangePicker
      picker="month"
      value={rangeValue}
      format="MMM YYYY"
      allowClear={false}
      onChange={(range) => {
        if (!range?.[0] || !range?.[1]) return;
        patchParams({
          fromYear: range[0].year(),
          fromMonth: range[0].month() + 1,
          toYear: range[1].year(),
          toMonth: range[1].month() + 1,
          page: 1,
        });
      }}
    />
  );

  const summaryRow = () => (
    <Table.Summary>
      <Table.Summary.Row>
        <Table.Summary.Cell index={0} colSpan={2}>
          <Typography.Text type="secondary">Купили клиентов</Typography.Text>
        </Table.Summary.Cell>
        {buckets.map((b, i) => (
          <Table.Summary.Cell key={b.key} index={2 + i} align="center">
            <Typography.Text type={buyersByBucket[i] ? undefined : 'secondary'} style={{ fontSize: 12 }}>
              {b.future && !buyersByBucket[i] ? '' : buyersByBucket[i]}
            </Typography.Text>
          </Table.Summary.Cell>
        ))}
        <Table.Summary.Cell index={2 + buckets.length} align="center">
          <Typography.Text strong>{buyersInPeriod}</Typography.Text>
        </Table.Summary.Cell>
      </Table.Summary.Row>
    </Table.Summary>
  );

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <Title level={4} style={{ margin: 0 }}><CalendarOutlined /> Аналитика для менеджеров</Title>
      </Space>

      <Tabs
        activeKey={view}
        onChange={(next) => patchParams({ view: next as MatrixTabView })}
        destroyInactiveTabPane
        items={[
          {
            key: 'matrix',
            label: <span><CalendarOutlined /> Матрица активности</span>,
            children: (
              <Card
                size="small"
                extra={(
                  <Select
                    mode="multiple"
                    placeholder="Фильтр клиентов"
                    allowClear
                    showSearch
                    style={{ width: isMobile ? 220 : 260 }}
                    maxTagCount={2}
                    value={selectedClients}
                    onChange={(vals) => patchParams({ selectedClients: vals, page: 1 })}
                    options={clientOptions}
                    filterOption={smartFilterOption}
                  />
                )}
              >
                <ActivityPeriodBar
                  granularity={granularity}
                  onGranularityChange={changeGranularity}
                  extra={rangePicker}
                  dayMonth={dayMonth}
                  dayWeek={dayWeek}
                  onDayChange={(month, week) => patchParams({ dayMonth: month, dayWeek: week, page: 1 })}
                />

                <ActivityLegend>
                  <Tag style={{ margin: 0 }}>{buckets.length} {unit}</Tag>
                  {period.clamped && (
                    <Tag color="warning" style={{ margin: 0 }}>
                      По неделям — последние {MAX_WEEK_RANGE_MONTHS} мес. периода
                    </Tag>
                  )}
                  {!isMobile && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {granularity === 'day'
                        ? (dayWeek ? 'Нажмите на неделю, чтобы вернуться ко всему месяцу' : 'Нажмите на неделю в заголовке, чтобы оставить только её')
                        : 'Нажмите на заголовок, чтобы раскрыть его по дням'}
                    </Typography.Text>
                  )}
                </ActivityLegend>

                {/* Filters row */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Input
                    allowClear
                    prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                    placeholder="Поиск по клиенту"
                    value={clientSearch}
                    onChange={(e) => patchParams({ clientSearch: e.target.value, page: 1 })}
                    style={{ width: isMobile ? 220 : 260 }}
                  />
                  <Select
                    value={listSort}
                    onChange={(v) => { setListSort(v); patchParams({ page: 1 }); }}
                    style={{ width: 220 }}
                    options={[
                      { label: 'Сорт: А-Я', value: 'name_asc' },
                      { label: 'Сорт: Я-А', value: 'name_desc' },
                      { label: 'Сорт: выручка ↓', value: 'revenue_desc' },
                      { label: 'Сорт: выручка ↑', value: 'revenue_asc' },
                      { label: `Сорт: активных ${unit} ↓`, value: 'active_desc' },
                      { label: `Сорт: активных ${unit} ↑`, value: 'active_asc' },
                    ]}
                  />
                  <Select
                    value={revenueFilter}
                    onChange={(v) => { setRevenueFilter(v); patchParams({ page: 1 }); }}
                    style={{ width: 180 }}
                    options={[
                      { label: 'Выручка: все', value: 'all' },
                      { label: 'Выручка > 0', value: 'gt_0' },
                      { label: 'Выручка ≥ 1 млн', value: 'gte_1m' },
                      { label: 'Выручка ≥ 10 млн', value: 'gte_10m' },
                    ]}
                  />
                  {departmentOptions.length > 0 && (
                    <Select
                      value={departmentFilter}
                      onChange={(v) => { setDepartmentFilter(v); patchParams({ page: 1 }); }}
                      style={{ width: 200 }}
                      options={[{ label: 'Отдел: все', value: 'all' }, ...departmentOptions]}
                    />
                  )}
                  <AutoComplete
                    allowClear
                    value={activeCountFilter}
                    onChange={(v) => { setActiveCountFilter(v); patchParams({ page: 1 }); }}
                    options={ACTIVE_COUNT_PRESETS[granularity].map((n) => ({ value: String(n), label: `Активность: ровно ${n} ${unit}` }))}
                    style={{ width: 210 }}
                    placeholder={`Активность: ровно N ${unit}`}
                  />
                </div>

                <Spin spinning={isLoading}>
                  {isMobile ? (
                    <div>
                      <div style={{ maxHeight: 560, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {pagedRows.map((record) => (
                          <div key={record.clientId} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 12 }}>
                            <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <a onClick={() => navigate(`/clients/${record.clientId}`)}>{record.companyName}</a>
                              <Tag color={record.periodActive > 0 ? 'blue' : 'default'} style={{ margin: 0 }}>{record.periodActive} {unit}</Tag>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {buckets.map((b) => {
                                const revenue = valueOf(record, b);
                                return (
                                  <Tooltip key={b.key} title={heatTooltip(b, revenue, moneyHidden)}>
                                    <div
                                      style={{
                                        width: 38, height: 38, borderRadius: 6,
                                        backgroundColor: b.future && revenue <= 0 ? 'transparent' : heatColor(revenue, maxRevenue, token),
                                        border: b.future && revenue <= 0 ? `1px dashed ${token.colorBorderSecondary}` : undefined,
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 10, fontWeight: 500, lineHeight: 1.1,
                                        cursor: revenue > 0 ? 'pointer' : 'default',
                                      }}
                                      onClick={revenue > 0 ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, bucket: b }) : undefined}
                                    >
                                      {b.sublabel && <span style={{ fontSize: 9, opacity: 0.7 }}>{b.sublabel}</span>}
                                      <span>{b.label}</span>
                                    </div>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      {listRows.length > pageSize && (
                        <div style={{ textAlign: 'center', marginTop: 12 }}>
                          <Pagination
                            current={safePage} total={listRows.length} pageSize={pageSize}
                            showSizeChanger pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
                            onChange={(p, ps) => patchParams({ page: p, pageSize: ps })}
                            size="small"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <Table<ListRow>
                      dataSource={pagedRows}
                      columns={activityCols}
                      rowKey="clientId"
                      size="small"
                      summary={summaryRow}
                      pagination={{
                        current: safePage, pageSize, total: listRows.length,
                        showSizeChanger: true, pageSizeOptions: [...PAGE_SIZE_OPTIONS],
                        showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
                        onChange: (p, ps) => patchParams({ page: p, pageSize: ps }),
                      }}
                      scroll={{ x: 'max-content' }}
                    />
                  )}
                </Spin>
              </Card>
            ),
          },
          {
            key: 'hierarchy-clients',
            label: <span><ApartmentOutlined /> Клиенты по иерархии</span>,
            children: (
              <HierarchyClientsAnalyticsPanel
                products={visibleProducts}
                fetchEnabled={view === 'hierarchy-clients'}
                persistPrefix="mgr_hc"
                clientSearchTerm={clientSearch}
                onClientSearchTermChange={(value) => patchParams({ clientSearch: value, page: 1 })}
              />
            ),
          },
          {
            key: 'cohorts',
            label: <span><LineChartOutlined /> Когорты</span>,
            children: <HistoryCohortPanel fetchEnabled={view === 'cohorts'} />,
          },
        ]}
      />

      <ClientPeriodDrawer target={cellDrawer} onClose={() => setCellDrawer(null)} />
    </div>
  );
}
