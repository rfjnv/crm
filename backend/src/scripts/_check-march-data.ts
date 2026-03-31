import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // The correct approach: use ONLY the LATEST month's data (март 2026)
  // because each month's deal already includes the cumulative opening balance

  // For March 2026 deals: deal.amount - deal.paidAmount = closing balance (= Excel AB)
  // Then split by sourceOpType

  // Step 1: Get March deals per client balance + item breakdown
  const result = await prisma.$queryRaw<{
    client_id: string; company_name: string;
    deal_balance: string; debt_items: string; pp_items: string; all_items: string
  }[]>(
    Prisma.sql`
    SELECT
      d.client_id, c.company_name,
      SUM(d.amount - d.paid_amount)::text AS deal_balance,
      SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
          THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END)::text AS debt_items,
      SUM(CASE WHEN di.source_op_type = 'PP'
          THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END)::text AS pp_items,
      SUM(COALESCE(di.requested_qty,0) * COALESCE(di.price,0))::text AS all_items
    FROM deals d
    JOIN clients c ON c.id = d.client_id
    LEFT JOIN deal_items di ON di.deal_id = d.id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
      AND d.title LIKE '%Март 2026%'
    GROUP BY d.client_id, c.company_name
    ORDER BY SUM(d.amount - d.paid_amount) DESC
    `
  );

  console.log('March 2026 deals only:');
  let totalMarchBalance = 0;
  let totalDebtItems = 0;
  let totalPPItems = 0;
  let positiveBalances = 0;
  let negativeBalances = 0;

  for (const r of result) {
    const bal = Number(r.deal_balance);
    totalMarchBalance += bal;
    totalDebtItems += Number(r.debt_items);
    totalPPItems += Number(r.pp_items);
    if (bal > 0) positiveBalances += bal;
    else negativeBalances += bal;
  }

  console.log(`  Clients with March deals: ${result.length}`);
  console.log(`  Total balance:            ${Math.round(totalMarchBalance).toLocaleString('ru-RU')}`);
  console.log(`  Positive (debt):          ${Math.round(positiveBalances).toLocaleString('ru-RU')}`);
  console.log(`  Negative (prepay):        ${Math.round(negativeBalances).toLocaleString('ru-RU')}`);
  console.log(`  Debt items (K+NK+PK+F):   ${Math.round(totalDebtItems).toLocaleString('ru-RU')}`);
  console.log(`  PP items:                 ${Math.round(totalPPItems).toLocaleString('ru-RU')}`);

  // Now: can we get 1,215M and 873M from March-only data?
  // The Excel's чистый долг = SUM of AB where opType in (к,п/к,н/к,ф) = 1,215,060,263
  // But each ROW's AB is not the same as per-client balance...

  // Actually wait. Let me re-examine: in the Excel, each row for a client has its OWN AB value
  // The AB column represents something different — it's the closing balance for that OPERATION TYPE
  // not for the client as a whole

  // Let me check: for a client like "мега папер", what do the individual Excel rows look like?
  // We need to read the Excel to understand the per-row AB values

  // For now, let's try: net debt = SUM(per-item-balance) for debt-type items only
  // where per-item-balance = item_amount * (deal_balance / deal_amount)

  // Approach: weighted balance by item type
  const marchSplit = await prisma.$queryRaw<{ net_debt: string; pp_debt: string }[]>(
    Prisma.sql`
    WITH march_deals AS (
      SELECT d.id, d.client_id,
        d.amount AS deal_amount,
        (d.amount - d.paid_amount) AS deal_balance
      FROM deals d
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.title LIKE '%Март 2026%'
    )
    SELECT
      SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
        THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0)
             * (CASE WHEN md.deal_amount > 0 THEN md.deal_balance / md.deal_amount ELSE 0 END)
        ELSE 0 END)::text AS net_debt,
      SUM(CASE WHEN di.source_op_type = 'PP'
        THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0)
             * (CASE WHEN md.deal_amount > 0 THEN md.deal_balance / md.deal_amount ELSE 0 END)
        ELSE 0 END)::text AS pp_debt
    FROM march_deals md
    JOIN deal_items di ON di.deal_id = md.id
    `
  );

  const ms = marchSplit[0];
  const netDebt = Number(ms.net_debt);
  const ppDebt = Number(ms.pp_debt);
  console.log('\nMarch weighted split:');
  console.log(`  Net debt (K+NK+PK+F):  ${Math.round(netDebt).toLocaleString('ru-RU')}`);
  console.log(`  PP debt:               ${Math.round(ppDebt).toLocaleString('ru-RU')}`);
  console.log(`  Gross:                 ${Math.round(netDebt + ppDebt).toLocaleString('ru-RU')}`);

  // APPROACH 5: The simplest and most correct
  // The import creates ONE deal per client per month
  // That deal's amount = sum of ALL items (including opening balance carried forward)
  // So deal.amount for March = effectively the total client volume for March (including carry-forward debts)
  // And deal.paidAmount = total payments in March
  // deal.amount - deal.paidAmount = closing balance = Excel AB for that client

  // The Excel sums AB separately for each operation type row
  // Since one deal can have items with DIFFERENT opTypes, we need to compute
  // the closing balance per-opType-group within each deal

  // PER-DEAL:
  //   deal_balance = amount - paidAmount
  //   item_amount[K] = sum items where opType in (K,NK,PK,F)
  //   item_amount[PP] = sum items where opType = PP
  //   item_amount[other] = sum items where opType in (N,P,T,NULL)
  //   total_items = sum all items
  //
  //   Payments cover OTHER items first (these are cash/transfer sales)
  //   remaining = total_payments - item_amount[other]  (if positive = excess paid)
  //   Then excess payments reduce PP, then K items
  //
  //   net_debt = item_amount[K] (if remaining < 0, then no payments touch debt)
  //   If remaining > 0: net_debt = item_amount[K] - max(0, remaining - item_amount[PP])

  // Let's try per-deal payment allocation:
  const perDeal = await prisma.$queryRaw<{
    deal_id: string; title: string; deal_amount: string; deal_paid: string;
    debt_items: string; pp_items: string; other_items: string
  }[]>(
    Prisma.sql`
    SELECT d.id AS deal_id, d.title,
      d.amount::text AS deal_amount,
      d.paid_amount::text AS deal_paid,
      SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
          THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END)::text AS debt_items,
      SUM(CASE WHEN di.source_op_type = 'PP'
          THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END)::text AS pp_items,
      SUM(CASE WHEN COALESCE(di.source_op_type,'NULL') NOT IN ('K','NK','PK','F','PP')
          THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END)::text AS other_items
    FROM deals d
    LEFT JOIN deal_items di ON di.deal_id = d.id
    WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
      AND d.title LIKE '%Март 2026%'
    GROUP BY d.id, d.title, d.amount, d.paid_amount
    ORDER BY d.amount DESC
    LIMIT 10
    `
  );

  console.log('\n\nPer-deal breakdown (top 10 March deals):');
  console.log(`${'Title'.padEnd(35)} ${'Amount'.padStart(12)} ${'Paid'.padStart(12)} ${'Debt'.padStart(12)} ${'PP'.padStart(12)} ${'Other'.padStart(12)}`);
  for (const d of perDeal) {
    console.log(`${d.title.substring(0, 34).padEnd(35)} ${Math.round(Number(d.deal_amount)).toLocaleString('ru-RU').padStart(12)} ${Math.round(Number(d.deal_paid)).toLocaleString('ru-RU').padStart(12)} ${Math.round(Number(d.debt_items)).toLocaleString('ru-RU').padStart(12)} ${Math.round(Number(d.pp_items)).toLocaleString('ru-RU').padStart(12)} ${Math.round(Number(d.other_items)).toLocaleString('ru-RU').padStart(12)}`);
  }

  // Try approach 5 at scale
  const approach5 = await prisma.$queryRaw<{ total_net_debt: string; total_pp: string }[]>(
    Prisma.sql`
    WITH deal_breakdown AS (
      SELECT d.id,
        d.paid_amount AS total_paid,
        COALESCE(SUM(CASE WHEN di.source_op_type IN ('K','NK','PK','F')
            THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END), 0) AS debt_items,
        COALESCE(SUM(CASE WHEN di.source_op_type = 'PP'
            THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END), 0) AS pp_items,
        COALESCE(SUM(CASE WHEN COALESCE(di.source_op_type,'NULL') NOT IN ('K','NK','PK','F','PP')
            THEN COALESCE(di.requested_qty,0) * COALESCE(di.price,0) ELSE 0 END), 0) AS other_items
      FROM deals d
      LEFT JOIN deal_items di ON di.deal_id = d.id
      WHERE d.is_archived = false AND d.status NOT IN ('CANCELED','REJECTED')
        AND d.title LIKE '%Март 2026%'
      GROUP BY d.id, d.paid_amount
    )
    SELECT
      SUM(GREATEST(debt_items - GREATEST(total_paid - other_items - pp_items, 0), 0))::text AS total_net_debt,
      SUM(CASE WHEN pp_items > 0
        THEN pp_items - GREATEST(LEAST(total_paid - other_items, pp_items), 0)
        ELSE 0 END)::text AS total_pp
    FROM deal_breakdown
    `
  );

  const a5 = approach5[0];
  console.log('\nApproach 5 (March only, payments cover other→pp→debt):');
  console.log(`  Net debt:  ${Math.round(Number(a5.total_net_debt)).toLocaleString('ru-RU')}`);
  console.log(`  PP balance: ${Math.round(Number(a5.total_pp)).toLocaleString('ru-RU')}`);
  console.log(`  Gross:     ${Math.round(Number(a5.total_net_debt) + Number(a5.total_pp)).toLocaleString('ru-RU')}`);

  console.log('\nExcel targets:');
  console.log('  Net debt:   1,215,060,263');
  console.log('  Gross debt: 873,005,763');
}

main().catch(console.error).finally(() => prisma.$disconnect());
