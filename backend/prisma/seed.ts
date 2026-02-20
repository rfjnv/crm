import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_PERMISSIONS = [
  'manage_users', 'view_all_deals', 'manage_deals', 'manage_leads',
  'close_deals', 'archive_deals', 'stock_confirm', 'finance_approve',
  'admin_approve', 'confirm_shipment', 'manage_inventory', 'manage_products', 'view_all_clients',
];

async function main() {
  const hash = await bcrypt.hash('password123', 12);

  // ========== USERS ==========
  const users = await Promise.all([
    prisma.user.upsert({
      where: { login: 'admin' },
      update: {},
      create: { login: 'admin', password: await bcrypt.hash('admin123', 12), fullName: 'Администратор Иванов', role: Role.ADMIN, permissions: ALL_PERMISSIONS },
    }),
    prisma.user.upsert({
      where: { login: 'superadmin' },
      update: {},
      create: { login: 'superadmin', password: await bcrypt.hash('superadmin123', 12), fullName: 'Супер Администратор', role: Role.SUPER_ADMIN, permissions: ALL_PERMISSIONS },
    }),
    prisma.user.upsert({
      where: { login: 'manager1' },
      update: {},
      create: { login: 'manager1', password: hash, fullName: 'Алексей Петров', role: Role.MANAGER, permissions: ['manage_deals', 'manage_leads', 'view_all_clients'] },
    }),
    prisma.user.upsert({
      where: { login: 'manager2' },
      update: {},
      create: { login: 'manager2', password: hash, fullName: 'Мария Соколова', role: Role.MANAGER, permissions: ['manage_deals', 'manage_leads', 'view_all_clients'] },
    }),
    prisma.user.upsert({
      where: { login: 'accountant' },
      update: {},
      create: { login: 'accountant', password: hash, fullName: 'Елена Козлова', role: Role.ACCOUNTANT, permissions: ['finance_approve', 'view_all_deals'] },
    }),
    prisma.user.upsert({
      where: { login: 'warehouse' },
      update: {},
      create: { login: 'warehouse', password: hash, fullName: 'Дмитрий Волков', role: Role.WAREHOUSE, permissions: ['stock_confirm', 'manage_inventory'] },
    }),
    prisma.user.upsert({
      where: { login: 'wh_manager' },
      update: {},
      create: { login: 'wh_manager', password: hash, fullName: 'Сергей Новиков', role: Role.WAREHOUSE_MANAGER, permissions: ['stock_confirm', 'manage_inventory', 'confirm_shipment'] },
    }),
    prisma.user.upsert({
      where: { login: 'operator' },
      update: {},
      create: { login: 'operator', password: hash, fullName: 'Анна Морозова', role: Role.OPERATOR, permissions: ['manage_leads', 'view_all_clients'] },
    }),
  ]);

  console.log(`Users: ${users.length} created/found`);

  // ========== SUMMARY ==========
  console.log('\n--- Seed complete ---');
  console.log('Logins (password for all non-admin: password123):');
  console.log('  admin / admin123');
  console.log('  superadmin / superadmin123');
  console.log('  manager1, manager2, accountant, warehouse, wh_manager, operator / password123');
}

main()
  .catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
