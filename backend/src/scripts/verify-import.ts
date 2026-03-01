import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verify() {
  const total = await prisma.dealItem.count();
  const problem = await prisma.dealItem.count({ where: { isProblem: true } });
  console.log(`Total items: ${total}`);
  console.log(`Problem items (qty>0, price=0): ${problem}`);

  const exchange = await prisma.dealItem.count({ where: { sourceOpType: 'EXCHANGE' } });
  const pp = await prisma.dealItem.count({ where: { sourceOpType: 'PP' } });
  const k = await prisma.dealItem.count({ where: { sourceOpType: 'K' } });
  const n = await prisma.dealItem.count({ where: { sourceOpType: 'N' } });
  const nk = await prisma.dealItem.count({ where: { sourceOpType: 'NK' } });
  const p = await prisma.dealItem.count({ where: { sourceOpType: 'P' } });
  const pk = await prisma.dealItem.count({ where: { sourceOpType: 'PK' } });
  const f = await prisma.dealItem.count({ where: { sourceOpType: 'F' } });
  const unk = await prisma.dealItem.count({ where: { sourceOpType: 'UNKNOWN' } });
  const nul = await prisma.dealItem.count({ where: { sourceOpType: null } });

  console.log('\nOp type distribution:');
  console.log(`  K (карз): ${k}`);
  console.log(`  N (нал): ${n}`);
  console.log(`  NK (н/к): ${nk}`);
  console.log(`  P (переч): ${p}`);
  console.log(`  PK (п/к): ${pk}`);
  console.log(`  PP (предоплата): ${pp}`);
  console.log(`  EXCHANGE (обмен): ${exchange}`);
  console.log(`  F (фактура): ${f}`);
  console.log(`  UNKNOWN: ${unk}`);
  console.log(`  NULL (не указан): ${nul}`);

  await prisma.$disconnect();
}

verify().catch(console.error);
