import { theme as antTheme } from 'antd';
import type { ThemeConfig } from 'antd';

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

/**
 * Дизайн интерфейса — отдельно от светлой/тёмной темы.
 *
 * `classic` — текущий вид, значения выше не трогаем.
 * `modern` — новый дизайн (бета): включается переключателем в меню профиля,
 * чтобы проверить его на живых данных и в любой момент вернуться обратно.
 * После перехода `classic` и переключатель удаляются.
 */
export type DesignMode = 'classic' | 'modern';

/** Новый дизайн: холодные нейтральные цвета, ярче акцент, мягче тени. */
export const modernCssVariablesByMode: Record<ThemeMode, Record<string, string>> = {
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f6f7f9',
    '--card-bg': '#ffffff',
    '--text-primary': '#0f172a',
    '--text-secondary': 'rgba(15, 23, 42, 0.6)',
    '--border-color': 'rgba(15, 23, 42, 0.08)',
    '--shadow-soft': '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)',
    '--app-body-bg': '#f6f7f9',
  },
  dark: {
    '--bg-primary': '#0b0d12',
    '--bg-secondary': '#12151c',
    '--card-bg': '#12151c',
    '--text-primary': '#f1f5f9',
    '--text-secondary': 'rgba(241, 245, 249, 0.6)',
    '--border-color': 'rgba(255, 255, 255, 0.07)',
    '--shadow-soft': '0 1px 2px rgba(0, 0, 0, 0.3)',
    '--app-body-bg': '#0b0d12',
  },
};

export function cssVariablesFor(design: DesignMode, mode: ThemeMode) {
  return design === 'modern' ? modernCssVariablesByMode[mode] : cssVariablesByMode[mode];
}

/** Полная конфигурация `ConfigProvider` для выбранного дизайна и темы. */
export function antThemeConfig(design: DesignMode, mode: ThemeMode): ThemeConfig {
  const isDark = mode === 'dark';
  const algorithm = isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm;

  if (design === 'classic') {
    return {
      algorithm,
      token: {
        colorPrimary: '#22609A',
        ...antDesignTokens[mode],
      },
      components: {
        Menu: {
          itemMarginBlock: 2,
          groupTitleFontSize: 11,
          groupTitleColor: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.35)',
          itemSelectedBg: isDark ? 'rgba(34, 96, 154, 0.35)' : 'rgba(34, 96, 154, 0.12)',
          itemSelectedColor: isDark ? '#5BA4DE' : '#1A4F80',
        },
      },
    };
  }

  const primary = isDark ? '#4f8cff' : '#2563eb';
  const vars = modernCssVariablesByMode[mode];
  return {
    algorithm,
    token: {
      colorPrimary: primary,
      colorInfo: primary,
      colorSuccess: isDark ? '#22c55e' : '#16a34a',
      colorWarning: isDark ? '#f59e0b' : '#d97706',
      colorError: isDark ? '#f87171' : '#dc2626',
      colorLink: primary,
      colorBgLayout: vars['--app-body-bg'],
      colorBgContainer: vars['--card-bg'],
      colorBgElevated: isDark ? '#1a1e27' : '#ffffff',
      colorText: vars['--text-primary'],
      colorTextSecondary: vars['--text-secondary'],
      colorBorder: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.14)',
      colorBorderSecondary: vars['--border-color'],
      colorSplit: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)',
      fontFamily:
        "Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
      borderRadius: 8,
      borderRadiusLG: 12,
      borderRadiusSM: 6,
      controlHeight: 34,
      boxShadow: isDark
        ? '0 8px 24px rgba(0, 0, 0, 0.45)'
        : '0 8px 24px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04)',
      boxShadowSecondary: isDark
        ? '0 12px 32px rgba(0, 0, 0, 0.5)'
        : '0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 8px rgba(15, 23, 42, 0.05)',
      motionDurationMid: '0.15s',
      motionDurationSlow: '0.2s',
    },
    components: {
      Menu: {
        itemHeight: 36,
        itemMarginBlock: 2,
        itemMarginInline: 8,
        itemBorderRadius: 8,
        groupTitleFontSize: 11,
        groupTitleColor: isDark ? 'rgba(241, 245, 249, 0.35)' : 'rgba(15, 23, 42, 0.4)',
        itemColor: isDark ? 'rgba(241, 245, 249, 0.75)' : 'rgba(15, 23, 42, 0.75)',
        itemHoverBg: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.04)',
        itemSelectedBg: isDark ? 'rgba(79, 140, 255, 0.16)' : 'rgba(37, 99, 235, 0.08)',
        itemSelectedColor: primary,
        subMenuItemBg: 'transparent',
      },
      Button: {
        fontWeight: 500,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Card: {
        headerFontSize: 15,
        headerHeight: 52,
      },
      Table: {
        headerBg: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
        headerColor: vars['--text-secondary'],
        headerSplitColor: 'transparent',
        rowHoverBg: isDark ? 'rgba(255, 255, 255, 0.03)' : '#f8fafc',
        cellPaddingBlock: 12,
        cellPaddingBlockMD: 10,
        cellPaddingBlockSM: 8,
      },
      Tabs: {
        titleFontSize: 14,
        horizontalItemPadding: '10px 0',
      },
      Tag: {
        borderRadiusSM: 6,
      },
      Modal: {
        titleFontSize: 17,
      },
    },
  };
}
