import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as fs from 'fs';

const prisma = new PrismaClient();

function norm(s: any) { return s == null ? '' : String(s).trim().toLowerCase(); }
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

async function main() {
  const clientsToFix = ["ппс", "тимур дилшод", "ламинационный цех"];
  console.log('Resolving clients to fix...');

  const dbClients = await prisma.client.findMany({
    where: {
      OR: clientsToFix.map(c => ({ companyName: { contains: c, mode: 'insensitive' } }))
    }
  });

  if (dbClients.length === 0) {
    console.log('No matching clients found in DB.');
    await prisma.$disconnect();
    return;
  }
  console.log(`Found ${dbClients.length} clients to process.`);

  const filePath = String.raw`c:\Users\Noutbuk savdosi\CRM\analytics_2026-03-18.xlsx`;
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const wb = xlsx.readFile(filePath, { cellDates: true });

  const clientExcelData: any[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
    if (rows.length < 4) continue;

    const opCols = [11, 14, 17, 20, 23]; // Payment columns from L, O, R, U, X (0-indexed 10, 13, 16, 19, 22) => +1 shifted in code

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const clientNameRaw = row[1];
      if (!clientNameRaw) continue;
      
      const clientName = norm(clientNameRaw);
      const matchedDbClient = dbClients.find(c => norm(c.companyName).includes(clientName) || clientName.includes(norm(c.companyName)));
      
      if (matchedDbClient) {
        let paymentTotal = 0;
        // Shift depending on file structure. Assuming default mapping for payments
        // usually 11, 14, 17, 20, 23. But some sheets have shifted cols. Let's look for sum of cols 10 to 25 that represent numbers
        // Actually, just extract goods value (8), qty (5), and price (7)
        const dateRaw = row[0];
        const qty = numVal(row[5]);
        const price = numVal(row[7]);
        const goods = numVal(row[8]);
        
        // Sum payments in this row
        const payL = numVal(row[11]);
        const payO = numVal(row[14]);
        const payR = numVal(row[17]);
        const payU = numVal(row[20]);
        const payX = numVal(row[23]);
        paymentTotal = payL + payO + payR + payU + payX;

        clientExcelData.push({
          clientId: matchedDbClient.id,
          clientName: matchedDbClient.companyName,
          dateRaw,
          qty,
          price: price || (qty > 0 ? goods / qty : 0),
          goods,
          paymentTotal,
          sheetName
        });
      }
    }
  }

  // Now, calculate the correct deal items, prices, and payments
  for (const client of dbClients) {
    console.log(`\nProcessing client: ${client.companyName} (${client.id})`);
    const records = clientExcelData.filter(d => d.clientId === client.id);
    console.log(`Found ${records.length} excel records for client.`);

    // Hard reset their deal items and payments where price is 0 or payment is suspect
    // Actually, it's safer to map Deals by date
    const clientDeals = await prisma.deal.findMany({
      where: { clientId: client.id, isArchived: false, status: { notIn: ['CANCELED', 'REJECTED'] } },
      include: { items: true, payments: true },
      orderBy: { createdAt: 'asc' }
    });

    let fixedItems = 0;
    
    // Attempt 1: Fix deal item prices if they are 0 and we can infer from lineTotal and requestedQty
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
    
    // Attempt 2: Distribute exact total payments based on excel, since user said "история платы" is wrong.
    const totalPaymentsExcel = records.reduce((sum, r) => sum + r.paymentTotal, 0);
    const totalGoodsExcel = records.reduce((sum, r) => sum + r.goods, 0);
    
    console.log(`Total excel goods: ${totalGoodsExcel}`);
    console.log(`Total excel payments: ${totalPaymentsExcel}`);
    
    // Standardize total paid amount across ALL deals based on total payments
    let remainingPaidToAllocate = totalPaymentsExcel;
    
    for (const deal of clientDeals) {
       const dAmount = Number(deal.amount);
       let allocate = 0;
       
       if (remainingPaidToAllocate >= dAmount) {
          allocate = dAmount;
          remainingPaidToAllocate -= dAmount;
       } else if (remainingPaidToAllocate > 0) {
          allocate = remainingPaidToAllocate;
          remainingPaidToAllocate = 0;
       } else {
          allocate = 0;
       }
       
       let newStatus = 'UNPAID';
       if (allocate === 0) newStatus = 'UNPAID';
       else if (allocate >= dAmount) newStatus = 'PAID';
       else newStatus = 'PARTIAL';
       
       // Update the deal's paidAmount
       if (Number(deal.paidAmount) !== allocate || deal.paymentStatus !== newStatus) {
         await prisma.deal.update({
            where: { id: deal.id },
            data: { paidAmount: allocate, paymentStatus: newStatus as any }
         });
       }
    }
    
    console.log(`Fixed ${fixedItems} item prices from 0 to actual value.`);
  }

  console.log('\nAll done!');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
