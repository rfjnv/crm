import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Breadcrumb, Card, Col, Empty, Row, Segmented, Select, Spin, Statistic, Table, Tag, Tooltip, Typography, theme,
} from 'antd';
import { BarChartOutlined, InfoCircleOutlined, LineChartOutlined, PieChartOutlined } from '@ant-design/icons';
import { Bar, Column, Line, Pie } from '@ant-design/charts';
import { analyticsApi } from '../api/analytics.api';
import { useThemeStore } from '../store/themeStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatShortNumber } from '../utils/currency';
import { smartFilterOption } from '../utils/translit';
import {
  bestMonth, buildSeries, emptyMonths, forecastYear, seasonalPeakMonth, yearOverYear,
  type ForecastContext, type YearForecast, type YearSeries,
} from '../utils/salesForecast';

const { Text, Paragraph } = Typography;

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Столько категорий / товаров на графике, остальные — «Прочее». */
const TOP_ON_CHART = 8;
const OTHER = 'Прочее';
const TOP_PRODUCTS_BAR = 15;

const PALETTE = ['#5B8FF9', '#5AD8A6', '#F6BD16', '#E86452', '#6DC8EC', '#945FB9', '#FF9845', '#1E9493', '#BFBFBF'];
const COLOR_FORECAST = '#FA8C16';
/** Месяцы по сезонам: зима — синие, весна — зелёные, лето — оранжевые, осень — красные. */
const MONTH_COLORS = [
  '#2F54EB', '#597EF7', '#389E0D', '#52C41A', '#13A8A8', '#FA8C16',
  '#D46B08', '#D4B106', '#CF1322', '#F5222D', '#AD4E00', '#1D39C4',
];

type Metric = 'revenue' | 'qty';
type ChartType = 'bar' | 'line' | 'pie';

const CHART_TYPE_KEY = 'historyCategories.chartType';

function loadChartType(): ChartType {
  try {
    const v = localStorage.getItem(CHART_TYPE_KEY);
    return v === 'line' || v === 'pie' ? v : 'bar';
  } catch {
    return 'bar';
  }
}

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

/** Элемент графика уровня: категория (на уровне «все») или товар (внутри категории). */
interface ChartItem {
  key: string;
  name: string;
  series: YearSeries | undefined;
}

function useChartBase() {
  const { token } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  return {
    token,
    chartTheme: isDark ? 'classicDark' : 'classic',
    isDark,
    axis: (yFormatter: (v: number) => string) => ({
      x: { labelFill: token.colorTextSecondary, title: false, tick: false },
      y: {
        labelFill: token.colorTextSecondary,
        title: false,
        grid: true,
        gridStroke: token.colorBorderSecondary,
        gridLineDash: [0, 0],
        labelFormatter: yFormatter,
      },
    }),
    legend: { color: { itemLabelFill: token.colorText, position: 'top' as const } },
  };
}

/**
 * Главный график уровня: несколько категорий или товаров по месяцам выбранного года.
 * Столбцы — стопкой с бледным прогнозом, линии — по факту, круговая — доли за год.
 */
function ItemsChart({ items, ctx, type, valueFmt, axisFmt, onPick, height }: {
  items: ChartItem[];
  ctx: ForecastContext;
  type: ChartType;
  valueFmt: (v: number) => string;
  axisFmt: (v: number) => string;
  onPick: (key: string) => void;
  height: number;
}) {
  const base = useChartBase();

  // Топ по году, остальное — «Прочее»
  const prepared = useMemo(() => {
    const withTotals = items.map((it) => {
      const fc = forecastYear(it.series, ctx);
      return { ...it, fc, total: fc.actual.reduce((s, v) => s + v, 0) };
    }).filter((it) => it.total > 0 || it.fc.restOfYear > 0)
      .sort((a, b) => b.total - a.total);
    const top = withTotals.slice(0, TOP_ON_CHART);
    const rest = withTotals.slice(TOP_ON_CHART);
    const groups = top.map((t) => ({ key: t.key, name: t.name, fcs: [t.fc] }));
    if (rest.length) groups.push({ key: OTHER, name: OTHER, fcs: rest.map((r) => r.fc) });
    return groups.map((g) => {
      const actual = emptyMonths();
      const expected = emptyMonths();
      for (const fc of g.fcs) {
        fc.actual.forEach((v, i) => { actual[i] += v; });
        fc.forecast.forEach((f, i) => { if (f != null) expected[i] += Math.max(0, f - fc.actual[i]); });
      }
      return { key: g.key, name: g.name, actual, expected, total: actual.reduce((s, v) => s + v, 0) };
    });
  }, [items, ctx]);

  if (prepared.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`В ${ctx.year} продаж не было`} />;

  const keyByName = new Map(prepared.map((p) => [p.name, p.key]));
  const domain = prepared.map((p) => p.name);
  const color = { color: { domain, range: PALETTE.slice(0, domain.length) } };
  const pick = (name?: string) => {
    const key = name ? keyByName.get(name) : undefined;
    if (key && key !== OTHER) onPick(key);
  };
  const onReady = ({ chart }: { chart: { on: (e: string, cb: (ev: { data?: { data?: { name?: string } } }) => void) => void } }) => {
    chart.on('element:click', (ev) => pick(ev?.data?.data?.name));
  };

  if (type === 'pie') {
    const total = prepared.reduce((s, p) => s + p.total, 0);
    return (
      <Pie
        data={prepared.filter((p) => p.total > 0).map((p) => ({ name: p.name, value: p.total }))}
        angleField="value"
        colorField="name"
        innerRadius={0.55}
        height={height}
        theme={base.chartTheme}
        scale={color}
        legend={{ color: { itemLabelFill: base.token.colorText, position: 'right' as const } }}
        label={{
          text: (d: { value: number }) => (total > 0 && d.value / total >= 0.04 ? `${Math.round((d.value / total) * 100)}%` : ''),
          style: { fontWeight: 600, fill: '#fff' },
        }}
        tooltip={{ title: 'name', items: [{ field: 'value', name: `За ${ctx.year}`, valueFormatter: valueFmt }] }}
        style={{ cursor: 'pointer', stroke: base.isDark ? '#141414' : '#fff', lineWidth: 1 }}
        onReady={onReady}
      />
    );
  }

  if (type === 'line') {
    // У текущего года рисуем только прошедшие месяцы — будущие не «падают в ноль»
    const lastMonth = ctx.year === ctx.nowYear ? ctx.nowMonth : 12;
    const data = prepared.flatMap((p) => MONTHS.slice(0, lastMonth).map((month, i) => ({ month, name: p.name, value: p.actual[i] })));
    return (
      <Line
        data={data}
        xField="month"
        yField="value"
        colorField="name"
        height={height}
        theme={base.chartTheme}
        scale={{ ...color, x: { domain: MONTHS } }}
        shapeField="smooth"
        point={{ shapeField: 'circle', sizeField: 3 }}
        style={{ lineWidth: 2.5 }}
        axis={base.axis(axisFmt)}
        legend={base.legend}
        tooltip={{ title: 'month', items: [{ field: 'value', channel: 'y', valueFormatter: valueFmt }] }}
        onReady={onReady}
      />
    );
  }

  const data = MONTHS.flatMap((month, i) => prepared.flatMap((p) => [
    { month, name: p.name, value: p.actual[i], kind: 'fact' },
    ...(p.expected[i] > 0 ? [{ month, name: p.name, value: p.expected[i], kind: 'forecast' }] : []),
  ]));
  return (
    <Column
      data={data}
      xField="month"
      yField="value"
      colorField="name"
      stack
      height={height}
      theme={base.chartTheme}
      scale={color}
      style={{ inset: 1, cursor: 'pointer', fillOpacity: (d: { kind: string }) => (d.kind === 'forecast' ? 0.3 : 1) }}
      axis={base.axis(axisFmt)}
      legend={base.legend}
      tooltip={{
        title: 'month',
        items: [(d: { name: string; value: number; kind: string }) => ({
          name: d.kind === 'forecast' ? `${d.name} — ещё ожидается` : d.name,
          value: valueFmt(d.value),
        })],
      }}
      onReady={onReady}
    />
  );
}

/**
 * Один ряд (категория или товар) по месяцам за все годы и прогноз текущего года.
 * Круговая — как делится выбранный год по месяцам.
 */
function YearsChart({ series, ctx, type, valueFmt, axisFmt, height = 280 }: {
  series: YearSeries | undefined;
  ctx: ForecastContext;
  type: ChartType;
  valueFmt: (v: number) => string;
  axisFmt: (v: number) => string;
  height?: number;
}) {
  const base = useChartBase();
  const years = [...(series?.keys() ?? [])].filter((y) => y <= ctx.year).sort((a, b) => a - b);
  const forecast = forecastYear(series, ctx);
  const fcLabel = `Прогноз ${ctx.year}`;
  const hasForecast = forecast.forecast.some((v) => v != null && v > 0);
  if (years.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Продаж не было" />;

  if (type === 'pie') {
    const yearValues = series?.get(ctx.year) ?? emptyMonths();
    const total = yearValues.reduce((s, v) => s + v, 0);
    if (total <= 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`В ${ctx.year} продаж не было`} />;
    return (
      <Pie
        data={MONTHS.map((month, i) => ({ month, value: yearValues[i] })).filter((d) => d.value > 0)}
        angleField="value"
        colorField="month"
        innerRadius={0.55}
        height={height}
        theme={base.chartTheme}
        scale={{ color: { domain: MONTHS, range: MONTH_COLORS } }}
        legend={{ color: { itemLabelFill: base.token.colorText, position: 'right' as const } }}
        label={{
          text: (d: { month: string; value: number }) => (d.value / total >= 0.05 ? d.month : ''),
          style: { fontWeight: 600, fill: '#fff' },
        }}
        tooltip={{
          title: 'month',
          items: [(d: { value: number }) => ({
            name: `Доля ${ctx.year}`,
            value: `${valueFmt(d.value)} · ${Math.round((d.value / total) * 100)}%`,
          })],
        }}
        style={{ stroke: base.isDark ? '#141414' : '#fff', lineWidth: 1 }}
      />
    );
  }

  // Прошлые годы — серым (чем ближе, тем темнее), выбранный — основным цветом
  const older = base.isDark ? ['#8c8c8c', '#595959', '#434343'] : ['#8c8c8c', '#bfbfbf', '#d9d9d9'];
  const domain = [...years.map(String), ...(hasForecast ? [fcLabel] : [])];
  const range = [
    ...years.map((y) => (y === ctx.year ? base.token.colorPrimary : older[Math.min(older.length - 1, ctx.year - y - 1)])),
    ...(hasForecast ? [COLOR_FORECAST] : []),
  ];
  const tooltip = { title: 'month', items: [{ field: 'value', channel: 'y', valueFormatter: valueFmt }] };

  if (type === 'line') {
    const lastMonth = ctx.year === ctx.nowYear ? ctx.nowMonth : 12;
    const data = [
      ...years.flatMap((y) => MONTHS
        .slice(0, y === ctx.year ? lastMonth : 12)
        .map((month, i) => ({ month, series: String(y), value: series?.get(y)?.[i] ?? 0 }))),
      // Прогноз продолжает линию года с текущего месяца
      ...(hasForecast ? MONTHS.flatMap((month, i) => {
        const f = forecast.forecast[i];
        return f == null ? [] : [{ month, series: fcLabel, value: f }];
      }) : []),
    ];
    return (
      <Line
        data={data}
        xField="month"
        yField="value"
        colorField="series"
        height={height}
        theme={base.chartTheme}
        scale={{ color: { domain, range }, x: { domain: MONTHS } }}
        shapeField="smooth"
        point={{ shapeField: 'circle', sizeField: 3 }}
        style={{
          lineWidth: (d: { series: string }[]) => (d[0]?.series === String(ctx.year) ? 3 : 2),
          lineDash: (d: { series: string }[]) => (d[0]?.series === fcLabel ? [6, 4] : [0, 0]),
        }}
        axis={base.axis(axisFmt)}
        legend={base.legend}
        tooltip={tooltip}
      />
    );
  }

  const data = MONTHS.flatMap((month, i) => [
    ...years.map((y) => ({ month, series: String(y), value: series?.get(y)?.[i] ?? 0 })),
    ...(hasForecast ? [{ month, series: fcLabel, value: forecast.forecast[i] ?? 0 }] : []),
  ]);
  return (
    <Column
      data={data}
      xField="month"
      yField="value"
      colorField="series"
      group
      height={height}
      theme={base.chartTheme}
      scale={{ color: { domain, range } }}
      style={{
        radiusTopLeft: 3,
        radiusTopRight: 3,
        fillOpacity: (d: { series: string }) => (d.series === fcLabel ? 0.55 : 1),
      }}
      axis={base.axis(axisFmt)}
      legend={base.legend}
      tooltip={tooltip}
      interaction={{ elementHighlightByX: true }}
    />
  );
}

/**
 * Аналитика (история) → «Категории»: что и в каком месяце продаётся лучше всего.
 * Уровни: все категории → товары категории → один товар по годам; тип графика на выбор.
 */
export default function HistoryCategoriesPanel({ year }: { year: number }) {
  const { token } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [chartType, setChartTypeState] = useState<ChartType>(loadChartType);

  const setChartType = (t: ChartType) => {
    setChartTypeState(t);
    try {
      localStorage.setItem(CHART_TYPE_KEY, t);
    } catch {
      // без памяти о выборе — не страшно
    }
  };

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
      .filter((c) => c.total > 0 || c.forecast.restOfYear > 0)
      .sort((a, b) => b.total - a.total),
    [catSeries, catQty, yearTotal, ctx],
  );

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
      .filter((p) => p.total > 0 || p.qty > 0 || p.forecast.restOfYear > 0)
      .sort((a, b) => b.total - a.total);
  }, [productMeta, prodSeries, prodQty, selectedCategory, ctx]);
  // Список для выбора — все товары категории, даже без продаж в этом году
  const productOptions = useMemo(
    () => [...productMeta.entries()]
      .map(([id, meta]) => ({ value: id, label: meta.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [productMeta],
  );
  const selectedProduct = productId
    ? (products.find((p) => p.key === productId)
      ?? (productMeta.has(productId)
        ? statsFor(productId, productMeta.get(productId)!.name, prodSeries.get(productId), prodQty.get(productId), selectedCategory?.total ?? 0, ctx, productMeta.get(productId)!.unit)
        : null))
    : null;

  /** Какая категория (или товар внутри категории) была первой в каждом месяце. */
  const levelStats = category ? products : categories;
  const leaders = useMemo(() => MONTHS.map((_, i) => {
    let best: SeriesStats | null = null;
    for (const c of levelStats) {
      if (c.forecast.actual[i] > 0 && (!best || c.forecast.actual[i] > best.forecast.actual[i])) best = c;
    }
    return best ? { key: best.key, name: best.name, value: best.forecast.actual[i] } : null;
  }), [levelStats]);

  const selectCategory = (name: string | null) => {
    setCategory(name);
    setProductId(null);
    if (!name) setMetric('revenue');
  };

  if (isLoading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
  if (!rows || rows.length === 0) return <Empty description="Продаж пока нет" />;

  const chartTheme = isDark ? 'classicDark' : 'classic';
  // Количество складывать можно только внутри категории — у разных категорий разные единицы
  const useQty = metric === 'qty' && !!category;
  const unit = selectedProduct?.unit;
  const valueFmt = (v: number) => (useQty ? `${fmtQty(v)}${unit ? ` ${unit}` : ''}` : fmt(v));
  const axisFmt = (v: number) => (useQty ? fmtQty(v) : formatShortNumber(v));

  // ── Что сейчас в фокусе: всё / категория / товар ──
  const scope = selectedProduct ?? selectedCategory;
  const scopeSeries = selectedProduct
    ? (useQty ? prodQty : prodSeries).get(selectedProduct.key)
    : selectedCategory
      ? (useQty ? undefined : catSeries.get(selectedCategory.key))
      : totalSeries;
  const scopeForecast = selectedProduct || selectedCategory
    ? (scope?.forecast ?? totalForecast)
    : totalForecast;
  const scopeTotal = scope ? scope.total : yearTotal;
  const scopePrevTotal = ((selectedProduct ? prodSeries.get(selectedProduct.key) : selectedCategory ? catSeries.get(selectedCategory.key) : totalSeries)
    ?.get(year - 1) ?? emptyMonths()).reduce((s, v) => s + v, 0);

  const chartItems: ChartItem[] = category
    ? products.map((p) => ({ key: p.key, name: p.name, series: (useQty ? prodQty : prodSeries).get(p.key) }))
    : categories.map((c) => ({ key: c.key, name: c.name, series: catSeries.get(c.key) }));

  const productBarData = products
    .filter((p) => (useQty ? p.qty : p.total) > 0)
    .sort((a, b) => (useQty ? b.qty - a.qty : b.total - a.total))
    .slice(0, TOP_PRODUCTS_BAR)
    .map((p) => ({ id: p.key, name: p.name, value: useQty ? p.qty : p.total, unit: p.unit ?? '' }));

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
  const nextMonthForecast = isCurrentYear && nextMonthIdx < 12 ? scopeForecast.forecast[nextMonthIdx] : null;
  const chartHeight = isMobile ? 300 : 380;
  const levelTitle = selectedProduct
    ? `${selectedProduct.name} — по месяцам и годам`
    : category
      ? `Товары категории «${category}» по месяцам — ${year}`
      : `Категории по месяцам — ${year}`;

  const toolbar = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Select
        showSearch
        allowClear
        placeholder="Все категории"
        style={{ width: isMobile ? '100%' : 240 }}
        value={category ?? undefined}
        onChange={(v?: string) => selectCategory(v ?? null)}
        filterOption={smartFilterOption}
        options={categories.map((c) => ({ value: c.key, label: c.name }))}
      />
      <Select
        showSearch
        allowClear
        disabled={!category}
        loading={!!category && productsLoading}
        placeholder={category ? 'Все товары категории' : 'Сначала выберите категорию'}
        style={{ width: isMobile ? '100%' : 280 }}
        value={productId ?? undefined}
        onChange={(v?: string) => setProductId(v ?? null)}
        filterOption={smartFilterOption}
        options={productOptions}
      />
      <Segmented
        value={chartType}
        onChange={(v) => setChartType(v as ChartType)}
        options={[
          { value: 'bar', label: <Tooltip title="Столбцы"><BarChartOutlined /> {!isMobile && 'Столбцы'}</Tooltip> },
          { value: 'line', label: <Tooltip title="Линии"><LineChartOutlined /> {!isMobile && 'Линии'}</Tooltip> },
          { value: 'pie', label: <Tooltip title="Круговая"><PieChartOutlined /> {!isMobile && 'Круговая'}</Tooltip> },
        ]}
      />
      {category && (
        <Segmented
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={[{ label: 'Выручка', value: 'revenue' }, { label: 'Количество', value: 'qty' }]}
        />
      )}
    </div>
  );

  const chartHint = selectedProduct
    ? (chartType === 'pie'
      ? `Как продажи ${year} года делятся по месяцам.`
      : `Каждый год — своим цветом${isCurrentYear && scopeForecast.basedOnYears.length ? ', оранжевым — прогноз на оставшиеся месяцы' : ''}.`)
    : chartType === 'pie'
      ? `Доли за ${year} год. Нажмите на сектор, чтобы открыть ${category ? 'товар' : 'категорию'}.`
      : chartType === 'line'
        ? `Каждая линия — ${category ? 'товар' : 'категория'}. Нажмите на линию, чтобы открыть её.`
        : `Столбец — месяц, цвета — ${category ? 'товары' : 'категории'}${isCurrentYear ? '; бледная часть — сколько ещё ожидается по прошлым годам' : ''}. Нажмите на цвет, чтобы открыть.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toolbar}

      <Breadcrumb
        items={[
          { title: <a onClick={() => selectCategory(null)}>Все категории</a> },
          ...(category ? [{ title: selectedProduct ? <a onClick={() => setProductId(null)}>{category}</a> : <b>{category}</b> }] : []),
          ...(selectedProduct ? [{ title: <b>{selectedProduct.name}</b> }] : []),
        ]}
      />

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={`Выручка ${year}`} value={fmt(scopeTotal)} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {selectedProduct
                ? `${fmtQty(selectedProduct.qty)} ${selectedProduct.unit ?? ''}`
                : scopePrevTotal > 0 && !isCurrentYear
                  ? <>{year - 1}: {fmt(scopePrevTotal)} ({pct(scopeTotal / scopePrevTotal - 1)})</>
                  : scope ? `${(scope.share * 100).toFixed(1)}% ${selectedCategory && !selectedProduct ? 'всех продаж' : ''}` : ''}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={category ? 'Товаров продавалось' : 'Категорий продавалось'}
              value={(category ? products : categories).filter((c) => c.total > 0).length}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {scope?.peak ? `пик сезона: ${monthName(scope.peak)}` : `лидер: ${(category ? products : categories)[0]?.name ?? '—'}`}
            </Text>
          </Card>
        </Col>
        {isCurrentYear && scopeForecast.basedOnYears.length > 0 && (
          <>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title={(
                    <span>
                      Ожидается до конца года{' '}
                      <Tooltip title={`Среднее по ${scopeForecast.basedOnYears.join(', ')} по каждому месяцу × темп этого года${scopeForecast.trend != null ? ` (${scopeForecast.trend.toFixed(2)})` : ''}. Это ориентир, а не обещание.`}>
                        <InfoCircleOutlined style={{ fontSize: 12, opacity: 0.6 }} />
                      </Tooltip>
                    </span>
                  )}
                  value={`≈ ${fmt(scopeForecast.restOfYear)}`}
                  styles={{ content: { color: COLOR_FORECAST } }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  итого за год ≈ {fmt(scopeTotal + scopeForecast.restOfYear)}
                </Text>
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Темп года к прошлым"
                  value={scopeForecast.trend != null ? `${scopeForecast.trend >= 1 ? '+' : ''}${Math.round((scopeForecast.trend - 1) * 100)}%` : '—'}
                  styles={{ content: { color: scopeForecast.trend == null ? undefined : scopeForecast.trend >= 1 ? token.colorSuccess : token.colorError } }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {nextMonthForecast != null ? `${MONTHS_FULL[nextMonthIdx]}: ≈ ${fmt(nextMonthForecast)}` : 'по закрытым месяцам'}
                </Text>
              </Card>
            </Col>
          </>
        )}
      </Row>

      <Card size="small" title={levelTitle}>
        <Paragraph type="secondary" style={{ marginTop: 0, fontSize: 12 }}>{chartHint}</Paragraph>
        {category && productsLoading ? <Spin style={{ display: 'block', margin: '60px auto' }} /> : selectedProduct ? (
          <YearsChart
            series={scopeSeries}
            ctx={ctx}
            type={chartType}
            valueFmt={valueFmt}
            axisFmt={axisFmt}
            height={chartHeight}
          />
        ) : (
          <ItemsChart
            items={chartItems}
            ctx={ctx}
            type={chartType}
            valueFmt={useQty ? (v) => fmtQty(v) : fmt}
            axisFmt={axisFmt}
            height={chartHeight}
            onPick={(key) => (category ? setProductId(key) : selectCategory(key))}
          />
        )}
        {!selectedProduct && chartType !== 'pie' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>Лидер месяца:</Text>
            {leaders.map((l, i) => l && (
              <Tooltip key={i} title={`${MONTHS_FULL[i]}: ${l.name} — ${fmt(l.value)}`}>
                <Tag
                  style={{ cursor: 'pointer', margin: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => (category ? setProductId(l.key) : selectCategory(l.key))}
                >
                  <b>{MONTHS[i]}</b> {l.name}
                </Tag>
              </Tooltip>
            ))}
          </div>
        )}
      </Card>

      {selectedCategory && !selectedProduct && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card size="small" title={`«${category}» по месяцам и годам`}>
              <YearsChart
                series={(useQty ? undefined : catSeries.get(selectedCategory.key))}
                ctx={ctx}
                type={chartType === 'pie' ? 'bar' : chartType}
                valueFmt={fmt}
                axisFmt={formatShortNumber}
              />
              {useQty && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  У товаров категории разные единицы — по годам категория показана только в выручке.
                </Text>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card size="small" title={`Товары — ${useQty ? 'количество' : 'выручка'} за ${year}`}>
              {productBarData.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`В ${year} не продавались`} />
              ) : (
                <Bar
                  data={productBarData}
                  xField="name"
                  yField="value"
                  height={Math.max(200, productBarData.length * 28 + 40)}
                  theme={chartTheme}
                  style={{ radiusTopRight: 3, radiusBottomRight: 3, fill: token.colorPrimary, cursor: 'pointer' }}
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
                      labelFormatter: axisFmt,
                    },
                  }}
                  tooltip={{
                    title: 'name',
                    items: [(d: { value: number; unit: string }) => ({
                      name: useQty ? 'Количество' : 'Выручка',
                      value: useQty ? `${fmtQty(d.value)} ${d.unit}` : fmt(d.value),
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
              {products.length > TOP_PRODUCTS_BAR && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Топ-{TOP_PRODUCTS_BAR}, все {products.length} — в таблице ниже.
                </Text>
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Card
        size="small"
        title={category ? `Товары категории «${category}»` : 'Категории'}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>нажмите на строку, чтобы открыть</Text>}
      >
        <Table<SeriesStats>
          rowKey="key"
          size="small"
          loading={!!category && productsLoading}
          dataSource={category ? products : categories}
          columns={statsColumns(category ? 'product' : 'category')}
          pagination={(category ? products : categories).length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
          scroll={{ x: category ? 1000 : 900 }}
          onRow={(r) => ({
            onClick: () => (category
              ? setProductId(r.key === productId ? null : r.key)
              : selectCategory(r.key)),
            style: {
              cursor: 'pointer',
              background: (category ? r.key === productId : r.key === category) ? token.colorPrimaryBg : undefined,
            },
          })}
        />
      </Card>
    </div>
  );
}
