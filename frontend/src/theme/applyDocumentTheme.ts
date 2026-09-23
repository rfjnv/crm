import type { DesignMode, ThemeMode } from './tokens';
import { cssVariablesFor } from './tokens';

const MODERN_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';

/** Шрифт нового дизайна грузим только тем, кто его включил. Без сети остаётся системный. */
function ensureModernFont() {
  if (document.querySelector(`link[href="${MODERN_FONT_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = MODERN_FONT_HREF;
  document.head.appendChild(link);
}

/** Applies `data-theme`, `data-design` and CSS variables on `<html>` (call on load + when either changes). */
export function applyDocumentTheme(mode: ThemeMode, design: DesignMode = 'classic') {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.design = design;
  if (design === 'modern') ensureModernFont();
  const vars = cssVariablesFor(design, mode);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
