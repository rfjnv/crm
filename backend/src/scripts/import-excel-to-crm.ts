import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient, PaymentStatus, PaymentMethod } from '@prisma/client';

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
    const existing = await prisma.user.findFirst({
      where: { role: 'MANAGER' },
    });
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
    const login = cleanName
      .toLowerCase()
      .replace(/\s+/g, '.')
      .substring(0, 30);

    manager = await prisma.user.create({
      data: {
        login: login || `manager-${Date.now()}`,
        password: 'temp',
        fullName: cleanName,
        role: 'MANAGER',
      },
    }).catch(() => createDefaultManager());
  }

  return manager;
}

async function createDefaultManager() {
  return await prisma.user.findFirst({
    where: { role: 'MANAGER' },
  }) || await prisma.user.create({
    data: {
      login: 'default-manager',
      password: 'temp',
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
    where: {
      companyName: { mode: 'insensitive', equals: cleanName },
    },
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

async function getOrCreateProduct(productName: string, unit: string = 'шт') {
  if (!productName || productName.trim() === '') {
    throw new Error('Product name cannot be empty');
  }

  const cleanName = String(productName).trim().toLowerCase();
  let product = await prisma.product.findFirst({
    where: {
      name: { mode: 'insensitive', equals: cleanName },
    },
  });

  if (!product) {
    const sku = cleanName
      .slice(0, 20)
      .toUpperCase()
      .replace(/\s+/g, '_');

    product = await prisma.product.create({
      data: {
        name: cleanName,
        sku: sku || `PROD-${Date.now()}`,
        unit: String(unit || 'шт').trim() || 'шт',
      },
    });
  }

  return product;
}

function parseExcelDate(value: any): Date {
  if (!value) return new Date();

  if (typeof value === 'number') {
    // Excel serial: days since 1900-01-01
    return new Date((value - 25569) * 86400 * 1000);
  }

  const parsed = new Date(String(value));
  return !isNaN(parsed.getTime()) ? parsed : new Date();
}

async function importSheet(
  workbook: XLSX.WorkBook,
  sheetName: string
) {
  console.log(`\n📄 Лист: ${sheetName}`);

  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(worksheet, {
    defval: null,
    blankrows: false,
  });

  console.log(`📊 Строк: ${rows.length}`);

  let imported = 0;
  let skipped = 0;
  const seenDeals = new Set<string>();

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

      const quantity = parseFloat(String(row['__EMPTY_1'] || 0).replace(',', '.')) || 0;
      const unit = String(row['__EMPTY_2'] || 'шт').trim() || 'шт';
      const paymentCode = String(row['нкп'] || 'к').trim().toLowerCase();
      const paymentMethod = PAYMENT_METHOD_MAP[paymentCode] || 'TRANSFER';

      // Получаем остаток
      const closingDebtKey = Object.keys(row).find(k => k.startsWith('Ост на'))!;
      const closingDebt = parseFloat(String(row[closingDebtKey] || 0)) || 0;

      // Получаем дату
      const dealDate = row['дата'] ? parseExcelDate(row['дата']) : parseExcelDate(row['число']);

      // Получаем или создаем менеджера
      const manager = await getOrCreateManager(managerName);

      // Получаем или создаем клиента
      const client = await getOrCreateClient(clientName, manager.id);

      // Если есть товар, создаем сделку с товаром
      let dealId: string | null = null;

      if (productName && productName !== 0 && productName !== '0') {
        const product = await getOrCreateProduct(productName, unit);

        // Групируем сделки по дате и клиенту
        const dealKey = `${client.id}-${dealDate.toISOString().split('T')[0]}`;

        let deal;
        if (!seenDeals.has(dealKey)) {
          const totalAmount = quantity > 0 ? quantity * (parseFloat(String(row['__EMPTY_3'] || 0)) || 1) : 0;

          deal = await prisma.deal.create({
            data: {
              title: `${clientName} - ${dealDate.toLocaleDateString()}`,
              status: closingDebt === 0 ? 'CLOSED' : 'IN_PROGRESS',
              amount: totalAmount,
              clientId: client.id,
              managerId: manager.id,
              paymentMethod,
              paidAmount: Math.max(0, totalAmount - closingDebt),
              paymentStatus: closingDebt > 0 ? 'PARTIAL' : 'PAID',
              createdAt: dealDate,
            },
          });

          seenDeals.add(dealKey);
          dealId = deal.id;
        } else {
          // Используем уже созданную сделку за тот же день
          const existingDeal = await prisma.deal.findFirst({
            where: {
              clientId: client.id,
              createdAt: {
                gte: new Date(dealDate.getFullYear(), dealDate.getMonth(), dealDate.getDate()),
                lt: new Date(dealDate.getFullYear(), dealDate.getMonth(), dealDate.getDate() + 1),
              },
            },
          });
          if (existingDeal) {
            dealId = existingDeal.id;
          }
        }

        if (dealId) {
          const salePrice = parseFloat(String(row['__EMPTY_3'] || 1).replace(',', '.')) || 0;
          const lineTotal = quantity * salePrice;

          // Преобразуем код платежа для sourceOpType
          const sourceOpType = paymentCode.toUpperCase().replace('/', '');

          // Создаем позицию сделки
          await prisma.dealItem.create({
            data: {
              dealId,
              productId: product.id,
              requestedQty: quantity,
              price: salePrice,
              lineTotal,
              closingBalance: closingDebt,
              sourceOpType,
              dealDate,
            },
          }).catch(() => {}); // Игнорируем дубликаты

          // Инвентарное движение
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
        // Даже без товара создаем сделку (долг)
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

          seenDeals.add(dealKey);
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
  console.log('🚀 Импорт данных из Excel в CRM\n');
  console.log('=' .repeat(50));

  try {
    const baseDir = process.cwd();

    // Проверяем, находимся ли мы в backend директории
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

    for (const filePath of filesToImport) {
      const fileName = path.basename(filePath);
      console.log(`\n📂 Файл: ${fileName}`);
      console.log('-'.repeat(50));

      if (!fs.existsSync(filePath)) {
        console.error(`  ❌ Не найден: ${filePath}`);
        continue;
      }

      try {
        const workbook = XLSX.readFile(filePath);
        console.log(`  📌 Листов: ${workbook.SheetNames.length}`);

        for (const sheetName of workbook.SheetNames) {
          const result = await importSheet(workbook, sheetName);
          totalImported += result.imported;
          totalSkipped += result.skipped;
        }
      } catch (error) {
        console.error(`  ❌ Ошибка файла: ${error instanceof Error ? error.message : 'unknown'}`);
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
