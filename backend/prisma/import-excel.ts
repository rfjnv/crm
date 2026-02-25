import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import prisma from '../src/lib/prisma';

const parseStockValue = (value: unknown): number => {
  if (!value) return 0;
  const str = String(value).trim();
  if (!str) return 0;

  // Extract first number: "5(171,4)" → "5", "10.5" → "10.5", "100" → "100"
  const match = str.match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return 0;

  const num = parseFloat(match[1].replace(',', '.'));
  return isNaN(num) ? 0 : num;
};

async function importProducts() {
  try {
    // Read Excel file
    const filePath = path.resolve(__dirname, '../new.xlsx');
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) {
      console.error('Excel file is empty');
      process.exit(1);
    }

    // Parse rows
    const products: Array<{ name: string; format?: string; unit: string; stock: number; rowNum: number }> = [];
    let rowNum = 2;

    for (let i = 2; i <= 1000; i++) {
      const cellB = sheet[`B${i}`];
      const cellC = sheet[`C${i}`];
      const cellD = sheet[`D${i}`];
      const cellH = sheet[`H${i}`];

      // Stop if all cells empty
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

    console.log(`Found ${products.length} products for import`);

    // Import products
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ row: number; reason: string }> = [];
    const adminUserId = '00000000-0000-0000-0000-000000000001'; // System user ID

    for (const product of products) {
      try {
        const timestamp = Date.now();
        const index = successCount + 1;
        const sku = `IMPORT-${timestamp}-${index}`;

        // Create product in transaction
        await prisma.$transaction(async (tx) => {
          // Create product
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

          // Create initial stock movement (IN)
          if (product.stock > 0) {
            await tx.inventoryMovement.create({
              data: {
                productId: created.id,
                type: 'IN',
                quantity: product.stock,
                note: `Начальный остаток при импорте из Excel`,
                createdBy: adminUserId,
              },
            });
          }

          // Log to audit
          await tx.auditLog.create({
            data: {
              userId: adminUserId,
              action: 'IMPORT_PRODUCT',
              entityType: 'Product',
              entityId: created.id,
              after: {
                name: created.name,
                sku: created.sku,
                unit: created.unit,
                format: created.format,
                stock: product.stock,
              },
            },
          });
        });

        successCount++;
        console.log(`✓ Row ${product.rowNum}: ${product.name} (${product.stock} ${product.unit})`);
      } catch (err) {
        const reason = (err as Error).message || 'Unknown error';
        errors.push({ row: product.rowNum, reason });
        errorCount++;
        console.error(`✗ Row ${product.rowNum}: ${reason}`);
      }
    }

    console.log(`\n=== Import Results ===`);
    console.log(`Success: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    if (errors.length > 0) {
      console.log(`\nError details:`);
      errors.forEach((e) => console.log(`  Row ${e.row}: ${e.reason}`));
    }

    process.exit(0);
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  }
}

importProducts();
