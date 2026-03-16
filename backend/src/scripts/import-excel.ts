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
import { normalizeClientName } from '../lib/normalize-client';

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

/**
 * Payment column offsets relative to the first payment column.
 * Each payment type has 3 sub-columns: total, this-month, prior.
 * We read the "this-month" column (offset +1 from group start).
 */
const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'PAYME', 'TERMINAL'] as const;

/**
 * Detect column layout dynamically per sheet.
 *
 * 2025 + Jan 2026 sheets: 28 columns (A–AB)
 *   - Payments start at col 11 (L), payment date at col 27 (AB)
 *
 * Feb/Mar 2026 sheets: 29 columns (A–AC) — extra column at K
 *   - Payments start at col 12 (M), payment date at col 28 (AC)
 *
 * Rule: payment date = last column; payments start = total_columns - 17
 */
function getSheetLayout(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
  // Payment date is always the last column
  const paymentDateCol = totalCols - 1;
  // First payment group "total" column = totalCols - 17
  // (28 cols: 28-17=11=L; 29 cols: 29-17=12=M)
  const paymentStartCol = totalCols - 17;
  // Each payment type occupies 3 columns; "this-month" is at offset +1
  const paymentCols = PAYMENT_METHODS.map((method, i) => ({
    index: paymentStartCol + i * 3 + 1,
    method,
  }));
  // Closing balance (Excel AB or AA) is always one column before payment date
  const closingBalanceCol = paymentDateCol - 1;
  return { paymentCols, paymentDateCol, closingBalanceCol, totalCols };
}

// Column indices (stable across all layouts — columns A through J don't shift)
const COL_DATE = 0;
const COL_CLIENT = 1;
const COL_BALANCE = 2;
const COL_MANAGER = 3;
const COL_PRODUCT = 4;
const COL_QTY = 5;
const COL_UNIT = 6;
const COL_PRICE = 7;
const COL_REVENUE = 8;    // Column I — выручка по строке
const COL_OP_TYPE = 9;    // Column J — тип операции (к, н, н/к, п, п/к, пп, обмен, ф)

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

  // Match by fullName (case insensitive) — more reliable than login
  const allUsers = await prisma.user.findMany({
    select: { id: true, fullName: true },
  });
  const userByName = new Map(allUsers.map((u) => [u.fullName.toLowerCase(), u.id]));

  for (const name of MANAGERS) {
    const userId = userByName.get(name);
    if (userId) {
      map.set(name, userId);
      console.log(`  Manager found: "${name}" → ${userId}`);
    } else {
      // Fallback to login-based lookup
      const login = MANAGER_LOGIN_MAP[name];
      if (login) {
        const existing = await prisma.user.findFirst({ where: { login } });
        if (existing) {
          map.set(name, existing.id);
          console.log(`  Manager found by login: ${login} (${existing.fullName}) → ${existing.id}`);
          continue;
        }
      }
      console.error(`  WARNING: Manager "${name}" not found by name or login. Skipping.`);
    }
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
      const key = normalizeClientName(row[COL_CLIENT]);
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

  // Build normalized CRM lookup to match token-sorted names
  const allCrmClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });
  const crmByNormalized = new Map<string, string>();
  for (const c of allCrmClients) {
    crmByNormalized.set(normalizeClientName(c.companyName), c.id);
  }

  for (const [key, info] of clientInfo) {
    // Check existing by normalized (token-sorted) name
    const existingId = crmByNormalized.get(key);

    if (existingId) {
      map.set(key, existingId);
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
    crmByNormalized.set(key, client.id);
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
    const key = normalizeClientName(row[COL_CLIENT]);

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
  const allRows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });
  const layout = getSheetLayout(sheet);

  const defaultManagerId = managerMap.get('дилмурод') || managerMap.values().next().value!;
  const monthDate = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
  const monthMid = new Date(Date.UTC(year, monthIndex, 15));

  // Filter out carry-forward rows: only include rows whose date falls within [monthStart, monthEnd)
  const rows = allRows.filter((row) => {
    const rowDate = toDate(row[COL_DATE]);
    if (!rowDate) return true; // keep rows without a date (fallback)
    return rowDate >= monthDate && rowDate < monthEnd;
  });

  // Carry-forward rows: dates before this month. We need their closingBalance for debt calculation.
  const carryForwardRows = allRows.filter((row) => {
    const rowDate = toDate(row[COL_DATE]);
    if (!rowDate) return false;
    return rowDate < monthDate;
  });

  const groups = groupRowsByClient(rows);
  // Also group carry-forward rows by client
  const cfGroups = groupRowsByClient(carryForwardRows);

  let dealCount = 0;
  let itemCount = 0;
  let paymentCount = 0;

  // Ensure placeholder product exists for balance-only rows (no product name in Excel)
  let placeholderProductId: string;
  const existingPlaceholder = await prisma.product.findFirst({
    where: { sku: 'IMPORT-BALANCE' },
  });
  if (existingPlaceholder) {
    placeholderProductId = existingPlaceholder.id;
  } else {
    const created = await prisma.product.create({
      data: { name: 'Баланс (без товара)', sku: 'IMPORT-BALANCE', unit: 'шт', stock: 0, minStock: 0, isActive: false },
    });
    placeholderProductId = created.id;
  }

  for (const group of groups) {
   try {
    const clientId = clientMap.get(group.clientKey);
    if (!clientId) continue;

    const managerId = managerMap.get(group.managerKey) || defaultManagerId;

    // Use the earliest row date as deal createdAt so period filters align better with Excel chronology.
    const groupRowDates = group.rows
      .map((r) => toDate(r[COL_DATE]))
      .filter((d): d is Date => !!d);
    const dealCreatedAt = groupRowDates.length > 0
      ? new Date(Math.min(...groupRowDates.map((d) => d.getTime())))
      : monthDate;

    // Compute deal totals from items
    let dealAmount = 0;
    let totalPaid = 0;
    const itemsData: {
      productId: string;
      qty: number;
      price: number;
      sourceOpType: string | null;
      isProblem: boolean;
      closingBalance: number | null;
      dealDate: Date | null;
    }[] = [];
    const paymentsData: { amount: number; method: string; paidAt: Date }[] = [];

    for (const row of group.rows) {
      // Items
      const productName = norm(row[COL_PRODUCT]);
      const qty = numVal(row[COL_QTY]);
      const price = numVal(row[COL_PRICE]);
      const revenue = numVal(row[COL_REVENUE]);
      const sourceOpType = mapOpType(row[COL_OP_TYPE]);
      const closingBalanceRaw = row[layout.closingBalanceCol];
      const closingBalance = closingBalanceRaw != null ? numVal(closingBalanceRaw) : null;
      const dealDate = toDate(row[COL_DATE]) || monthMid;

      if (productName && qty > 0) {
        const productId = productMap.get(normLower(row[COL_PRODUCT]));
        if (productId) {
          // Prefer explicit revenue from Excel column I; fallback to qty * price.
          const lineTotal = revenue > 0 ? revenue : qty * price;
          const effectivePrice = lineTotal > 0 ? lineTotal / qty : price;
          const isProblem = price === 0;
          const isExchange = sourceOpType === 'EXCHANGE';

          // EXCHANGE items don't contribute to deal amount
          if (!isExchange) {
            dealAmount += lineTotal;
          }

          itemsData.push({ productId, qty, price: effectivePrice, sourceOpType, isProblem, closingBalance, dealDate });
        }
      } else if (!productName && closingBalance != null && closingBalance !== 0) {
        // Row without product but with closing balance (e.g. payment-only or balance adjustment)
        // Use placeholder product to preserve closingBalance for debt calculation
        itemsData.push({ productId: '__PLACEHOLDER__', qty: 0, price: 0, sourceOpType, isProblem: false, closingBalance, dealDate });
      }

      // Payments — skip for EXCHANGE rows
      const isExchangeRow = sourceOpType === 'EXCHANGE';
      if (!isExchangeRow) {
        const paymentDate = toDate(row[layout.paymentDateCol]) || monthMid;

        for (const pc of layout.paymentCols) {
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
        createdAt: dealCreatedAt,
        updatedAt: dealCreatedAt,
      },
    });
    dealCount++;

    // Create deal items
    for (const item of itemsData) {
      const actualProductId = item.productId === '__PLACEHOLDER__' ? placeholderProductId : item.productId;
      await prisma.dealItem.create({
        data: {
          dealId: deal.id,
          productId: actualProductId,
          requestedQty: item.qty,
          price: item.price,
          sourceOpType: item.sourceOpType,
          closingBalance: item.closingBalance,
          isProblem: item.isProblem,
          dealDate: item.dealDate,
        },
      });
      itemCount++;

      // Create inventory OUT movement (skip for balance-only placeholder items)
      if (item.productId !== '__PLACEHOLDER__' && item.qty > 0) {
        await prisma.inventoryMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: item.qty,
            dealId: deal.id,
            note: `Импорт: ${MONTH_NAMES_RU[monthIndex]} ${year}`,
            createdBy: managerId,
            createdAt: item.dealDate || dealCreatedAt,
          },
        });
      }
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

  // Process carry-forward rows: add closingBalance-only deal items to existing deals
  // These represent opening balances carried from prior months
  for (const cfGroup of cfGroups) {
    try {
      const clientId = clientMap.get(cfGroup.clientKey);
      if (!clientId) continue;

      // Find the deal for this client (created above)
      const existingDeal = await prisma.deal.findFirst({
        where: {
          clientId,
          title: { contains: `${MONTH_NAMES_RU[monthIndex]} ${year}` },
          status: 'CLOSED',
        },
        select: { id: true },
      });

      if (!existingDeal) {
        // Create a carry-forward-only deal for clients who have no March transactions
        const managerId = managerMap.get(cfGroup.managerKey) || defaultManagerId;
        const deal = await prisma.deal.create({
          data: {
            title: `${cfGroup.clientName} — ${MONTH_NAMES_RU[monthIndex]} ${year}`,
            status: 'CLOSED',
            amount: 0,
            paidAmount: 0,
            paymentStatus: 'UNPAID',
            paymentType: 'FULL',
            clientId,
            managerId,
            createdAt: monthDate,
            updatedAt: monthDate,
          },
        });
        dealCount++;

        for (const row of cfGroup.rows) {
          const productName = norm(row[COL_PRODUCT]);
          const sourceOpType = mapOpType(row[COL_OP_TYPE]);
          const closingBalanceRaw = row[layout.closingBalanceCol];
          const closingBalance = closingBalanceRaw != null ? numVal(closingBalanceRaw) : null;

          let productId: string;
          if (productName) {
            const found = productMap.get(normLower(row[COL_PRODUCT]));
            if (!found) continue;
            productId = found;
          } else if (closingBalance != null && closingBalance !== 0) {
            productId = placeholderProductId;
          } else {
            continue;
          }

          await prisma.dealItem.create({
            data: {
              dealId: deal.id,
              productId,
              requestedQty: 0,
              price: 0,
              sourceOpType,
              closingBalance,
              isProblem: false,
            },
          });
          itemCount++;
        }
      } else {
        // Add carry-forward items to the existing deal
        for (const row of cfGroup.rows) {
          const productName = norm(row[COL_PRODUCT]);
          const sourceOpType = mapOpType(row[COL_OP_TYPE]);
          const closingBalanceRaw = row[layout.closingBalanceCol];
          const closingBalance = closingBalanceRaw != null ? numVal(closingBalanceRaw) : null;

          let productId: string;
          if (productName) {
            const found = productMap.get(normLower(row[COL_PRODUCT]));
            if (!found) continue;
            productId = found;
          } else if (closingBalance != null && closingBalance !== 0) {
            productId = placeholderProductId;
          } else {
            continue;
          }

          await prisma.dealItem.create({
            data: {
              dealId: existingDeal.id,
              productId,
              requestedQty: 0,
              price: 0,
              sourceOpType,
              closingBalance,
              isProblem: false,
            },
          });
          itemCount++;
        }
      }
    } catch (err) {
      console.error(`  ⚠ Error processing carry-forward for "${cfGroup.clientName}":`, (err as Error).message);
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
    console.error('Invalid year. Usage: npx tsx src/scripts/import-excel.ts <file> <year> [--month N]');
    process.exit(1);
  }

  // Optional: import only a specific month (1-based: 1=Jan, 3=Mar, etc.)
  const monthFlagIdx = process.argv.indexOf('--month');
  const onlyMonth = monthFlagIdx !== -1 ? parseInt(process.argv[monthFlagIdx + 1], 10) : null;
  if (onlyMonth !== null && (isNaN(onlyMonth) || onlyMonth < 1 || onlyMonth > 12)) {
    console.error('Invalid --month value. Must be 1-12.');
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
  if (onlyMonth) {
    console.log(`  ** Only importing month ${onlyMonth} (${MONTH_NAMES_RU[onlyMonth - 1]}) **`);
  }
  let totalDeals = 0;
  let totalItems = 0;
  let totalPayments = 0;

  const sheetCount = Math.min(12, wb.SheetNames.length);
  for (let m = 0; m < sheetCount; m++) {
    // Skip months not matching --month filter (m is 0-based, onlyMonth is 1-based)
    if (onlyMonth && m !== onlyMonth - 1) {
      console.log(`  [${wb.SheetNames[m]}] SKIPPED (--month ${onlyMonth})`);
      continue;
    }
    const sheetForLog = wb.Sheets[wb.SheetNames[m]];
    const layoutForLog = getSheetLayout(sheetForLog);
    const allRowCount = (XLSX.utils.sheet_to_json(sheetForLog, { header: 1, range: 3 }) as unknown[]).length;
    console.log(`  [${wb.SheetNames[m]}] cols=${layoutForLog.totalCols}, payStart=${layoutForLog.paymentCols[0].index}, dateCol=${layoutForLog.paymentDateCol}`);
    const result = await processMonth(m, wb, clientMap, productMap, managerMap, year);
    totalDeals += result.deals;
    totalItems += result.items;
    totalPayments += result.payments;
    console.log(`  ${MONTH_NAMES_RU[m]}: ${result.deals} deals, ${result.items} items, ${result.payments} payments (filtered ${allRowCount - result.deals} carry-forward rows)`);
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
