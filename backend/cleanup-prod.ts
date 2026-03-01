import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning all import-created deals on Render production...\n');

  for (const yearStr of ['2025', '2026']) {
    const payments = await prisma.$executeRaw`
      DELETE FROM payments WHERE deal_id IN (SELECT id FROM deals WHERE title LIKE ${'%' + yearStr})
    `;
    const inventory = await prisma.$executeRaw`
      DELETE FROM inventory_movements WHERE deal_id IN (SELECT id FROM deals WHERE title LIKE ${'%' + yearStr})
    `;
    const deals = await prisma.$executeRaw`
      DELETE FROM deals WHERE title LIKE ${'%' + yearStr}
    `;
    console.log(`  [${yearStr}] Deleted ${payments} payments, ${inventory} inv_movements, ${deals} deals`);
  }

  // Delete import-created managers that have no clients and no deals
  const importManagers = await prisma.$executeRaw`
    DELETE FROM users WHERE login LIKE '%_import'
    AND id NOT IN (SELECT DISTINCT manager_id FROM clients)
    AND id NOT IN (SELECT DISTINCT manager_id FROM deals)
  `;
  console.log(`\n  Deleted ${importManagers} orphan import managers`);

  // For managers with clients, just report them
  const remainingImport: { full_name: string; login: string }[] = await prisma.$queryRaw`
    SELECT full_name, login FROM users WHERE login LIKE '%_import'
  `;
  if (remainingImport.length > 0) {
    console.log(`  Remaining import managers (have clients/deals): ${remainingImport.map(m => m.full_name).join(', ')}`);
    // Delete these too - they'll be recreated
    // First reassign their clients to avoid FK issues
    for (const m of remainingImport) {
      await prisma.$executeRaw`
        DELETE FROM users WHERE login = ${m.login}
        AND id NOT IN (SELECT DISTINCT manager_id FROM clients WHERE manager_id = (SELECT id FROM users WHERE login = ${m.login}))
      `;
    }
  }

  const remaining = await prisma.deal.count();
  console.log(`\nRemaining deals: ${remaining}`);
  console.log('Done!');

  await prisma.$disconnect();
}
main().catch(console.error);
