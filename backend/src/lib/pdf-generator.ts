import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// ---------- Types ----------

export interface ContractForPdf {
  contractNumber: string;
  contractType?: string;
  startDate: Date;
  endDate: Date | null;
  amount: unknown;
  isActive: boolean;
  notes: string | null;
  totalAmount: number;
  totalPaid: number;
  remaining: number;
  client: {
    companyName: string;
    contactName: string;
    phone: string | null;
    address: string | null;
    inn: string | null;
    bankName: string | null;
    bankAccount: string | null;
    mfo: string | null;
    vatRegCode: string | null;
    oked: string | null;
  } | null;
  deals: {
    id: string;
    title: string;
    status: string;
    amount: unknown;
    paidAmount: unknown;
    paymentStatus: string;
    createdAt: Date;
  }[];
}

export interface DealItemForPdf {
  product: { name: string; sku: string; unit: string; countryOfOrigin?: string | null };
  requestedQty: unknown;
  price: unknown;
}

export interface CompanySettingsForPdf {
  companyName: string;
  inn: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  mfo: string;
  director: string;
  logoPath: string | null;
  vatRegCode: string;
  oked: string;
}

export interface PowerOfAttorneyForPdf {
  poaNumber: string;
  poaType: 'ANNUAL' | 'ONE_TIME';
  authorizedPersonName: string;
  authorizedPersonInn: string | null;
  authorizedPersonPosition: string | null;
  validFrom: Date;
  validUntil: Date;
  items: { name: string; unit: string; qty?: number }[];
  contract: { contractNumber: string; startDate: Date };
  client: {
    companyName: string;
    contactName: string;
    phone: string | null;
    address: string | null;
    inn: string | null;
    bankName: string | null;
    bankAccount: string | null;
    mfo: string | null;
    vatRegCode: string | null;
    oked: string | null;
  } | null;
}

export type DocType =
  | 'CONTRACT'
  | 'CONTRACT_ANNUAL'
  | 'CONTRACT_ONE_TIME'
  | 'SPECIFICATION'
  | 'INVOICE'
  | 'POWER_OF_ATTORNEY'
  | 'PACKAGE';

// ---------- Helpers ----------

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMoney(value: unknown): string {
  const num = Number(value) || 0;
  return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getLogoBase64(logoPath: string | null | undefined): string {
  if (!logoPath) return '';
  const fullPath = path.isAbsolute(logoPath) ? logoPath : path.join(process.cwd(), logoPath);
  if (!fs.existsSync(fullPath)) return '';
  const ext = path.extname(fullPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  const mime = mimeMap[ext] || 'image/png';
  const data = fs.readFileSync(fullPath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

// ---------- VAT ----------

const VAT_RATE = 0.12;

interface VatRow {
  num: number;
  name: string;
  sku: string;
  unit: string;
  countryOfOrigin: string;
  qty: number;
  price: number;
  sum: number;
  vatRate: number;
  vatAmount: number;
  totalWithVat: number;
}

function computeItemsWithVat(items: DealItemForPdf[]): {
  rows: VatRow[];
  subtotalBase: number;
  subtotalVat: number;
  grandTotal: number;
} {
  let subtotalBase = 0;
  let subtotalVat = 0;
  const rows = items.map((item, i) => {
    const qty = Number(item.requestedQty) || 0;
    const priceWithVat = Number(item.price) || 0;
    const totalWithVat = Math.round(qty * priceWithVat * 100) / 100;
    const vatAmount = Math.round((totalWithVat * VAT_RATE / (1 + VAT_RATE)) * 100) / 100;
    const sum = Math.round((totalWithVat - vatAmount) * 100) / 100;
    const price = qty > 0 ? Math.round((sum / qty) * 100) / 100 : 0;
    subtotalBase += sum;
    subtotalVat += vatAmount;
    return {
      num: i + 1,
      name: item.product.name,
      sku: item.product.sku,
      unit: item.product.unit,
      countryOfOrigin: item.product.countryOfOrigin || 'Купля-продажа',
      qty,
      price,
      sum,
      vatRate: 12,
      vatAmount,
      totalWithVat,
    };
  });
  return { rows, subtotalBase, subtotalVat, grandTotal: subtotalBase + subtotalVat };
}

// ---------- Shared CSS ----------

const FORMAL_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Times New Roman', 'DejaVu Serif', serif; font-size: 11px; line-height: 1.4; color: #000; padding: 15mm 15mm 15mm 20mm; }
.doc-title { text-align: center; font-size: 16px; font-weight: bold; margin: 15px 0 5px; }
.doc-subtitle { text-align: center; font-size: 12px; margin-bottom: 15px; }
.requisites-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 15px 0; border: 1px solid #000; }
.requisites-col { padding: 8px 10px; }
.requisites-col + .requisites-col { border-left: 1px solid #000; }
.req-row { margin-bottom: 3px; }
.req-label { font-weight: bold; }
.section-num { font-weight: bold; margin: 12px 0 6px; }
.article-text { text-indent: 20px; margin-bottom: 6px; text-align: justify; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10px; }
th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
th { background: #f0f0f0; font-weight: bold; text-align: center; font-size: 9px; }
td.money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.center { text-align: center; }
.totals-row { font-weight: bold; }
.totals-row td { border-top: 2px solid #000; }
.signatures { display: flex; justify-content: space-between; margin-top: 30px; page-break-inside: avoid; }
.signature-block { width: 45%; }
.signature-title { font-weight: bold; margin-bottom: 4px; text-decoration: underline; }
.signature-line { border-bottom: 1px solid #000; height: 25px; margin: 4px 0; }
.signature-hint { font-size: 9px; color: #666; text-align: center; }
.sig-person { margin-bottom: 3px; }
.total-words { margin: 10px 0; font-size: 11px; }
.poa-field { margin: 4px 0; }
.poa-label { font-weight: bold; }
.indent { text-indent: 30px; }
`;

function wrapHtml(bodyContent: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><style>${FORMAL_CSS}</style></head><body>${bodyContent}</body></html>`;
}

// ---------- Template: CONTRACT ANNUAL ----------

export function buildContractAnnualHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
  items: DealItemForPdf[],
): string {
  const { rows, subtotalBase, subtotalVat, grandTotal } = computeItemsWithVat(items);
  const cl = contract.client;
  const endYear = contract.endDate ? new Date(contract.endDate).getFullYear() : new Date().getFullYear();

  const itemRows = rows.map((r) => `
    <tr>
      <td class="center">${r.num}</td>
      <td>${r.name}</td>
      <td class="center">${r.unit}</td>
      <td class="money">${r.qty}</td>
      <td class="money">${formatMoney(r.price)}</td>
      <td class="money">${formatMoney(r.sum)}</td>
      <td class="center">${r.vatRate}%</td>
      <td class="money">${formatMoney(r.vatAmount)}</td>
      <td class="money">${formatMoney(r.totalWithVat)}</td>
    </tr>
  `).join('');

  const body = `
<div class="doc-title">ДОГОВОР № ${contract.contractNumber}</div>
<div class="doc-subtitle">г. Ташкент &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${formatDate(contract.startDate)}</div>

<p class="article-text">
  <strong>${company?.companyName || '_______________'}</strong>, именуемое в дальнейшем «Поставщик», в лице директора
  <strong>${company?.director || '_______________'}</strong>, действующего на основании Устава, с одной стороны, и
  <strong>${cl?.companyName || '_______________'}</strong>, именуемое в дальнейшем «Покупатель», в лице
  <strong>${cl?.contactName || '_______________'}</strong>, действующего на основании Устава, с другой стороны,
  заключили настоящий Договор о нижеследующем:
</p>

<div class="section-num">1. ПРЕДМЕТ ДОГОВОРА</div>
<p class="article-text">1.1. Поставщик обязуется поставить, а Покупатель принять и оплатить товары в ассортименте, количестве и по ценам, указанным в Спецификации, являющейся неотъемлемой частью настоящего Договора.</p>
<p class="article-text">1.2. Наименование, количество, цена и общая стоимость товара:</p>

<table>
  <thead>
    <tr>
      <th>№</th><th>Наименование</th><th>Ед. изм.</th><th>Кол-во</th>
      <th>Цена</th><th>Сумма</th><th>Ставка НДС</th><th>Сумма НДС</th><th>Итого с НДС</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="5" style="text-align: right;">Итого:</td>
      <td class="money">${formatMoney(subtotalBase)}</td>
      <td></td>
      <td class="money">${formatMoney(subtotalVat)}</td>
      <td class="money">${formatMoney(grandTotal)}</td>
    </tr>
  </tbody>
</table>

<div class="section-num">2. УСЛОВИЯ ОПЛАТЫ</div>
<p class="article-text">2.1. Оплата производится путём перечисления денежных средств на расчётный счёт Поставщика в течение 30 (тридцати) банковских дней с момента поставки товара.</p>
<p class="article-text">2.2. Датой оплаты считается дата зачисления денежных средств на расчётный счёт Поставщика.</p>

<div class="section-num">3. УСЛОВИЯ ПОСТАВКИ</div>
<p class="article-text">3.1. Поставка товара осуществляется со склада Поставщика. Доставка товара осуществляется силами и за счёт Покупателя, если иное не оговорено дополнительно.</p>
<p class="article-text">3.2. Право собственности на товар переходит к Покупателю с момента подписания товарно-транспортной накладной.</p>

<div class="section-num">4. ОТВЕТСТВЕННОСТЬ СТОРОН</div>
<p class="article-text">4.1. За несвоевременную оплату Покупатель уплачивает пеню в размере 0,5% от суммы задолженности за каждый день просрочки, но не более 50% от суммы задолженности.</p>
<p class="article-text">4.2. Стороны несут ответственность за неисполнение или ненадлежащее исполнение обязательств в соответствии с законодательством Республики Узбекистан.</p>

<div class="section-num">5. ПОРЯДОК РАЗРЕШЕНИЯ СПОРОВ</div>
<p class="article-text">5.1. Все споры и разногласия решаются путём переговоров. При недостижении согласия споры рассматриваются в хозяйственном суде.</p>

<div class="section-num">6. ФОРС-МАЖОР</div>
<p class="article-text">6.1. Стороны освобождаются от ответственности за полное или частичное неисполнение обязательств, если оно явилось следствием обстоятельств непреодолимой силы.</p>

<div class="section-num">7. ПРОЧИЕ УСЛОВИЯ</div>
<p class="article-text">7.1. Настоящий Договор вступает в силу с момента подписания и действует до 31.12.${endYear}.</p>
<p class="article-text">7.2. Договор составлен в двух экземплярах, по одному для каждой из сторон.</p>
<p class="article-text">7.3. Все изменения и дополнения к настоящему Договору действительны при условии их письменного оформления и подписания обеими сторонами.</p>

${contract.notes ? `<p class="article-text" style="margin-top: 10px;"><strong>Примечание:</strong> ${contract.notes}</p>` : ''}

<div class="section-num">8. РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</div>

<div class="requisites-grid">
  <div class="requisites-col">
    <div class="req-row"><span class="req-label">Поставщик:</span></div>
    <div class="req-row">${company?.companyName || '—'}</div>
    <div class="req-row">ИНН: ${company?.inn || '—'}</div>
    <div class="req-row">Адрес: ${company?.address || '—'}</div>
    <div class="req-row">Р/с: ${company?.bankAccount || '—'}</div>
    <div class="req-row">Банк: ${company?.bankName || '—'}</div>
    <div class="req-row">МФО: ${company?.mfo || '—'}</div>
    ${company?.vatRegCode ? `<div class="req-row">Рег. код НДС: ${company.vatRegCode}</div>` : ''}
    ${company?.oked ? `<div class="req-row">ОКЭД: ${company.oked}</div>` : ''}
    <div class="req-row">Тел: ${company?.phone || '—'}</div>
  </div>
  <div class="requisites-col">
    <div class="req-row"><span class="req-label">Покупатель:</span></div>
    <div class="req-row">${cl?.companyName || '—'}</div>
    <div class="req-row">ИНН: ${cl?.inn || '—'}</div>
    <div class="req-row">Адрес: ${cl?.address || '—'}</div>
    <div class="req-row">Р/с: ${cl?.bankAccount || '—'}</div>
    <div class="req-row">Банк: ${cl?.bankName || '—'}</div>
    <div class="req-row">МФО: ${cl?.mfo || '—'}</div>
    ${cl?.vatRegCode ? `<div class="req-row">Рег. код НДС: ${cl.vatRegCode}</div>` : ''}
    ${cl?.oked ? `<div class="req-row">ОКЭД: ${cl.oked}</div>` : ''}
    <div class="req-row">Тел: ${cl?.phone || '—'}</div>
  </div>
</div>

<div class="signatures">
  <div class="signature-block">
    <div class="signature-title">Поставщик</div>
    ${company?.director ? `<div class="sig-person">${company.director}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
  <div class="signature-block">
    <div class="signature-title">Покупатель</div>
    ${cl?.contactName ? `<div class="sig-person">${cl.contactName}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
</div>
`;

  return wrapHtml(body);
}

// ---------- Template: CONTRACT ONE_TIME (Счёт-Договор) ----------

export function buildContractOneTimeHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
  items: DealItemForPdf[],
): string {
  const { rows, subtotalBase, subtotalVat, grandTotal } = computeItemsWithVat(items);
  const cl = contract.client;

  const itemRows = rows.map((r) => `
    <tr>
      <td class="center">${r.num}</td>
      <td>${r.name}</td>
      <td class="center">${r.unit}</td>
      <td class="money">${r.qty}</td>
      <td class="money">${formatMoney(r.price)}</td>
      <td class="money">${formatMoney(r.sum)}</td>
      <td class="center">${r.vatRate}%</td>
      <td class="money">${formatMoney(r.vatAmount)}</td>
      <td class="money">${formatMoney(r.totalWithVat)}</td>
    </tr>
  `).join('');

  const body = `
<div style="text-align: left; margin-bottom: 15px; font-size: 10px; line-height: 1.6;">
  <strong>${company?.companyName || '—'}</strong><br>
  ИНН: ${company?.inn || '—'} | Р/с: ${company?.bankAccount || '—'}<br>
  Банк: ${company?.bankName || '—'} | МФО: ${company?.mfo || '—'}<br>
  ${company?.vatRegCode ? `Рег. код НДС: ${company.vatRegCode}<br>` : ''}
  Адрес: ${company?.address || '—'} | Тел: ${company?.phone || '—'}
</div>

<div class="doc-title">СЧЁТ-ДОГОВОР № ${contract.contractNumber}</div>
<div class="doc-subtitle">от ${formatDate(contract.startDate)}</div>

<p class="article-text">
  <strong>${company?.companyName || '___'}</strong> (Поставщик) предлагает
  <strong>${cl?.companyName || '___'}</strong> (Покупатель) приобрести товар на следующих условиях:
</p>

<table>
  <thead>
    <tr>
      <th>№</th><th>Наименование</th><th>Ед. изм.</th><th>Кол-во</th>
      <th>Цена</th><th>Сумма</th><th>Ставка НДС</th><th>Сумма НДС</th><th>Итого с НДС</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="5" style="text-align: right;">Итого:</td>
      <td class="money">${formatMoney(subtotalBase)}</td>
      <td></td>
      <td class="money">${formatMoney(subtotalVat)}</td>
      <td class="money">${formatMoney(grandTotal)}</td>
    </tr>
  </tbody>
</table>

<p class="article-text"><strong>Условия оплаты:</strong> Оплата производится в течение 5 (пяти) банковских дней с момента выставления счёта.</p>
<p class="article-text"><strong>Срок поставки:</strong> В течение 3 (трёх) рабочих дней с момента оплаты.</p>
<p class="article-text">Оплата данного счёт-договора означает согласие с условиями поставки товара.</p>

${contract.notes ? `<p class="article-text"><strong>Примечание:</strong> ${contract.notes}</p>` : ''}

<div class="requisites-grid">
  <div class="requisites-col">
    <div class="req-row"><span class="req-label">Поставщик:</span></div>
    <div class="req-row">${company?.companyName || '—'}</div>
    <div class="req-row">ИНН: ${company?.inn || '—'}</div>
    <div class="req-row">Р/с: ${company?.bankAccount || '—'}</div>
    <div class="req-row">Банк: ${company?.bankName || '—'} | МФО: ${company?.mfo || '—'}</div>
  </div>
  <div class="requisites-col">
    <div class="req-row"><span class="req-label">Покупатель:</span></div>
    <div class="req-row">${cl?.companyName || '—'}</div>
    <div class="req-row">ИНН: ${cl?.inn || '—'}</div>
    <div class="req-row">Р/с: ${cl?.bankAccount || '—'}</div>
    <div class="req-row">Банк: ${cl?.bankName || '—'} | МФО: ${cl?.mfo || '—'}</div>
  </div>
</div>

<div class="signatures">
  <div class="signature-block">
    <div class="signature-title">Поставщик</div>
    ${company?.director ? `<div class="sig-person">${company.director}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
  <div class="signature-block">
    <div class="signature-title">Покупатель</div>
    ${cl?.contactName ? `<div class="sig-person">${cl.contactName}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
</div>
`;

  return wrapHtml(body);
}

// ---------- Template: SPECIFICATION ----------

export function buildSpecificationHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
  items: DealItemForPdf[],
): string {
  const { rows, subtotalBase, subtotalVat, grandTotal } = computeItemsWithVat(items);

  const itemRows = rows.map((r) => `
    <tr>
      <td class="center">${r.num}</td>
      <td>${r.name}</td>
      <td class="center">${r.unit}</td>
      <td class="money">${r.qty}</td>
      <td class="money">${formatMoney(r.price)}</td>
      <td class="money">${formatMoney(r.sum)}</td>
      <td class="center">${r.vatRate}%</td>
      <td class="money">${formatMoney(r.vatAmount)}</td>
      <td class="money">${formatMoney(r.totalWithVat)}</td>
    </tr>
  `).join('');

  const body = `
<div style="text-align: left; margin-bottom: 10px; font-size: 10px; line-height: 1.6; border-bottom: 1px solid #000; padding-bottom: 10px;">
  <strong>Банковские реквизиты Поставщика:</strong><br>
  ${company?.companyName || '—'}<br>
  Р/с: ${company?.bankAccount || '—'} | Банк: ${company?.bankName || '—'} | МФО: ${company?.mfo || '—'}<br>
  ИНН: ${company?.inn || '—'}${company?.vatRegCode ? ` | Рег. код НДС: ${company.vatRegCode}` : ''}
</div>

<div class="doc-title">СПЕЦИФИКАЦИЯ</div>
<div class="doc-subtitle">к Договору № ${contract.contractNumber} от ${formatDate(contract.startDate)}</div>

<table>
  <thead>
    <tr>
      <th>№</th><th>Наименование</th><th>Ед. изм.</th><th>Кол-во</th>
      <th>Цена</th><th>Сумма</th><th>Ставка НДС</th><th>Сумма НДС</th><th>Итого с НДС</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="5" style="text-align: right;">Итого:</td>
      <td class="money">${formatMoney(subtotalBase)}</td>
      <td></td>
      <td class="money">${formatMoney(subtotalVat)}</td>
      <td class="money">${formatMoney(grandTotal)}</td>
    </tr>
  </tbody>
</table>

<p class="article-text" style="margin-top: 15px;"><strong>Условия оплаты:</strong> Перечисление на расчётный счёт Поставщика в течение 30 банковских дней с момента поставки.</p>
<p class="article-text"><strong>Срок поставки:</strong> По мере готовности товара на складе Поставщика.</p>

${contract.notes ? `<p class="article-text"><strong>Примечание:</strong> ${contract.notes}</p>` : ''}

<div class="signatures">
  <div class="signature-block">
    <div class="signature-title">Поставщик</div>
    ${company?.director ? `<div class="sig-person">${company.director}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
  <div class="signature-block">
    <div class="signature-title">Покупатель</div>
    ${contract.client?.contactName ? `<div class="sig-person">${contract.client.contactName}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
</div>
`;

  return wrapHtml(body);
}

// ---------- Template: INVOICE (Счёт-Фактура) ----------

export function buildInvoiceHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
  items: DealItemForPdf[],
): string {
  const { rows, subtotalBase, subtotalVat, grandTotal } = computeItemsWithVat(items);
  const cl = contract.client;

  const itemRows = rows.map((r) => `
    <tr>
      <td class="center">${r.num}</td>
      <td>${r.name}</td>
      <td style="font-size: 8px;">${r.sku || '—'}</td>
      <td class="center">${r.unit}</td>
      <td class="money">${r.qty}</td>
      <td class="money">${formatMoney(r.price)}</td>
      <td class="money">${formatMoney(r.sum)}</td>
      <td class="center">${r.vatRate}%</td>
      <td class="money">${formatMoney(r.vatAmount)}</td>
      <td class="money">${formatMoney(r.totalWithVat)}</td>
      <td style="font-size: 8px;">${r.countryOfOrigin}</td>
    </tr>
  `).join('');

  const body = `
<div class="doc-title">Счет-фактура</div>
<div class="doc-subtitle">
  № ${contract.contractNumber} от ${formatDate(contract.startDate)}<br>
  к договору № ${contract.contractNumber} от ${formatDate(contract.startDate)}
</div>

<div class="requisites-grid">
  <div class="requisites-col">
    <div class="req-row"><span class="req-label">Поставщик:</span> ${company?.companyName || '—'}</div>
    <div class="req-row"><span class="req-label">Адрес:</span> ${company?.address || '—'}</div>
    <div class="req-row"><span class="req-label">Идентификационный номер поставщика (ИНН):</span> ${company?.inn || '—'}</div>
    <div class="req-row"><span class="req-label">Регистрационный код плательщика НДС:</span> ${company?.vatRegCode || '—'}</div>
    <div class="req-row"><span class="req-label">Р/С:</span> ${company?.bankAccount || '—'}</div>
    <div class="req-row"><span class="req-label">МФО:</span> ${company?.mfo || '—'}</div>
  </div>
  <div class="requisites-col">
    <div class="req-row"><span class="req-label">Покупатель:</span> ${cl?.companyName || '—'}</div>
    <div class="req-row"><span class="req-label">Адрес:</span> ${cl?.address || '—'}</div>
    <div class="req-row"><span class="req-label">Идентификационный номер покупателя (ИНН):</span> ${cl?.inn || '—'}</div>
    <div class="req-row"><span class="req-label">Регистрационный код плательщика НДС:</span> ${cl?.vatRegCode || '—'}</div>
    <div class="req-row"><span class="req-label">Р/С:</span> ${cl?.bankAccount || '—'}</div>
    <div class="req-row"><span class="req-label">МФО:</span> ${cl?.mfo || '—'}</div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th rowspan="2">№</th>
      <th rowspan="2">Наименование товаров (услуг)</th>
      <th rowspan="2">Идентификационный код по каталогу</th>
      <th rowspan="2">Единица измерения</th>
      <th rowspan="2">Количество</th>
      <th rowspan="2">Цена</th>
      <th rowspan="2">Стоимость поставки</th>
      <th colspan="2">НДС</th>
      <th rowspan="2">Стоимость поставки с учетом НДС</th>
      <th rowspan="2">Происхождение товара</th>
    </tr>
    <tr>
      <th>Ставка</th>
      <th>Сумма</th>
    </tr>
    <tr style="font-size: 8px; text-align: center;">
      <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>10</th><th>11</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="6" style="text-align: right;">Итого</td>
      <td class="money">${formatMoney(subtotalBase)}</td>
      <td></td>
      <td class="money">${formatMoney(subtotalVat)}</td>
      <td class="money">${formatMoney(grandTotal)}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="total-words">
  <strong>Всего к оплате:</strong> ${formatMoney(grandTotal)} сум. в т. ч. НДС: ${formatMoney(subtotalVat)}.
</div>

<div class="requisites-grid" style="border: none; margin-top: 20px;">
  <div class="requisites-col" style="border: none;">
    <div class="sig-person"><strong>Руководитель:</strong> ${company?.director || '________________'}</div>
    <div class="sig-person"><strong>Главный бухгалтер:</strong> ________________</div>
    <div class="sig-person"><strong>Товар отпустил:</strong> ________________</div>
  </div>
  <div class="requisites-col" style="border: none;">
    <div class="sig-person"><strong>Руководитель:</strong> ${cl?.contactName || '________________'}</div>
    <div class="sig-person"><strong>Главный бухгалтер:</strong> ________________</div>
    <div class="sig-person"><strong>Получил:</strong> ________________</div>
  </div>
</div>
`;

  return wrapHtml(body);
}

// ---------- Template: POWER OF ATTORNEY ----------

export function buildPowerOfAttorneyHtml(
  poa: PowerOfAttorneyForPdf,
  company: CompanySettingsForPdf | null,
): string {
  const cl = poa.client;

  const itemRows = poa.items.length > 0
    ? poa.items.map((item, i) => `
        <tr>
          <td class="center">${i + 1}</td>
          <td></td>
          <td>${item.name}</td>
          <td class="center">${item.unit}</td>
          <td class="center">${item.qty != null ? item.qty : '—'}</td>
        </tr>
      `).join('')
    : `<tr><td class="center">1</td><td></td><td>—</td><td>—</td><td>—</td></tr>`;

  const body = `
<div class="doc-title">Доверенность ${poa.poaNumber}</div>

<div style="text-align: center; margin: 20px 0; line-height: 2;">
  <div class="poa-field"><span class="poa-label">Дата выдачи:</span> ${formatDate(poa.validFrom)}</div>
  <div class="poa-field"><span class="poa-label">Доверенность действительна до:</span> ${formatDate(poa.validUntil)}</div>
  <div class="poa-field"><span class="poa-label">Наименование предприятия:</span> ${cl?.companyName || '—'}</div>
  <div class="poa-field"><span class="poa-label">Адрес:</span> ${cl?.address || '—'}</div>
  <div class="poa-field"><span class="poa-label">ИНН/ПИНФЛ:</span> ${cl?.inn || '—'}</div>
  <div class="poa-field"><span class="poa-label">Доверенность выдана: ФИО:</span> ${poa.authorizedPersonName} &nbsp; <span class="poa-label">ИНН/ПИНФЛ:</span> ${poa.authorizedPersonInn || '—'}</div>
  <div class="poa-field"><span class="poa-label">На получение от:</span> ${company?.companyName || '—'}</div>
  <div class="poa-field"><span class="poa-label">Материальных ценностей по договору:</span>№${poa.contract.contractNumber} от ${formatDate(poa.contract.startDate)}</div>
</div>

<div class="doc-title" style="font-size: 13px; margin: 15px 0 10px;">Перечень товарно-материальных ценностей, подлежащих получению</div>

<table>
  <thead>
    <tr>
      <th>Номер по порядку</th>
      <th>Идентификационный код по каталогу</th>
      <th>Наименование товаров</th>
      <th>Единица измерения</th>
      <th>Количество</th>
    </tr>
    <tr style="font-size: 8px; text-align: center;">
      <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<div style="margin-top: 30px; line-height: 2.5;">
  <div>Подпись получившего:____________________ удостоверяем</div>
  <div>Руководитель:____________________${cl?.contactName || ''}</div>
  <div>Глав. бух.:____________________</div>
</div>
`;

  return wrapHtml(body);
}

// ---------- Backward compat: old buildContractHtml ----------

export function buildContractHtml(contract: ContractForPdf, company: CompanySettingsForPdf | null): string {
  // Legacy: delegates to annual with empty items
  return buildContractAnnualHtml(contract, company, []);
}

// ---------- Browser / PDF Generation ----------

async function launchBrowser() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--disable-software-rasterizer',
  ];

  // Try @sparticuz/chromium first (works on Render / serverless)
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const executablePath = await chromium.executablePath();
    return puppeteer.launch({
      args: [...chromium.args, ...args],
      executablePath,
      headless: true,
    });
  } catch {
    // Fallback: try system-installed Chrome / Chromium
    const possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    let executablePath: string | undefined;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) { executablePath = p; break; }
    }
    return puppeteer.launch({
      args,
      executablePath,
      headless: true,
    });
  }
}

export async function generateDocumentPdf(htmlPages: string[]): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const pdfBuffers: Buffer[] = [];

    for (const html of htmlPages) {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfUint8 = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });
      pdfBuffers.push(Buffer.from(pdfUint8));
      await page.close();
    }

    if (pdfBuffers.length === 1) {
      return pdfBuffers[0];
    }

    // Merge multiple PDFs using pdf-lib
    const { PDFDocument } = await import('pdf-lib');
    const mergedPdf = await PDFDocument.create();
    for (const buf of pdfBuffers) {
      const doc = await PDFDocument.load(buf);
      const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => mergedPdf.addPage(p));
    }
    const mergedBytes = await mergedPdf.save();
    return Buffer.from(mergedBytes);
  } finally {
    await browser.close();
  }
}

// Backwards-compat: single-doc generation
export async function generateContractPdf(
  contract: ContractForPdf,
  companySettings: CompanySettingsForPdf | null,
): Promise<Buffer> {
  const html = buildContractHtml(contract, companySettings);
  return generateDocumentPdf([html]);
}

// ---------- Types: Payment Receipt ----------

export interface PaymentReceiptData {
  dealTitle: string;
  dealId: string;
  closedAt: string | null;
  client: {
    companyName: string;
    contactName: string;
    inn: string | null;
    address: string | null;
    phone: string | null;
  } | null;
  manager: { fullName: string } | null;
  items: {
    num: number;
    name: string;
    sku: string;
    unit: string;
    qty: number;
    price: number;
    total: number;
  }[];
  payments: {
    num: number;
    amount: number;
    method: string | null;
    paidAt: string;
    note: string | null;
    creator: string | null;
  }[];
  totalAmount: number;
  totalPaid: number;
  remaining: number;
}

// ---------- Template: PAYMENT RECEIPT ----------

const RECEIPT_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Times New Roman', 'DejaVu Serif', serif; font-size: 11px; line-height: 1.5; color: #000; padding: 12mm 15mm 12mm 15mm; }
.receipt-header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
.receipt-logo { width: 56px; height: 56px; object-fit: contain; }
.receipt-company { flex: 1; font-size: 10px; line-height: 1.5; }
.receipt-company strong { font-size: 13px; }
.receipt-title { text-align: center; font-size: 18px; font-weight: bold; margin: 10px 0 4px; letter-spacing: 1px; }
.receipt-subtitle { text-align: center; font-size: 11px; color: #444; margin-bottom: 14px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin: 12px 0; font-size: 11px; }
.info-grid .label { font-weight: bold; }
.divider { border: none; border-top: 1px solid #ccc; margin: 14px 0; }
.section-title { font-size: 13px; font-weight: bold; margin: 14px 0 6px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10px; }
th, td { border: 1px solid #999; padding: 4px 8px; }
th { background: #f2f2f2; font-weight: bold; text-align: center; font-size: 9.5px; }
td.money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.center { text-align: center; }
.totals-row td { font-weight: bold; border-top: 2px solid #000; }
.summary-box { margin-top: 14px; padding: 10px 14px; border: 1px solid #999; border-radius: 4px; font-size: 12px; display: flex; justify-content: space-between; }
.summary-box .pair { text-align: center; }
.summary-box .pair .val { font-size: 15px; font-weight: bold; }
.stamp-area { margin-top: 36px; display: flex; justify-content: space-between; }
.stamp-block { width: 45%; }
.stamp-line { border-bottom: 1px solid #000; height: 28px; margin: 6px 0 2px; }
.stamp-hint { font-size: 8px; color: #888; text-align: center; }
.footer { margin-top: 20px; text-align: center; font-size: 9px; color: #999; }
`;

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Наличные',
  TRANSFER: 'Перечисление',
  PAYME: 'Payme',
  QR: 'QR',
  CLICK: 'Click',
  TERMINAL: 'Терминал',
  INSTALLMENT: 'Рассрочка',
};

export function buildPaymentReceiptHtml(
  data: PaymentReceiptData,
  company: CompanySettingsForPdf | null,
): string {
  const logoImg = company?.logoPath
    ? `<img class="receipt-logo" src="${getLogoBase64(company.logoPath)}" />`
    : '';

  const itemRows = data.items.map((i) => `
    <tr>
      <td class="center">${i.num}</td>
      <td>${i.name}</td>
      <td style="font-size:8px;">${i.sku}</td>
      <td class="center">${i.unit}</td>
      <td class="money">${i.qty}</td>
      <td class="money">${formatMoney(i.price)}</td>
      <td class="money">${formatMoney(i.total)}</td>
    </tr>
  `).join('');

  const paymentRows = data.payments.map((p) => `
    <tr>
      <td class="center">${p.num}</td>
      <td class="money">${formatMoney(p.amount)}</td>
      <td class="center">${METHOD_LABELS[p.method ?? ''] || p.method || '—'}</td>
      <td class="center">${formatDate(p.paidAt)}</td>
      <td>${p.creator || '—'}</td>
      <td>${p.note || '—'}</td>
    </tr>
  `).join('');

  const body = `
<div class="receipt-header">
  ${logoImg}
  <div class="receipt-company">
    <strong>${company?.companyName || '—'}</strong><br>
    ${company?.address || ''}<br>
    Тел: ${company?.phone || '—'} | ИНН: ${company?.inn || '—'}<br>
    Р/с: ${company?.bankAccount || '—'} | Банк: ${company?.bankName || '—'} | МФО: ${company?.mfo || '—'}
  </div>
</div>

<div class="receipt-title">ЧЕК ОБ ОПЛАТЕ</div>
<div class="receipt-subtitle">Сделка: ${data.dealTitle}</div>

<hr class="divider" />

<div class="info-grid">
  <div><span class="label">Клиент:</span> ${data.client?.companyName || '—'}</div>
  <div><span class="label">ИНН клиента:</span> ${data.client?.inn || '—'}</div>
  <div><span class="label">Контактное лицо:</span> ${data.client?.contactName || '—'}</div>
  <div><span class="label">Адрес:</span> ${data.client?.address || '—'}</div>
  <div><span class="label">Менеджер:</span> ${data.manager?.fullName || '—'}</div>
  <div><span class="label">Дата закрытия:</span> ${data.closedAt ? formatDate(data.closedAt) : 'Не закрыта'}</div>
</div>

<hr class="divider" />

<div class="section-title">Товары</div>
<table>
  <thead>
    <tr>
      <th>№</th><th>Наименование</th><th>Артикул</th><th>Ед.</th><th>Кол-во</th><th>Цена</th><th>Сумма</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="6" style="text-align:right;">Итого:</td>
      <td class="money">${formatMoney(data.totalAmount)}</td>
    </tr>
  </tbody>
</table>

<div class="section-title">Платежи</div>
<table>
  <thead>
    <tr>
      <th>№</th><th>Сумма</th><th>Способ</th><th>Дата</th><th>Кем внесено</th><th>Примечание</th>
    </tr>
  </thead>
  <tbody>
    ${paymentRows}
    <tr class="totals-row">
      <td colspan="1" style="text-align:right;">Итого:</td>
      <td class="money">${formatMoney(data.totalPaid)}</td>
      <td colspan="4"></td>
    </tr>
  </tbody>
</table>

<div class="summary-box">
  <div class="pair">
    <div>Сумма сделки</div>
    <div class="val">${formatMoney(data.totalAmount)}</div>
  </div>
  <div class="pair">
    <div>Оплачено</div>
    <div class="val" style="color:#389e0d;">${formatMoney(data.totalPaid)}</div>
  </div>
  <div class="pair">
    <div>Остаток</div>
    <div class="val" style="color:${data.remaining > 0 ? '#cf1322' : '#389e0d'};">${formatMoney(data.remaining)}</div>
  </div>
</div>

<div class="stamp-area">
  <div class="stamp-block">
    <div style="font-weight:bold;font-size:10px;">Выдал:</div>
    ${company?.director ? `<div style="font-size:10px;">${company.director}</div>` : ''}
    <div class="stamp-line"></div>
    <div class="stamp-hint">подпись / М.П.</div>
  </div>
  <div class="stamp-block">
    <div style="font-weight:bold;font-size:10px;">Получил:</div>
    ${data.client?.contactName ? `<div style="font-size:10px;">${data.client.contactName}</div>` : ''}
    <div class="stamp-line"></div>
    <div class="stamp-hint">подпись</div>
  </div>
</div>

<div class="footer">
  Документ сформирован автоматически. Дата формирования: ${formatDate(new Date())}.
</div>
`;

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><style>${RECEIPT_CSS}</style></head><body>${body}</body></html>`;
}
