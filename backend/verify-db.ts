import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Check deals per manager for 2026
  const managers = await p.user.findMany({
    where: { login: { endsWith: '_import' } },
    select: { id: true, fullName: true, login: true },
  });

  console.log('=== 2026 deals per manager ===');
  for (const m of managers) {
    const count = await p.deal.count({
      where: { managerId: m.id, title: { contains: '2026' } },
    });
    if (count > 0) console.log(`  ${m.fullName}: ${count} deals`);
  }

  console.log('\n=== 2025 deals per manager ===');
  for (const m of managers) {
    const count = await p.deal.count({
      where: { managerId: m.id, title: { contains: '2025' } },
    });
    if (count > 0) console.log(`  ${m.fullName}: ${count} deals`);
  }

  await p.$disconnect();
}
main().catch(console.error);
