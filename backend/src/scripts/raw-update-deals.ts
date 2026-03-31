import { Client } from 'pg';
import 'dotenv/config';

async function main() {
  const connectionString = process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'sslmode=require';
  console.log('Connecting with pg Client...');
  
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    console.log('Connected!');

    const targetTitle = 'Сделка от 25.03.2026';
    const newTitle = 'Сделка от 24.03.2026';
    const newDate = '2026-03-24 12:00:00';
    const newStatus = 'READY_FOR_SHIPMENT';

    const res = await client.query(
      `UPDATE "Deal" 
       SET "title" = $1, "createdAt" = $2::timestamp, "status" = $3::"DealStatus"
       WHERE "title" ILIKE $4`,
      [newTitle, newDate, newStatus, `%${targetTitle}%`]
    );

    console.log(`Updated ${res.rowCount} deals.`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
