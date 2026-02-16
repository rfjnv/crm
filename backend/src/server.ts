import app from './app';
import { config } from './lib/config';
import prisma from './lib/prisma';

async function main() {
  // Verify DB connection
  await prisma.$connect();
  console.log('Database connected');

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);
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
