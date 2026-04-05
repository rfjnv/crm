/**
 * One-off / local: normalize client phones to "+998 XX XXX XX XX".
 * Set DATABASE_URL (same as backend .env). For production prefer POST /api/clients/normalize-phones (SUPER_ADMIN).
 */
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;

function normalize(raw) {
  let digits = raw.replace(/[^0-9]/g, '');

  // "998XXXXXXXXX" (12 digits) → strip leading 998
  if (digits.length === 12 && digits.startsWith('998')) {
    digits = digits.slice(3);
  }
  // "99898..." typo from CSV (14+ digits with double 998) → take last 9
  if (digits.length > 9 && digits.startsWith('998')) {
    digits = digits.slice(3);
  }
  // If still >9 digits, keep last 9
  if (digits.length > 9) {
    digits = digits.slice(-9);
  }
  // Must be 9 digits for Uzbek number (XX XXX XX XX)
  if (digits.length !== 9) return null;

  // +998 XX XXX XX XX
  return `+998 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
}

async function main() {
  if (!DB_URL) {
    console.error('Set DATABASE_URL (e.g. from backend/.env)');
    process.exit(1);
  }
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 60000,
  });
  await client.connect();
  console.log('Connected.\n');

  const { rows } = await client.query(
    "SELECT id, company_name, phone FROM clients WHERE phone IS NOT NULL AND phone != '' ORDER BY company_name"
  );
  console.log(`Clients with phone: ${rows.length}\n`);

  let updated = 0;
  let skipped = 0;
  let failed = [];

  for (const r of rows) {
    const raw = r.phone.trim();
    // Some fields have multiple numbers separated by space/comma — take the first valid one
    // Split by common separators
    const parts = raw.split(/[,;\/]+/).map(s => s.trim()).filter(Boolean);

    let best = null;
    for (const part of parts) {
      const n = normalize(part);
      if (n) { best = n; break; }
    }
    // If no split worked, try the whole string
    if (!best) best = normalize(raw);

    if (!best) {
      failed.push({ company: r.company_name, phone: raw });
      skipped++;
      continue;
    }

    if (best === raw) {
      skipped++;
      continue;
    }

    await client.query('UPDATE clients SET phone = $1, updated_at = NOW() WHERE id = $2', [best, r.id]);
    console.log(`  ✅ "${r.company_name}": ${raw}  →  ${best}`);
    updated++;
  }

  if (failed.length) {
    console.log(`\n=== Could not normalize (${failed.length}) ===`);
    for (const f of failed) {
      console.log(`  ❌ "${f.company}": ${f.phone}`);
    }
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`Total with phone: ${rows.length}`);
  console.log(`Normalized: ${updated}`);
  console.log(`Already OK / skipped: ${skipped - failed.length}`);
  console.log(`Failed: ${failed.length}`);

  await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
