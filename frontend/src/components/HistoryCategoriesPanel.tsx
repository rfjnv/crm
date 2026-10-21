import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Empty, Segmented, Select, Spin, Table, Tooltip } from 'antd';
import { analyticsApi } from '../api/analytics.api';
import { useIsMobile } from '../hooks/useIsMobile';
import { formatPercent, formatUZS } from '../utils/currency';
import { smartFilterOption } from '../utils/translit';
import { shortenNames, truncateLabel } from '../utils/chartShaping';
import {
  bestMonth, buildSeries, emptyMonths, forecastYear, seasonalPeakMonth, yearOverYear,
  type ForecastContext, type YearForecast, type YearSeries,
} from '../utils/salesForecast';
import Section from './ui/Section';
import StatTile, { StatGrid } from './ui/StatTile';
import Money from './ui/Money';
import StatusPill from './ui/StatusPill';
import { ChartTypeSwitch, DeltaPill, ItemsChart, RankList, YearsChart } from './history/historyCharts';
import {
  MONTHS, MONTHS_FULL, TOP_ON_CHART, fmtQty, loadChartType, money, monthName, saveChartType, useChartLook,
  type ChartItem, type ChartType,
} from './history/historyChartUtils';

const TOP_PRODUCTS_BAR = 15;
const CHART_TYPE_KEY = 'historyCategories.chartType';

type Metric = 'revenue' | 'qty';

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
 * Аналитика (история) → «Категории»: что и в каком месяце продаётся лучше всего.
 * Уровни: все категории → товары категории → один товар по годам; тип графика на выбор.
 */
export default function HistoryCategoriesPanel({ year }: { year: number }) {
  const isMobile = useIsMobile();
  const look = useChartLook();
  const [category, setCategory] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [chartType, setChartTypeState] = useState<ChartType>(() => loadChartType(CHART_TYPE_KEY));

  const setChartType = (t: ChartType) => {
    setChartTypeState(t);
    saveChartType(CHART_TYPE_KEY, t);
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
  // «Офсетная пластина СТСР ф: 510*400» → «510*400»: общее начало названий на графиках не нужно
  const shortName = useMemo(
    () => shortenNames([...productMeta.values()].map((m) => m.name)),
    [productMeta],
  );
  const short = (name: string) => shortName.get(name) ?? name;
  const selectedCategory = categories.find((c) => c.name === category) ?? null;

  const products = useMemo(() => {
    const catTotal = selectedCategory?.total ?? 0;
    return [...productMeta.entries()]
      .map(([id, meta]) => statsFor(id, meta.name, prodSeries.get(id), prodQty.get(id), catTotal, ctx, meta.unit))
      .filter((p) => p.total > 0 || p.qty > 0 || p.forecast.restOfYear > 0)
      .sort((a, b) => b.total - a.total);
  }, [productMeta, prodSeries, prodQty, selectedCategory, ctx]);
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

  /** Кто был первым в каждом месяце: категория или товар внутри категории. */
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

  // Количество складывать можно только внутри категории — у разных категорий разные единицы
  const useQty = metric === 'qty' && !!category;
  const unit = selectedProduct?.unit;
  const fmtValue = (v: number) => (useQty ? `${fmtQty(v)}${unit ? ` ${unit}` : ''}` : money(v));
  const fmtFull = (v: number) => (useQty ? `${fmtQty(v)}${unit ? ` ${unit}` : ''}` : formatUZS(v));

  // ── Что сейчас в фокусе: всё / категория / товар ──
  const scope = selectedProduct ?? selectedCategory;
  const scopeForecast = scope ? scope.forecast : totalForecast;
  const scopeTotal = scope ? scope.total : yearTotal;
  const scopeYoy = scope ? scope.yoy : yearOverYear(totalSeries, ctx);
  const levelList = category ? products : categories;
  const seriesColor = new Map(levelList.slice(0, TOP_ON_CHART).map((s, i) => [s.key, look.series[i]]));

  const chartItems: ChartItem[] = category
    ? products.map((p) => ({ key: p.key, name: p.name, label: truncateLabel(short(p.name), 34), series: (useQty ? prodQty : prodSeries).get(p.key) }))
    : categories.map((c) => ({ key: c.key, name: c.name, label: c.name, series: catSeries.get(c.key) }));

  const productBarRows = products
    .filter((p) => (useQty ? p.qty : p.total) > 0)
    .sort((a, b) => (useQty ? b.qty - a.qty : b.total - a.total))
    .slice(0, TOP_PRODUCTS_BAR)
    .map((p) => ({
      id: p.key,
      name: p.name,
      label: truncateLabel(short(p.name), isMobile ? 18 : 30),
      value: useQty ? p.qty : p.total,
      unit: p.unit ?? '',
    }));

  const statsColumns = (kind: 'category' | 'product') => [
    {
      title: kind === 'category' ? 'Категория' : 'Товар',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (v: string, r: SeriesStats) => (
        <span>
          {seriesColor.has(r.key) && <span className="hcat-dot" style={{ background: seriesColor.get(r.key) }} />}
          <Tooltip title={kind === 'product' && short(v) !== v ? v : undefined}>
            <span>{kind === 'product' ? short(v) : v}</span>
          </Tooltip>
        </span>
      ),
    },
    {
      title: 'Выручка',
      dataIndex: 'total',
      key: 'total',
      width: 170,
      align: 'right' as const,
      defaultSortOrder: 'descend' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => a.total - b.total,
      render: (v: number) => (v > 0 ? <Money value={v} /> : <span className="hcat-muted">0</span>),
    },
    ...(kind === 'product' ? [{
      title: 'Кол-во',
      dataIndex: 'qty',
      key: 'qty',
      width: 120,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => a.qty - b.qty,
      render: (v: number, r: SeriesStats) => <span>{fmtQty(v)} <span className="hcat-muted">{r.unit}</span></span>,
    }] : []),
    {
      title: 'Доля',
      dataIndex: 'share',
      key: 'share',
      width: 80,
      align: 'right' as const,
      render: (v: number) => formatPercent(v * 100, v < 0.1 ? 1 : 0),
    },
    {
      title: <Tooltip title={isCurrentYear ? 'За закрытые месяцы этого года против тех же месяцев прошлого' : 'Год к прошлому году'}>К {year - 1}</Tooltip>,
      dataIndex: 'yoy',
      key: 'yoy',
      width: 100,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => (a.yoy ?? -Infinity) - (b.yoy ?? -Infinity),
      render: (v: number | null) => <DeltaPill value={v} />,
    },
    {
      title: `Лучший месяц`,
      dataIndex: 'best',
      key: 'best',
      width: 120,
      render: (v: number | null) => monthName(v),
    },
    {
      title: <Tooltip title="Месяц, в котором это в среднем продаётся больше всего за все годы">Пик сезона</Tooltip>,
      dataIndex: 'peak',
      key: 'peak',
      width: 120,
      render: (v: number | null) => (v ? <StatusPill tone="warning">{monthName(v)}</StatusPill> : <span className="hcat-muted">—</span>),
    },
    ...(isCurrentYear ? [{
      title: <Tooltip title="Сколько ещё ожидается продать до конца года по прошлым годам с поправкой на темп этого года">До конца года</Tooltip>,
      key: 'rest',
      width: 140,
      align: 'right' as const,
      sorter: (a: SeriesStats, b: SeriesStats) => a.forecast.restOfYear - b.forecast.restOfYear,
      render: (_: unknown, r: SeriesStats) => (
        r.forecast.basedOnYears.length
          ? <span className="hcat-forecast" title={formatUZS(r.forecast.restOfYear)}>≈ {money(r.forecast.restOfYear)}</span>
          : <Tooltip title="В прошлые годы не продавалось — прогнозировать не по чему"><span className="hcat-muted">нет истории</span></Tooltip>
      ),
    }] : []),
  ];

  const nextMonthIdx = ctx.nowMonth; // индекс следующего месяца (0-based)
  const nextMonthForecast = isCurrentYear && nextMonthIdx < 12 ? scopeForecast.forecast[nextMonthIdx] : null;
  const chartHeight = isMobile ? 300 : 400;
  const levelWord = category ? 'товары' : 'категории';

  const chartHint = selectedProduct
    ? (chartType === 'pie'
      ? `Как продажи ${year} года делятся по месяцам.`
      : `Каждый год своим цветом${isCurrentYear && scopeForecast.basedOnYears.length ? ', прогноз на оставшиеся месяцы — оранжевым' : ''}.`)
    : chartType === 'pie'
      ? `Доли за ${year} год. Нажмите на сектор, чтобы открыть.`
      : chartType === 'line'
        ? `Каждая линия — ${category ? 'товар' : 'категория'}. Нажмите на линию, чтобы открыть.`
        : `Цвета — ${levelWord}${isCurrentYear ? ', пунктиром — сколько ещё ожидается по прошлым годам' : ''}. Нажмите на цвет, чтобы открыть.`;

  const crumbs = (
    <div className="hcat-crumbs">
      {category ? (
        <button type="button" className="hcat-crumb" onClick={() => selectCategory(null)}>Все категории</button>
      ) : (
        <span className="hcat-crumb hcat-crumb--current">Все категории</span>
      )}
      {category && (
        <>
          <span className="hcat-crumb-sep">/</span>
          {selectedProduct ? (
            <button type="button" className="hcat-crumb" onClick={() => setProductId(null)}>{category}</button>
          ) : (
            <span className="hcat-crumb hcat-crumb--current">{category}</span>
          )}
        </>
      )}
      {selectedProduct && (
        <>
          <span className="hcat-crumb-sep">/</span>
          <span className="hcat-crumb hcat-crumb--current" title={selectedProduct.name}>{short(selectedProduct.name)}</span>
        </>
      )}
    </div>
  );

  const controls = (
    <div className="hcat-controls">
      <Select
        className="hcat-select"
        showSearch
        allowClear
        placeholder="Все категории"
        value={category ?? undefined}
        onChange={(v?: string) => selectCategory(v ?? null)}
        filterOption={smartFilterOption}
        options={categories.map((c) => ({ value: c.key, label: c.name }))}
      />
      <Select
        className="hcat-select hcat-select--product"
        showSearch
        allowClear
        disabled={!category}
        loading={!!category && productsLoading}
        placeholder={category ? 'Все товары категории' : 'Товар — после категории'}
        value={productId ?? undefined}
        onChange={(v?: string) => setProductId(v ?? null)}
        filterOption={smartFilterOption}
        options={productOptions}
        popupMatchSelectWidth={false}
      />
      <ChartTypeSwitch value={chartType} onChange={setChartType} compact={isMobile} />
      {category && (
        <Segmented
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={[{ label: 'Сумма', value: 'revenue' }, { label: 'Штуки', value: 'qty' }]}
        />
      )}
    </div>
  );

  return (
    <div className="hcat">
      <div className="hcat-head">
        <div className="hcat-path">{crumbs}</div>
        {controls}
      </div>

      <Section>
        <StatGrid columns={isMobile ? 2 : 4}>
          <StatTile
            label={`Выручка за ${year}`}
            value={<Money value={scopeTotal} variant="compact" />}
            delta={scopeYoy != null ? scopeYoy * 100 : null}
            base={selectedProduct
              ? `${fmtQty(selectedProduct.qty)} ${selectedProduct.unit ?? ''} · ${formatPercent(selectedProduct.share * 100, 1)} категории`
              : selectedCategory
                ? `${formatPercent(selectedCategory.share * 100, 1)} всех продаж`
                : `к ${year - 1}${isCurrentYear ? ' за закрытые месяцы' : ''}`}
          />
          <StatTile
            label="Пик сезона"
            value={scope?.peak ? monthName(scope.peak) : monthName(seasonalPeakMonth(totalSeries, ctx))}
            base={scope ? `лучший в ${year}: ${monthName(scope.best)}` : `лучший в ${year}: ${monthName(bestMonth(totalForecast.actual))}`}
          />
          {isCurrentYear && scopeForecast.basedOnYears.length > 0 ? (
            <>
              <StatTile
                label={(
                  <Tooltip title={`Среднее по ${scopeForecast.basedOnYears.join(', ')} по каждому месяцу × темп этого года. Ориентир, а не обещание.`}>
                    <span>Ожидается до конца года</span>
                  </Tooltip>
                )}
                value={<span className="hcat-forecast">≈ {money(scopeForecast.restOfYear)}</span>}
                base={`год ≈ ${money(scopeTotal + scopeForecast.restOfYear)}`}
              />
              <StatTile
                label="Темп к прошлым годам"
                value={scopeForecast.trend != null ? formatPercent((scopeForecast.trend - 1) * 100, 0, { signed: true }) : '—'}
                base={nextMonthForecast != null ? `${MONTHS_FULL[nextMonthIdx]}: ≈ ${money(nextMonthForecast)}` : 'по закрытым месяцам'}
              />
            </>
          ) : (
            <>
              <StatTile
                label={category ? 'Товаров продавалось' : 'Категорий продавалось'}
                value={levelList.filter((c) => c.total > 0).length}
                base={levelList[0] ? `лидер: ${category ? short(levelList[0].name) : levelList[0].name}` : undefined}
              />
              <StatTile
                label="Лидер года"
                value={<span title={levelList[0]?.name}>{levelList[0] ? truncateLabel(category ? short(levelList[0].name) : levelList[0].name, 18) : '—'}</span>}
                base={levelList[0] ? `${formatPercent(levelList[0].share * 100, 0)} · ${money(levelList[0].total)}` : undefined}
              />
            </>
          )}
        </StatGrid>
      </Section>

      <Section
        title={selectedProduct ? 'По месяцам и годам' : `${category ? 'Товары' : 'Категории'} по месяцам · ${year}`}
      >
        <div className="hcat-section-hint">{chartHint}</div>
        {category && productsLoading ? <Spin style={{ display: 'block', margin: '80px auto' }} /> : selectedProduct ? (
          <YearsChart
            series={(useQty ? prodQty : prodSeries).get(selectedProduct.key)}
            ctx={ctx}
            type={chartType}
            fmt={fmtValue}
            height={chartHeight}
          />
        ) : (
          <ItemsChart
            items={chartItems}
            ctx={ctx}
            type={chartType}
            fmt={useQty ? fmtQty : fmtFull}
            height={chartHeight}
            onPick={(key) => (category ? setProductId(key) : selectCategory(key))}
          />
        )}
        {!selectedProduct && (
          <>
            <div className="hcat-section-hint" style={{ marginTop: 8 }}>Лидер каждого месяца</div>
            <div className="hcat-leaders">
              {leaders.map((l, i) => (l ? (
                <Tooltip key={i} title={`${l.name} — ${formatUZS(l.value)}`}>
                  <button
                    type="button"
                    className="hcat-leader"
                    onClick={() => (category ? setProductId(l.key) : selectCategory(l.key))}
                  >
                    <span className="hcat-leader__month">
                      {seriesColor.has(l.key) && <span className="hcat-dot" style={{ background: seriesColor.get(l.key) }} />}
                      {MONTHS[i]}
                    </span>
                    <span className="hcat-leader__name">{category ? short(l.name) : l.name}</span>
                    <span className="hcat-leader__value">{money(l.value)}</span>
                  </button>
                </Tooltip>
              ) : (
                <div key={i} className="hcat-leader hcat-leader--empty">
                  <span className="hcat-leader__month">{MONTHS[i]}</span>
                  <span className="hcat-leader__name">—</span>
                  <span className="hcat-leader__value">&nbsp;</span>
                </div>
              )))}
            </div>
          </>
        )}
      </Section>

      {selectedCategory && !selectedProduct && (
        <div className="hcat-split">
          <Section title={`${category} по годам`}>
            <YearsChart
              series={catSeries.get(selectedCategory.key)}
              ctx={ctx}
              type={chartType === 'pie' ? 'bar' : chartType}
              fmt={money}
            />
          </Section>
          <Section
            title={`Товары · ${useQty ? 'количество' : 'выручка'} за ${year}`}
            count={products.length > TOP_PRODUCTS_BAR ? `топ ${TOP_PRODUCTS_BAR} из ${products.length}` : undefined}
          >
            {productBarRows.length === 0 ? (
              <span className="hcat-muted">В {year} году не продавались.</span>
            ) : (
              <RankList
                rows={productBarRows}
                fmt={(v) => (useQty ? fmtQty(v) : money(v))}
                selectedId={productId}
                onPick={setProductId}
              />
            )}
          </Section>
        </div>
      )}

      <Section
        title={category ? `Товары категории` : 'Все категории'}
        count={(category ? products : categories).length}
        extra={<span className="hcat-muted" style={{ fontSize: 12 }}>нажмите на строку, чтобы открыть</span>}
      >
        <Table<SeriesStats>
          className="hcat-table"
          rowKey="key"
          size="middle"
          loading={!!category && productsLoading}
          dataSource={category ? products : categories}
          columns={statsColumns(category ? 'product' : 'category')}
          pagination={(category ? products : categories).length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
          scroll={{ x: category ? 1000 : 900 }}
          rowClassName={(r) => ((category ? r.key === productId : r.key === category) ? 'hcat-row--active' : '')}
          onRow={(r) => ({
            onClick: () => (category
              ? setProductId(r.key === productId ? null : r.key)
              : selectCategory(r.key)),
          })}
        />
      </Section>
    </div>
  );
}
