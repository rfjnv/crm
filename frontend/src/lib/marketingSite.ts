/** Маркетинговый сайт Polygraph Business */
export const MARKETING_SITE_URL =
  (import.meta.env.VITE_MARKETING_SITE_URL as string | undefined)?.replace(/\/$/, '')
  || 'https://polygraph-business.onrender.com';
