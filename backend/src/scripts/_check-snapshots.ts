import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const p = new PrismaClient();

async function main() {
  const cnt = await p.monthlySnapshot.count();
  console.log('Snapshots remaining:', cnt);

  const backupDir = path.resolve(__dirname, '../../backups');
  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
    console.log('\nBackup files:');
    for (const f of files) {
      const stat = fs.statSync(path.join(backupDir, f));
      console.log(`  ${f} (${(stat.size / 1024).toFixed(0)} KB)`);
    }
  }

  await p.$disconnect();
}

main();
