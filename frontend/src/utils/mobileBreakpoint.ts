/**
 * Cached mobile `matchMedia` query string from `--mobile-breakpoint` in `mobile.css`.
 * Avoids repeated `getComputedStyle` reads.
 *
 * `MOBILE_BREAKPOINT_FALLBACK` must match `--mobile-breakpoint` (see `scripts/check-mobile-breakpoint.mjs`).
 */
let cachedQuery: string | null = null;

/** Must match `src/mobile.css` `:root { --mobile-breakpoint: … }` */
export const MOBILE_BREAKPOINT_FALLBACK = '768px' as const;

export function getMobileQuery(): string {
  if (cachedQuery) return cachedQuery;

  if (typeof document === 'undefined') {
    cachedQuery = `(max-width: ${MOBILE_BREAKPOINT_FALLBACK})`;
    return cachedQuery;
  }

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--mobile-breakpoint')
    .trim();

  cachedQuery = `(max-width: ${value || MOBILE_BREAKPOINT_FALLBACK})`;
  return cachedQuery;
}
