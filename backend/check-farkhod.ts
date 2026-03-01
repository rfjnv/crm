import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({ select: { id: true, fullName: true, role: true, isActive: true } });
  console.log('=== Users ===');
  for (const u of users) console.log(`  ${u.fullName} (${u.role}, active=${u.isActive}) -> ${u.id}`);

  // Check deals not from import
  const manualDeals = await p.deal.findMany({
    where: { AND: [
      { title: { not: { contains: '2025' } } },
      { title: { not: { contains: '2026' } } },
    ]},
    include: { manager: { select: { fullName: true } } },
  });
  console.log('\n=== Non-import deals ===');
  for (const d of manualDeals) console.log(`  "${d.title}" (manager: ${d.manager.fullName}, created: ${d.createdAt})`);

  // Total deals count
  const totalDeals = await p.deal.count();
  const deals2025 = await p.deal.count({ where: { title: { contains: '2025' } } });
  const deals2026 = await p.deal.count({ where: { title: { contains: '2026' } } });
  console.log(`\nTotal deals: ${totalDeals} (2025: ${deals2025}, 2026: ${deals2026}, other: ${totalDeals - deals2025 - deals2026})`);

  await p.$disconnect();
}
main().catch(console.error);
