import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function norm(s: any) { 
  return s == null ? '' : String(s).trim().toLowerCase(); 
}

function numVal(v: any) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function parseExcelDate(value: any): Date {
  if (!value) return new Date();
  if (typeof value === 'number') {
    return new Date((value - 25569) * 86400 * 1000);
  }
  const parsed = new Date(String(value));
  return !isNaN(parsed.getTime()) ? parsed : new Date();
}

const clientsToFixStr = ["ппс", "тимур", "ламинационный"];

async function main() {
  console.log('Ищем клиентов в базе...');

  const dbClients = await prisma.client.findMany({
    where: {
      OR: clientsToFixStr.map(c => ({ companyName: { contains: c, mode: 'insensitive' } }))
    }
  });

  if (dbClients.length === 0) {
    console.log('Клиенты не найдены.');
    return;
  }
  
  console.log(`Найдено ${dbClients.length} клиентов для полного пересоздания.`);

  const possiblePaths = [
    path.join(process.cwd(), '../analytics_2026-03-18.xlsx'),
    path.join(process.cwd(), 'analytics_2026-03-18.xlsx'),
    path.resolve(__dirname, '../../../analytics_2026-03-18.xlsx'),
    String.raw`c:\Users\Noutbuk savdosi\CRM\analytics_2026-03-18.xlsx`
  ];

  let filePath = '';
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    throw new Error(`Файл Excel не найден! Убедитесь что он загружен на сервер.`);
  }
  
  console.log(`Читаем Excel: ${filePath}`);
  const wb = xlsx.readFile(filePath, { cellDates: true });

  const clientExcelData: any[] = [];
  
  // A (0): Дата сделки
  // B (1): Клиенты
  // C (2): Долг (Ост-к на начало)
  // D (3): Имя менеджеров
  // E (4): Товары
  // F (5): Количество
  // G (6): Единицы измерения
  // H (7): Цена продажи
  // I (8): Итоговая сумма (выручка)
  // J (9): Тип оплаты (к, н, н/к, п, п/к, пп, ф)
  // K (10): Номер договора или дата
  // L (11): Наличные
  // O (14): Перечисление
  // R (17): QR
  // U (20): Пластик
  // X (23): Терминал
  // AA (26): Остаток долга
  // AB (27): Дата оплаты

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
    if (rows.length < 4) continue;

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[1]) continue;
      
      const clientName = norm(row[1]);
      
      // Ищем точное вхождение
      const matchedDbClient = dbClients.find(c => {
         const dbName = norm(c.companyName);
         return dbName.includes(clientName) || clientName.includes(dbName);
      });
      
      if (matchedDbClient) {
        const dealDate = parseExcelDate(row[0]);
        const managerName = row[3] ? String(row[3]).trim() : 'Unknown';
        const productName = row[4] ? String(row[4]).trim() : '';
        const qty = numVal(row[5]);
        const unit = row[6] ? String(row[6]).trim() : 'шт';
        let price = numVal(row[7]);
        const revenue = numVal(row[8]);
        
        // Если цена 0, вычисляем из выручки
        if (price === 0 && qty > 0) {
            price = revenue / qty;
        }
        
        const paymentCode = String(row[9] || 'к').trim().toLowerCase();
        
        const cashPay = numVal(row[11]);
        const transferPay = numVal(row[14]);
        const qrPay = numVal(row[17]);
        const plasticPay = numVal(row[20]);
        const terminalPay = numVal(row[23]);
        
        const closingBalance = numVal(row[26]);
        const paymentDate = row[27] ? parseExcelDate(row[27]) : dealDate;

        clientExcelData.push({
          clientId: matchedDbClient.id,
          dealDate,
          dateStr: dealDate.toISOString().split('T')[0],
          managerName,
          productName,
          qty,
          unit,
          price,
          revenue,
          paymentCode,
          payments: {
            CASH: cashPay,
            TRANSFER: transferPay,
            QR: qrPay,
            CLICK: plasticPay,
            TERMINAL: terminalPay
          },
          closingBalance,
          paymentDate
        });
      }
    }
  }

  // Для каждого клиента сначала удаляем все его существующие сделки, затем пересоздаем по правилам
  for (const client of dbClients) {
    console.log(`\n=== Пересоздание клиента: ${client.companyName} ===`);
    const records = clientExcelData.filter(d => d.clientId === client.id);
    
    if (records.length === 0) {
        console.log(`Нет записей в Excel для клиента ${client.companyName}. Пропуск.`);
        continue;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Очистка старых данных (Cascade не распространяется на payments и inventoryMovements, поэтому вручную)
      const deals = await tx.deal.findMany({ where: { clientId: client.id }, select: { id: true }});
      const dealIds = deals.map(d => d.id);
      
      if (dealIds.length > 0) {
        await tx.payment.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.inventoryMovement.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.dealItem.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.dealComment.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.shipment.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.message.deleteMany({ where: { dealId: { in: dealIds } } }); // Если есть сообщения привязанные к deal
        await tx.deal.deleteMany({ where: { id: { in: dealIds } } });
        console.log(`Удалено ${dealIds.length} старых сделок и все их связи.`);
      }

      // 2. Группируем записи из Excel по ДАТЕ => одна Сделка (Deal) на одну дату
      const dealsByDate = new Map<string, any[]>();
      for (const row of records) {
        if (!dealsByDate.has(row.dateStr)) {
            dealsByDate.set(row.dateStr, []);
        }
        dealsByDate.get(row.dateStr)!.push(row);
      }
      
      console.log(`Найдено ${dealsByDate.size} уникальных дат (будет создано ${dealsByDate.size} сделок)`);

      // Назначаем менеджера по умолчанию
      const defaultManager = await tx.user.findFirst({ where: { role: 'MANAGER' } });
      
      let createdDeals = 0;
      let createdItems = 0;
      let createdPayments = 0;

      for (const [dateStr, rows] of dealsByDate.entries()) {
          const firstRow = rows[0];
          
          // Вычисляем общую выручку (amount) со всех товаров за эту дату
          const totalAmount = rows.reduce((sum, r) => sum + r.revenue, 0);
          
          // Определяем способ оплаты сделки (если смешанный, берем TRANSFER по умолчанию или из первого ряда)
          let method = 'TRANSFER';
          if (firstRow.paymentCode === 'н' || firstRow.paymentCode === 'н/к') method = 'CASH';
          if (firstRow.paymentCode === 'пп') method = 'CLICK';
          
          // Вычисляем статусы по 'closingBalance' последнего ряда за день (для простоты - берем последний ряд Excel)
          const lastRow = rows[rows.length - 1];
          const closingDebt = lastRow.closingBalance;
          
          // Считаем все платежи по этой сделке
          let totalPaid = 0;
          for (const r of rows) {
             const payRow = r.payments;
             totalPaid += payRow.CASH + payRow.TRANSFER + payRow.QR + payRow.CLICK + payRow.TERMINAL;
          }
          
          let paymentStatus = 'UNPAID';
          if (totalPaid >= totalAmount && totalAmount > 0) paymentStatus = 'PAID';
          else if (totalPaid > 0) paymentStatus = 'PARTIAL';
          else if (closingDebt <= 0 && totalAmount > 0) paymentStatus = 'PAID'; // Если долга нет на конец - тоже считаем оплачено

          // Создаем Deal
          const dealTitle = `${client.companyName} - ${dateStr}`;
          const newDeal = await tx.deal.create({
              data: {
                  title: dealTitle,
                  clientId: client.id,
                  managerId: defaultManager ? defaultManager.id : client.managerId || '', // Предполагаем Manager ID
                  amount: totalAmount,
                  paidAmount: totalPaid,
                  status: closingDebt === 0 ? 'CLOSED' : 'IN_PROGRESS',
                  paymentStatus: paymentStatus as any,
                  paymentMethod: method as any,
                  createdAt: firstRow.dealDate,
              }
          });
          createdDeals++;

          // Создаем Deal Items (товары разные в одну сделку)
          for (const r of rows) {
              if (r.productName) {
                  // Ищем или создаем Product
                  let product = await tx.product.findFirst({ where: { name: { mode: 'insensitive', equals: r.productName } } });
                  if (!product) {
                      product = await tx.product.create({
                          data: { name: r.productName, sku: 'ПР-' + Math.random().toString(36).substr(2, 9), unit: r.unit }
                      });
                  }
                  
                  await tx.dealItem.create({
                      data: {
                          dealId: newDeal.id,
                          productId: product.id,
                          requestedQty: r.qty,
                          price: r.price,
                          lineTotal: r.revenue,
                          dealDate: r.dealDate,
                          sourceOpType: r.paymentCode
                      }
                  });
                  createdItems++;
                  
                  // Создаем транзакции оплат
                  const createPay = async (amo: number, pMethod: string) => {
                      if (amo > 0) {
                          await tx.payment.create({
                              data: { dealId: newDeal.id, clientId: client.id, amount: amo, method: pMethod, paidAt: r.paymentDate, createdBy: defaultManager!.id }
                          });
                          createdPayments++;
                      }
                  };
                  await createPay(r.payments.CASH, 'CASH');
                  await createPay(r.payments.TRANSFER, 'TRANSFER');
                  await createPay(r.payments.QR, 'QR');
                  await createPay(r.payments.CLICK, 'CLICK');
                  await createPay(r.payments.TERMINAL, 'TERMINAL');
              }
          }
          
      }
      console.log(`Создано: ${createdDeals} сделок, ${createdItems} товаров в сделках, ${createdPayments} транзакций оплат.`);
    });
  }
  
  console.log('\nУспешное завершение. Все сделки корректно сгруппированы по датам с правильными ценами и оплатами.');
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
