import type { CSSProperties } from 'react';
import type { AbcXyzRow } from '../types';

/** Business importance: AX first, then AY, AZ, ANEW, then B*, then C*. */
export const ABC_XYZ_COMBINED_SORT_ORDER: string[] = [
  'AX',
  'AY',
  'AZ',
  'ANEW',
  'BX',
  'BY',
  'BZ',
  'BNEW',
  'CX',
  'CY',
  'CZ',
  'CNEW',
];

export function combinedSortRank(combined: string): number {
  const i = ABC_XYZ_COMBINED_SORT_ORDER.indexOf(combined);
  return i === -1 ? 999 : i;
}

export function compareAbcXyzRowsByImportance(a: AbcXyzRow, b: AbcXyzRow): number {
  const ra = combinedSortRank(a.combined);
  const rb = combinedSortRank(b.combined);
  if (ra !== rb) return ra - rb;
  return b.revenue - a.revenue;
}

/** ABC: A green, B yellow/amber, C red */
export const ABC_TAG_COLORS: Record<string, string> = {
  A: 'success',
  B: 'warning',
  C: 'error',
};

/** XYZ visual weight: X strong, Y normal, Z faded, NEW distinct */
export function xyzTagStyle(xyz: string): CSSProperties {
  if (xyz === 'X') return { fontWeight: 700, opacity: 1 };
  if (xyz === 'Y') return { fontWeight: 500, opacity: 0.88 };
  if (xyz === 'Z') return { fontWeight: 400, opacity: 0.48 };
  if (xyz === 'NEW') return { fontWeight: 600, opacity: 0.92, fontStyle: 'italic' };
  return {};
}

export function xyzTagColor(xyz: string): string | undefined {
  if (xyz === 'NEW') return 'processing';
  if (xyz === 'X') return 'success';
  if (xyz === 'Y') return 'warning';
  return undefined;
}

export function filterAbcXyzRows(
  rows: AbcXyzRow[],
  abc: string | undefined,
  xyz: string | undefined,
  combined: string | undefined,
): AbcXyzRow[] {
  return rows.filter((r) => {
    if (abc && r.abc !== abc) return false;
    if (xyz && r.xyz !== xyz) return false;
    if (combined && r.combined !== combined) return false;
    return true;
  });
}

export function uniqueCombinedClasses(products: AbcXyzRow[], clients: AbcXyzRow[]): string[] {
  const s = new Set<string>();
  for (const r of products) s.add(r.combined);
  for (const r of clients) s.add(r.combined);
  return [...s].sort((a, b) => combinedSortRank(a) - combinedSortRank(b));
}
