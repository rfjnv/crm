/// <reference types="node" />

import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function fmtMoney(raw: string): string {
  const n = Number(raw || '0');
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

async function main() {
  const monthRegex = `\\s*[—-]\\s*(${MONTHS_RU.join('|')})\\s+20\\d{2}\\s*$`;
  const dayMonthYearRegex = `\\s*[—-]\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*$`;

  console.log('============================================================');
  console.log(`Delete month-year deals with zero revenue (${EXECUTE ? 'EXECUTE' : 'DRY-RUN'})`);
  console.log('============================================================\n');

  const candidates = await prisma.$queryRaw<{
    id: string;
    title: string;
    amount: string;
    created_at: Date | string;
    item_count: number;
    items_revenue: string;
  }[]>(
    Prisma.sql`
      SELECT
        d.id,
        d.title,
        d.amount::text AS amount,
        d.created_at,
        COUNT(di.id)::int AS item_count,
        COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0)::text AS items_revenue
      FROM deals d
      LEFT JOIN deal_items di ON di.deal_id = d.id
      WHERE d.title ~* ${monthRegex}
        AND d.title !~ ${dayMonthYearRegex}
        AND COALESCE(d.amount, 0) = 0
      GROUP BY d.id
      HAVING COALESCE(SUM(COALESCE(di.line_total, di.requested_qty * di.price, 0)), 0) = 0
      ORDER BY d.created_at DESC
    `,
  );

  console.log(`Candidates found: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const preview = candidates.slice(0, 25);
  console.log('\nPreview (up to 25):');
  for (const c of preview) {
    const dt = new Date(c.created_at).toISOString().slice(0, 10);
    console.log(`- ${c.title} | amount=${fmtMoney(c.amount)} | itemsRevenue=${fmtMoney(c.items_revenue)} | items=${c.item_count} | created=${dt}`);
  }
  if (candidates.length > preview.length) {
    console.log(`... and ${candidates.length - preview.length} more`);
  }

  if (!EXECUTE) {
    console.log('\nDry-run only. Run with --execute to apply deletion.');
    return;
  }

  const dealIds = candidates.map((c) => c.id);

  const result = await prisma.$transaction(async (tx) => {
    const payments = await tx.payment.deleteMany({ where: { dealId: { in: dealIds } } });
    const movements = await tx.inventoryMovement.deleteMany({ where: { dealId: { in: dealIds } } });
    const messages = await tx.message.deleteMany({ where: { dealId: { in: dealIds } } });
    const shipments = await tx.shipment.deleteMany({ where: { dealId: { in: dealIds } } });
    const comments = await tx.dealComment.deleteMany({ where: { dealId: { in: dealIds } } });
    const items = await tx.dealItem.deleteMany({ where: { dealId: { in: dealIds } } });
    const deals = await tx.deal.deleteMany({ where: { id: { in: dealIds } } });

    return {
      payments: payments.count,
      movements: movements.count,
      messages: messages.count,
      shipments: shipments.count,
      comments: comments.count,
      items: items.count,
      deals: deals.count,
    };
  });

  console.log('\nDeleted successfully:');
  console.log(`- payments: ${result.payments}`);
  console.log(`- inventory_movements: ${result.movements}`);
  console.log(`- messages: ${result.messages}`);
  console.log(`- shipments: ${result.shipments}`);
  console.log(`- deal_comments: ${result.comments}`);
  console.log(`- deal_items: ${result.items}`);
  console.log(`- deals: ${result.deals}`);
}

main()
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
