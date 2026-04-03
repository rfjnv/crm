/**
 * Writes ../companies.md (repo root): all client company names, A–Z, unique.
 * Loads backend/.env from this file's directory (works from any cwd).
 *
 * Render Postgres: uses IPv4 + TLS SNI to the internal-style hostname so the
 * server certificate matches (*.region-postgres.render.com). Prisma's default
 * engine often hits P1017 / hostname mismatch when using the external hostname only.
 *
 * Run: cd backend && npx tsx _export_companies_md.ts
 * Or:  npx tsx backend/_export_companies_md.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import dns from 'node:dns/promises';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'pg-connection-string';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendEnv = path.join(scriptDir, '.env');
const repoRoot = path.resolve(scriptDir, '..');

if (fs.existsSync(backendEnv)) {
  loadEnv({ path: backendEnv, override: false });
} else {
  loadEnv({ path: path.join(repoRoot, 'backend', '.env'), override: false });
}
for (const name of ['.env.production', '.env.local'] as const) {
  const p = path.join(scriptDir, name);
  if (fs.existsSync(p)) {
    loadEnv({ path: p, override: true });
  }
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    'DATABASE_URL is missing. Set it in backend/.env (same value as production / Render) or export it in the shell.',
  );
  process.exit(1);
}

function isLocalDatabaseUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(url);
}

function isRenderPostgresUrl(url: string): boolean {
  return /postgres\.render\.com/i.test(url);
}

/** External Render host uses a cert issued for the non-external hostname (*.region-postgres.render.com). */
function renderTlsServerName(host: string): string {
  return host.replace(/\.external\.(?=[a-z0-9-]+-postgres\.render\.com)/i, '.');
}

function appendSslModeRequire(url: string): string {
  if (/sslmode=/i.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'sslmode=require';
}

async function createPool(rawUrl: string): Promise<Pool> {
  const trimmed = rawUrl.trim();
  if (isLocalDatabaseUrl(trimmed)) {
    return new Pool({ connectionString: trimmed, max: 1 });
  }
  if (isRenderPostgresUrl(trimmed)) {
    const cfg = parse(trimmed);
    if (!cfg.host) {
      throw new Error('DATABASE_URL has no host');
    }
    const servername = renderTlsServerName(cfg.host);
    const { address } = await dns.lookup(cfg.host, { family: 4 });
    return new Pool({
      user: cfg.user,
      password: cfg.password,
      host: address,
      port: cfg.port ? Number(cfg.port) : 5432,
      database: cfg.database ?? undefined,
      ssl: { servername, rejectUnauthorized: true },
      max: 1,
    });
  }
  return new Pool({ connectionString: appendSslModeRequire(trimmed), max: 1 });
}

function renderConnectionHelp(): string {
  return [
    'If the connection still fails after TLS succeeds:',
    '- Copy the current External Database URL from the Render dashboard (Connect) into backend/.env as DATABASE_URL.',
    '- If the database has Inbound IP rules, add this machine public IP or use 0.0.0.0/0 for testing.',
    '- Resume the database if it was suspended (free tier).',
  ].join('\n');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rawUrl = process.env.DATABASE_URL!.trim();
  const pool = await createPool(rawUrl);
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.$connect();
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        await sleep(2000 * attempt);
      }
    }
  }
  if (lastErr) {
    console.error(lastErr);
    console.error(renderConnectionHelp());
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const rows = await prisma.client.findMany({
    select: { companyName: true },
  });
  const names = rows
    .map((r) => r.companyName.trim())
    .filter((n) => n.length > 0);
  const unique = [...new Set(names)];
  unique.sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }));

  const lines = ['# Companies List', ''];
  unique.forEach((name, i) => {
    lines.push(`${i + 1}. ${name}`);
  });
  lines.push('');

  const outPath = path.join(repoRoot, 'companies.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(outPath);
  console.log(unique.length);
  if (unique.length > 0) {
    console.log('FIRST5:' + unique.slice(0, 5).join('|'));
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  console.error(renderConnectionHelp());
  process.exit(1);
});
