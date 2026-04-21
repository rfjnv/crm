import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Select, Spin, Table, Tooltip, Tag, Typography, theme, Drawer, DatePicker, Pagination, Tabs, Input } from 'antd';
import { CalendarOutlined, ApartmentOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { analyticsApi } from '../api/analytics.api';
import { productsApi } from '../api/products.api';
import HierarchyClientsAnalyticsPanel from '../components/HierarchyClientsAnalyticsPanel';
import { useIsMobile } from '../hooks/useIsMobile';
import { smartFilterOption, matchesSearch } from '../utils/translit';
import type { HistoryClientActivity, Product } from '../types';

const { Title } = Typography;

const MONTH_LABELS: Record<number, string> = {
  1: 'Янв',
  2: 'Фев',
  3: 'Мар',
  4: 'Апр',
  5: 'Май',
  6: 'Июн',
  7: 'Июл',
  8: 'Авг',
  9: 'Сен',
  10: 'Окт',
  11: 'Ноя',
  12: 'Дек',
};

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
type MatrixTabView = 'matrix' | 'hierarchy-clients';

function parseMatrixListParams(sp: URLSearchParams): {
  year: number;
  selectedMonths: number[];
  selectedClients: string[];
  clientSearch: string;
  page: number;
  pageSize: number;
  view: MatrixTabView;
} {
  const cy = new Date().getFullYear();
  const rawY = parseInt(sp.get('year') || String(cy), 10);
  const year = Number.isFinite(rawY) && rawY >= 2020 && rawY <= 2035 ? rawY : cy;

  const monthsPart = sp.get('months');
  const selectedMonths = monthsPart
    ? [...new Set(
        monthsPart.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= 12),
      )].sort((a, b) => a - b)
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

  return { year, selectedMonths, selectedClients, clientSearch, page, pageSize, view };
}

function mergeMatrixListSearchParams(
  prev: URLSearchParams,
  patch: Partial<{
    year: number;
    selectedMonths: number[];
    selectedClients: string[];
    clientSearch: string;
    page: number;
    pageSize: number;
    view: MatrixTabView;
  }>,
): URLSearchParams {
  const cur = parseMatrixListParams(prev);
  const next = {
    year: patch.year ?? cur.year,
    selectedMonths: patch.selectedMonths !== undefined ? patch.selectedMonths : cur.selectedMonths,
    selectedClients: patch.selectedClients !== undefined ? patch.selectedClients : cur.selectedClients,
    clientSearch: patch.clientSearch !== undefined ? patch.clientSearch : cur.clientSearch,
    page: patch.page ?? cur.page,
    pageSize: patch.pageSize ?? cur.pageSize,
    view: patch.view ?? cur.view,
  };
  const cy = new Date().getFullYear();
  const merged = new URLSearchParams(prev);

  if (next.year !== cy) merged.set('year', String(next.year));
  else merged.delete('year');

  if (next.selectedMonths.length) merged.set('months', next.selectedMonths.join(','));
  else merged.delete('months');

  if (next.selectedClients.length) merged.set('clients', next.selectedClients.join(','));
  else merged.delete('clients');

  if (next.clientSearch.trim()) merged.set('clientSearch', next.clientSearch);
  else merged.delete('clientSearch');

  if (next.page !== 1) merged.set('page', String(next.page));
  else merged.delete('page');

  if (next.pageSize !== DEFAULT_PAGE_SIZE) merged.set('pageSize', String(next.pageSize));
  else merged.delete('pageSize');

  if (next.view !== 'matrix') merged.set('view', next.view);
  else merged.delete('view');

  return merged;
}

export default function ClientActivityMatrixPage() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseMatrixListParams(searchParams), [searchParams]);
  const { year, selectedMonths, selectedClients, clientSearch, page, pageSize, view } = listState;

  const isMobile = useIsMobile();
  const [cellDrawer, setCellDrawer] = useState<{ clientId: string; clientName: string; month: number } | null>(null);
  const [drawerSortOrder, setDrawerSortOrder] = useState<'desc' | 'asc'>('desc');
  const [drawerDateRange, setDrawerDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const matrixStale = 120_000;

  const { data, isLoading } = useQuery({
    queryKey: ['manager-client-activity', year],
    queryFn: () => analyticsApi.getHistory(year),
    staleTime: matrixStale,
  });

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
    queryKey: ['manager-client-activity-client-month', cellDrawer?.clientId, cellDrawer?.month, year],
    queryFn: () => analyticsApi.getHistoryClientMonth(cellDrawer!.clientId, cellDrawer!.month, year),
    enabled: !!cellDrawer,
    staleTime: matrixStale,
  });

  const clientActivity = data?.clientActivity ?? [];

  const visibleMonths = useMemo(() => {
    if (!data?.monthlyTrend?.length) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const maxMonth = Math.max(...data.monthlyTrend.map((m) => m.month));
    return Array.from({ length: maxMonth }, (_, i) => i + 1);
  }, [data?.monthlyTrend]);

  const displayedMonths = useMemo(() => {
    if (selectedMonths.length === 0) return visibleMonths;
    const available = new Set(visibleMonths);
    return selectedMonths.filter((m) => available.has(m)).sort((a, b) => a - b);
  }, [selectedMonths, visibleMonths]);

  const filteredActivity = useMemo(() => {
    let rows = clientActivity;
    if (selectedClients.length > 0) {
      rows = rows.filter((c) => selectedClients.includes(c.clientId));
    }
    const q = clientSearch.trim();
    if (!q) return rows;
    return rows.filter((c) => matchesSearch(c.companyName, q));
  }, [clientActivity, clientSearch, selectedClients]);

  const patchListParams = useCallback(
    (patch: Parameters<typeof mergeMatrixListSearchParams>[1], nav?: { replace?: boolean }) => {
      setSearchParams((prev) => mergeMatrixListSearchParams(prev, patch), nav);
    },
    [setSearchParams],
  );

  const totalPages = Math.max(1, Math.ceil(filteredActivity.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (filteredActivity.length === 0) return;
    if (page !== safePage) {
      patchListParams({ page: safePage }, { replace: true });
    }
  }, [filteredActivity.length, page, safePage, patchListParams]);

  const pagedActivity = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredActivity.slice(start, start + pageSize);
  }, [filteredActivity, safePage, pageSize]);

  useEffect(() => {
    if (!cellDrawer) return;
    setDrawerSortOrder('desc');
    setDrawerDateRange(null);
  }, [cellDrawer?.clientId, cellDrawer?.month]);

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

    items.sort((a, b) => {
      const aTs = a.createdAt ? dayjs(a.createdAt).valueOf() : 0;
      const bTs = b.createdAt ? dayjs(b.createdAt).valueOf() : 0;
      return drawerSortOrder === 'desc' ? bTs - aTs : aTs - bTs;
    });

    return items;
  }, [clientMonthData?.items, drawerDateRange, drawerSortOrder]);

  const filteredDrawerTotal = useMemo(
    () => filteredDrawerItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [filteredDrawerItems],
  );

  const noDataColor = token.colorFillTertiary || token.colorBgContainerDisabled || '#2f2f2f';

  const maxMonthRevenue = useMemo(() => {
    const all = clientActivity.flatMap((c) => c.monthlyData.map((m) => m.revenue));
    return all.reduce((a, b) => Math.max(a, b), 1);
  }, [clientActivity]);

  function getMonthRevenue(record: HistoryClientActivity, month: number): number {
    const m = record.monthlyData.find((d) => d.month === month);
    return m ? m.revenue : 0;
  }

  function getRevenueColor(revenue: number): string {
    if (revenue <= 0) return noDataColor;
    const intensity = Math.min(revenue / maxMonthRevenue, 1);
    return `rgba(56,218,17,${0.2 + intensity * 0.8})`;
  }

  const activityCols = [
    {
      title: 'Клиент',
      dataIndex: 'companyName',
      key: 'companyName',
      fixed: 'left' as const,
      width: 260,
      render: (_: string, r: HistoryClientActivity) => (
        <a onClick={() => navigate(`/clients/${r.clientId}`)}>{r.companyName}</a>
      ),
    },
    {
      title: 'Отдел',
      dataIndex: 'managerDepartment',
      key: 'managerDepartment',
      fixed: 'left' as const,
      width: 120,
      ellipsis: true,
      sorter: (a: HistoryClientActivity, b: HistoryClientActivity) =>
        (a.managerDepartment || '').localeCompare(b.managerDepartment || '', 'ru'),
      render: (v: string | null | undefined) =>
        v ? <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Последний контакт',
      key: 'lastContact',
      width: 168,
      fixed: 'left' as const,
      sorter: (a: HistoryClientActivity, b: HistoryClientActivity) => {
        const ta = a.lastContactAt ? dayjs(a.lastContactAt).valueOf() : 0;
        const tb = b.lastContactAt ? dayjs(b.lastContactAt).valueOf() : 0;
        return ta - tb;
      },
      render: (_: unknown, r: HistoryClientActivity) => {
        if (!r.lastContactAt) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const when = dayjs(r.lastContactAt);
        const label = when.format('DD.MM.YYYY HH:mm');
        const who = r.lastContactByName || '—';
        return (
          <Tooltip title={`${label} — ${who}`}>
            <div style={{ fontSize: 12, lineHeight: 1.35 }}>
              <div>{label}</div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis>
                {who}
              </Typography.Text>
            </div>
          </Tooltip>
        );
      },
    },
    ...displayedMonths.map((m) => ({
      title: MONTH_LABELS[m],
      key: `m${m}`,
      width: 76,
      align: 'center' as const,
      render: (_: unknown, record: HistoryClientActivity) => {
        const revenue = getMonthRevenue(record, m);
        const bgColor = getRevenueColor(revenue);
        const isClickable = revenue > 0;
        const intensity = revenue > 0 ? Math.min(revenue / maxMonthRevenue, 1) : 0;
        return (
          <Tooltip title={revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}>
            <div
              style={{
                width: 34,
                height: 26,
                borderRadius: 6,
                margin: '0 auto',
                backgroundColor: bgColor,
                color: intensity > 0.5 ? '#fff' : token.colorTextSecondary,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isClickable ? 'pointer' : 'default',
              }}
              onClick={isClickable ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: m }) : undefined}
            >
              {revenue > 0 ? '●' : '—'}
            </div>
          </Tooltip>
        );
      },
    })),
    {
      title: 'Активные',
      key: 'active',
      width: 100,
      render: (_: unknown, r: HistoryClientActivity) => <Tag color="blue">{r.activeMonths.length} мес.</Tag>,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 12 }}><CalendarOutlined /> Аналитика для менеджеров</Title>

      <Tabs
        activeKey={view}
        onChange={(next) => patchListParams({ view: next as MatrixTabView })}
        destroyInactiveTabPane
        items={[
          {
            key: 'matrix',
            label: (
              <span>
                <CalendarOutlined /> Матрица по месяцам
              </span>
            ),
            children: isLoading ? (
              <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
            ) : (
              <Card
        size="small"
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select
              value={year}
              onChange={(nextYear) => patchListParams({ year: nextYear, selectedMonths: [], page: 1 })}
              style={{ width: 110 }}
              options={[2024, 2025, 2026, 2027].map((y) => ({ label: y, value: y }))}
            />
            <Select
              mode="multiple"
              placeholder="Месяцы"
              allowClear
              style={{ width: isMobile ? 220 : 220 }}
              maxTagCount={2}
              value={selectedMonths}
              onChange={(vals) => patchListParams({ selectedMonths: [...vals].sort((a, b) => a - b), page: 1 })}
              options={visibleMonths.map((m) => ({ label: MONTH_LABELS[m], value: m }))}
            />
            <Select
              mode="multiple"
              placeholder="Фильтр клиентов"
              allowClear
              showSearch
              style={{ width: isMobile ? 220 : 320 }}
              maxTagCount={2}
              value={selectedClients}
              onChange={(vals) => patchListParams({ selectedClients: vals, page: 1 })}
              options={clientActivity.map((c) => ({ label: c.companyName, value: c.clientId }))}
              filterOption={smartFilterOption}
            />
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
              placeholder="Поиск по клиенту"
              value={clientSearch}
              onChange={(e) => patchListParams({ clientSearch: e.target.value, page: 1 })}
              style={{ width: isMobile ? 220 : 260 }}
            />
          </div>
        )}
      >
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,0.2)' }} /> Мало</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: 'rgba(56,218,17,1)' }} /> Много</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: noDataColor }} /> Нет данных</span>
        </div>

        {isMobile ? (
          <div>
            <div style={{ maxHeight: 560, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pagedActivity.map((record) => (
              <div key={record.clientId} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  <a onClick={() => navigate(`/clients/${record.clientId}`)}>{record.companyName}</a>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {displayedMonths.map((m) => {
                    const revenue = getMonthRevenue(record, m);
                    const isClickable = revenue > 0;
                    return (
                      <Tooltip key={m} title={`${MONTH_LABELS[m]}: ${revenue > 0 ? revenue.toLocaleString('ru-RU') : 'Нет данных'}`}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 6,
                          backgroundColor: getRevenueColor(revenue),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 500,
                          cursor: isClickable ? 'pointer' : 'default',
                        }}>
                          <span
                            style={{ width: '100%', textAlign: 'center' }}
                            onClick={isClickable ? () => setCellDrawer({ clientId: record.clientId, clientName: record.companyName, month: m }) : undefined}
                          >
                            {MONTH_LABELS[m]}
                          </span>
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
              ))}
            </div>
            {filteredActivity.length > pageSize && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Pagination
                  current={safePage}
                  total={filteredActivity.length}
                  pageSize={pageSize}
                  showSizeChanger
                  pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
                  onChange={(p, ps) => patchListParams({ page: p, pageSize: ps })}
                  size="small"
                />
              </div>
            )}
          </div>
        ) : (
          <Table
            dataSource={filteredActivity}
            columns={activityCols}
            rowKey="clientId"
            size="small"
            pagination={{
              current: safePage,
              pageSize,
              total: filteredActivity.length,
              showSizeChanger: true,
              pageSizeOptions: [...PAGE_SIZE_OPTIONS],
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
            label: (
              <span>
                <ApartmentOutlined /> Клиенты по иерархии
              </span>
            ),
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

      <Drawer
        title={cellDrawer ? `${cellDrawer.clientName} - ${MONTH_LABELS[cellDrawer.month]} ${year}` : ''}
        open={!!cellDrawer}
        onClose={() => setCellDrawer(null)}
        width="100%"
      >
        {clientMonthLoading ? (
          <Spin />
        ) : (
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
                  title: 'Дата',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  width: 110,
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
