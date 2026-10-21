import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Empty, Segmented, Select, Spin, Table, Tooltip, Typography } from 'antd';
import { BarChartOutlined, LineChartOutlined, PieChartOutlined } from '@ant-design/icons';
import { Column, Line, Pie } from '@ant-design/charts';
import { analyticsApi } from '../api/analytics.api';
import { useThemeStore } from '../store/themeStore';
import { useIsMobile } from '../hooks/useIsMobile';
import { glassPalette } from '../theme/glassPalette';
import { formatMoneyCompact, formatPercent, formatUZS } from '../utils/currency';
import { smartFilterOption } from '../utils/translit';
import { findOutlierCap, shortenNames, truncateLabel } from '../utils/chartShaping';
import {
  bestMonth, buildSeries, emptyMonths, forecastYear, seasonalPeakMonth, yearOverYear,
  type ForecastContext, type YearForecast, type YearSeries,
} from '../utils/salesForecast';
import Section from './ui/Section';
import StatTile, { StatGrid } from './ui/StatTile';
import Money from './ui/Money';
import StatusPill from './ui/StatusPill';
import './HistoryCategoriesPanel.css';

const { Text } = Typography;

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Столько категорий / товаров на графике, остальные — «Прочее». */
const TOP_ON_CHART = 8;
const OTHER = 'Прочее';
const TOP_PRODUCTS_BAR = 15;

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

/** «12,4 млн» — для осей и подписей. */
function money(v: number): string {
  const m = formatMoneyCompact(v);
  return m.unit ? `${m.text} ${m.unit}` : m.text;
}

function fmtQty(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('ru-RU');
}

function monthName(m: number | null): string {
  return m ? MONTHS_FULL[m - 1] : '—';
}

function deltaPill(v: number | null): ReactNode {
  if (v == null) return <span className="hcat-muted">—</span>;
  const tone = Math.abs(v) < 0.005 ? 'neutral' : v > 0 ? 'positive' : 'negative';
  return <StatusPill tone={tone}>{formatPercent(v * 100, 0, { signed: true })}</StatusPill>;
}

// ── Внешний вид графиков ──

interface ChartLook {
  theme: string;
  series: string[];
  years: (offset: number) => string;
  current: string;
  forecast: string;
  text1: string;
  text2: string;
  text3: string;
  grid: string;
  stroke: string;
}

/** Цвета графиков из палитры нового дизайна (G2 не читает CSS-переменные). */
function useChartLook(): ChartLook {
  const mode = useThemeStore((s) => s.mode);
  const dark = mode === 'dark';
  const p = glassPalette[dark ? 'dark' : 'light'];
  return {
    theme: dark ? 'classicDark' : 'classic',
    series: dark
      ? ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6', '#94a3b8']
      : ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#ea580c', '#db2777', '#64748b'],
    // Прошлые годы — нейтральные, чем старше, тем бледнее
    years: (offset) => {
      const shades = dark
        ? ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.32)', 'rgba(255,255,255,0.2)']
        : ['rgba(28,26,23,0.45)', 'rgba(28,26,23,0.26)', 'rgba(28,26,23,0.14)'];
      return shades[Math.min(shades.length - 1, offset - 1)];
    },
    current: p.accentFill,
    forecast: p.warnFg,
    text1: p.text1,
    text2: p.text2,
    text3: p.text3,
    grid: p.grid,
    stroke: dark ? 'rgba(20,22,25,0.9)' : '#ffffff',
  };
}

function axisFor(look: ChartLook, yFmt: (v: number) => string) {
  return {
    x: { labelFill: look.text2, labelFontSize: 12, title: false, tick: false, line: false, labelAutoRotate: false, labelAutoHide: true },
    y: {
      labelFill: look.text3,
      labelFontSize: 11,
      title: false,
      tick: false,
      line: false,
      grid: true,
      gridStroke: look.grid,
      gridLineDash: [0, 0],
      gridStrokeOpacity: 1,
      tickCount: 4,
      labelFormatter: yFmt,
    },
  };
}

function legendFor(look: ChartLook) {
  return {
    color: {
      position: 'top' as const,
      itemLabelFill: look.text2,
      itemLabelFontSize: 12,
      itemMarker: 'circle',
      itemMarkerSize: 8,
    },
  };
}

interface OutlierInfo {
  cap: number;
  points: { label: string; value: number }[];
  median: number;
}

/** Плашка над графиком: какой месяц обрезан и почему; можно показать как есть. */
function OutlierNote({ info, showFull, onToggle, fmt }: {
  info: OutlierInfo;
  showFull: boolean;
  onToggle: () => void;
  fmt: (v: number) => string;
}) {
  const top = info.points[0];
  const times = info.median > 0 ? Math.round(top.value / info.median) : null;
  return (
    <div className="hcat-outlier">
      <span>
        {info.points.map((p) => `${p.label} — ${fmt(p.value)}`).join(', ')}
        {times && times > 1 ? `: в ${times} раз больше обычного месяца` : ''}.
        {showFull ? ' Остальные месяцы почти не видны.' : ' На графике он обрезан, чтобы были видны остальные месяцы.'}
        {' '}Возможно, разовая крупная сделка или ошибка в данных.
      </span>
      <button type="button" className="hcat-outlier__toggle" onClick={onToggle}>
        {showFull ? 'Обрезать' : 'Показать как есть'}
      </button>
    </div>
  );
}

function outlierInfo(points: { label: string; value: number }[]): OutlierInfo | null {
  const found = findOutlierCap(points.map((p) => p.value));
  if (!found) return null;
  const positive = points.map((p) => p.value).filter((v) => v > 0).sort((a, b) => a - b);
  const median = positive[Math.floor(positive.length / 2)] ?? 0;
  const out = new Set(found.outliers);
  return {
    cap: found.cap,
    median,
    points: points.filter((p) => out.has(p.value)).sort((a, b) => b.value - a.value),
  };
}

/**
 * Кольцо с легендой-списком сбоку: у G2 легенда обрезает длинные названия, а здесь
 * видно полное название, долю и сумму; строка кликабельна так же, как сектор.
 */
function PieWithLegend({ slices, center, fmt, height, onPick }: {
  slices: { key: string; name: string; value: number; color: string }[];
  center: string;
  fmt: (v: number) => string;
  height: number;
  onPick?: (key: string) => void;
}) {
  const look = useChartLook();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const keyByName = new Map(slices.map((x) => [x.name, x.key]));
  return (
    <div className="hcat-pie">
      <div className="hcat-pie__chart">
        <Pie
          data={slices}
          angleField="value"
          colorField="name"
          innerRadius={0.64}
          radius={0.94}
          height={height}
          theme={look.theme}
          scale={{ color: { domain: slices.map((x) => x.name), range: slices.map((x) => x.color) } }}
          legend={false}
          label={{
            text: (d: { value: number }) => (total > 0 && d.value / total >= 0.06 ? `${Math.round((d.value / total) * 100)}%` : ''),
            style: { fontWeight: 600, fontSize: 12, fill: '#fff' },
          }}
          annotations={[{
            type: 'text',
            style: {
              text: center,
              x: '50%',
              y: '50%',
              textAlign: 'center',
              textBaseline: 'middle',
              fontSize: 17,
              fontWeight: 600,
              fill: look.text1,
              lineHeight: 24,
            },
            tooltip: false,
          }]}
          tooltip={{ title: 'name', items: [(d: { value: number }) => ({ name: 'Сумма', value: `${fmt(d.value)} · ${total > 0 ? Math.round((d.value / total) * 100) : 0}%` })] }}
          style={{ cursor: onPick ? 'pointer' : 'default', stroke: look.stroke, lineWidth: 2, radius: 4 }}
          onReady={({ chart }) => {
            if (!onPick) return;
            chart.on('element:click', (ev: { data?: { data?: { name?: string } } }) => {
              const key = ev?.data?.data?.name ? keyByName.get(ev.data.data.name) : undefined;
              if (key && key !== OTHER) onPick(key);
            });
          }}
        />
      </div>
      <div className="hcat-pie__legend">
        {slices.map((x) => {
          const clickable = !!onPick && x.key !== OTHER;
          const body = (
            <>
              <span className="hcat-dot" style={{ background: x.color }} />
              <span className="hcat-pie__name" title={x.name}>{x.name}</span>
              <span className="hcat-pie__pct">{total > 0 ? formatPercent((x.value / total) * 100, x.value / total < 0.1 ? 1 : 0) : '—'}</span>
              <span className="hcat-pie__value">{fmt(x.value)}</span>
            </>
          );
          return clickable ? (
            <button key={x.key} type="button" className="hcat-pie__row hcat-pie__row--link" onClick={() => onPick!(x.key)}>{body}</button>
          ) : (
            <div key={x.key} className="hcat-pie__row">{body}</div>
          );
        })}
      </div>
    </div>
  );
}

/** Элемент графика уровня: категория (на уровне «все») или товар (внутри категории). */
interface ChartItem {
  key: string;
  name: string;
  /** Подпись на графике — может быть короче полного названия. */
  label: string;
  series: YearSeries | undefined;
}

/**
 * Главный график уровня: несколько категорий или товаров по месяцам выбранного года.
 * Столбцы — стопкой с бледным прогнозом, линии — по факту, круговая — доли за год.
 */
function ItemsChart({ items, ctx, type, fmt, onPick, height }: {
  items: ChartItem[];
  ctx: ForecastContext;
  type: ChartType;
  fmt: (v: number) => string;
  onPick: (key: string) => void;
  height: number;
}) {
  const look = useChartLook();
  const [showFull, setShowFull] = useState(false);

  // Топ по году, остальное — «Прочее»
  const prepared = useMemo(() => {
    const withTotals = items.map((it) => {
      const fc = forecastYear(it.series, ctx);
      return { ...it, fc, total: fc.actual.reduce((s, v) => s + v, 0) };
    }).filter((it) => it.total > 0 || it.fc.restOfYear > 0)
      .sort((a, b) => b.total - a.total);
    const top = withTotals.slice(0, TOP_ON_CHART);
    const rest = withTotals.slice(TOP_ON_CHART);
    const groups = top.map((t) => ({ key: t.key, name: t.label, fcs: [t.fc] }));
    if (rest.length) groups.push({ key: OTHER, name: `${OTHER} (${rest.length})`, fcs: rest.map((r) => r.fc) });
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

  if (prepared.length === 0) {
    return <Text type="secondary">В {ctx.year} году продаж не было.</Text>;
  }

  const keyByName = new Map(prepared.map((p) => [p.name, p.key]));
  const domain = prepared.map((p) => p.name);
  const color = { color: { domain, range: look.series.slice(0, domain.length) } };
  const colorOf = (name: string) => look.series[Math.max(0, domain.indexOf(name))];
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
      <PieWithLegend
        slices={prepared.filter((p) => p.total > 0).map((p) => ({ key: p.key, name: p.name, value: p.total, color: colorOf(p.name) }))}
        center={`${money(total)}\nза ${ctx.year}`}
        fmt={money}
        height={height}
        onPick={onPick}
      />
    );
  }

  if (type === 'line') {
    // У текущего года рисуем только прошедшие месяцы — будущие не «падают в ноль»
    const lastMonth = ctx.year === ctx.nowYear ? ctx.nowMonth : 12;
    const raw = prepared.flatMap((p) => MONTHS.slice(0, lastMonth).map((month, i) => ({ month, name: p.name, real: p.actual[i] })));
    const info = outlierInfo(raw.map((r) => ({ label: `${r.month} · ${r.name}`, value: r.real })));
    const cap = info && !showFull ? info.cap : null;
    const data = raw.map((r) => ({ ...r, value: cap != null ? Math.min(r.real, cap) : r.real, clipped: cap != null && r.real > cap }));
    return (
      <>
        {info && <OutlierNote info={info} showFull={showFull} onToggle={() => setShowFull((v) => !v)} fmt={money} />}
        <Line
          data={data}
          xField="month"
          yField="value"
          colorField="name"
          height={height}
          theme={look.theme}
          scale={{ ...color, x: { domain: MONTHS } }}
          shapeField={info ? 'line' : 'smooth'}
          point={{ shapeField: 'circle', sizeField: 3 }}
          style={{ lineWidth: 2.5 }}
          axis={axisFor(look, (v) => money(v))}
          legend={legendFor(look)}
          label={{
            text: (d: { clipped: boolean; real: number }) => (d.clipped ? `↑ ${money(d.real)}` : ''),
            dy: -10,
            style: { fill: look.forecast, fontWeight: 600, fontSize: 11 },
          }}
          tooltip={{
            title: 'month',
            items: [(d: { name: string; real: number }) => ({ name: d.name, value: fmt(d.real) })],
          }}
          onReady={onReady}
        />
      </>
    );
  }

  // Столбцы стопкой: месяц выбросом обрезаем пропорционально, подпись — настоящая сумма
  const totals = MONTHS.map((_, i) => prepared.reduce((s, p) => s + p.actual[i] + p.expected[i], 0));
  const info = outlierInfo(MONTHS.map((_, i) => ({ label: `${MONTHS_FULL[i]} ${ctx.year}`, value: totals[i] })));
  const cap = info && !showFull ? info.cap : null;
  const data = MONTHS.flatMap((month, i) => {
    const k = cap != null && totals[i] > cap ? cap / totals[i] : 1;
    // Сначала весь факт месяца, сверху — ожидаемое: прогноз не перемешивается с фактом
    const rows = [
      ...prepared.map((p) => ({ month, name: p.name, real: p.actual[i], value: p.actual[i] * k, kind: 'fact', clipText: '' })),
      ...prepared.filter((p) => p.expected[i] > 0)
        .map((p) => ({ month, name: p.name, real: p.expected[i], value: p.expected[i] * k, kind: 'forecast', clipText: '' })),
    ];
    if (k < 1) {
      const last = [...rows].reverse().find((r) => r.value > 0);
      if (last) last.clipText = `↑ ${money(totals[i])}`;
    }
    return rows;
  });

  return (
    <>
      {info && <OutlierNote info={info} showFull={showFull} onToggle={() => setShowFull((v) => !v)} fmt={money} />}
      <Column
        data={data}
        xField="month"
        yField="value"
        colorField="name"
        stack
        height={height}
        theme={look.theme}
        scale={{ ...color, x: { paddingInner: 0.38 } }}
        style={{
          maxWidth: 56,
          cursor: 'pointer',
          // Прогноз — «призрак» того же цвета: прозрачная заливка и пунктирный контур
          fillOpacity: (d: { kind: string }) => (d.kind === 'forecast' ? 0.16 : 1),
          stroke: (d: { kind: string; name: string }) => (d.kind === 'forecast' ? colorOf(d.name) : look.stroke),
          lineWidth: (d: { kind: string }) => (d.kind === 'forecast' ? 1.5 : 1),
          lineDash: (d: { kind: string }) => (d.kind === 'forecast' ? [4, 3] : [0, 0]),
        }}
        axis={axisFor(look, (v) => money(v))}
        legend={legendFor(look)}
        label={{
          text: 'clipText',
          position: 'top',
          dy: -8,
          style: { fill: look.forecast, fontWeight: 600, fontSize: 12 },
        }}
        tooltip={{
          title: 'month',
          items: [(d: { name: string; real: number; kind: string }) => ({
            name: d.kind === 'forecast' ? `${d.name} · ещё ожидается` : d.name,
            value: fmt(d.real),
          })],
        }}
        interaction={{ elementHighlightByColor: true }}
        onReady={onReady}
      />
    </>
  );
}

/**
 * Один ряд (категория или товар) по месяцам за все годы и прогноз текущего года.
 * Круговая — как делится выбранный год по месяцам.
 */
function YearsChart({ series, ctx, type, fmt, height = 300 }: {
  series: YearSeries | undefined;
  ctx: ForecastContext;
  type: ChartType;
  fmt: (v: number) => string;
  height?: number;
}) {
  const look = useChartLook();
  const [showFull, setShowFull] = useState(false);
  const years = [...(series?.keys() ?? [])].filter((y) => y <= ctx.year).sort((a, b) => a - b);
  const forecast = forecastYear(series, ctx);
  const fcLabel = `Прогноз ${ctx.year}`;
  const hasForecast = forecast.forecast.some((v) => v != null && v > 0);
  if (years.length === 0) return <Text type="secondary">Продаж не было.</Text>;

  if (type === 'pie') {
    const yearValues = series?.get(ctx.year) ?? emptyMonths();
    const total = yearValues.reduce((s, v) => s + v, 0);
    if (total <= 0) return <Text type="secondary">В {ctx.year} году продаж не было.</Text>;
    // Месяцы по сезонам: зима — синие, весна — зелёные, лето — тёплые, осень — красные
    const seasonColors = ['#3b82f6', '#60a5fa', '#22c55e', '#4ade80', '#14b8a6', '#f59e0b',
      '#f97316', '#eab308', '#ef4444', '#f43f5e', '#b45309', '#2563eb'];
    return (
      <PieWithLegend
        slices={MONTHS_FULL.map((m, i) => ({ key: m, name: m[0].toUpperCase() + m.slice(1), value: yearValues[i], color: seasonColors[i] }))
          .filter((x) => x.value > 0)}
        center={`${fmt(total)}\nза ${ctx.year}`}
        fmt={fmt}
        height={height}
      />
    );
  }

  const domain = [...years.map(String), ...(hasForecast ? [fcLabel] : [])];
  const range = [
    ...years.map((y) => (y === ctx.year ? look.current : look.years(ctx.year - y))),
    ...(hasForecast ? [look.forecast] : []),
  ];
  const lastMonth = ctx.year === ctx.nowYear ? ctx.nowMonth : 12;
  const raw = [
    ...years.flatMap((y) => MONTHS
      .slice(0, type === 'line' && y === ctx.year ? lastMonth : 12)
      .map((month, i) => ({ month, series: String(y), real: series?.get(y)?.[i] ?? 0 }))),
    ...(hasForecast ? MONTHS.flatMap((month, i) => {
      const f = forecast.forecast[i];
      return f == null ? (type === 'line' ? [] : [{ month, series: fcLabel, real: 0 }]) : [{ month, series: fcLabel, real: f }];
    }) : []),
  ];
  const info = outlierInfo(raw.map((r) => ({ label: `${MONTHS_FULL[MONTHS.indexOf(r.month)]} ${r.series}`, value: r.real })));
  const cap = info && !showFull ? info.cap : null;
  const data = raw.map((r) => ({
    ...r,
    value: cap != null ? Math.min(r.real, cap) : r.real,
    clipText: cap != null && r.real > cap ? `↑ ${fmt(r.real)}` : '',
  }));
  const tooltip = {
    title: 'month',
    items: [(d: { series: string; real: number }) => ({ name: d.series, value: fmt(d.real) })],
  };
  const note = info && <OutlierNote info={info} showFull={showFull} onToggle={() => setShowFull((v) => !v)} fmt={fmt} />;
  const clippedLabel = { text: 'clipText', position: 'top' as const, dy: -8, style: { fill: look.forecast, fontWeight: 600, fontSize: 11 } };

  if (type === 'line') {
    return (
      <>
        {note}
        <Line
          data={data}
          xField="month"
          yField="value"
          colorField="series"
          height={height}
          theme={look.theme}
          scale={{ color: { domain, range }, x: { domain: MONTHS } }}
          shapeField={info ? 'line' : 'smooth'}
          point={{ shapeField: 'circle', sizeField: 3 }}
          style={{
            lineWidth: (d: { series: string }[]) => (d[0]?.series === String(ctx.year) ? 3 : 2),
            lineDash: (d: { series: string }[]) => (d[0]?.series === fcLabel ? [6, 4] : [0, 0]),
          }}
          axis={axisFor(look, fmt)}
          legend={legendFor(look)}
          label={clippedLabel}
          tooltip={tooltip}
        />
      </>
    );
  }

  return (
    <>
      {note}
      <Column
        data={data}
        xField="month"
        yField="value"
        colorField="series"
        group
        height={height}
        theme={look.theme}
        scale={{ color: { domain, range }, x: { paddingInner: 0.3 } }}
        style={{
          radiusTopLeft: 4,
          radiusTopRight: 4,
          maxWidth: 18,
          fillOpacity: (d: { series: string }) => (d.series === fcLabel ? 0.75 : 1),
        }}
        axis={axisFor(look, fmt)}
        legend={legendFor(look)}
        label={clippedLabel}
        tooltip={tooltip}
        interaction={{ elementHighlightByX: true }}
      />
    </>
  );
}

/**
 * Рейтинг товаров за год: название, полоса и сумма в своих колонках — длинные
 * названия не наезжают на числа, вся строка кликабельна.
 */
function ProductsBar({ rows, fmt, selectedId, onPick }: {
  rows: { id: string; label: string; name: string; value: number }[];
  fmt: (v: number) => string;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="hcat-rank">
      {rows.map((r, i) => (
        <Tooltip key={r.id} title={r.name !== r.label ? r.name : undefined} placement="topLeft">
          <button
            type="button"
            className={`hcat-rank__row${r.id === selectedId ? ' hcat-rank__row--active' : ''}`}
            onClick={() => onPick(r.id)}
          >
            <span className="hcat-rank__pos">{i + 1}</span>
            <span className="hcat-rank__name">{r.label}</span>
            <span className="hcat-rank__track">
              <span className="hcat-rank__fill" style={{ width: `${max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0}%` }} />
            </span>
            <span className="hcat-rank__value">{fmt(r.value)}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
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
 * Аналитика (история) → «Категории»: что и в каком месяце продаётся лучше всего.
 * Уровни: все категории → товары категории → один товар по годам; тип графика на выбор.
 */
export default function HistoryCategoriesPanel({ year }: { year: number }) {
  const isMobile = useIsMobile();
  const look = useChartLook();
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
      render: (v: number | null) => deltaPill(v),
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
      <Segmented
        value={chartType}
        onChange={(v) => setChartType(v as ChartType)}
        options={[
          { value: 'bar', icon: <BarChartOutlined />, label: isMobile ? undefined : 'Столбцы' },
          { value: 'line', icon: <LineChartOutlined />, label: isMobile ? undefined : 'Линии' },
          { value: 'pie', icon: <PieChartOutlined />, label: isMobile ? undefined : 'Доли' },
        ]}
      />
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
              <Text type="secondary">В {year} году не продавались.</Text>
            ) : (
              <ProductsBar
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
