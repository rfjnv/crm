/**
 * Single source of truth for theme colors (sync with theme-variables.css fallbacks).
 */

export type ThemeMode = 'light' | 'dark';

/** CSS custom properties applied to `document.documentElement` */
export const cssVariablesByMode: Record<
  ThemeMode,
  Record<string, string>
> = {
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f5f7fa',
    '--card-bg': '#ffffff',
    '--text-primary': '#0f172a',
    '--text-secondary': 'rgba(15, 23, 42, 0.65)',
    '--border-color': 'rgba(0, 0, 0, 0.08)',
    '--shadow-soft': '0 4px 12px rgba(0, 0, 0, 0.08)',
    '--app-body-bg': '#f5f7fa',
  },
  dark: {
    '--bg-primary': '#0B0F14',
    '--bg-secondary': '#11161C',
    '--card-bg': '#11161C',
    '--text-primary': '#ffffff',
    '--text-secondary': 'rgba(255, 255, 255, 0.65)',
    '--border-color': 'rgba(255, 255, 255, 0.08)',
    '--shadow-soft': '0 6px 16px rgba(0, 0, 0, 0.4)',
    '--app-body-bg': '#0B0F14',
  },
};

/** Ant Design `ConfigProvider` token overrides per mode */
export const antDesignTokens: Record<
  ThemeMode,
  {
    colorBgLayout: string;
    colorBgContainer: string;
    /**
     * Поверхности «над» страницей: модалки, выпадающие списки, поповеры, уведомления.
     *
     * Без этого переопределения antd в тёмной теме подставляет свой дефолт `#1f1f1f` —
     * нейтрально-серый. Рядом с холодным `#0B0F14` фоном и `#11161C` карточками он
     * читается грязно-бурым, из-за чего модалки выглядели инородно. Здесь тот же
     * холодный оттенок, что у контейнеров, но на шаг светлее — чтобы поверхность
     * читалась приподнятой.
     */
    colorBgElevated: string;
    colorBorderSecondary: string;
    colorSplit: string;
  }
> = {
  light: {
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorderSecondary: 'rgba(0, 0, 0, 0.06)',
    colorSplit: 'rgba(0, 0, 0, 0.04)',
  },
  dark: {
    colorBgLayout: '#0B0F14',
    colorBgContainer: '#11161C',
    colorBgElevated: '#1A212A',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',
    colorSplit: 'rgba(255, 255, 255, 0.06)',
  },
};
