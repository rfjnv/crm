/**
 * Read-only audit of cashbox / payment-ledger integrity.
 *
 * Проверяет инвариант, который сейчас нигде не соблюдается:
 *
 *     SUM(payments.amount по сделке) == deal.paidAmount
 *
 * Он ломается тремя путями: прямая запись `paidAmount` (PATCH /deals/:id/payment),
 * super-override и зачёт переплаты (уменьшает paidAmount источника, не трогая его проводки).
 *
 * Ничего не пишет. Результат — на stdout, полный список расхождений в JSON-файл.
 *
 *   npx ts-node src/scripts/audit-cashbox-integrity.ts
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { isClientCreditTransfer } from '../lib/payment-kind';

const prisma = new PrismaClient();

const fmt = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n));

/** Расхождения меньше копейки — это шум округления Decimal, а не проблема учёта. */
const EPSILON = 0.01;

interface Mismatch {
  dealId: string;
  title: string | null;
  status: string;
  clientName: string | null;
  dealAmount: number;
  paidAmount: number;
  paymentsSum: number;
  diff: number;
  paymentsCount: number;
  hasCreditTransfer: boolean;
}

async function main() {
  console.log('='.repeat(78));
  console.log('АУДИТ ЦЕЛОСТНОСТИ КАССЫ');
  console.log('='.repeat(78));

  const deals = await prisma.deal.findMany({
    where: { isArchived: false },
    select: {
      id: true,
      title: true,
      status: true,
      amount: true,
      paidAmount: true,
      client: { select: { companyName: true } },
      payments: { select: { id: true, amount: true, note: true, paidAt: true, kind: true } },
    },
  });

  console.log(`\nВсего неархивных сделок: ${deals.length}\n`);

  // ── 1. Расхождение проводок и paidAmount ────────────────────────────────────
  const mismatches: Mismatch[] = [];
  let negativePaid = 0;

  for (const d of deals) {
    const paidAmount = Number(d.paidAmount);
    const paymentsSum = d.payments.reduce((s, p) => s + Number(p.amount), 0);
    const diff = paidAmount - paymentsSum;

    if (paidAmount < -EPSILON) negativePaid++;

    if (Math.abs(diff) > EPSILON) {
      mismatches.push({
        dealId: d.id,
        title: d.title,
        status: d.status,
        clientName: d.client?.companyName ?? null,
        dealAmount: Number(d.amount),
        paidAmount,
        paymentsSum,
        diff,
        paymentsCount: d.payments.length,
        hasCreditTransfer: d.payments.some((p) => isClientCreditTransfer(p)),
      });
    }
  }

  const overstated = mismatches.filter((m) => m.diff > 0);
  const understated = mismatches.filter((m) => m.diff < 0);
  const sumOverstated = overstated.reduce((s, m) => s + m.diff, 0);
  const sumUnderstated = understated.reduce((s, m) => s + Math.abs(m.diff), 0);

  console.log('─ 1. SUM(payments) vs deal.paidAmount ─────────────────────────────');
  console.log(`Сделок с расхождением:            ${mismatches.length}`);
  console.log(`  paidAmount БОЛЬШЕ проводок:     ${overstated.length}  на ${fmt(sumOverstated)} сум`);
  console.log(`     (деньги учтены как оплата, но проводки в кассе нет)`);
  console.log(`  paidAmount МЕНЬШЕ проводок:     ${understated.length}  на ${fmt(sumUnderstated)} сум`);
  console.log(`     (проводка в кассе есть, оплата по сделке урезана — след зачёта переплаты)`);
  console.log(`Сделок с отрицательным paidAmount: ${negativePaid}`);

  // ── 2. Проводки зачёта переплаты ────────────────────────────────────────────
  const creditPayments = await prisma.payment.findMany({
    where: { kind: { not: 'CASH_IN' } },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      note: true,
      kind: true,
      deal: { select: { id: true, title: true } },
      client: { select: { companyName: true } },
    },
    orderBy: { paidAt: 'desc' },
  });

  const creditSum = creditPayments.reduce((s, p) => s + Number(p.amount), 0);
  const legacyCredits = creditPayments.filter((p) => !p.note?.startsWith('[Зачёт переплаты]'));

  console.log('\n─ 2. Служебные проводки (не деньги) ───────────────────────────────');
  console.log(`Всего служебных проводок:         ${creditPayments.length}`);
  console.log(`Их сумма:                         ${fmt(creditSum)} сум`);
  console.log(`  из них старого формата:         ${legacyCredits.length} (источники не записаны, отменить нельзя)`);
  console.log(`\nЭта сумма БОЛЬШЕ не входит в «Касса → Итого за период» и в баланс компании.`);
  console.log(`Если число больше нуля — сверьте, насколько прошлые отчёты были завышены.`);

  // ── 3. Отрицательные и нулевые аномалии ─────────────────────────────────────
  const negPayments = await prisma.payment.count({ where: { amount: { lt: 0 } } });
  const zeroPayments = await prisma.payment.count({ where: { amount: 0 } });

  console.log('\n─ 3. Аномальные проводки ──────────────────────────────────────────');
  console.log(`Платежей с отрицательной суммой:  ${negPayments}`);
  console.log(`Платежей с нулевой суммой:        ${zeroPayments}`);

  // ── 4. Топ расхождений ──────────────────────────────────────────────────────
  const top = [...mismatches].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 15);
  if (top.length > 0) {
    console.log('\n─ 4. Крупнейшие расхождения ───────────────────────────────────────');
    for (const m of top) {
      const mark = m.hasCreditTransfer ? ' [есть зачёт]' : '';
      console.log(
        `  ${(m.diff > 0 ? '+' : '') + fmt(m.diff)} сум — ${m.clientName || '?'} / `
        + `${m.title || m.dealId.slice(0, 8)} (${m.status}, проводок: ${m.paymentsCount})${mark}`,
      );
    }
  }

  const outFile = `cashbox-integrity-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dealsChecked: deals.length,
        summary: {
          mismatches: mismatches.length,
          overstatedCount: overstated.length,
          overstatedSum: sumOverstated,
          understatedCount: understated.length,
          understatedSum: sumUnderstated,
          negativePaidAmountDeals: negativePaid,
          creditTransferCount: creditPayments.length,
          creditTransferSum: creditSum,
          legacyCreditTransfers: legacyCredits.length,
          negativePayments: negPayments,
          zeroPayments,
        },
        mismatches,
        creditPayments: creditPayments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          paidAt: p.paidAt,
          dealId: p.deal?.id ?? null,
          dealTitle: p.deal?.title ?? null,
          clientName: p.client?.companyName ?? null,
          note: p.note,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`\nПодробный отчёт: ${outFile}`);
  console.log('='.repeat(78));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
