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
  product: { name: string; sku: string; unit: string };
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
}

export type DocType = 'CONTRACT' | 'SPECIFICATION' | 'INVOICE' | 'POWER_OF_ATTORNEY' | 'PACKAGE';

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

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    NEW: 'Новая', IN_PROGRESS: 'В работе',
    WAITING_STOCK_CONFIRMATION: 'Ожид. склад', STOCK_CONFIRMED: 'Склад подтв.',
    WAITING_FINANCE: 'Ожид. финансы', FINANCE_APPROVED: 'Финансы ок',
    ADMIN_APPROVED: 'Одобрена', READY_FOR_SHIPMENT: 'К отгрузке',
    SHIPMENT_ON_HOLD: 'Отгр. задержка', SHIPPED: 'Отгружена',
    CLOSED: 'Закрыта', CANCELED: 'Отменена', REJECTED: 'Отклонена',
  };
  return map[status] || status;
}

function paymentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    UNPAID: 'Не оплачено', PARTIAL: 'Частично', PAID: 'Оплачено',
  };
  return map[status] || status;
}

function computeItemsTotals(items: DealItemForPdf[]) {
  let subtotal = 0;
  const rows = items.map((item, i) => {
    const qty = Number(item.requestedQty) || 0;
    const price = Number(item.price) || 0;
    const sum = qty * price;
    subtotal += sum;
    return { num: i + 1, name: item.product.name, sku: item.product.sku, unit: item.product.unit, qty, price, sum };
  });
  return { rows, subtotal };
}

// ---------- Shared CSS ----------

const BASE_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #333; padding: 40px 50px; }
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 2px solid #22609A; padding-bottom: 20px; }
.header-left { flex: 1; }
.logo { max-height: 70px; max-width: 200px; margin-bottom: 8px; }
.company-name { font-size: 16px; font-weight: bold; color: #22609A; margin-bottom: 4px; }
.company-details { font-size: 10px; color: #666; line-height: 1.6; }
.header-right { text-align: right; font-size: 10px; color: #666; }
.doc-title { text-align: center; font-size: 18px; font-weight: bold; margin: 20px 0 5px; color: #22609A; }
.doc-subtitle { text-align: center; font-size: 11px; color: #888; margin-bottom: 25px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; }
.info-block { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; padding: 12px 15px; }
.info-block-title { font-size: 10px; text-transform: uppercase; color: #888; margin-bottom: 6px; letter-spacing: 0.5px; }
.info-row { display: flex; justify-content: space-between; margin-bottom: 3px; }
.info-label { color: #666; }
.info-value { font-weight: 600; }
.summary-row { display: flex; justify-content: space-around; margin: 20px 0; padding: 15px; background: #f0f6ff; border-radius: 6px; border: 1px solid #d0e0f0; }
.summary-item { text-align: center; }
.summary-label { font-size: 10px; color: #666; text-transform: uppercase; }
.summary-value { font-size: 16px; font-weight: bold; color: #22609A; }
.summary-value.paid { color: #52c41a; }
.summary-value.remaining { color: #ff4d4f; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 25px; font-size: 11px; }
th { background: #22609A; color: white; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; }
td { padding: 7px 10px; border-bottom: 1px solid #e9ecef; }
tr:nth-child(even) td { background: #f8f9fa; }
.money { text-align: right; font-variant-numeric: tabular-nums; }
.section-title { font-size: 13px; font-weight: bold; color: #22609A; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e9ecef; }
.signatures { display: flex; justify-content: space-between; margin-top: 50px; padding-top: 20px; }
.signature-block { width: 45%; }
.signature-title { font-size: 11px; font-weight: bold; margin-bottom: 4px; color: #22609A; }
.signature-line { border-bottom: 1px solid #333; height: 30px; margin-bottom: 4px; }
.signature-hint { font-size: 9px; color: #999; text-align: center; }
.notes { margin: 15px 0; padding: 10px 15px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 4px; font-size: 11px; }
.footer { margin-top: 30px; text-align: center; font-size: 9px; color: #aaa; }
.totals-row { font-weight: bold; background: #f0f6ff !important; }
.totals-row td { border-top: 2px solid #22609A; }
`;

// ---------- Shared Blocks ----------

function headerBlock(company: CompanySettingsForPdf | null): string {
  const logoSrc = getLogoBase64(company?.logoPath);
  const hasCompany = company && company.companyName;
  return `<div class="header">
  <div class="header-left">
    ${logoSrc ? `<img src="${logoSrc}" class="logo" alt="logo">` : ''}
    ${hasCompany ? `<div class="company-name">${company!.companyName}</div>` : ''}
    <div class="company-details">
      ${company?.inn ? `ИНН: ${company.inn}<br>` : ''}
      ${company?.address ? `${company.address}<br>` : ''}
      ${company?.phone ? `Тел: ${company.phone}` : ''}${company?.email ? ` · ${company.email}` : ''}
    </div>
  </div>
  <div class="header-right">
    ${company?.bankName ? `Банк: ${company.bankName}<br>` : ''}
    ${company?.bankAccount ? `Р/с: ${company.bankAccount}<br>` : ''}
    ${company?.mfo ? `МФО: ${company.mfo}` : ''}
  </div>
</div>`;
}

function partiesBlock(contract: ContractForPdf, company: CompanySettingsForPdf | null): string {
  const hasCompany = company && company.companyName;
  return `<div class="info-grid">
  <div class="info-block">
    <div class="info-block-title">Поставщик</div>
    ${hasCompany ? `
      <div class="info-row"><span class="info-value">${company!.companyName}</span></div>
      ${company!.address ? `<div class="info-row"><span class="info-label">${company!.address}</span></div>` : ''}
      ${company!.director ? `<div class="info-row"><span class="info-label">Директор:</span><span class="info-value">${company!.director}</span></div>` : ''}
    ` : '<div class="info-row"><span class="info-label">Не указан</span></div>'}
  </div>
  <div class="info-block">
    <div class="info-block-title">Покупатель</div>
    ${contract.client ? `
      <div class="info-row"><span class="info-value">${contract.client.companyName}</span></div>
      ${contract.client.contactName ? `<div class="info-row"><span class="info-label">Контакт:</span><span class="info-value">${contract.client.contactName}</span></div>` : ''}
      ${contract.client.phone ? `<div class="info-row"><span class="info-label">Тел:</span><span class="info-value">${contract.client.phone}</span></div>` : ''}
      ${contract.client.address ? `<div class="info-row"><span class="info-label">${contract.client.address}</span></div>` : ''}
    ` : '<div class="info-row"><span class="info-label">Не указан</span></div>'}
  </div>
</div>`;
}

function signaturesBlock(contract: ContractForPdf, company: CompanySettingsForPdf | null): string {
  return `<div class="signatures">
  <div class="signature-block">
    <div class="signature-title">Поставщик</div>
    ${company?.director ? `<div style="margin-bottom: 4px;">${company.director}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
  <div class="signature-block">
    <div class="signature-title">Покупатель</div>
    ${contract.client?.contactName ? `<div style="margin-bottom: 4px;">${contract.client.contactName}</div>` : ''}
    <div class="signature-line"></div>
    <div class="signature-hint">подпись / М.П.</div>
  </div>
</div>`;
}

function footerBlock(): string {
  return `<div class="footer">Документ сформирован ${formatDate(new Date())} · Polygraph Business CRM</div>`;
}

function wrapHtml(bodyContent: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${bodyContent}</body></html>`;
}

// ---------- Template: CONTRACT ----------

export function buildContractHtml(contract: ContractForPdf, company: CompanySettingsForPdf | null): string {
  const dealsRows = contract.deals.map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${d.title || d.id.slice(0, 8)}</td>
      <td>${statusLabel(d.status)}</td>
      <td class="money">${formatMoney(d.amount)}</td>
      <td class="money">${formatMoney(d.paidAmount)}</td>
      <td>${paymentStatusLabel(d.paymentStatus)}</td>
    </tr>
  `).join('');

  const body = `
${headerBlock(company)}

<div class="doc-title">ДОГОВОР ${contract.contractNumber}</div>
<div class="doc-subtitle">
  от ${formatDate(contract.startDate)}
  ${contract.endDate ? ` по ${formatDate(contract.endDate)}` : ''}
  · ${contract.isActive ? 'Действующий' : 'Закрыт'}
</div>

${partiesBlock(contract, company)}

<div class="summary-row">
  <div class="summary-item"><div class="summary-label">Сумма договора</div><div class="summary-value">${formatMoney(contract.amount)} сум</div></div>
  <div class="summary-item"><div class="summary-label">Сумма сделок</div><div class="summary-value">${formatMoney(contract.totalAmount)} сум</div></div>
  <div class="summary-item"><div class="summary-label">Оплачено</div><div class="summary-value paid">${formatMoney(contract.totalPaid)} сум</div></div>
  <div class="summary-item"><div class="summary-label">Остаток</div><div class="summary-value ${contract.remaining > 0 ? 'remaining' : 'paid'}">${formatMoney(contract.remaining)} сум</div></div>
</div>

${contract.notes ? `<div class="notes"><strong>Примечание:</strong> ${contract.notes}</div>` : ''}

${contract.deals.length > 0 ? `
  <div class="section-title">Сделки (${contract.deals.length})</div>
  <table>
    <thead><tr><th>#</th><th>Сделка</th><th>Статус</th><th class="money">Сумма</th><th class="money">Оплачено</th><th>Оплата</th></tr></thead>
    <tbody>${dealsRows}</tbody>
  </table>
` : ''}

${signaturesBlock(contract, company)}
${footerBlock()}
`;

  return wrapHtml(body);
}

// ---------- Template: SPECIFICATION ----------

export function buildSpecificationHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
  items: DealItemForPdf[],
): string {
  const { rows, subtotal } = computeItemsTotals(items);

  const itemRows = rows.map((r) => `
    <tr>
      <td>${r.num}</td>
      <td>${r.name}</td>
      <td>${r.sku}</td>
      <td>${r.unit}</td>
      <td class="money">${r.qty}</td>
      <td class="money">${formatMoney(r.price)}</td>
      <td class="money">${formatMoney(r.sum)}</td>
    </tr>
  `).join('');

  const body = `
${headerBlock(company)}

<div class="doc-title">СПЕЦИФИКАЦИЯ</div>
<div class="doc-subtitle">к Договору ${contract.contractNumber} от ${formatDate(contract.startDate)}</div>

${partiesBlock(contract, company)}

<table>
  <thead>
    <tr>
      <th>#</th><th>Наименование</th><th>Артикул</th><th>Ед. изм.</th>
      <th class="money">Кол-во</th><th class="money">Цена</th><th class="money">Сумма</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="6" style="text-align: right;">Итого:</td>
      <td class="money">${formatMoney(subtotal)}</td>
    </tr>
  </tbody>
</table>

${signaturesBlock(contract, company)}
${footerBlock()}
`;

  return wrapHtml(body);
}

// ---------- Template: INVOICE ----------

export function buildInvoiceHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
  items: DealItemForPdf[],
): string {
  const { rows, subtotal } = computeItemsTotals(items);

  const itemRows = rows.map((r) => `
    <tr>
      <td>${r.num}</td>
      <td>${r.name}</td>
      <td>${r.unit}</td>
      <td class="money">${r.qty}</td>
      <td class="money">${formatMoney(r.price)}</td>
      <td class="money">${formatMoney(r.sum)}</td>
    </tr>
  `).join('');

  const body = `
${headerBlock(company)}

<div class="doc-title">СЧЁТ-ФАКТУРА</div>
<div class="doc-subtitle">к Договору ${contract.contractNumber} от ${formatDate(contract.startDate)}</div>

<div class="info-grid">
  <div class="info-block">
    <div class="info-block-title">Поставщик</div>
    ${company ? `
      <div class="info-row"><span class="info-value">${company.companyName}</span></div>
      ${company.inn ? `<div class="info-row"><span class="info-label">ИНН:</span><span class="info-value">${company.inn}</span></div>` : ''}
      ${company.bankAccount ? `<div class="info-row"><span class="info-label">Р/с:</span><span class="info-value">${company.bankAccount}</span></div>` : ''}
      ${company.bankName ? `<div class="info-row"><span class="info-label">Банк:</span><span class="info-value">${company.bankName}</span></div>` : ''}
      ${company.mfo ? `<div class="info-row"><span class="info-label">МФО:</span><span class="info-value">${company.mfo}</span></div>` : ''}
    ` : '<div class="info-row"><span class="info-label">Не указан</span></div>'}
  </div>
  <div class="info-block">
    <div class="info-block-title">Покупатель</div>
    ${contract.client ? `
      <div class="info-row"><span class="info-value">${contract.client.companyName}</span></div>
      ${contract.client.contactName ? `<div class="info-row"><span class="info-label">Контакт:</span><span class="info-value">${contract.client.contactName}</span></div>` : ''}
      ${contract.client.phone ? `<div class="info-row"><span class="info-label">Тел:</span><span class="info-value">${contract.client.phone}</span></div>` : ''}
      ${contract.client.address ? `<div class="info-row"><span class="info-label">Адрес:</span><span class="info-value">${contract.client.address}</span></div>` : ''}
    ` : '<div class="info-row"><span class="info-label">Не указан</span></div>'}
  </div>
</div>

<div class="summary-row">
  <div class="summary-item"><div class="summary-label">К оплате</div><div class="summary-value">${formatMoney(subtotal)} сум</div></div>
  <div class="summary-item"><div class="summary-label">Оплачено</div><div class="summary-value paid">${formatMoney(contract.totalPaid)} сум</div></div>
  <div class="summary-item"><div class="summary-label">Остаток</div><div class="summary-value ${contract.remaining > 0 ? 'remaining' : 'paid'}">${formatMoney(contract.remaining)} сум</div></div>
</div>

<table>
  <thead>
    <tr>
      <th>#</th><th>Наименование</th><th>Ед. изм.</th>
      <th class="money">Кол-во</th><th class="money">Цена</th><th class="money">Сумма</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="totals-row">
      <td colspan="5" style="text-align: right;">Итого:</td>
      <td class="money">${formatMoney(subtotal)}</td>
    </tr>
  </tbody>
</table>

${signaturesBlock(contract, company)}
${footerBlock()}
`;

  return wrapHtml(body);
}

// ---------- Template: POWER OF ATTORNEY ----------

export function buildPowerOfAttorneyHtml(
  contract: ContractForPdf,
  company: CompanySettingsForPdf | null,
): string {
  const body = `
${headerBlock(company)}

<div class="doc-title">ДОВЕРЕННОСТЬ</div>
<div class="doc-subtitle">к Договору ${contract.contractNumber} от ${formatDate(contract.startDate)}</div>

<div style="margin: 30px 0; line-height: 2; font-size: 13px;">
  <p>${company?.companyName || '_______________'}, в лице директора ${company?.director || '_______________'},
  действующего на основании Устава, настоящим уполномочивает:</p>

  <div style="margin: 20px 0; padding: 15px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px;">
    <div class="info-row" style="margin-bottom: 8px;">
      <span class="info-label">ФИО доверенного лица:</span>
      <span class="info-value">${contract.client?.contactName || '_______________'}</span>
    </div>
    <div class="info-row" style="margin-bottom: 8px;">
      <span class="info-label">Организация:</span>
      <span class="info-value">${contract.client?.companyName || '_______________'}</span>
    </div>
  </div>

  <p>на получение товарно-материальных ценностей по Договору <strong>${contract.contractNumber}</strong>
  от ${formatDate(contract.startDate)}${contract.endDate ? ` по ${formatDate(contract.endDate)}` : ''},
  а также подписание всех необходимых документов, связанных с исполнением данного Договора.</p>

  <p style="margin-top: 15px;">Сумма по Договору: <strong>${formatMoney(contract.amount)} сум</strong></p>

  <p style="margin-top: 20px; font-size: 11px; color: #666;">
    Доверенность действительна до ${contract.endDate ? formatDate(contract.endDate) : '_______________'}.
  </p>
</div>

${signaturesBlock(contract, company)}
${footerBlock()}
`;

  return wrapHtml(body);
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

    // Merge multiple PDFs using PDF-lib-free approach: concatenate via pages
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
