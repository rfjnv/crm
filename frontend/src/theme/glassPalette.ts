import type { ThemeMode } from './tokens';

/**
 * Палитра нового дизайна (docs/design/DASHBOARD.md §3, §5) — единый источник значений.
 *
 * Графики G2 и токены antd не читают CSS-переменные, поэтому берут цвета отсюда, а
 * theme/glass.css повторяет те же литералы в `--fill-*` и `--c-*` с пометкой
 * «sync glassPalette.ts». Меняя значение здесь, поменяйте его и там.
 */
export interface GlassPalette {
  /** Числа, названия, активное. */
  text1: string;
  /** Подписи, мета, оси, действия секций. */
  text2: string;
  /** Eyebrow, плейсхолдеры, прочерки. */
  text3: string;
  /** Ссылки внутри данных. */
  accentFg: string;
  /** Линия и заливка графика, бар целей. */
  accentFill: string;
  posFg: string;
  posBg: string;
  warnFg: string;
  warnBg: string;
  negFg: string;
  negBg: string;
  /** Только счётчики «нужно действие». */
  alert: string;
  /** Уровень B — группа (Section) внутри окна. */
  fill1: string;
  fill1Hover: string;
  /** Уровень C — строка, рельс прогресса, неактивная пилюля, hover строки. */
  fill2: string;
  /** Уровень C — активное состояние. */
  fill3: string;
  /** Сетка графиков. */
  grid: string;
}

export const glassPalette: Record<ThemeMode, GlassPalette> = {
  dark: {
    text1: '#ffffff',
    text2: 'rgba(255, 255, 255, 0.82)',
    text3: 'rgba(255, 255, 255, 0.55)',
    accentFg: '#93c5fd',
    accentFill: '#4f8cff',
    posFg: '#86efac',
    posBg: 'rgba(34, 197, 94, 0.16)',
    warnFg: '#fcd34d',
    warnBg: 'rgba(245, 158, 11, 0.16)',
    negFg: '#fca5a5',
    negBg: 'rgba(239, 68, 68, 0.16)',
    alert: '#ef4444',
    fill1: 'rgba(255, 255, 255, 0.05)',
    fill1Hover: 'rgba(255, 255, 255, 0.08)',
    fill2: 'rgba(255, 255, 255, 0.10)',
    fill3: 'rgba(255, 255, 255, 0.16)',
    grid: 'rgba(255, 255, 255, 0.08)',
  },
  light: {
    text1: '#1c1a17',
    text2: 'rgba(28, 26, 23, 0.72)',
    text3: 'rgba(28, 26, 23, 0.50)',
    accentFg: '#1d4ed8',
    accentFill: '#2563eb',
    posFg: '#15803d',
    posBg: 'rgba(22, 163, 74, 0.14)',
    warnFg: '#b45309',
    warnBg: 'rgba(217, 119, 6, 0.12)',
    negFg: '#b91c1c',
    negBg: 'rgba(220, 38, 38, 0.12)',
    alert: '#dc2626',
    fill1: 'rgba(255, 255, 255, 0.18)',
    fill1Hover: 'rgba(255, 255, 255, 0.24)',
    fill2: 'rgba(28, 26, 23, 0.06)',
    fill3: 'rgba(28, 26, 23, 0.16)',
    grid: 'rgba(28, 26, 23, 0.08)',
  },
};
