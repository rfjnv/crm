import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

interface ContractForPdf {
  contractNumber: string;
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

interface CompanySettingsData {
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

type CompanySettingsForPdf = CompanySettingsData | null;

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
    NEW: 'Новая',
    IN_PROGRESS: 'В работе',
    WAITING_STOCK_CONFIRMATION: 'Ожид. склад',
    STOCK_CONFIRMED: 'Склад подтв.',
    WAITING_FINANCE: 'Ожид. финансы',
    FINANCE_APPROVED: 'Финансы ок',
    ADMIN_APPROVED: 'Одобрена',
    READY_FOR_SHIPMENT: 'К отгрузке',
    SHIPMENT_ON_HOLD: 'Отгр. задержка',
    SHIPPED: 'Отгружена',
    CLOSED: 'Закрыта',
    CANCELED: 'Отменена',
    REJECTED: 'Отклонена',
  };
  return map[status] || status;
}

function paymentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    UNPAID: 'Не оплачено',
    PARTIAL: 'Частично',
    PAID: 'Оплачено',
  };
  return map[status] || status;
}

function buildHtml(contract: ContractForPdf, company: CompanySettingsForPdf): string {
  const logoSrc = getLogoBase64(company?.logoPath);
  const hasCompany = company && company.companyName;

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

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 12px;
    line-height: 1.5;
    color: #333;
    padding: 40px 50px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 30px;
    border-bottom: 2px solid #22609A;
    padding-bottom: 20px;
  }
  .header-left {
    flex: 1;
  }
  .logo {
    max-height: 70px;
    max-width: 200px;
    margin-bottom: 8px;
  }
  .company-name {
    font-size: 16px;
    font-weight: bold;
    color: #22609A;
    margin-bottom: 4px;
  }
  .company-details {
    font-size: 10px;
    color: #666;
    line-height: 1.6;
  }
  .header-right {
    text-align: right;
    font-size: 10px;
    color: #666;
  }
  .contract-title {
    text-align: center;
    font-size: 18px;
    font-weight: bold;
    margin: 20px 0 5px;
    color: #22609A;
  }
  .contract-subtitle {
    text-align: center;
    font-size: 11px;
    color: #888;
    margin-bottom: 25px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    margin-bottom: 25px;
  }
  .info-block {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 4px;
    padding: 12px 15px;
  }
  .info-block-title {
    font-size: 10px;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 6px;
    letter-spacing: 0.5px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 3px;
  }
  .info-label {
    color: #666;
  }
  .info-value {
    font-weight: 600;
  }
  .summary-row {
    display: flex;
    justify-content: space-around;
    margin: 20px 0;
    padding: 15px;
    background: #f0f6ff;
    border-radius: 6px;
    border: 1px solid #d0e0f0;
  }
  .summary-item {
    text-align: center;
  }
  .summary-label {
    font-size: 10px;
    color: #666;
    text-transform: uppercase;
  }
  .summary-value {
    font-size: 16px;
    font-weight: bold;
    color: #22609A;
  }
  .summary-value.paid { color: #52c41a; }
  .summary-value.remaining { color: #ff4d4f; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 25px;
    font-size: 11px;
  }
  th {
    background: #22609A;
    color: white;
    padding: 8px 10px;
    text-align: left;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid #e9ecef;
  }
  tr:nth-child(even) td {
    background: #f8f9fa;
  }
  .money { text-align: right; font-variant-numeric: tabular-nums; }
  .section-title {
    font-size: 13px;
    font-weight: bold;
    color: #22609A;
    margin: 20px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e9ecef;
  }
  .signatures {
    display: flex;
    justify-content: space-between;
    margin-top: 50px;
    padding-top: 20px;
  }
  .signature-block {
    width: 45%;
  }
  .signature-title {
    font-size: 11px;
    font-weight: bold;
    margin-bottom: 4px;
    color: #22609A;
  }
  .signature-line {
    border-bottom: 1px solid #333;
    height: 30px;
    margin-bottom: 4px;
  }
  .signature-hint {
    font-size: 9px;
    color: #999;
    text-align: center;
  }
  .notes {
    margin: 15px 0;
    padding: 10px 15px;
    background: #fffbe6;
    border: 1px solid #ffe58f;
    border-radius: 4px;
    font-size: 11px;
  }
  .footer {
    margin-top: 30px;
    text-align: center;
    font-size: 9px;
    color: #aaa;
  }
</style>
</head>
<body>

<div class="header">
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
</div>

<div class="contract-title">ДОГОВОР ${contract.contractNumber}</div>
<div class="contract-subtitle">
  от ${formatDate(contract.startDate)}
  ${contract.endDate ? ` по ${formatDate(contract.endDate)}` : ''}
  · ${contract.isActive ? 'Действующий' : 'Закрыт'}
</div>

<div class="info-grid">
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
</div>

<div class="summary-row">
  <div class="summary-item">
    <div class="summary-label">Сумма договора</div>
    <div class="summary-value">${formatMoney(contract.amount)} сум</div>
  </div>
  <div class="summary-item">
    <div class="summary-label">Сумма сделок</div>
    <div class="summary-value">${formatMoney(contract.totalAmount)} сум</div>
  </div>
  <div class="summary-item">
    <div class="summary-label">Оплачено</div>
    <div class="summary-value paid">${formatMoney(contract.totalPaid)} сум</div>
  </div>
  <div class="summary-item">
    <div class="summary-label">Остаток</div>
    <div class="summary-value ${contract.remaining > 0 ? 'remaining' : 'paid'}">${formatMoney(contract.remaining)} сум</div>
  </div>
</div>

${contract.notes ? `<div class="notes"><strong>Примечание:</strong> ${contract.notes}</div>` : ''}

${contract.deals.length > 0 ? `
  <div class="section-title">Сделки (${contract.deals.length})</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Сделка</th>
        <th>Статус</th>
        <th class="money">Сумма</th>
        <th class="money">Оплачено</th>
        <th>Оплата</th>
      </tr>
    </thead>
    <tbody>
      ${dealsRows}
    </tbody>
  </table>
` : ''}

<div class="signatures">
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
</div>

<div class="footer">
  Документ сформирован ${formatDate(new Date())} · Polygraph Business CRM
</div>

</body>
</html>`;
}

export async function generateContractPdf(
  contract: ContractForPdf,
  companySettings: CompanySettingsForPdf,
): Promise<Buffer> {
  const html = buildHtml(contract, companySettings);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfUint8 = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}
