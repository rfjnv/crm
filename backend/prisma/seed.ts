import { PrismaClient, Role, DealStatus, ConversationType, MovementType, PaymentType, PaymentStatus, TaskStatus, NotificationSeverity } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ALL_PERMISSIONS = [
  'manage_users', 'view_all_deals', 'manage_deals', 'manage_leads',
  'close_deals', 'archive_deals', 'stock_confirm', 'finance_approve',
  'admin_approve', 'confirm_shipment', 'manage_inventory', 'view_all_clients',
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

  const [admin, _superadmin, manager1, manager2, accountant, warehouse, whManager, operator] = users;
  console.log(`Users: ${users.length} created/found`);

  // ========== PRODUCTS ==========
  const productsData = [
    { name: 'Визитки (1000 шт)', sku: 'VIZ-1000', unit: 'тираж', category: 'Визитки', stock: 45, minStock: 10, purchasePrice: 800, salePrice: 1500, installmentPrice: 1700 },
    { name: 'Визитки премиум (500 шт)', sku: 'VIZ-P500', unit: 'тираж', category: 'Визитки', stock: 20, minStock: 5, purchasePrice: 1200, salePrice: 2200, installmentPrice: 2500 },
    { name: 'Буклеты А4 (500 шт)', sku: 'BUK-A4-500', unit: 'тираж', category: 'Буклеты', stock: 30, minStock: 5, purchasePrice: 3500, salePrice: 6000, installmentPrice: 7000 },
    { name: 'Буклеты А5 (1000 шт)', sku: 'BUK-A5-1000', unit: 'тираж', category: 'Буклеты', stock: 25, minStock: 5, purchasePrice: 2800, salePrice: 5000, installmentPrice: 5800 },
    { name: 'Баннер виниловый 3x6м', sku: 'BAN-3X6', unit: 'шт', category: 'Баннеры', stock: 15, minStock: 3, purchasePrice: 4500, salePrice: 8500, installmentPrice: 9500 },
    { name: 'Баннер сетка 2x4м', sku: 'BAN-S2X4', unit: 'шт', category: 'Баннеры', stock: 10, minStock: 2, purchasePrice: 3000, salePrice: 5500, installmentPrice: 6200 },
    { name: 'Каталог А4 (100 стр, 200 шт)', sku: 'KAT-A4-100', unit: 'тираж', category: 'Каталоги', stock: 8, minStock: 2, purchasePrice: 25000, salePrice: 45000, installmentPrice: 50000 },
    { name: 'Флаер А6 (5000 шт)', sku: 'FLY-A6-5K', unit: 'тираж', category: 'Флаеры', stock: 60, minStock: 15, purchasePrice: 1500, salePrice: 3000, installmentPrice: 3500 },
    { name: 'Плакат А2 (50 шт)', sku: 'PLK-A2-50', unit: 'тираж', category: 'Плакаты', stock: 18, minStock: 5, purchasePrice: 4000, salePrice: 7500, installmentPrice: 8500 },
    { name: 'Наклейки круглые 50мм (1000 шт)', sku: 'NAK-R50-1K', unit: 'тираж', category: 'Наклейки', stock: 40, minStock: 10, purchasePrice: 1800, salePrice: 3500, installmentPrice: 4000 },
    { name: 'Папка А4 с логотипом (100 шт)', sku: 'PAP-A4-100', unit: 'тираж', category: 'Папки', stock: 12, minStock: 3, purchasePrice: 8000, salePrice: 15000, installmentPrice: 17000 },
    { name: 'Блокнот А5 фирменный (200 шт)', sku: 'BLK-A5-200', unit: 'тираж', category: 'Бланки', stock: 22, minStock: 5, purchasePrice: 6000, salePrice: 11000, installmentPrice: 12500 },
    { name: 'Конверт С4 с печатью (500 шт)', sku: 'KON-C4-500', unit: 'тираж', category: 'Конверты', stock: 35, minStock: 10, purchasePrice: 2500, salePrice: 4500, installmentPrice: 5200 },
    { name: 'Календарь настенный (100 шт)', sku: 'KAL-N-100', unit: 'тираж', category: 'Календари', stock: 5, minStock: 2, purchasePrice: 12000, salePrice: 22000, installmentPrice: 25000 },
    { name: 'Ролл-ап 85x200см', sku: 'ROLL-85', unit: 'шт', category: 'Стенды', stock: 7, minStock: 2, purchasePrice: 6000, salePrice: 11000, installmentPrice: 12500 },
  ];

  const products = await Promise.all(
    productsData.map((p) =>
      prisma.product.upsert({
        where: { sku: p.sku },
        update: {},
        create: p,
      }),
    ),
  );
  console.log(`Products: ${products.length} created/found`);

  // ========== CLIENTS ==========
  const clientsData = [
    { companyName: 'ООО "ТехноСервис"', contactName: 'Андрей Кузнецов', phone: '+998901234567', email: 'info@technoservice.uz', address: 'Ташкент, ул. Навои 25' },
    { companyName: 'ИП Рахимов', contactName: 'Бахтиёр Рахимов', phone: '+998901234568', email: 'rahimov@mail.uz', address: 'Ташкент, ул. Амира Темура 100' },
    { companyName: 'ООО "МедиаГрупп"', contactName: 'Олег Сидоров', phone: '+998901234569', email: 'media@mediagroup.uz', address: 'Ташкент, ул. Бунёдкор 14' },
    { companyName: 'АО "Узбек Фарм"', contactName: 'Шахло Каримова', phone: '+998901234570', email: 'karimova@uzbekfarm.uz', address: 'Ташкент, ул. Фаробий 75' },
    { companyName: 'ООО "СтройИнвест"', contactName: 'Виктор Лебедев', phone: '+998901234571', email: 'lebedev@stroyinvest.uz', address: 'Самарканд, ул. Регистан 12' },
    { companyName: 'ИП Камалова', contactName: 'Нигора Камалова', phone: '+998901234572', email: 'kamalova@gmail.com', address: 'Бухара, ул. Шахрисабз 8' },
    { companyName: 'ООО "АвтоМир"', contactName: 'Рустам Исмаилов', phone: '+998901234573', email: 'avtomir@mail.uz', address: 'Ташкент, Чиланзар-5' },
    { companyName: 'АО "Зарафшон Банк"', contactName: 'Лазиз Мирзаев', phone: '+998901234574', email: 'marketing@zarafshon.uz', address: 'Ташкент, ул. Мустакиллик 40' },
    { companyName: 'ООО "ФудМаркет"', contactName: 'Дилноза Хасанова', phone: '+998901234575', email: 'marketing@foodmarket.uz', address: 'Наманган, ул. Бобур 55' },
    { companyName: 'ИП Федоров', contactName: 'Игорь Федоров', phone: '+998901234576', email: 'fedorov.print@gmail.com', address: 'Ташкент, Юнусабад-11' },
    { companyName: 'ООО "EduCenter"', contactName: 'Замира Ашурова', phone: '+998901234577', email: 'info@educenter.uz', address: 'Фергана, ул. Мустакиллик 22' },
    { companyName: 'ООО "ГринПак"', contactName: 'Тимур Абдуллаев', phone: '+998901234578', email: 'abdullaev@greenpak.uz', address: 'Ташкент, Мирзо Улугбек 180' },
  ];

  const mgrs = [manager1, manager2];
  const clients = await Promise.all(
    clientsData.map((c, i) =>
      prisma.client.create({ data: { ...c, managerId: mgrs[i % 2].id } }),
    ),
  );
  console.log(`Clients: ${clients.length} created`);

  // ========== CONTRACTS ==========
  const contracts = await Promise.all([
    prisma.contract.create({ data: { clientId: clients[0].id, contractNumber: 'CTR-2025-001', startDate: daysAgo(180), endDate: daysAgo(-185), notes: 'Годовой контракт на полиграфию' } }),
    prisma.contract.create({ data: { clientId: clients[2].id, contractNumber: 'CTR-2025-002', startDate: daysAgo(120), endDate: daysAgo(-245), notes: 'Рекламные материалы на 2025' } }),
    prisma.contract.create({ data: { clientId: clients[3].id, contractNumber: 'CTR-2025-003', startDate: daysAgo(90), notes: 'Бессрочный контракт, этикетки и упаковка' } }),
    prisma.contract.create({ data: { clientId: clients[7].id, contractNumber: 'CTR-2025-004', startDate: daysAgo(60), endDate: daysAgo(-305), notes: 'Банковская полиграфия, бланки и буклеты' } }),
    prisma.contract.create({ data: { clientId: clients[4].id, contractNumber: 'CTR-2025-005', startDate: daysAgo(45), endDate: daysAgo(-320), notes: 'Строительные баннеры и вывески' } }),
  ]);
  console.log(`Contracts: ${contracts.length} created`);

  // ========== DEALS ==========
  interface DealSeed {
    title: string; status: DealStatus; amount: number; clientIdx: number; managerIdx: number;
    contractIdx?: number; paymentType: PaymentType; paidAmount: number; paymentStatus: PaymentStatus;
    daysBack: number; itemIdxs: number[]; itemQtys: number[];
  }

  const dealsData: DealSeed[] = [
    // CLOSED
    { title: 'Визитки для ТехноСервис', status: 'CLOSED', amount: 15000, clientIdx: 0, managerIdx: 0, contractIdx: 0, paymentType: 'FULL', paidAmount: 15000, paymentStatus: 'PAID', daysBack: 45, itemIdxs: [0, 1], itemQtys: [5, 2] },
    { title: 'Баннеры для СтройИнвест', status: 'CLOSED', amount: 42500, clientIdx: 4, managerIdx: 1, contractIdx: 4, paymentType: 'FULL', paidAmount: 42500, paymentStatus: 'PAID', daysBack: 38, itemIdxs: [4, 5], itemQtys: [3, 2] },
    { title: 'Каталог МедиаГрупп', status: 'CLOSED', amount: 50000, clientIdx: 2, managerIdx: 0, contractIdx: 1, paymentType: 'PARTIAL', paidAmount: 50000, paymentStatus: 'PAID', daysBack: 30, itemIdxs: [6], itemQtys: [1] },
    { title: 'Флаеры для ФудМаркет', status: 'CLOSED', amount: 9000, clientIdx: 8, managerIdx: 1, paymentType: 'FULL', paidAmount: 9000, paymentStatus: 'PAID', daysBack: 25, itemIdxs: [7], itemQtys: [3] },
    { title: 'Календари Зарафшон Банк', status: 'CLOSED', amount: 44000, clientIdx: 7, managerIdx: 0, contractIdx: 3, paymentType: 'FULL', paidAmount: 44000, paymentStatus: 'PAID', daysBack: 20, itemIdxs: [13], itemQtys: [2] },
    { title: 'Наклейки ГринПак', status: 'CLOSED', amount: 14000, clientIdx: 11, managerIdx: 1, paymentType: 'FULL', paidAmount: 14000, paymentStatus: 'PAID', daysBack: 15, itemIdxs: [9], itemQtys: [4] },
    { title: 'Блокноты EduCenter', status: 'CLOSED', amount: 22000, clientIdx: 10, managerIdx: 0, paymentType: 'PARTIAL', paidAmount: 22000, paymentStatus: 'PAID', daysBack: 12, itemIdxs: [11], itemQtys: [2] },

    // SHIPPED
    { title: 'Папки и конверты Узбек Фарм', status: 'SHIPPED', amount: 24500, clientIdx: 3, managerIdx: 1, contractIdx: 2, paymentType: 'FULL', paidAmount: 24500, paymentStatus: 'PAID', daysBack: 5, itemIdxs: [10, 12], itemQtys: [1, 2] },

    // READY_FOR_SHIPMENT
    { title: 'Ролл-апы для АвтоМир', status: 'READY_FOR_SHIPMENT', amount: 33000, clientIdx: 6, managerIdx: 0, paymentType: 'FULL', paidAmount: 33000, paymentStatus: 'PAID', daysBack: 4, itemIdxs: [14], itemQtys: [3] },

    // ADMIN_APPROVED
    { title: 'Плакаты ИП Рахимов', status: 'ADMIN_APPROVED', amount: 15000, clientIdx: 1, managerIdx: 1, paymentType: 'PARTIAL', paidAmount: 10000, paymentStatus: 'PARTIAL', daysBack: 3, itemIdxs: [8], itemQtys: [2] },

    // FINANCE_APPROVED
    { title: 'Буклеты МедиаГрупп тираж 2', status: 'FINANCE_APPROVED', amount: 12000, clientIdx: 2, managerIdx: 0, contractIdx: 1, paymentType: 'FULL', paidAmount: 12000, paymentStatus: 'PAID', daysBack: 3, itemIdxs: [2, 3], itemQtys: [1, 1] },

    // STOCK_CONFIRMED
    { title: 'Визитки ИП Камалова', status: 'STOCK_CONFIRMED', amount: 4400, clientIdx: 5, managerIdx: 1, paymentType: 'FULL', paidAmount: 4400, paymentStatus: 'PAID', daysBack: 2, itemIdxs: [1], itemQtys: [2] },

    // WAITING_STOCK_CONFIRMATION
    { title: 'Баннер виниловый ИП Федоров', status: 'WAITING_STOCK_CONFIRMATION', amount: 17000, clientIdx: 9, managerIdx: 0, paymentType: 'DEBT', paidAmount: 5000, paymentStatus: 'PARTIAL', daysBack: 2, itemIdxs: [4], itemQtys: [2] },

    // IN_PROGRESS
    { title: 'Комплект полиграфии ТехноСервис', status: 'IN_PROGRESS', amount: 85000, clientIdx: 0, managerIdx: 0, contractIdx: 0, paymentType: 'PARTIAL', paidAmount: 40000, paymentStatus: 'PARTIAL', daysBack: 1, itemIdxs: [0, 2, 6, 10], itemQtys: [10, 3, 1, 2] },
    { title: 'Флаеры и наклейки ФудМаркет', status: 'IN_PROGRESS', amount: 13000, clientIdx: 8, managerIdx: 1, paymentType: 'FULL', paidAmount: 0, paymentStatus: 'UNPAID', daysBack: 1, itemIdxs: [7, 9], itemQtys: [2, 2] },

    // NEW
    { title: 'Конверты Зарафшон Банк', status: 'NEW', amount: 9000, clientIdx: 7, managerIdx: 0, contractIdx: 3, paymentType: 'FULL', paidAmount: 0, paymentStatus: 'UNPAID', daysBack: 0, itemIdxs: [12], itemQtys: [2] },
    { title: 'Наклейки для АвтоМир', status: 'NEW', amount: 7000, clientIdx: 6, managerIdx: 1, paymentType: 'FULL', paidAmount: 0, paymentStatus: 'UNPAID', daysBack: 0, itemIdxs: [9], itemQtys: [2] },
    { title: 'Каталог EduCenter', status: 'NEW', amount: 45000, clientIdx: 10, managerIdx: 0, paymentType: 'PARTIAL', paidAmount: 0, paymentStatus: 'UNPAID', daysBack: 0, itemIdxs: [6], itemQtys: [1] },

    // CANCELED
    { title: 'Плакаты ГринПак (отмена)', status: 'CANCELED', amount: 7500, clientIdx: 11, managerIdx: 1, paymentType: 'FULL', paidAmount: 0, paymentStatus: 'UNPAID', daysBack: 10, itemIdxs: [8], itemQtys: [1] },
  ];

  const confirmedStatuses: DealStatus[] = ['CLOSED', 'SHIPPED', 'READY_FOR_SHIPMENT', 'ADMIN_APPROVED', 'FINANCE_APPROVED', 'STOCK_CONFIRMED'];

  const deals: { id: string; status: DealStatus; clientId: string; managerId: string; amount: number; paidAmount: number }[] = [];

  for (const d of dealsData) {
    const deal = await prisma.deal.create({
      data: {
        title: d.title,
        status: d.status,
        amount: d.amount,
        clientId: clients[d.clientIdx].id,
        managerId: mgrs[d.managerIdx].id,
        contractId: d.contractIdx !== undefined ? contracts[d.contractIdx].id : undefined,
        paymentType: d.paymentType,
        paidAmount: d.paidAmount,
        paymentStatus: d.paymentStatus,
        createdAt: daysAgo(d.daysBack),
        updatedAt: daysAgo(Math.max(0, d.daysBack - randomBetween(0, 3))),
      },
    });

    for (let i = 0; i < d.itemIdxs.length; i++) {
      const prod = products[d.itemIdxs[i]];
      await prisma.dealItem.create({
        data: {
          dealId: deal.id,
          productId: prod.id,
          requestedQty: d.itemQtys[i],
          price: Number(prod.salePrice ?? 0),
          confirmedBy: confirmedStatuses.includes(d.status) ? warehouse.id : undefined,
          confirmedAt: confirmedStatuses.includes(d.status) ? daysAgo(d.daysBack - 1) : undefined,
        },
      });
    }

    deals.push({ id: deal.id, status: d.status, clientId: clients[d.clientIdx].id, managerId: mgrs[d.managerIdx].id, amount: d.amount, paidAmount: d.paidAmount });
  }
  console.log(`Deals: ${deals.length} created with items`);

  // ========== PAYMENTS ==========
  let paymentCount = 0;
  for (let idx = 0; idx < dealsData.length; idx++) {
    const d = dealsData[idx];
    const deal = deals[idx];
    if (d.paidAmount <= 0) continue;

    if (d.paymentType === 'PARTIAL' && d.paidAmount === d.amount) {
      const first = Math.round(d.amount * 0.5);
      const second = d.amount - first;
      await prisma.payment.create({
        data: { dealId: deal.id, clientId: deal.clientId, amount: first, paidAt: daysAgo(d.daysBack), method: 'Перечисление', createdBy: accountant.id },
      });
      await prisma.payment.create({
        data: { dealId: deal.id, clientId: deal.clientId, amount: second, paidAt: daysAgo(Math.max(0, d.daysBack - 5)), method: 'Наличные', createdBy: accountant.id },
      });
      paymentCount += 2;
    } else {
      await prisma.payment.create({
        data: { dealId: deal.id, clientId: deal.clientId, amount: d.paidAmount, paidAt: daysAgo(d.daysBack), method: pick(['Наличные', 'Перечисление', 'Карта']), createdBy: accountant.id },
      });
      paymentCount++;
    }
  }
  console.log(`Payments: ${paymentCount} created`);

  // ========== SHIPMENTS ==========
  const vehicles = ['Газель', 'Ларгус', 'Спринтер', 'Портер'];
  const drivers = ['Азиз Рахманов', 'Камол Тошбаев', 'Фаррух Юсупов', 'Илхом Каримов'];
  let shipmentCount = 0;

  for (let idx = 0; idx < dealsData.length; idx++) {
    const d = dealsData[idx];
    if (d.status !== 'SHIPPED' && d.status !== 'CLOSED') continue;
    await prisma.shipment.create({
      data: {
        dealId: deals[idx].id,
        vehicleType: pick(vehicles),
        vehicleNumber: `01${String.fromCharCode(65 + randomBetween(0, 5))}${randomBetween(100, 999)}${String.fromCharCode(65 + randomBetween(0, 5))}${String.fromCharCode(65 + randomBetween(0, 5))}`,
        driverName: pick(drivers),
        departureTime: daysAgo(d.daysBack - 1),
        deliveryNoteNumber: `TH-2025-${String(shipmentCount + 1).padStart(3, '0')}`,
        shippedBy: whManager.id,
      },
    });
    shipmentCount++;
  }
  console.log(`Shipments: ${shipmentCount} created`);

  // ========== INVENTORY MOVEMENTS ==========
  let movCount = 0;
  for (const prod of products) {
    await prisma.inventoryMovement.create({
      data: { productId: prod.id, type: MovementType.IN, quantity: Number(prod.stock) + 20, note: 'Начальный приход', createdBy: warehouse.id, createdAt: daysAgo(60) },
    });
    movCount++;
  }
  for (let idx = 0; idx < dealsData.length; idx++) {
    const d = dealsData[idx];
    if (d.status !== 'CLOSED' && d.status !== 'SHIPPED') continue;
    for (let i = 0; i < d.itemIdxs.length; i++) {
      await prisma.inventoryMovement.create({
        data: { productId: products[d.itemIdxs[i]].id, type: MovementType.OUT, quantity: d.itemQtys[i], dealId: deals[idx].id, note: 'Отгрузка по сделке', createdBy: warehouse.id, createdAt: daysAgo(d.daysBack) },
      });
      movCount++;
    }
  }
  console.log(`Inventory movements: ${movCount} created`);

  // ========== DEAL COMMENTS ==========
  const commentTemplates = [
    'Клиент просит ускорить выполнение заказа',
    'Макет утверждён клиентом',
    'Требуется согласование цвета по Pantone',
    'Тираж готов к отгрузке',
    'Клиент запросил изменение в дизайне',
    'Оплата поступила на счёт',
    'Нужно уточнить формат бумаги',
    'Согласовано со складом',
    'Клиент подтвердил адрес доставки',
    'Добавлена скидка по договорённости',
  ];

  let commentCount = 0;
  for (const deal of deals) {
    const n = randomBetween(1, 3);
    for (let i = 0; i < n; i++) {
      await prisma.dealComment.create({
        data: { dealId: deal.id, authorId: pick([deal.managerId, admin.id]), text: pick(commentTemplates), createdAt: daysAgo(randomBetween(0, 15)) },
      });
      commentCount++;
    }
  }
  console.log(`Deal comments: ${commentCount} created`);

  // ========== EXPENSES ==========
  const expenseCategories = [
    { category: 'Аренда', amounts: [3500000, 3500000] },
    { category: 'Зарплата', amounts: [8000000, 8200000] },
    { category: 'Материалы', amounts: [1200000, 950000, 1400000, 800000] },
    { category: 'Коммунальные', amounts: [350000, 380000] },
    { category: 'Транспорт', amounts: [200000, 180000, 220000] },
    { category: 'Реклама', amounts: [500000, 300000] },
    { category: 'Обслуживание оборудования', amounts: [750000, 400000] },
    { category: 'Канцелярия', amounts: [50000, 45000, 60000] },
  ];

  let expenseCount = 0;
  for (const cat of expenseCategories) {
    for (let i = 0; i < cat.amounts.length; i++) {
      await prisma.expense.create({
        data: { date: daysAgo(i * 30 + randomBetween(0, 5)), category: cat.category, amount: cat.amounts[i], note: `${cat.category} за ${['текущий', 'прошлый', 'позапрошлый'][i] || ''} месяц`.trim(), createdBy: accountant.id },
      });
      expenseCount++;
    }
  }
  console.log(`Expenses: ${expenseCount} created`);

  // ========== TASKS ==========
  const tasksData = [
    { title: 'Подготовить макет визиток для ТехноСервис', description: 'Использовать новый фирменный стиль клиента, CMYK', status: TaskStatus.DONE, assignee: manager1, report: 'Макет готов, отправлен на утверждение', daysBack: 10, approved: true },
    { title: 'Инвентаризация бумаги A4', description: 'Пересчитать остатки мелованной бумаги 150г и 200г', status: TaskStatus.DONE, assignee: warehouse, report: 'Остатки сверены, расхождений нет', daysBack: 7, approved: true },
    { title: 'Выставить счёт Зарафшон Банку', description: 'Счёт на буклеты + конверты по договору CTR-2025-004', status: TaskStatus.DONE, assignee: accountant, report: 'Счёт №145 выставлен', daysBack: 5, approved: false },
    { title: 'Обновить прайс-лист', description: 'Актуализировать цены на все позиции с учётом курса', status: TaskStatus.IN_PROGRESS, assignee: manager2, daysBack: 3 },
    { title: 'Проверить качество тиража буклетов', description: 'Тираж BUK-A4-500 для МедиаГрупп — проверить цветопередачу', status: TaskStatus.IN_PROGRESS, assignee: whManager, daysBack: 2 },
    { title: 'Связаться с ИП Камалова по новому заказу', description: 'Клиент интересовался баннерами, перезвонить', status: TaskStatus.TODO, assignee: manager2, daysBack: 1 },
    { title: 'Заказать краску для плоттера', description: 'Остаток чернил менее 20%, заказать Epson UltraChrome', status: TaskStatus.TODO, assignee: warehouse, daysBack: 1 },
    { title: 'Провести сверку с ФудМаркет', description: 'Сверка взаиморасчётов за последние 3 месяца', status: TaskStatus.TODO, assignee: accountant, daysBack: 0 },
    { title: 'Настроить новый принтер', description: 'Установить и откалибровать Canon imagePRESS C910', status: TaskStatus.TODO, assignee: whManager, daysBack: 0 },
  ];

  for (const t of tasksData) {
    await prisma.task.create({
      data: {
        title: t.title,
        description: t.description,
        status: t.status,
        assigneeId: t.assignee.id,
        createdById: admin.id,
        report: t.report,
        dueDate: daysAgo(-randomBetween(1, 7)),
        approvedById: t.approved ? admin.id : undefined,
        approvedAt: t.approved ? daysAgo(t.daysBack - 1) : undefined,
        createdAt: daysAgo(t.daysBack),
      },
    });
  }
  console.log(`Tasks: ${tasksData.length} created`);

  // ========== CHAT MESSAGES ==========
  const chatMessages = [
    { type: ConversationType.SALES, sender: manager1, text: 'Коллеги, клиент ТехноСервис просит ускорить заказ на визитки. Кто-нибудь может помочь?', ago: 48 },
    { type: ConversationType.SALES, sender: manager2, text: 'Я могу подхватить макет, если нужно', ago: 47 },
    { type: ConversationType.SALES, sender: manager1, text: 'Спасибо, Мария! Скину файлы через 10 минут', ago: 46 },
    { type: ConversationType.SALES, sender: operator, text: 'Новый лид: ООО "Восток Трейд", интересуются буклетами А4. Кому передать?', ago: 24 },
    { type: ConversationType.SALES, sender: manager1, text: 'Давайте мне, созвонюсь с ними сегодня', ago: 23 },

    { type: ConversationType.WAREHOUSE, sender: warehouse, text: 'Приход бумаги 150г мелованная — 500 листов', ago: 36 },
    { type: ConversationType.WAREHOUSE, sender: whManager, text: 'Принял, разместил на стеллаже 3Б', ago: 35 },
    { type: ConversationType.WAREHOUSE, sender: warehouse, text: 'Чернила Epson заканчиваются, осталось ~15%. Нужно заказать', ago: 12 },
    { type: ConversationType.WAREHOUSE, sender: whManager, text: 'Заказал у поставщика, доставка через 3 дня', ago: 11 },

    { type: ConversationType.ACCOUNTING, sender: accountant, text: 'Оплата от Зарафшон Банк поступила: 44 000 сум', ago: 20 },
    { type: ConversationType.ACCOUNTING, sender: admin, text: 'Отлично, можно закрывать сделку по календарям', ago: 19 },
    { type: ConversationType.ACCOUNTING, sender: accountant, text: 'У ИП Рахимов долг 5 000 за плакаты. Когда ждём оплату?', ago: 5 },
    { type: ConversationType.ACCOUNTING, sender: manager2, text: 'Обещал до конца недели', ago: 4 },

    { type: ConversationType.SHIPMENT, sender: whManager, text: 'Отгрузка для Узбек Фарм готова. Газель подъедет в 14:00', ago: 6 },
    { type: ConversationType.SHIPMENT, sender: warehouse, text: 'Всё погрузили, документы подписаны', ago: 5 },
    { type: ConversationType.SHIPMENT, sender: whManager, text: 'Ролл-апы для АвтоМир — нужна доставка завтра утром', ago: 2 },
  ];

  for (const msg of chatMessages) {
    const createdAt = new Date();
    createdAt.setHours(createdAt.getHours() - msg.ago);
    await prisma.message.create({
      data: { conversationType: msg.type, senderId: msg.sender.id, text: msg.text, createdAt },
    });
  }
  console.log(`Messages: ${chatMessages.length} created`);

  // ========== NOTIFICATIONS ==========
  const notifData = [
    { userId: manager1.id, title: 'Новая сделка', body: 'Вам назначена сделка "Конверты Зарафшон Банк"', severity: NotificationSeverity.INFO, link: '/deals' },
    { userId: manager2.id, title: 'Оплата получена', body: 'Клиент ИП Рахимов оплатил 10 000 сум', severity: NotificationSeverity.INFO, link: '/finance' },
    { userId: warehouse.id, title: 'Запрос на подтверждение', body: 'Сделка "Баннер виниловый ИП Федоров" ожидает подтверждения склада', severity: NotificationSeverity.WARNING, link: '/deals' },
    { userId: accountant.id, title: 'Новая задача', body: 'Вам назначена задача: Провести сверку с ФудМаркет', severity: NotificationSeverity.INFO, link: '/tasks' },
    { userId: whManager.id, title: 'Готово к отгрузке', body: 'Сделка "Ролл-апы для АвтоМир" готова к отгрузке', severity: NotificationSeverity.WARNING, link: '/deals' },
    { userId: admin.id, title: 'Низкий остаток', body: 'Товар "Календарь настенный" — остаток ниже минимума', severity: NotificationSeverity.URGENT, link: '/warehouse' },
  ];

  for (const n of notifData) {
    await prisma.notification.create({
      data: { ...n, createdByUserId: admin.id, createdAt: daysAgo(randomBetween(0, 3)) },
    });
  }
  console.log(`Notifications: ${notifData.length} created`);

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
