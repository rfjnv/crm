import { PrismaClient, DealStatus, PaymentStatus, PaymentType, Role, ConversationType, TaskStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Helpers ──

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(rand(8, 18), rand(0, 59), rand(0, 59), 0);
  return d;
}

function hoursAfter(base: Date, minH: number, maxH: number): Date {
  const ms = base.getTime() + rand(minH, maxH) * 3600000;
  const d = new Date(ms);
  return d > new Date() ? new Date() : d;
}

function roundPrice(n: number): number {
  return Math.round(n / 1000) * 1000;
}

function clampDate(d: Date): Date {
  return d > new Date() ? new Date() : d;
}

// ── USER IDs (from existing DB) ──

const MANAGERS: { id: string; name: string }[] = [
  { id: '70acf495-f0f1-43ab-af5d-ceba8cd34245', name: 'Timur' },
  { id: '5f58c952-4273-4c7c-83c5-05c4de8e571a', name: 'Dilnoza' },
  { id: '3effe9f6-5fb2-4109-9b95-e64f8c499b4e', name: 'Oyatilloh' },
  { id: '3d7c469e-1d24-4788-b972-ceeda12409d8', name: 'Farxod' },
];

let ADMIN_ID = 'e2805b17-8ffd-48b8-afd4-2908b949a164';

// Role-specific users to create dynamically
const ROLE_USERS = [
  { login: 'warehouse1', fullName: 'Anvar Toshmatov', role: Role.WAREHOUSE, permissions: ['stock_confirm', 'manage_inventory', 'view_all_deals'] },
  { login: 'whmanager1', fullName: 'Bobur Xasanov', role: Role.WAREHOUSE_MANAGER, permissions: ['confirm_shipment', 'manage_inventory', 'view_all_deals'] },
  { login: 'accountant1', fullName: 'Gulnora Azimova', role: Role.ACCOUNTANT, permissions: ['finance_approve', 'view_all_deals'] },
];

// ══════════════════════════════════════════════
// 1. PRODUCTS (18 items — printing/packaging)
// ══════════════════════════════════════════════

interface ProductDef {
  name: string;
  sku: string;
  unit: string;
  category: string;
  countryOfOrigin: string;
  purchasePrice: number;
  salePrice: number;
  installmentPrice: number;
  stock: number;
  minStock: number;
}

const PRODUCTS: ProductDef[] = [
  { name: 'Бумага мелованная HI-KOTE 200г 72×104', sku: 'HK-200-72', unit: 'лист', category: 'Мелованная бумага', countryOfOrigin: 'Корея', purchasePrice: 1400, salePrice: 1800, installmentPrice: 2000, stock: 250, minStock: 100 },
  { name: 'Бумага мелованная HI-KOTE 150г 72×104', sku: 'HK-150-72', unit: 'лист', category: 'Мелованная бумага', countryOfOrigin: 'Корея', purchasePrice: 1050, salePrice: 1350, installmentPrice: 1500, stock: 200, minStock: 80 },
  { name: 'Бумага офсетная 80г 70×100', sku: 'OFS-80-70', unit: 'лист', category: 'Офсетная бумага', countryOfOrigin: 'Китай', purchasePrice: 550, salePrice: 750, installmentPrice: 850, stock: 300, minStock: 150 },
  { name: 'Самоклейка глянец 80г 70×100 (Турция)', sku: 'SC-GLN-80-TR', unit: 'лист', category: 'Самоклеящаяся бумага', countryOfOrigin: 'Турция', purchasePrice: 1150, salePrice: 1500, installmentPrice: 1700, stock: 180, minStock: 80 },
  { name: 'Картон целлюлозный 350г 70×100 (Индия)', sku: 'CK-350-IN', unit: 'лист', category: 'Целлюлозный картон', countryOfOrigin: 'Индия', purchasePrice: 2900, salePrice: 3800, installmentPrice: 4200, stock: 120, minStock: 50 },
  { name: 'Фольга золото 640мм×120м', sku: 'FOIL-GOLD-640', unit: 'рулон', category: 'Фольга тиснения', countryOfOrigin: 'Китай', purchasePrice: 340000, salePrice: 450000, installmentPrice: 500000, stock: 8, minStock: 3 },
  { name: 'Фольга серебро 640мм×120м', sku: 'FOIL-SILV-640', unit: 'рулон', category: 'Фольга тиснения', countryOfOrigin: 'Китай', purchasePrice: 310000, salePrice: 420000, installmentPrice: 470000, stock: 6, minStock: 3 },
  { name: 'Краска офсетная INNAVATION Black 2.5кг', sku: 'INK-INN-K-25', unit: 'банка', category: 'Офсетные краски', countryOfOrigin: 'Турция', purchasePrice: 210000, salePrice: 280000, installmentPrice: 310000, stock: 12, minStock: 5 },
  { name: 'Краска офсетная POWER Cyan 1кг', sku: 'INK-PWR-C-1', unit: 'банка', category: 'Офсетные краски', countryOfOrigin: 'Китай', purchasePrice: 105000, salePrice: 145000, installmentPrice: 160000, stock: 15, minStock: 8 },
  { name: 'Краска офсетная POWER Magenta 1кг', sku: 'INK-PWR-M-1', unit: 'банка', category: 'Офсетные краски', countryOfOrigin: 'Китай', purchasePrice: 105000, salePrice: 145000, installmentPrice: 160000, stock: 14, minStock: 8 },
  { name: 'Увлажняющий раствор концентрат 5л', sku: 'CHEM-DAMP-5L', unit: 'канистра', category: 'Химия для печати', countryOfOrigin: 'Германия', purchasePrice: 290000, salePrice: 380000, installmentPrice: 420000, stock: 6, minStock: 3 },
  { name: 'Лак УФ глянцевый 10кг', sku: 'UV-GLN-10', unit: 'канистра', category: 'UV лак', countryOfOrigin: 'Турция', purchasePrice: 850000, salePrice: 1100000, installmentPrice: 1250000, stock: 4, minStock: 2 },
  { name: 'Плёнка ламинационная матовая 32мкм', sku: 'LF-MAT-32', unit: 'рулон', category: 'Ламинационная плёнка', countryOfOrigin: 'Китай', purchasePrice: 145000, salePrice: 195000, installmentPrice: 220000, stock: 10, minStock: 4 },
  { name: 'Плёнка ламинационная глянец 32мкм', sku: 'LF-GLN-32', unit: 'рулон', category: 'Ламинационная плёнка', countryOfOrigin: 'Китай', purchasePrice: 135000, salePrice: 185000, installmentPrice: 210000, stock: 10, minStock: 4 },
  { name: 'Клей для переплёта 20кг', sku: 'GLUE-BIND-20', unit: 'мешок', category: 'Переплётные материалы', countryOfOrigin: 'Турция', purchasePrice: 240000, salePrice: 320000, installmentPrice: 360000, stock: 7, minStock: 3 },
  { name: 'Пластина офсетная BasysPrint 605×745', sku: 'PLT-BP-605', unit: 'лист', category: 'Офсетные пластины', countryOfOrigin: 'Германия', purchasePrice: 42000, salePrice: 58000, installmentPrice: 65000, stock: 60, minStock: 20 },
  { name: 'Смывка для валов 5л', sku: 'CHEM-WASH-5L', unit: 'канистра', category: 'Химия для печати', countryOfOrigin: 'Германия', purchasePrice: 310000, salePrice: 420000, installmentPrice: 470000, stock: 5, minStock: 2 },
  { name: 'Спрей противоотмарочный 1кг', sku: 'CHEM-SPRY-1K', unit: 'банка', category: 'Химия для печати', countryOfOrigin: 'Германия', purchasePrice: 88000, salePrice: 120000, installmentPrice: 135000, stock: 8, minStock: 4 },
];

// ══════════════════════════════════════════════
// 2. CLIENTS (12 companies)
// ══════════════════════════════════════════════

interface ClientDef {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
}

const CLIENTS: ClientDef[] = [
  { companyName: 'Golden Foil Studio', contactName: 'Rustam Alimov', phone: '+998901234567', email: 'info@goldenfoil.uz', address: 'Ташкент, ул. Амира Темура 77' },
  { companyName: 'Bukhara Media Print', contactName: 'Timur Abdullaev', phone: '+998912345678', email: 'bukhara.media@mail.uz', address: 'Бухара, ул. Мустакиллик 8' },
  { companyName: 'Fergana Label Factory', contactName: 'Otabek Rahimov', phone: '+998933456789', email: 'flf@fergana.uz', address: 'Фергана, пром. зона 3' },
  { companyName: 'Samarkand Press', contactName: 'Dilshod Karimov', phone: '+998944567890', email: 'press@samarkand.uz', address: 'Самарканд, ул. Навои 45' },
  { companyName: 'Andijan Print House', contactName: 'Javlon Ismoilov', phone: '+998905678901', email: 'andijan.print@mail.uz', address: 'Андижан, ул. Бобур 12' },
  { companyName: 'Tashkent Color Studio', contactName: 'Azizbek Nurmatov', phone: '+998916789012', email: 'color@tashkent.uz', address: 'Ташкент, Юнусабад' },
  { companyName: 'Navoi Packaging', contactName: 'Bekzod Shodiev', phone: '+998937890123', email: 'navoi.pack@mail.uz', address: 'Навои, ул. Галаба 15' },
  { companyName: 'Khorezm Offset Group', contactName: 'Shakhzod Tursunov', phone: '+998948901234', email: 'khorezm.offset@mail.uz', address: 'Ургенч, ул. Аль-Хорезмий 22' },
  { companyName: 'Namangan Print Service', contactName: 'Ulugbek Ergashev', phone: '+998909012345', email: 'nps@namangan.uz', address: 'Наманган, пром. зона' },
  { companyName: 'Qarshi Media Design', contactName: 'Sardor Yuldashev', phone: '+998910123456', email: 'media@qarshi.uz', address: 'Карши, ул. Насаф 22' },
  { companyName: 'Silk Road Print House', contactName: 'Kamol Usmanov', phone: '+998931234567', email: 'silkroad@print.uz', address: 'Ташкент, Мирзо Улугбек' },
  { companyName: 'OrientPack', contactName: 'Farrux Qodirov', phone: '+998942345678', email: 'info@orientpack.uz', address: 'Ташкент, Сергели' },
];

// ══════════════════════════════════════════════
// DEAL TITLES
// ══════════════════════════════════════════════

const DEAL_TITLES = [
  'Печать визиток', 'Буклеты A4', 'Каталог продукции', 'Этикетки на продукцию',
  'Упаковка для кондитерских', 'Флаеры A5', 'Наклейки на продукцию', 'Папки с логотипом',
  'Постеры A2', 'Брошюра 24 стр', 'Коробки для чая', 'Пакеты бумажные',
  'Меню ресторана', 'Блокноты фирменные', 'Конверты с печатью', 'Ценники ламинация',
  'Бирки на одежду', 'Листовки рекламные', 'Стикеры рулонные', 'Календари настенные',
  'Пригласительные', 'Тейбл-тенты', 'Хэнгеры рекламные', 'Коробки косметика',
];

const COMMENT_TEXTS = [
  'Клиент подтвердил макет, можно в печать',
  'Тираж готов, ожидаем отгрузку',
  'Заказчик просит ускорить',
  'Нужна дополнительная проверка цветов',
  'Бумага в наличии, начинаем',
  'Оплата получена частично, ждём остаток',
  'Согласован финальный вариант',
  'Просят добавить ламинацию',
  'Договор подписан, в работу',
  'Клиент доволен качеством предыдущего заказа',
  'Макет на согласовании у заказчика',
  'Отгрузка запланирована на завтра',
  'Пробный тираж утверждён',
  'Ожидаем подтверждение от бухгалтерии',
  'Материалы подготовлены к производству',
  'Накладная оформлена',
];

const VEHICLE_TYPES = ['Газель', 'Фура', 'Спринтер', 'Исузу', 'Портер'];
const VEHICLE_NUMBERS = ['01 A 123 AA', '01 B 456 BB', '01 C 789 CC', '40 D 012 DD', '70 E 345 EE', '30 F 678 FF'];
const DRIVER_NAMES = ['Акбар Хамидов', 'Иброхим Тошев', 'Санжар Мирзаев', 'Олим Юсупов', 'Нодир Каримов', 'Жасур Эргашев'];
const PAYMENT_METHODS = ['Наличные', 'Перевод', 'Карта', 'Терминал'];

const REQUEST_COMMENTS = [
  'Нужно 500 листов', 'Уточнить наличие', 'Для срочного заказа',
  'Требуется 10 рулонов', 'Проверить остаток на складе',
  'Заказчик просит максимальное количество', 'Необходимо 200 единиц',
  'Под тираж 5000 экз.', 'На следующую неделю', 'Для печати каталога',
];

const WAREHOUSE_COMMENTS = [
  'Всё в наличии', 'Остаток достаточный', 'Проверено, есть на складе',
  'Имеется 300 листов', 'В наличии 8 рулонов', 'Достаточный запас',
  'На складе 150 единиц', 'Доступно для отгрузки',
];

// ══════════════════════════════════════════════
// STATUS DISTRIBUTION for 3-month simulation
// ══════════════════════════════════════════════

const STATUS_WEIGHTS: { status: DealStatus; weight: number }[] = [
  { status: 'CLOSED', weight: 35 },
  { status: 'SHIPPED', weight: 8 },
  { status: 'READY_FOR_SHIPMENT', weight: 5 },
  { status: 'ADMIN_APPROVED', weight: 5 },
  { status: 'FINANCE_APPROVED', weight: 5 },
  { status: 'STOCK_CONFIRMED', weight: 5 },
  { status: 'WAITING_STOCK_CONFIRMATION', weight: 5 },
  { status: 'IN_PROGRESS', weight: 10 },
  { status: 'NEW', weight: 8 },
  { status: 'CANCELED', weight: 7 },
  { status: 'REJECTED', weight: 5 },
  { status: 'SHIPMENT_ON_HOLD', weight: 2 },
];

function pickStatus(): DealStatus {
  const total = STATUS_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of STATUS_WEIGHTS) {
    r -= w.weight;
    if (r <= 0) return w.status;
  }
  return 'NEW';
}

// Full status chain leading to target status
function getStatusChain(target: DealStatus): DealStatus[] {
  const fullChain: DealStatus[] = [
    'NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED',
    'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPPED', 'CLOSED',
  ];

  if (target === 'CANCELED') {
    // Cancel at a random point
    const cancelPoint = rand(0, 5);
    return [...fullChain.slice(0, cancelPoint + 1), 'CANCELED'];
  }

  if (target === 'REJECTED') {
    // Reject at STOCK_CONFIRMED (finance rejects)
    return ['NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED', 'REJECTED'];
  }

  if (target === 'SHIPMENT_ON_HOLD') {
    return ['NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION', 'STOCK_CONFIRMED',
      'FINANCE_APPROVED', 'ADMIN_APPROVED', 'READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD'];
  }

  const idx = fullChain.indexOf(target);
  if (idx >= 0) return fullChain.slice(0, idx + 1);
  return ['NEW'];
}

// Which statuses have stock confirmation data
function hasStockConfirmation(status: DealStatus): boolean {
  return ['STOCK_CONFIRMED', 'FINANCE_APPROVED', 'ADMIN_APPROVED',
    'READY_FOR_SHIPMENT', 'SHIPMENT_ON_HOLD', 'SHIPPED', 'CLOSED'].includes(status);
}

function hasShipment(status: DealStatus): boolean {
  return ['SHIPPED', 'CLOSED'].includes(status);
}

// ══════════════════════════════════════════════
// MAIN SEED FUNCTION
// ══════════════════════════════════════════════

async function main() {
  console.log('🌱 Seeding realistic demo data (3 months of work)...\n');

  // ── 0. Cleanup old demo data ──
  console.log('🧹 Cleaning old demo data...');
  await prisma.message.deleteMany({});
  await prisma.conversationRead.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.notificationBatch.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.dealComment.deleteMany({});
  await prisma.shipment.deleteMany({});
  await prisma.inventoryMovement.deleteMany({});
  await prisma.dealItem.deleteMany({});
  await prisma.deal.deleteMany({});
  await prisma.dailyClosing.deleteMany({});
  await prisma.contract.deleteMany({});
  await prisma.client.deleteMany({});
  await prisma.product.deleteMany({});
  console.log('  ✓ Cleaned');

  // ── 0.5 Create all required users if they don't exist ──
  console.log('👤 Creating users...');
  const hashedPw = await bcrypt.hash('demo123', 12);

  // Ensure ADMIN exists
  const existingAdmin = await prisma.user.findUnique({ where: { login: 'admin' } });
  if (!existingAdmin) {
    const adminUser = await prisma.user.create({
      data: {
        id: ADMIN_ID,
        login: 'admin',
        password: hashedPw,
        fullName: 'Администратор',
        role: Role.ADMIN,
        isActive: true,
        permissions: ['manage_users', 'view_all_deals', 'manage_deals', 'manage_leads', 'close_deals', 'archive_deals', 'stock_confirm', 'finance_approve', 'admin_approve', 'confirm_shipment', 'manage_inventory', 'view_all_clients'],
      },
    });
    ADMIN_ID = adminUser.id;
    console.log(`  ✓ Created ADMIN: admin / demo123`);
  } else {
    ADMIN_ID = existingAdmin.id;
    console.log(`  ✓ ADMIN already exists: admin`);
  }

  // Ensure managers exist
  for (const m of MANAGERS) {
    const existing = await prisma.user.findUnique({ where: { id: m.id } });
    if (!existing) {
      const login = m.name.toLowerCase();
      // Check if login already taken
      const byLogin = await prisma.user.findUnique({ where: { login } });
      if (!byLogin) {
        await prisma.user.create({
          data: {
            id: m.id,
            login,
            password: hashedPw,
            fullName: m.name,
            role: Role.MANAGER,
            isActive: true,
            permissions: ['manage_deals', 'manage_inventory', 'view_all_clients'],
          },
        });
        console.log(`  ✓ Created MANAGER: ${login} / demo123`);
      } else {
        // Update the MANAGERS array entry to use the existing user's ID
        m.id = byLogin.id;
        console.log(`  ✓ MANAGER login ${login} already exists with id ${byLogin.id}`);
      }
    } else {
      console.log(`  ✓ MANAGER ${m.name} already exists`);
    }
  }

  // Create role-specific users
  const roleUserIds: Record<string, string> = {};
  for (const ru of ROLE_USERS) {
    let user = await prisma.user.findUnique({ where: { login: ru.login } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          login: ru.login,
          password: hashedPw,
          fullName: ru.fullName,
          role: ru.role,
          isActive: true,
          permissions: ru.permissions,
        },
      });
      console.log(`  ✓ Created ${ru.role}: ${ru.login} / demo123`);
    } else {
      console.log(`  ✓ ${ru.role} already exists: ${ru.login}`);
    }
    roleUserIds[ru.role] = user.id;
  }

  const WAREHOUSE_USER_ID = roleUserIds[Role.WAREHOUSE];
  const WH_MANAGER_ID = roleUserIds[Role.WAREHOUSE_MANAGER];
  const ACCOUNTANT_ID = roleUserIds[Role.ACCOUNTANT];

  // ── 1. Create Products ──
  console.log('📦 Creating products...');
  const products: { id: string; def: ProductDef }[] = [];
  for (const p of PRODUCTS) {
    const manDate = daysAgo(rand(120, 365));
    const product = await prisma.product.create({
      data: {
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        category: p.category,
        countryOfOrigin: p.countryOfOrigin,
        stock: p.stock,
        minStock: p.minStock,
        purchasePrice: p.purchasePrice,
        salePrice: p.salePrice,
        installmentPrice: p.installmentPrice,
        manufacturedAt: manDate,
        expiresAt: p.category.includes('Химия') || p.category.includes('краск')
          ? new Date(manDate.getTime() + 365 * 86400000)
          : null,
      },
    });
    products.push({ id: product.id, def: p });
  }
  console.log(`  ✓ ${products.length} products`);

  // Track running stock
  const stockTracker = new Map<string, number>();
  for (const p of products) {
    stockTracker.set(p.id, p.def.stock);
  }

  // ── 2. Initial IN movements ──
  console.log('📥 Initial stock receipts...');
  for (const p of products) {
    await prisma.inventoryMovement.create({
      data: {
        productId: p.id,
        type: 'IN',
        quantity: p.def.stock,
        note: 'Начальный остаток',
        createdBy: ADMIN_ID,
        createdAt: daysAgo(95),
      },
    });
  }

  // ── 3. Create Clients ──
  console.log('👥 Creating clients...');
  const clients: { id: string; managerId: string; companyName: string; createdAt: Date }[] = [];
  for (let i = 0; i < CLIENTS.length; i++) {
    const c = CLIENTS[i];
    const managerId = MANAGERS[i % MANAGERS.length].id;
    const createdAt = daysAgo(rand(80, 95));
    const client = await prisma.client.create({
      data: {
        companyName: c.companyName,
        contactName: c.contactName,
        phone: c.phone,
        email: c.email,
        address: c.address,
        managerId,
        createdAt,
      },
    });
    clients.push({ id: client.id, managerId, companyName: c.companyName, createdAt });
  }
  console.log(`  ✓ ${clients.length} clients`);

  // ── 4. Contracts (65% of clients) ──
  console.log('📄 Creating contracts...');
  const clientsWithContracts = clients.filter(() => Math.random() < 0.65);
  const contractMap = new Map<string, string>();
  let contractNum = 1;
  for (const c of clientsWithContracts) {
    const contract = await prisma.contract.create({
      data: {
        clientId: c.id,
        contractNumber: `PB-2025-${String(contractNum++).padStart(3, '0')}`,
        startDate: daysAgo(rand(70, 90)),
        isActive: true,
        notes: 'Стандартный договор поставки',
      },
    });
    contractMap.set(c.id, contract.id);
  }
  console.log(`  ✓ ${contractMap.size} contracts`);

  // ── 5. Deals with full workflow ──
  console.log('💼 Creating deals...');

  const DEAL_COUNT = rand(160, 200);
  interface DealRecord {
    id: string; title: string; status: DealStatus; amount: number;
    managerId: string; clientId: string; createdAt: Date; updatedAt: Date;
    paymentStatus: PaymentStatus; paidAmount: number; paymentType: PaymentType;
    dueDate: Date | null; discount: number; dayOffset: number;
    items: { id: string; productId: string; requestedQty: number; price: number }[];
    statusChain: DealStatus[];
  }

  const deals: DealRecord[] = [];
  let managerIdx = 0;

  for (let i = 0; i < DEAL_COUNT; i++) {
    const status = pickStatus();
    const client = pick(clients);
    const manager = MANAGERS[managerIdx % MANAGERS.length];
    managerIdx++;
    const titleBase = pick(DEAL_TITLES);
    // Spread deals across 90 days, older deals more likely to be CLOSED
    let dayOffset: number;
    if (['CLOSED', 'SHIPPED'].includes(status)) {
      dayOffset = rand(5, 85); // Mostly older
    } else if (['NEW', 'IN_PROGRESS'].includes(status)) {
      dayOffset = rand(0, 15); // Recent
    } else if (status === 'CANCELED') {
      dayOffset = rand(3, 75);
    } else {
      dayOffset = rand(0, 40); // Mid-range
    }
    const createdAt = daysAgo(dayOffset);

    // Generate items
    const numItems = rand(2, 5);
    const chosenProducts = pickN(products, numItems);

    interface ItemData { productId: string; requestedQty: number; price: number }
    const items: ItemData[] = [];

    for (const prod of chosenProducts) {
      const price = prod.def.salePrice;
      let qty: number;
      if (price < 5000) {
        qty = rand(50, 500);
      } else if (price < 200000) {
        qty = rand(2, 15);
      } else {
        qty = rand(1, 4);
      }
      items.push({ productId: prod.id, requestedQty: qty, price });
    }

    const itemsTotal = items.reduce((s, it) => s + it.requestedQty * it.price, 0);
    const dealHasQuantities = !['NEW', 'IN_PROGRESS', 'WAITING_STOCK_CONFIRMATION'].includes(status);
    let discount = 0;
    if (dealHasQuantities && Math.random() < 0.3) {
      discount = roundPrice(itemsTotal * (Math.random() * 0.05));
    }
    const amount = dealHasQuantities ? itemsTotal - discount : 0;

    // Payment logic
    let paymentStatus: PaymentStatus = 'UNPAID';
    let paidAmount = 0;
    let paymentType: PaymentType = 'FULL';
    let dueDate: Date | null = null;

    if (!dealHasQuantities || status === 'CANCELED' || status === 'NEW') {
      paymentStatus = 'UNPAID';
      paidAmount = 0;
    } else if (status === 'CLOSED') {
      // Most closed deals are fully paid
      if (Math.random() < 0.85) {
        paymentType = 'FULL';
        paymentStatus = 'PAID';
        paidAmount = amount;
      } else {
        paymentType = 'PARTIAL';
        paymentStatus = 'PARTIAL';
        paidAmount = roundPrice(amount * (0.7 + Math.random() * 0.25));
        dueDate = new Date(createdAt.getTime() + rand(14, 30) * 86400000);
      }
    } else {
      const payRoll = Math.random();
      if (payRoll < 0.45) {
        paymentType = 'FULL';
        paymentStatus = 'PAID';
        paidAmount = amount;
      } else if (payRoll < 0.75) {
        paymentType = 'PARTIAL';
        const paidPercent = 0.50 + Math.random() * 0.40;
        paidAmount = roundPrice(amount * paidPercent);
        paymentStatus = paidAmount >= amount ? 'PAID' : 'PARTIAL';
        dueDate = new Date(createdAt.getTime() + rand(7, 25) * 86400000);
      } else {
        paymentType = 'DEBT';
        const paidPercent = 0.20 + Math.random() * 0.50;
        paidAmount = roundPrice(amount * paidPercent);
        paymentStatus = paidAmount >= amount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
        dueDate = new Date(createdAt.getTime() + rand(10, 30) * 86400000);
      }
    }

    // updatedAt based on how far along the deal is
    const statusChain = getStatusChain(status);
    const stepHours = statusChain.length * rand(4, 24);
    let updatedAt = new Date(createdAt.getTime() + stepHours * 3600000);
    if (updatedAt > new Date()) updatedAt = new Date();

    const contractId = contractMap.get(client.id) || null;

    const deal = await prisma.deal.create({
      data: {
        title: `${titleBase} — ${client.companyName.split(' ')[0]}`,
        status,
        amount,
        discount,
        clientId: client.id,
        managerId: manager.id,
        contractId,
        paymentType,
        paidAmount,
        dueDate,
        paymentStatus,
        createdAt,
        updatedAt,
      },
    });

    // Create deal items
    const createdItems: { id: string; productId: string; requestedQty: number; price: number }[] = [];
    for (const it of items) {
      const dealItem = await prisma.dealItem.create({
        data: {
          dealId: deal.id,
          productId: it.productId,
          requestComment: pick(REQUEST_COMMENTS),
          ...(dealHasQuantities ? { requestedQty: it.requestedQty, price: it.price } : {}),
          createdAt,
        },
      });
      createdItems.push({ id: dealItem.id, productId: it.productId, requestedQty: it.requestedQty, price: it.price });
    }

    // ── Stock Confirmation (warehouse response — comment only) ──
    if (hasStockConfirmation(status)) {
      const tcDate = hoursAfter(createdAt, 12, 72);
      for (const item of createdItems) {
        await prisma.dealItem.update({
          where: { id: item.id },
          data: {
            warehouseComment: pick(WAREHOUSE_COMMENTS),
            confirmedBy: WAREHOUSE_USER_ID,
            confirmedAt: tcDate,
          },
        });
      }
    }

    // ── Shipment ──
    if (hasShipment(status)) {
      const shipDate = hoursAfter(createdAt, 48, 168);
      await prisma.shipment.create({
        data: {
          dealId: deal.id,
          vehicleType: pick(VEHICLE_TYPES),
          vehicleNumber: pick(VEHICLE_NUMBERS),
          driverName: pick(DRIVER_NAMES),
          departureTime: shipDate,
          deliveryNoteNumber: `TTN-${rand(10000, 99999)}`,
          shipmentComment: Math.random() < 0.3 ? 'Доставка до склада клиента' : null,
          shippedBy: WH_MANAGER_ID,
          shippedAt: shipDate,
        },
      });

      // OUT movements for shipped/closed deals
      for (const it of createdItems) {
        const currentStock = stockTracker.get(it.productId) || 0;
        const outQty = Math.min(it.requestedQty, currentStock);
        if (outQty > 0) {
          await prisma.inventoryMovement.create({
            data: {
              productId: it.productId,
              type: 'OUT',
              quantity: outQty,
              dealId: deal.id,
              note: 'Автосписание при отгрузке',
              createdBy: WH_MANAGER_ID,
              createdAt: clampDate(shipDate),
            },
          });
          stockTracker.set(it.productId, currentStock - outQty);
        }
      }
    }

    deals.push({
      id: deal.id,
      title: deal.title,
      status,
      amount,
      managerId: manager.id,
      clientId: client.id,
      createdAt,
      updatedAt,
      paymentStatus,
      paidAmount,
      paymentType,
      dueDate,
      discount,
      dayOffset,
      items: createdItems,
      statusChain,
    });
  }
  console.log(`  ✓ ${deals.length} deals with items, stock confirmations, shipments`);

  // ── 6. Payments (individual payment records) ──
  console.log('💰 Creating payment records...');
  let paymentCount = 0;
  for (const d of deals) {
    if (d.paidAmount <= 0) continue;

    // Split paidAmount into 1-3 payment records
    const numPayments = d.paymentType === 'FULL' ? 1 : rand(1, 3);
    let remaining = d.paidAmount;

    for (let pi = 0; pi < numPayments; pi++) {
      const isLast = pi === numPayments - 1;
      const payAmount = isLast ? remaining : roundPrice(remaining * (0.3 + Math.random() * 0.4));
      if (payAmount <= 0) continue;
      remaining -= payAmount;

      const paidAt = hoursAfter(d.createdAt, pi * 24 + 4, pi * 48 + 72);
      await prisma.payment.create({
        data: {
          dealId: d.id,
          clientId: d.clientId,
          amount: payAmount,
          paidAt,
          method: pick(PAYMENT_METHODS),
          note: pi === 0 ? 'Первый платёж' : isLast ? 'Окончательный расчёт' : `Частичная оплата #${pi + 1}`,
          createdBy: Math.random() < 0.7 ? d.managerId : ACCOUNTANT_ID,
          createdAt: paidAt,
        },
      });
      paymentCount++;
    }
  }
  console.log(`  ✓ ${paymentCount} payment records`);

  // ── 7. Restocking every ~15 days ──
  console.log('📥 Restocking...');
  const restockDays = [85, 70, 55, 40, 25, 10];
  let restockCount = 0;
  for (const day of restockDays) {
    for (const prod of products) {
      if (Math.random() > 0.35) continue;
      const price = prod.def.salePrice;
      let qty: number;
      if (price < 5000) {
        qty = rand(100, 300);
      } else if (price < 200000) {
        qty = rand(5, 20);
      } else {
        qty = rand(2, 6);
      }
      await prisma.inventoryMovement.create({
        data: {
          productId: prod.id,
          type: 'IN',
          quantity: qty,
          note: 'Поступление от поставщика',
          createdBy: ADMIN_ID,
          createdAt: daysAgo(day),
        },
      });
      stockTracker.set(prod.id, (stockTracker.get(prod.id) || 0) + qty);
      restockCount++;
    }
  }
  console.log(`  ✓ ${restockCount} restock movements`);

  // ── 8. Adjust final stock ──
  console.log('📊 Adjusting final stock...');
  const allProds = [...products].sort(() => Math.random() - 0.5);
  const zeroProds = allProds.slice(0, 2);
  const lowProds = allProds.slice(2, 5);

  for (const p of zeroProds) stockTracker.set(p.id, 0);
  for (const p of lowProds) {
    stockTracker.set(p.id, rand(1, Math.max(1, p.def.minStock - 1)));
  }

  for (const p of products) {
    const finalStock = Math.max(0, stockTracker.get(p.id) || 0);
    await prisma.product.update({
      where: { id: p.id },
      data: { stock: finalStock },
    });
  }
  console.log(`  ✓ Stock adjusted (${zeroProds.length} zero, ${lowProds.length} low)`);

  // ── 9. Comments ──
  console.log('💬 Creating comments...');
  let commentCount = 0;
  for (const d of deals) {
    if (['CANCELED', 'NEW'].includes(d.status) && Math.random() > 0.2) continue;
    if (Math.random() > 0.65) continue;
    const numComments = rand(1, 4);
    for (let c = 0; c < numComments; c++) {
      const commentDate = hoursAfter(d.createdAt, c * 6 + 2, c * 24 + 48);
      await prisma.dealComment.create({
        data: {
          dealId: d.id,
          authorId: Math.random() < 0.7 ? d.managerId : pick([ADMIN_ID, WAREHOUSE_USER_ID, ACCOUNTANT_ID]),
          text: pick(COMMENT_TEXTS),
          createdAt: commentDate,
        },
      });
      commentCount++;
    }

    // Rejection comment
    if (d.status === 'REJECTED') {
      await prisma.dealComment.create({
        data: {
          dealId: d.id,
          authorId: ACCOUNTANT_ID,
          text: pick(['Несоответствие суммы в договоре', 'Превышен лимит долга клиента', 'Необходимо уточнить условия оплаты']),
          createdAt: d.updatedAt,
        },
      });
      commentCount++;
    }

    // Hold comment
    if (d.status === 'SHIPMENT_ON_HOLD') {
      await prisma.dealComment.create({
        data: {
          dealId: d.id,
          authorId: WH_MANAGER_ID,
          text: pick(['Отгрузка приостановлена: ожидание транспорта', 'Отгрузка приостановлена: уточнение адреса доставки']),
          createdAt: d.updatedAt,
        },
      });
      commentCount++;
    }
  }
  console.log(`  ✓ ${commentCount} comments`);

  // ── 10. Daily Closings (for CLOSED deals) ──
  console.log('📅 Creating daily closings...');
  const closedDeals = deals.filter(d => d.status === 'CLOSED');
  const closingsByDay = new Map<string, typeof closedDeals>();
  for (const d of closedDeals) {
    const dayKey = d.updatedAt.toISOString().slice(0, 10);
    if (!closingsByDay.has(dayKey)) closingsByDay.set(dayKey, []);
    closingsByDay.get(dayKey)!.push(d);
  }

  let closingCount = 0;
  for (const [dateStr, dayDeals] of closingsByDay) {
    const totalAmount = dayDeals.reduce((s, d) => s + d.amount, 0);
    const dateOnly = new Date(dateStr + 'T00:00:00.000Z');
    const closing = await prisma.dailyClosing.create({
      data: {
        date: dateOnly,
        totalAmount,
        closedDealsCount: dayDeals.length,
        closedById: ADMIN_ID,
        createdAt: new Date(dateOnly.getTime() + 17 * 3600000),
      },
    });
    await prisma.deal.updateMany({
      where: { id: { in: dayDeals.map(d => d.id) } },
      data: { dailyClosingId: closing.id },
    });
    closingCount++;
  }
  console.log(`  ✓ ${closingCount} daily closings`);

  // ── 11. Audit Logs ──
  console.log('📝 Creating audit logs...');
  let auditCount = 0;

  // Client creation audits
  for (const c of clients) {
    await prisma.auditLog.create({
      data: {
        userId: c.managerId,
        action: 'CREATE',
        entityType: 'client',
        entityId: c.id,
        after: { companyName: c.companyName },
        createdAt: c.createdAt,
      },
    });
    auditCount++;
  }

  // Deal creation + full status chain audit
  for (const d of deals) {
    await prisma.auditLog.create({
      data: {
        userId: d.managerId,
        action: 'CREATE',
        entityType: 'deal',
        entityId: d.id,
        after: { title: d.title, status: 'NEW', amount: d.amount },
        createdAt: d.createdAt,
      },
    });
    auditCount++;

    // Status changes along the chain (skip first NEW since that's creation)
    const chain = d.statusChain;
    for (let si = 1; si < chain.length; si++) {
      const prevStatus = chain[si - 1];
      const nextStatus = chain[si];
      const ts = new Date(d.createdAt.getTime() + si * rand(3600000, 18 * 3600000));

      // Pick appropriate user for each transition
      let userId = d.managerId;
      if (nextStatus === 'STOCK_CONFIRMED') userId = WAREHOUSE_USER_ID;
      else if (nextStatus === 'FINANCE_APPROVED' || nextStatus === 'REJECTED') userId = ACCOUNTANT_ID;
      else if (nextStatus === 'ADMIN_APPROVED') userId = ADMIN_ID;
      else if (nextStatus === 'SHIPPED') userId = WH_MANAGER_ID;
      else if (nextStatus === 'CLOSED') userId = ADMIN_ID;
      else if (nextStatus === 'SHIPMENT_ON_HOLD') userId = WH_MANAGER_ID;

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'STATUS_CHANGE',
          entityType: 'deal',
          entityId: d.id,
          before: { status: prevStatus },
          after: { status: nextStatus },
          createdAt: clampDate(ts),
        },
      });
      auditCount++;
    }
  }

  // Stock write-off audits for shipped deals
  const shippedDeals = deals.filter(d => hasShipment(d.status));
  for (const d of shippedDeals) {
    await prisma.auditLog.create({
      data: {
        userId: WH_MANAGER_ID,
        action: 'STOCK_WRITE_OFF',
        entityType: 'deal',
        entityId: d.id,
        after: { items: d.items.map(it => ({ productId: it.productId, qty: it.requestedQty })) },
        createdAt: clampDate(hoursAfter(d.createdAt, 48, 168)),
      },
    });
    auditCount++;
  }

  // Payment create audits
  for (const d of deals) {
    if (d.paidAmount > 0) {
      await prisma.auditLog.create({
        data: {
          userId: d.managerId,
          action: 'PAYMENT_CREATE',
          entityType: 'deal',
          entityId: d.id,
          after: { amount: d.paidAmount },
          createdAt: clampDate(hoursAfter(d.createdAt, 4, 72)),
        },
      });
      auditCount++;
    }
  }
  console.log(`  ✓ ${auditCount} audit logs`);

  // ── 12. Notifications ──
  console.log('🔔 Creating notifications...');
  const allUserIds = [
    ...MANAGERS.map(m => m.id),
    ADMIN_ID,
    WAREHOUSE_USER_ID,
    WH_MANAGER_ID,
    ACCOUNTANT_ID,
  ];

  // Create a few broadcast batches
  const broadcastMessages = [
    { title: 'Обновление системы', body: 'CRM обновлена до версии 2.0. Добавлены новые функции рабочего процесса.', severity: 'INFO' as const, daysAgo: 60 },
    { title: 'Инвентаризация', body: 'Плановая инвентаризация запланирована на конец недели. Просьба проверить остатки.', severity: 'WARNING' as const, daysAgo: 35 },
    { title: 'Новые правила отгрузки', body: 'С сегодняшнего дня все отгрузки должны быть подтверждены заведующим складом.', severity: 'URGENT' as const, daysAgo: 15 },
    { title: 'Ежемесячный отчёт', body: 'Необходимо сдать ежемесячный отчёт по продажам до конца недели.', severity: 'INFO' as const, daysAgo: 7 },
  ];

  let notifCount = 0;
  for (const msg of broadcastMessages) {
    const batch = await prisma.notificationBatch.create({
      data: {
        createdByUserId: ADMIN_ID,
        targetType: 'ALL',
        targetPayload: {},
        title: msg.title,
        recipientCount: allUserIds.length,
        createdAt: daysAgo(msg.daysAgo),
      },
    });

    for (const uid of allUserIds) {
      const isRead = Math.random() < 0.7;
      const cAt = daysAgo(msg.daysAgo);
      await prisma.notification.create({
        data: {
          userId: uid,
          title: msg.title,
          body: msg.body,
          severity: msg.severity,
          isRead,
          readAt: isRead ? hoursAfter(cAt, 1, 48) : null,
          createdByUserId: ADMIN_ID,
          batchId: batch.id,
          createdAt: cAt,
        },
      });
      notifCount++;
    }

    await prisma.auditLog.create({
      data: {
        userId: ADMIN_ID,
        action: 'NOTIFICATION_BROADCAST',
        entityType: 'notification_batch',
        entityId: batch.id,
        after: { targetType: 'ALL', recipientCount: allUserIds.length, title: msg.title },
        createdAt: daysAgo(msg.daysAgo),
      },
    });
    auditCount++;
  }
  console.log(`  ✓ ${notifCount} notifications (${broadcastMessages.length} broadcasts)`);

  // ── 13. Chat Messages ──
  console.log('💬 Creating chat messages...');
  const CHAT_MESSAGES: Record<ConversationType, string[]> = {
    SALES: [
      'Клиент Golden Foil подтвердил заказ',
      'Нужно подготовить коммерческое предложение для Bukhara Media',
      'Сегодня встреча с Samarkand Press в 14:00',
      'Обновил прайс-лист, проверьте пожалуйста',
      'Новый клиент из Андижана, хочет большой тираж',
      'Кто ведёт сделку по этикеткам для OrientPack?',
      'Клиент просит скидку 5% на повторный заказ',
      'Готов макет для визиток Silk Road',
      'Нужно согласовать цвета с заказчиком',
      'Fergana Label подтвердили оплату',
    ],
    WAREHOUSE: [
      'Поступление бумаги HI-KOTE 200г — 250 листов',
      'Остаток фольги золото — 5 рулонов',
      'Нужно заказать краску INNAVATION Black',
      'Инвентаризация запланирована на пятницу',
      'Лак УФ заканчивается, осталось 2 канистры',
      'Получили новую партию офсетных пластин',
      'Плёнка ламинационная в наличии, 10 рулонов',
      'Самоклейка глянец — проверил, 180 листов',
      'Увлажняющий раствор — заказал у поставщика',
      'Разгрузили машину, всё оприходовано',
    ],
    ACCOUNTING: [
      'Оплата от Namangan Print Service поступила',
      'Счёт-фактура для Khorezm Offset выставлена',
      'Клиент Qarshi Media просит рассрочку на 30 дней',
      'Сверка по долгам за январь готова',
      'Начислен НДС за прошлый месяц',
      'Нужно подготовить акт сверки для Golden Foil',
      'Оплата по сделке #4521 — частичная, 60%',
      'Курс доллара обновлён в системе',
      'Задолженность Fergana Label — 15 млн',
      'Закрытие месяца — всё готово',
    ],
    SHIPMENT: [
      'Газель загружена, выезжаем в Бухару',
      'Накладная TTN-45678 оформлена',
      'Водитель Акбар доставил заказ в Самарканд',
      'Отгрузка приостановлена — ждём транспорт',
      'Машина задерживается на 2 часа',
      'Доставка в Фергану — завтра утром',
      'Клиент подтвердил получение товара',
      'Нужна фура на следующую неделю',
      'Накладная подписана, скан приложен',
      'Отгрузка для Andijan Print House завершена',
    ],
  };

  const conversationTypes: ConversationType[] = ['SALES', 'WAREHOUSE', 'ACCOUNTING', 'SHIPMENT'];
  let msgCount = 0;

  // All chat-capable users
  const chatUsers = [
    ...MANAGERS.map(m => ({ id: m.id, role: Role.MANAGER })),
    { id: ADMIN_ID, role: Role.ADMIN },
    { id: WAREHOUSE_USER_ID, role: Role.WAREHOUSE },
    { id: WH_MANAGER_ID, role: Role.WAREHOUSE_MANAGER },
    { id: ACCOUNTANT_ID, role: Role.ACCOUNTANT },
  ];

  // Create messages spread across 3 months
  for (const convType of conversationTypes) {
    const msgs = CHAT_MESSAGES[convType];
    const messageCount = rand(20, 35);

    for (let mi = 0; mi < messageCount; mi++) {
      const dayBack = rand(0, 85);
      const createdAt = daysAgo(dayBack);
      const sender = pick(chatUsers);
      const dealLink = Math.random() < 0.15 && deals.length > 0 ? pick(deals) : null;

      await prisma.message.create({
        data: {
          conversationType: convType,
          senderId: sender.id,
          text: pick(msgs),
          dealId: dealLink?.id || null,
          createdAt,
        },
      });
      msgCount++;
    }
  }

  // Create ConversationRead for all users (mark most as read)
  for (const u of chatUsers) {
    for (const convType of conversationTypes) {
      await prisma.conversationRead.create({
        data: {
          userId: u.id,
          conversationType: convType,
          lastReadAt: daysAgo(rand(0, 2)),
        },
      });
    }
  }

  // Set lastSeenAt for all users
  for (const u of chatUsers) {
    await prisma.user.update({
      where: { id: u.id },
      data: { lastSeenAt: daysAgo(0) },
    });
  }

  console.log(`  ✓ ${msgCount} chat messages across ${conversationTypes.length} conversations`);

  // ── EXPENSES ──
  console.log('\n📊 Seeding expenses...');
  const EXPENSE_CATEGORIES = ['Аренда', 'Зарплата', 'Транспорт', 'Реклама', 'Коммунальные', 'Канцелярия', 'Связь', 'Налоги', 'Прочее'];
  let expenseCount = 0;

  for (let i = 0; i < 35; i++) {
    const category = pick(EXPENSE_CATEGORIES);
    const amount = roundPrice(rand(100, 5000) * 1000);
    const creator = Math.random() < 0.6 ? ADMIN_ID : ACCOUNTANT_ID;
    const dayBack = rand(0, 85);

    await prisma.expense.create({
      data: {
        date: daysAgo(dayBack),
        category,
        amount,
        note: Math.random() < 0.4 ? `Оплата: ${category.toLowerCase()}` : null,
        createdBy: creator,
      },
    });
    expenseCount++;
  }

  console.log(`  ✓ ${expenseCount} expenses`);

  // ── TASKS ──
  console.log('\n📋 Seeding tasks...');
  const TASK_TITLES = [
    'Подготовить отчёт за месяц',
    'Обновить прайс-лист',
    'Провести инвентаризацию склада',
    'Связаться с поставщиком Китай',
    'Подготовить документы для клиента',
    'Проверить качество партии товара',
    'Обзвон базы клиентов',
    'Подготовить презентацию для партнёра',
    'Оформить возврат товара',
    'Обновить витрину на сайте',
    'Провести собрание отдела',
    'Составить план на квартал',
    'Проверить дебиторскую задолженность',
    'Оформить новый договор поставки',
    'Настроить уведомления для клиентов',
    'Провести ревизию остатков',
    'Подготовить КП для тендера',
    'Обучить нового сотрудника',
  ];

  const allAssignees = [
    ...MANAGERS.map(m => m.id),
    WAREHOUSE_USER_ID,
    WH_MANAGER_ID,
    ACCOUNTANT_ID,
  ];

  let taskCount = 0;

  for (let i = 0; i < TASK_TITLES.length; i++) {
    const title = TASK_TITLES[i];
    const assignee = pick(allAssignees);
    const creator = Math.random() < 0.6 ? ADMIN_ID : pick(MANAGERS).id;
    const dayBack = rand(1, 60);

    // Distribute statuses
    let status: TaskStatus;
    if (i < 5) status = TaskStatus.TODO;
    else if (i < 10) status = TaskStatus.IN_PROGRESS;
    else if (i < 14) status = TaskStatus.DONE;
    else status = TaskStatus.APPROVED;

    const report = (status === 'DONE' || status === 'APPROVED') ? 'Задача выполнена. Результат передан.' : null;

    await prisma.task.create({
      data: {
        title,
        description: Math.random() < 0.7 ? `Описание задачи: ${title.toLowerCase()}` : null,
        status,
        assigneeId: assignee,
        createdById: creator,
        report,
        dueDate: Math.random() < 0.7 ? daysAgo(dayBack - rand(5, 20)) : null,
        approvedById: status === 'APPROVED' ? ADMIN_ID : null,
        approvedAt: status === 'APPROVED' ? daysAgo(dayBack - 1) : null,
        createdAt: daysAgo(dayBack),
      },
    });
    taskCount++;
  }

  console.log(`  ✓ ${taskCount} tasks`);

  // ── Summary ──
  const statusCounts = new Map<string, number>();
  for (const d of deals) {
    statusCounts.set(d.status, (statusCounts.get(d.status) || 0) + 1);
  }

  const paidDeals = deals.filter(d => d.paymentStatus === 'PAID').length;
  const partialDeals = deals.filter(d => d.paymentStatus === 'PARTIAL').length;
  const unpaidActive = deals.filter(d => d.paymentStatus === 'UNPAID' && !['CANCELED', 'NEW'].includes(d.status)).length;
  const totalDebt = deals.reduce((s, d) => s + Math.max(0, d.amount - d.paidAmount), 0);
  const totalRevenue = deals.filter(d => !['CANCELED', 'NEW', 'REJECTED'].includes(d.status)).reduce((s, d) => s + d.paidAmount, 0);

  console.log('\n═══════════════════════════════════');
  console.log('✅ Demo data seeded (3 months)!');
  console.log('═══════════════════════════════════');
  console.log(`  Products:            ${products.length}`);
  console.log(`  Clients:             ${clients.length}`);
  console.log(`  Contracts:           ${contractMap.size}`);
  console.log(`  Deals:               ${deals.length}`);
  for (const [st, cnt] of [...statusCounts.entries()].sort()) {
    console.log(`    ${st.padEnd(22)} ${cnt}`);
  }
  console.log(`  Payments:            ${paymentCount}`);
  console.log(`  Paid/Partial/Unpaid: ${paidDeals}/${partialDeals}/${unpaidActive}`);
  console.log(`  Total revenue:       ${(totalRevenue / 1000000).toFixed(1)}M so'm`);
  console.log(`  Total debt:          ${(totalDebt / 1000000).toFixed(1)}M so'm`);
  console.log(`  Daily Closings:      ${closingCount}`);
  console.log(`  Comments:            ${commentCount}`);
  console.log(`  Audit Logs:          ${auditCount}`);
  console.log(`  Notifications:       ${notifCount}`);
  console.log(`  Chat Messages:       ${msgCount}`);
  console.log(`  Expenses:            ${expenseCount}`);
  console.log(`  Tasks:               ${taskCount}`);
  console.log('\n  Role users created:');
  console.log(`    WAREHOUSE:         warehouse1 / demo123`);
  console.log(`    WAREHOUSE_MANAGER: whmanager1 / demo123`);
  console.log(`    ACCOUNTANT:        accountant1 / demo123`);
}

main()
  .catch((err) => {
    console.error('❌ Seed error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
