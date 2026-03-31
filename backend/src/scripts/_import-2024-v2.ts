/**
 * Import 2024 data from 26.12.2024.xlsx into CRM.
 * Matches 2025 structure: one deal per client per month with deal items.
 *
 * Creates:
 *   - Deal: "{client_name} — {Month_RU} 2024" (status=CLOSED)
 *   - Deal items: one per product row (linked to products table)
 *   - Payments: one per payment method per client-month (summed across rows)
 *
 * Run:
 *   cd backend && npx tsx src/scripts/_import-2024-v2.ts            # dry-run
 *   cd backend && npx tsx src/scripts/_import-2024-v2.ts --execute   # live
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const FILE_2024 = path.resolve(__dirname, '../../../26.12.2024.xlsx');
const EXECUTE = process.argv.includes('--execute');

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function norm(v: any): string {
  if (v == null) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

function normLower(v: string): string {
  return v.toLowerCase().trim().replace(/\s+/g, ' ');
}

function numVal(v: any): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// ───────── Layout detection ─────────

interface SheetLayout {
  productCol: number;
  qtyCol: number;
  unitCol: number;
  priceCol: number;
  amountCol: number;
  paymentCols: { col: number; method: string }[];
}

function detectLayout(rows: any[][]): SheetLayout | null {
  const row0 = (rows[0] || []).map((v: any) => normLower(norm(v)));
  const row1 = (rows[1] || []).map((v: any) => normLower(norm(v)));
  const totalCols = Math.max(row0.length, row1.length);

  // Find product column ("товар")
  let productCol = -1;
  for (let c = 2; c < Math.min(totalCols, 10); c++) {
    const h0 = row0[c] || '';
    const h1 = row1[c] || '';
    if (h0.includes('товар') || h1.includes('товар')) {
      productCol = c;
      break;
    }
  }
  if (productCol < 0) {
    // Fallback: January has extra col, so product at 5; otherwise 4
    const h2 = row0[2] || row1[2] || '';
    productCol = h2.includes('#') || h2.includes('остаток') ? 5 : 4;
  }

  const qtyCol = productCol + 1;
  const unitCol = productCol + 2;
  const priceCol = productCol + 3;
  const amountCol = productCol + 4;

  // Find payment method columns (each has triplet: [всего, month, долг])
  // We need the "month" column = start + 1
  const paymentCols: { col: number; method: string }[] = [];
  const found: Record<string, boolean> = {};

  for (let c = amountCol + 1; c < totalCols; c++) {
    const h0 = row0[c] || '';
    const h1 = row1[c] || '';

    if (!found['CASH'] && (h1.includes('накд') || h0.includes('накд'))) {
      paymentCols.push({ col: c + 1, method: 'CASH' });
      found['CASH'] = true;
    } else if (!found['TRANSFER'] && ((h1.includes('пер') && !h1.includes('перечисл')) || (h0.includes('пер') && !h0.includes('перечисл')))) {
      paymentCols.push({ col: c + 1, method: 'TRANSFER' });
      found['TRANSFER'] = true;
    } else if (!found['QR'] && (h1.includes('qr') || h0.includes('qr') || h0 === '#' || h1 === '#')) {
      paymentCols.push({ col: c + 1, method: 'QR' });
      found['QR'] = true;
    } else if (!found['CLICK'] && (h1.includes('пластик') || h1.includes('клик') || h0.includes('пластик') || h0.includes('клик'))) {
      paymentCols.push({ col: c + 1, method: 'CLICK' });
      found['CLICK'] = true;
    } else if (!found['TERMINAL'] && (h1.includes('терминал') || h0.includes('терминал'))) {
      paymentCols.push({ col: c + 1, method: 'TERMINAL' });
      found['TERMINAL'] = true;
    }
  }

  return { productCol, qtyCol, unitCol, priceCol, amountCol, paymentCols };
}

// ───────── Data structures ─────────

interface ProductItem {
  product: string;
  qty: number;
  unit: string;
  price: number;
  amount: number;
}

interface ClientMonth {
  clientName: string;
  month: number;
  items: ProductItem[];
  payments: { method: string; amount: number }[];
}

// ───────── Parse Excel ─────────

function parseExcel(): ClientMonth[] {
  const wb = XLSX.readFile(FILE_2024);
  const result: ClientMonth[] = [];

  console.log(`  File: ${path.basename(FILE_2024)} (${wb.SheetNames.length} sheets)\n`);

  for (let sheetIdx = 0; sheetIdx < Math.min(wb.SheetNames.length, 12); sheetIdx++) {
    const sheetName = wb.SheetNames[sheetIdx];
    const sn = sheetName.toLowerCase().trim();

    let monthIdx = -1;
    for (let m = 0; m < MONTH_NAMES.length; m++) {
      if (sn.startsWith(MONTH_NAMES[m])) { monthIdx = m; break; }
    }
    if (monthIdx < 0) {
      console.log(`    Skipping "${sheetName}"`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const layout = detectLayout(rows);
    if (!layout) {
      console.log(`    "${sheetName}": layout detection failed`);
      continue;
    }

    // Group data rows by client
    const clientGroups = new Map<string, { name: string; rowIndices: number[] }>();
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const rawName = norm(row[1]);
      if (!rawName || rawName.length < 2) continue;
      const lower = rawName.toLowerCase();
      if (lower.includes('наименование') || lower.includes('клиент') || lower === 'итого' || lower === 'всего') continue;

      const key = normLower(rawName);
      if (!clientGroups.has(key)) clientGroups.set(key, { name: rawName, rowIndices: [] });
      clientGroups.get(key)!.rowIndices.push(r);
    }

    let sheetDeals = 0, sheetItems = 0, sheetPay = 0;

    for (const [, group] of clientGroups) {
      const items: ProductItem[] = [];
      const paymentTotals: Record<string, number> = {};

      for (const r of group.rowIndices) {
        const row = rows[r];

        // Product
        const product = norm(row[layout.productCol]);
        const qty = numVal(row[layout.qtyCol]);
        const unit = norm(row[layout.unitCol]) || 'шт';
        const price = numVal(row[layout.priceCol]);
        const rawAmount = numVal(row[layout.amountCol]);

        if (product && product.length > 0) {
          items.push({
            product,
            qty,
            unit,
            price,
            amount: rawAmount > 0 ? rawAmount : qty * price,
          });
          sheetItems++;
        }

        // Payments — sum across all rows for this client
        for (const pc of layout.paymentCols) {
          const amt = numVal(row[pc.col]);
          if (amt > 0) {
            paymentTotals[pc.method] = (paymentTotals[pc.method] || 0) + amt;
          }
        }
      }

      const payments = Object.entries(paymentTotals)
        .filter(([, a]) => a > 0)
        .map(([method, amount]) => ({ method, amount }));

      if (items.length > 0 || payments.length > 0) {
        result.push({ clientName: group.name, month: monthIdx, items, payments });
        sheetDeals++;
        sheetPay += payments.length;
      }
    }

    console.log(`    ${MONTH_NAMES_RU[monthIdx].padEnd(10)}: ${String(sheetDeals).padStart(4)} deals, ${String(sheetItems).padStart(5)} items, ${String(sheetPay).padStart(4)} payments`);
  }

  return result;
}

// ───────── Main ─────────

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  IMPORT 2024 v2 — ${EXECUTE ? '** LIVE **' : 'DRY RUN'}`);
  console.log(`  One deal per client per month (matching 2025 structure)`);
  console.log(`${'='.repeat(80)}\n`);

  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  if (!adminUser) { console.error('No ADMIN user found'); process.exit(1); }
  console.log(`Admin: ${adminUser.id}\n`);

  // 1. Parse Excel
  console.log('[1/4] Parsing Excel...');
  const data = parseExcel();

  const totalDeals = data.length;
  const totalItems = data.reduce((s, d) => s + d.items.length, 0);
  const totalPayRecs = data.reduce((s, d) => s + d.payments.length, 0);
  const totalDealAmt = data.reduce((s, d) => s + d.items.reduce((ss, i) => ss + i.amount, 0), 0);
  const totalPayAmt = data.reduce((s, d) => s + d.payments.reduce((ss, p) => ss + p.amount, 0), 0);
  const uniqueClients = new Set(data.map(d => normLower(d.clientName))).size;

  console.log(`\n  Unique clients:     ${uniqueClients}`);
  console.log(`  Deals to create:    ${totalDeals}`);
  console.log(`  Deal items:         ${totalItems}`);
  console.log(`  Payment records:    ${totalPayRecs}`);
  console.log(`  Total deal amount:  ${totalDealAmt.toLocaleString()} UZS`);
  console.log(`  Total paid amount:  ${totalPayAmt.toLocaleString()} UZS`);

  if (!EXECUTE) {
    console.log('\n--- SAMPLE (first 5) ---');
    for (const d of data.slice(0, 5)) {
      const title = `${d.clientName} — ${MONTH_NAMES_RU[d.month]} 2024`;
      const iTotal = d.items.reduce((s, i) => s + i.amount, 0);
      const pTotal = d.payments.reduce((s, p) => s + p.amount, 0);
      console.log(`\n  ${title}`);
      for (const it of d.items.slice(0, 5)) {
        console.log(`    [item] ${it.product} | qty:${it.qty} ${it.unit} | price:${it.price.toLocaleString()} | amt:${it.amount.toLocaleString()}`);
      }
      if (d.items.length > 5) console.log(`    ... +${d.items.length - 5} more items`);
      for (const p of d.payments) {
        console.log(`    [pay]  ${p.method}: ${p.amount.toLocaleString()}`);
      }
      console.log(`    Total: amount=${iTotal.toLocaleString()}, paid=${pTotal.toLocaleString()}`);
    }
    console.log('\n  DRY RUN — use --execute to apply');
    await prisma.$disconnect();
    return;
  }

  // ───── EXECUTE ─────

  // 2. Load caches
  console.log('\n[2/4] Loading existing data...');
  const existingClients = await prisma.client.findMany({ select: { id: true, companyName: true } });
  const clientMap = new Map<string, string>();
  for (const c of existingClients) clientMap.set(normLower(c.companyName), c.id);
  console.log(`  Clients: ${existingClients.length}`);

  const existingProducts = await prisma.product.findMany({ select: { id: true, name: true, unit: true } });
  const productMap = new Map<string, string>();
  for (const p of existingProducts) productMap.set(`${normLower(p.name)}|${normLower(p.unit)}`, p.id);
  console.log(`  Products: ${existingProducts.length}`);

  // 3. Create data
  console.log('\n[3/4] Creating deals, items, payments...');
  let dealsCreated = 0, itemsCreated = 0, paymentsCreated = 0;
  let clientsCreated = 0, productsCreated = 0;
  let skipped = 0, errors = 0;
  let productCounter = 0;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const dealTitle = `${d.clientName} — ${MONTH_NAMES_RU[d.month]} 2024`;

    // Idempotency
    const existingDeal = await prisma.deal.findFirst({
      where: { title: dealTitle },
      select: { id: true },
    });
    if (existingDeal) { skipped++; continue; }

    try {
      // ── Find or create client ──
      let clientId = clientMap.get(normLower(d.clientName));
      if (!clientId) {
        const key = normLower(d.clientName);
        for (const [cKey, cId] of clientMap) {
          if (cKey.startsWith(key) || key.startsWith(cKey)) { clientId = cId; break; }
          if (key.length >= 5 && cKey.includes(key)) { clientId = cId; break; }
          if (cKey.length >= 5 && key.includes(cKey)) { clientId = cId; break; }
        }
      }
      if (!clientId) {
        // Check DB (handles previous partial runs)
        const dbClient = await prisma.client.findFirst({
          where: { companyName: { equals: d.clientName, mode: 'insensitive' } },
          select: { id: true },
        });
        if (dbClient) {
          clientId = dbClient.id;
        } else {
          const newClient = await prisma.client.create({
            data: {
              companyName: d.clientName,
              contactName: d.clientName,
              phone: '',
              address: '',
              managerId: adminUser.id,
            },
          });
          clientId = newClient.id;
          clientsCreated++;
        }
        clientMap.set(normLower(d.clientName), clientId);
      }

      // ── Calculate totals ──
      const dealAmount = d.items.reduce((s, item) => s + item.amount, 0);
      const paidAmount = d.payments.reduce((s, p) => s + p.amount, 0);
      const paymentStatus = paidAmount >= dealAmount && dealAmount > 0
        ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

      // ── Create deal ──
      const deal = await prisma.deal.create({
        data: {
          title: dealTitle,
          status: 'CLOSED',
          amount: dealAmount,
          paidAmount: paidAmount,
          paymentStatus: paymentStatus as any,
          paymentType: 'FULL',
          discount: 0,
          clientId: clientId,
          managerId: adminUser.id,
          createdAt: new Date(Date.UTC(2024, d.month, 1)),
        },
      });
      dealsCreated++;

      // ── Create deal items ──
      for (const item of d.items) {
        const pKey = `${normLower(item.product)}|${normLower(item.unit)}`;
        let productId = productMap.get(pKey);

        // Try name-only match (any unit)
        if (!productId) {
          for (const [key, id] of productMap) {
            if (key.startsWith(normLower(item.product) + '|')) {
              productId = id;
              break;
            }
          }
        }

        // Create new product
        if (!productId) {
          const newProduct = await prisma.product.create({
            data: {
              name: item.product,
              unit: item.unit,
              sku: `IMPORT-${Date.now()}-${productCounter++}`,
              stock: 0,
              minStock: 0,
              pricingMode: 'MANUAL',
              isActive: true,
            },
          });
          productId = newProduct.id;
          productMap.set(pKey, productId);
          productsCreated++;
        }

        await prisma.dealItem.create({
          data: {
            dealId: deal.id,
            productId: productId,
            requestedQty: item.qty,
            price: item.price,
          },
        });
        itemsCreated++;
      }

      // ── Create payments ──
      for (const pay of d.payments) {
        await prisma.payment.create({
          data: {
            dealId: deal.id,
            clientId: clientId,
            amount: pay.amount,
            method: pay.method as any,
            paidAt: new Date(Date.UTC(2024, d.month, 15)),
            createdBy: adminUser.id,
            note: `Импорт 2024: ${MONTH_NAMES_RU[d.month]}`,
          },
        });
        paymentsCreated++;
      }

      if ((i + 1) % 200 === 0) {
        console.log(`  ${i + 1}/${data.length} — ${dealsCreated} deals, ${itemsCreated} items, ${paymentsCreated} payments`);
      }
    } catch (e: any) {
      console.error(`  ERROR "${dealTitle}": ${e.message}`);
      errors++;
    }
  }

  // 4. Verify
  console.log(`\n[4/4] Verification\n`);
  console.log(`${'='.repeat(80)}`);
  console.log(`  IMPORT COMPLETE`);
  console.log(`${'='.repeat(80)}`);
  console.log(`  Deals created:      ${dealsCreated}`);
  console.log(`  Deal items created: ${itemsCreated}`);
  console.log(`  Payments created:   ${paymentsCreated}`);
  console.log(`  Clients created:    ${clientsCreated}`);
  console.log(`  Products created:   ${productsCreated}`);
  console.log(`  Skipped (existing): ${skipped}`);
  if (errors > 0) console.log(`  Errors:             ${errors}`);

  const counts = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM deals WHERE title LIKE '%2024%')::text as deals_2024,
      (SELECT COUNT(*) FROM deal_items di JOIN deals d ON d.id = di.deal_id WHERE d.title LIKE '%2024%')::text as items_2024,
      (SELECT COUNT(*) FROM payments WHERE note LIKE 'Импорт 2024:%')::text as payments_2024,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE note LIKE 'Импорт 2024:%')::text as pay_total_2024,
      (SELECT COUNT(*) FROM deals)::text as total_deals,
      (SELECT COUNT(*) FROM clients)::text as total_clients,
      (SELECT COUNT(*) FROM payments)::text as total_payments
  `);
  console.log('\n  DB Totals:');
  console.log(`    2024 deals:     ${counts[0].deals_2024}`);
  console.log(`    2024 items:     ${counts[0].items_2024}`);
  console.log(`    2024 payments:  ${counts[0].payments_2024} (${Number(counts[0].pay_total_2024).toLocaleString()} UZS)`);
  console.log(`    Total deals:    ${counts[0].total_deals}`);
  console.log(`    Total clients:  ${counts[0].total_clients}`);
  console.log(`    Total payments: ${counts[0].total_payments}`);
}

main()
  .catch(err => { console.error('FAILED:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
