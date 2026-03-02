/**
 * Import historical data from Excel into the CRM database.
 *
 * Run: cd backend && npx tsx src/scripts/import-excel.ts [file] [year]
 * Examples:
 *   npx tsx src/scripts/import-excel.ts                                  # 29.12.2025.xlsx, 2025
 *   npx tsx src/scripts/import-excel.ts ../frontend/27.02.2026.xlsx 2026 # 2026 data
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ───────── constants ─────────

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const PAYMENT_COLS: { index: number; method: string }[] = [
  { index: 12, method: 'CASH' },
  { index: 15, method: 'TRANSFER' },
  { index: 18, method: 'QR' },
  { index: 21, method: 'PAYME' },
  { index: 24, method: 'TERMINAL' },
];

// Column indices
const COL_DATE = 0;
const COL_CLIENT = 1;
const COL_BALANCE = 2;
const COL_MANAGER = 3;
const COL_PRODUCT = 4;
const COL_QTY = 5;
const COL_UNIT = 6;
const COL_PRICE = 7;
const COL_OP_TYPE = 9;    // Column J — тип операции (к, н, н/к, п, п/к, пп, обмен, ф)
const COL_PAYMENT_DATE = 27;

// Mapping: Excel manager name (lowercase Cyrillic) → real login
const MANAGER_LOGIN_MAP: Record<string, string> = {
  'дилмурод': 'dilmurod',
  'тимур': 'timur',
  'мадина': 'madina',
  'фотих': 'fotix',
  'бону': 'bonu',
  'фарход': 'admin',
  'дилноза': 'dilnoza',
  'комила': 'komila',
  'хадича': 'xadicha',
};

const MANAGERS = Object.keys(MANAGER_LOGIN_MAP);

// Alias mapping: normalize manager names before lookup
const MANAGER_ALIASES: Record<string, string> = {
  'фотих ака': 'фотих',
};

// ───────── helpers ─────────

function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

function normLower(s: unknown): string {
  return norm(s).toLowerCase();
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y >= 1900 && d.y <= 2100) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return null;
  // Reject dates outside reasonable range
  if (parsed.getFullYear() < 1900 || parsed.getFullYear() > 2100) return null;
  return parsed;
}

type Row = unknown[];

function mapOpType(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const mapping: Record<string, string> = {
    'к': 'K', 'н': 'N', 'н/к': 'NK', 'п': 'P', 'п/к': 'PK',
    'пп': 'PP', 'обмен': 'EXCHANGE', 'ф': 'F',
  };
  return mapping[raw] ?? 'UNKNOWN';
}

// ───────── step 1: managers ─────────

async function createManagers(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const name of MANAGERS) {
    const login = MANAGER_LOGIN_MAP[name];
    if (!login) {
      console.log(`  WARNING: No login mapped for "${name}" — skipping`);
      continue;
    }

    const existing = await prisma.user.findFirst({ where: { login } });
    if (existing) {
      map.set(name, existing.id);
      console.log(`  Manager found: ${login} (${existing.fullName}) → ${existing.id}`);
      continue;
    }

    // Do NOT create new users automatically - require manual creation
    console.error('  WARNING: Manager "' + login + '" (from "' + name + '") not found. Skipping.');
    console.error('           Create the user manually before running import.');
  }

  return map;
}

// ───────── step 2: products ─────────

async function createProducts(wb: XLSX.WorkBook): Promise<Map<string, string>> {
  const productSet = new Map<string, { name: string; unit: string }>();

  for (let m = 0; m < wb.SheetNames.length && m < 12; m++) {
    const sheet = wb.Sheets[wb.SheetNames[m]];
    const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

    for (const row of rows) {
      const productName = norm(row[COL_PRODUCT]);
      if (!productName) continue;
      const key = normLower(row[COL_PRODUCT]);
      if (!productSet.has(key)) {
        productSet.set(key, {
          name: productName,
          unit: norm(row[COL_UNIT]) || 'шт',
        });
      }
    }
  }

  const map = new Map<string, string>();
  let skuCounter = 0;

  // Check how many IMPORT- products already exist
  const existingCount = await prisma.product.count({
    where: { sku: { startsWith: 'IMPORT-' } },
  });
  skuCounter = existingCount;

  for (const [key, info] of productSet) {
    // Check if already exists by name (case insensitive via raw query)
    const existing = await prisma.product.findFirst({
      where: { name: { equals: info.name, mode: 'insensitive' } },
    });

    if (existing) {
      map.set(key, existing.id);
      continue;
    }

    skuCounter++;
    const sku = `IMPORT-${String(skuCounter).padStart(4, '0')}`;

    const product = await prisma.product.create({
      data: {
        name: info.name,
        sku,
        unit: info.unit,
        stock: 0,
        minStock: 0,
        isActive: true,
      },
    });
    map.set(key, product.id);
  }

  console.log(`  Products: ${productSet.size} unique, ${map.size} mapped`);
  return map;
}

// ───────── step 3: clients ─────────

async function createClients(
  wb: XLSX.WorkBook,
  managerMap: Map<string, string>,
): Promise<Map<string, string>> {
  // Collect all unique clients with their first-seen manager
  const clientInfo = new Map<string, { name: string; manager: string }>();

  for (let m = 0; m < wb.SheetNames.length && m < 12; m++) {
    const sheet = wb.Sheets[wb.SheetNames[m]];
    const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

    for (const row of rows) {
      const clientName = norm(row[COL_CLIENT]);
      if (!clientName) continue;
      const key = normLower(row[COL_CLIENT]);
      if (!clientInfo.has(key)) {
        const managerName = MANAGER_ALIASES[normLower(row[COL_MANAGER])] || normLower(row[COL_MANAGER]);
        clientInfo.set(key, {
          name: clientName,
          manager: managerName,
        });
      }
    }
  }

  const defaultManagerId = managerMap.get('дилмурод') || managerMap.values().next().value!;
  const map = new Map<string, string>();

  for (const [key, info] of clientInfo) {
    // Check existing by company name
    const existing = await prisma.client.findFirst({
      where: { companyName: { equals: info.name, mode: 'insensitive' } },
    });

    if (existing) {
      map.set(key, existing.id);
      continue;
    }

    const managerId = managerMap.get(info.manager) || defaultManagerId;

    const client = await prisma.client.create({
      data: {
        companyName: info.name,
        contactName: info.name,
        managerId,
        isArchived: false,
      },
    });
    map.set(key, client.id);
  }

  console.log(`  Clients: ${clientInfo.size} unique, ${map.size} mapped`);
  return map;
}

// ───────── step 4: deals, items, payments ─────────

interface GroupedDeal {
  clientKey: string;
  clientName: string;
  managerKey: string;
  rows: Row[];
}

function groupRowsByClient(rows: Row[]): GroupedDeal[] {
  const groups = new Map<string, GroupedDeal>();

  for (const row of rows) {
    const clientName = norm(row[COL_CLIENT]);
    if (!clientName) continue;
    const key = normLower(row[COL_CLIENT]);

    if (!groups.has(key)) {
      groups.set(key, {
        clientKey: key,
        clientName,
        managerKey: MANAGER_ALIASES[normLower(row[COL_MANAGER])] || normLower(row[COL_MANAGER]),
        rows: [],
      });
    }
    groups.get(key)!.rows.push(row);
  }

  return Array.from(groups.values());
}

async function processMonth(
  monthIndex: number,
  wb: XLSX.WorkBook,
  clientMap: Map<string, string>,
  productMap: Map<string, string>,
  managerMap: Map<string, string>,
  year: number,
): Promise<{ deals: number; items: number; payments: number }> {
  const sheet = wb.Sheets[wb.SheetNames[monthIndex]];
  const rows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
  const groups = groupRowsByClient(rows);

  const defaultManagerId = managerMap.get('дилмурод') || managerMap.values().next().value!;
  const monthDate = new Date(Date.UTC(year, monthIndex, 1));
  const monthMid = new Date(Date.UTC(year, monthIndex, 15));

  let dealCount = 0;
  let itemCount = 0;
  let paymentCount = 0;

  for (const group of groups) {
   try {
    const clientId = clientMap.get(group.clientKey);
    if (!clientId) continue;

    const managerId = managerMap.get(group.managerKey) || defaultManagerId;

    // Compute deal totals from items
    let dealAmount = 0;
    let totalPaid = 0;
    const itemsData: { productId: string; qty: number; price: number; sourceOpType: string | null; isProblem: boolean }[] = [];
    const paymentsData: { amount: number; method: string; paidAt: Date }[] = [];

    for (const row of group.rows) {
      // Items
      const productName = norm(row[COL_PRODUCT]);
      const qty = numVal(row[COL_QTY]);
      const price = numVal(row[COL_PRICE]);
      const sourceOpType = mapOpType(row[COL_OP_TYPE]);

      if (productName && qty > 0) {
        const productId = productMap.get(normLower(row[COL_PRODUCT]));
        if (productId) {
          const lineTotal = qty * price;
          const isProblem = price === 0;
          const isExchange = sourceOpType === 'EXCHANGE';

          // EXCHANGE items don't contribute to deal amount
          if (!isExchange) {
            dealAmount += lineTotal;
          }

          itemsData.push({ productId, qty, price, sourceOpType, isProblem });
        }
      }

      // Payments — skip for EXCHANGE rows
      const isExchangeRow = sourceOpType === 'EXCHANGE';
      if (!isExchangeRow) {
        const paymentDate = toDate(row[COL_PAYMENT_DATE]) || monthMid;

        for (const pc of PAYMENT_COLS) {
          const amt = numVal(row[pc.index]);
          if (amt > 0) {
            totalPaid += amt;
            paymentsData.push({ amount: amt, method: pc.method, paidAt: paymentDate });
          }
        }
      }
    }

    // Skip if no items AND no payments
    if (itemsData.length === 0 && paymentsData.length === 0) continue;

    // If no items but has payments → use payment total as deal amount
    if (dealAmount === 0 && paymentsData.length > 0) {
      dealAmount = totalPaid;
    }

    // Determine payment status
    let paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'UNPAID';
    if (totalPaid > 0 && totalPaid >= dealAmount) paymentStatus = 'PAID';
    else if (totalPaid > 0) paymentStatus = 'PARTIAL';

    // Create deal
    const deal = await prisma.deal.create({
      data: {
        title: `${group.clientName} — ${MONTH_NAMES_RU[monthIndex]} ${year}`,
        status: 'CLOSED',
        amount: dealAmount,
        paidAmount: totalPaid,
        paymentStatus,
        paymentType: 'FULL',
        clientId,
        managerId,
        createdAt: monthDate,
        updatedAt: monthDate,
      },
    });
    dealCount++;

    // Create deal items
    for (const item of itemsData) {
      await prisma.dealItem.create({
        data: {
          dealId: deal.id,
          productId: item.productId,
          requestedQty: item.qty,
          price: item.price,
          sourceOpType: item.sourceOpType,
          isProblem: item.isProblem,
        },
      });
      itemCount++;

      // Create inventory OUT movement
      await prisma.inventoryMovement.create({
        data: {
          productId: item.productId,
          type: 'OUT',
          quantity: item.qty,
          dealId: deal.id,
          note: `Импорт: ${MONTH_NAMES_RU[monthIndex]} ${year}`,
          createdBy: managerId,
          createdAt: monthDate,
        },
      });
    }

    // Create payments (deduplicate same amount+method+date)
    for (const p of paymentsData) {
      await prisma.payment.create({
        data: {
          dealId: deal.id,
          clientId,
          amount: p.amount,
          method: p.method,
          paidAt: p.paidAt,
          createdBy: managerId,
          createdAt: p.paidAt,
        },
      });
      paymentCount++;
    }
   } catch (err) {
    console.error(`  ⚠ Error processing client "${group.clientName}":`, (err as Error).message);
   }
  }

  return { deals: dealCount, items: itemCount, payments: paymentCount };
}

// ───────── main ─────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Excel → CRM Import');
  console.log('═══════════════════════════════════════\n');

  const fileArg = process.argv[2] || '29.12.2025.xlsx';
  const year = parseInt(process.argv[3] || '2025', 10);
  if (isNaN(year) || year < 2020 || year > 2030) {
    console.error('Invalid year. Usage: npx tsx src/scripts/import-excel.ts <file> <year>');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), '..', fileArg);
  console.log(`Reading: ${filePath}`);
  console.log(`Year: ${year}`);
  const wb = XLSX.readFile(filePath);
  console.log(`Sheets: ${wb.SheetNames.length}\n`);

  // Step 1: Managers
  console.log('[1/4] Creating managers...');
  const managerMap = await createManagers();
  console.log(`  ✓ ${managerMap.size} managers\n`);

  // Step 2: Products
  console.log('[2/4] Creating products...');
  const productMap = await createProducts(wb);
  console.log(`  ✓ ${productMap.size} products\n`);

  // Step 3: Clients
  console.log('[3/4] Creating clients...');
  const clientMap = await createClients(wb, managerMap);
  console.log(`  ✓ ${clientMap.size} clients\n`);

  // Step 4: Deals per month
  console.log('[4/4] Processing monthly data...');
  let totalDeals = 0;
  let totalItems = 0;
  let totalPayments = 0;

  const sheetCount = Math.min(12, wb.SheetNames.length);
  for (let m = 0; m < sheetCount; m++) {
    const result = await processMonth(m, wb, clientMap, productMap, managerMap, year);
    totalDeals += result.deals;
    totalItems += result.items;
    totalPayments += result.payments;
    console.log(`  ${MONTH_NAMES_RU[m]}: ${result.deals} deals, ${result.items} items, ${result.payments} payments`);
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
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
