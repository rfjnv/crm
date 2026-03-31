import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';

const prisma = new PrismaClient();

async function main() {
  const filePath = String.raw`c:\Users\Noutbuk savdosi\CRM\analytics_2026-03-18.xlsx`;
  console.log(`Loading excel file: ${filePath}`);
  const workbook = xlsx.readFile(filePath);
  
  const clientsToFix = ["ппс", "тимур дилшод", "ламинационный цех"];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    console.log(`\nSheet: ${sheetName}`);
    console.log(`Rows: ${data.length}`);
    
    // Find column with client name, normally B (index 1) according to _inspect_columns.py
    for (let r = 0; r < Math.min(data.length, 30); r++) {
       const row = data[r];
       if (!row) continue;
       const clientName = row[1];
       if (clientName && typeof clientName === 'string') {
          const lcase = clientName.toLowerCase();
          if (clientsToFix.some(c => lcase.includes(c))) {
              console.log(`Found client at row ${r + 1}: ${clientName}`);
              console.log(JSON.stringify(row));
          }
       }
    }
  }

  // Also query from DB
  console.log(`\nChecking DB...`);
  const clients = await prisma.client.findMany({
    where: {
      OR: clientsToFix.map(name => ({ companyName: { contains: name, mode: 'insensitive' } }))
    },
    include: {
      deals: {
        include: { items: true, payments: true }
      }
    }
  });

  for (const client of clients) {
    console.log(`\nClient: ${client.companyName} (ID: ${client.id})`);
    console.log(`Deals: ${client.deals.length}`);
    for (const deal of client.deals) {
       console.log(`  Deal ID: ${deal.id}, Status: ${deal.status}, Amount: ${deal.amount}, Paid: ${deal.paidAmount}`);
       for (const item of deal.items) {
           console.log(`    Item: ${item.productId}, Price: ${item.price}, Qty: ${item.requestedQty}, LineTotal: ${item.lineTotal}`);
       }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
