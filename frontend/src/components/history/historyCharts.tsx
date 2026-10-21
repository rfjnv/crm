import { useEffect, useMemo, useRef, useState } from 'react';
import { Segmented, Tooltip, Typography } from 'antd';
import { BarChartOutlined, LineChartOutlined, PieChartOutlined } from '@ant-design/icons';
import { Column, Line, Pie } from '@ant-design/charts';
import { formatPercent } from '../../utils/currency';
import { emptyMonths, forecastYear, type ForecastContext, type YearSeries } from '../../utils/salesForecast';
import {
  MONTHS, MONTHS_FULL, OTHER, TOP_ON_CHART, axisFor, legendFor, money, outlierInfo, useChartLook,
  type ChartItem, type ChartType, type OutlierInfo,
} from './historyChartUtils';
import StatusPill from '../ui/StatusPill';
import './historyCharts.css';

/**
 * Общие графики аналитики истории (вкладки «Категории» и «Клиенты»): палитра нового
 * дизайна, выбросы, кольцо с легендой, ряд по годам с прогнозом, рейтинг.
 */

const { Text } = Typography;

type ChartClickEvent = { data?: { data?: unknown } };
type ChartWithEvents = { on: (e: string, cb: (ev: ChartClickEvent) => void) => void };

/**
 * Строка данных, по которой кликнули. У столбца и сектора G2 отдаёт саму строку,
 * у линии — массив точек всей линии.
 */
function clickedRow(ev: ChartClickEvent): Record<string, unknown> | undefined {
  const d = ev?.data?.data;
  const row = Array.isArray(d) ? d[0] : d;
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : undefined;
}

/**
 * G2 вызывает onReady один раз, а данные и обработчики меняются (перешли в категорию —
 * клик должен открывать уже товар). Подписываемся на ref с последней версией функции.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Легенда-кнопки над графиком. У G2 клик по легенде прячет серию — люди ждут, что
 * он откроет категорию; здесь клик открывает, а «Прочее» просто подпись.
 */
export function SeriesLegend({ items, onPick }: {
  items: { key: string; name: string; color: string }[];
  onPick?: (key: string) => void;
}) {
  return (
    <div className="hcat-legend">
      {items.map((it) => (
        it.key !== OTHER && onPick ? (
          <button key={it.key} type="button" className="hcat-legend__item hcat-legend__item--link" onClick={() => onPick(it.key)}>
            <span className="hcat-dot" style={{ background: it.color }} />
            {it.name}
          </button>
        ) : (
          <span key={it.key} className="hcat-legend__item">
            <span className="hcat-dot" style={{ background: it.color }} />
            {it.name}
          </span>
        )
      ))}
    </div>
  );
}

/** Переключатель «Столбцы / Линии / Доли». */
export function ChartTypeSwitch({ value, onChange, compact }: {
  value: ChartType;
  onChange: (t: ChartType) => void;
  compact?: boolean;
}) {
  return (
    <Segmented
      value={value}
      onChange={(v) => onChange(v as ChartType)}
      options={[
        { value: 'bar', icon: <BarChartOutlined />, label: compact ? undefined : 'Столбцы' },
        { value: 'line', icon: <LineChartOutlined />, label: compact ? undefined : 'Линии' },
        { value: 'pie', icon: <PieChartOutlined />, label: compact ? undefined : 'Доли' },
      ]}
    />
  );
}

/** Пилюля изменения: «+12 %» зелёным, «−8 %» красным; нет данных — прочерк. */
export function DeltaPill({ value: v }: { value: number | null }) {
  if (v == null) return <span className="hcat-muted">—</span>;
  const tone = Math.abs(v) < 0.005 ? 'neutral' : v > 0 ? 'positive' : 'negative';
  return <StatusPill tone={tone}>{formatPercent(v * 100, 0, { signed: true })}</StatusPill>;
}

/** Плашка над графиком: какой месяц обрезан и почему; можно показать как есть. */
export function OutlierNote({ info, showFull, onToggle, fmt }: {
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

/**
 * Кольцо с легендой-списком сбоку: у G2 легенда обрезает длинные названия, а здесь
 * видно полное название, долю и сумму; строка кликабельна так же, как сектор.
 */
export function PieWithLegend({ slices, center, fmt, height, onPick }: {
  slices: { key: string; name: string; value: number; color: string }[];
  center: string;
  fmt: (v: number) => string;
  height: number;
  onPick?: (key: string) => void;
}) {
  const look = useChartLook();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const keyByName = new Map(slices.map((x) => [x.name, x.key]));
  const pickRef = useLatest((name: unknown) => {
    const key = typeof name === 'string' ? keyByName.get(name) : undefined;
    if (key && key !== OTHER) onPick?.(key);
  });
  return (
    <div className="hcat-pie-wrap">
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
            onReady={({ chart }: { chart: ChartWithEvents }) => {
              chart.on('element:click', (ev) => pickRef.current(clickedRow(ev)?.name));
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
    </div>
  );
}

/**
 * Главный график уровня: несколько категорий или товаров по месяцам выбранного года.
 * Столбцы — стопкой с бледным прогнозом, линии — по факту, круговая — доли за год.
 */
export function ItemsChart({ items, ctx, type, fmt, onPick, height }: {
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

  const keyByName = new Map(prepared.map((p) => [p.name, p.key]));
  const pickRef = useLatest((name: unknown) => {
    const key = typeof name === 'string' ? keyByName.get(name) : undefined;
    if (key && key !== OTHER) onPick(key);
  });

  if (prepared.length === 0) {
    return <Text type="secondary">В {ctx.year} году продаж не было.</Text>;
  }

  const domain = prepared.map((p) => p.name);
  const color = { color: { domain, range: look.series.slice(0, domain.length) } };
  const colorOf = (name: string) => look.series[Math.max(0, domain.indexOf(name))];
  const onReady = ({ chart }: { chart: ChartWithEvents }) => {
    chart.on('element:click', (ev) => pickRef.current(clickedRow(ev)?.name));
  };
  const legend = <SeriesLegend items={prepared.map((p) => ({ key: p.key, name: p.name, color: colorOf(p.name) }))} onPick={onPick} />;

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
        {legend}
        <Line
          data={data}
          xField="month"
          yField="value"
          colorField="name"
          height={height}
          theme={look.theme}
          scale={{ ...color, x: { domain: MONTHS } }}
          shapeField={info ? 'line' : 'smooth'}
          point={{ shapeField: 'circle', sizeField: 4 }}
          style={{ lineWidth: 3, cursor: 'pointer' }}
          axis={axisFor(look, (v) => money(v))}
          legend={false}
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
      {legend}
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
        legend={false}
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
export function YearsChart({ series, ctx, type, fmt, height = 300 }: {
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
export function RankList({ rows, fmt, selectedId, onPick }: {
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

