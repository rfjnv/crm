import { describe, expect, it } from 'vitest';
import { describeChanges, diffAccountingSnapshots, type AccountingSnapshot } from './accounting-changes.service';

const base: AccountingSnapshot = {
  title: 'Сделка',
  status: 'CLOSED',
  paymentMethod: 'TRANSFER',
  amount: 1000,
  discount: 0,
  includeVat: true,
  items: [
    { productId: 'p1', name: 'Плёнка', unit: 'кг', qty: 10, price: 100 },
  ],
};

describe('diffAccountingSnapshots', () => {
  it('ничего не поменялось — пусто', () => {
    expect(diffAccountingSnapshots(base, { ...base, status: 'SHIPPED', title: 'Другое' })).toEqual([]);
  });

  it('скидка: цена и сумма', () => {
    const after = { ...base, amount: 900, items: [{ ...base.items[0], price: 90 }] };
    const diff = diffAccountingSnapshots(base, after);
    expect(diff).toEqual([
      { kind: 'price', product: 'Плёнка', unit: 'кг', before: 100, after: 90 },
      { kind: 'amount', before: 1000, after: 900 },
    ]);
    expect(describeChanges(diff).replace(/\s/g, ' ')).toBe('цена «Плёнка» 100 → 90; сумма 1 000 → 900');
  });

  it('товар заменили, количество разбили на две позиции', () => {
    const after = {
      ...base,
      items: [
        { productId: 'p2', name: 'Бумага', unit: 'шт', qty: 5, price: 200 },
      ],
    };
    expect(diffAccountingSnapshots(base, after).map((l) => l.kind)).toEqual(['removed', 'added']);

    const split = { ...base, items: [{ ...base.items[0], qty: 4 }, { ...base.items[0], qty: 6 }] };
    expect(diffAccountingSnapshots(base, split)).toEqual([]);
  });

  it('НДС и способ оплаты', () => {
    const diff = diffAccountingSnapshots(base, { ...base, includeVat: false, paymentMethod: 'CASH' });
    expect(diff.map((l) => l.kind)).toEqual(['vat', 'paymentMethod']);
  });
});
