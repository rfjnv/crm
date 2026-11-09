// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AuditChanges, { hasAuditChanges } from './AuditChanges';

afterEach(cleanup);

const item = (id: string, productId: string, price: number, qty: number) => ({
  id, productId, price, requestedQty: qty, rollCount: null, dealDate: null,
  createdAt: '2026-11-07T10:50:41.073Z', shippedAt: null, confirmedAt: null, deliveredAt: null,
});

// Снимки override-правки сделки: у двух позиций 8 → 16, сумма выросла, поле terms пропало.
const before = {
  title: 'Сделка от 07.11.2026', amount: 50_400_000, status: 'WAITING_WAREHOUSE_MANAGER', terms: null,
  payments: [], comments: [], createdAt: '2026-11-07T10:50:40.990Z',
  items: [item('a', 'p1', 4000, 10400), item('b', 'p2', 300000, 8), item('c', 'p3', 300000, 8), item('d', 'p4', 400000, 10)],
};
const after = {
  title: 'Сделка от 07.11.2026', amount: 55_200_000, status: 'WAITING_WAREHOUSE_MANAGER',
  payments: [], comments: [], createdAt: '2026-11-07T10:50:40.990Z',
  items: [item('a', 'p1', 4000, 10400), item('b', 'p2', 300000, 16), item('c', 'p3', 300000, 16), item('d', 'p4', 400000, 10)],
};
const names = { products: new Map([['p1', 'Бумага А4'], ['p2', 'Плёнка'], ['p3', 'Краска'], ['p4', 'Клей']]) };

describe('AuditChanges', () => {
  it('показывает только изменённые позиции и сумму', () => {
    const { container } = render(<AuditChanges before={before} after={after} names={names} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Плёнка');
    expect(text).toContain('Краска');
    expect(text).toContain('Кол-во: 8 → 16');
    expect(text).toContain('Сумма:');
    // неизменённое не показываем
    expect(text).not.toContain('Бумага А4');
    expect(text).not.toContain('Клей');
    expect(text).not.toContain('Название');
    expect(text).not.toContain('Условия');
    expect(text).not.toContain('Статус');
  });

  it('добавленная и удалённая позиции', () => {
    const { container } = render(
      <AuditChanges before={{ items: [item('a', 'p1', 1, 1)] }} after={{ items: [item('b', 'p2', 2, 3)] }} names={names} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('+ Плёнка');
    expect(text).toContain('− Бумага А4');
  });

  it('смена статуса — без лишних полей', () => {
    expect(hasAuditChanges({ status: 'NEW' }, { status: 'NEW' })).toBe(false);
    const { container } = render(<AuditChanges before={{ status: 'NEW' }} after={{ status: 'CLOSED' }} />);
    expect(container.textContent).toContain('Новая');
    expect(container.textContent).toContain('Закрыта');
  });
});
