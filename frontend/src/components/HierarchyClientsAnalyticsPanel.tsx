import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Col, Row, Segmented, Select, Space, Spin, Table, Typography, theme, InputNumber, Button, Affix, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Bar } from '@ant-design/charts';
import type { Product } from '../types';
import { formatUZS } from '../utils/currency';
import { smartFilterOption, matchesSearch } from '../utils/translit';
import {
  inferTypeLabel,
  safePrice,
  getStartDateByPreset,
  loadSalesContext,
  type HierarchyPeriodPreset,
} from '../lib/analyticsHierarchySales';

type CompareLevel = 'category' | 'type' | 'product';
type ClientViewMode = 'table' | 'matrix';
type ClientListSort = 'name_asc' | 'name_desc' | 'revenue_desc' | 'revenue_asc' | 'qty_desc' | 'qty_asc' | 'deals_desc' | 'deals_asc';
type PurchaseLineRow = {
  key: string;
  dealId: string;
  dealTitle: string;
  saleAt: string;
  productId: string;
  productName: string;
  soldQty: number;
  salesRevenue: number;
};
type ClientPurchaseSummaryRow = {
  key: string;
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  deals: Set<string>;
  soldQty: number;
  salesRevenue: number;
  productMetrics: Map<string, { name: string; soldQty: number; salesRevenue: number }>;
  purchaseLines: PurchaseLineRow[];
  dealsCount: number;
  purchasedInfo: string;
};
type MatrixClientRow = {
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  monthly: Record<string, number>;
};
type BasicClientRow = { clientId: string; clientIsSvip: boolean };

type CategorySummary = {
  name: string;
  products: Product[];
  typesCount: number;
  productsCount: number;
  totalStock: number;
  avgPrice: number;
};

export type HierarchyClientsAnalyticsPanelProps = {
  /** Активные товары (как на странице аналитики) */
  products: Product[];
  /** false — не грузить закрытые позиции, пока вкладка скрыта (ускоряет остальные страницы) */
  fetchEnabled?: boolean;
  /** Префикс для сохранения состояния фильтров в URL query (например `mgr_hc`) */
  persistPrefix?: string;
  /** Внешний текст поиска по клиентам (если передан — используется как источник истины). */
  clientSearchTerm?: string;
  /** Коллбек изменения внешнего поиска. */
  onClientSearchTermChange?: (value: string) => void;
};

/**
 * Блок «Клиенты по иерархии»: период, фильтр категория/тип/товар, графики и таблица клиентов.
 * Используется в аналитике и на странице «Аналитика для менеджеров».
 */
export default function HierarchyClientsAnalyticsPanel({
  products,
  fetchEnabled = true,
  persistPrefix,
  clientSearchTerm,
  onClientSearchTermChange,
}: HierarchyClientsAnalyticsPanelProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qp = (name: string) => (persistPrefix ? `${persistPrefix}_${name}` : '');
  const readPersist = (name: string): string | null => {
    if (!persistPrefix) return null;
    const key = qp(name);
    return key ? searchParams.get(key) : null;
  };

  const persistedLevel = readPersist('level');
  const persistedPreset = readPersist('period');
  const persistedView = readPersist('view');
  const persistedDays = Number(readPersist('days') ?? 30);

  const [clientScopeLevel, setClientScopeLevel] = useState<CompareLevel>(
    persistedLevel === 'category' || persistedLevel === 'type' || persistedLevel === 'product' ? persistedLevel : 'category',
  );
  const [clientScopeCategory, setClientScopeCategory] = useState<string | null>(readPersist('category'));
  const [clientScopeType, setClientScopeType] = useState<string | null>(readPersist('type'));
  const [clientScopeProductId, setClientScopeProductId] = useState<string | null>(readPersist('product'));
  const [hierarchyPeriodPreset, setHierarchyPeriodPreset] = useState<HierarchyPeriodPreset>(
    persistedPreset === 'week' || persistedPreset === 'month' || persistedPreset === 'quarter' || persistedPreset === 'year' || persistedPreset === 'custom'
      ? persistedPreset
      : 'month',
  );
  const [hierarchyCustomDays, setHierarchyCustomDays] = useState<number>(
    Number.isFinite(persistedDays) && persistedDays > 0 ? persistedDays : 30,
  );
  const [clientViewMode, setClientViewMode] = useState<ClientViewMode>(
    persistedView === 'matrix' ? 'matrix' : 'table',
  );
  const [internalClientSearch, setInternalClientSearch] = useState(readPersist('clientSearch') || '');
  const [clientListSort, setClientListSort] = useState<ClientListSort>('revenue_desc');
  const [clientRevenueFilter, setClientRevenueFilter] = useState<'all' | 'gt_0' | 'gte_1m' | 'gte_10m'>('all');

  const effectiveClientSearch = (clientSearchTerm ?? internalClientSearch).trim();

  const writePersist = useCallback((name: string, value: string | null) => {
    if (!persistPrefix) return;
    const key = qp(name);
    if (!key) return;

    const current = searchParams.get(key);
    if (!value && current === null) return;
    if (value && current === value) return;

    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }, [persistPrefix, searchParams, setSearchParams]);

  const visibleProducts = useMemo(
    () => products.filter((p: Product) => p.isActive),
    [products],
  );

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of visibleProducts) map.set(p.id, p);
    return map;
  }, [visibleProducts]);
  const normalizedCategory = (p: Product) => ((p.category && p.category.trim()) || 'Без категории');

  const categories = useMemo<CategorySummary[]>(() => {
    const byCategory = new Map<string, Product[]>();
    for (const p of visibleProducts) {
      const category = (p.category && p.category.trim()) || 'Без категории';
      const list = byCategory.get(category) || [];
      list.push(p);
      byCategory.set(category, list);
    }
    return [...byCategory.entries()]
      .map(([name, prods]) => {
        const typeSet = new Set(prods.map((p) => inferTypeLabel(p)));
        const totalStock = prods.reduce((acc, p) => acc + (p.stock || 0), 0);
        const avgPrice =
          prods.length > 0
            ? prods.reduce((acc, p) => acc + safePrice(p.salePrice), 0) / prods.length
            : 0;
        return {
          name,
          products: prods,
          typesCount: typeSet.size,
          productsCount: prods.length,
          totalStock,
          avgPrice,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [visibleProducts]);

  useEffect(() => {
    if (categories.length === 0) {
      setClientScopeCategory(null);
      return;
    }
    setClientScopeCategory((prev) => prev ?? categories[0]?.name ?? null);
  }, [categories]);

  const typeOptionsForClients = useMemo(() => {
    if (!clientScopeCategory) return [];
    return (
      categories
        .find((c) => c.name === clientScopeCategory)
        ?.products.map((p) => inferTypeLabel(p))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .map((v) => ({ label: v, value: v })) ?? []
    );
  }, [categories, clientScopeCategory]);

  useEffect(() => {
    if (!clientScopeType) return;
    if (!typeOptionsForClients.some((opt) => opt.value === clientScopeType)) {
      setClientScopeType(typeOptionsForClients[0]?.value ?? null);
    }
  }, [clientScopeType, typeOptionsForClients]);

  const productOptionsForClients = useMemo(() => {
    let source = visibleProducts;
    if (clientScopeCategory) {
      source = source.filter((p: Product) => ((p.category && p.category.trim()) || 'Без категории') === clientScopeCategory);
    }
    if (clientScopeType) {
      source = source.filter((p: Product) => inferTypeLabel(p) === clientScopeType);
    }
    return source
      .map((p: Product) => ({ label: p.name, value: p.id }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [visibleProducts, clientScopeCategory, clientScopeType]);

  useEffect(() => {
    if (!clientScopeCategory || !categories.some((c) => c.name === clientScopeCategory)) {
      const first = categories[0]?.name ?? null;
      if (first !== clientScopeCategory) setClientScopeCategory(first);
    }
  }, [categories, clientScopeCategory]);

  useEffect(() => {
    const firstType = typeOptionsForClients[0]?.value ?? null;
    setClientScopeType((prev) => {
      if (prev && typeOptionsForClients.some((t) => t.value === prev)) return prev;
      return firstType;
    });
  }, [clientScopeCategory, typeOptionsForClients]);

  useEffect(() => {
    const firstProductId = productOptionsForClients[0]?.value ?? null;
    setClientScopeProductId((prev) => {
      if (prev && productOptionsForClients.some((p) => p.value === prev)) return prev;
      return firstProductId;
    });
  }, [clientScopeCategory, clientScopeType, productOptionsForClients]);

  const categoryOptionsForClients = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.name })),
    [categories],
  );

  useEffect(() => {
    writePersist('level', clientScopeLevel);
  }, [clientScopeLevel, writePersist]);
  useEffect(() => {
    writePersist('category', clientScopeCategory);
  }, [clientScopeCategory, writePersist]);
  useEffect(() => {
    writePersist('type', clientScopeType);
  }, [clientScopeType, writePersist]);
  useEffect(() => {
    writePersist('product', clientScopeProductId);
  }, [clientScopeProductId, writePersist]);
  useEffect(() => {
    writePersist('period', hierarchyPeriodPreset);
  }, [hierarchyPeriodPreset, writePersist]);
  useEffect(() => {
    writePersist('days', hierarchyPeriodPreset === 'custom' ? String(hierarchyCustomDays) : null);
  }, [hierarchyCustomDays, hierarchyPeriodPreset, writePersist]);
  useEffect(() => {
    writePersist('view', clientViewMode);
  }, [clientViewMode, writePersist]);
  useEffect(() => {
    if (clientSearchTerm !== undefined) return;
    writePersist('clientSearch', internalClientSearch.trim() || null);
  }, [clientSearchTerm, internalClientSearch, writePersist]);

  const hierarchyStale = 120_000;

  const { data: hierarchyClientContext, isLoading: hierarchyClientLoading } = useQuery({
    queryKey: ['analytics-hierarchy-clients-context', hierarchyPeriodPreset, hierarchyCustomDays],
    queryFn: () => loadSalesContext(getStartDateByPreset(hierarchyPeriodPreset, hierarchyCustomDays)),
    enabled: fetchEnabled,
    staleTime: hierarchyStale,
  });

  const purchaseRows = hierarchyClientContext?.purchaseRows ?? [];

  const selectedClientScopeProductIds = useMemo(() => {
    if (clientScopeLevel === 'category') {
      if (!clientScopeCategory) return new Set<string>();
      return new Set(
        visibleProducts
          .filter((p: Product) => ((p.category && p.category.trim()) || 'Без категории') === clientScopeCategory)
          .map((p: Product) => p.id),
      );
    }
    if (clientScopeLevel === 'type') {
      if (!clientScopeCategory || !clientScopeType) return new Set<string>();
      return new Set(
        visibleProducts
          .filter((p: Product) => ((p.category && p.category.trim()) || 'Без категории') === clientScopeCategory)
          .filter((p: Product) => inferTypeLabel(p) === clientScopeType)
          .map((p: Product) => p.id),
      );
    }
    return clientScopeProductId ? new Set([clientScopeProductId]) : new Set<string>();
  }, [clientScopeCategory, clientScopeLevel, clientScopeProductId, clientScopeType, visibleProducts]);

  const clientPurchaseSummaryRows = useMemo<ClientPurchaseSummaryRow[]>(() => {
    const rows = purchaseRows.filter((row) => selectedClientScopeProductIds.has(row.productId));
    const map = new Map<string, Omit<ClientPurchaseSummaryRow, 'dealsCount' | 'purchasedInfo'>>();

    for (const row of rows) {
      const existing = map.get(row.clientId) ?? {
        key: row.clientId,
        clientId: row.clientId,
        clientName: row.clientName,
        clientIsSvip: row.clientIsSvip,
        deals: new Set<string>(),
        soldQty: 0,
        salesRevenue: 0,
        productMetrics: new Map<string, { name: string; soldQty: number; salesRevenue: number }>(),
        purchaseLines: [],
      };
      existing.deals.add(row.dealId);
      existing.soldQty += row.soldQty;
      existing.salesRevenue += row.salesRevenue;
      const product = productsById.get(row.productId);
      const productName = product?.name || row.productId;
      const metric = existing.productMetrics.get(row.productId) ?? {
        name: productName,
        soldQty: 0,
        salesRevenue: 0,
      };
      metric.soldQty += row.soldQty;
      metric.salesRevenue += row.salesRevenue;
      existing.productMetrics.set(row.productId, metric);
      existing.purchaseLines.push({
        key: `${row.dealId}-${row.productId}-${row.saleAt}-${existing.purchaseLines.length}`,
        dealId: row.dealId,
        dealTitle: row.dealTitle,
        saleAt: row.saleAt,
        productId: row.productId,
        productName,
        soldQty: row.soldQty,
        salesRevenue: row.salesRevenue,
      });
      map.set(row.clientId, existing);
    }

    const summaryRows = [...map.values()]
      .map((entry) => ({
        ...entry,
        dealsCount: entry.deals.size,
        purchaseLines: [...entry.purchaseLines].sort(
          (a, b) => new Date(b.saleAt).getTime() - new Date(a.saleAt).getTime(),
        ),
        purchasedInfo: [...entry.productMetrics.values()]
          .sort((a, b) => b.salesRevenue - a.salesRevenue)
          .slice(0, 3)
          .map((v) => `${v.name} (${v.soldQty.toLocaleString('ru-RU')} шт.)`)
          .join(', '),
      }))
      .filter((row) => {
        if (!effectiveClientSearch) return true;
        return matchesSearch(row.clientName, effectiveClientSearch);
      });

    let filteredRows = summaryRows;
    if (clientRevenueFilter === 'gt_0') filteredRows = filteredRows.filter((r) => r.salesRevenue > 0);
    if (clientRevenueFilter === 'gte_1m') filteredRows = filteredRows.filter((r) => r.salesRevenue >= 1_000_000);
    if (clientRevenueFilter === 'gte_10m') filteredRows = filteredRows.filter((r) => r.salesRevenue >= 10_000_000);

    const sortedRows = [...filteredRows];
    sortedRows.sort((a, b) => {
      if (clientListSort === 'name_asc') return a.clientName.localeCompare(b.clientName, 'ru');
      if (clientListSort === 'name_desc') return b.clientName.localeCompare(a.clientName, 'ru');
      if (clientListSort === 'revenue_desc') return b.salesRevenue - a.salesRevenue;
      if (clientListSort === 'revenue_asc') return a.salesRevenue - b.salesRevenue;
      if (clientListSort === 'qty_desc') return b.soldQty - a.soldQty;
      if (clientListSort === 'qty_asc') return a.soldQty - b.soldQty;
      if (clientListSort === 'deals_desc') return b.dealsCount - a.dealsCount;
      return a.dealsCount - b.dealsCount;
    });

    return sortedRows;
  }, [
    clientListSort,
    clientRevenueFilter,
    effectiveClientSearch,
    productsById,
    purchaseRows,
    selectedClientScopeProductIds,
  ]);

  const hierarchyClientRevenueChartData = useMemo(
    () =>
      clientPurchaseSummaryRows
        .slice(0, 12)
        .map((row) => ({ name: row.clientIsSvip ? `👑 ${row.clientName}` : row.clientName, value: row.salesRevenue })),
    [clientPurchaseSummaryRows],
  );

  const hierarchyClientQtyChartData = useMemo(
    () =>
      clientPurchaseSummaryRows
        .slice(0, 12)
        .map((row) => ({ name: row.clientIsSvip ? `👑 ${row.clientName}` : row.clientName, value: row.soldQty })),
    [clientPurchaseSummaryRows],
  );

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

  const categoryProductsChartData = useMemo(() => {
    const rows = purchaseRows.filter((row) => selectedClientScopeProductIds.has(row.productId));
    const byProduct = new Map<string, { name: string; soldQty: number }>();

    for (const row of rows) {
      const product = productsById.get(row.productId);
      const key = row.productId;
      const current = byProduct.get(key) ?? {
        name: product?.name || row.productId,
        soldQty: 0,
      };
      current.soldQty += row.soldQty;
      byProduct.set(key, current);
    }

    return [...byProduct.values()]
      .sort((a, b) => b.soldQty - a.soldQty)
      .slice(0, 20)
      .map((p) => ({ name: p.name, value: p.soldQty }));
  }, [productsById, purchaseRows, selectedClientScopeProductIds]);

  const matrixRows = useMemo(() => {
    const rows = purchaseRows.filter((row) => selectedClientScopeProductIds.has(row.productId));
    const monthSet = new Set<string>();
    for (const row of rows) monthSet.add(row.saleAt.slice(0, 7));
    const monthKeys = [...monthSet].sort();
    const monthLabel = (monthKey: string) => {
      const [y, m] = monthKey.split('-');
      return `${m}.${String(y).slice(-2)}`;
    };

    const byClient = new Map<string, MatrixClientRow>();
    for (const row of rows) {
      const month = row.saleAt.slice(0, 7);
      const current = byClient.get(row.clientId) ?? {
        clientId: row.clientId,
        clientName: row.clientName,
        clientIsSvip: row.clientIsSvip,
        monthly: {},
      };
      current.monthly[month] = (current.monthly[month] ?? 0) + row.salesRevenue;
      byClient.set(row.clientId, current);
    }

    const summaryByClientId = new Map(clientPurchaseSummaryRows.map((r) => [r.clientId, r] as const));
    const clients = [...byClient.values()]
      .filter((c) => summaryByClientId.has(c.clientId))
      .sort((a, b) => {
        const sa = summaryByClientId.get(a.clientId);
        const sb = summaryByClientId.get(b.clientId);
        if (!sa || !sb) return 0;
        if (clientListSort === 'name_asc') return a.clientName.localeCompare(b.clientName, 'ru');
        if (clientListSort === 'name_desc') return b.clientName.localeCompare(a.clientName, 'ru');
        if (clientListSort === 'revenue_desc') return sb.salesRevenue - sa.salesRevenue;
        if (clientListSort === 'revenue_asc') return sa.salesRevenue - sb.salesRevenue;
        if (clientListSort === 'qty_desc') return sb.soldQty - sa.soldQty;
        if (clientListSort === 'qty_asc') return sa.soldQty - sb.soldQty;
        if (clientListSort === 'deals_desc') return sb.dealsCount - sa.dealsCount;
        return sa.dealsCount - sb.dealsCount;
      });

    const maxRevenue = Math.max(1, ...clients.flatMap((c) => monthKeys.map((m) => c.monthly[m] ?? 0)));
    return { monthKeys, monthLabel, clients, maxRevenue };
  }, [clientListSort, clientPurchaseSummaryRows, purchaseRows, selectedClientScopeProductIds]);

  useEffect(() => {
    if (clientScopeLevel !== 'product' || !clientScopeProductId) return;
    const selectedProduct = productsById.get(clientScopeProductId);
    if (!selectedProduct) return;

    const expectedCategory = normalizedCategory(selectedProduct);
    const expectedType = inferTypeLabel(selectedProduct);

    if (clientScopeCategory !== expectedCategory) setClientScopeCategory(expectedCategory);
    if (clientScopeType !== expectedType) setClientScopeType(expectedType);
  }, [clientScopeLevel, clientScopeProductId, clientScopeCategory, clientScopeType, productsById]);

  const purchaseLinesColumns: ColumnsType<PurchaseLineRow> = [
    {
      title: 'Товар',
      dataIndex: 'productName',
      key: 'productName',
      ellipsis: true,
    },
    {
      title: 'Сделка',
      dataIndex: 'dealTitle',
      key: 'dealTitle',
      render: (title, line) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/deals/${line.dealId}`)}>
          {title}
        </Button>
      ),
    },
    {
      title: 'Дата',
      dataIndex: 'saleAt',
      key: 'saleAt',
      width: 110,
      render: (iso: string) =>
        new Date(iso).toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
    },
    {
      title: 'Шт.',
      dataIndex: 'soldQty',
      key: 'soldQty',
      width: 72,
      align: 'right',
      render: (v: number) => v.toLocaleString('ru-RU'),
    },
    {
      title: 'Выручка',
      dataIndex: 'salesRevenue',
      key: 'salesRevenue',
      width: 120,
      align: 'right',
      render: (v: number) => formatUZS(v),
    },
  ];

  const clientSummaryColumns: ColumnsType<ClientPurchaseSummaryRow> = [
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      key: 'clientName',
      render: (v, r: BasicClientRow) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/clients/${r.clientId}`)}>
          {r.clientIsSvip ? `👑 ${v}` : v}
        </Button>
      ),
    },
    {
      title: 'Сделок',
      dataIndex: 'dealsCount',
      key: 'dealsCount',
      width: 90,
      align: 'right',
    },
    {
      title: 'Куплено (шт.)',
      dataIndex: 'soldQty',
      key: 'soldQty',
      width: 120,
      align: 'right',
      render: (v: number) => v.toLocaleString('ru-RU'),
    },
    {
      title: 'Выручка',
      dataIndex: 'salesRevenue',
      key: 'salesRevenue',
      width: 170,
      align: 'right',
      render: (v: number) => formatUZS(v),
    },
    {
      title: 'Что купил',
      dataIndex: 'purchasedInfo',
      key: 'purchasedInfo',
      render: (v: string) => v || '-',
    },
  ];

  const matrixColumns: ColumnsType<MatrixClientRow> = [
    {
      title: 'Клиент',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 220,
      fixed: 'left',
      render: (v, r: BasicClientRow) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/clients/${r.clientId}`)}>
          {r.clientIsSvip ? `👑 ${v}` : v}
        </Button>
      ),
    },
    ...matrixRows.monthKeys.map((monthKey) => ({
      title: matrixRows.monthLabel(monthKey),
      key: `m_${monthKey}`,
      width: 78,
      align: 'center' as const,
      render: (_value: unknown, row: MatrixClientRow) => {
        const revenue = row.monthly[monthKey] ?? 0;
        const ratio = Math.min(1, revenue / matrixRows.maxRevenue);
        const bg = revenue > 0
          ? `rgba(56, 218, 17, ${Math.max(0.2, ratio).toFixed(2)})`
          : (token.colorFillTertiary || '#f0f0f0');
        return (
          <div
            title={revenue > 0 ? formatUZS(revenue) : 'Нет покупки'}
            style={{
              width: 24,
              height: 24,
              margin: '0 auto',
              borderRadius: 6,
              background: bg,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          />
        );
      },
    })),
  ];

  if (visibleProducts.length === 0) {
    return (
      <Typography.Text type="secondary">Нет активных товаров для анализа иерархии.</Typography.Text>
    );
  }

  return (
    <div>
      <Card bordered={false} style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Typography.Text type="secondary">Период:</Typography.Text>
          <Segmented
            value={hierarchyPeriodPreset}
            onChange={(v) => setHierarchyPeriodPreset(v as HierarchyPeriodPreset)}
            options={[
              { label: 'Неделя', value: 'week' },
              { label: 'Месяц', value: 'month' },
              { label: 'Квартал', value: 'quarter' },
              { label: 'Год', value: 'year' },
              { label: 'Дни', value: 'custom' },
            ]}
          />
          {hierarchyPeriodPreset === 'custom' && (
            <InputNumber
              min={1}
              max={3650}
              value={hierarchyCustomDays}
              onChange={(v) => setHierarchyCustomDays(Number(v) || 30)}
              addonAfter="дн."
            />
          )}
        </Space>
      </Card>

      <Card bordered={false} title="Фильтры выбора">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={clientScopeLevel}
            onChange={(v) => setClientScopeLevel(v as CompareLevel)}
            options={[
              { label: 'По категории', value: 'category' },
              { label: 'По типу', value: 'type' },
              { label: 'По товару', value: 'product' },
            ]}
          />

          <Select
            placeholder="Категория"
            style={{ minWidth: 210 }}
            value={clientScopeCategory || undefined}
            onChange={(v) => setClientScopeCategory(v)}
            options={categoryOptionsForClients}
            showSearch
            filterOption={smartFilterOption}
          />

          {(clientScopeLevel === 'type' || clientScopeLevel === 'product') && (
            <Select
              placeholder="Тип"
              style={{ minWidth: 230 }}
              value={clientScopeType || undefined}
              onChange={(v) => setClientScopeType(v)}
              options={typeOptionsForClients}
              showSearch
              filterOption={smartFilterOption}
            />
          )}

          {clientScopeLevel === 'product' && (
            <Select
              placeholder="Товар"
              style={{ minWidth: 260 }}
              value={clientScopeProductId || undefined}
              onChange={(v) => {
                setClientScopeProductId(v);
                const selectedProduct = productsById.get(v);
                if (selectedProduct) {
                  setClientScopeCategory(normalizedCategory(selectedProduct));
                  setClientScopeType(inferTypeLabel(selectedProduct));
                }
              }}
              options={productOptionsForClients}
              showSearch
              filterOption={smartFilterOption}
            />
          )}

          <Segmented
            value={clientViewMode}
            onChange={(v) => setClientViewMode(v as ClientViewMode)}
            options={[
              { label: 'Таблица', value: 'table' },
              { label: 'Матрица по месяцам', value: 'matrix' },
            ]}
          />
        </Space>

        {hierarchyClientLoading ? (
          <Spin style={{ display: 'block', margin: '16px auto' }} />
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
              <Col xs={24}>
                <Card
                  size="small"
                  title={
                    clientScopeLevel === 'category'
                      ? 'Топ товаров в выбранной категории (шт.)'
                      : clientScopeLevel === 'type'
                        ? 'Топ товаров в выбранном типе (шт.)'
                        : 'Продажи выбранного товара (шт.)'
                  }
                >
                  {categoryProductsChartData.length > 0 ? (
                    <Bar
                      data={categoryProductsChartData}
                      xField="name"
                      yField="value"
                      height={320}
                      colorField="name"
                      axis={{
                        x: { label: false },
                        y: { labelFill: token.colorTextSecondary },
                      }}
                      tooltip={{
                        formatter: (datum: { name: string; value: number }) => ({
                          name: datum.name,
                          value: `${datum.value.toLocaleString('ru-RU')} шт.`,
                        }),
                      }}
                      theme={chartTheme}
                    />
                  ) : (
                    <Typography.Text type="secondary">Нет данных</Typography.Text>
                  )}
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title="Топ клиенты — Выручка">
                  {hierarchyClientRevenueChartData.length > 0 ? (
                    <Bar
                      data={hierarchyClientRevenueChartData}
                      xField="name"
                      yField="value"
                      height={220}
                      colorField="name"
                      axis={{
                        x: { label: false },
                        y: { labelFill: token.colorTextSecondary },
                      }}
                      tooltip={{
                        formatter: (datum: { name: string; value: number }) => ({
                          name: datum.name,
                          value: formatUZS(datum.value),
                        }),
                      }}
                      theme={chartTheme}
                    />
                  ) : (
                    <Typography.Text type="secondary">Нет данных</Typography.Text>
                  )}
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title="Топ клиенты — Количество (шт.)">
                  {hierarchyClientQtyChartData.length > 0 ? (
                    <Bar
                      data={hierarchyClientQtyChartData}
                      xField="name"
                      yField="value"
                      height={220}
                      colorField="name"
                      axis={{
                        x: { label: false },
                        y: { labelFill: token.colorTextSecondary },
                      }}
                      tooltip={{
                        formatter: (datum: { name: string; value: number }) => ({
                          name: datum.name,
                          value: datum.value.toLocaleString('ru-RU'),
                        }),
                      }}
                      theme={chartTheme}
                    />
                  ) : (
                    <Typography.Text type="secondary">Нет данных</Typography.Text>
                  )}
                </Card>
              </Col>
            </Row>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input
                allowClear
                prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
                placeholder="Поиск клиента"
                value={clientSearchTerm ?? internalClientSearch}
                onChange={(e) => {
                  const next = e.target.value;
                  if (onClientSearchTermChange) onClientSearchTermChange(next);
                  else setInternalClientSearch(next);
                }}
                style={{ minWidth: 220, width: 280 }}
              />
              <Select
                value={clientListSort}
                onChange={(v) => setClientListSort(v)}
                style={{ minWidth: 220 }}
                options={[
                  { label: 'Сорт: А-Я', value: 'name_asc' },
                  { label: 'Сорт: Я-А', value: 'name_desc' },
                  { label: 'Сорт: выручка (убыв.)', value: 'revenue_desc' },
                  { label: 'Сорт: выручка (возр.)', value: 'revenue_asc' },
                  { label: 'Сорт: куплено (убыв.)', value: 'qty_desc' },
                  { label: 'Сорт: куплено (возр.)', value: 'qty_asc' },
                  { label: 'Сорт: сделки (убыв.)', value: 'deals_desc' },
                  { label: 'Сорт: сделки (возр.)', value: 'deals_asc' },
                ]}
              />
              <Select
                value={clientRevenueFilter}
                onChange={(v) => setClientRevenueFilter(v)}
                style={{ minWidth: 200 }}
                options={[
                  { label: 'Выручка: все', value: 'all' },
                  { label: 'Выручка > 0', value: 'gt_0' },
                  { label: 'Выручка ≥ 1 млн', value: 'gte_1m' },
                  { label: 'Выручка ≥ 10 млн', value: 'gte_10m' },
                ]}
              />
            </div>

            {clientViewMode === 'table' ? (
              <Table
                size="small"
                rowKey="clientId"
                pagination={false}
                dataSource={clientPurchaseSummaryRows}
                locale={{ emptyText: 'Нет покупок по выбранному фильтру' }}
                expandable={{
                  expandedRowRender: (record) => (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="key"
                      dataSource={record.purchaseLines}
                      columns={purchaseLinesColumns}
                    />
                  ),
                }}
                columns={clientSummaryColumns}
              />
            ) : (
              <Table
                size="small"
                pagination={false}
                rowKey="clientId"
                dataSource={matrixRows.clients}
                locale={{ emptyText: 'Нет покупок по выбранному фильтру' }}
                scroll={{ x: Math.max(900, 220 + matrixRows.monthKeys.length * 78) }}
                columns={matrixColumns}
              />
            )}

            <Affix offsetBottom={16}>
              <div style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: 180, pointerEvents: 'none' }}>
                <Card
                  size="small"
                  style={{
                    pointerEvents: 'auto',
                    boxShadow: isDark ? '0 8px 22px rgba(0,0,0,0.45)' : '0 8px 22px rgba(0,0,0,0.12)',
                    borderRadius: 10,
                  }}
                >
                  <Space size={8}>
                    <Typography.Text type="secondary">Быстрый вид:</Typography.Text>
                    <Segmented
                      value={clientViewMode}
                      onChange={(v) => setClientViewMode(v as ClientViewMode)}
                      options={[
                        { label: 'Таблица', value: 'table' },
                        { label: 'Матрица', value: 'matrix' },
                      ]}
                    />
                  </Space>
                </Card>
              </div>
            </Affix>
          </>
        )}
      </Card>
    </div>
  );
}
