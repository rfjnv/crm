import { useSyncExternalStore } from 'react';
import { getMobileQuery } from '../utils/mobileBreakpoint';

let mqSingleton: MediaQueryList | null = null;
let boundQuery: string | null = null;

function getMq(): MediaQueryList | null {
  if (typeof window === 'undefined') return null;
  const q = getMobileQuery();
  if (boundQuery !== q || !mqSingleton) {
    boundQuery = q;
    mqSingleton = window.matchMedia(q);
  }
  return mqSingleton;
}

function getMobileSnapshot(): boolean {
  return getMq()?.matches ?? false;
}

function subscribeMobile(callback: () => void): () => void {
  const mq = getMq();
  if (!mq) return () => {};
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

/**
 * Logic-only (drawer, conditional UI). Uses `matchMedia` from cached `getMobileQuery()`.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false);
}
