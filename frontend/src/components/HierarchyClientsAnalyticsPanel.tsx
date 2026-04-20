import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Row, Segmented, Select, Space, Spin, Table, Typography, theme, InputNumber, Button } from 'antd';
import { Bar } from '@ant-design/charts';
import type { Product } from '../types';
import { formatUZS } from '../utils/currency';
import {
  inferTypeLabel,
  safePrice,
  getStartDateByPreset,
  loadSalesContext,
  type HierarchyPeriodPreset,
} from '../lib/analyticsHierarchySales';

type CompareLevel = 'category' | 'type' | 'product';

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
};

/**
 * Блок «Клиенты по иерархии»: период, фильтр категория/тип/товар, графики и таблица клиентов.
 * Используется в аналитике и на странице «Аналитика для менеджеров».
 */
export default function HierarchyClientsAnalyticsPanel({ products }: HierarchyClientsAnalyticsPanelProps) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [clientScopeLevel, setClientScopeLevel] = useState<CompareLevel>('category');
  const [clientScopeCategory, setClientScopeCategory] = useState<string | null>(null);
  const [clientScopeType, setClientScopeType] = useState<string | null>(null);
  const [clientScopeProductId, setClientScopeProductId] = useState<string | null>(null);
  const [hierarchyPeriodPreset, setHierarchyPeriodPreset] = useState<HierarchyPeriodPreset>('month');
  const [hierarchyCustomDays, setHierarchyCustomDays] = useState<number>(30);

  const visibleProducts = useMemo(
    () => products.filter((p: Product) => p.isActive),
    [products],
  );

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of visibleProducts) map.set(p.id, p);
    return map;
  }, [visibleProducts]);

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

  const { data: hierarchyClientContext, isLoading: hierarchyClientLoading } = useQuery({
    queryKey: ['analytics-hierarchy-clients-context', hierarchyPeriodPreset, hierarchyCustomDays],
    queryFn: () => loadSalesContext(getStartDateByPreset(hierarchyPeriodPreset, hierarchyCustomDays)),
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

  const isDark = token.colorBgBase === '#000' || token.colorBgContainer !== '#ffffff';
  const chartTheme = isDark ? 'classicDark' : 'classic';

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
}
