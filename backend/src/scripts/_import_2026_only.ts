import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { hashPassword } from '../lib/password';

const prisma = new PrismaClient();

const PAYMENT_METHOD_MAP: Record<string, any> = {
  'н': 'CASH',
  'н/к': 'CASH',
  'п': 'TRANSFER',
  'п/к': 'TRANSFER',
  'пп': 'CLICK',
  'к': 'TRANSFER',
  'ф': 'CASH',
};

async function getOrCreateManager(name: string) {
  if (!name || name.trim() === '' || name === '__EMPTY') {
    const existing = await prisma.user.findFirst({ where: { role: 'MANAGER' } });
    return existing || createDefaultManager();
  }
  const cleanName = String(name).trim();
  let manager = await prisma.user.findFirst({
    where: { fullName: { mode: 'insensitive', equals: cleanName }, role: 'MANAGER' },
  });
  if (!manager) {
    const login = cleanName.toLowerCase().replace(/\s+/g, '.').substring(0, 30);
    const hashedPassword = await hashPassword('temp123');
    manager = await prisma.user.create({
      data: { login: login || `manager-${Date.now()}`, password: hashedPassword, fullName: cleanName, role: 'MANAGER' },
    }).catch(() => createDefaultManager());
  }
  return manager;
}

async function createDefaultManager() {
  const existing = await prisma.user.findFirst({ where: { role: 'MANAGER' } });
  if (existing) return existing;
  const hashedPassword = await hashPassword('default123');
  return await prisma.user.create({
    data: { login: 'default-manager', password: hashedPassword, fullName: 'Default Manager', role: 'MANAGER' },
  });
}

async function getOrCreateClient(clientName: string, managerId: string) {
  if (!clientName || clientName.trim() === '') throw new Error('Client name cannot be empty');
  const cleanName = String(clientName).trim().toLowerCase();
  let client = await prisma.client.findFirst({
    where: { companyName: { mode: 'insensitive', equals: cleanName } },
  });
  if (!client) {
    client = await prisma.client.create({
      data: { companyName: cleanName, contactName: cleanName, managerId },
    });
  }
  return client;
}

async function getOrCreateProduct(productName: string, unit: string = 'шт') {
  if (!productName || productName.trim() === '') throw new Error('Product name cannot be empty');
  const cleanName = String(productName).trim().toLowerCase();
  let product = await prisma.product.findFirst({
    where: { name: { mode: 'insensitive', equals: cleanName } },
  });
  if (!product) {
    product = await prisma.product.create({
      data: { name: cleanName, sku: cleanName.toUpperCase().substring(0, 20), unit },
    });
  }
  return product;
}

function parseExcelDate(excelDate: any): Date {
  if (!excelDate) return new Date();
  if (typeof excelDate === 'string') {
    const d = new Date(excelDate);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  if (typeof excelDate === 'number') {
    const epoch = new Date(1900, 0, 1);
    const date = new Date(epoch.getTime() + (excelDate - 2) * 24 * 60 * 60 * 1000);
    return date;
  }
  return new Date();
}

async function importSheet(workbook: XLSX.WorkBook, sheetName: string) {
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, blankrows: false });

  console.log(`  📄 ${sheetName}: ${rows.length} строк...`);

  let imported = 0;
  let skipped = 0;
  const seenDeals = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    try {
      const clientName = row['фирма'];
      const productName = row['Отпуск товара за месяц'];
      const managerName = row['__EMPTY'];

      if (!clientName) {
        skipped++;
        continue;
      }

      const quantity = parseFloat(String(row['__EMPTY_1'] || 0).replace(',', '.')) || 0;
      const unit = String(row['__EMPTY_2'] || 'шт').trim() || 'шт';
      const revenueAmount = parseFloat(String(row['__EMPTY_4'] || 0).replace(',', '.')) || 0;
      const paymentCode = String(row['нкп'] || 'к').trim().toLowerCase();
      const paymentMethod = PAYMENT_METHOD_MAP[paymentCode] || 'TRANSFER';
      const closingDebtKey = Object.keys(row).find((k: string) => k.startsWith('Ост на'))!;
      const closingDebt = parseFloat(String(row[closingDebtKey] || 0)) || 0;
      const dealDate = row['дата'] ? parseExcelDate(row['дата']) : parseExcelDate(row['число']);

      const manager = await getOrCreateManager(managerName);
      const client = await getOrCreateClient(clientName, manager.id);

      if (productName && productName !== 0 && productName !== '0') {
        const product = await getOrCreateProduct(productName, unit);
        const dealKey = `${client.id}-${dealDate.toISOString().split('T')[0]}`;

        if (!seenDeals.has(dealKey)) {
          const deal = await prisma.deal.create({
            data: {
              title: `${clientName} - ${dealDate.toLocaleDateString()}`,
              status: closingDebt === 0 ? 'CLOSED' : 'IN_PROGRESS',
              amount: revenueAmount,
              clientId: client.id,
              managerId: manager.id,
              paymentMethod,
              paidAmount: Math.max(0, revenueAmount - Math.abs(closingDebt)),
              paymentStatus: closingDebt > 0 ? 'PARTIAL' : 'PAID',
              createdAt: dealDate,
            },
          });
          seenDeals.set(dealKey, deal.id);
        }

        const dealId = seenDeals.get(dealKey);
        if (dealId && quantity > 0) {
          const salePrice = quantity > 0 ? revenueAmount / quantity : 0;
          const sourceOpType = paymentCode.toUpperCase().replace('/', '');
          await prisma.dealItem.create({
            data: {
              dealId,
              productId: product.id,
              requestedQty: quantity,
              price: salePrice,
              lineTotal: revenueAmount,
              closingBalance: closingDebt,
              sourceOpType,
              dealDate,
            },
          }).catch(() => {});
          if (quantity > 0) {
            await prisma.inventoryMovement.create({
              data: { productId: product.id, type: 'OUT', quantity, dealId, createdBy: manager.id },
            }).catch(() => {});
          }
        }
      }
      imported++;
    } catch (error) {
      skipped++;
    }
  }

  return { imported, skipped };
}

async function main() {
  try {
    const baseDir = process.cwd();
    const filePath = path.join(baseDir, '../analytics_2026-03-17.xlsx');

    if (!fs.existsSync(filePath)) {
      console.error('❌ Файл не найден:', filePath);
      process.exit(1);
    }

    console.log('🚀 ИМПОРТ 2026 (только этот год)\n');
    console.log('='.repeat(50));

    const workbook = XLSX.readFile(filePath);
    console.log(`\n📂 File: analytics_2026-03-17.xlsx`);
    console.log(`📌 Sheets: ${workbook.SheetNames.length}\n`);

    let totalImported = 0;
    let totalSkipped = 0;

    for (const sheetName of workbook.SheetNames) {
      const result = await importSheet(workbook, sheetName);
      totalImported += result.imported;
      totalSkipped += result.skipped;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`\n✨ ИТОГО:`);
    console.log(`  ✅ Всего импортировано: ${totalImported}`);
    console.log(`  ⏭️  Всего пропущено: ${totalSkipped}\n`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

main();
