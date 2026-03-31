import { Client } from 'pg';
import 'dotenv/config';
import fs from 'fs';

async function main() {
  const connectionString = process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'sslmode=require';
  const out = [];
  out.push('Connecting...');
  
  const client = new Client({ connectionString });
  try {
    await client.connect();
    out.push('Connected!');

    const targetPattern = '%Сделка от 25.03.2026%';
    const newTitle = 'Сделка от 24.03.2026';
    const newDate = '2026-03-24 12:00:00';
    const newStatus = 'READY_FOR_SHIPMENT';

    const res = await client.query(
      `UPDATE "Deal" 
       SET "title" = $1, "createdAt" = $2::timestamp, "status" = $3::"DealStatus"
       WHERE "title" ILIKE $4`,
      [newTitle, newDate, newStatus, targetPattern]
    );

    out.push(`Updated ${res.rowCount} deals.`);
  } catch (err: any) {
    out.push(`Error: ${err.message}`);
  } finally {
    await client.end();
    fs.writeFileSync('update_log.txt', out.join('\n'));
  }
}

main();
