import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import prisma from './prisma';

const parseStockValue = (value: unknown): number => {
  if (!value) return 0;
  const str = String(value).trim();
  if (!str) return 0;
  const match = str.match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return 0;
  const num = parseFloat(match[1].replace(',', '.'));
  return isNaN(num) ? 0 : num;
};

export async function importProductsIfNeeded(): Promise<void> {
  if (process.env.SKIP_IMPORT === 'true') {
    console.log('[startup-import] Skipped (SKIP_IMPORT=true)');
    return;
  }

  const existingImportCount = await prisma.product.count({
    where: { sku: { startsWith: 'IMPORT-' } },
  });
  if (existingImportCount > 0) {
    console.log(`[startup-import] Excel products already imported (${existingImportCount} IMPORT- products exist). Skipping.`);
    return;
  }

  // Look for new.xlsx in parent directory of dist/ (i.e., backend/)
  const filePath = path.resolve(__dirname, '..', '..', 'new.xlsx');
  if (!fs.existsSync(filePath)) {
    console.warn(`[startup-import] new.xlsx not found at ${filePath}. Skipping.`);
    return;
  }

  console.log('[startup-import] Starting product import from new.xlsx...');

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    console.warn('[startup-import] Excel file is empty. Skipping.');
    return;
  }

  const products: Array<{ name: string; format?: string; unit: string; stock: number; rowNum: number }> = [];
  let rowNum = 2;

  for (let i = 2; i <= 1000; i++) {
    const cellB = sheet[`B${i}`];
    const cellC = sheet[`C${i}`];
    const cellD = sheet[`D${i}`];
    const cellH = sheet[`H${i}`];

    if (!cellB && !cellC && !cellD && !cellH) break;

    if (cellB?.v) {
      products.push({
        rowNum,
        name: String(cellB.v).trim(),
        format: cellC?.v ? String(cellC.v).trim() : undefined,
        unit: String(cellD?.v || 'шт').trim(),
        stock: parseStockValue(cellH?.v),
      });
    }
    rowNum++;
  }

  console.log(`[startup-import] Found ${products.length} products to import`);

  const adminUserId = '00000000-0000-0000-0000-000000000001';
  let successCount = 0;
  let errorCount = 0;

  for (const product of products) {
    try {
      const sku = `IMPORT-${Date.now()}-${successCount + 1}`;
      await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            name: product.name,
            sku,
            unit: product.unit,
            format: product.format || null,
            stock: product.stock,
            minStock: 0,
            isActive: true,
          },
        });

        if (product.stock > 0) {
          await tx.inventoryMovement.create({
            data: {
              productId: created.id,
              type: 'IN',
              quantity: product.stock,
              note: 'Начальный остаток при импорте из Excel',
              createdBy: adminUserId,
            },
          });
        }
      });
      successCount++;
    } catch (err) {
      errorCount++;
      console.error(`[startup-import] Row ${product.rowNum} failed: ${(err as Error).message}`);
    }
  }

  console.log(`[startup-import] Done: ${successCount} imported, ${errorCount} errors`);
}
