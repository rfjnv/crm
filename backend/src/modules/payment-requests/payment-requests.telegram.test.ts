import { describe, expect, it } from 'vitest';
import { buildPaymentRequestHtml } from './payment-requests.telegram';

type Request = Parameters<typeof buildPaymentRequestHtml>[0];

const base = {
  id: 'r1',
  number: 12,
  status: 'PENDING',
  method: 'TRANSFER',
  amount: 10_000_000,
  note: 'Клиент <срочно>',
  periodFrom: new Date('2026-11-01T00:00:00Z'),
  periodTo: new Date('2026-11-05T00:00:00Z'),
  createdAt: new Date('2026-11-09T05:00:00Z'),
  paidAt: null,
  decisionNote: null,
  client: { companyName: 'ООО Принт', inn: '301234567' },
  deal: { title: 'Сделка #1042', transferInn: '309999999' },
  createdBy: { fullName: 'Дилноза' },
  decidedBy: null,
  items: [{ qty: 4000, price: 2500, lineTotal: 10_000_000, product: { sku: 'СК-ГЛ', name: 'Самоклейка', unit: 'лист' } }],
} as unknown as Request;

describe('buildPaymentRequestHtml', () => {
  it('по перечислению просит счёт-фактуру и берёт ИНН из сделки', () => {
    const html = buildPaymentRequestHtml(base, 'MChJ PRINT');
    expect(html).toContain('Заявка на оплату №12');
    expect(html).toContain('счёт-фактура');
    expect(html).toContain('309999999');
    expect(html).toContain('MChJ PRINT');
    expect(html).toContain('Сделка: <b>Сделка #1042</b>');
    expect(html).toContain('4 000 лист');
    expect(html).toContain('Клиент &lt;срочно&gt;');
    expect(html).toContain('Ждёт бухгалтера');
  });

  it('наличные без документов и ИНН, за период', () => {
    const html = buildPaymentRequestHtml({ ...base, method: 'CASH', deal: null } as unknown as Request, null);
    expect(html).not.toContain('счёт-фактура');
    expect(html).not.toContain('ИНН');
    expect(html).toContain('Период: <b>01.11.2026 — 05.11.2026</b>');
  });

  it('после решения показывает итог', () => {
    const accepted = { ...base, status: 'ACCEPTED', decidedBy: { fullName: 'Бухгалтер' }, paidAt: new Date('2026-11-09T07:00:00Z') };
    expect(buildPaymentRequestHtml(accepted as unknown as Request, null)).toContain('Оплата принята</b>: Бухгалтер, дата оплаты 09.11.2026');
    const rejected = { ...base, status: 'REJECTED', decidedBy: { fullName: 'Бухгалтер' }, decisionNote: 'нет ИНН' };
    expect(buildPaymentRequestHtml(rejected as unknown as Request, null)).toContain('Отклонена</b>: Бухгалтер — нет ИНН');
  });
});
