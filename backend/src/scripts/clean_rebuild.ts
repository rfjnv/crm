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

const clientsToFixStr = ["ппс", "тимур", "ламинац"];

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

  const fileNames = [
    'analytics_2024-12-26.xlsx',
    'analytics_2025-12-29.xlsx',
    'analytics_2026-03-18.xlsx'
  ];

  const filesFound: string[] = [];

  for (const fName of fileNames) {
    const possiblePaths = [
      path.join(process.cwd(), '../' + fName),
      path.join(process.cwd(), fName),
      path.resolve(__dirname, '../../../' + fName),
      'c:\\Users\\Noutbuk savdosi\\CRM\\' + fName
    ];

    let found = false;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        filesFound.push(p);
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(`Внимание! Файл ${fName} не найден!`);
    }
  }

  if (filesFound.length === 0) {
    throw new Error('Ни один файл Excel не найден! Загрузите документы на сервер.');
  }
  
  const clientExcelData: any[] = [];
  
  for (const filePath of filesFound) {
    console.log(`Читаем Excel: ${filePath}`);
    const wb = xlsx.readFile(filePath, { cellDates: true });

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
      if (rows.length < 4) continue;

      for (let r = 3; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[1]) continue;
        
        const clientName = norm(row[1]);
        
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
          const revenue = numVal(row[8]); // Итоговая сумма выручки (I)
          
          if (price === 0 && qty > 0) {
              price = revenue / qty;
          }
          
          const paymentCode = String(row[9] || 'к').trim().toLowerCase(); // J
          
          const cashPay = numVal(row[11]);
          const transferPay = numVal(row[14]);
          const qrPay = numVal(row[17]);
          const plasticPay = numVal(row[20]);
          const terminalPay = numVal(row[23]);
          
          const paymentDate = row[27] ? parseExcelDate(row[27]) : dealDate; // AB

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
            paymentDate
          });
        }
      }
    }
  }

  for (const client of dbClients) {
    console.log(`\n=== Очистка и создание сделок: ${client.companyName} ===`);
    const records = clientExcelData.filter(d => d.clientId === client.id);
    
    if (records.length === 0) {
        console.log(`Нет записей.`);
        continue;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Полностью удаляем старые сделки
      const deals = await tx.deal.findMany({ where: { clientId: client.id }, select: { id: true }});
      const dealIds = deals.map(d => d.id);
      
      if (dealIds.length > 0) {
        await tx.payment.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.inventoryMovement.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.dealItem.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.dealComment.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.shipment.deleteMany({ where: { dealId: { in: dealIds } } });
        await tx.message.deleteMany({ where: { dealId: { in: dealIds } } }); 
        await tx.deal.deleteMany({ where: { id: { in: dealIds } } });
        console.log(`Удалено сделок: ${dealIds.length} со всеми связями.`);
      }

      // 2. Группируем по дате сделки (как и просил клиент - одна дата = одна сделка)
      const dealsByDate = new Map<string, any[]>();
      for (const row of records) {
        if (!dealsByDate.has(row.dateStr)) {
            dealsByDate.set(row.dateStr, []);
        }
        dealsByDate.get(row.dateStr)!.push(row);
      }

      const defaultManager = await tx.user.findFirst({ where: { role: 'MANAGER' } });
      let createdDeals = 0;

      for (const [dateStr, rows] of dealsByDate.entries()) {
          const firstRow = rows[0];
          
          // Выручка сделки складывается только из колонки выручка (I) всех товаров в этот день
          const totalAmount = rows.reduce((sum, r) => sum + r.revenue, 0); 
          
          let method = 'TRANSFER';
          if (firstRow.paymentCode === 'н' || firstRow.paymentCode === 'н/к') method = 'CASH';
          else if (firstRow.paymentCode === 'пп') method = 'CLICK';
          
          // Считаем все платежи по всем позициям в этот день
          let totalPaid = 0;
          for (const r of rows) {
             const payRow = r.payments;
             totalPaid += payRow.CASH + payRow.TRANSFER + payRow.QR + payRow.CLICK + payRow.TERMINAL;
          }
          
          let paymentStatus = 'UNPAID';
          if (totalPaid >= totalAmount && totalAmount > 0) paymentStatus = 'PAID';
          else if (totalPaid > 0) paymentStatus = 'PARTIAL';
          else if (totalAmount === 0 && totalPaid > 0) paymentStatus = 'PAID'; // чистая оплата долга без товаров

          const dealTitle = `${client.companyName} - сделка от ${dateStr}`;
          
          // Создаем чистую сделку
          const newDeal = await tx.deal.create({
              data: {
                  title: dealTitle,
                  clientId: client.id,
                  managerId: defaultManager ? defaultManager.id : client.managerId || '', 
                  amount: totalAmount,
                  paidAmount: totalPaid,
                  status: (totalAmount > 0 && totalPaid >= totalAmount) ? 'CLOSED' : 'IN_PROGRESS',
                  paymentStatus: paymentStatus as any,
                  paymentMethod: method as any,
                  createdAt: firstRow.dealDate,
              }
          });
          createdDeals++;

          for (const r of rows) {
              if (r.productName) {
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
                          lineTotal: r.revenue, // именно колонка (I)
                          dealDate: r.dealDate,
                          sourceOpType: r.paymentCode
                      }
                  });
              }
              
              // Заносим платежи именно на ту дату оплаты (AB), которая стояла в строке
              const createPay = async (amo: number, pMethod: string) => {
                  if (amo > 0) {
                      await tx.payment.create({
                          data: { dealId: newDeal.id, clientId: client.id, amount: amo, method: pMethod, paidAt: r.paymentDate, createdBy: defaultManager!.id }
                      });
                  }
              };
              await createPay(r.payments.CASH, 'CASH');
              await createPay(r.payments.TRANSFER, 'TRANSFER');
              await createPay(r.payments.QR, 'QR');
              await createPay(r.payments.CLICK, 'CLICK');
              await createPay(r.payments.TERMINAL, 'TERMINAL');
          }
      }
      console.log(`Готово: ${createdDeals} сделок восстановлено по датам.`);
    }, { timeout: 300000 }); 
  }
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
