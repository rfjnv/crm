import { Client } from 'pg';
import 'dotenv/config';

async function main() {
  const connectionString = process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'sslmode=require';
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query('SELECT title, id, status, "createdAt" FROM "Deal" ORDER BY "createdAt" DESC LIMIT 50');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
