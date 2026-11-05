import { describe, expect, it } from 'vitest';
import { planAllocation, type PlanDeal } from './payment-requests.plan';

const deal = (id: string, at: number, debtCents: number, items: PlanDeal['items'] = []): PlanDeal => ({ id, at, debtCents, items });

describe('planAllocation', () => {
  it('товар заявки закрывает сделки с этим товаром, старые первыми', () => {
    const plan = planAllocation(
      [{ productId: 'p1', cents: 150 }],
      [
        deal('new', 2, 100, [{ productId: 'p1', cents: 100 }]),
        deal('old', 1, 100, [{ productId: 'p1', cents: 100 }]),
      ],
    );
    expect(plan.allocations).toEqual([
      { dealId: 'old', cents: 100, source: 'goods' },
      { dealId: 'new', cents: 50, source: 'goods' },
    ]);
    expect(plan.unallocatedCents).toBe(0);
  });

  it('другой товар той же сделки оплатой не считается, пока есть подходящий', () => {
    const plan = planAllocation(
      [{ productId: 'p2', cents: 100 }],
      [
        deal('a', 1, 500, [{ productId: 'p1', cents: 500 }]),
        deal('b', 2, 500, [{ productId: 'p2', cents: 500 }]),
      ],
    );
    expect(plan.allocations).toEqual([{ dealId: 'b', cents: 100, source: 'goods' }]);
  });

  it('оплата не больше стоимости позиции и долга по сделке', () => {
    const plan = planAllocation(
      [{ productId: 'p1', cents: 300 }],
      [
        deal('partlyPaid', 1, 40, [{ productId: 'p1', cents: 100 }]),
        deal('cheapItem', 2, 500, [{ productId: 'p1', cents: 60 }, { productId: 'p9', cents: 440 }]),
      ],
    );
    // 40 + 60 по товару, остальные 200 — на долг сделки периода
    expect(plan.allocations).toEqual([
      { dealId: 'partlyPaid', cents: 40, source: 'goods' },
      { dealId: 'cheapItem', cents: 260, source: 'goods' },
    ]);
    expect(plan.unallocatedCents).toBe(0);
  });

  it('две строки на один товар не оплачивают одну позицию дважды', () => {
    const plan = planAllocation(
      [{ productId: 'p1', cents: 100 }, { productId: 'p1', cents: 100 }],
      [deal('a', 1, 1000, [{ productId: 'p1', cents: 150 }])],
    );
    expect(plan.allocations).toEqual([{ dealId: 'a', cents: 200, source: 'goods' }]);
  });

  it('остаток идёт на долги периода, потом на другие долги клиента', () => {
    const plan = planAllocation(
      [{ productId: 'smyvka', cents: 300 }],
      [
        deal('period', 5, 100, [{ productId: 'p1', cents: 100 }]),
        deal('older', 1, 150),
        deal('paid', 2, 0),
      ],
    );
    expect(plan.allocations).toEqual([
      { dealId: 'older', cents: 150, source: 'other' },
      { dealId: 'period', cents: 100, source: 'period' },
    ]);
    expect(plan.unallocatedCents).toBe(50);
  });

  it('без долгов ничего не распределяет и не создаёт переплату', () => {
    const plan = planAllocation([{ productId: 'p1', cents: 100 }], [deal('a', 1, 0, [{ productId: 'p1', cents: 100 }])]);
    expect(plan.allocations).toEqual([]);
    expect(plan.unallocatedCents).toBe(100);
  });
});
