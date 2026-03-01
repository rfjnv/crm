/**
 * Bulk snapshot generation for history analytics.
 * Pre-computes and caches analytics data for past months/years.
 *
 * Run: cd backend && npx tsx src/scripts/generate-snapshots.ts [year] [--force]
 * Examples:
 *   npx tsx src/scripts/generate-snapshots.ts          # current year - 1 (e.g. 2025)
 *   npx tsx src/scripts/generate-snapshots.ts 2025     # specific year
 *   npx tsx src/scripts/generate-snapshots.ts 2025 --force  # overwrite existing snapshots
 */

import { PrismaClient } from '@prisma/client';
import { saveSnapshot, getSnapshot, isPastYear, isPastMonth } from '../lib/snapshots';

const prisma = new PrismaClient();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function getAdminToken(): Promise<string> {
  // Find admin user
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });
  if (!admin) {
    throw new Error('No admin user found. Create one first.');
  }

  // Login to get token
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: admin.login, password: process.env.ADMIN_PASSWORD || 'admin' }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { accessToken: string };
  return data.accessToken;
}

async function fetchAndCache(
  token: string,
  endpoint: string,
  year: number,
  month: number,
  type: string,
  force: boolean,
): Promise<boolean> {
  // Check if snapshot already exists
  if (!force) {
    const existing = await getSnapshot({ year, month, type });
    if (existing) {
      console.log(`  [SKIP] ${type} (year=${year}, month=${month}) — already cached`);
      return false;
    }
  }

  const url = `${BASE_URL}/api/analytics/history${endpoint}?year=${year}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(`  [FAIL] ${type} (year=${year}, month=${month}) — ${res.status}`);
    return false;
  }

  const data = await res.json();
  await saveSnapshot({ year, month, type }, data);
  console.log(`  [OK]   ${type} (year=${year}, month=${month})`);
  return true;
}

async function main() {
  console.log('=======================================');
  console.log('  History Analytics Snapshot Generator');
  console.log('=======================================\n');

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const yearArg = args.find(a => !a.startsWith('--'));
  const now = new Date();
  const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const currentYear = tashkentNow.getUTCFullYear();
  const year = yearArg ? parseInt(yearArg, 10) : currentYear - 1;

  if (isNaN(year) || year < 2020 || year > 2099) {
    console.error('Invalid year. Usage: npx tsx src/scripts/generate-snapshots.ts [year] [--force]');
    process.exit(1);
  }

  console.log(`Year: ${year}`);
  console.log(`Force overwrite: ${force}`);
  console.log(`Server: ${BASE_URL}\n`);

  // Get admin token
  console.log('Authenticating...');
  let token: string;
  try {
    token = await getAdminToken();
    console.log('Authenticated as admin.\n');
  } catch (err) {
    console.error(`Authentication failed: ${(err as Error).message}`);
    console.error('Make sure the server is running and ADMIN_PASSWORD is set.');
    process.exit(1);
  }

  let generated = 0;
  let skipped = 0;

  // 1. Full-year endpoints (month=0)
  if (isPastYear(year)) {
    console.log('[1/3] Generating full-year snapshots...');
    const yearEndpoints = [
      { endpoint: '', type: 'overview' },
      { endpoint: '/extended', type: 'extended' },
      { endpoint: '/cashflow', type: 'cashflow' },
      { endpoint: '/data-quality', type: 'data-quality' },
      { endpoint: '/exchange', type: 'exchange' },
      { endpoint: '/prepayments', type: 'prepayments' },
    ];

    for (const ep of yearEndpoints) {
      const ok = await fetchAndCache(token, ep.endpoint, year, 0, ep.type, force);
      if (ok) generated++;
      else skipped++;
    }
  } else {
    console.log('[1/3] Skipping full-year snapshots (year not yet complete).');
  }

  // 2. Monthly detail snapshots
  console.log('\n[2/3] Generating monthly detail snapshots...');
  for (let m = 1; m <= 12; m++) {
    if (!isPastMonth(year, m)) {
      console.log(`  [SKIP] month-detail (year=${year}, month=${m}) — not a past month`);
      skipped++;
      continue;
    }

    if (!force) {
      const existing = await getSnapshot({ year, month: m, type: 'month-detail' });
      if (existing) {
        console.log(`  [SKIP] month-detail (year=${year}, month=${m}) — already cached`);
        skipped++;
        continue;
      }
    }

    const url = `${BASE_URL}/api/analytics/history/month/${m}?year=${year}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`  [FAIL] month-detail (year=${year}, month=${m}) — ${res.status}`);
      skipped++;
      continue;
    }

    const data = await res.json();
    await saveSnapshot({ year, month: m, type: 'month-detail' }, data);
    console.log(`  [OK]   month-detail (year=${year}, month=${m})`);
    generated++;
  }

  // 3. Summary
  console.log('\n=======================================');
  console.log(`  DONE: ${generated} generated, ${skipped} skipped`);
  console.log('=======================================');
}

main()
  .catch((err) => {
    console.error('Snapshot generation failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
