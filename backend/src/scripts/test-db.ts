import { Client } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function test() {
  console.log('Testing connection to:', process.env.DATABASE_URL?.split('@')[1]);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: true, // Render usually requires SSL
  });

  try {
    await client.connect();
    console.log('✅ Connected via pg!');
    const res = await client.query('SELECT NOW()');
    console.log('Time from DB:', res.rows[0]);
    await client.end();
  } catch (err) {
    console.error('❌ Connection failed:', err);
  }
}

test();
