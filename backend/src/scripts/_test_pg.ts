import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('No DATABASE_URL');
  
  console.log(`Testing pg connection to: ${connectionString.substring(0, 30)}...`);
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected!');
  
  try {
    const res = await client.query('SELECT 1 as val');
    console.log('Query result:', res.rows);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
