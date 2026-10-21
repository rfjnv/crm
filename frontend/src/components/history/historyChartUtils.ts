import { useThemeStore } from '../../store/themeStore';
import { glassPalette } from '../../theme/glassPalette';
import { formatMoneyCompact } from '../../utils/currency';
import { findOutlierCap } from '../../utils/chartShaping';
import type { YearSeries } from '../../utils/salesForecast';

/** Константы, форматтеры и палитра графиков аналитики истории (компоненты — в historyCharts.tsx). */

export const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
export const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** Столько категорий / товаров на графике, остальные — «Прочее». */
export const TOP_ON_CHART = 8;
export const OTHER = 'Прочее';

export type ChartType = 'bar' | 'line' | 'pie';

/** Тип графика, запомненный в браузере под ключом `key`. */
export function loadChartType(key: string): ChartType {
  try {
    const v = localStorage.getItem(key);
    return v === 'line' || v === 'pie' ? v : 'bar';
  } catch {
    return 'bar';
  }
}

export function saveChartType(key: string, t: ChartType): void {
  try {
    localStorage.setItem(key, t);
  } catch {
    // без памяти о выборе — не страшно
  }
}


/** «12,4 млн» — для осей и подписей. */
export function money(v: number): string {
  const m = formatMoneyCompact(v);
  return m.unit ? `${m.text} ${m.unit}` : m.text;
}

export function fmtQty(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('ru-RU');
}

export function monthName(m: number | null): string {
  return m ? MONTHS_FULL[m - 1] : '—';
}


// ── Внешний вид графиков ──

export interface ChartLook {
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
export function useChartLook(): ChartLook {
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

export function axisFor(look: ChartLook, yFmt: (v: number) => string) {
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

export function legendFor(look: ChartLook) {
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


export interface OutlierInfo {
  cap: number;
  points: { label: string; value: number }[];
  median: number;
}


export function outlierInfo(points: { label: string; value: number }[]): OutlierInfo | null {
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


/** Элемент графика уровня: категория (на уровне «все») или товар (внутри категории). */
export interface ChartItem {
  key: string;
  name: string;
  /** Подпись на графике — может быть короче полного названия. */
  label: string;
  series: YearSeries | undefined;
}

