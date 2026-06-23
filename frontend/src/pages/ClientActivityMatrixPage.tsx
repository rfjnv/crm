import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Select, Spin, Table, Tooltip, Tag, Typography, theme, Drawer, DatePicker, Pagination, Tabs, Input, Button, Space } from 'antd';
import { CalendarOutlined, ApartmentOutlined, SearchOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { productsApi } from '../api/products.api';
import HierarchyClientsAnalyticsPanel from '../components/HierarchyClientsAnalyticsPanel';
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
type MatrixTabView = 'matrix' | 'hierarchy-clients';

const CY = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => {
  const y = CY - 2 + i;
  return { label: String(y), value: y };
});
const MONTH_OPTIONS = Object.entries(MONTH_LABELS).map(([k, v]) => ({ value: Number(k), label: v }));

// ── URL params ──────────────────────────────────────────────────────────────

type ListParams = {
  year: number;
  year2: number;
  selectedMonths: number[];
  selectedClients: string[];
  clientSearch: string;
  page: number;
  pageSize: number;
  view: MatrixTabView;
};

function parseParams(sp: URLSearchParams): ListParams {
  const rawY = parseInt(sp.get('year') || String(CY), 10);
  const year = Number.isFinite(rawY) && rawY >= 2020 && rawY <= 2035 ? rawY : CY;

  const rawY2 = parseInt(sp.get('year2') || String(year), 10);
  const year2Raw = Number.isFinite(rawY2) && rawY2 >= 2020 && rawY2 <= 2035 ? rawY2 : year;
  const year2 = Math.max(year, year2Raw);

  const monthsPart = sp.get('months');
  const selectedMonths = monthsPart
    ? [...new Set(monthsPart.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= 12))].sort((a, b) => a - b)
    : [];

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
  const view = tabRaw === 'hierarchy-clients' ? 'hierarchy-clients' : 'matrix';

  return { year, year2, selectedMonths, selectedClients, clientSearch, page, pageSize, view };
}

function mergeParams(prev: URLSearchParams, patch: Partial<ListParams>): URLSearchParams {
  const cur = parseParams(prev);
  const next: ListParams = { ...cur, ...patch };
  if (next.year2 < next.year) next.year2 = next.year;
  const sp = new URLSearchParams(prev);

  next.year !== CY ? sp.set('year', String(next.year)) : sp.delete('year');
  next.year2 !== next.year ? sp.set('year2', String(next.year2)) : sp.delete('year2');
  next.selectedMonths.length ? sp.set('months', next.selectedMonths.join(',')) : sp.delete('months');
  next.selectedClients.length ? sp.set('clients', next.selectedClients.join(',')) : sp.delete('clients');
  next.clientSearch.trim() ? sp.set('clientSearch', next.clientSearch) : sp.delete('clientSearch');
  next.page !== 1 ? sp.set('page', String(next.page)) : sp.delete('page');
  next.pageSize !== DEFAULT_PAGE_SIZE ? sp.set('pageSize', String(next.pageSize)) : sp.delete('pageSize');
  next.view !== 'matrix' ? sp.set('view', next.view) : sp.delete('view');

  return sp;
}

// ── Unified row type for multi-year ─────────────────────────────────────────

type UnifiedRow = {
  clientId: string;
  companyName: string;
  lastContactAt: string | null;
  lastContactByName: string | null;
  revenueByYM: Map<string, number>; // key: `${year}-${month}`
};

function buildUnifiedRows(
  activity1: HistoryClientActivity[],
  activity2: HistoryClientActivity[],
  year1: number,
  year2: number,
): UnifiedRow[] {
  const map = new Map<string, UnifiedRow>();

  for (const c of activity1) {
    const row: UnifiedRow = {
      clientId: c.clientId,
      companyName: c.companyName,
      lastContactAt: c.lastContactAt ?? null,
      lastContactByName: c.lastContactByName ?? null,
      revenueByYM: new Map(),
    };
    for (const md of c.monthlyData) {
      row.revenueByYM.set(`${year1}-${md.month}`, md.revenue);
    }
    map.set(c.clientId, row);
  }

  for (const c of activity2) {
    const existing = map.get(c.clientId);
    if (existing) {
      for (const md of c.monthlyData) {
        existing.revenueByYM.set(`${year2}-${md.month}`, md.revenue);
      }
      // keep the more recent lastContact
      if (c.lastContactAt && (!existing.lastContactAt || c.lastContactAt > existing.lastContactAt)) {
        existing.lastContactAt = c.lastContactAt;
        existing.lastContactByName = c.lastContactByName ?? null;
      }
    } else {
      const row: UnifiedRow = {
        clientId: c.clientId,
        companyName: c.companyName,
        lastContactAt: c.lastContactAt ?? null,
        lastContactByName: c.lastContactByName ?? null,
        revenueByYM: new Map(),
      };
      for (const md of c.monthlyData) {
        row.revenueByYM.set(`${year2}-${md.month}`, md.revenue);
      }
      map.set(c.clientId, row);
    }
  }

  return Array.from(map.values());
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ClientActivityMatrixPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseParams(searchParams), [searchParams]);
  const { year, year2, selectedMonths, selectedClients, clientSearch, page, pageSize, view } = listState;
  const isMultiYear = year2 > year;

  const isMobile = useIsMobile();
  const [cellDrawer, setCellDrawer] = useState<{ clientId: string; clientName: string; month: number; year: number } | null>(null);
  const [drawerSortOrder, setDrawerSortOrder] = useState<'desc' | 'asc'>('desc');
  const [drawerDateRange, setDrawerDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [listSort, setListSort] = useState<'name_asc' | 'name_desc' | 'revenue_desc' | 'revenue_asc' | 'active_desc' | 'active_asc'>('name_asc');
  const [revenueFilter, setRevenueFilter] = useState<'all' | 'gt_0' | 'gte_1m' | 'gte_10m'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  const matrixStale = 120_000;

  const { data: data1, isLoading: loading1 } = useQuery({
    queryKey: ['manager-client-activity', year],
    queryFn: () => analyticsApi.getHistory(year),
    staleTime: matrixStale,
  });

  const { data: data2, isLoading: loading2 } = useQuery({
    queryKey: ['manager-client-activity', year2],
    queryFn: () => analyticsApi.getHistory(year2),
    enabled: isMultiYear,
    staleTime: matrixStale,
  });

  const isLoading = loading1 || (isMultiYear && loading2);

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

  // ── Unified data ────────────────────────────────────────────────────────────

  const unifiedRows = useMemo(() => {
    const a1 = data1?.clientActivity ?? [];
    const a2 = isMultiYear ? (data2?.clientActivity ?? []) : [];
    return buildUnifiedRows(a1, a2, year, year2);
  }, [data1, data2, year, year2, isMultiYear]);

  // Periods to display as columns: {year, month}[]
  const displayedPeriods = useMemo(() => {
    if (isMultiYear) {
      // All 12 months of year1, then available months of year2
      const maxMonth2 = data2?.monthlyTrend?.length
        ? Math.max(...data2.monthlyTrend.map((m) => m.month))
        : 12;
      const periods: { year: number; month: number }[] = [];
      for (let m = 1; m <= 12; m++) periods.push({ year, month: m });
      for (let m = 1; m <= maxMonth2; m++) periods.push({ year: year2, month: m });
      return periods;
    }
    // Single-year mode
    const visibleMonths = data1?.monthlyTrend?.length
      ? Array.from({ length: Math.max(...data1.monthlyTrend.map((m) => m.month)) }, (_, i) => i + 1)
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const months = selectedMonths.length > 0 ? [...selectedMonths] : visibleMonths;
    return months.map((m) => ({ year, month: m }));
  }, [isMultiYear, year, year2, data1, data2, selectedMonths]);

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
    const noData = token.colorFillTertiary || token.colorBgContainerDisabled || '#2f2f2f';
    if (revenue <= 0) return noData;
    return `rgba(56,218,17,${0.2 + Math.min(revenue / maxRevenue, 1) * 0.8})`;
  }

  // ── Filtering / sorting ─────────────────────────────────────────────────────

  const departmentOptions = useMemo(() => {
    const depts = Array.from(
      new Set((data1?.clientActivity ?? []).map((c) => (c.managerDepartment || '').trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'ru'));
    return depts.map((d) => ({ label: d, value: d }));
  }, [data1]);

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
        const c = data1?.clientActivity?.find((c) => c.clientId === r.clientId);
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
  }, [filteredRows, displayedPeriods, departmentFilter, revenueFilter, listSort, data1]);

  const patchListParams = useCallback(
    (patch: Partial<ListParams>, nav?: { replace?: boolean }) => {
      setSearchParams((prev) => mergeParams(prev, patch), nav);
    },
    [setSearchParams],
  );

  const totalPages = Math.max(1, Math.ceil(listRows.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (listRows.length === 0) return;
    if (page !== safePage) patchListParams({ page: safePage }, { replace: true });
  }, [listRows.length, page, safePage, patchListParams]);

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
        return dayjs(item.createdAt).valueOf() >= fromTs && dayjs(item.createdAt).valueOf() <= toTs;
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

  // ── Table columns ────────────────────────────────────────────────────────────

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
      width: 150,
      fixed: 'left' as const,
      sorter: (a: UnifiedRow, b: UnifiedRow) => {
        const ta = a.lastContactAt ? dayjs(a.lastContactAt).valueOf() : 0;
        const tb = b.lastContactAt ? dayjs(b.lastContactAt).valueOf() : 0;
        return ta - tb;
      },
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
      // In multi-year mode show short year suffix on first month of each year
      const isFirstOfYear = isMultiYear && p.month === 1;
      const colTitle = isMultiYear
        ? `${MONTH_LABELS[p.month]} ${String(p.year).slice(2)}`
        : MONTH_LABELS[p.month];
      return {
        title: (
          <span style={isFirstOfYear ? { borderLeft: `2px solid ${token.colorBorder}`, paddingLeft: 4 } : undefined}>
            {colTitle}
          </span>
        ),
        key: `y${p.year}m${p.month}`,
        width: isMultiYear ? 68 : 76,
        align: 'center' as const,
        onHeaderCell: () => isFirstOfYear ? { style: { borderLeft: `2px solid ${token.colorBorder}` } } : {},
        render: (_: unknown, record: UnifiedRow) => {
          const revenue = getRevenue(record, p.year, p.month);
          const intensity = revenue > 0 ? Math.min(revenue / maxRevenue, 1) : 0;
          return (
            <Tooltip title={revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}>
              <div
                style={{
                  width: 34, height: 26, borderRadius: 6, margin: '0 auto',
                  backgroundColor: revenueColor(revenue),
                  color: intensity > 0.5 ? '#fff' : token.colorTextSecondary,
                  fontSize: 11, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: revenue > 0 ? 'pointer' : 'default',
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

  // ── Render ───────────────────────────────────────────────────────────────────

  const noDataColor = token.colorFillTertiary || token.colorBgContainerDisabled || '#2f2f2f';
  const fromMonth = selectedMonths.length > 0 ? selectedMonths[0] : undefined;
  const toMonth = selectedMonths.length > 0 ? selectedMonths[selectedMonths.length - 1] : undefined;

  const clientOptions = useMemo(
    () => unifiedRows.map((c) => ({ label: c.companyName, value: c.clientId })),
    [unifiedRows],
  );

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <Title level={4} style={{ margin: 0 }}><CalendarOutlined /> Аналитика для менеджеров</Title>
      </Space>

      <Tabs
        activeKey={view}
        onChange={(next) => patchListParams({ view: next as MatrixTabView })}
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
                    {/* Year range */}
                    <Select
                      value={year}
                      onChange={(y) => patchListParams({ year: y, year2: Math.max(y, year2), selectedMonths: [], page: 1 })}
                      style={{ width: 90 }}
                      options={YEAR_OPTIONS}
                    />
                    <Typography.Text type="secondary">—</Typography.Text>
                    <Select
                      value={year2}
                      onChange={(y) => patchListParams({ year2: y, selectedMonths: [], page: 1 })}
                      style={{ width: 90 }}
                      options={YEAR_OPTIONS.filter((o) => o.value >= year)}
                    />

                    {/* Month range — only in single-year mode */}
                    {!isMultiYear && (
                      <>
                        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>С</Typography.Text>
                        <Select
                          placeholder="Янв"
                          allowClear
                          style={{ width: 100 }}
                          value={fromMonth}
                          options={MONTH_OPTIONS}
                          onChange={(from: number | undefined) => {
                            if (!from) { patchListParams({ selectedMonths: [], page: 1 }); return; }
                            const end = toMonth && toMonth >= from ? toMonth : 12;
                            patchListParams({ selectedMonths: Array.from({ length: end - from + 1 }, (_, i) => from + i), page: 1 });
                          }}
                        />
                        <Typography.Text type="secondary">по</Typography.Text>
                        <Select
                          placeholder="Дек"
                          allowClear
                          style={{ width: 100 }}
                          value={toMonth}
                          options={MONTH_OPTIONS.filter((o) => !fromMonth || o.value >= fromMonth)}
                          onChange={(to: number | undefined) => {
                            if (!to) { patchListParams({ selectedMonths: [], page: 1 }); return; }
                            const start = fromMonth && fromMonth <= to ? fromMonth : 1;
                            patchListParams({ selectedMonths: Array.from({ length: to - start + 1 }, (_, i) => start + i), page: 1 });
                          }}
                        />
                      </>
                    )}

                    <Select
                      mode="multiple"
                      placeholder="Фильтр клиентов"
                      allowClear
                      showSearch
                      style={{ width: isMobile ? 220 : 260 }}
                      maxTagCount={2}
                      value={selectedClients}
                      onChange={(vals) => patchListParams({ selectedClients: vals, page: 1 })}
                      options={clientOptions}
                      filterOption={smartFilterOption}
                    />
                  </div>
                )}
              >
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,0.2)' }} /> Мало</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,1)' }} /> Много</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: noDataColor }} /> Нет данных</span>
                  {isMultiYear && (
                    <Tag color="blue">{year} + {year2} · {displayedPeriods.length} месяцев</Tag>
                  )}
                </div>

                {/* Filters row */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Input
                    allowClear
                    prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                    placeholder="Поиск по клиенту"
                    value={clientSearch}
                    onChange={(e) => patchListParams({ clientSearch: e.target.value, page: 1 })}
                    style={{ width: isMobile ? 220 : 260 }}
                  />
                  <Select
                    value={listSort}
                    onChange={(v) => { setListSort(v); patchListParams({ page: 1 }); }}
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
                    onChange={(v) => { setRevenueFilter(v); patchListParams({ page: 1 }); }}
                    style={{ width: 180 }}
                    options={[
                      { label: 'Выручка: все', value: 'all' },
                      { label: 'Выручка > 0', value: 'gt_0' },
                      { label: 'Выручка ≥ 1 млн', value: 'gte_1m' },
                      { label: 'Выручка ≥ 10 млн', value: 'gte_10m' },
                    ]}
                  />
                  <Select
                    value={departmentFilter}
                    onChange={(v) => { setDepartmentFilter(v); patchListParams({ page: 1 }); }}
                    style={{ width: 200 }}
                    options={[{ label: 'Отдел: все', value: 'all' }, ...departmentOptions]}
                  />
                </div>

                {/* Mobile view */}
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
                              const label = isMultiYear ? `${MONTH_LABELS[p.month]} ${String(p.year).slice(2)}` : MONTH_LABELS[p.month];
                              return (
                                <Tooltip key={`${p.year}-${p.month}`} title={`${label}: ${revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}`}>
                                  <div style={{
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
                          onChange={(p, ps) => patchListParams({ page: p, pageSize: ps })}
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
                      onChange: (p, ps) => patchListParams({ page: p, pageSize: ps }),
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
                onClientSearchTermChange={(value) => patchListParams({ clientSearch: value, page: 1 })}
              />
            ),
          },
        ]}
      />

      {/* Cell drill-down drawer */}
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
