import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function run() {
  const users = await p.user.findMany({ select: { id: true, fullName: true, role: true, login: true } });
  console.log(JSON.stringify(users, null, 2));
  await p.$disconnect();
}
run();
