/**
 * READ-ONLY analysis: deal_items with requested_qty=0 and price=0 (both coalesced).
 * Does not modify the database.
 *
 * Run: cd backend && npx tsx scripts/_analyze_invalid_deal_items.ts
 */
import { config as loadEnv } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
loadEnv({ path: path.join(backendRoot, '.env') });

const prisma = new PrismaClient();

function isInvalidItem(qty: unknown, price: unknown): boolean {
  const q = qty == null ? 0 : Number(qty);
  const p = price == null ? 0 : Number(price);
  return q === 0 && p === 0;
}

function isValidItem(qty: unknown, price: unknown): boolean {
  const q = qty == null ? 0 : Number(qty);
  const p = price == null ? 0 : Number(price);
  return q > 0 || p > 0;
}

type RowOut = {
  dealId: string;
  clientName: string;
  dealName: string;
  countInvalidItems?: number;
  reason?: string;
};

async function main() {
  const [deals, items] = await Promise.all([
    prisma.deal.findMany({
      select: {
        id: true,
        title: true,
        client: { select: { companyName: true } },
      },
    }),
    prisma.dealItem.findMany({
      select: {
        dealId: true,
        requestedQty: true,
        price: true,
      },
    }),
  ]);

  const byDeal = new Map<string, typeof items>();
  for (const it of items) {
    const arr = byDeal.get(it.dealId) ?? [];
    arr.push(it);
    byDeal.set(it.dealId, arr);
  }

  const safeToDelete: RowOut[] = [];
  const manualOnlyInvalid: RowOut[] = [];
  const manualNoItems: RowOut[] = [];

  for (const d of deals) {
    const dis = byDeal.get(d.id) ?? [];
    if (dis.length === 0) {
      manualNoItems.push({
        dealId: d.id,
        clientName: d.client.companyName,
        dealName: d.title,
        reason: 'no items',
      });
      continue;
    }
    let inv = 0;
    let vld = 0;
    for (const di of dis) {
      if (isInvalidItem(di.requestedQty, di.price)) inv++;
      if (isValidItem(di.requestedQty, di.price)) vld++;
    }
    if (inv === 0) continue;
    if (vld > 0) {
      safeToDelete.push({
        dealId: d.id,
        clientName: d.client.companyName,
        dealName: d.title,
        countInvalidItems: inv,
      });
    } else {
      manualOnlyInvalid.push({
        dealId: d.id,
        clientName: d.client.companyName,
        dealName: d.title,
        reason: 'only invalid items',
      });
    }
  }

  const manualReview = [...manualOnlyInvalid, ...manualNoItems];

  const invalidItemRows = items.filter((i) =>
    isInvalidItem(i.requestedQty, i.price),
  ).length;

  const examples = [
    { needle: 'фойл трейдинг', needle2: '17.05.2024', label: 'фойл трейдинг — 17.05.2024' },
    { needle: 'принт лайн', needle2: 'сверка', label: 'принт лайн — Сверка' },
    { needle: 'само принт', needle2: '03.03.2026', label: 'само принт — 03.03.2026' },
  ];

  function norm(s: string) {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  console.log('=== Invalid deal_items row count (requested_qty=0 & price=0, NULL as 0) ===');
  console.log(invalidItemRows);
  console.log('');
  console.log('=== Counts ===');
  console.log('safeToDelete (deals):', safeToDelete.length);
  console.log('manualReview — only invalid items (deals):', manualOnlyInvalid.length);
  console.log('manualReview — no items (deals):', manualNoItems.length);
  console.log('manualReview (total deals):', manualReview.length);
  console.log('');
  console.log('=== Example deals classification ===');
  for (const ex of examples) {
    const hit = deals.find(
      (d) =>
        norm(d.title).includes(norm(ex.needle)) &&
        norm(d.title).includes(norm(ex.needle2)),
    );
    if (!hit) {
      console.log(`"${ex.label}": NOT FOUND (title mismatch — search manually)`);
      continue;
    }
    const bucket = safeToDelete.some((r) => r.dealId === hit.id)
      ? 'safeToDelete'
      : manualReview.some((r) => r.dealId === hit.id)
        ? 'manualReview'
        : 'no invalid items on deal?';
    const detail = manualReview.find((r) => r.dealId === hit.id);
    console.log(
      `"${ex.label}" -> ${bucket}` +
        (detail?.reason ? ` (${detail.reason})` : '') +
        ` [id=${hit.id}] actualTitle=${JSON.stringify(hit.title)}`,
    );
  }
  console.log('');
  console.log('=== Top 10 safeToDelete (by count invalid items desc) ===');
  console.table(
    [...safeToDelete]
      .sort((a, b) => (b.countInvalidItems ?? 0) - (a.countInvalidItems ?? 0))
      .slice(0, 10),
  );
  console.log('=== Top 10 manualReview — only invalid items ===');
  console.table(manualOnlyInvalid.slice(0, 10));
  console.log('=== Top 10 manualReview — no items ===');
  console.table(manualNoItems.slice(0, 10));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
