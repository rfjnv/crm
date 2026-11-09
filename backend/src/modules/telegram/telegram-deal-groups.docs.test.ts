import { describe, expect, it } from 'vitest';
import { HOLD_FOR_DOCS_SINCE, buildProductionGroupHtml, isHeldForDocs, transferDocsLine } from './telegram-deal-groups.service';

const deal = {
  title: 'Сделка #1042',
  paymentMethod: 'TRANSFER' as const,
  paymentType: 'FULL' as const,
  amount: 1000,
  paidAmount: 0,
  paymentStatus: 'UNPAID' as const,
  dueDate: null,
  terms: null,
  client: { companyName: 'ООО Принт', contactName: null },
  manager: { fullName: 'Дилноза Каримова' },
  items: [{ requestedQty: 10, product: { name: 'Самоклейка', unit: 'лист' } }],
  comments: [],
  transferDocuments: JSON.stringify(['Договор', 'Счет-фактура']),
  docsReadyAt: null as Date | null,
};

describe('индикатор документов по перечислению', () => {
  it('не готовы — пишет, какие нужны', () => {
    expect(transferDocsLine(deal)).toBe('📄 <b>Документы (перечисление):</b> ❗ ещё не готовы — нужны: Договор, Счет-фактура');
  });

  it('готовы', () => {
    expect(transferDocsLine({ ...deal, docsReadyAt: new Date() })).toContain('✅ готовы');
  });

  it('не перечисление — строки нет', () => {
    expect(transferDocsLine({ ...deal, paymentMethod: 'CASH' })).toBeNull();
  });

  it('стоит сразу под заголовком поста производства', () => {
    const lines = buildProductionGroupHtml(deal, 'ЗАГОЛОВОК', false).split('\n');
    expect(lines[0]).toBe('ЗАГОЛОВОК');
    expect(lines[1]).toBe('');
    expect(lines[2]).toContain('Документы (перечисление)');
  });
});

describe('задержка сделки на перечисление до документов', () => {
  const after = new Date(HOLD_FOR_DOCS_SINCE.getTime() + 60_000);
  const before = new Date(HOLD_FOR_DOCS_SINCE.getTime() - 60_000);

  it('новая сделка на перечисление без документов — задержана', () => {
    expect(isHeldForDocs({ paymentMethod: 'TRANSFER', docsReadyAt: null, createdAt: after })).toBe(true);
  });

  it('документы готовы — уходит в группу', () => {
    expect(isHeldForDocs({ paymentMethod: 'TRANSFER', docsReadyAt: new Date(), createdAt: after })).toBe(false);
  });

  it('другой способ оплаты или способ ещё не выбран — не задерживаем', () => {
    expect(isHeldForDocs({ paymentMethod: 'CASH', docsReadyAt: null, createdAt: after })).toBe(false);
    expect(isHeldForDocs({ paymentMethod: null, docsReadyAt: null, createdAt: after })).toBe(false);
  });

  it('сделки, созданные до правила, не трогаем', () => {
    expect(isHeldForDocs({ paymentMethod: 'TRANSFER', docsReadyAt: null, createdAt: before })).toBe(false);
  });
});
