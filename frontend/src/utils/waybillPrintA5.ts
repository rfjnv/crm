import type { CompanySettings, Deal, DealItem } from '../types';
import { integerAmountInWordsRu } from './amountInWordsRu';

const VAT_RATE_PERCENT = 12;

function formatSumRu(value: number): string {
  const [int, frac] = value.toFixed(2).split('.');
  const intSpaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${intSpaced},${frac}`;
}

function parseNum(s: string | null | undefined): number {
  if (s == null || s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function lineAmount(it: DealItem): number {
  const qty = Number(it.requestedQty ?? 0);
  const price = parseNum(it.price);
  return Math.round(qty * price * 100) / 100;
}

function vatIncludedFromTotal(total: number, includeVat: boolean): number {
  if (!includeVat || total <= 0) return 0;
  return Math.round((total * VAT_RATE_PERCENT) / (100 + VAT_RATE_PERCENT) * 100) / 100;
}

/** Печать «Заказ покупателя» в стиле накладной, формат A5. */
export function printDealWaybillA5(deal: Deal, company: CompanySettings | null): void {
  const docNo = deal.shipment?.deliveryNoteNumber?.trim() || deal.contract?.contractNumber || deal.id.slice(0, 8).toUpperCase();
  const docDateRaw = deal.closedAt || deal.shipment?.shippedAt || deal.createdAt;
  const docDate = new Date(docDateRaw);
  const dateStr = docDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' });

  const executorName = company?.companyName?.trim() || '—';
  const executorInn = company?.inn?.trim() || '—';
  const executorKpp = company?.vatRegCode?.trim();
  const executorLine = executorKpp
    ? `${executorName}, ИНН ${executorInn}, КПП ${executorKpp}`
    : `${executorName}, ИНН ${executorInn}`;

  const client = deal.client;
  const customerLine = client?.companyName?.trim() || client?.contactName?.trim() || '—';
  const customerInn = client?.inn?.trim();
  const customerBlock = customerInn ? `${customerLine}, ИНН ${customerInn}` : customerLine;

  const items = deal.items ?? [];
  const rowsHtml = items.length
    ? items.map((it, idx) => {
        const qty = Number(it.requestedQty ?? 0);
        const price = parseNum(it.price);
        const sum = lineAmount(it);
        const rawYmd = (it.dealDate || docDateRaw).slice(0, 10);
        const [yy, mm, dd] = rawYmd.split('-');
        const dateShort = yy && mm && dd ? `${dd}.${mm}.${yy.slice(2)}` : '—';
        return `<tr>
          <td>${idx + 1}</td>
          <td>${dateShort}</td>
          <td>${escapeHtml(it.product?.name ?? '—')}</td>
          <td>${escapeHtml(it.product?.sku || '—')}</td>
          <td class="num">${formatSumRu(qty)}</td>
          <td>${escapeHtml(it.product?.unit ?? '')}</td>
          <td class="num">${formatSumRu(price)}</td>
          <td class="num">${formatSumRu(sum)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="8" style="text-align:center">Нет позиций</td></tr>`;

  const totalFromItems = items.reduce((a, it) => a + lineAmount(it), 0);
  const total = totalFromItems > 0 ? totalFromItems : parseNum(deal.amount);
  const includeVat = deal.includeVat !== false;
  const vat = vatIncludedFromTotal(total, includeVat);
  const intPart = Math.floor(total);
  const tetiy = Math.round((total - intPart) * 100);
  const words = integerAmountInWordsRu(intPart);
  const wordsLine = `${words.charAt(0).toUpperCase()}${words.slice(1)} ${String(tetiy).padStart(2, '0')}`;

  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/>
<title>Заказ покупателя № ${escapeHtml(String(docNo))}</title>
<style>
  @page { size: A5 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; margin: 0; padding: 8px; }
  h1 { font-size: 11pt; text-align: center; margin: 0 0 8px; font-weight: bold; }
  .rule { border-bottom: 1px solid #000; margin: 6px 0; }
  .pair { margin: 4px 0; line-height: 1.35; }
  .label { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 8.5pt; }
  th, td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  th { background: #f5f5f5; font-weight: bold; text-align: center; }
  td.num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 8px; text-align: right; font-size: 9.5pt; }
  .totals div { margin: 2px 0; }
  .summary { margin-top: 10px; font-size: 9pt; line-height: 1.4; }
  .words { font-weight: bold; margin-top: 4px; }
  .sign { margin-top: 16px; font-size: 9pt; }
  .sign-row { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; }
  .sign-col { flex: 1; }
  .line { border-bottom: 1px solid #000; min-height: 22px; margin-top: 18px; }
  .hint { font-size: 7.5pt; color: #444; margin-top: 2px; }
  @media print { body { padding: 0; } }
</style></head><body>
  <h1>Заказ покупателя № ${escapeHtml(String(docNo))} от ${escapeHtml(String(dateStr))}</h1>
  <div class="rule"></div>
  <div class="pair"><span class="label">Исполнитель:</span> ${escapeHtml(executorLine)}</div>
  <div class="pair"><span class="label">Заказчик:</span> ${escapeHtml(customerBlock)}</div>
  <table>
    <thead><tr>
      <th style="width:22px">№</th>
      <th style="width:52px">Дата</th>
      <th>Товары (работы, услуги)</th>
      <th style="width:56px">Код</th>
      <th style="width:48px">Кол-во</th>
      <th style="width:36px">Ед.</th>
      <th style="width:64px">Цена</th>
      <th style="width:72px">Сумма</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totals">
    <div><strong>Итого:</strong> ${formatSumRu(total)}</div>
    <div>${includeVat ? `<strong>В том числе НДС (${VAT_RATE_PERCENT}%):</strong> ${formatSumRu(vat)}` : 'Без НДС'}</div>
  </div>
  <div class="summary">
    Всего наименований ${items.length}, на сумму ${formatSumRu(total)} UZS
    <div class="words">${wordsLine}</div>
  </div>
  <div class="rule" style="margin-top:12px"></div>
  <div class="sign-row">
    <div class="sign-col">
      <div class="label">Исполнитель</div>
      <div class="line"></div>
      <div class="hint">расшифровка подписи</div>
    </div>
    <div class="sign-col">
      <div class="label">Заказчик</div>
      <div class="line"></div>
      <div class="hint">расшифровка подписи</div>
    </div>
  </div>
</body></html>`;

  const w = window.open('', '_blank', 'width=640,height=900');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 300);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
