import type { MovementType } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Inventory movement semantics for analytics (not stock math).
 *
 * Product movement analytics counts ONLY: IN + OUT with deal (sales).
 * Excluded from analytics (stock adjustments, not sales): CORRECTION, OUT without deal.
 */
export function isInventorySaleMovement(type: MovementType, dealId: string | null | undefined): boolean {
  return type === 'OUT' && dealId != null;
}

export function isInventoryCorrectionMovement(type: MovementType, dealId: string | null | undefined): boolean {
  return type === 'CORRECTION' || (type === 'OUT' && dealId == null);
}

/** Predicate for raw SQL with table alias `m` (inventory_movements). */
export function sqlMovementIsSale(alias = 'm'): Prisma.Sql {
  return Prisma.raw(`(${alias}.type = 'OUT' AND ${alias}.deal_id IS NOT NULL)`);
}

/** Movements excluded from product movement charts/totals (коррекции / вне аналитики). */
export function sqlMovementIsAnalyticsCorrection(alias = 'm'): Prisma.Sql {
  return Prisma.raw(
    `(${alias}.type = 'CORRECTION' OR (${alias}.type = 'OUT' AND ${alias}.deal_id IS NULL))`,
  );
}

/** Rows that participate in product movement analytics (приход + отгрузка по сделкам). */
export function sqlMovementIncludedInProductAnalytics(alias = 'm'): Prisma.Sql {
  return Prisma.raw(
    `(${alias}.type = 'IN' OR (${alias}.type = 'OUT' AND ${alias}.deal_id IS NOT NULL))`,
  );
}

export type ChartGranularity = 'day' | 'month' | 'quarter' | 'year';

export type ProductAnalyticsPeriod = number | 'all';

/** ~месяц: только день; ~квартал: день|месяц; ~год: день|месяц|квартал; всё: месяц|квартал|год */
export function resolveProductChartGranularity(
  period: ProductAnalyticsPeriod,
  requested?: string | null,
): { granularity: ChartGranularity; allowed: ChartGranularity[] } {
  const q = (requested || '').toLowerCase().trim();

  if (period === 'all') {
    const allowed: ChartGranularity[] = ['month', 'quarter', 'year'];
    if (q === 'month' || q === 'quarter' || q === 'year') return { granularity: q, allowed };
    return { granularity: 'month', allowed };
  }

  if (period <= 35) {
    return { granularity: 'day', allowed: ['day'] };
  }

  if (period <= 120) {
    const allowed: ChartGranularity[] = ['day', 'month'];
    if (q === 'day' || q === 'month') return { granularity: q, allowed };
    return { granularity: 'month', allowed };
  }

  const allowed: ChartGranularity[] = ['day', 'month', 'quarter'];
  if (q === 'day' || q === 'month' || q === 'quarter') return { granularity: q, allowed };
  return { granularity: 'month', allowed };
}

/**
 * Бизнес-дата движения товара для аналитики и графиков.
 *
 * Если движение привязано к сделке (`m.deal_id IS NOT NULL`) — берём дату закрытия сделки
 * (`d.closed_at`) с fallback на дату создания сделки (`d.created_at`).
 * Иначе — `m.created_at` самой строки движения.
 *
 * Требует, чтобы запрос делал `LEFT JOIN deals d ON d.id = m.deal_id`
 * (или другие алиасы, переданные в аргументах).
 */
export function sqlInventoryMovementBusinessDate(
  movementAlias = 'm',
  dealAlias = 'd',
): Prisma.Sql {
  return Prisma.raw(
    `COALESCE(${dealAlias}.closed_at, ${dealAlias}.created_at, ${movementAlias}.created_at)`,
  );
}

/**
 * SQL time bucket для аналитики движений товара.
 * Группирует по БИЗНЕС-дате (closed_at сделки), а не по created_at записи —
 * чтобы ретроактивные правки/автосписания не «съезжали» на сегодня.
 *
 * Требует, чтобы запрос содержал `LEFT JOIN deals d ON d.id = m.deal_id`.
 */
export function sqlInventoryMovementBucket(granularity: ChartGranularity): Prisma.Sql {
  const businessDate = sqlInventoryMovementBusinessDate('m', 'd');
  switch (granularity) {
    case 'day':
      return Prisma.sql`(${businessDate}::date)`;
    case 'month':
      return Prisma.sql`date_trunc('month', ${businessDate})`;
    case 'quarter':
      return Prisma.sql`date_trunc('quarter', ${businessDate})`;
    case 'year':
      return Prisma.sql`date_trunc('year', ${businessDate})`;
    default:
      return Prisma.sql`(${businessDate}::date)`;
  }
}
