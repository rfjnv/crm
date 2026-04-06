/**
 * Position-based client value segmentation (no revenue thresholds).
 * ABC by client count (~20% / ~30% / ~50%), class A split into VIP / Gold / Silver / Bronze by rank.
 */

export type RevenueSegmentCode = 'VIP' | 'GOLD' | 'SILVER' | 'BRONZE' | 'B' | 'C';

export const REVENUE_SEGMENT_ORDER: RevenueSegmentCode[] = [
  'VIP',
  'GOLD',
  'SILVER',
  'BRONZE',
  'B',
  'C',
];

function abcSizes(n: number): { a: number; b: number; c: number } {
  if (n <= 0) return { a: 0, b: 0, c: 0 };
  let a = Math.max(1, Math.round(n * 0.2));
  let b = Math.round(n * 0.3);
  let c = n - a - b;
  while (c < 0 && b > 0) {
    b -= 1;
    c += 1;
  }
  while (c < 0 && a > 1) {
    a -= 1;
    c += 1;
  }
  return { a, b, c: n - a - b };
}

/** VIP bucket size inside class A: target 5–10 by rank, scaled for small A. */
export function vipCountInClassA(nA: number): number {
  if (nA <= 0) return 0;
  if (nA < 5) return nA;
  const fromRatio = Math.round(nA * 0.2);
  return Math.min(nA, Math.max(5, Math.min(10, fromRatio)));
}

/** Split remainder of A (after VIP) into three as-equal-as-possible groups. */
function splitThree(rem: number): [number, number, number] {
  if (rem <= 0) return [0, 0, 0];
  const g = Math.ceil(rem / 3);
  const restAfterG = rem - g;
  const s = restAfterG <= 0 ? 0 : Math.ceil(restAfterG / 2);
  const br = rem - g - s;
  return [g, s, br];
}

function tierWithinClassA(rankInA: number, nA: number): RevenueSegmentCode {
  const v = vipCountInClassA(nA);
  if (rankInA < v) return 'VIP';
  const restRank = rankInA - v;
  const [goldN, silverN] = splitThree(nA - v);
  const goldEnd = goldN;
  const silverEnd = goldN + silverN;
  if (restRank < goldEnd) return 'GOLD';
  if (restRank < silverEnd) return 'SILVER';
  return 'BRONZE';
}

/**
 * @param clients id + total revenue in the analysis window (e.g. year)
 * @returns map clientId → segment code
 */
export function assignRevenueBasedSegments(
  clients: { id: string; revenue: number }[],
): Map<string, RevenueSegmentCode> {
  const sorted = [...clients].sort((a, b) => b.revenue - a.revenue);
  const n = sorted.length;
  const out = new Map<string, RevenueSegmentCode>();
  if (n === 0) return out;

  const { a, b, c } = abcSizes(n);
  let i = 0;
  for (let r = 0; r < a; r++) {
    out.set(sorted[i++].id, tierWithinClassA(r, a));
  }
  for (let r = 0; r < b; r++) {
    out.set(sorted[i++].id, 'B');
  }
  for (let r = 0; r < c; r++) {
    out.set(sorted[i++].id, 'C');
  }
  return out;
}

export function sortSegmentSummaryKeys<T extends { segment: string }>(rows: T[]): T[] {
  const order = new Map(REVENUE_SEGMENT_ORDER.map((s, idx) => [s, idx]));
  return [...rows].sort(
    (x, y) => (order.get(x.segment as RevenueSegmentCode) ?? 99) - (order.get(y.segment as RevenueSegmentCode) ?? 99),
  );
}
