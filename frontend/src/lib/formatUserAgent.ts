const OS_PATTERNS: [RegExp, string][] = [
  [/windows nt/i, 'Windows'],
  [/android/i, 'Android'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/mac os x/i, 'macOS'],
  [/linux/i, 'Linux'],
];

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/chrome\//i, 'Chrome'],
  [/firefox\//i, 'Firefox'],
  [/safari\//i, 'Safari'],
];

/** Человекочитаемый ярлык устройства из сырого User-Agent, например «Windows • Chrome». Только для отображения. */
export function formatUserAgent(ua: string | null | undefined): string {
  if (!ua) return '—';

  const os = OS_PATTERNS.find(([re]) => re.test(ua))?.[1];
  const browser = BROWSER_PATTERNS.find(([re]) => re.test(ua))?.[1];

  if (os && browser) return `${os} • ${browser}`;
  return os || browser || ua.slice(0, 40);
}
