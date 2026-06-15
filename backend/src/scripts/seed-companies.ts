import prisma from '../lib/prisma';

async function main() {
  const existing = await prisma.company.count();
  if (existing > 0) {
    console.log(`Companies already exist (${existing}). Skipping.`);
    return;
  }

  await prisma.company.createMany({
    data: [
      { name: 'polygraph', displayName: 'Polygraph Business' },
      { name: 'grand-astra', displayName: 'Grand Astra' },
    ],
  });

  console.log('✓ Companies seeded: Polygraph Business + Grand Astra');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
