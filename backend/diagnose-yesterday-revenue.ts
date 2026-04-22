import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseYesterday() {
  try {
    console.log('🔍 Диагностика выручки на 31.03.2026\n');

    const TASHKENT_OFFSET = 5 * 60 * 60 * 1000; // UTC+5
    const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET);
    console.log(`Текущее время Ташкента: ${nowTashkent.toISOString()}`);

    // Вчера (31.03)
    const y = nowTashkent.getUTCFullYear();
    const mo = nowTashkent.getUTCMonth();
    const dy = nowTashkent.getUTCDate();

    const startOfToday = new Date(Date.UTC(y, mo, dy) - TASHKENT_OFFSET);
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const startOfTomorrow = new Date(startOfToday.getTime());

    console.log(`Вчера: ${startOfYesterday.toISOString()} - ${startOfToday.toISOString()}`);
    console.log(`Сегодня: ${startOfToday.toISOString()} - ${startOfTomorrow.toISOString()}\n`);

    // 1. Все deal_items за вчера
    const items = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT
          di.id,
          di.deal_id,
          d.title as deal_title,
          c.company_name,
          di.product_id,
          p.name as product_name,
          di.requested_qty,
          di.price,
          di.line_total,
          (di.requested_qty * di.price)::numeric as calculated_total,
          COALESCE(di.line_total, di.requested_qty * di.price, 0)::numeric as used_in_sum,
          di.deal_date,
          d.created_at,
          di.source_op_type
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        JOIN clients c ON c.id = d.client_id
        JOIN products p ON p.id = di.product_id
        WHERE d.status NOT IN ('CANCELED', 'REJECTED')
          AND d.is_archived = false
          AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
          AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
        ORDER BY di.deal_date DESC, d.id, di.id
      `
    );

    console.log(`📊 Найдено deal_items за 31.03: ${items.length}\n`);

    let totalFromLineTotal = 0;
    let totalFromCalculated = 0;
    let totalUsedInSum = 0;
    const deals = new Map<string, any[]>();

    items.forEach(item => {
      if (!deals.has(item.deal_id)) {
        deals.set(item.deal_id, []);
      }
      deals.get(item.deal_id)!.push(item);

      const lineTotal = Number(item.line_total || 0);
      const calculated = Number(item.calculated_total || 0);
      const used = Number(item.used_in_sum || 0);

      totalFromLineTotal += lineTotal;
      totalFromCalculated += calculated;
      totalUsedInSum += used;

      console.log(`
╔═ Товар:
║  Deal: ${item.deal_title} (${item.deal_id})
║  Клиент: ${item.company_name}
║  Товар: ${item.product_name}
║  Кол-во: ${item.requested_qty} @ ${item.price}/шт
║
║  line_total (из Excel): ${lineTotal}
║  Рассчеты (qty*price): ${calculated}
║  Используется в выручке: ${used}
║  sourceOpType: ${item.source_op_type}
╚═ ${lineTotal === 0 && calculated > 0 ? '⚠️ line_total ПУСТАЯ!' : '✓'}`);
    });

    console.log(`
═══════════════════════════════════════════════════════════
📈 ИТОГИ по всем товарам 31.03:
═══════════════════════════════════════════════════════════
✓ Если бы считали только из line_total: ${totalFromLineTotal}
✓ Если бы считали qty*price: ${totalFromCalculated}
✓ Фактически используется в выручке: ${totalUsedInSum}
═══════════════════════════════════════════════════════════\n`);

    // 2. Проверим вчерашнюю выручку через API запрос
    const apiRevenue = await prisma.$queryRaw<{ total: string }[]>(
      Prisma.sql`
        SELECT COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text as total
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.status NOT IN ('CANCELED', 'REJECTED')
          AND d.is_archived = false
          AND COALESCE(di.deal_date, d.created_at) >= ${startOfYesterday}
          AND COALESCE(di.deal_date, d.created_at) < ${startOfToday}
      `
    );

    console.log(`🔢 Выручка 31.03 по запросу из dashboard API: ${apiRevenue[0]?.total || 0}`);

    // 3. Проверим сделки за вчера
    console.log(`\n📋 Сделки за 31.03:\n`);
    const dealsData = await prisma.deal.findMany({
      where: {
        status: { notIn: ['CANCELED', 'REJECTED'] },
        isArchived: false,
        createdAt: { gte: startOfYesterday, lt: startOfToday },
      },
      include: {
        client: true,
        manager: true,
        items: true,
      },
    });

    console.log(`Найдено сделок: ${dealsData.length}`);
    dealsData.forEach(deal => {
      const itemsSum = deal.items.reduce((sum, item) => {
        const used = Number(item.lineTotal || (Number(item.requestedQty) * Number(item.price || 0)) || 0);
        return sum + used;
      }, 0);

      console.log(`
Deal: ${deal.title}
  amount: ${deal.amount}
  Items count: ${deal.items.length}
  Items sum: ${itemsSum}
  ${itemsSum !== Number(deal.amount) ? '⚠️ MISMATCH!' : '✓'}`);
    });

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseYesterday();
