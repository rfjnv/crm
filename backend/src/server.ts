import 'dotenv/config';
import app from './app';
import { config } from './lib/config';
import prisma from './lib/prisma';
import fs from 'fs';
import path from 'path';
import { catchUpTransferDealsMissedInGroups } from './modules/telegram/telegram-deal-groups.service';

async function main() {
  // Ensure uploads directory exists
  const uploadsDir = path.resolve(config.uploads.dir);
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Verify DB connection
  await prisma.$connect();
  console.log('Database connected');

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${config.port} [${config.nodeEnv}]`);
  });

  // Разовый догон сделок на перечисление, которые не попали в группы из-за задержки до документов.
  setTimeout(() => {
    catchUpTransferDealsMissedInGroups().catch((err) => console.error('[Telegram deal groups] catch-up:', err));
  }, 15_000);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
