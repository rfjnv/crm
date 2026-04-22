import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_PERMISSIONS = [
  'manage_users', 'view_all_deals', 'manage_deals', 'manage_leads',
  'close_deals', 'archive_deals', 'stock_confirm', 'finance_approve',
  'admin_approve', 'confirm_shipment', 'manage_inventory', 'manage_products', 'view_all_clients',
];

async function main() {
  console.log('\n=== Creating Super Admin ===\n');

  try {
    const superAdmin = await prisma.user.upsert({
      where: { login: 'superadmin' },
      update: {
        password: await bcrypt.hash('superadmin123', 12),
        fullName: 'Супер Администратор',
        role: Role.SUPER_ADMIN,
        permissions: ALL_PERMISSIONS,
      },
      create: {
        login: 'superadmin',
        password: await bcrypt.hash('superadmin123', 12),
        fullName: 'Супер Администратор',
        role: Role.SUPER_ADMIN,
        permissions: ALL_PERMISSIONS,
      },
    });

    console.log('✓ Super Admin created/updated:');
    console.log(`  Login: ${superAdmin.login}`);
    console.log(`  Name: ${superAdmin.fullName}`);
    console.log(`  Role: ${superAdmin.role}`);
    console.log(`  Password: superadmin123\n`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
