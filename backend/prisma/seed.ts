import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_PERMISSIONS = [
  'manage_users', 'view_all_deals', 'manage_deals', 'manage_leads',
  'close_deals', 'archive_deals', 'stock_confirm', 'finance_approve',
  'admin_approve', 'confirm_shipment', 'manage_inventory', 'manage_products', 'view_all_clients',
];

async function main() {
  // ========== CLEANUP OLD DATA (everything except users) ==========
  console.log('Cleaning old data...');

  // Delete in correct dependency order
  await prisma.messageAttachment.deleteMany();
  await prisma.taskAttachment.deleteMany();
  await prisma.conversationRead.deleteMany();
  await prisma.message.deleteMany();
  await prisma.dealComment.deleteMany();
  // DealItem references Product, must come before Product
  await prisma.dealItem.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationBatch.deleteMany();
  // InventoryMovement might reference Product or Deal
  await prisma.inventoryMovement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.expense.deleteMany();
  // Deal references Client, Client deletes AFTER Deals
  await prisma.deal.deleteMany();
  await prisma.contract.deleteMany();
  // Product can now be deleted
  await prisma.product.deleteMany();
  // Client can now be deleted
  await prisma.client.deleteMany();
  await prisma.session.deleteMany();

  console.log('Old data cleaned.');

  // ========== USERS ==========
  const hash = await bcrypt.hash('password123', 12);

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

  // ========== CLIENTS ==========
  const manager = users[2]; // manager1
  const clients = await Promise.all([
    prisma.client.create({
      data: {
        companyName: 'ООО Сервис 1',
        contactName: 'Иван Петров',
        phone: '+998901234567',
        email: 'ivan@service1.uz',
        managerId: manager.id,
      },
    }),
    prisma.client.create({
      data: {
        companyName: 'АО Тойота Сервис',
        contactName: 'Махмуд Ахмедов',
        phone: '+998901234568',
        email: 'mahmud@toyota.uz',
        managerId: manager.id,
      },
    }),
  ]);

  console.log(`Clients: ${clients.length} created`);

  // ========== PRODUCTS ==========
  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Масло моторное 5W-30',
        sku: 'OIL-5W30-001',
        unit: 'канистра',
        stock: 100,
        purchasePrice: 50000,
        salePrice: 65000,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Воздушный фильтр',
        sku: 'FILTER-AIR-001',
        unit: 'шт',
        stock: 500,
        purchasePrice: 5000,
        salePrice: 8000,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Аккумулятор 12V 60Ah',
        sku: 'BATT-12V-60-001',
        unit: 'шт',
        stock: 50,
        purchasePrice: 150000,
        salePrice: 200000,
      },
    }),
  ]);

  console.log(`Products: ${products.length} created`);
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
