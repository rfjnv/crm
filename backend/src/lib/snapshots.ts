import prisma from './prisma';

export interface SnapshotKey {
  year: number;
  month: number; // 0 = full year, 1-12 = specific month
  type: string;
  scope?: string; // defaults to 'admin'
}

/**
 * Try to find a cached snapshot. Returns parsed data or null.
 */
export async function getSnapshot(key: SnapshotKey): Promise<any | null> {
  const scope = key.scope || 'admin';
  const snapshot = await prisma.monthlySnapshot.findUnique({
    where: {
      year_month_scope_type: {
        year: key.year,
        month: key.month,
        scope,
        type: key.type,
      },
    },
  });
  return snapshot?.data ?? null;
}

/**
 * Save or update a snapshot.
 */
export async function saveSnapshot(key: SnapshotKey, data: any): Promise<void> {
  const scope = key.scope || 'admin';
  await prisma.monthlySnapshot.upsert({
    where: {
      year_month_scope_type: {
        year: key.year,
        month: key.month,
        scope,
        type: key.type,
      },
    },
    update: { data },
    create: {
      year: key.year,
      month: key.month,
      scope,
      type: key.type,
      data,
    },
  });
}

/**
 * Check if a given (year, month) is in the past relative to now in Asia/Tashkent (UTC+5).
 */
export function isPastMonth(year: number, month: number): boolean {
  const now = new Date();
  const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const currentYear = tashkentNow.getUTCFullYear();
  const currentMonth = tashkentNow.getUTCMonth() + 1;

  if (year < currentYear) return true;
  if (year === currentYear && month < currentMonth) return true;
  return false;
}

/**
 * Check if an entire year is in the past (all 12 months are past).
 */
export function isPastYear(year: number): boolean {
  return isPastMonth(year, 12);
}

/**
 * Invalidate (delete) a snapshot so it gets recomputed next time.
 */
export async function invalidateSnapshot(key: SnapshotKey): Promise<void> {
  const scope = key.scope || 'admin';
  await prisma.monthlySnapshot.deleteMany({
    where: {
      year: key.year,
      month: key.month,
      scope,
      type: key.type,
    },
  });
}
