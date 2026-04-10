/** Semantic hooks for mobile styles in `mobile.css` (prefer over raw `.ant-*` in new code). */
export const APP_BUTTON = 'app-button';
export const APP_INPUT = 'app-input';

export function withAppButton(extra?: string): string {
  return extra ? `${APP_BUTTON} ${extra}`.trim() : APP_BUTTON;
}

export function withAppInput(extra?: string): string {
  return extra ? `${APP_INPUT} ${extra}`.trim() : APP_INPUT;
}
