import { describe, expect, it } from 'vitest';
import {
  ADMIN_DEAL_OVERRIDE_PATH,
  buildNotice,
  describeChanges,
  diffAccountingSnapshots,
  relevantChanges,
  type AccountingSnapshot,
} from './accounting-changes.service';

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

  const full: AccountingSnapshot = {
    ...base,
    contractId: 'c1',
    contractNumber: '12',
    clientName: 'ООО Альфа',
    transferInn: '300000001',
    transferDocuments: '["Счёт-фактура"]',
    paidAmount: 0,
    isArchived: false,
  };

  it('ИНН, договор, клиент, оплата, документы', () => {
    const diff = diffAccountingSnapshots(full, {
      ...full,
      contractId: null,
      contractNumber: null,
      clientName: 'ООО Бета',
      transferInn: '300000002',
      transferDocuments: '["Акт"]',
      paidAmount: 500,
    });
    expect(diff.map((l) => l.kind)).toEqual(['inn', 'transferDocs', 'contract', 'client', 'paid']);
    expect(diff.find((l) => l.kind === 'transferDocs')?.after).toBe('Акт');
  });

  it('запись старого формата: новых полей в снимке нет — ложных изменений нет', () => {
    expect(diffAccountingSnapshots({ ...base, contractId: 'c1' }, { ...full })).toEqual([]);
  });

  it('смена способа оплаты: документы отдельной строкой не показываем', () => {
    const diff = diffAccountingSnapshots(full, { ...full, paymentMethod: 'CASH', transferInn: null, transferDocuments: null });
    expect(diff.map((l) => l.kind)).toEqual(['paymentMethod', 'inn']);
  });

  it('отмена, архив, удаление', () => {
    expect(diffAccountingSnapshots(full, { ...full, status: 'CANCELED' }).map((l) => l.kind)).toEqual(['canceled']);
    expect(diffAccountingSnapshots(full, { ...full, isArchived: true }).map((l) => l.kind)).toEqual(['archived']);
    expect(diffAccountingSnapshots(full, { ...full, deleted: true }).map((l) => l.kind)).toEqual(['deleted']);
  });
});

describe('relevantChanges', () => {
  const pick = (before: AccountingSnapshot, after: AccountingSnapshot) =>
    relevantChanges(before, after, diffAccountingSnapshots(before, after)).map((l) => l.kind);
  const early: AccountingSnapshot = { ...base, status: 'NEW', transferInn: '300000001' };

  it('с перечисления ушли — приходит на любом этапе и без договора', () => {
    expect(pick(early, { ...early, paymentMethod: 'CASH', transferInn: null, amount: 900 })).toEqual(['paymentMethod', 'inn']);
    expect(pick(base, { ...base, paymentMethod: 'CASH' })).toEqual(['paymentMethod']);
  });

  it('до бухгалтера правки на перечислении — обычная работа менеджера', () => {
    expect(pick(early, { ...early, amount: 900, transferInn: '300000002' })).toEqual([]);
  });

  it('у бухгалтера: всё, и договор для этого не нужен', () => {
    expect(base.contractId).toBeUndefined();
    expect(pick(base, { ...base, amount: 900 })).toEqual(['amount']);
  });

  it('на перечисление: у бухгалтера — да, раньше и без способа оплаты — нет', () => {
    expect(pick({ ...base, paymentMethod: 'CASH' }, base)).toEqual(['paymentMethod']);
    expect(pick({ ...early, paymentMethod: 'CASH' }, early)).toEqual([]);
    expect(pick({ ...early, paymentMethod: null }, early)).toEqual([]);
  });

  it('другой способ оплаты и уже отменённые сделки не считаем', () => {
    const cash: AccountingSnapshot = { ...base, paymentMethod: 'CASH' };
    expect(pick(cash, { ...cash, amount: 900 })).toEqual([]);
    expect(pick({ ...base, status: 'CANCELED' }, { ...base, status: 'CANCELED', paymentMethod: 'CASH' })).toEqual([]);
  });

  it('удалили сделку на перечислении — приходит, если бухгалтер её видел', () => {
    expect(pick(base, { ...base, deleted: true })).toEqual(['deleted']);
    expect(pick(early, { ...early, deleted: true })).toEqual([]);
  });
});

describe('текст уведомления', () => {
  it('смена перечисления — по-русски и срочно', () => {
    const lines = diffAccountingSnapshots(base, { ...base, paymentMethod: 'CASH' });
    expect(buildNotice(lines)).toEqual({ title: 'Перечисление заменили: Наличные', severity: 'URGENT' });
    expect(describeChanges(lines)).toBe('оплата Перечисление → Наличные');
  });

  it('важное идёт первым, даже если строк много', () => {
    const after = {
      ...base,
      paymentMethod: 'CASH',
      amount: 500,
      discount: 10,
      includeVat: false,
      items: [{ ...base.items[0], price: 50, qty: 7 }],
    };
    expect(describeChanges(diffAccountingSnapshots(base, after))).toMatch(/^оплата Перечисление → Наличные;/);
  });

  it('цена списком не превращается в NaN', () => {
    expect(describeChanges([{ kind: 'price', product: 'Плёнка', before: '90 / 100', after: 80 }])).toBe('цена «Плёнка» 90 / 100 → 80');
  });

  it('только деньги — без лишней срочности', () => {
    expect(buildNotice([{ kind: 'paid', before: 0, after: 100 }]).severity).toBe('WARNING');
  });
});

describe('пути админского роутера', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  it('override и удаление отслеживаются, аудит — нет', () => {
    expect(ADMIN_DEAL_OVERRIDE_PATH.exec(`/deals/${id}/override`)?.[1]).toBe(id);
    expect(ADMIN_DEAL_OVERRIDE_PATH.exec(`/deals/${id}`)?.[1]).toBe(id);
    expect(ADMIN_DEAL_OVERRIDE_PATH.exec(`/deals/${id}/audit`)).toBeNull();
    expect(ADMIN_DEAL_OVERRIDE_PATH.exec('/deals/backdated')).toBeNull();
  });
});
