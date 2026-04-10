import type { ThemeMode } from './tokens';
import { cssVariablesByMode } from './tokens';

/** Applies `data-theme` and CSS variables on `<html>` (call on load + when mode changes). */
export function applyDocumentTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  const vars = cssVariablesByMode[mode];
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
