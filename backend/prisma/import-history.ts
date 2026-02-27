/**
 * Import historical data from data/29.12.2025.xlsx into the CRM database.
 * Runs during Render build phase as part of the build command.
 * Idempotent: skips if deals with "2025" in title already exist.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import prisma from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const MANAGERS = ['дилмурод', 'тимур', 'мадина', 'фотих', 'бону'];

const PAYMENT_COLS: { index: number; method: string }[] = [
  { index: 12, method: 'CASH' },
  { index: 15, method: 'TRANSFER' },
  { index: 18, method: 'QR' },
  { index: 21, method: 'PAYME' },
  { index: 24, method: 'TERMINAL' },
];

const COL_CLIENT = 1;
const COL_MANAGER = 3;
const COL_PRODUCT = 4;
const COL_QTY = 5;
const COL_UNIT = 6;
const COL_PRICE = 7;
const COL_PAYMENT_DATE = 27;

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}
function normLower(s: unknown): string { return norm(s).toLowerCase(); }
function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

type Row = unknown[];

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  History Import: 29.12.2025.xlsx → DB');
  console.log('═══════════════════════════════════════\n');

  // Idempotency check
  const existingDeals = await prisma.deal.count({
    where: { title: { endsWith: '2025' } },
  });
  if (existingDeals > 50) {
    console.log(`History already imported (${existingDeals} deals with "2025" in title). Skipping.`);
    process.exit(0);
  }

  const filePath = path.resolve(__dirname, '../data/29.12.2025.xlsx');
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath} — skipping import.`);
    process.exit(0);
  }

  console.log(`Reading: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  console.log(`Sheets: ${wb.SheetNames.length}\n`);

  // Step 1: Managers
  console.log('[1/4] Creating managers...');
  const managerMap = new Map<string, string>();
  const hashed = await hashPassword('import2025');
  for (const name of MANAGERS) {
    const fullName = name.charAt(0).toUpperCase() + name.slice(1);
    const login = `${name}_import`;
    const existing = await prisma.user.findFirst({ where: { login } });
    if (existing) { managerMap.set(name, existing.id); continue; }
    const user = await prisma.user.create({
      data: { login, password: hashed, fullName, role: 'MANAGER', permissions: ['manage_deals', 'manage_inventory', 'view_all_clients', 'edit_client'] },
    });
    managerMap.set(name, user.id);
  }
  console.log(`  ✓ ${managerMap.size} managers\n`);

  // Step 2: Products
  console.log('[2/4] Creating products...');
  const productSet = new Map<string, { name: string; unit: string }>();
  for (let m = 0; m < 12; m++) {
    if (m >= wb.SheetNames.length) break;
    const sheet = wb.Sheets[wb.SheetNames[m]];
    const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
    for (const row of rows) {
      const productName = norm(row[COL_PRODUCT]);
      if (!productName) continue;
      const key = normLower(row[COL_PRODUCT]);
      if (!productSet.has(key)) productSet.set(key, { name: productName, unit: norm(row[COL_UNIT]) || 'шт' });
    }
  }
  const productMap = new Map<string, string>();
  let skuCounter = await prisma.product.count({ where: { sku: { startsWith: 'IMPORT-' } } });
  for (const [key, info] of productSet) {
    const existing = await prisma.product.findFirst({ where: { name: { equals: info.name, mode: 'insensitive' } } });
    if (existing) { productMap.set(key, existing.id); continue; }
    skuCounter++;
    const product = await prisma.product.create({
      data: { name: info.name, sku: `IMPORT-${String(skuCounter).padStart(4, '0')}`, unit: info.unit, stock: 0, minStock: 0, isActive: false },
    });
    productMap.set(key, product.id);
  }
  console.log(`  ✓ ${productMap.size} products\n`);

  // Step 3: Clients
  console.log('[3/4] Creating clients...');
  const clientInfo = new Map<string, { name: string; manager: string }>();
  for (let m = 0; m < 12; m++) {
    if (m >= wb.SheetNames.length) break;
    const sheet = wb.Sheets[wb.SheetNames[m]];
    const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
    for (const row of rows) {
      const clientName = norm(row[COL_CLIENT]);
      if (!clientName) continue;
      const key = normLower(row[COL_CLIENT]);
      if (!clientInfo.has(key)) clientInfo.set(key, { name: clientName, manager: normLower(row[COL_MANAGER]) });
    }
  }
  const defaultManagerId = managerMap.get('дилмурод') || managerMap.values().next().value!;
  const clientMap = new Map<string, string>();
  for (const [key, info] of clientInfo) {
    const existing = await prisma.client.findFirst({ where: { companyName: { equals: info.name, mode: 'insensitive' } } });
    if (existing) { clientMap.set(key, existing.id); continue; }
    const client = await prisma.client.create({
      data: { companyName: info.name, contactName: info.name, managerId: managerMap.get(info.manager) || defaultManagerId, isArchived: false },
    });
    clientMap.set(key, client.id);
  }
  console.log(`  ✓ ${clientMap.size} clients\n`);

  // Step 4: Deals per month
  console.log('[4/4] Processing monthly deals...');
  let totalDeals = 0, totalItems = 0, totalPayments = 0;

  for (let m = 0; m < 12; m++) {
    if (m >= wb.SheetNames.length) break;
    const sheet = wb.Sheets[wb.SheetNames[m]];
    const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
    const monthDate = new Date(Date.UTC(2025, m, 1));
    const monthMid = new Date(Date.UTC(2025, m, 15));

    // Group by client
    const groups = new Map<string, { clientKey: string; clientName: string; managerKey: string; rows: Row[] }>();
    for (const row of rows) {
      const clientName = norm(row[COL_CLIENT]);
      if (!clientName) continue;
      const key = normLower(row[COL_CLIENT]);
      if (!groups.has(key)) groups.set(key, { clientKey: key, clientName, managerKey: normLower(row[COL_MANAGER]), rows: [] });
      groups.get(key)!.rows.push(row);
    }

    let mDeals = 0, mItems = 0, mPay = 0;
    for (const group of groups.values()) {
      const clientId = clientMap.get(group.clientKey);
      if (!clientId) continue;
      const managerId = managerMap.get(group.managerKey) || defaultManagerId;

      let dealAmount = 0, totalPaid = 0;
      const itemsData: { productId: string; qty: number; price: number }[] = [];
      const paymentsData: { amount: number; method: string; paidAt: Date }[] = [];

      for (const row of group.rows) {
        const productName = norm(row[COL_PRODUCT]);
        const qty = numVal(row[COL_QTY]);
        const price = numVal(row[COL_PRICE]);
        if (productName && qty > 0) {
          const productId = productMap.get(normLower(row[COL_PRODUCT]));
          if (productId) { dealAmount += qty * price; itemsData.push({ productId, qty, price }); }
        }
        const paymentDate = toDate(row[COL_PAYMENT_DATE]) || monthMid;
        for (const pc of PAYMENT_COLS) {
          const amt = numVal(row[pc.index]);
          if (amt > 0) { totalPaid += amt; paymentsData.push({ amount: amt, method: pc.method, paidAt: paymentDate }); }
        }
      }

      if (itemsData.length === 0 && paymentsData.length === 0) continue;
      if (dealAmount === 0 && paymentsData.length > 0) dealAmount = totalPaid;

      let paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'UNPAID';
      if (totalPaid > 0 && totalPaid >= dealAmount) paymentStatus = 'PAID';
      else if (totalPaid > 0) paymentStatus = 'PARTIAL';

      const deal = await prisma.deal.create({
        data: {
          title: `${group.clientName} — ${MONTH_NAMES_RU[m]} 2025`,
          status: 'CLOSED', amount: dealAmount, paidAmount: totalPaid,
          paymentStatus, paymentType: 'FULL', clientId, managerId,
          createdAt: monthDate, updatedAt: monthDate,
        },
      });
      mDeals++;

      for (const item of itemsData) {
        await prisma.dealItem.create({ data: { dealId: deal.id, productId: item.productId, requestedQty: item.qty, price: item.price } });
        mItems++;
        await prisma.inventoryMovement.create({
          data: { productId: item.productId, type: 'OUT', quantity: item.qty, dealId: deal.id, note: `Импорт: ${MONTH_NAMES_RU[m]} 2025`, createdBy: managerId, createdAt: monthDate },
        });
      }

      for (const p of paymentsData) {
        await prisma.payment.create({
          data: { dealId: deal.id, clientId, amount: p.amount, method: p.method, paidAt: p.paidAt, createdBy: managerId, createdAt: p.paidAt },
        });
        mPay++;
      }
    }
    totalDeals += mDeals; totalItems += mItems; totalPayments += mPay;
    console.log(`  ${MONTH_NAMES_RU[m]}: ${mDeals} deals, ${mItems} items, ${mPay} payments`);
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  IMPORT COMPLETE`);
  console.log(`  Deals: ${totalDeals}`);
  console.log(`  Items: ${totalItems}`);
  console.log(`  Payments: ${totalPayments}`);
  console.log(`═══════════════════════════════════════`);
}

main()
  .catch((err) => {
    console.error('History import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
