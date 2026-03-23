import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'connection_limit=1&pool_timeout=0&sslmode=require'
    }
  }
});

function norm(s: any) { return s == null ? '' : String(s).trim().toLowerCase(); }
function numVal(v: any) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

const clientsToFixStr = ["ппс", "тимур дилшод", "ламинационный цех"];

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

  // Path resolution so it works on Linux server as well as Windows
  let filePath = path.resolve(__dirname, '../../../../analytics_2026-03-18.xlsx');
  if (!fs.existsSync(filePath)) {
    filePath = String.raw`c:\Users\Noutbuk savdosi\CRM\analytics_2026-03-18.xlsx`;
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Файл Excel не найден. Пожалуйста добавьте его в корень CRM: ${filePath}`);
  }
  
  console.log(`Загрузка Excel: ${filePath}`);
  const wb = xlsx.readFile(filePath, { cellDates: true });

  const clientExcelData: any[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
    if (rows.length < 4) continue;

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[1]) continue;
      
      const clientName = norm(row[1]);
      const matchedDbClient = dbClients.find(c => norm(c.companyName).includes(clientName) || clientName.includes(norm(c.companyName)));
      
      if (matchedDbClient) {
        const qty = numVal(row[5]);
        const price = numVal(row[7]);
        const goods = numVal(row[8]);
        
        const payL = numVal(row[11]);
        const payO = numVal(row[14]);
        const payR = numVal(row[17]);
        const payU = numVal(row[20]);
        const payX = numVal(row[23]);
        const paymentTotal = payL + payO + payR + payU + payX;

        clientExcelData.push({
          clientId: matchedDbClient.id,
          qty,
          price: price > 0 ? price : (qty > 0 ? goods / qty : 0),
          goods,
          paymentTotal,
        });
      }
    }
  }

  for (const client of dbClients) {
    console.log(`\nОбработка клиента: ${client.companyName} (${client.id})`);
    const records = clientExcelData.filter(d => d.clientId === client.id);
    
    const clientDeals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      include: { items: true, payments: true },
      orderBy: { createdAt: 'asc' }
    });

    let fixedItems = 0;
    
    for (const deal of clientDeals) {
      for (const item of deal.items) {
        if (Number(item.price) === 0 && Number(item.requestedQty) > 0 && Number(item.lineTotal) > 0) {
           const newPrice = Number(item.lineTotal) / Number(item.requestedQty);
           await prisma.dealItem.update({
             where: { id: item.id },
             data: { price: newPrice }
           });
           fixedItems++;
        }
      }
    }
    
    const totalPaymentsExcel = records.reduce((sum, r) => sum + r.paymentTotal, 0);
    
    console.log(`  Всего оплат (исправлено) по Excel: ${totalPaymentsExcel}`);
    
    let remainingToAllocate = totalPaymentsExcel;
    let deletedPaymentsCount = 0;
    let createdPaymentsCount = 0;
    
    await prisma.$transaction(async (tx) => {
      const dealIds = clientDeals.map(d => d.id);
      if (dealIds.length > 0) {
        const delRes = await tx.payment.deleteMany({ where: { dealId: { in: dealIds } } });
        deletedPaymentsCount += delRes.count;
      }
      
      for (const deal of clientDeals) {
         const dAmount = Number(deal.amount);
         let allocate = 0;
         
         if (remainingToAllocate >= dAmount) {
            allocate = dAmount;
            remainingToAllocate -= dAmount;
         } else if (remainingToAllocate > 0) {
            allocate = remainingToAllocate;
            remainingToAllocate = 0;
         } else {
            allocate = 0;
         }
         
         let newStatus = 'UNPAID';
         if (allocate === 0) newStatus = 'UNPAID';
         else if (allocate >= dAmount) newStatus = 'PAID';
         else newStatus = 'PARTIAL';
         
         await tx.deal.update({
            where: { id: deal.id },
            data: { paidAmount: allocate, paymentStatus: newStatus as any }
         });
         
         if (allocate > 0) {
            await tx.payment.create({
              data: {
                dealId: deal.id,
                clientId: client.id,
                amount: allocate,
                method: deal.paymentMethod || 'TRANSFER',
                paidAt: deal.createdAt,
                createdBy: deal.managerId
              }
            });
            createdPaymentsCount++;
         }
      }
    });
    
    console.log(`  Исправлено нулевых цен (deal_items): ${fixedItems}`);
    console.log(`  Удалено старых неверных платежей: ${deletedPaymentsCount}, Распределено новых: ${createdPaymentsCount}`);
  }

  console.log('\n✅ Успешно обновлено!');
}

main()
  .catch(err => console.error('Ошибка:', err))
  .finally(() => prisma.$disconnect());
