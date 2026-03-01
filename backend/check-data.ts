import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const total = await p.dealItem.count();
  const problems = await p.dealItem.count({ where: { isProblem: true } });
  const withOpType = await p.dealItem.count({ where: { sourceOpType: { not: null } } });
  const nullOpType = await p.dealItem.count({ where: { sourceOpType: null } });
  console.log('Total items:', total);
  console.log('isProblem=true:', problems);
  console.log('sourceOpType not null:', withOpType);
  console.log('sourceOpType null:', nullOpType);

  const sample = await p.dealItem.findMany({
    take: 5,
    select: { id: true, isProblem: true, sourceOpType: true, price: true, requestedQty: true },
  });
  console.log('Sample:', JSON.stringify(sample, null, 2));

  // Check op type distribution
  const opTypes = await p.$queryRaw`SELECT source_op_type, COUNT(*)::text as cnt FROM deal_items GROUP BY source_op_type ORDER BY COUNT(*) DESC`;
  console.log('Op types:', JSON.stringify(opTypes, null, 2));

  await p.$disconnect();
}
main();
