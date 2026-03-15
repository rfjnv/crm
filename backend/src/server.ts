import app from './app';
import { config } from './lib/config';
import prisma from './lib/prisma';
import { importProductsIfNeeded } from './lib/startup-import';
import fs from 'fs';
import path from 'path';

async function main() {
  // Ensure uploads directory exists
  const uploadsDir = path.resolve(config.uploads.dir);
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Verify DB connection
  await prisma.$connect();
  console.log('Database connected');

  // Auto-import products from Excel on first run (skipped if products already exist)
  await importProductsIfNeeded();

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${config.port} [${config.nodeEnv}]`);
  });
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
