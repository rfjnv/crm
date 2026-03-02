/**
 * Stock change report: reconstructs before/after from movements
 * было = текущий_остаток + SUM(OUT) - SUM(IN)
 * Run: cd backend && npx tsx src/scripts/stock-report.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. All active IMPORT products
  const products = await prisma.product.findMany({
    where: { isActive: true, sku: { startsWith: 'IMPORT-' } },
    select: { id: true, name: true, sku: true, stock: true, unit: true },
    orderBy: { name: 'asc' },
  });

  // 2. All movements grouped by product
  const movements = await prisma.inventoryMovement.findMany({
    select: { productId: true, type: true, quantity: true, createdAt: true },
  });

  // Build per-product movement summary
  const movSummary = new Map<string, { totalIn: number; totalOut: number; totalCorr: number }>();
  for (const m of movements) {
    if (!movSummary.has(m.productId)) {
      movSummary.set(m.productId, { totalIn: 0, totalOut: 0, totalCorr: 0 });
    }
    const s = movSummary.get(m.productId)!;
    const qty = Math.abs(Number(m.quantity));
    if (m.type === 'IN') s.totalIn += qty;
    else if (m.type === 'OUT') s.totalOut += qty;
    else if (m.type === 'CORRECTION') s.totalCorr += qty;
  }

  console.log('='.repeat(110));
  console.log('  STOCK CHANGE REPORT — All Products');
  console.log('='.repeat(110));
  console.log(`  Products: ${products.length}  |  Total movements: ${movements.length}`);
  console.log('='.repeat(110));
  console.log('');
  console.log(
    '#'.padEnd(5) +
    'Product'.padEnd(30) +
    'Было'.padStart(12) +
    'Расход'.padStart(12) +
    'Приход'.padStart(12) +
    'Стало'.padStart(12) +
    'Разница'.padStart(12) +
    '  ' + 'Ед.'
  );
  console.log('-'.repeat(110));

  let totalChanged = 0;
  let totalUnchanged = 0;
  const rows: string[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const currentStock = Number(p.stock);
    const summary = movSummary.get(p.id) || { totalIn: 0, totalOut: 0, totalCorr: 0 };

    // Reconstruct old stock: было = стало + расход - приход
    const oldStock = currentStock + summary.totalOut - summary.totalIn;
    const diff = currentStock - oldStock; // разница

    if (Math.abs(diff) > 0.001) totalChanged++;
    else totalUnchanged++;

    const line =
      String(i + 1).padEnd(5) +
      p.name.substring(0, 28).padEnd(30) +
      oldStock.toFixed(1).padStart(12) +
      (summary.totalOut > 0 ? ('-' + summary.totalOut.toFixed(1)) : '0').padStart(12) +
      (summary.totalIn > 0 ? ('+' + summary.totalIn.toFixed(1)) : '0').padStart(12) +
      currentStock.toFixed(1).padStart(12) +
      ((diff >= 0 ? '+' : '') + diff.toFixed(1)).padStart(12) +
      '  ' + p.unit;

    console.log(line);
  }

  console.log('-'.repeat(110));
  console.log(`  Changed: ${totalChanged}  |  Unchanged: ${totalUnchanged}  |  Total: ${products.length}`);
  console.log('='.repeat(110));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
