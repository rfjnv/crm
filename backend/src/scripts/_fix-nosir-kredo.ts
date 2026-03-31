/**
 * Fix script: Resolve duplicate client "носир кредо" and incorrect 69.4M debt
 *
 * Actions:
 * 1. Move deal e52c7cf0 from "носир кредо" → "кредо носир"
 * 2. Cancel the deal (its revenue is already counted in November deal c29cb609)
 * 3. Archive the duplicate client "носир кредо"
 * 4. Verify results
 */
import { PrismaClient } from '@prisma/client';

const DEAL_ID = 'e52c7cf0-374a-4bcf-b296-921687fbacd6';
const CORRECT_CLIENT_ID = 'dc3517ee-13a8-4484-bc17-943e61cf8fb8';   // "кредо носир"
const DUPLICATE_CLIENT_ID = '9d2861a3-f653-40cc-8194-8f28e0f63e25';  // "носир кредо"

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('FIX: Resolve duplicate "носир кредо" and 69.4M phantom debt');
  console.log('='.repeat(80));

  // ── Step 0: Pre-flight checks ──
  console.log('\n── PRE-FLIGHT CHECKS ──\n');

  const deal = await prisma.deal.findUnique({ where: { id: DEAL_ID } });
  if (!deal) { console.error('ERROR: Deal not found'); return; }

  console.log(`Deal:       ${deal.id}`);
  console.log(`Client:     ${deal.clientId}`);
  console.log(`Amount:     ${Number(deal.amount).toLocaleString()}`);
  console.log(`Paid:       ${Number(deal.paidAmount).toLocaleString()}`);
  console.log(`Status:     ${deal.status}`);
  console.log(`PayStatus:  ${deal.paymentStatus}`);

  if (deal.clientId !== DUPLICATE_CLIENT_ID) {
    console.error(`ERROR: Deal belongs to ${deal.clientId}, expected ${DUPLICATE_CLIENT_ID}`);
    return;
  }

  const dupClient = await prisma.client.findUnique({ where: { id: DUPLICATE_CLIENT_ID } });
  const correctClient = await prisma.client.findUnique({ where: { id: CORRECT_CLIENT_ID } });

  if (!dupClient) { console.error('ERROR: Duplicate client not found'); return; }
  if (!correctClient) { console.error('ERROR: Correct client not found'); return; }

  console.log(`\nDuplicate:  "${dupClient.companyName}" (${dupClient.id})`);
  console.log(`Correct:    "${correctClient.companyName}" (${correctClient.id})`);

  // Capture global debt BEFORE
  const debtBefore = await prisma.$queryRawUnsafe<{ total_debt: string }[]>(`
    SELECT COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as total_debt
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
  `);
  const globalDebtBefore = Number(debtBefore[0].total_debt);
  console.log(`\nGlobal debt BEFORE: ${globalDebtBefore.toLocaleString()}`);

  // ── Step 1: Move deal to correct client ──
  console.log('\n── STEP 1: Move deal to correct client ──\n');

  await prisma.deal.update({
    where: { id: DEAL_ID },
    data: { clientId: CORRECT_CLIENT_ID },
  });
  console.log(`✓ Deal ${DEAL_ID} moved to client ${CORRECT_CLIENT_ID}`);

  // ── Step 2: Cancel the deal (duplicate — revenue already in Nov deal) ──
  console.log('\n── STEP 2: Cancel deal (duplicate of November deal) ──\n');

  await prisma.deal.update({
    where: { id: DEAL_ID },
    data: {
      status: 'CANCELED',
      paymentStatus: 'UNPAID',
    },
  });
  console.log(`✓ Deal ${DEAL_ID} status set to CANCELED`);

  // ── Step 3: Archive the duplicate client ──
  console.log('\n── STEP 3: Archive duplicate client ──\n');

  // Check if duplicate client has any other deals
  const otherDeals = await prisma.deal.findMany({
    where: { clientId: DUPLICATE_CLIENT_ID },
  });
  console.log(`Remaining deals on duplicate client: ${otherDeals.length}`);

  // Also check for any payments still on the duplicate client
  const remainingPayments = await prisma.payment.findMany({
    where: { clientId: DUPLICATE_CLIENT_ID },
  });
  console.log(`Remaining payments on duplicate client: ${remainingPayments.length}`);

  if (otherDeals.length > 0) {
    console.log('⚠ Moving remaining deals to correct client...');
    await prisma.deal.updateMany({
      where: { clientId: DUPLICATE_CLIENT_ID },
      data: { clientId: CORRECT_CLIENT_ID },
    });
    console.log(`✓ Moved ${otherDeals.length} remaining deal(s)`);
  }

  if (remainingPayments.length > 0) {
    console.log('⚠ Moving remaining payments to correct client...');
    await prisma.payment.updateMany({
      where: { clientId: DUPLICATE_CLIENT_ID },
      data: { clientId: CORRECT_CLIENT_ID },
    });
    console.log(`✓ Moved ${remainingPayments.length} remaining payment(s)`);
  }

  await prisma.client.update({
    where: { id: DUPLICATE_CLIENT_ID },
    data: { isArchived: true },
  });
  console.log(`✓ Client "${dupClient.companyName}" (${DUPLICATE_CLIENT_ID}) archived`);

  // ── Step 4: Verify ──
  console.log('\n── VERIFICATION ──\n');

  // Check deal state
  const updatedDeal = await prisma.deal.findUnique({ where: { id: DEAL_ID } });
  console.log(`Deal ${DEAL_ID}:`);
  console.log(`  clientId:      ${updatedDeal!.clientId}`);
  console.log(`  status:        ${updatedDeal!.status}`);
  console.log(`  paymentStatus: ${updatedDeal!.paymentStatus}`);
  console.log(`  amount:        ${Number(updatedDeal!.amount).toLocaleString()}`);
  console.log(`  paidAmount:    ${Number(updatedDeal!.paidAmount).toLocaleString()}`);

  // Check correct client debt
  const correctClientDebt = await prisma.$queryRawUnsafe<{ debt: string }[]>(`
    SELECT COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as debt
    FROM deals d
    WHERE d.client_id = '${CORRECT_CLIENT_ID}'
      AND d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
  `);
  console.log(`\nClient "кредо носир" debt: ${Number(correctClientDebt[0].debt).toLocaleString()}`);

  // Check duplicate client state
  const archivedClient = await prisma.client.findUnique({ where: { id: DUPLICATE_CLIENT_ID } });
  console.log(`Client "носир кредо" archived: ${archivedClient!.isArchived}`);

  // Check global debt AFTER
  const debtAfter = await prisma.$queryRawUnsafe<{ total_debt: string }[]>(`
    SELECT COALESCE(SUM(GREATEST(d.amount - d.paid_amount, 0)), 0)::text as total_debt
    FROM deals d
    WHERE d.is_archived = false
      AND d.status NOT IN ('CANCELED','REJECTED')
  `);
  const globalDebtAfter = Number(debtAfter[0].total_debt);
  console.log(`\nGlobal debt BEFORE: ${globalDebtBefore.toLocaleString()}`);
  console.log(`Global debt AFTER:  ${globalDebtAfter.toLocaleString()}`);
  console.log(`Debt reduction:     ${(globalDebtBefore - globalDebtAfter).toLocaleString()}`);

  console.log('\n' + '='.repeat(80));
  console.log('FIX COMPLETE');
  console.log('='.repeat(80));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
