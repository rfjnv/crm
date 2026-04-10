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
    colorBorderSecondary: string;
    colorSplit: string;
  }
> = {
  light: {
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    colorBorderSecondary: 'rgba(0, 0, 0, 0.06)',
    colorSplit: 'rgba(0, 0, 0, 0.04)',
  },
  dark: {
    colorBgLayout: '#0B0F14',
    colorBgContainer: '#11161C',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',
    colorSplit: 'rgba(255, 255, 255, 0.06)',
  },
};
