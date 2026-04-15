import { useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren, TdHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Tabs, Card, Col, Row, Statistic, Table, Typography, Spin, Tag, Segmented, theme, Tooltip, Badge, List, Checkbox, Empty, Button, Select, Space, InputNumber } from 'antd';
import {
  DollarOutlined,
  RiseOutlined,
  PercentageOutlined,
  FallOutlined,
  WarningOutlined,
  StockOutlined,
  InfoCircleOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  ShoppingOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Pie, Bar, Line, Area } from '@ant-design/charts';
import { analyticsApi, type AnalyticsPeriod } from '../api/analytics.api';
import { productsApi } from '../api/products.api';
import { dealsApi } from '../api/deals.api';
import { financeApi } from '../api/finance.api';
import { statusConfig } from '../components/DealStatusTag';
import AbcXyzRecommendationCell from '../components/AbcXyzRecommendationCell';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { formatUZS } from '../utils/currency';
import { LEGEND_OPERATIONAL, TOOLTIP_OPERATIONAL_REVENUE } from '../constants/analyticsRevenueTooltips';
import {
  ABC_TAG_COLORS,
  compareAbcXyzRowsByImportance,
  filterAbcXyzRows,
  uniqueCombinedClasses,
  xyzTagColor,
  xyzTagStyle,
} from '../constants/abcXyzUx';
import type {
  DealStatus,
  ClientLTVRow,
  CrossSellPair,
  DemandStabilityRow,
  Product,
  AbcXyzRow,
} from '../types';

function AbcXyzTableBodyCell(props: PropsWithChildren<TdHTMLAttributes<HTMLTableCellElement>>) {
  const { children, style, className, ...rest } = props;
  return (
    <td
      {...rest}
      className={className}
      style={{ ...style, verticalAlign: 'top', padding: '12px 16px' }}
    >
      {children}
    </td>
  );
}

const abcXyzTableComponents = { body: { cell: AbcXyzTableBodyCell } };

const statusColorMap: Record<string, string> = {
  NEW: '#6b9bd2',
  IN_PROGRESS: '#7ba7d7',
  WAITING_STOCK_CONFIRMATION: '#d4b896',
  STOCK_CONFIRMED: '#8cbcb5',
  FINANCE_APPROVED: '#b5c9a0',
  ADMIN_APPROVED: '#a89bc4',
  READY_FOR_SHIPMENT: '#c9a0b5',
  CLOSED: '#7db88a',
  CANCELED: '#d4918f',
  REJECTED: '#c98a8a',
};

const segmentColorMap: Record<string, string> = {
  VIP: '#531dab',
  GOLD: '#d48806',
  SILVER: '#595959',
  BRONZE: '#a97142',
  B: '#1677ff',
  C: '#8c8c8c',
  Regular: '#1677ff',
  New: '#52c41a',
  'At-Risk': '#fa8c16',
  Churned: '#ff4d4f',
};

const segmentLabelMap: Record<string, string> = {
  VIP: 'VIP (A)',
  GOLD: 'Золото (A)',
  SILVER: 'Серебро (A)',
  BRONZE: 'Бронза (A)',
  B: 'Класс B',
  C: 'Класс C',
  Regular: 'Постоянные',
  New: 'Новые',
  'At-Risk': 'Под угрозой',
  Churned: 'Потерянные',
};

const methodLabelMap: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
  'Не указан': 'Не указан',
};

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const periodOptions = [
  { label: 'Неделя', value: 'week' },
  { label: 'Месяц', value: 'month' },
  { label: 'Квартал', value: 'quarter' },
  { label: 'Год', value: 'year' },
];

type CompareLevel = 'category' | 'type' | 'product';

type HierarchyCompareItem = {
  id: string;
  key: string;
  level: CompareLevel;
  label: string;
  category: string;
  typeLabel?: string;
  salesDeals: number;
  soldQty: number;
  salesRevenue: number;
  avgDealRevenue: number;
  avgUnitPrice: number;
  lastSaleAt?: string | null;
  format?: string;
  sku?: string;
  unit?: string;
};

type ProductSalesAggregate = {
  productId: string;
  soldQty: number;
  salesRevenue: number;
  dealIds: Set<string>;
  lastSaleAt: string | null;
};

type ProductPurchaseRow = {
  productId: string;
  dealId: string;
  dealTitle: string;
  clientId: string;
  clientName: string;
  clientIsSvip: boolean;
  soldQty: number;
  salesRevenue: number;
};

type HierarchyPeriodPreset = AnalyticsPeriod | 'custom';

type CategorySummary = {
  name: string;
  products: Product[];
  typesCount: number;
  productsCount: number;
  totalStock: number;
  avgPrice: number;
};

type TypeSummary = {
  name: string;
  category: string;
  products: Product[];
  productsCount: number;
  totalStock: number;
  avgPrice: number;
};

function safePrice(value?: string | null): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function inferTypeLabel(product: Product): string {
  const specs = product.specifications;
  if (specs && typeof specs === 'object') {
    const typeFromSpecs = (specs as Record<string, unknown>).type;
    if (typeof typeFromSpecs === 'string' && typeFromSpecs.trim()) {
      return typeFromSpecs.trim();
    }
  }

  let cleaned = product.name || '';
  if (product.format) {
    const escapedFormat = product.format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escapedFormat, 'ig'), ' ');
  }

  cleaned = cleaned
    .replace(/\b\d+\s*[xх*]\s*\d+(\s*[xх*]\s*\d+)?\b/gi, ' ')
    .replace(/\b\d+\s*(мкм|мм|см|cm|mm)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const firstChunk = cleaned.split(/[-–—/:(),]/)[0]?.trim();
  return firstChunk || cleaned || 'Без типа';
}

function compareKey(level: CompareLevel, id: string): string {
  return `${level}:${id}`;
}

function getPeriodStartDate(period: AnalyticsPeriod): Date {
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') {
    start.setDate(now.getDate() - 7);
    return start;
  }
  if (period === 'month') {
    start.setMonth(now.getMonth() - 1);
    return start;
  }
  if (period === 'quarter') {
    start.setMonth(now.getMonth() - 3);
    return start;
  }
  start.setFullYear(now.getFullYear() - 1);
  return start;
}

function getStartDateByPreset(preset: HierarchyPeriodPreset, customDays: number): Date {
  if (preset === 'custom') {
    const safeDays = Number.isFinite(customDays) ? Math.max(1, Math.floor(customDays)) : 30;
    const start = new Date();
    start.setDate(start.getDate() - safeDays);
    return start;
  }
  return getPeriodStartDate(preset);
}

function buildRevenueChartData(
  raw: { day: string; total: number; shippedTotal?: number }[],
): { day: string; total: number }[] {
  if (raw.length === 0) return [];
  const map = new Map(raw.map((d) => [d.day, d.total]));
  const sorted = [...raw].sort((a, b) => a.day.localeCompare(b.day));
  const startDate = new Date(sorted[0].day + 'T12:00:00Z');
  const endDate = new Date(sorted[sorted.length - 1].day + 'T12:00:00Z');
  const filled: { day: string; total: number }[] = [];
  for (let dt = new Date(startDate); dt <= endDate; dt.setUTCDate(dt.getUTCDate() + 1)) {
    const key = dt.toISOString().slice(0, 10);
    filled.push({ day: key, total: map.get(key) ?? 0 });
  }
  return filled.map((d) => {
    const parts = d.day.split('-');
    const dayNum = parseInt(parts[2], 10);
    const monthIdx = parseInt(parts[1], 10) - 1;
    return { day: `${dayNum} ${MONTH_SHORT[monthIdx]}`, total: d.total };
  });
}

function aggregateSalesForProducts(products: Product[], salesMap: Record<string, ProductSalesAggregate>) {
  let soldQty = 0;
  let salesRevenue = 0;
  let lastSaleAt: string | null = null;
  const dealIds = new Set<string>();

  for (const product of products) {
    const sales = salesMap[product.id];
    if (!sales) continue;

    soldQty += sales.soldQty;
    salesRevenue += sales.salesRevenue;
    for (const dealId of sales.dealIds) {
      dealIds.add(dealId);
    }
    if (sales.lastSaleAt && (!lastSaleAt || new Date(sales.lastSaleAt) > new Date(lastSaleAt))) {
      lastSaleAt = sales.lastSaleAt;
    }
  }

  const salesDeals = dealIds.size;
  return {
    salesDeals,
    soldQty,
    salesRevenue,
    avgDealRevenue: salesDeals > 0 ? salesRevenue / salesDeals : 0,
    avgUnitPrice: soldQty > 0 ? salesRevenue / soldQty : 0,
    lastSaleAt,
  };
}

async function loadSalesContext(periodStart: Date) {
  const allDeals = await dealsApi.list(undefined, true);
  const closedDeals = allDeals.filter((deal) => {
    if (deal.status !== 'CLOSED') return false;
    const createdAt = new Date(deal.createdAt);
    return createdAt >= periodStart;
  });

  const dealItemsEntries = await Promise.all(
    closedDeals.map(async (deal) => {
      try {
        const items = await dealsApi.getItems(deal.id);
        return { dealId: deal.id, createdAt: deal.createdAt, items };
      } catch {
        return { dealId: deal.id, createdAt: deal.createdAt, items: [] };
      }
    }),
  );

  const aggregateMap: Record<string, ProductSalesAggregate> = {};
  const purchaseRows: ProductPurchaseRow[] = [];
  const dealsById = new Map(closedDeals.map((deal) => [deal.id, deal]));

  for (const entry of dealItemsEntries) {
    for (const item of entry.items) {
      if (!item.productId) continue;
      const qty = Number(item.requestedQty || 0);
      const price = Number(item.price || 0);
      if (qty <= 0 || price <= 0) continue;

      if (!aggregateMap[item.productId]) {
        aggregateMap[item.productId] = {
          productId: item.productId,
          soldQty: 0,
          salesRevenue: 0,
          dealIds: new Set<string>(),
          lastSaleAt: null,
        };
      }

      const current = aggregateMap[item.productId];
      current.soldQty += qty;
      current.salesRevenue += qty * price;
      current.dealIds.add(entry.dealId);
      if (!current.lastSaleAt || new Date(entry.createdAt) > new Date(current.lastSaleAt)) {
        current.lastSaleAt = entry.createdAt;
      }

      const deal = dealsById.get(entry.dealId);
      if (deal?.clientId) {
        purchaseRows.push({
          productId: item.productId,
          dealId: entry.dealId,
          dealTitle: deal.title || `Сделка ${entry.dealId.slice(0, 6)}`,
          clientId: deal.clientId,
          clientName: deal.client?.companyName || 'Клиент',
          clientIsSvip: Boolean(deal.client?.isSvip),
          soldQty: qty,
          salesRevenue: qty * price,
        });
      }
    }
  }

  return { aggregateMap, purchaseRows };
}

function buildComparisonRows(level: CompareLevel, items: HierarchyCompareItem[]) {
  const baseRows: Array<{ metric: string;[key: string]: string | number }> = [
    { metric: 'Сделок' },
    { metric: 'Продано (шт.)' },
    { metric: 'Выручка' },
    { metric: 'Ср. чек' },
    { metric: 'Ср. цена / ед.' },
    { metric: 'Последняя продажа' },
  ];

  if (level === 'product') {
    baseRows.push({ metric: 'Формат' });
    baseRows.push({ metric: 'SKU' });
  }

  for (const item of items) {
    baseRows[0][item.key] = item.salesDeals;
    baseRows[1][item.key] = item.soldQty.toLocaleString('ru-RU');
    baseRows[2][item.key] = formatUZS(item.salesRevenue);
    baseRows[3][item.key] = formatUZS(item.avgDealRevenue);
    baseRows[4][item.key] = formatUZS(item.avgUnitPrice);
    baseRows[5][item.key] = item.lastSaleAt ? new Date(item.lastSaleAt).toLocaleDateString('ru-RU') : '-';
    if (level === 'product') {
      baseRows[6][item.key] = item.format || '-';
      baseRows[7][item.key] = item.sku || '-';
    }
  }

  return baseRows;
}

function FormulaHint({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined style={{ marginLeft: 4, fontSize: 12, opacity: 0.45 }} />
    </Tooltip>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [comparisonMap, setComparisonMap] = useState<Record<string, HierarchyCompareItem>>({});
  const [clientScopeLevel, setClientScopeLevel] = useState<CompareLevel>('category');
  const [clientScopeCategory, setClientScopeCategory] = useState<string | null>(null);
  const [clientScopeType, setClientScopeType] = useState<string | null>(null);
  const [clientScopeProductId, setClientScopeProductId] = useState<string | null>(null);
  const [hierarchyPeriodPreset, setHierarchyPeriodPreset] = useState<HierarchyPeriodPreset>('month');
  const [hierarchyCustomDays, setHierarchyCustomDays] = useState<number>(30);
  const [abcXyzFilterAbc, setAbcXyzFilterAbc] = useState<string | undefined>();
  const [abcXyzFilterXyz, setAbcXyzFilterXyz] = useState<string | undefined>();
  const [abcXyzFilterCombined, setAbcXyzFilterCombined] = useState<string | undefined>();
  const { token } = theme.useToken();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['analytics', period],
    queryFn: () => analyticsApi.getData(period),
  });

  const { data: abcXyz, isLoading: abcXyzLoading } = useQuery({
    queryKey: ['analytics-abc-xyz', period],
    queryFn: () => analyticsApi.getAbcXyz(period),
  });

  useEffect(() => {
    setAbcXyzFilterAbc(undefined);
    setAbcXyzFilterXyz(undefined);
    setAbcXyzFilterCombined(undefined);
  }, [period]);

  const abcXyzCombinedSelectOptions = useMemo(() => {
    if (!abcXyz) return [];
    return uniqueCombinedClasses(abcXyz.products, abcXyz.clients).map((v) => ({ label: v, value: v }));
  }, [abcXyz]);

  const abcXyzSortedProducts = useMemo(() => {
    if (!abcXyz?.products) return [];
    const filtered = filterAbcXyzRows(
      abcXyz.products,
      abcXyzFilterAbc,
      abcXyzFilterXyz,
      abcXyzFilterCombined,
    );
    return [...filtered].sort(compareAbcXyzRowsByImportance);
  }, [abcXyz, abcXyzFilterAbc, abcXyzFilterXyz, abcXyzFilterCombined]);

  const abcXyzSortedClients = useMemo(() => {
    if (!abcXyz?.clients) return [];
    const filtered = filterAbcXyzRows(
      abcXyz.clients,
      abcXyzFilterAbc,
      abcXyzFilterXyz,
      abcXyzFilterCombined,
    );
    return [...filtered].sort(compareAbcXyzRowsByImportance);
  }, [abcXyz, abcXyzFilterAbc, abcXyzFilterXyz, abcXyzFilterCombined]);

  const { data: intel } = useQuery({
    queryKey: ['analytics-intelligence', period],
    queryFn: () => analyticsApi.getIntelligence(period),
  });

  // Берём общий долг с той же страницы должников — чтобы цифра всегда совпадала
  const { data: debtsData } = useQuery({
    queryKey: ['finance-debts-total'],
    queryFn: () => financeApi.getDebts(),
  });

  const { data: allProducts = [] } = useQuery<Product[]>({
    queryKey: ['analytics-product-hierarchy'],
    queryFn: productsApi.list,
  });

  const visibleProducts = useMemo(() => {
    return allProducts.filter((p: Product) => p.isActive);
  }, [allProducts]);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of visibleProducts) map.set(p.id, p);
    return map;
  }, [visibleProducts]);

  const { data: salesContext, isLoading: salesLoading } = useQuery({
    queryKey: ['analytics-product-sales-map', period],
    queryFn: () => loadSalesContext(getPeriodStartDate(period)),
  });

  const productSalesMap = salesContext?.aggregateMap ?? {};
  const { data: hierarchyClientContext, isLoading: hierarchyClientLoading } = useQuery({
    queryKey: ['analytics-hierarchy-clients-context', hierarchyPeriodPreset, hierarchyCustomDays],
    queryFn: () => loadSalesContext(getStartDateByPreset(hierarchyPeriodPreset, hierarchyCustomDays)),
  });

  const purchaseRows = hierarchyClientContext?.purchaseRows ?? [];

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';


  const categories = useMemo<CategorySummary[]>(() => {
    const byCategory = new Map<string, Product[]>();

    for (const p of visibleProducts) {
      const category = (p.category && p.category.trim()) || 'Без категории';
      const list = byCategory.get(category) || [];
      list.push(p);
      byCategory.set(category, list);
    }

    return [...byCategory.entries()]
      .map(([name, products]) => {
        const typeSet = new Set(products.map((p) => inferTypeLabel(p)));
        const totalStock = products.reduce((acc, p) => acc + (p.stock || 0), 0);
        const avgPrice = products.length > 0
          ? products.reduce((acc, p) => acc + safePrice(p.salePrice), 0) / products.length
          : 0;

        return {
          name,
          products,
          typesCount: typeSet.size,
          productsCount: products.length,
          totalStock,
          avgPrice,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [visibleProducts]);

  const visibleComparisonKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const p of visibleProducts) {
      const category = (p.category && p.category.trim()) || 'Без категории';
      const typeLabel = inferTypeLabel(p);
      keys.add(compareKey('product', p.id));
      keys.add(compareKey('category', category));
      keys.add(compareKey('type', `${category}|${typeLabel}`));
    }

    return keys;
  }, [visibleProducts]);

  useEffect(() => {
    setComparisonMap((prev) => {
      const next: Record<string, HierarchyCompareItem> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (visibleComparisonKeys.has(key)) {
          next[key] = value;
        }
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [visibleComparisonKeys]);

  useEffect(() => {
    if (!activeCategory && categories.length > 0) {
      setActiveCategory(categories[0].name);
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    if (activeCategory && !categories.some((c) => c.name === activeCategory)) {
      setActiveCategory(categories[0]?.name || null);
      setActiveType(null);
    }
  }, [activeCategory, categories]);

  const typeSummaries = useMemo<TypeSummary[]>(() => {
    if (!activeCategory) return [];
    const categoryData = categories.find((c) => c.name === activeCategory);
    if (!categoryData) return [];

    const byType = new Map<string, Product[]>();
    for (const p of categoryData.products) {
      const typeLabel = inferTypeLabel(p);
      const list = byType.get(typeLabel) || [];
      list.push(p);
      byType.set(typeLabel, list);
    }

    return [...byType.entries()]
      .map(([name, products]) => {
        const totalStock = products.reduce((acc, p) => acc + (p.stock || 0), 0);
        const avgPrice = products.length > 0
          ? products.reduce((acc, p) => acc + safePrice(p.salePrice), 0) / products.length
          : 0;

        return {
          name,
          category: activeCategory,
          products,
          productsCount: products.length,
          totalStock,
          avgPrice,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [activeCategory, categories]);

  useEffect(() => {
    if (typeSummaries.length === 0) {
      setActiveType(null);
      return;
    }

    if (!activeType || !typeSummaries.some((t) => t.name === activeType)) {
      setActiveType(typeSummaries[0].name);
    }
  }, [activeType, typeSummaries]);

  const productsOnLevel = useMemo(() => {
    if (!activeType) return [];
    return typeSummaries.find((t) => t.name === activeType)?.products || [];
  }, [activeType, typeSummaries]);

  useEffect(() => {
    if (productsOnLevel.length === 0) {
      setActiveProductId(null);
      return;
    }
    if (!activeProductId || !productsOnLevel.some((p) => p.id === activeProductId)) {
      setActiveProductId(productsOnLevel[0].id);
    }
  }, [activeProductId, productsOnLevel]);

  useEffect(() => {
    setClientScopeCategory((prev) => prev ?? activeCategory ?? categories[0]?.name ?? null);
  }, [activeCategory, categories]);

  useEffect(() => {
    if (!activeCategory) return;
    const firstType = typeSummaries[0]?.name ?? null;
    setClientScopeType((prev) => {
      if (prev && typeSummaries.some((t) => t.name === prev)) return prev;
      return activeType ?? firstType;
    });
  }, [activeCategory, activeType, typeSummaries]);

  useEffect(() => {
    const firstProductId = productsOnLevel[0]?.id ?? null;
    setClientScopeProductId((prev) => {
      if (prev && productsOnLevel.some((p) => p.id === prev)) return prev;
      return activeProductId ?? firstProductId;
    });
  }, [activeProductId, productsOnLevel]);

  const comparisonItems = useMemo(() => Object.values(comparisonMap), [comparisonMap]);

  const categoryOptionsForClients = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.name })),
    [categories],
  );

  const typeOptionsForClients = useMemo(() => {
    if (!clientScopeCategory) return [];
    return categories
      .find((c) => c.name === clientScopeCategory)
      ?.products.map((p) => inferTypeLabel(p))
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((v) => ({ label: v, value: v })) ?? [];
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
      .sort((a: { label: string; value: string }, b: { label: string; value: string }) => a.label.localeCompare(b.label, 'ru'));
  }, [visibleProducts, clientScopeCategory, clientScopeType]);

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

  const clientPurchaseSummaryRows = useMemo(() => {
    const rows = purchaseRows.filter((row) => selectedClientScopeProductIds.has(row.productId));
    const map = new Map<
      string,
      {
        key: string;
        clientId: string;
        clientName: string;
        clientIsSvip: boolean;
        deals: Set<string>;
        soldQty: number;
        salesRevenue: number;
        productMetrics: Map<string, { name: string; soldQty: number; salesRevenue: number }>;
      }
    >();

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
      };
      existing.deals.add(row.dealId);
      existing.soldQty += row.soldQty;
      existing.salesRevenue += row.salesRevenue;
      const product = productsById.get(row.productId);
      const metric = existing.productMetrics.get(row.productId) ?? {
        name: product?.name || row.productId,
        soldQty: 0,
        salesRevenue: 0,
      };
      metric.soldQty += row.soldQty;
      metric.salesRevenue += row.salesRevenue;
      existing.productMetrics.set(row.productId, metric);
      map.set(row.clientId, existing);
    }

    return [...map.values()]
      .map((entry) => ({
        ...entry,
        dealsCount: entry.deals.size,
        purchasedInfo: [...entry.productMetrics.values()]
          .sort((a, b) => b.salesRevenue - a.salesRevenue)
          .slice(0, 3)
          .map((v) => `${v.name} (${v.soldQty.toLocaleString('ru-RU')} шт.)`)
          .join(', '),
      }))
      .sort((a, b) => b.salesRevenue - a.salesRevenue);
  }, [productsById, purchaseRows, selectedClientScopeProductIds]);

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

  const comparisonByLevel = useMemo(() => {
    return {
      category: comparisonItems.filter((i) => i.level === 'category'),
      type: comparisonItems.filter((i) => i.level === 'type'),
      product: comparisonItems.filter((i) => i.level === 'product'),
    };
  }, [comparisonItems]);

  const selectedSalesSummary = useMemo(() => {
    const dealCount = comparisonItems.reduce((acc, item) => acc + item.salesDeals, 0);
    const soldQty = comparisonItems.reduce((acc, item) => acc + item.soldQty, 0);
    const revenue = comparisonItems.reduce((acc, item) => acc + item.salesRevenue, 0);
    const avgDeal = dealCount > 0 ? revenue / dealCount : 0;
    const lastSale = comparisonItems
      .map((item) => item.lastSaleAt)
      .filter((v): v is string => Boolean(v))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

    return { dealCount, soldQty, revenue, avgDeal, lastSale };
  }, [comparisonItems]);

  const toggleComparison = (item: HierarchyCompareItem) => {
    setComparisonMap((prev) => {
      const next = { ...prev };
      if (next[item.key]) {
        delete next[item.key];
      } else {
        next[item.key] = item;
      }
      return next;
    });
  };

  const isSelected = (key: string) => Boolean(comparisonMap[key]);

  // Guard: all hooks are above this line, so early return is safe here
  if (isLoading || !data) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  // Now data is guaranteed non-null — safe to destructure
  const { sales, finance, warehouse, managers, profitability } = data;

  // ──── Sales tab data ────
  const pieData = sales.dealsByStatus.map((d) => ({
    type: statusConfig[d.status as DealStatus]?.label || d.status,
    value: d.count,
    color: statusColorMap[d.status] || '#8c8c8c',
  }));
  const pieColorDomain = pieData.map((d) => d.type);
  const pieColorRange = pieData.map((d) => d.color);

  const revenueDayChartData = buildRevenueChartData(sales.revenueByDay).map((d) => ({
    day: d.day,
    value: d.total,
  }));

  const clientBarData = sales.topClients.map((c) => ({
    name: `${c.isSvip ? '👑 ' : ''}${c.companyName}`,
    value: c.totalRevenue,
    clientId: c.clientId,
  }));

  const productBarData = sales.topProducts.map((p) => ({
    name: p.name,
    value: p.totalQuantity,
    productId: p.productId,
  }));

  const topSellingBarData = warehouse.topSelling.map((p) => ({
    name: p.name,
    value: p.totalSold,
    productId: p.productId,
  }));

  // ════════════════════════════════════════
  // ──── SALES TAB ────
  // ════════════════════════════════════════

  const salesTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={
                <span>
                  Выручка (закрытые сделки)
                  <Tooltip title={TOOLTIP_OPERATIONAL_REVENUE}>
                    <InfoCircleOutlined style={{ marginLeft: 6, fontSize: 12, opacity: 0.45 }} />
                  </Tooltip>
                </span>
              }
              value={sales.totalRevenue}
              formatter={(v) => formatUZS(v as number)}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Средний чек<FormulaHint text="Средняя сумма строк по закрытым сделкам с выручкой в выбранном периоде" /></span>}
              value={sales.avgDealAmount}
              formatter={(v) => formatUZS(v as number)}
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        {sales.conversionNewToCompleted !== null && (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false} size="small">
              <Statistic
                title={<span>Конверсия<FormulaHint text="Завершённых сделок ÷ Всего созданных × 100%" /></span>}
                value={(sales.conversionNewToCompleted * 100).toFixed(1)}
                suffix="%"
                prefix={<PercentageOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
        )}
        {sales.cancellationRate !== null && (
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false} size="small">
              <Statistic
                title={<span>Отмены<FormulaHint text="Отменённых сделок ÷ Всего созданных × 100%" /></span>}
                value={(sales.cancellationRate * 100).toFixed(1)}
                suffix="%"
                prefix={<FallOutlined />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
        )}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                Выручка по дням
                <Tooltip title={<div style={{ maxWidth: 360 }}>{TOOLTIP_OPERATIONAL_REVENUE}</div>}>
                  <InfoCircleOutlined style={{ marginLeft: 8, fontSize: 14, opacity: 0.5 }} />
                </Tooltip>
              </span>
            }
            bordered={false}
          >
            <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
              Сумма строк deal_items по сделкам в статусе «Закрыто»; день — по дате строки (или сделки), Ташкент.
            </Typography.Paragraph>
            {revenueDayChartData.length > 0 ? (
              <Line
                data={revenueDayChartData}
                xField="day"
                yField="value"
                height={340}
                shapeField="smooth"
                style={{ lineWidth: 2.5, stroke: '#1677ff' }}
                axis={{
                  y: {
                    labelFormatter: (v: number) => formatUZS(v),
                    labelFill: token.colorTextSecondary,
                    grid: true,
                    gridStroke: token.colorBorderSecondary,
                    gridLineDash: [4, 4],
                  },
                  x: {
                    labelFill: token.colorTextSecondary,
                    labelAutoRotate: false,
                  },
                }}
                tooltip={{
                  items: [{ field: 'value', channel: 'y', valueFormatter: (v: number) => formatUZS(v) }],
                }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Сделки по статусам" bordered={false}>
            {pieData.length > 0 ? (
              <Pie
                data={pieData}
                angleField="value"
                colorField="type"
                innerRadius={0.5}
                height={300}
                scale={{ color: { domain: pieColorDomain, range: pieColorRange } }}
                label={false}
                legend={{ color: { position: 'right', itemLabelFill: token.colorText } }}
                interaction={{ elementHighlight: { background: true } }}
                tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сделок', valueFormatter: (v: number) => `${v}` }] }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                Топ 5 клиентов
                <Tooltip title="Выручка по строкам закрытых сделок за выбранный период (как основной показатель выручки).">
                  <InfoCircleOutlined style={{ marginLeft: 8, fontSize: 14, opacity: 0.5 }} />
                </Tooltip>
              </span>
            }
            bordered={false}
          >
            {clientBarData.length > 0 ? (
              <>
                <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>
                  Выручка по закрытым сделкам (как на графике слева).
                </Typography.Paragraph>
                <Bar
                  data={clientBarData}
                  xField="name"
                  yField="value"
                  height={280}
                  colorField="name"
                  axis={{
                    x: { labelFill: token.colorTextSecondary },
                    y: { labelFormatter: (v: number) => formatUZS(v), labelFill: token.colorTextSecondary },
                  }}
                  tooltip={{ items: [{ field: 'value', channel: 'y', name: LEGEND_OPERATIONAL, valueFormatter: (v: number) => formatUZS(v) }] }}
                  theme={chartTheme}
                  onReady={(plot) => {
                    plot.chart.on('element:click', (evt: { data?: { data?: { clientId?: string } } }) => {
                      const id = evt?.data?.data?.clientId;
                      if (id) navigate(`/clients/${id}`);
                    });
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
                  Нажмите на столбец для перехода к клиенту
                </div>
              </>
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Топ 5 товаров по продажам" bordered={false}>
            {productBarData.length > 0 ? (
              <>
                <Bar
                  data={productBarData}
                  xField="name"
                  yField="value"
                  height={300}
                  colorField="name"
                  axis={{
                    x: { labelFill: token.colorTextSecondary },
                    y: { labelFill: token.colorTextSecondary },
                  }}
                  tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Продано' }] }}
                  theme={chartTheme}
                  onReady={(plot) => {
                    plot.chart.on('element:click', (evt: { data?: { data?: { productId?: string } } }) => {
                      const id = evt?.data?.data?.productId;
                      if (id) navigate(`/inventory/products/${id}`);
                    });
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
                  Нажмите на столбец для перехода к товару
                </div>
              </>
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );

  // ════════════════════════════════════════
  // ──── FINANCE TAB (extended) ────
  // ════════════════════════════════════════

  const methodPieData = (intel?.financial.revenueByMethod ?? []).map((r) => ({
    type: methodLabelMap[r.method] || r.method,
    value: r.total,
  }));

  const financeTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Link to="/finance/debts" style={{ display: 'block' }}>
            <Card bordered={false} hoverable>
              <Statistic
                title={<span>Общий долг<FormulaHint text="Сумма долгов всех клиентов из страницы должников" /></span>}
                value={debtsData?.totals?.totalDebtOwed ?? finance.totalDebt}
                formatter={(v) => formatUZS(v as number)}
                prefix={<WarningOutlined />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Link>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic
              title={<span>Реальный оборот<FormulaHint text="Сумма всех внесённых оплат (payments.amount) за период" /></span>}
              value={finance.realTurnover}
              formatter={(v) => formatUZS(v as number)}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic
              title={<span>Бумажный оборот<FormulaHint text="Сумма amount (суммы) всех закрытых сделок за период" /></span>}
              value={finance.paperTurnover}
              formatter={(v) => formatUZS(v as number)}
              prefix={<StockOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="Просроченные долги" bordered={false}>
            {finance.overdueDebts.length === 0 ? (
              <Typography.Text type="secondary">Нет просроченных долгов</Typography.Text>
            ) : (
              <Table
                dataSource={finance.overdueDebts}
                rowKey="dealId"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/deals/${r.dealId}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Сделка', dataIndex: 'title', render: (v: string, r) => <Link to={`/deals/${r.dealId}`}>{v}</Link> },
                  {
                    title: 'Клиент',
                    key: 'client',
                    render: (_: unknown, r: (typeof finance.overdueDebts)[number]) => (
                      <div onClick={(e) => e.stopPropagation()}>
                        <ClientCompanyDisplay
                          client={{ id: r.clientId, companyName: r.clientName, isSvip: r.clientIsSvip }}
                          link
                        />
                      </div>
                    ),
                  },
                  { title: 'Долг', dataIndex: 'debt', align: 'right' as const, render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{formatUZS(v)}</span> },
                  { title: 'Срок', dataIndex: 'dueDate' },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Топ должники" bordered={false}>
            {finance.topDebtors.length === 0 ? (
              <Typography.Text type="secondary">Нет должников</Typography.Text>
            ) : (
              <Table
                dataSource={finance.topDebtors}
                rowKey="clientId"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/clients/${r.clientId}`), style: { cursor: 'pointer' } })}
                columns={[
                  {
                    title: 'Клиент',
                    key: 'client',
                    render: (_: unknown, r: (typeof finance.topDebtors)[number]) => (
                      <ClientCompanyDisplay
                        client={{ id: r.clientId, companyName: r.companyName, isSvip: r.isSvip }}
                      />
                    ),
                  },
                  { title: 'Общий долг', dataIndex: 'totalDebt', align: 'right' as const, render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{formatUZS(v)}</span> },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* ──── Financial Intelligence extension ──── */}
      {intel && (
        <>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic
                  title={<span>Ср. задержка оплаты<FormulaHint text="Среднее кол-во дней от создания сделки до первого платежа" /></span>}
                  value={intel.financial.avgPaymentDelayDays}
                  precision={1}
                  suffix="дн."
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: intel.financial.avgPaymentDelayDays > 14 ? '#ff4d4f' : '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card bordered={false} size="small">
                <Statistic
                  title={<span>Оплата в срок<FormulaHint text="% сделок с дедлайном, оплаченных до дедлайна" /></span>}
                  value={(intel.financial.onTimePaymentRate * 100).toFixed(1)}
                  suffix="%"
                  prefix={<CheckCircleOutlined />}
                  valueStyle={{ color: intel.financial.onTimePaymentRate >= 0.7 ? '#52c41a' : '#ff4d4f' }}
                />
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24}>
              <Card title="Выручка по способам оплаты" bordered={false}>
                {methodPieData.length > 0 ? (
                  <Pie
                    data={methodPieData}
                    angleField="value"
                    colorField="type"
                    innerRadius={0.5}
                    height={320}
                    label={{
                      text: (d: { type: string; value: number }) => `${d.type}: ${formatUZS(d.value)}`,
                      position: 'outside',
                      style: { fill: token.colorText, fontSize: 12 },
                    }}
                    legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                    tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Сумма', valueFormatter: (v: number) => formatUZS(v) }] }}
                    theme={chartTheme}
                  />
                ) : (
                  <Typography.Text type="secondary">Нет данных</Typography.Text>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );

  // ════════════════════════════════════════
  // ──── CLIENT INTELLIGENCE TAB ────
  // ════════════════════════════════════════

  const clientsIntel = intel?.clients;

  const segmentPieData = (clientsIntel?.segments ?? []).map((s) => ({
    type: segmentLabelMap[s.segment] || s.segment,
    value: s.count,
    color: segmentColorMap[s.segment] || '#8c8c8c',
  }));
  const segPieColorDomain = segmentPieData.map((d) => d.type);
  const segPieColorRange = segmentPieData.map((d) => d.color);

  function riskBadge(score: number) {
    if (score <= 20) return <Badge color="#52c41a" text={`${score}`} />;
    if (score <= 50) return <Badge color="#fa8c16" text={`${score}`} />;
    return <Badge color="#ff4d4f" text={`${score}`} />;
  }

  function segmentTag(seg: string) {
    return <Tag color={segmentColorMap[seg] || 'default'}>{segmentLabelMap[seg] || seg}</Tag>;
  }

  const clientsTab = clientsIntel ? (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic title="Всего клиентов" value={clientsIntel.totalClients} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic title="Повторных клиентов" value={clientsIntel.repeatClients} prefix={<UserSwitchOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Процент повторных<FormulaHint text="Клиентов с 2+ завершёнными сделками ÷ Всего клиентов" /></span>}
              value={(clientsIntel.repeatRate * 100).toFixed(1)}
              suffix="%"
              prefix={<PercentageOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Ср. частота покупок<FormulaHint text="Среднее кол-во дней между сделками для повторных клиентов" /></span>}
              value={clientsIntel.avgFrequencyDays}
              precision={1}
              suffix="дн."
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={10}>
          <Card title="Сегменты клиентов" bordered={false}>
            {segmentPieData.length > 0 ? (
              <Pie
                data={segmentPieData}
                angleField="value"
                colorField="type"
                innerRadius={0.5}
                height={320}
                scale={{ color: { domain: segPieColorDomain, range: segPieColorRange } }}
                label={{
                  text: (d: { type: string; value: number }) => `${d.type}: ${d.value}`,
                  position: 'outside',
                  style: { fill: token.colorText, fontSize: 12 },
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Клиентов', valueFormatter: (v: number) => `${v}` }] }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="Топ клиенты по LTV" bordered={false}>
            <Table
              dataSource={clientsIntel.topByLTV}
              rowKey="clientId"
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
              onRow={(r) => ({ onClick: () => navigate(`/clients/${r.clientId}`), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: 'Компания',
                  key: 'company',
                  render: (_: unknown, r: ClientLTVRow) => (
                    <ClientCompanyDisplay
                      client={{ id: r.clientId, companyName: r.companyName, isSvip: r.isSvip }}
                    />
                  ),
                },
                { title: 'LTV', dataIndex: 'ltv', align: 'right' as const, render: (v: number) => formatUZS(v), sorter: (a: ClientLTVRow, b: ClientLTVRow) => a.ltv - b.ltv },
                { title: 'Сделок', dataIndex: 'dealsCount', align: 'center' as const, width: 80 },
                { title: 'Ср. чек', dataIndex: 'avgDealAmount', align: 'right' as const, render: (v: number) => formatUZS(v), width: 120 },
                { title: 'Риск', dataIndex: 'riskScore', width: 70, align: 'center' as const, render: (v: number) => riskBadge(v), sorter: (a: ClientLTVRow, b: ClientLTVRow) => a.riskScore - b.riskScore },
                { title: 'Сегмент', dataIndex: 'segment', width: 120, render: (v: string) => segmentTag(v) },
                { title: 'Посл. сделка', dataIndex: 'lastDealDate', width: 110 },
              ]}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
              Нажмите на строку для перехода к клиенту
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  ) : (
    <Spin style={{ display: 'block', margin: '60px auto' }} />
  );

  // ════════════════════════════════════════
  // ──── PRODUCT INTELLIGENCE TAB ────
  // ════════════════════════════════════════

  const productsIntel = intel?.products;

  const stabilityBarData = (productsIntel?.demandStability ?? []).map((r) => ({
    name: r.name,
    value: r.avgMonthlySales,
    cv: r.coefficient,
    productId: r.productId,
  }));

  const seasonalityData = (productsIntel?.seasonality ?? []).flatMap((r) => [
    {
      month: MONTH_SHORT[r.month - 1] || `${r.month}`,
      value: r.totalQuantity,
      type: 'Количество' as const,
    },
    {
      month: MONTH_SHORT[r.month - 1] || `${r.month}`,
      value: r.totalRevenue,
      type: 'Выручка' as const,
    },
  ]);

  const productsTab = productsIntel ? (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<span>Кросс-продажи<FormulaHint text="Товары, которые чаще всего покупаются вместе в одной сделке" /></span>} bordered={false}>
            {productsIntel.crossSellPairs.length === 0 ? (
              <Typography.Text type="secondary">Нет данных о совместных покупках</Typography.Text>
            ) : (
              <Table
                dataSource={productsIntel.crossSellPairs}
                rowKey={(r: CrossSellPair) => `${r.product1Id}-${r.product2Id}`}
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'Товар 1', dataIndex: 'product1Name',
                    render: (v: string, r: CrossSellPair) => <Link to={`/inventory/products/${r.product1Id}`}>{v}</Link>,
                  },
                  {
                    title: 'Товар 2', dataIndex: 'product2Name',
                    render: (v: string, r: CrossSellPair) => <Link to={`/inventory/products/${r.product2Id}`}>{v}</Link>,
                  },
                  {
                    title: 'Совм. продаж', dataIndex: 'coOccurrences', width: 120, align: 'center' as const,
                    sorter: (a: CrossSellPair, b: CrossSellPair) => a.coOccurrences - b.coOccurrences,
                  },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span>Стабильность спроса<FormulaHint text="Товары с наиболее равномерными ежемесячными продажами (низкий коэффициент вариации)" /></span>} bordered={false}>
            {stabilityBarData.length > 0 ? (
              <>
                <Bar
                  data={stabilityBarData}
                  xField="name"
                  yField="value"
                  height={340}
                  colorField="name"
                  axis={{
                    x: { labelFill: token.colorTextSecondary },
                    y: { labelFill: token.colorTextSecondary, title: 'Ср. в месяц' },
                  }}
                  tooltip={{
                    items: [
                      { field: 'value', channel: 'y', name: 'Ср. в месяц', valueFormatter: (v: number) => `${v.toFixed(1)}` },
                    ],
                  }}
                  theme={chartTheme}
                  onReady={(plot) => {
                    plot.chart.on('element:click', (evt: { data?: { data?: { productId?: string } } }) => {
                      const id = evt?.data?.data?.productId;
                      if (id) navigate(`/inventory/products/${id}`);
                    });
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
                  Нажмите на столбец для перехода к товару
                </div>
                <Table
                  dataSource={productsIntel.demandStability}
                  rowKey="productId"
                  size="small"
                  pagination={false}
                  style={{ marginTop: 12 }}
                  columns={[
                    { title: 'Товар', dataIndex: 'name' },
                    { title: 'Ср./мес.', dataIndex: 'avgMonthlySales', align: 'right' as const, render: (v: number) => v.toFixed(1) },
                    {
                      title: <span>CV<FormulaHint text="Коэффициент вариации. Чем ниже, тем стабильнее спрос" /></span>,
                      dataIndex: 'coefficient', align: 'right' as const, width: 80,
                      render: (v: number) => <span style={{ color: v < 0.5 ? '#52c41a' : v < 1 ? '#fa8c16' : '#ff4d4f' }}>{v.toFixed(2)}</span>,
                      sorter: (a: DemandStabilityRow, b: DemandStabilityRow) => a.coefficient - b.coefficient,
                    },
                  ]}
                />
              </>
            ) : (
              <Typography.Text type="secondary">Недостаточно данных (нужно 3+ месяцев продаж)</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title={<span>Сезонность продаж<FormulaHint text="Суммарное количество и выручка по месяцам за последние 12 месяцев" /></span>} bordered={false}>
            {seasonalityData.length > 0 ? (
              <Area
                data={seasonalityData}
                xField="month"
                yField="value"
                colorField="type"
                height={300}
                shapeField="smooth"
                axis={{
                  y: {
                    labelFill: token.colorTextSecondary,
                    grid: true,
                    gridStroke: token.colorBorderSecondary,
                    gridLineDash: [4, 4],
                  },
                  x: { labelFill: token.colorTextSecondary },
                }}
                tooltip={{
                  items: [
                    { field: 'value', channel: 'y', name: 'Значение', valueFormatter: (v: number) => v > 10000 ? formatUZS(v) : `${v}` },
                  ],
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  ) : (
    <Spin style={{ display: 'block', margin: '60px auto' }} />
  );

  const productHierarchyTab = (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={16}>
        <Card
          title="Иерархия товаров"
          bordered={false}
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(91,141,184,0.14) 0%, rgba(20,20,20,0.95) 35%)'
              : 'linear-gradient(180deg, rgba(222,240,255,0.9) 0%, rgba(255,255,255,1) 38%)',
          }}
        >
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Выбирайте элементы слева и сравнивайте, что действительно продается лучше
          </Typography.Text>

          <Row gutter={[12, 12]} style={{ marginBottom: 8 }}>
            <Col xs={12} md={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Выбрано" value={comparisonItems.length} suffix="поз." valueStyle={{ color: '#1677ff', fontSize: 18 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Сделки" value={selectedSalesSummary.dealCount} valueStyle={{ color: '#13a8a8', fontSize: 18 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Продано" value={selectedSalesSummary.soldQty} formatter={(v) => Number(v).toLocaleString('ru-RU')} valueStyle={{ color: '#389e0d', fontSize: 18 }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Statistic title="Выручка" value={selectedSalesSummary.revenue} formatter={(v) => formatUZS(v as number)} valueStyle={{ color: '#d46b08', fontSize: 18 }} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small" title="1. Категории">
                {categories.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет категорий" />
                ) : (
                  <List
                    size="small"
                    dataSource={categories}
                    renderItem={(item) => {
                      const key = compareKey('category', item.name);
                      const sales = aggregateSalesForProducts(item.products, productSalesMap);
                      const compareItem: HierarchyCompareItem = {
                        id: item.name,
                        key,
                        level: 'category',
                        label: item.name,
                        category: item.name,
                        salesDeals: sales.salesDeals,
                        soldQty: sales.soldQty,
                        salesRevenue: sales.salesRevenue,
                        avgDealRevenue: sales.avgDealRevenue,
                        avgUnitPrice: sales.avgUnitPrice,
                        lastSaleAt: sales.lastSaleAt,
                      };

                      return (
                        <List.Item
                          onClick={() => {
                            setActiveCategory(item.name);
                            setActiveType(null);
                          }}
                          style={{
                            cursor: 'pointer',
                            background: activeCategory === item.name
                              ? (isDark ? 'rgba(22,119,255,0.18)' : 'rgba(22,119,255,0.12)')
                              : 'transparent',
                            borderRadius: 8,
                            paddingInline: 10,
                          }}
                          actions={[
                            <Checkbox
                              key={key}
                              checked={isSelected(key)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleComparison(compareItem)}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            title={item.name}
                            description={`Сделок: ${sales.salesDeals} • Выручка: ${formatUZS(sales.salesRevenue)}`}
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            </Col>

            <Col xs={24} md={8}>
              <Card size="small" title={`2. Типы${activeCategory ? `: ${activeCategory}` : ''}`}>
                {!activeCategory || typeSummaries.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Выберите категорию" />
                ) : (
                  <List
                    size="small"
                    dataSource={typeSummaries}
                    renderItem={(item) => {
                      const id = `${item.category}|${item.name}`;
                      const key = compareKey('type', id);
                      const sales = aggregateSalesForProducts(item.products, productSalesMap);
                      const compareItem: HierarchyCompareItem = {
                        id,
                        key,
                        level: 'type',
                        label: item.name,
                        category: item.category,
                        typeLabel: item.name,
                        salesDeals: sales.salesDeals,
                        soldQty: sales.soldQty,
                        salesRevenue: sales.salesRevenue,
                        avgDealRevenue: sales.avgDealRevenue,
                        avgUnitPrice: sales.avgUnitPrice,
                        lastSaleAt: sales.lastSaleAt,
                      };

                      return (
                        <List.Item
                          onClick={() => setActiveType(item.name)}
                          style={{
                            cursor: 'pointer',
                            background: activeType === item.name
                              ? (isDark ? 'rgba(19,194,194,0.2)' : 'rgba(19,194,194,0.12)')
                              : 'transparent',
                            borderRadius: 8,
                            paddingInline: 10,
                          }}
                          actions={[
                            <Checkbox
                              key={key}
                              checked={isSelected(key)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleComparison(compareItem)}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            title={item.name}
                            description={`Сделок: ${sales.salesDeals} • Продано: ${sales.soldQty.toLocaleString('ru-RU')}`}
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            </Col>

            <Col xs={24} md={8}>
              <Card size="small" title={`3. Товары${activeType ? `: ${activeType}` : ''}`}>
                {!activeType || productsOnLevel.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Выберите тип" />
                ) : (
                  <List
                    size="small"
                    dataSource={productsOnLevel}
                    renderItem={(item) => {
                      const key = compareKey('product', item.id);
                      const sales = aggregateSalesForProducts([item], productSalesMap);
                      const compareItem: HierarchyCompareItem = {
                        id: item.id,
                        key,
                        level: 'product',
                        label: item.name,
                        category: activeCategory || 'Без категории',
                        typeLabel: activeType,
                        salesDeals: sales.salesDeals,
                        soldQty: sales.soldQty,
                        salesRevenue: sales.salesRevenue,
                        avgDealRevenue: sales.avgDealRevenue,
                        avgUnitPrice: sales.avgUnitPrice,
                        lastSaleAt: sales.lastSaleAt,
                        format: item.format || '',
                        sku: item.sku,
                        unit: item.unit,
                      };

                      return (
                        <List.Item
                          onClick={() => setActiveProductId(item.id)}
                          style={{ borderRadius: 8, paddingInline: 10 }}
                          actions={[
                            <Checkbox
                              key={key}
                              checked={isSelected(key)}
                              onChange={() => toggleComparison(compareItem)}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            title={item.name}
                            description={`Продано: ${sales.soldQty.toLocaleString('ru-RU')} • Выручка: ${formatUZS(sales.salesRevenue)}`}
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </Card>
      </Col>

      <Col xs={24} xl={8}>
        <Card
          title="Сравнение"
          bordered={false}
          style={{
            position: 'sticky',
            top: 12,
            boxShadow: isDark ? '0 12px 28px rgba(0,0,0,0.35)' : '0 12px 28px rgba(0,0,0,0.08)',
            borderRadius: 12,
          }}
          extra={comparisonItems.length > 0 ? <Button type="link" onClick={() => setComparisonMap({})}>Очистить</Button> : null}
        >
          {salesLoading ? (
            <Spin style={{ display: 'block', margin: '20px auto' }} />
          ) : comparisonItems.length === 0 ? (
            <Typography.Text type="secondary">Выбирайте категории, типы или товары слева для сравнения</Typography.Text>
          ) : (
            <>
              <Card
                size="small"
                style={{
                  marginBottom: 12,
                  borderRadius: 10,
                  background: isDark
                    ? 'linear-gradient(135deg, rgba(56,158,13,0.2) 0%, rgba(19,194,194,0.12) 100%)'
                    : 'linear-gradient(135deg, rgba(246,255,237,1) 0%, rgba(230,255,251,1) 100%)',
                }}
              >
                <Row gutter={[8, 8]}>
                  <Col span={24}>
                    <Typography.Text strong>Итог по выбранным</Typography.Text>
                  </Col>
                  <Col span={24}>
                    <Typography.Text>Выручка: </Typography.Text>
                    <Typography.Text strong style={{ color: '#389e0d' }}>{formatUZS(selectedSalesSummary.revenue)}</Typography.Text>
                  </Col>
                  <Col span={24}>
                    <Typography.Text>Ср. чек: </Typography.Text>
                    <Typography.Text strong>{formatUZS(selectedSalesSummary.avgDeal)}</Typography.Text>
                  </Col>
                  <Col span={24}>
                    <Typography.Text>Последняя продажа: </Typography.Text>
                    <Typography.Text strong>{selectedSalesSummary.lastSale ? new Date(selectedSalesSummary.lastSale).toLocaleDateString('ru-RU') : '—'}</Typography.Text>
                  </Col>
                </Row>
              </Card>

              <List
                size="small"
                dataSource={comparisonItems}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button key={item.key} type="link" size="small" onClick={() => toggleComparison(item)}>
                        Убрать
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span>{item.label}</span>
                          <Tag color={item.level === 'category' ? 'blue' : item.level === 'type' ? 'gold' : 'green'}>
                            {item.level === 'category' ? 'Категория' : item.level === 'type' ? 'Тип' : 'Товар'}
                          </Tag>
                        </div>
                      }
                      description={item.level === 'product' ? `${item.category} / ${item.typeLabel || 'Без типа'}` : item.category}
                    />
                  </List.Item>
                )}
              />

              {(['category', 'type', 'product'] as const).map((level) => {
                const items = comparisonByLevel[level];
                if (items.length < 2) return null;

                const rows = buildComparisonRows(level, items);
                const columns = [
                  { title: 'Метрика', dataIndex: 'metric', key: 'metric', width: 140 },
                  ...items.map((item) => ({
                    title: item.label,
                    dataIndex: item.key,
                    key: item.key,
                    width: 130,
                  })),
                ];

                return (
                  <Card
                    key={level}
                    size="small"
                    title={level === 'category' ? 'Категории vs Категории' : level === 'type' ? 'Типы vs Типы' : 'Товары vs Товары'}
                    style={{ marginTop: 12 }}
                  >
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={rows}
                      columns={columns}
                      rowKey="metric"
                      scroll={{ x: 'max-content' }}
                    />
                  </Card>
                );
              })}
              {(['category', 'type', 'product'] as const).map((level) => {
                const items = comparisonByLevel[level];
                if (items.length < 2) return null;

                const lvlLabel = level === 'category' ? 'Категории' : level === 'type' ? 'Типы' : 'Товары';

                // Prepare chart data
                const revenueChartData = items.map((item) => ({
                  name: item.label,
                  value: item.salesRevenue,
                })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);

                const qtyChartData = items.map((item) => ({
                  name: item.label,
                  value: item.soldQty,
                })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);

                const priceChartData = items.map((item) => ({
                  name: item.label,
                  value: item.avgUnitPrice,
                })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);

                const rows = buildComparisonRows(level, items);
                const columns = [
                  { title: 'Метрика', dataIndex: 'metric', key: 'metric', width: 140 },
                  ...items.map((item) => ({
                    title: item.label,
                    dataIndex: item.key,
                    key: item.key,
                    width: 130,
                  })),
                ];

                return (
                  <div key={level}>
                    <Card
                      size="small"
                      title={`📊 ${lvlLabel} — Выручка`}
                      style={{ marginTop: 12, borderRadius: 10 }}
                    >
                      {revenueChartData.length > 0 ? (
                        <Bar
                          data={revenueChartData}
                          xField="name"
                          yField="value"
                          height={220}
                          colorField="name"
                          axis={{
                            x: { label: false },
                            y: { labelFill: token.colorTextSecondary },
                          }}
                          tooltip={{
                            formatter: (datum: any) => {
                              return { name: datum.name, value: formatUZS(datum.value) };
                            },
                          }}
                          theme={chartTheme}
                        />
                      ) : (
                        <Typography.Text type="secondary">Нет данных</Typography.Text>
                      )}
                    </Card>

                    <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                      <Col xs={24} md={12}>
                        <Card size="small" title={`📦 Продаж (шт.)`} style={{ borderRadius: 10 }}>
                          {qtyChartData.length > 0 ? (
                            <Bar
                              data={qtyChartData}
                              xField="name"
                              yField="value"
                              height={200}
                              colorField="name"
                              axis={{
                                x: { label: false },
                                y: { labelFill: token.colorTextSecondary },
                              }}
                              tooltip={{
                                formatter: (datum: any) => {
                                  return { name: datum.name, value: datum.value.toLocaleString('ru-RU') };
                                },
                              }}
                              theme={chartTheme}
                            />
                          ) : (
                            <Typography.Text type="secondary">Нет данных</Typography.Text>
                          )}
                        </Card>
                      </Col>
                      <Col xs={24} md={12}>
                        <Card size="small" title={`💰 Средняя цена за ед.`} style={{ borderRadius: 10 }}>
                          {priceChartData.length > 0 ? (
                            <Bar
                              data={priceChartData}
                              xField="name"
                              yField="value"
                              height={200}
                              colorField="name"
                              axis={{
                                x: { label: false },
                                y: { labelFill: token.colorTextSecondary },
                              }}
                              tooltip={{
                                formatter: (datum: any) => {
                                  return { name: datum.name, value: formatUZS(datum.value) };
                                },
                              }}
                              theme={chartTheme}
                            />
                          ) : (
                            <Typography.Text type="secondary">Нет данных</Typography.Text>
                          )}
                        </Card>
                      </Col>
                    </Row>

                    <Card
                      size="small"
                      title={`🎯 ${lvlLabel} — Таблица сравнения`}
                      style={{ marginTop: 12, borderRadius: 10 }}
                    >
                      <Table
                        size="small"
                        pagination={false}
                        dataSource={rows}
                        columns={columns}
                        rowKey="metric"
                        scroll={{ x: 'max-content' }}
                      />
                    </Card>
                  </div>
                );
              })}
            </>
          )}
        </Card>
      </Col>
    </Row>
  );

  // ════════════════════════════════════════
  // ──── WAREHOUSE TAB ────
  // ════════════════════════════════════════

  const warehouseTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic
              title={<span>Замороженный капитал<FormulaHint text="Сумма (stock × purchasePrice) по всем товарам с остатком > 0" /></span>}
              value={warehouse.frozenCapital}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic title="Ниже минимума" value={warehouse.belowMinStock.length} valueStyle={{ color: warehouse.belowMinStock.length > 0 ? '#ff4d4f' : '#52c41a' }} suffix="товаров" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card bordered={false}>
            <Statistic title="Мёртвый остаток" value={warehouse.deadStock.length} valueStyle={{ color: warehouse.deadStock.length > 0 ? '#fa8c16' : '#52c41a' }} suffix="товаров" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={<span>Ниже минимального остатка<FormulaHint text="Товары где stock < minStock" /></span>} bordered={false}>
            {warehouse.belowMinStock.length === 0 ? (
              <Typography.Text type="secondary">Все товары в норме</Typography.Text>
            ) : (
              <Table
                dataSource={warehouse.belowMinStock}
                rowKey="id"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Товар', dataIndex: 'name' },
                  { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Остаток', dataIndex: 'stock', align: 'right' as const, render: (v: number) => <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{v}</span> },
                  { title: 'Минимум', dataIndex: 'minStock', align: 'right' as const },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span>Мёртвый остаток (&gt;30 дней)<FormulaHint text="Товары с остатком > 0, последний расход более 30 дней назад" /></span>} bordered={false}>
            {warehouse.deadStock.length === 0 ? (
              <Typography.Text type="secondary">Нет мёртвого остатка</Typography.Text>
            ) : (
              <Table
                dataSource={warehouse.deadStock}
                rowKey="id"
                pagination={false}
                size="small"
                onRow={(r) => ({ onClick: () => navigate(`/inventory/products/${r.id}`), style: { cursor: 'pointer' } })}
                columns={[
                  { title: 'Товар', dataIndex: 'name' },
                  { title: 'Артикул', dataIndex: 'sku', render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'Остаток', dataIndex: 'stock', align: 'right' as const },
                  { title: 'Посл. списание', dataIndex: 'lastOutDate', render: (v: string | null) => v || 'Никогда' },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="Топ продаваемых товаров" bordered={false} style={{ marginTop: 16 }}>
        {topSellingBarData.length > 0 ? (
          <>
            <Bar
              data={topSellingBarData}
              xField="name"
              yField="value"
              height={300}
              colorField="name"
              axis={{
                x: { labelFill: token.colorTextSecondary },
                y: { labelFill: token.colorTextSecondary },
              }}
              tooltip={{ items: [{ field: 'value', channel: 'y', name: 'Продано' }] }}
              theme={chartTheme}
              onReady={(plot) => {
                plot.chart.on('element:click', (evt: { data?: { data?: { productId?: string } } }) => {
                  const id = evt?.data?.data?.productId;
                  if (id) navigate(`/inventory/products/${id}`);
                });
              }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
              Нажмите на столбец для перехода к товару
            </div>
          </>
        ) : (
          <Typography.Text type="secondary">Нет данных</Typography.Text>
        )}
      </Card>
    </div>
  );

  // ════════════════════════════════════════
  // ──── MANAGERS TAB (extended) ────
  // ════════════════════════════════════════

  const managerRows = intel?.managers.rows ?? managers.rows.map((m) => ({
    ...m,
    uniqueClients: 0,
    repeatClients: 0,
    retentionRate: 0,
  }));

  const managersTab = (
    <Card bordered={false}>
      <Table
        dataSource={managerRows}
        rowKey="managerId"
        pagination={false}
        size="middle"
        scroll={{ x: 900 }}
        columns={[
          { title: 'Менеджер', dataIndex: 'fullName', fixed: 'left' as const, width: 160 },
          { title: 'Завершённых', dataIndex: 'completedCount', align: 'right' as const, width: 100 },
          { title: 'Общая сумма', dataIndex: 'totalRevenue', align: 'right' as const, render: (v: number) => formatUZS(v), width: 130 },
          {
            title: <span>Средний чек<FormulaHint text="Общая сумма ÷ Кол-во завершённых сделок" /></span>,
            dataIndex: 'avgDealAmount',
            align: 'right' as const,
            render: (v: number) => formatUZS(v),
            width: 120,
          },
          {
            title: <span>Конверсия<FormulaHint text="Завершённых ÷ Всего созданных × 100%" /></span>,
            dataIndex: 'conversionRate',
            align: 'right' as const,
            width: 100,
            render: (v: number) => {
              const pct = v * 100;
              return <span style={{ color: pct >= 50 ? '#52c41a' : pct >= 25 ? '#fa8c16' : '#ff4d4f' }}>{pct.toFixed(1)}%</span>;
            },
          },
          {
            title: <span>Ср. время<FormulaHint text="Среднее кол-во дней от создания до закрытия сделки" /></span>,
            dataIndex: 'avgDealDays',
            align: 'right' as const,
            width: 90,
            render: (v: number) => `${v.toFixed(1)} дн.`,
          },
          {
            title: <span>Уник. кл.<FormulaHint text="Количество уникальных клиентов с завершёнными сделками" /></span>,
            dataIndex: 'uniqueClients',
            align: 'right' as const,
            width: 90,
          },
          {
            title: <span>Повт. кл.<FormulaHint text="Клиенты с 2+ завершёнными сделками у этого менеджера" /></span>,
            dataIndex: 'repeatClients',
            align: 'right' as const,
            width: 90,
          },
          {
            title: <span>Удержание<FormulaHint text="Повторных клиентов ÷ Уникальных клиентов × 100%" /></span>,
            dataIndex: 'retentionRate',
            align: 'right' as const,
            width: 100,
            render: (v: number) => {
              const pct = v * 100;
              return <span style={{ color: pct >= 30 ? '#52c41a' : pct >= 15 ? '#fa8c16' : '#ff4d4f', fontWeight: 600 }}>{pct.toFixed(1)}%</span>;
            },
          },
        ]}
        locale={{ emptyText: 'Нет данных по менеджерам' }}
      />
    </Card>
  );

  // ════════════════════════════════════════
  // ──── PROFITABILITY TAB ────
  // ════════════════════════════════════════

  const expensePieData = (profitability?.expensesByCategory ?? []).map((e) => ({
    type: e.category,
    value: e.total,
  }));

  const grossMargin = profitability?.revenue ? ((profitability.grossProfit / profitability.revenue) * 100) : 0;
  const netMargin = profitability?.revenue ? ((profitability.netProfit / profitability.revenue) * 100) : 0;

  const profitabilityTab = (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Выручка<FormulaHint text="Сумма оплат по закрытым сделкам" /></span>}
              value={profitability?.revenue ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Себестоимость<FormulaHint text="Сумма (purchasePrice × qty) по проданным товарам" /></span>}
              value={profitability?.cogs ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Вал. прибыль<FormulaHint text="Выручка − Себестоимость" /></span>}
              value={profitability?.grossProfit ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Расходы<FormulaHint text="Сумма всех расходов из раздела Расходы" /></span>}
              value={profitability?.expenses ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Чистая прибыль<FormulaHint text="Валовая прибыль − Расходы" /></span>}
              value={profitability?.netProfit ?? 0}
              formatter={(v) => formatUZS(v as number)}
              valueStyle={{ color: (profitability?.netProfit ?? 0) >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card bordered={false} size="small">
            <Statistic
              title={<span>Маржа<FormulaHint text="Чистая прибыль ÷ Выручка × 100%" /></span>}
              value={netMargin}
              precision={1}
              suffix="%"
              valueStyle={{ color: netMargin >= 0 ? '#52c41a' : '#ff4d4f' }}
            />
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
              Валовая: {grossMargin.toFixed(1)}%
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card title="Расходы по категориям" bordered={false}>
            {expensePieData.length > 0 ? (
              <Pie
                data={expensePieData}
                angleField="value"
                colorField="type"
                innerRadius={0.5}
                height={360}
                label={{
                  text: (d: { type: string; value: number }) => `${d.type}: ${formatUZS(d.value)}`,
                  position: 'outside',
                  style: { fill: token.colorText, fontSize: 12 },
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: token.colorText } }}
                tooltip={{
                  items: [
                    {
                      field: 'value',
                      channel: 'y',
                      name: 'Сумма',
                      valueFormatter: (v: number) => formatUZS(v),
                    },
                  ],
                }}
                theme={chartTheme}
              />
            ) : (
              <Typography.Text type="secondary">Нет данных</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );

  const abcXyzAbcBorder = (abc: string) =>
    abc === 'A' ? '#52c41a' : abc === 'B' ? '#faad14' : '#ff4d4f';

  const abcXyzColumns = (entity: 'product' | 'client') => [
    {
      title: 'Название',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (v: string, r: AbcXyzRow) =>
        entity === 'product' ? (
          <Link to={`/inventory/products/${r.entityId}`}>{v}</Link>
        ) : (
          <Link to={`/clients/${r.entityId}`}>{v}</Link>
        ),
    },
    {
      title: 'Выручка',
      dataIndex: 'revenue',
      key: 'revenue',
      align: 'right' as const,
      render: (v: number) => formatUZS(v),
    },
    {
      title: 'Доля, %',
      dataIndex: 'sharePercent',
      key: 'sharePercent',
      align: 'right' as const,
      render: (v: number) => (typeof v === 'number' ? v.toFixed(2) : '—'),
    },
    {
      title: 'Накопл. %',
      dataIndex: 'cumulativeSharePercent',
      key: 'cumulativeSharePercent',
      align: 'right' as const,
      render: (v: number) => (typeof v === 'number' ? v.toFixed(2) : '—'),
    },
    {
      title: 'ABC',
      dataIndex: 'abc',
      key: 'abc',
      width: 76,
      render: (v: string) => <Tag color={ABC_TAG_COLORS[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: 'XYZ',
      dataIndex: 'xyz',
      key: 'xyz',
      width: 88,
      render: (v: string) => (
        <Tag color={xyzTagColor(v)} style={xyzTagStyle(v)}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Класс',
      dataIndex: 'combined',
      key: 'combined',
      width: 100,
      render: (_: string, r: AbcXyzRow) => {
        const c = abcXyzAbcBorder(r.abc);
        return (
          <Tag bordered style={{ borderColor: c, color: c, background: token.colorBgContainer, ...xyzTagStyle(r.xyz) }}>
            {r.combined}
          </Tag>
        );
      },
    },
    {
      title: 'Рекомендация',
      key: 'recommendation',
      width: 352,
      render: (_: unknown, r: AbcXyzRow) => <AbcXyzRecommendationCell recommendation={r.recommendation} />,
    },
  ];

  const abcXyzTab = (
    <div>
      <Typography.Paragraph type="secondary">
        <strong>ABC:</strong> выручка по строкам закрытых сделок за период; накопленная доля — A до 80%, B до 95%, C остальное.
        <br />
        <strong>XYZ:</strong> по месячной выручке за 12 мес.: CV = σ/μ; X при CV ≤ 0,1; Y ≤ 0,25; Z выше. Меньше 3 месяцев с продажами —{' '}
        <Tag color="processing" style={{ margin: 0 }}>
          NEW
        </Tag>
        , не Z.
        <br />
        <strong>Порядок строк:</strong> по важности класса (AX → AY → AZ → ANEW → BX → …), затем по выручке.
      </Typography.Paragraph>
      {abcXyzLoading || !abcXyz ? (
        <Spin size="large" style={{ display: 'block', margin: '48px auto' }} />
      ) : (
        <>
          <style>{`
            .analytics-abc-xyz-table .ant-table-tbody > tr > td:last-child {
              padding-right: 20px;
            }
          `}</style>
          <Card size="small" bordered={false} style={{ marginBottom: 16 }} bodyStyle={{ paddingBottom: 12 }}>
            <Space wrap align="center">
              <Typography.Text type="secondary">Фильтры</Typography.Text>
              <Select
                allowClear
                placeholder="ABC"
                style={{ width: 96 }}
                value={abcXyzFilterAbc}
                onChange={(v) => setAbcXyzFilterAbc(v)}
                options={[
                  { value: 'A', label: 'A' },
                  { value: 'B', label: 'B' },
                  { value: 'C', label: 'C' },
                ]}
              />
              <Select
                allowClear
                placeholder="XYZ"
                style={{ width: 108 }}
                value={abcXyzFilterXyz}
                onChange={(v) => setAbcXyzFilterXyz(v)}
                options={[
                  { value: 'X', label: 'X' },
                  { value: 'Y', label: 'Y' },
                  { value: 'Z', label: 'Z' },
                  { value: 'NEW', label: 'NEW' },
                ]}
              />
              <Select
                allowClear
                placeholder="Класс (AX…)"
                style={{ minWidth: 140 }}
                value={abcXyzFilterCombined}
                onChange={(v) => setAbcXyzFilterCombined(v)}
                options={abcXyzCombinedSelectOptions}
              />
            </Space>
          </Card>
          <Card
            title="Товары"
            style={{ marginBottom: 16 }}
            bordered={false}
            styles={{ body: { paddingLeft: 12, paddingRight: 24 } }}
          >
            <Table
              className="analytics-abc-xyz-table"
              components={abcXyzTableComponents}
              columns={abcXyzColumns('product')}
              dataSource={abcXyzSortedProducts}
              rowKey="entityId"
              pagination={{ pageSize: 15, showSizeChanger: true }}
              scroll={{ x: 1280 }}
              size="small"
            />
          </Card>
          <Card title="Клиенты" bordered={false} styles={{ body: { paddingLeft: 12, paddingRight: 24 } }}>
            <Table
              className="analytics-abc-xyz-table"
              components={abcXyzTableComponents}
              columns={abcXyzColumns('client')}
              dataSource={abcXyzSortedClients}
              rowKey="entityId"
              pagination={{ pageSize: 15, showSizeChanger: true }}
              scroll={{ x: 1280 }}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );

  const hierarchyClientsTab = (
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
            optionFilterProp="label"
          />

          {(clientScopeLevel === 'type' || clientScopeLevel === 'product') && (
            <Select
              placeholder="Тип"
              style={{ minWidth: 230 }}
              value={clientScopeType || undefined}
              onChange={(v) => setClientScopeType(v)}
              options={typeOptionsForClients}
              showSearch
              optionFilterProp="label"
            />
          )}

          {clientScopeLevel === 'product' && (
            <Select
              placeholder="Товар"
              style={{ minWidth: 260 }}
              value={clientScopeProductId || undefined}
              onChange={(v) => setClientScopeProductId(v)}
              options={productOptionsForClients}
              showSearch
              optionFilterProp="label"
            />
          )}
        </Space>

        {hierarchyClientLoading ? (
          <Spin style={{ display: 'block', margin: '16px auto' }} />
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
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
                        formatter: (datum: { name: string; value: number }) => ({ name: datum.name, value: formatUZS(datum.value) }),
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

            <Table
              size="small"
              rowKey="clientId"
              pagination={false}
              dataSource={clientPurchaseSummaryRows}
              locale={{ emptyText: 'Нет покупок по выбранному фильтру' }}
              columns={[
                {
                  title: 'Клиент',
                  dataIndex: 'clientName',
                  key: 'clientName',
                  render: (v: string, r: { clientId: string; clientIsSvip: boolean }) => (
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
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Аналитика</Typography.Title>
        <Segmented
          options={periodOptions}
          value={period}
          onChange={(v) => setPeriod(v as AnalyticsPeriod)}
        />
      </div>

      <Tabs
        defaultActiveKey="sales"
        items={[
          { key: 'sales', label: 'Продажи', children: salesTab },
          { key: 'abc-xyz', label: 'ABC / XYZ', children: abcXyzTab },
          { key: 'finance', label: 'Финансы', children: financeTab },
          { key: 'clients', label: 'Клиенты', icon: <TeamOutlined />, children: clientsTab },
          { key: 'products', label: 'Товары+', icon: <ShoppingOutlined />, children: productsTab },
          { key: 'product-hierarchy', label: 'Иерархия товаров', children: productHierarchyTab },
          { key: 'hierarchy-clients', label: 'Клиенты по иерархии', children: hierarchyClientsTab },
          { key: 'warehouse', label: 'Склад', children: warehouseTab },
          { key: 'managers', label: 'Менеджеры', children: managersTab },
          { key: 'profitability', label: 'Рентабельность', children: profitabilityTab },
        ]}
      />
    </div>
  );
}
