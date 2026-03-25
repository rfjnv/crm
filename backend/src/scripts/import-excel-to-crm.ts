import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient, PaymentStatus, PaymentMethod } from '@prisma/client';
import { hashPassword } from '../lib/password';

const prisma = new PrismaClient();

const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  'н': 'CASH',        // наличные
  'н/к': 'CASH',      // наличные но в долг
  'п': 'TRANSFER',    // перечисление
  'п/к': 'TRANSFER',  // перечисление но в долг
  'пп': 'CLICK',      // передоплата
  'к': 'TRANSFER',    // долг
  'ф': 'CASH',        // Фотих
};

interface ExcelRow {
  'дата'?: any;
  'фирма'?: string;
  [key: string]: any;
}

async function getOrCreateManager(name: string) {
  if (!name || name.trim() === '' || name === '__EMPTY') {
    const existing = await prisma.user.findFirst({ where: { role: 'MANAGER' } });
    return existing || createDefaultManager();
  }

  const cleanName = String(name).trim();
  let manager = await prisma.user.findFirst({
    where: {
      fullName: { mode: 'insensitive', equals: cleanName },
      role: 'MANAGER',
    },
  });

  if (!manager) {
    const login = cleanName.toLowerCase().replace(/\s+/g, '.').substring(0, 30);
    const hashedPassword = await hashPassword('temp123');

    manager = await prisma.user.create({
      data: {
        login: login || `manager-${Date.now()}`,
        password: hashedPassword,
        fullName: cleanName,
        role: 'MANAGER',
      },
    }).catch(() => createDefaultManager());
  }

  return manager;
}

async function createDefaultManager() {
  const existing = await prisma.user.findFirst({ where: { role: 'MANAGER' } });
  if (existing) return existing;

  const hashedPassword = await hashPassword('default123');
  return await prisma.user.create({
    data: {
      login: 'default-manager',
      password: hashedPassword,
      fullName: 'Default Manager',
      role: 'MANAGER',
    },
  });
}

async function getOrCreateClient(clientName: string, managerId: string) {
  if (!clientName || clientName.trim() === '') {
    throw new Error('Client name cannot be empty');
  }

  const cleanName = String(clientName).trim().toLowerCase();
  let client = await prisma.client.findFirst({
    where: { companyName: { mode: 'insensitive', equals: cleanName } },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        companyName: cleanName,
        contactName: cleanName,
        managerId,
      },
    });
  }

  return client;
}

function normalizeUnit(unit?: unknown): string {
  if (!unit) return 'шт';
  const u = String(unit).trim().toLowerCase();
  if (u === 'мп') return 'п/м';
  if (u === 'бабин') return 'бабина';
  return String(unit).trim() || 'шт';
}

async function getOrCreateProduct(productName: string, unit: string = 'шт') {
  if (!productName || productName.trim() === '') {
    throw new Error('Product name cannot be empty');
  }

  const cleanName = String(productName).trim().toLowerCase();
  let product = await prisma.product.findFirst({
    where: { name: { mode: 'insensitive', equals: cleanName } },
  });

  if (!product) {
    const sku = cleanName.slice(0, 20).toUpperCase().replace(/\s+/g, '_');
    product = await prisma.product.create({
      data: {
        name: cleanName,
        sku: sku || `PROD-${Date.now()}`,
        unit: normalizeUnit(unit),
      },
    });
  }

  return product;
}

function parseExcelDate(value: any): Date {
  if (!value) return new Date();
  if (typeof value === 'number') {
    return new Date((value - 25569) * 86400 * 1000);
  }
  const parsed = new Date(String(value));
  return !isNaN(parsed.getTime()) ? parsed : new Date();
}

async function importSheet(workbook: XLSX.WorkBook, sheetName: string) {
  console.log(`\n📄 Лист: ${sheetName}`);

  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, { defval: null, blankrows: false });

  console.log(`📊 Строк: ${rows.length}`);

  let imported = 0;
  let skipped = 0;
  const seenDeals = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    try {
      const clientName = row['фирма'];
      const productName = row['Отпуск товара за месяц'];
      const managerName = row['__EMPTY'];

      // Пропускаем пустые строки
      if (!clientName) {
        skipped++;
        continue;
      }

      // ПРАВИЛЬНАЯ СТРУКТУРА:
      // A: дата (row['дата'])
      // B: фирма (row['фирма'])
      // C: долг на начало (row['Ост-к на ...'])
      // D: менеджер (row['__EMPTY'])
      // E: товар (row['Отпуск товара за месяц'])
      // F: количество (row['__EMPTY_1'])
      // G: единица (row['__EMPTY_2'])
      // H: цена (row['__EMPTY_3']) - мб пусто!
      // I: ВЫРУЧКА (row['__EMPTY_4']) ← БЕРЕМ ОТСЮДА!
      // J: платеж (row['нкп'])
      // AA: остаток долга (Ост на ...)

      const quantity = parseFloat(String(row['__EMPTY_1'] || 0).replace(',', '.')) || 0;
      const unit = String(row['__EMPTY_2'] || 'шт').trim() || 'шт';

      // ВЫРУЧКА ИЗ СТОЛБЦА I (__EMPTY_4)!
      const revenueAmount = parseFloat(String(row['__EMPTY_4'] || 0).replace(',', '.')) || 0;

      const paymentCode = String(row['нкп'] || 'к').trim().toLowerCase();
      const paymentMethod = PAYMENT_METHOD_MAP[paymentCode] || 'TRANSFER';

      const closingDebtKey = Object.keys(row).find(k => k.startsWith('Ост на'))!;
      const closingDebt = parseFloat(String(row[closingDebtKey] || 0)) || 0;

      const dealDate = row['дата'] ? parseExcelDate(row['дата']) : parseExcelDate(row['число']);

      const manager = await getOrCreateManager(managerName);
      const client = await getOrCreateClient(clientName, manager.id);

      let dealId: string | null = null;

      if (productName && productName !== 0 && productName !== '0') {
        const product = await getOrCreateProduct(productName, unit);

        // Группировка по дате и клиенту
        const dealKey = `${client.id}-${dealDate.toISOString().split('T')[0]}`;

        if (!seenDeals.has(dealKey)) {
          // Создаем новую сделку с ВЫРУЧКОЙ из столбца I
          const deal = await prisma.deal.create({
            data: {
              title: `${clientName} - ${dealDate.toLocaleDateString()}`,
              status: closingDebt === 0 ? 'CLOSED' : 'IN_PROGRESS',
              amount: revenueAmount, // ВЫРУЧКА!
              clientId: client.id,
              managerId: manager.id,
              paymentMethod,
              paidAmount: Math.max(0, revenueAmount - Math.abs(closingDebt)),
              paymentStatus: closingDebt > 0 ? 'PARTIAL' : 'PAID',
              createdAt: dealDate,
            },
          });

          seenDeals.set(dealKey, deal.id);
          dealId = deal.id;
        } else {
          dealId = seenDeals.get(dealKey) || null;
        }

        if (dealId && quantity > 0) {
          // Цена = выручка / количество
          const salePrice = quantity > 0 ? revenueAmount / quantity : 0;
          const sourceOpType = paymentCode.toUpperCase().replace('/', '');

          await prisma.dealItem.create({
            data: {
              dealId,
              productId: product.id,
              requestedQty: quantity,
              price: salePrice,
              lineTotal: revenueAmount, // ВЫРУЧКА!
              closingBalance: closingDebt,
              sourceOpType,
              dealDate,
            },
          }).catch(() => {});

          // Инвентарь: товар вышел из склада
          if (quantity > 0) {
            await prisma.inventoryMovement.create({
              data: {
                productId: product.id,
                type: 'OUT',
                quantity,
                dealId,
                createdBy: manager.id,
              },
            }).catch(() => {});
          }
        }
      } else {
        // Только долг без товара
        const dealKey = `${client.id}-debt-${dealDate.toISOString().split('T')[0]}`;
        if (!seenDeals.has(dealKey)) {
          await prisma.deal.create({
            data: {
              title: `${clientName} - остаток ${dealDate.toLocaleDateString()}`,
              status: closingDebt === 0 ? 'CLOSED' : 'IN_PROGRESS',
              amount: Math.abs(closingDebt),
              clientId: client.id,
              managerId: manager.id,
              paymentMethod,
              paidAmount: 0,
              paymentStatus: closingDebt > 0 ? 'UNPAID' : 'PAID',
              createdAt: dealDate,
            },
          }).catch(() => {});

          seenDeals.set(dealKey, '');
        }
      }

      imported++;
      if (imported % 100 === 0) {
        console.log(`  ✅ ${imported} записей обработано...`);
      }
    } catch (error) {
      skipped++;
      if (skipped <= 5) {
        console.warn(
          `  ⚠️ Строка ${i + 1}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
  }

  console.log(`  ✅ Импортировано: ${imported} | ⏭️  Пропущено: ${skipped}`);
  return { imported, skipped };
}

async function main() {
  try {
    const baseDir = process.cwd();

    const filesToImport = [
      path.join(baseDir, '../analytics_2024-12-26.xlsx'),
      path.join(baseDir, '../analytics_2025-12-29.xlsx'),
      path.join(baseDir, '../analytics_2026-03-17.xlsx'),
    ].filter(f => fs.existsSync(f));

    if (filesToImport.length === 0) {
      console.error('❌ Excel файлы не найдены');
      process.exit(1);
    }

    let totalImported = 0;
    let totalSkipped = 0;

    console.log('🚀 Импорт данных из Excel в CRM\n');
    console.log('='.repeat(50));

    for (const filePath of filesToImport) {
      const fileName = path.basename(filePath);
      console.log(`\n📂 Файл: ${fileName}`);

      try {
        const workbook = XLSX.readFile(filePath);
        console.log(`  📌 Листов: ${workbook.SheetNames.length}`);

        for (const sheetName of workbook.SheetNames) {
          const result = await importSheet(workbook, sheetName);
          totalImported += result.imported;
          totalSkipped += result.skipped;
        }
      } catch (error) {
        console.error(`  ❌ Ошибка: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`\n✨ ИТОГО:`);
    console.log(`  ✅ Всего импортировано: ${totalImported}`);
    console.log(`  ⏭️  Всего пропущено: ${totalSkipped}\n`);
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
