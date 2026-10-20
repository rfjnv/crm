import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, Empty, Row, Segmented, Spin, Statistic, Table, Tag, Tooltip, Typography, theme,
} from 'antd';
import { CloseOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Bar, Column } from '@ant-design/charts';
import { analyticsApi } from '../api/analytics.api';
import { useThemeStore } from '../store/themeStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatShortNumber } from '../utils/currency';
import {
  bestMonth, buildSeries, emptyMonths, forecastYear, seasonalPeakMonth, yearOverYear,
  type ForecastContext, type YearForecast, type YearSeries,
} from '../utils/salesForecast';

const { Text, Paragraph } = Typography;

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Столько категорий на общем графике, остальные — «Прочее». */
const TOP_CATEGORIES = 8;
const OTHER = 'Прочее';
const TOP_PRODUCTS_CHART = 15;

const PALETTE = ['#5B8FF9', '#5AD8A6', '#F6BD16', '#E86452', '#6DC8EC', '#945FB9', '#FF9845', '#1E9493', '#BFBFBF'];
const COLOR_FORECAST = '#FA8C16';

type Metric = 'revenue' | 'qty';

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

function fmtQty(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('ru-RU');
}

function pct(v: number | null): ReactNode {
  if (v == null) return <Text type="secondary">—</Text>;
  const p = Math.round(v * 100);
  return <Text type={p > 0 ? 'success' : p < 0 ? 'danger' : 'secondary'}>{p > 0 ? '+' : ''}{p}%</Text>;
}

function monthName(m: number | null): string {
  return m ? MONTHS_FULL[m - 1] : '—';
}

/** Строка таблицы: категория или товар с цифрами года и прогнозом. */
interface SeriesStats {
  key: string;
  name: string;
  unit?: string;
  total: number;
  qty: number;
  share: number;
  yoy: number | null;
  best: number | null;
  peak: number | null;
  forecast: YearForecast;
}

function statsFor(
  key: string,
  name: string,
  series: YearSeries | undefined,
  qtySeries: YearSeries | undefined,
  grandTotal: number,
  ctx: ForecastContext,
  unit?: string,
): SeriesStats {
  const forecast = forecastYear(series, ctx);
  const total = forecast.actual.reduce((s, v) => s + v, 0);
  return {
    key,
    name,
    unit,
    total,
    qty: (qtySeries?.get(ctx.year) ?? emptyMonths()).reduce((s, v) => s + v, 0),
    share: grandTotal > 0 ? total / grandTotal : 0,
    yoy: yearOverYear(series, ctx),
    best: bestMonth(forecast.actual),
    peak: seasonalPeakMonth(series, ctx),
    forecast,
  };
}

/**
 * Помесячный график одной категории или товара: факт за все годы рядом и прогноз
 * на оставшиеся месяцы текущего года.
 */
function YearsChart({ series, ctx, metric, unit }: {
  series: YearSeries | undefined;
  ctx: ForecastContext;
  metric: Metric;
  unit?: string;
}) {
  const { token } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const years = [...(series?.keys() ?? [])].filter((y) => y <= ctx.year).sort((a, b) => a - b);
  const forecast = forecastYear(series, ctx);
  const fcLabel = `Прогноз ${ctx.year}`;
  const hasForecast = forecast.forecast.some((v) => v != null && v > 0);

  const data = MONTHS.flatMap((month, i) => [
    ...years.map((y) => ({ month, series: String(y), value: series?.get(y)?.[i] ?? 0 })),
    ...(hasForecast ? [{ month, series: fcLabel, value: forecast.forecast[i] ?? 0 }] : []),
  ]);
  if (years.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Продаж не было" />;

  // Прошлые годы — серым (чем ближе, тем темнее), выбранный — основным цветом
  const older = isDark ? ['#8c8c8c', '#595959', '#434343'] : ['#8c8c8c', '#bfbfbf', '#d9d9d9'];
  const domain = [...years.map(String), ...(hasForecast ? [fcLabel] : [])];
  const range = [
    ...years.map((y) => (y === ctx.year ? token.colorPrimary : older[Math.min(older.length - 1, ctx.year - y - 1)])),
    ...(hasForecast ? [COLOR_FORECAST] : []),
  ];
  const valueFmt = (v: number) => (metric === 'revenue' ? fmt(v) : `${fmtQty(v)}${unit ? ` ${unit}` : ''}`);

  return (
    <Column
      data={data}
      xField="month"
      yField="value"
      colorField="series"
      group
      height={280}
      theme={isDark ? 'classicDark' : 'classic'}
      scale={{ color: { domain, range } }}
      style={{
        radiusTopLeft: 3,
        radiusTopRight: 3,
        fillOpacity: (d: { series: string }) => (d.series === fcLabel ? 0.55 : 1),
      }}
      axis={{
        x: { labelFill: token.colorTextSecondary, title: false, tick: false },
        y: {
          labelFill: token.colorTextSecondary,
          title: false,
          grid: true,
          gridStroke: token.colorBorderSecondary,
          gridLineDash: [0, 0],
          labelFormatter: (v: number) => (metric === 'revenue' ? formatShortNumber(v) : fmtQty(v)),
        },
      }}
      legend={{ color: { itemLabelFill: token.colorText, position: 'top' } }}
      tooltip={{ title: 'month', items: [{ field: 'value', channel: 'y', valueFormatter: valueFmt }] }}
      interaction={{ elementHighlightByX: true }}
    />
  );
}

/**
 * Аналитика (история) → «Категории»: что и в каком месяце продаётся лучше всего,
 * с переходом от категории к её товарам и прогнозом по прошлым годам.
 */
export default function HistoryCategoriesPanel({ year }: { year: number }) {
  const { token } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [productMetric, setProductMetric] = useState<Metric>('revenue');

  const now = new Date();
  const ctx: ForecastContext = useMemo(
    () => ({ year, nowYear: now.getFullYear(), nowMonth: now.getMonth() + 1 }),
    // Дата меняется раз в месяц — пересчитывать по ней каждый рендер незачем
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year],
  );
  const isCurrentYear = year === ctx.nowYear;

  const { data: rows, isLoading } = useQuery({
    queryKey: ['analytics-history-categories'],
    queryFn: analyticsApi.getHistoryCategories,
    staleTime: 120_000,
  });
  const { data: productRows, isLoading: productsLoading } = useQuery({
    queryKey: ['analytics-history-category-products', category],
    queryFn: () => analyticsApi.getHistoryCategoryProducts(category!),
    enabled: !!category,
    staleTime: 120_000,
  });

  // ── Категории ──
  const catSeries = useMemo(() => buildSeries(rows ?? [], (r) => r.category, (r) => r.revenue), [rows]);
  const catQty = useMemo(() => buildSeries(rows ?? [], (r) => r.category, (r) => r.qty), [rows]);
  const totalSeries = useMemo(() => buildSeries(rows ?? [], () => 'all', (r) => r.revenue).get('all'), [rows]);
  const totalForecast = useMemo(() => forecastYear(totalSeries, ctx), [totalSeries, ctx]);
  const yearTotal = totalForecast.actual.reduce((s, v) => s + v, 0);

  const categories = useMemo(
    () => [...catSeries.keys()]
      .map((name) => statsFor(name, name, catSeries.get(name), catQty.get(name), yearTotal, ctx))
      .filter((c) => c.total > 0 || (c.forecast.restOfYear > 0))
      .sort((a, b) => b.total - a.total),
    [catSeries, catQty, yearTotal, ctx],
  );
  const chartCategories = categories.slice(0, TOP_CATEGORIES).map((c) => c.name);
  const hasOther = categories.length > TOP_CATEGORIES;

  /** Общий график: факт по категориям стопкой, сверху бледным — сколько ещё ожидается. */
  const stackData = useMemo(() => {
    const top = new Set(chartCategories);
    const out: { month: string; category: string; value: number; kind: 'fact' | 'forecast' }[] = [];
    MONTHS.forEach((month, i) => {
      const fact = new Map<string, number>();
      const expected = new Map<string, number>();
      for (const c of categories) {
        const key = top.has(c.name) ? c.name : OTHER;
        fact.set(key, (fact.get(key) ?? 0) + c.forecast.actual[i]);
        const f = c.forecast.forecast[i];
        if (f != null) expected.set(key, (expected.get(key) ?? 0) + Math.max(0, f - c.forecast.actual[i]));
      }
      for (const key of [...chartCategories, ...(hasOther ? [OTHER] : [])]) {
        out.push({ month, category: key, value: fact.get(key) ?? 0, kind: 'fact' });
        const e = expected.get(key) ?? 0;
        if (e > 0) out.push({ month, category: key, value: e, kind: 'forecast' });
      }
    });
    return out;
  }, [categories, chartCategories, hasOther]);

  /** Какая категория была первой в каждом месяце выбранного года. */
  const leaders = useMemo(() => MONTHS.map((_, i) => {
    let best: SeriesStats | null = null;
    for (const c of categories) {
      if (c.forecast.actual[i] > 0 && (!best || c.forecast.actual[i] > best.forecast.actual[i])) best = c;
    }
    return best ? { name: best.name, value: best.forecast.actual[i] } : null;
  }), [categories]);

  const selectCategory = (name: string | null) => {
    if (name === OTHER) return;
    setCategory(name);
    setProductId(null);
  };

  // ── Товары выбранной категории ──
  const prodSeries = useMemo(() => buildSeries(productRows ?? [], (r) => r.productId, (r) => r.revenue), [productRows]);
  const prodQty = useMemo(() => buildSeries(productRows ?? [], (r) => r.productId, (r) => r.qty), [productRows]);
  const productMeta = useMemo(() => {
    const m = new Map<string, { name: string; unit: string }>();
    for (const r of productRows ?? []) m.set(r.productId, { name: r.name, unit: r.unit });
    return m;
  }, [productRows]);
  const selectedCategory = categories.find((c) => c.name === category) ?? null;

  const products = useMemo(() => {
    const catTotal = selectedCategory?.total ?? 0;
    return [...productMeta.entries()]
      .map(([id, meta]) => statsFor(id, meta.name, prodSeries.get(id), prodQty.get(id), catTotal, ctx, meta.unit))
      .filter((p) => p.total > 0 || p.forecast.restOfYear > 0)
      .sort((a, b) => b.total - a.total);
  }, [productMeta, prodSeries, prodQty, selectedCategory, ctx]);
  const selectedProduct = products.find((p) => p.key === productId) ?? null;

  const productBarData = products
    .filter((p) => (productMetric === 'revenue' ? p.total : p.qty) > 0)
    .sort((a, b) => (productMetric === 'revenue' ? b.total - a.total : b.qty - a.qty))
    .slice(0, TOP_PRODUCTS_CHART)
    .map((p) => ({ id: p.key, name: p.name, value: productMetric === 'revenue' ? p.total : p.qty, unit: p.unit ?? '' }));

  if (isLoading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
  if (!rows || rows.length === 0) return <Empty description="Продаж пока нет" />;

  const chartTheme = isDark ? 'classicDark' : 'classic';
  const colorDomain = [...chartCategories, ...(hasOther ? [OTHER] : [])];
  const prevYearTotal = (totalSeries?.get(year - 1) ?? emptyMonths()).reduce((s, v) => s + v, 0);

  const statsColumns = (kind: 'category' | 'product') => [
    {
      title: kind === 'category' ? 'Категория' : 'Товар',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (v: string, r: SeriesStats) => (
        <Text strong={kind === 'category' ? r.name === category : r.key === productId}>{v}</Text>
      ),
    },
    {
      title: 'Выручка',
      dataIndex: 'total',
      key: 'total',
      width: 140,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => a.total - b.total,
      render: (v: number) => fmt(v),
    },
    ...(kind === 'product' ? [{
      title: 'Кол-во',
      dataIndex: 'qty',
      key: 'qty',
      width: 120,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => a.qty - b.qty,
      render: (v: number, r: SeriesStats) => `${fmtQty(v)} ${r.unit ?? ''}`,
    }] : []),
    {
      title: 'Доля',
      dataIndex: 'share',
      key: 'share',
      width: 80,
      align: 'right' as const,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: <Tooltip title={isCurrentYear ? 'За закрытые месяцы этого года против тех же месяцев прошлого' : 'Год к прошлому году'}>К {year - 1}</Tooltip>,
      dataIndex: 'yoy',
      key: 'yoy',
      width: 90,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => (a.yoy ?? -Infinity) - (b.yoy ?? -Infinity),
      render: (v: number | null) => pct(v),
    },
    {
      title: `Лучший месяц ${year}`,
      dataIndex: 'best',
      key: 'best',
      width: 130,
      render: (v: number | null) => monthName(v),
    },
    {
      title: <Tooltip title="Месяц, в котором это в среднем продаётся больше всего за все годы">Пик сезона</Tooltip>,
      dataIndex: 'peak',
      key: 'peak',
      width: 110,
      render: (v: number | null) => (v ? <Tag color="gold">{monthName(v)}</Tag> : '—'),
    },
    ...(isCurrentYear ? [{
      title: <Tooltip title="Сколько ещё ожидается продать до конца года по прошлым годам с поправкой на темп этого года">Ещё до конца года</Tooltip>,
      key: 'rest',
      width: 150,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => a.forecast.restOfYear - b.forecast.restOfYear,
      render: (_: unknown, r: SeriesStats) => (
        r.forecast.basedOnYears.length
          ? <Text style={{ color: COLOR_FORECAST }}>≈ {fmt(r.forecast.restOfYear)}</Text>
          : <Tooltip title="В прошлые годы не продавалось — прогнозировать не по чему"><Text type="secondary">нет истории</Text></Tooltip>
      ),
    }] : []),
  ];

  const nextMonthIdx = ctx.nowMonth; // индекс следующего месяца (0-based)
  const nextMonthForecast = isCurrentYear && nextMonthIdx < 12 ? totalForecast.forecast[nextMonthIdx] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={`Выручка ${year}`} value={fmt(yearTotal)} />
            {prevYearTotal > 0 && !isCurrentYear && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {year - 1}: {fmt(prevYearTotal)} ({pct(yearTotal / prevYearTotal - 1)})
              </Text>
            )}
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Категорий продавалось" value={categories.filter((c) => c.total > 0).length} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              лидер: {categories[0]?.name ?? '—'}
            </Text>
          </Card>
        </Col>
        {isCurrentYear && totalForecast.basedOnYears.length > 0 && (
          <>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title={(
                    <span>
                      Ожидается до конца года{' '}
                      <Tooltip title={`Среднее по ${totalForecast.basedOnYears.join(', ')} по каждому месяцу × темп этого года${totalForecast.trend != null ? ` (${totalForecast.trend.toFixed(2)})` : ''}. Это ориентир, а не обещание.`}>
                        <InfoCircleOutlined style={{ fontSize: 12, opacity: 0.6 }} />
                      </Tooltip>
                    </span>
                  )}
                  value={`≈ ${fmt(totalForecast.restOfYear)}`}
                  styles={{ content: { color: COLOR_FORECAST } }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  итого за год ≈ {fmt(yearTotal + totalForecast.restOfYear)}
                </Text>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Темп года к прошлым"
                  value={totalForecast.trend != null ? `${totalForecast.trend >= 1 ? '+' : ''}${Math.round((totalForecast.trend - 1) * 100)}%` : '—'}
                  styles={{ content: { color: totalForecast.trend == null ? undefined : totalForecast.trend >= 1 ? token.colorSuccess : token.colorError } }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {nextMonthForecast != null ? `${MONTHS_FULL[nextMonthIdx]}: ≈ ${fmt(nextMonthForecast)}` : 'по закрытым месяцам'}
                </Text>
              </Card>
            </Col>
          </>
        )}
      </Row>

      <Card size="small" title={`Что продаётся по месяцам — ${year}`}>
        <Paragraph type="secondary" style={{ marginTop: 0, fontSize: 12 }}>
          Выручка строк сделок по категориям товаров (как в «Выручке по месяцам»).
          {isCurrentYear && totalForecast.basedOnYears.length > 0 && ' Бледная часть столбца — сколько ещё ожидается по прошлым годам.'}
          {' '}Нажмите на категорию в столбце или в таблице ниже, чтобы открыть её товары.
        </Paragraph>
        <Column
          data={stackData}
          xField="month"
          yField="value"
          colorField="category"
          stack
          height={isMobile ? 280 : 360}
          theme={chartTheme}
          scale={{ color: { domain: colorDomain, range: PALETTE.slice(0, colorDomain.length) } }}
          style={{
            inset: 1,
            fillOpacity: (d: { kind: string }) => (d.kind === 'forecast' ? 0.3 : 1),
            cursor: 'pointer',
          }}
          axis={{
            x: { labelFill: token.colorTextSecondary, title: false, tick: false },
            y: {
              labelFill: token.colorTextSecondary,
              title: false,
              grid: true,
              gridStroke: token.colorBorderSecondary,
              gridLineDash: [0, 0],
              labelFormatter: (v: number) => formatShortNumber(v),
            },
          }}
          legend={{ color: { itemLabelFill: token.colorText, position: 'top' } }}
          tooltip={{
            title: 'month',
            items: [(d: { category: string; value: number; kind: string }) => ({
              name: d.kind === 'forecast' ? `${d.category} — ещё ожидается` : d.category,
              value: fmt(d.value),
            })],
          }}
          onReady={({ chart }) => {
            chart.on('element:click', (ev: { data?: { data?: { category?: string } } }) => {
              const name = ev?.data?.data?.category;
              if (name) selectCategory(name);
            });
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>Лидер месяца:</Text>
          {leaders.map((l, i) => l && (
            <Tooltip key={i} title={`${MONTHS_FULL[i]}: ${l.name} — ${fmt(l.value)}`}>
              <Tag style={{ cursor: 'pointer', margin: 0 }} onClick={() => selectCategory(l.name)}>
                <b>{MONTHS[i]}</b> {l.name}
              </Tag>
            </Tooltip>
          ))}
        </div>
      </Card>

      <Card size="small" title="Категории">
        <Table<SeriesStats>
          rowKey="key"
          size="small"
          dataSource={categories}
          columns={statsColumns('category')}
          pagination={false}
          scroll={{ x: 900 }}
          onRow={(r) => ({
            onClick: () => selectCategory(r.name === category ? null : r.name),
            style: { cursor: 'pointer', background: r.name === category ? token.colorPrimaryBg : undefined },
          })}
        />
      </Card>

      {category && (
        <Card
          size="small"
          title={<span>Категория: <b>{category}</b></span>}
          extra={<Button size="small" type="text" icon={<CloseOutlined />} onClick={() => selectCategory(null)} />}
          styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}
        >
          <div>
            <Text strong>По месяцам и годам</Text>
            <YearsChart series={catSeries.get(category)} ctx={ctx} metric="revenue" />
          </div>

          {productsLoading ? <Spin style={{ display: 'block', margin: '24px auto' }} /> : (
            <>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text strong>Товары категории — {year}</Text>
                  <Segmented
                    size="small"
                    value={productMetric}
                    onChange={(v) => setProductMetric(v as Metric)}
                    options={[{ label: 'Выручка', value: 'revenue' }, { label: 'Количество', value: 'qty' }]}
                  />
                </div>
                {productBarData.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`В ${year} не продавались`} />
                ) : (
                  <Bar
                    data={productBarData}
                    xField="name"
                    yField="value"
                    height={Math.max(160, productBarData.length * 30 + 40)}
                    theme={chartTheme}
                    style={{
                      radiusTopRight: 3,
                      radiusBottomRight: 3,
                      fill: (d: { id: string }) => (d.id === productId ? COLOR_FORECAST : token.colorPrimary),
                      cursor: 'pointer',
                    }}
                    axis={{
                      x: { labelFill: token.colorText, title: false, tick: false },
                      y: {
                        labelFill: token.colorTextSecondary,
                        title: false,
                        grid: true,
                        gridStroke: token.colorBorderSecondary,
                        gridLineDash: [0, 0],
                        labelAutoRotate: false,
                        labelAutoHide: true,
                        labelFormatter: (v: number) => (productMetric === 'revenue' ? formatShortNumber(v) : fmtQty(v)),
                      },
                    }}
                    tooltip={{
                      title: 'name',
                      items: [(d: { value: number; unit: string }) => ({
                        name: productMetric === 'revenue' ? 'Выручка' : 'Количество',
                        value: productMetric === 'revenue' ? fmt(d.value) : `${fmtQty(d.value)} ${d.unit}`,
                      })],
                    }}
                    onReady={({ chart }) => {
                      chart.on('element:click', (ev: { data?: { data?: { id?: string } } }) => {
                        const id = ev?.data?.data?.id;
                        if (id) setProductId(id);
                      });
                    }}
                  />
                )}
                {products.length > TOP_PRODUCTS_CHART && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    На графике топ-{TOP_PRODUCTS_CHART}, все {products.length} — в таблице ниже.
                  </Text>
                )}
              </div>

              {selectedProduct && (
                <Alert
                  type="info"
                  showIcon={false}
                  closable
                  onClose={() => setProductId(null)}
                  title={(
                    <div>
                      <Text strong>{selectedProduct.name}</Text>
                      <Text type="secondary">
                        {' '}· {fmt(selectedProduct.total)} · {fmtQty(selectedProduct.qty)} {selectedProduct.unit}
                        {selectedProduct.peak ? ` · пик сезона: ${monthName(selectedProduct.peak)}` : ''}
                      </Text>
                      <YearsChart
                        series={(productMetric === 'revenue' ? prodSeries : prodQty).get(selectedProduct.key)}
                        ctx={ctx}
                        metric={productMetric}
                        unit={selectedProduct.unit}
                      />
                    </div>
                  )}
                />
              )}

              <Table<SeriesStats>
                rowKey="key"
                size="small"
                dataSource={products}
                columns={statsColumns('product')}
                pagination={products.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
                scroll={{ x: 1000 }}
                onRow={(r) => ({
                  onClick: () => setProductId(r.key === productId ? null : r.key),
                  style: { cursor: 'pointer', background: r.key === productId ? token.colorPrimaryBg : undefined },
                })}
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
