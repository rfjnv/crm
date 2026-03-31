/**
 * Fix old deals that duplicate debt already captured in March 2026 closingBalance.
 *
 * Problem: Some clients have old pre-2026 deals with non-zero balance (amount - paidAmount != 0)
 * that duplicate the debt already captured in March 2026 deal via closingBalance.
 * The March 2026 closingBalance includes ALL historical debt, so old deal balances should be zeroed.
 *
 * Also fixes: жакар.уз / жакар уз naming mismatch
 * Also fixes: "ПП: вм принт предоплата" ghost deal
 */
import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

async function main() {
  // 1. Find all clients that have March 2026 deals with closingBalance
  const marchClients = await prisma.$queryRaw<{ client_id: string; company_name: string; cb_total: string }[]>(
    Prisma.sql`
      SELECT d.client_id, c.company_name,
        COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP')
            THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS cb_total
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      JOIN clients c ON c.id = d.client_id
      WHERE d.title LIKE '%Март 2026%'
        AND d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND di.closing_balance IS NOT NULL
      GROUP BY d.client_id, c.company_name
    `
  );

  console.log(`Found ${marchClients.length} clients with March 2026 closingBalance data\n`);

  // 2. For each of these clients, find old deals (non-March-2026) with non-zero balance
  let fixedCount = 0;
  let deletedPP = 0;

  for (const mc of marchClients) {
    const oldDeals = await prisma.deal.findMany({
      where: {
        clientId: mc.client_id,
        isArchived: false,
        status: { notIn: ['CANCELED', 'REJECTED'] },
        NOT: { title: { contains: 'Март 2026' } },
      },
      select: { id: true, title: true, amount: true, paidAmount: true },
    });

    for (const deal of oldDeals) {
      const balance = Number(deal.amount) - Number(deal.paidAmount);
      if (Math.round(balance) === 0) continue;

      // Check if this is a "ПП:" ghost deal (empty deal for prepayments) — delete it
      if (deal.title.startsWith('ПП:')) {
        const itemCount = await prisma.dealItem.count({ where: { dealId: deal.id } });
        const paymentCount = await prisma.payment.count({ where: { dealId: deal.id } });
        if (itemCount === 0 && paymentCount === 0) {
          console.log(`  DELETE ghost deal: "${deal.title}" balance=${fmtNum(balance)}`);
          await prisma.deal.delete({ where: { id: deal.id } });
          deletedPP++;
          continue;
        }
      }

      // Zero out the balance by setting paidAmount = amount
      console.log(`  FIX: "${deal.title}" (${mc.company_name}) balance=${fmtNum(balance)} → 0`);
      await prisma.deal.update({
        where: { id: deal.id },
        data: {
          paidAmount: deal.amount, // set paid = amount → balance = 0
          paymentStatus: 'PAID',
        },
      });
      fixedCount++;
    }
  }

  console.log(`\nFixed ${fixedCount} old deals (zeroed balance)`);
  console.log(`Deleted ${deletedPP} ghost ПП deals`);

  // 3. Fix жакар.уз / жакар уз naming
  // Excel has "жакар уз", CRM has "жакар.уз" (with the March 2026 debt) and "жакар уз" (empty)
  const jakkarDot = await prisma.client.findFirst({
    where: { companyName: { contains: 'жакар.уз', mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });
  const jakkarSpace = await prisma.client.findFirst({
    where: { companyName: { equals: 'жакар уз', mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });

  if (jakkarDot && jakkarSpace) {
    console.log(`\nжакар naming fix:`);
    console.log(`  "жакар.уз" (${jakkarDot.id}) has March 2026 debt`);
    console.log(`  "жакар уз"  (${jakkarSpace.id}) has old empty deals`);

    // Move March 2026 deal from жакар.уз to жакар уз (to match Excel)
    const marchDeals = await prisma.deal.findMany({
      where: { clientId: jakkarDot.id, title: { contains: 'Март 2026' } },
      select: { id: true, title: true },
    });

    for (const d of marchDeals) {
      console.log(`  Moving "${d.title}" from жакар.уз → жакар уз`);
      await prisma.deal.update({
        where: { id: d.id },
        data: { clientId: jakkarSpace.id },
      });
    }

    // Check if жакар.уз has any remaining deals
    const remaining = await prisma.deal.count({ where: { clientId: jakkarDot.id } });
    if (remaining === 0) {
      console.log(`  жакар.уз has no remaining deals — can be deleted later`);
    } else {
      console.log(`  жакар.уз still has ${remaining} deals`);
    }
  }

  // 4. Verify results
  console.log('\n=== Verification ===');
  const verify = await prisma.$queryRaw<{ company_name: string; deal_total: string; cb_total: string }[]>(
    Prisma.sql`
      WITH deal_totals AS (
        SELECT d.client_id,
          SUM(d.amount - d.paid_amount)::text AS deal_total
        FROM deals d
        WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        GROUP BY d.client_id
      ),
      cb_totals AS (
        SELECT d.client_id,
          COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP')
              THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS cb_total
        FROM deal_items di
        JOIN deals d ON d.id = di.deal_id
        WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
          AND di.closing_balance IS NOT NULL
        GROUP BY d.client_id
      )
      SELECT c.company_name, COALESCE(dt.deal_total, '0') AS deal_total, COALESCE(cb.cb_total, '0') AS cb_total
      FROM clients c
      LEFT JOIN deal_totals dt ON dt.client_id = c.id
      LEFT JOIN cb_totals cb ON cb.client_id = c.id
      WHERE COALESCE(dt.deal_total::numeric, 0) != 0 OR COALESCE(cb.cb_total::numeric, 0) != 0
      ORDER BY ABS(COALESCE(dt.deal_total::numeric, 0) - COALESCE(cb.cb_total::numeric, 0)) DESC
      LIMIT 20
    `
  );

  let allMatch = true;
  for (const r of verify) {
    const dt = Number(r.deal_total);
    const cb = Number(r.cb_total);
    if (Math.abs(Math.round(dt) - Math.round(cb)) > 1) {
      console.log(`  ✗ ${r.company_name}: deal=${fmtNum(dt)} cb=${fmtNum(cb)} diff=${fmtNum(dt - cb)}`);
      allMatch = false;
    }
  }
  if (allMatch) {
    console.log('  ✓ All clients: deal balance matches closingBalance debt!');
  }

  // Grand totals
  const grandDeal = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`SELECT SUM(amount - paid_amount)::text AS total FROM deals WHERE is_archived = false AND status NOT IN ('CANCELED','REJECTED')`
  );
  const grandCB = await prisma.$queryRaw<{ total: string }[]>(
    Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F','PP')
          THEN COALESCE(di.closing_balance, 0) ELSE 0 END), 0)::text AS total
      FROM deal_items di
      JOIN deals d ON d.id = di.deal_id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND di.closing_balance IS NOT NULL
    `
  );

  console.log(`\n  Grand total (deal balance): ${fmtNum(Number(grandDeal[0]?.total ?? 0))}`);
  console.log(`  Grand total (closingBalance): ${fmtNum(Number(grandCB[0]?.total ?? 0))}`);
  console.log(`  Excel target: 873 005 763`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
