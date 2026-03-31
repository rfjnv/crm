import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const products = await prisma.product.findMany({
    where: { isActive: true, sku: { startsWith: 'IMPORT-' } },
    select: { name: true, stock: true, unit: true, sku: true },
    orderBy: { name: 'asc' },
  });
  console.log('#|Продукт|Остаток|Ед.');
  console.log('---|---|---|---');
  products.forEach((p: any, i: number) => {
    console.log((i+1) + '|' + p.name + '|' + Number(p.stock) + '|' + p.unit);
  });
  console.log('');
  console.log('ИТОГО: ' + products.length);
  console.log('С остатком: ' + products.filter((p: any) => Number(p.stock) > 0).length);
  console.log('Нулевой: ' + products.filter((p: any) => Number(p.stock) === 0).length);
  await prisma.$disconnect();
}
main();
