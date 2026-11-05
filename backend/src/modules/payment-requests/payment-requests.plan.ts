/**
 * Как сумма заявки ложится на сделки клиента. Считаем в тийинах, чтобы не копить ошибки округления.
 *
 * 1. goods — сделки периода, где есть этот товар, старые первыми: не больше стоимости
 *    позиции в сделке и не больше долга по сделке.
 * 2. period — что осталось (цена в заявке выше, товара нет в сделках): другие долги периода.
 * 3. other — остальные долги клиента, старые первыми.
 *
 * Что не поместилось, возвращается в unallocatedCents: переплату заявка не создаёт.
 */

export type AllocationSource = 'goods' | 'period' | 'other';

export interface PlanLine {
  productId: string;
  cents: number;
}

export interface PlanDeal {
  id: string;
  /** Самая ранняя дата позиции в периоде, иначе дата создания сделки. */
  at: number;
  debtCents: number;
  /** Только позиции, попавшие в период. Пусто — сделка вне периода. */
  items: { productId: string; cents: number }[];
}

export interface PlanAllocation {
  dealId: string;
  cents: number;
  /** Самое точное основание: goods, если на сделку попал хотя бы один товар заявки. */
  source: AllocationSource;
}

export interface AllocationPlan {
  allocations: PlanAllocation[];
  unallocatedCents: number;
}

const SOURCE_RANK: Record<AllocationSource, number> = { goods: 0, period: 1, other: 2 };

export const toCents = (value: number): number => Math.round(value * 100);

export function planAllocation(lines: PlanLine[], deals: PlanDeal[]): AllocationPlan {
  const ordered = [...deals].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const debt = new Map(ordered.map((d) => [d.id, Math.max(0, d.debtCents)]));
  const byDeal = new Map<string, PlanAllocation>();

  const allocate = (dealId: string, cents: number, source: AllocationSource) => {
    if (cents <= 0) return;
    debt.set(dealId, (debt.get(dealId) ?? 0) - cents);
    const existing = byDeal.get(dealId);
    if (!existing) {
      byDeal.set(dealId, { dealId, cents, source });
      return;
    }
    existing.cents += cents;
    if (SOURCE_RANK[source] < SOURCE_RANK[existing.source]) existing.source = source;
  };

  let leftover = 0;
  // Одна позиция сделки может закрыть только свою стоимость, даже если заявок на товар две строки.
  const itemLeft = new Map<string, number>();
  for (const line of lines) {
    let remaining = line.cents;
    for (const deal of ordered) {
      if (remaining <= 0) break;
      deal.items.forEach((item, idx) => {
        if (remaining <= 0 || item.productId !== line.productId) return;
        const key = `${deal.id}:${idx}`;
        const left = itemLeft.get(key) ?? item.cents;
        const take = Math.min(remaining, left, debt.get(deal.id) ?? 0);
        if (take <= 0) return;
        allocate(deal.id, take, 'goods');
        itemLeft.set(key, left - take);
        remaining -= take;
      });
    }
    leftover += remaining;
  }

  const spread = (candidates: PlanDeal[], source: AllocationSource) => {
    for (const deal of candidates) {
      if (leftover <= 0) return;
      const take = Math.min(leftover, debt.get(deal.id) ?? 0);
      allocate(deal.id, take, source);
      leftover -= Math.max(0, take);
    }
  };
  spread(ordered.filter((d) => d.items.length > 0), 'period');
  spread(ordered.filter((d) => d.items.length === 0), 'other');

  return {
    allocations: ordered.flatMap((d) => (byDeal.has(d.id) ? [byDeal.get(d.id)!] : [])),
    unallocatedCents: leftover,
  };
}
