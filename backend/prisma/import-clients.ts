import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

interface ClientEntry {
  companyName: string;
  phone: string;
}

function formatPhone(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  // Take only the first phone number if multiple are provided
  let phone = raw.split(/\s{2,}/)[0].trim();
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;
  // Ensure it starts with +998
  if (digits.startsWith('998')) {
    return '+' + digits;
  }
  if (digits.length === 9) {
    return '+998' + digits;
  }
  return '+998' + digits;
}

async function main() {
  // Find a default manager to assign clients to
  const manager = await prisma.user.findFirst({
    where: { login: 'manager1' },
  });
  if (!manager) {
    console.error('Manager user not found. Run seed first.');
    process.exit(1);
  }

  // Read extracted clients data
  const dataPath = join(__dirname, 'clients-data.json');
  let clientsData: ClientEntry[];
  try {
    clientsData = JSON.parse(readFileSync(dataPath, 'utf-8'));
  } catch {
    console.error(`Could not read ${dataPath}. Run extract-clients.js first.`);
    process.exit(1);
  }

  console.log(`Found ${clientsData.length} clients to import...`);

  let created = 0;
  let skipped = 0;

  for (const entry of clientsData) {
    const companyName = entry.companyName.trim();
    if (!companyName || companyName.length < 2) {
      skipped++;
      continue;
    }

    // Skip generic/non-company entries
    if (['прочее', 'кукон', 'тимур', 'андижон', 'замир', 'рауф', 'володия', 'тимофей', 'анастасия', 'инт'].includes(companyName.toLowerCase())) {
      skipped++;
      continue;
    }

    // Check if client already exists by companyName
    const existing = await prisma.client.findFirst({
      where: { companyName: { equals: companyName, mode: 'insensitive' } },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const phone = formatPhone(entry.phone);

    await prisma.client.create({
      data: {
        companyName,
        contactName: companyName, // Use company name as contact since we don't have separate contact names
        phone,
        managerId: manager.id,
      },
    });
    created++;
  }

  console.log(`\nImport complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped} (already exist or invalid)`);
  console.log(`  Total: ${clientsData.length}`);
}

main()
  .catch((err) => {
    console.error('Import error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
