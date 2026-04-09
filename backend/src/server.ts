import app from './app';
import { config } from './lib/config';
import prisma from './lib/prisma';
import fs from 'fs';
import path from 'path';

async function connectWithRetry(maxRetries = 5, delayMs = 3000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await prisma.$connect();
      console.log('Database connected');
      return;
    } catch (err: any) {
      console.error(`DB connection attempt ${i}/${maxRetries} failed: ${err.message}`);
      if (i === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  // Ensure uploads directory exists
  const uploadsDir = path.resolve(config.uploads.dir);
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Verify DB connection with retries
  await connectWithRetry();

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
