import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Select, Spin, Table, Tooltip, Tag, Typography, theme,
  Drawer, DatePicker, Pagination, Tabs, Input, Button, Space,
} from 'antd';
import { CalendarOutlined, ApartmentOutlined, SearchOutlined, ArrowLeftOutlined, LineChartOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { productsApi } from '../api/products.api';
import HierarchyClientsAnalyticsPanel from '../components/HierarchyClientsAnalyticsPanel';
import HistoryCohortPanel from '../components/HistoryCohortPanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { smartFilterOption, matchesSearch } from '../utils/translit';
import type { HistoryClientActivity, Product } from '../types';

const { Title } = Typography;

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн',
  7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек',
};

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
};

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

  // Ensure from <= to
  const startTs = fromYear * 100 + fromMonth;
  const endTs = toYear * 100 + toMonth;
  if (startTs > endTs) {
    return { fromYear: toYear, fromMonth: toMonth, toYear: fromYear, toMonth: fromMonth, selectedClients, clientSearch, page, pageSize, view };
  }

  return { fromYear, fromMonth, toYear, toMonth, selectedClients, clientSearch, page, pageSize, view };
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

  return sp;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type YearMonth = { year: number; month: number };

function buildPeriods(fromYear: number, fromMonth: number, toYear: number, toMonth: number): YearMonth[] {
  const periods: YearMonth[] = [];
  let y = fromYear, m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    periods.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return periods;
}

type UnifiedRow = {
  clientId: string;
  companyName: string;
  lastContactAt: string | null;
  lastContactByName: string | null;
  revenueByYM: Map<string, number>;
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
          lastContactAt: c.lastContactAt ?? null,
          lastContactByName: c.lastContactByName ?? null,
          revenueByYM: new Map(),
        };
        map.set(c.clientId, row);
      }
      for (const md of c.monthlyData) {
        row.revenueByYM.set(`${yr}-${md.month}`, md.revenue);
      }
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
  const { fromYear, fromMonth, toYear, toMonth, selectedClients, clientSearch, page, pageSize, view } = params;

  const isMobile = useIsMobile();
  const [cellDrawer, setCellDrawer] = useState<{ clientId: string; clientName: string; month: number; year: number } | null>(null);
  const [drawerSortOrder, setDrawerSortOrder] = useState<'desc' | 'asc'>('desc');
  const [drawerDateRange, setDrawerDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [listSort, setListSort] = useState<'name_asc' | 'name_desc' | 'revenue_desc' | 'revenue_asc' | 'active_desc' | 'active_asc'>('name_asc');
  const [revenueFilter, setRevenueFilter] = useState<'all' | 'gt_0' | 'gte_1m' | 'gte_10m'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  const matrixStale = 120_000;

  // Derive unique years in range
  const yearsInRange = useMemo(() => {
    const ys: number[] = [];
    for (let y = fromYear; y <= toYear; y++) ys.push(y);
    return ys;
  }, [fromYear, toYear]);

  // Fetch each year in parallel
  const yearQueries = useQueries({
    queries: yearsInRange.map((yr) => ({
      queryKey: ['manager-client-activity', yr],
      queryFn: () => analyticsApi.getHistory(yr),
      staleTime: matrixStale,
    })),
  });

  const isLoading = yearQueries.some((q) => q.isLoading);

  const dataByYear = useMemo(() => {
    const map = new Map<number, HistoryClientActivity[]>();
    yearsInRange.forEach((yr, i) => {
      const activity = yearQueries[i]?.data?.clientActivity;
      if (activity) map.set(yr, activity);
    });
    return map;
  }, [yearQueries, yearsInRange]);

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products', 'hierarchy-clients'],
    queryFn: () => productsApi.list(),
    staleTime: 300_000,
  });

  const visibleProducts = useMemo(
    () => (allProducts as Product[]).filter((p) => p.isActive),
    [allProducts],
  );

  const { data: clientMonthData, isLoading: clientMonthLoading } = useQuery({
    queryKey: ['manager-client-activity-client-month', cellDrawer?.clientId, cellDrawer?.month, cellDrawer?.year],
    queryFn: () => analyticsApi.getHistoryClientMonth(cellDrawer!.clientId, cellDrawer!.month, cellDrawer!.year),
    enabled: !!cellDrawer,
    staleTime: matrixStale,
  });

  // ── Data ─────────────────────────────────────────────────────────────────────

  const unifiedRows = useMemo(
    () => mergeYearData(yearsInRange, dataByYear),
    [yearsInRange, dataByYear],
  );

  const displayedPeriods = useMemo(
    () => buildPeriods(fromYear, fromMonth, toYear, toMonth),
    [fromYear, fromMonth, toYear, toMonth],
  );

  const isMultiYear = toYear > fromYear;

  const maxRevenue = useMemo(() => {
    let max = 1;
    for (const row of unifiedRows) {
      for (const v of row.revenueByYM.values()) {
        if (v > max) max = v;
      }
    }
    return max;
  }, [unifiedRows]);

  function getRevenue(row: UnifiedRow, yr: number, month: number): number {
    return row.revenueByYM.get(`${yr}-${month}`) ?? 0;
  }

  function revenueColor(revenue: number): string {
    const noData = token.colorFillTertiary || '#2f2f2f';
    if (revenue <= 0) return noData;
    return `rgba(56,218,17,${0.2 + Math.min(revenue / maxRevenue, 1) * 0.8})`;
  }

  // ── Filtering / sorting ───────────────────────────────────────────────────────

  const departmentOptions = useMemo(() => {
    const depts = Array.from(
      new Set((dataByYear.get(fromYear) ?? []).map((c) => (c.managerDepartment || '').trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'ru'));
    return depts.map((d) => ({ label: d, value: d }));
  }, [dataByYear, fromYear]);

  const filteredRows = useMemo(() => {
    let rows = unifiedRows;
    if (selectedClients.length > 0) rows = rows.filter((r) => selectedClients.includes(r.clientId));
    const q = clientSearch.trim();
    if (q) rows = rows.filter((r) => matchesSearch(r.companyName, q));
    return rows;
  }, [unifiedRows, selectedClients, clientSearch]);

  const listRows = useMemo(() => {
    const periodRevenue = (row: UnifiedRow) =>
      displayedPeriods.reduce((sum, p) => sum + getRevenue(row, p.year, p.month), 0);
    const activeCount = (row: UnifiedRow) =>
      displayedPeriods.filter((p) => getRevenue(row, p.year, p.month) > 0).length;

    let rows = filteredRows.map((r) => ({
      ...r,
      periodRevenue: periodRevenue(r),
      periodActiveMonths: activeCount(r),
    }));

    if (departmentFilter !== 'all') {
      const dept = departmentFilter;
      rows = rows.filter((r) => {
        const c = (dataByYear.get(fromYear) ?? []).find((c) => c.clientId === r.clientId);
        return (c?.managerDepartment || '').trim() === dept;
      });
    }

    if (revenueFilter === 'gt_0') rows = rows.filter((r) => r.periodRevenue > 0);
    if (revenueFilter === 'gte_1m') rows = rows.filter((r) => r.periodRevenue >= 1_000_000);
    if (revenueFilter === 'gte_10m') rows = rows.filter((r) => r.periodRevenue >= 10_000_000);

    return [...rows].sort((a, b) => {
      if (listSort === 'name_asc') return a.companyName.localeCompare(b.companyName, 'ru');
      if (listSort === 'name_desc') return b.companyName.localeCompare(a.companyName, 'ru');
      if (listSort === 'revenue_desc') return b.periodRevenue - a.periodRevenue;
      if (listSort === 'revenue_asc') return a.periodRevenue - b.periodRevenue;
      if (listSort === 'active_desc') return b.periodActiveMonths - a.periodActiveMonths;
      return a.periodActiveMonths - b.periodActiveMonths;
    });
  }, [filteredRows, displayedPeriods, departmentFilter, revenueFilter, listSort, dataByYear, fromYear]);

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

  useEffect(() => {
    if (!cellDrawer) return;
    setDrawerSortOrder('desc');
    setDrawerDateRange(null);
  }, [cellDrawer?.clientId, cellDrawer?.month, cellDrawer?.year]);

  const filteredDrawerItems = useMemo(() => {
    let items = [...(clientMonthData?.items ?? [])];
    if (drawerDateRange) {
      const [from, to] = drawerDateRange;
      const fromTs = from.startOf('day').valueOf();
      const toTs = to.endOf('day').valueOf();
      items = items.filter((item) => {
        if (!item.createdAt) return false;
        const ts = dayjs(item.createdAt).valueOf();
        return ts >= fromTs && ts <= toTs;
      });
    }
    return items.sort((a, b) => {
      const aTs = a.createdAt ? dayjs(a.createdAt).valueOf() : 0;
      const bTs = b.createdAt ? dayjs(b.createdAt).valueOf() : 0;
      return drawerSortOrder === 'desc' ? bTs - aTs : aTs - bTs;
    });
  }, [clientMonthData?.items, drawerDateRange, drawerSortOrder]);

  const filteredDrawerTotal = useMemo(
    () => filteredDrawerItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [filteredDrawerItems],
  );

  // ── Table columns ─────────────────────────────────────────────────────────────

  const activityCols = useMemo(() => [
    {
      title: 'Клиент',
      dataIndex: 'companyName',
      key: 'companyName',
      fixed: 'left' as const,
      width: 260,
      render: (_: string, r: UnifiedRow) => (
        <a onClick={() => navigate(`/clients/${r.clientId}`)}>{r.companyName}</a>
      ),
    },
    {
      title: 'Посл. контакт',
      key: 'lastContact',
      width: 148,
      fixed: 'left' as const,
      sorter: (a: UnifiedRow, b: UnifiedRow) =>
        (a.lastContactAt ?? '').localeCompare(b.lastContactAt ?? ''),
      render: (_: unknown, r: UnifiedRow) => {
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
    ...displayedPeriods.map((p) => {
      const isNewYear = isMultiYear && p.month === 1;
      return {
        title: isMultiYear
          ? `${MONTH_LABELS[p.month]} ${String(p.year).slice(2)}`
          : MONTH_LABELS[p.month],
        key: `y${p.year}m${p.month}`,
        width: isMultiYear ? 64 : 72,
        align: 'center' as const,
        onHeaderCell: () => isNewYear ? { style: { borderLeft: `2px solid ${token.colorPrimary}` } } : {},
        render: (_: unknown, record: UnifiedRow) => {
          const revenue = getRevenue(record, p.year, p.month);
          const intensity = revenue > 0 ? Math.min(revenue / maxRevenue, 1) : 0;
          return (
            <Tooltip title={revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}>
              <div
                style={{
                  width: 32, height: 24, borderRadius: 5, margin: '0 auto',
                  backgroundColor: revenueColor(revenue),
                  color: intensity > 0.5 ? '#fff' : token.colorTextSecondary,
                  fontSize: 10, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: revenue > 0 ? 'pointer' : 'default',
                  borderLeft: isNewYear ? `2px solid ${token.colorPrimary}` : undefined,
                }}
                onClick={revenue > 0 ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: p.month, year: p.year }) : undefined}
              >
                {revenue > 0 ? '●' : '—'}
              </div>
            </Tooltip>
          );
        },
      };
    }),
    {
      title: 'Активных',
      key: 'active',
      width: 90,
      render: (_: unknown, r: UnifiedRow) => {
        const count = displayedPeriods.filter((p) => getRevenue(r, p.year, p.month) > 0).length;
        return <Tag color="blue">{count} мес.</Tag>;
      },
    },
  ], [displayedPeriods, isMultiYear, maxRevenue, navigate, token]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const noDataColor = token.colorFillTertiary || '#2f2f2f';
  const clientOptions = useMemo(
    () => unifiedRows.map((c) => ({ label: c.companyName, value: c.clientId })),
    [unifiedRows],
  );

  const rangeValue: [Dayjs, Dayjs] = [
    dayjs(`${fromYear}-${String(fromMonth).padStart(2, '0')}-01`),
    dayjs(`${toYear}-${String(toMonth).padStart(2, '0')}-01`),
  ];

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
            label: <span><CalendarOutlined /> Матрица по месяцам</span>,
            children: isLoading ? (
              <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
            ) : (
              <Card
                size="small"
                extra={(
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Single range picker — month granularity, any span */}
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
                  </div>
                )}
              >
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,0.2)' }} /> Мало
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,1)' }} /> Много
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: noDataColor }} /> Нет данных
                  </span>
                  <Tag>{displayedPeriods.length} мес.</Tag>
                </div>

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
                      { label: 'Сорт: активные мес. ↓', value: 'active_desc' },
                      { label: 'Сорт: активные мес. ↑', value: 'active_asc' },
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
                </div>

                {/* Mobile */}
                {isMobile ? (
                  <div>
                    <div style={{ maxHeight: 560, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {pagedRows.map((record) => (
                        <div key={record.clientId} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>
                            <a onClick={() => navigate(`/clients/${record.clientId}`)}>{record.companyName}</a>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {displayedPeriods.map((p) => {
                              const revenue = getRevenue(record, p.year, p.month);
                              const label = isMultiYear
                                ? `${MONTH_LABELS[p.month]}${String(p.year).slice(2)}`
                                : MONTH_LABELS[p.month];
                              return (
                                <Tooltip key={`${p.year}-${p.month}`} title={`${MONTH_LABELS[p.month]} ${p.year}: ${revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}`}>
                                  <div
                                    style={{
                                      width: 38, height: 38, borderRadius: 6,
                                      backgroundColor: revenueColor(revenue),
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 10, fontWeight: 500,
                                      cursor: revenue > 0 ? 'pointer' : 'default',
                                    }}
                                    onClick={revenue > 0 ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: p.month, year: p.year }) : undefined}
                                  >
                                    {label}
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
                  <Table
                    dataSource={pagedRows}
                    columns={activityCols}
                    rowKey="clientId"
                    size="small"
                    pagination={{
                      current: safePage, pageSize, total: listRows.length,
                      showSizeChanger: true, pageSizeOptions: [...PAGE_SIZE_OPTIONS],
                      showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
                      onChange: (p, ps) => patchParams({ page: p, pageSize: ps }),
                    }}
                    scroll={{ x: 1200 }}
                  />
                )}
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

      <Drawer
        title={cellDrawer ? `${cellDrawer.clientName} — ${MONTH_LABELS[cellDrawer.month]} ${cellDrawer.year}` : ''}
        open={!!cellDrawer}
        onClose={() => setCellDrawer(null)}
        width="100%"
      >
        {clientMonthLoading ? <Spin /> : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <DatePicker.RangePicker
                value={drawerDateRange}
                onChange={(range) => setDrawerDateRange(range as [Dayjs, Dayjs] | null)}
                placeholder={['Дата от', 'Дата до']}
                allowClear
              />
              <Select
                value={drawerSortOrder}
                onChange={(v) => setDrawerSortOrder(v)}
                style={{ width: 170 }}
                options={[
                  { label: 'Сначала новые', value: 'desc' },
                  { label: 'Сначала старые', value: 'asc' },
                ]}
              />
            </div>
            <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 600 }}>
              Итого: {filteredDrawerTotal.toLocaleString('ru-RU')}
            </div>
            <Table
              dataSource={filteredDrawerItems}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
              columns={[
                { title: 'Товар', dataIndex: 'productName', key: 'productName', ellipsis: true },
                { title: 'Ед.', dataIndex: 'unit', key: 'unit', width: 60 },
                { title: 'Кол-во', dataIndex: 'qty', key: 'qty', width: 90, render: (v: number) => v.toLocaleString('ru-RU') },
                { title: 'Цена', dataIndex: 'price', key: 'price', width: 100, render: (v: number) => Number(v || 0).toLocaleString('ru-RU') },
                { title: 'Итого', dataIndex: 'total', key: 'total', width: 120, render: (v: number) => Number(v || 0).toLocaleString('ru-RU') },
                { title: 'Сделка', dataIndex: 'dealTitle', key: 'dealTitle', ellipsis: true },
                {
                  title: 'Дата', dataIndex: 'createdAt', key: 'createdAt', width: 110,
                  render: (v: string) => v ? new Date(v).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '—',
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
