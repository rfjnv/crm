import type { CompanySettings, Deal, DealItem } from '../types';
import { integerAmountInWordsRu } from './amountInWordsRu';

const VAT_RATE_PERCENT = 12;

/** На печати всегда это название исполнителя (без ИНН). */
const EXECUTOR_PRINT_NAME = 'Polygraph Business';

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

/** Сумма прописью: только целая часть, без «00» в конце. Дробная часть — цифрами, если не ноль. */
function amountWordsLine(total: number): string {
  const intPart = Math.floor(total);
  const tetiy = Math.round((total - intPart) * 100);
  const words = integerAmountInWordsRu(intPart);
  const base = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  if (tetiy === 0) return base;
  return `${base} ${String(tetiy).padStart(2, '0')}`;
}

/** Печать «Заказ покупателя» в стиле накладной (A4, узкие поля, без колонки «Код»). */
export function printDealWaybillA5(deal: Deal, _company: CompanySettings | null): void {
  void _company;
  const docNo = deal.shipment?.deliveryNoteNumber?.trim() || deal.contract?.contractNumber || deal.id.slice(0, 8).toUpperCase();
  const docDateRaw = deal.closedAt || deal.shipment?.shippedAt || deal.createdAt;
  const docDate = new Date(docDateRaw);
  const dateStr = docDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' });

  const executorLine = EXECUTOR_PRINT_NAME;

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
          <td class="num">${formatSumRu(qty)}</td>
          <td>${escapeHtml(it.product?.unit ?? '')}</td>
          <td class="num">${formatSumRu(price)}</td>
          <td class="num">${formatSumRu(sum)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" style="text-align:center">Нет позиций</td></tr>`;

  const totalFromItems = items.reduce((a, it) => a + lineAmount(it), 0);
  const total = totalFromItems > 0 ? totalFromItems : parseNum(deal.amount);
  const includeVat = deal.includeVat !== false;
  const vat = vatIncludedFromTotal(total, includeVat);
  const wordsLine = amountWordsLine(total);

  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/>
<title>Заказ покупателя № ${escapeHtml(String(docNo))}</title>
<style>
  @page { size: A4 portrait; margin: 4mm 5mm 6mm 5mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; width: 100%; }
  h1 { font-size: 12pt; text-align: center; margin: 0 0 6px; padding: 0; font-weight: bold; }
  .rule { border-bottom: 1px solid #000; margin: 4px 0; }
  .pair { margin: 3px 0; line-height: 1.35; }
  .label { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9pt; table-layout: fixed; }
  th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; word-wrap: break-word; }
  th { background: #f5f5f5; font-weight: bold; text-align: center; }
  td.num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 8px; text-align: right; font-size: 10pt; }
  .totals div { margin: 2px 0; }
  .summary { margin-top: 8px; font-size: 9.5pt; line-height: 1.4; }
  .words { font-weight: bold; margin-top: 4px; }
  .sign-row { display: flex; justify-content: space-between; gap: 20px; margin-top: 14px; }
  .sign-col { flex: 1; }
  .line { border-bottom: 1px solid #000; min-height: 22px; margin-top: 16px; }
  .hint { font-size: 7.5pt; color: #444; margin-top: 2px; }
  @media print { html, body { margin: 0 !important; padding: 0 !important; } }
</style></head><body>
  <h1>Заказ покупателя № ${escapeHtml(String(docNo))} от ${escapeHtml(String(dateStr))}</h1>
  <div class="rule"></div>
  <div class="pair"><span class="label">Исполнитель:</span> ${escapeHtml(executorLine)}</div>
  <div class="pair"><span class="label">Заказчик:</span> ${escapeHtml(customerBlock)}</div>
  <table>
    <thead><tr>
      <th style="width:3%">№</th>
      <th style="width:9%">Дата</th>
      <th style="width:40%">Товары (работы, услуги)</th>
      <th style="width:11%">Кол-во</th>
      <th style="width:8%">Ед.</th>
      <th style="width:14%">Цена</th>
      <th style="width:15%">Сумма</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totals">
    <div><strong>Итого:</strong> ${formatSumRu(total)}</div>
    <div>${includeVat ? `<strong>В том числе НДС (${VAT_RATE_PERCENT}%):</strong> ${formatSumRu(vat)}` : 'Без НДС'}</div>
  </div>
  <div class="summary">
    Всего наименований ${items.length}, на сумму ${formatSumRu(total)} UZS
    <div class="words">${escapeHtml(wordsLine)}</div>
  </div>
  <div class="rule" style="margin-top:10px"></div>
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

  const w = window.open('', '_blank', 'width=900,height=1100');
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
