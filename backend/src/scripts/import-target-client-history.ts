import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeClientName } from '../lib/normalize-client';

const resolvedDatabaseUrl = process.env.DATABASE_URL
  ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=1&pool_timeout=0&sslmode=require`
  : undefined;

const prisma = new PrismaClient(
  resolvedDatabaseUrl
    ? {
        datasources: {
          db: {
            url: resolvedDatabaseUrl,
          },
        },
      }
    : undefined,
);

const EXECUTE = process.argv.includes('--execute');

const FILES = [
  { filePath: path.resolve(process.cwd(), '../analytics_2024-12-26.xlsx'), year: 2024, months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { filePath: path.resolve(process.cwd(), '../analytics_2025-12-29.xlsx'), year: 2025, months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { filePath: path.resolve(process.cwd(), '../analytics_2026-03-18.xlsx'), year: 2026, months: [0, 1] },
] as const;

const TARGET_CLIENTS = [
  {
    canonicalName: 'тимур дилшод',
    aliases: ['тимур дилшод'],
  },
  {
    canonicalName: 'ламинация цех',
    aliases: ['ламинация цех', 'ламинационный цех', 'ппс'],
  },
] as const;

const PERIOD_START = new Date(Date.UTC(2024, 0, 1));
const PERIOD_END = new Date(Date.UTC(2026, 2, 1));

const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'PAYME', 'TERMINAL'] as const;

const COL_DATE = 0;
const COL_CLIENT = 1;
const COL_BALANCE = 2;
const COL_MANAGER = 3;
const COL_PRODUCT = 4;
const COL_QTY = 5;
const COL_UNIT = 6;
const COL_PRICE = 7;
const COL_REVENUE = 8;
const COL_OP_TYPE = 9;

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

const MANAGER_ALIASES: Record<string, string> = {
  'фотих ака': 'фотих',
};

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

type Row = unknown[];

type Layout = ReturnType<typeof getSheetLayout>;

interface GroupedClient {
  clientKey: string;
  clientName: string;
  managerKey: string;
  rows: Row[];
}

interface GroupedDeal {
  groupKey: string;
  clientKey: string;
  clientName: string;
  managerKey: string;
  dealDate: Date | null;
  paymentMethod: string | null;
  rows: Row[];
}

interface Report {
  mode: 'dry-run' | 'execute';
  createdDeals: number;
  createdItems: number;
  createdPayments: number;
  createdClients: number;
  createdProducts: number;
  updatedDealsFromCarryForward: number;
  skippedExistingDeals: Array<{ clientName: string; date: string }>;
  errors: Array<{ clientName?: string; sheet?: string; message: string }>;
}

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
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y >= 1900 && d.y <= 2100) {
      return new Date(Date.UTC(d.y, d.m - 1, d.d));
    }
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

function mapOpType(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const mapping: Record<string, string> = {
    'к': 'K',
    'н': 'N',
    'н/к': 'NK',
    'п': 'P',
    'п/к': 'PK',
    'пп': 'PP',
    'обмен': 'EXCHANGE',
    'ф': 'F',
  };
  return mapping[raw] ?? 'UNKNOWN';
}

function getSheetLayout(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
  const paymentDateCol = totalCols - 1;
  const paymentStartCol = totalCols - 17;
  const paymentCols = PAYMENT_METHODS.map((method, i) => ({
    index: paymentStartCol + i * 3,
    method,
  }));
  const closingBalanceCol = paymentDateCol - 1;
  return { paymentCols, paymentDateCol, closingBalanceCol, totalCols };
}

function dateToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const aliasToCanonical = new Map<string, string>();
const canonicalToNormalized = new Map<string, string>();
for (const target of TARGET_CLIENTS) {
  canonicalToNormalized.set(target.canonicalName, normalizeClientName(target.canonicalName));
  for (const alias of target.aliases) {
    aliasToCanonical.set(normalizeClientName(alias), target.canonicalName);
  }
}

function canonicalizeClientName(value: unknown): string | null {
  const normalized = normalizeClientName(value);
  return aliasToCanonical.get(normalized) ?? null;
}

function isInRequestedPeriod(d: Date | null): boolean {
  return !!d && d >= PERIOD_START && d < PERIOD_END;
}

async function createManagers(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const allUsers = await prisma.user.findMany({ select: { id: true, fullName: true, login: true } });
  const byFullName = new Map(allUsers.map((u) => [u.fullName.toLowerCase(), u.id]));
  const byLogin = new Map(allUsers.map((u) => [u.login.toLowerCase(), u.id]));

  for (const [name, login] of Object.entries(MANAGER_LOGIN_MAP)) {
    const existingByName = byFullName.get(name);
    if (existingByName) {
      map.set(name, existingByName);
      continue;
    }
    const existingByLogin = byLogin.get(login);
    if (existingByLogin) {
      map.set(name, existingByLogin);
      continue;
    }
    const passwordHash = await bcrypt.hash('123456', 10);
    const created = await prisma.user.create({
      data: {
        login,
        fullName: name.charAt(0).toUpperCase() + name.slice(1),
        password: passwordHash,
        role: 'MANAGER',
        permissions: ['manage_users', 'view_all_deals', 'manage_deals', 'manage_leads'],
        isActive: true,
      },
      select: { id: true },
    });
    map.set(name, created.id);
  }

  return map;
}

async function getDefaultManagerId(managerMap: Map<string, string>): Promise<string> {
  const first = managerMap.values().next().value;
  if (first) return first;
  const existing = await prisma.user.findFirst({
    where: { role: 'MANAGER' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existing) return existing.id;
  throw new Error('No manager found');
}

function collectFilteredRows(wb: XLSX.WorkBook, year: number, months: readonly number[]) {
  const result: Array<{ monthIndex: number; sheetName: string; layout: Layout; rows: Row[] }> = [];

  for (const monthIndex of months) {
    const sheetName = wb.SheetNames[monthIndex];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const layout = getSheetLayout(sheet);
    const allRows: Row[] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 3 });

    const monthDate = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
    const allowPastDatesAsNormal = year === 2024 && monthIndex === 0;

    const rows = allRows.filter((row) => {
      const canonical = canonicalizeClientName(row[COL_CLIENT]);
      if (!canonical) return false;

      const rowDate = toDate(row[COL_DATE]);
      const isPpsAliasRow = normLower(row[COL_CLIENT]) === 'ппс';
      if (!rowDate) {
        if (monthIndex !== 0) return false;
        if (year > 2024 && !norm(row[COL_PRODUCT])) return false;
        return true;
      }

      // PPS historical rows live on later 2026 sheets but still represent real past deals.
      if (isPpsAliasRow && rowDate >= PERIOD_START && rowDate < PERIOD_END) {
        return true;
      }

      if (!allowPastDatesAsNormal && (rowDate < monthDate || rowDate >= monthEnd)) {
        return false;
      }
      return rowDate < PERIOD_END;
    });

    result.push({ monthIndex, sheetName, layout, rows });
  }

  return result;
}

async function createProducts(filteredSheets: ReturnType<typeof collectFilteredRows>) {
  const productSet = new Map<string, { name: string; unit: string }>();
  for (const entry of filteredSheets) {
    for (const row of entry.rows) {
      const productName = norm(row[COL_PRODUCT]);
      if (!productName) continue;
      const key = normLower(productName);
      if (!productSet.has(key)) {
        productSet.set(key, {
          name: productName,
          unit: norm(row[COL_UNIT]) || 'шт',
        });
      }
    }
  }

  const existing = await prisma.product.findMany({ select: { id: true, name: true } });
  const existingMap = new Map(existing.map((p) => [normLower(p.name), p.id]));
  const productMap = new Map<string, string>();
  let createdProducts = 0;

  for (const [key, product] of productSet) {
    const existingId = existingMap.get(key);
    if (existingId) {
      productMap.set(key, existingId);
      continue;
    }
    if (!EXECUTE) continue;
    const sku = `TARGET-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 20).toUpperCase()}`;
    const created = await prisma.product.create({
      data: {
        name: product.name,
        sku,
        unit: product.unit,
        stock: 0,
        minStock: 0,
      },
      select: { id: true },
    });
    createdProducts++;
    productMap.set(key, created.id);
  }

  if (!EXECUTE) {
    for (const [key] of productSet) {
      productMap.set(key, existingMap.get(key) || `dry-product:${key}`);
    }
  }

  return { productMap, createdProducts };
}

async function createClients(managerMap: Map<string, string>) {
  const defaultManagerId = await getDefaultManagerId(managerMap);
  const existingClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });
  const existingByNormalized = new Map(existingClients.map((c) => [normalizeClientName(c.companyName), c.id]));
  const clientMap = new Map<string, string>();
  let createdClients = 0;

  for (const target of TARGET_CLIENTS) {
    const normalized = canonicalToNormalized.get(target.canonicalName)!;
    const existingId = existingByNormalized.get(normalized);
    if (existingId) {
      clientMap.set(normalized, existingId);
      continue;
    }
    if (!EXECUTE) {
      clientMap.set(normalized, `dry-client:${target.canonicalName}`);
      continue;
    }
    const created = await prisma.client.create({
      data: {
        companyName: target.canonicalName,
        contactName: target.canonicalName,
        managerId: defaultManagerId,
        isArchived: false,
      },
      select: { id: true },
    });
    createdClients++;
    clientMap.set(normalized, created.id);
  }

  return { clientMap, createdClients };
}

function groupRowsByClient(rows: Row[]): GroupedClient[] {
  const groups = new Map<string, GroupedClient>();
  for (const row of rows) {
    const canonicalName = canonicalizeClientName(row[COL_CLIENT]);
    if (!canonicalName) continue;
    const clientKey = canonicalToNormalized.get(canonicalName)!;
    const managerKey = MANAGER_ALIASES[normLower(row[COL_MANAGER])] || normLower(row[COL_MANAGER]);
    if (!groups.has(clientKey)) {
      groups.set(clientKey, {
        clientKey,
        clientName: canonicalName,
        managerKey,
        rows: [],
      });
    }
    groups.get(clientKey)!.rows.push(row);
  }
  return Array.from(groups.values());
}

function groupRowsByClientAndDate(rows: Row[]): GroupedDeal[] {
  const groups = new Map<string, GroupedDeal>();
  for (const row of rows) {
    const canonicalName = canonicalizeClientName(row[COL_CLIENT]);
    const rowDate = toDate(row[COL_DATE]);
    if (!canonicalName || !rowDate) continue;
    const clientKey = canonicalToNormalized.get(canonicalName)!;
    const dateStr = dateToKey(rowDate);
    const groupKey = `${clientKey}::${dateStr}`;
    const opType = mapOpType(row[COL_OP_TYPE]);
    let paymentMethod = null;
    if (opType) {
      if (['K', 'N', 'NK'].includes(opType)) paymentMethod = 'CASH';
      else if (['P', 'PK', 'PP', 'F'].includes(opType)) paymentMethod = 'TRANSFER';
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        clientKey,
        clientName: canonicalName,
        managerKey: MANAGER_ALIASES[normLower(row[COL_MANAGER])] || normLower(row[COL_MANAGER]),
        dealDate: rowDate,
        paymentMethod,
        rows: [],
      });
    } else if (!groups.get(groupKey)!.paymentMethod && paymentMethod) {
      groups.get(groupKey)!.paymentMethod = paymentMethod;
    }

    groups.get(groupKey)!.rows.push(row);
  }
  return Array.from(groups.values());
}

async function ensurePlaceholderProductId(): Promise<string> {
  const existing = await prisma.product.findFirst({
    where: { sku: 'IMPORT-BALANCE' },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!EXECUTE) return 'dry-product:balance';
  const created = await prisma.product.create({
    data: {
      name: 'Баланс (без товара)',
      sku: 'IMPORT-BALANCE',
      unit: 'шт',
      stock: 0,
      minStock: 0,
      isActive: false,
    },
    select: { id: true },
  });
  return created.id;
}

async function processMonth(
  year: number,
  monthIndex: number,
  layout: Layout,
  allRows: Row[],
  clientMap: Map<string, string>,
  productMap: Map<string, string>,
  managerMap: Map<string, string>,
  placeholderProductId: string,
  report: Report,
) {
  const defaultManagerId = await getDefaultManagerId(managerMap);
  const monthDate = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));
  const monthMid = new Date(Date.UTC(year, monthIndex, 15));
  const allowPastDatesAsNormal = year === 2024 && monthIndex === 0;

  const rows = allRows.filter((row) => {
    const rowDate = toDate(row[COL_DATE]);
    const isPpsAliasRow = normLower(row[COL_CLIENT]) === 'ппс';
    if (!rowDate) {
      if (monthIndex !== 0) return false;
      if (year > 2024 && !norm(row[COL_PRODUCT])) return false;
      return true;
    }
    if (isPpsAliasRow) {
      return rowDate >= PERIOD_START && rowDate < PERIOD_END;
    }
    if (allowPastDatesAsNormal) {
      return rowDate >= PERIOD_START && rowDate < PERIOD_END && rowDate < monthEnd;
    }
    return rowDate >= monthDate && rowDate < monthEnd && rowDate >= PERIOD_START && rowDate < PERIOD_END;
  });

  const carryForwardRows = allRows.filter((row) => {
    const rowDate = toDate(row[COL_DATE]);
    if (!rowDate) {
      if (monthIndex !== 0) return false;
      return year > 2024 && !norm(row[COL_PRODUCT]);
    }
    if (allowPastDatesAsNormal) return false;
    return rowDate < monthDate && rowDate >= PERIOD_START;
  });

  const groups = groupRowsByClientAndDate(rows);
  const cfGroups = groupRowsByClient(carryForwardRows);

  for (const cfGroup of cfGroups) {
    const clientId = clientMap.get(cfGroup.clientKey);
    if (!clientId) continue;
    const managerId = managerMap.get(cfGroup.managerKey) || defaultManagerId;

    for (const row of cfGroup.rows) {
      const colC = numVal(row[COL_BALANCE]);
      const aa = numVal(row[layout.closingBalanceCol]);
      if (colC < 0 || (colC === 0 && aa <= 0)) continue;

      const paymentMade = Math.max(colC - aa, 0);
      if (paymentMade <= 0) continue;

      if (!EXECUTE) {
        report.createdPayments += 1;
        report.updatedDealsFromCarryForward += 1;
        continue;
      }

      const unpaidDeals = await prisma.deal.findMany({
        where: { clientId, paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, isArchived: false },
        orderBy: { createdAt: 'asc' },
      });

      let remaining = paymentMade;
      for (const oldDeal of unpaidDeals) {
        if (remaining <= 0) break;
        const oldDebt = Number(oldDeal.amount) - Number(oldDeal.paidAmount);
        if (oldDebt <= 0) continue;
        const applyAmount = Math.min(remaining, oldDebt);
        remaining -= applyAmount;

        const newPaid = Number(oldDeal.paidAmount) + applyAmount;
        const newStatus = newPaid >= Number(oldDeal.amount) ? 'PAID' : 'PARTIAL';

        await prisma.deal.update({
          where: { id: oldDeal.id },
          data: { paidAmount: new Prisma.Decimal(newPaid), paymentStatus: newStatus as any },
        });

        await prisma.payment.create({
          data: {
            amount: new Prisma.Decimal(applyAmount),
            method: 'CASH',
            dealId: oldDeal.id,
            clientId,
            createdBy: managerId,
            paidAt: monthDate,
          },
        });

        report.createdPayments += 1;
        report.updatedDealsFromCarryForward += 1;
      }
    }
  }

  for (const group of groups) {
    try {
      const clientId = clientMap.get(group.clientKey);
      if (!clientId || !group.dealDate || !isInRequestedPeriod(group.dealDate)) continue;

      if (EXECUTE) {
        const existingDeal = await prisma.deal.findFirst({
          where: {
            clientId,
            isArchived: false,
            createdAt: {
              gte: new Date(Date.UTC(group.dealDate.getUTCFullYear(), group.dealDate.getUTCMonth(), group.dealDate.getUTCDate())),
              lt: new Date(Date.UTC(group.dealDate.getUTCFullYear(), group.dealDate.getUTCMonth(), group.dealDate.getUTCDate() + 1)),
            },
          },
          select: { id: true },
        });
        if (existingDeal) {
          report.skippedExistingDeals.push({ clientName: group.clientName, date: dateToKey(group.dealDate) });
          continue;
        }
      }

      const managerId = managerMap.get(group.managerKey) || defaultManagerId;
      const dealCreatedAt = group.dealDate;
      const titleDateStr = dealCreatedAt.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      let dealAmount = 0;
      let totalPaid = 0;
      const itemsData: Array<{
        productId: string;
        qty: number;
        price: number;
        lineTotal: number;
        sourceOpType: string | null;
        isProblem: boolean;
        closingBalance: number | null;
        dealDate: Date | null;
      }> = [];
      const paymentsData: Array<{ amount: number; method: string; paidAt: Date }> = [];

      for (const row of group.rows) {
        const productName = norm(row[COL_PRODUCT]);
        const qty = numVal(row[COL_QTY]);
        const price = numVal(row[COL_PRICE]);
        const revenue = numVal(row[COL_REVENUE]);
        const sourceOpType = mapOpType(row[COL_OP_TYPE]);
        const closingBalanceRaw = row[layout.closingBalanceCol];
        const closingBalance = closingBalanceRaw != null ? numVal(closingBalanceRaw) : null;
        const rowDealDate = toDate(row[COL_DATE]) || monthMid;

        if (productName) {
          const productId = productMap.get(normLower(productName));
          if (productId) {
            const lineTotal = revenue > 0 ? revenue : qty * price;
            const effectivePrice = lineTotal > 0 && qty > 0 ? lineTotal / qty : price;
            const isProblem = price === 0 && lineTotal === 0;
            const isExchange = sourceOpType === 'EXCHANGE';

            if (!isExchange) {
              dealAmount += lineTotal;
            }

            itemsData.push({
              productId,
              qty,
              price: effectivePrice,
              lineTotal,
              sourceOpType,
              isProblem,
              closingBalance,
              dealDate: rowDealDate,
            });
          }
        } else {
          const lineTotal = revenue > 0 ? revenue : (qty > 0 && price > 0 ? qty * price : 0);
          if (lineTotal > 0 || (closingBalance != null && closingBalance !== 0)) {
            itemsData.push({
              productId: '__PLACEHOLDER__',
              qty,
              price,
              lineTotal,
              sourceOpType,
              isProblem: false,
              closingBalance,
              dealDate: rowDealDate,
            });
          }
        }

        if (sourceOpType !== 'EXCHANGE') {
          const paymentDate = toDate(row[layout.paymentDateCol]) || dealCreatedAt;
          for (const pc of layout.paymentCols) {
            const amt = numVal(row[pc.index]);
            if (amt > 0) {
              totalPaid += amt;
              paymentsData.push({ amount: amt, method: pc.method, paidAt: paymentDate });
            }
          }
        }
      }

      const isDebtDeal = group.rows.some((row) => {
        const op = mapOpType(row[COL_OP_TYPE]);
        return !!op && ['K', 'NK', 'PK', 'F', 'PP'].includes(op);
      });
      const hasOutstandingBalance = group.rows.some((row) => numVal(row[layout.closingBalanceCol]) > 0);

      if (dealAmount === 0 && itemsData.length > 0) {
        let sumClosingBalances = 0;
        for (const item of itemsData) {
          if (item.closingBalance) sumClosingBalances += item.closingBalance;
        }
        const isHistorical = group.dealDate < monthDate;
        if ((isDebtDeal || isHistorical) && sumClosingBalances !== 0) {
          dealAmount = sumClosingBalances + totalPaid;
        }
      }

      if (!isDebtDeal && !hasOutstandingBalance && dealAmount > totalPaid) {
        const missingPayment = dealAmount - totalPaid;
        totalPaid += missingPayment;
        paymentsData.push({
          amount: missingPayment,
          method: group.paymentMethod || 'CASH',
          paidAt: dealCreatedAt,
        });
      }

      if (itemsData.length === 0 && paymentsData.length === 0 && dealAmount === 0) continue;

      if (dealAmount === 0 && totalPaid > 0 && !isDebtDeal) {
        if (!EXECUTE) {
          report.createdPayments += 1;
          report.updatedDealsFromCarryForward += 1;
          continue;
        }

        const unpaidDeals = await prisma.deal.findMany({
          where: { clientId, paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, isArchived: false },
          orderBy: { createdAt: 'asc' },
        });
        if (unpaidDeals.length === 0) continue;

        let remaining = totalPaid;
        for (const oldDeal of unpaidDeals) {
          if (remaining <= 0) break;
          const oldDebt = Number(oldDeal.amount) - Number(oldDeal.paidAmount);
          if (oldDebt <= 0) continue;
          const applyAmount = Math.min(remaining, oldDebt);
          remaining -= applyAmount;

          const newPaid = Number(oldDeal.paidAmount) + applyAmount;
          const newStatus = newPaid >= Number(oldDeal.amount) ? 'PAID' : 'PARTIAL';

          await prisma.deal.update({
            where: { id: oldDeal.id },
            data: { paidAmount: new Prisma.Decimal(newPaid), paymentStatus: newStatus as any },
          });
          await prisma.payment.create({
            data: {
              amount: new Prisma.Decimal(applyAmount),
              method: (paymentsData[0]?.method as any) || 'CASH',
              dealId: oldDeal.id,
              clientId,
              createdBy: managerId,
              paidAt: dealCreatedAt,
            },
          });
          report.createdPayments += 1;
          report.updatedDealsFromCarryForward += 1;
        }
        continue;
      }

      let paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID' = 'UNPAID';
      if (totalPaid > 0 && totalPaid >= dealAmount) paymentStatus = 'PAID';
      else if (totalPaid > 0) paymentStatus = 'PARTIAL';

      if (!EXECUTE) {
        report.createdDeals += 1;
        report.createdItems += itemsData.length;
        report.createdPayments += paymentsData.length;
        continue;
      }

      const deal = await prisma.deal.create({
        data: {
          title: `${group.clientName} — ${titleDateStr}`,
          status: 'CLOSED',
          amount: new Prisma.Decimal(dealAmount),
          paidAmount: new Prisma.Decimal(totalPaid),
          paymentStatus,
          paymentType: 'FULL',
          paymentMethod: (group.paymentMethod as any) || null,
          clientId,
          managerId,
          createdAt: dealCreatedAt,
          updatedAt: dealCreatedAt,
        },
      });
      report.createdDeals += 1;

      for (const item of itemsData) {
        const actualProductId = item.productId === '__PLACEHOLDER__' ? placeholderProductId : item.productId;
        await prisma.dealItem.create({
          data: {
            dealId: deal.id,
            productId: actualProductId,
            requestedQty: new Prisma.Decimal(item.qty),
            price: new Prisma.Decimal(item.price),
            lineTotal: new Prisma.Decimal(item.lineTotal),
            sourceOpType: item.sourceOpType,
            closingBalance: item.closingBalance == null ? null : new Prisma.Decimal(item.closingBalance),
            isProblem: item.isProblem,
            dealDate: item.dealDate,
            createdAt: item.dealDate || dealCreatedAt,
          },
        });
        report.createdItems += 1;

        if (item.productId !== '__PLACEHOLDER__' && item.qty > 0) {
          await prisma.inventoryMovement.create({
            data: {
              productId: item.productId,
              type: 'OUT',
              quantity: new Prisma.Decimal(item.qty),
              dealId: deal.id,
              note: `Импорт: ${MONTH_NAMES_RU[monthIndex]} ${year}`,
              createdBy: managerId,
              createdAt: item.dealDate || dealCreatedAt,
            },
          });
        }
      }

      for (const p of paymentsData) {
        await prisma.payment.create({
          data: {
            dealId: deal.id,
            clientId,
            amount: new Prisma.Decimal(p.amount),
            method: p.method as any,
            paidAt: p.paidAt,
            createdBy: managerId,
            createdAt: p.paidAt,
          },
        });
        report.createdPayments += 1;
      }
    } catch (error) {
      report.errors.push({
        clientName: group.clientName,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}

async function main() {
  const report: Report = {
    mode: EXECUTE ? 'execute' : 'dry-run',
    createdDeals: 0,
    createdItems: 0,
    createdPayments: 0,
    createdClients: 0,
    createdProducts: 0,
    updatedDealsFromCarryForward: 0,
    skippedExistingDeals: [],
    errors: [],
  };

  const missingFiles = FILES.filter((f) => !fs.existsSync(f.filePath));
  if (missingFiles.length > 0) {
    throw new Error(`Missing Excel files: ${missingFiles.map((f) => f.filePath).join(', ')}`);
  }

  const managerMap = await createManagers();
  const placeholderProductId = await ensurePlaceholderProductId();

  const workbooks = FILES.map((file) => ({
    ...file,
    workbook: XLSX.readFile(file.filePath),
  }));

  const filteredSheets = workbooks.flatMap((entry) =>
    collectFilteredRows(entry.workbook, entry.year, entry.months).map((sheet) => ({
      ...sheet,
      year: entry.year,
    })),
  );

  const { productMap, createdProducts } = await createProducts(filteredSheets);
  report.createdProducts = createdProducts;

  const { clientMap, createdClients } = await createClients(managerMap);
  report.createdClients = createdClients;

  for (const sheet of filteredSheets) {
    await processMonth(
      sheet.year,
      sheet.monthIndex,
      sheet.layout,
      sheet.rows,
      clientMap,
      productMap,
      managerMap,
      placeholderProductId,
      report,
    );
  }

  const outPath = path.resolve(
    process.cwd(),
    `tmp/target-client-history-${EXECUTE ? 'execute' : 'dry-run'}-report.json`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report written to ${outPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
