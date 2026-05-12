/**
 * Объединение цеховых клиентов «ламинация цех» и «лак цех» в клиента «ппс»
 * + конвертация остатков склада ППС в закрытые сделки по датам ADD-событий.
 *
 * Параметры:
 *   --execute  — реально применить (без флага = preview).
 *
 * Запуск:
 *   cd backend
 *   npx tsx src/scripts/merge-cehs-into-pps.ts            # preview
 *   npx tsx src/scripts/merge-cehs-into-pps.ts --execute  # применить
 *
 * Безопасность:
 *   • вся работа в одной транзакции с увеличенным таймаутом — при ошибке полный rollback;
 *   • secondary-клиенты не удаляются, только isArchived=true;
 *   • проверяется, что primary существует; если ID secondary совпадает с primary — фатал;
 *   • для каждой ADD-операции склада ппс создаётся CLOSED-сделка с closedAt = ADD.createdAt
 *     и зеркальное RESERVE_TO_DEAL событие, выводящее остаток в 0 (не уходим в минус).
 */
import prisma from '../lib/prisma';
import type { Prisma } from '@prisma/client';

const PRIMARY_NAME = 'ппс';
const SECONDARY_NAMES = ['ламинация цех', 'лак цех'];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface ClientLite {
  id: string;
  companyName: string;
  isArchived: boolean;
  managerId: string;
}

async function findClientByName(name: string): Promise<ClientLite | null> {
  const all = await prisma.client.findMany({
    select: { id: true, companyName: true, isArchived: true, managerId: true },
  });
  const target = norm(name);
  const exact = all.find((c) => norm(c.companyName) === target);
  if (exact) return exact;
  // частичное совпадение — но только если ровно один кандидат
  const partial = all.filter(
    (c) => norm(c.companyName).includes(target) || target.includes(norm(c.companyName)),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Неоднозначное совпадение для "${name}": ${partial.map((p) => `"${p.companyName}"`).join(', ')}`,
    );
  }
  return null;
}

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('='.repeat(80));
  console.log(`  MERGE CEHS → "${PRIMARY_NAME}"  +  STOCK→CLOSED-DEALS  ${isExecute ? '** LIVE **' : '(PREVIEW)'}`);
  console.log('='.repeat(80));

  // ── Найти primary и secondaries ──
  const primary = await findClientByName(PRIMARY_NAME);
  if (!primary) throw new Error(`Primary client "${PRIMARY_NAME}" не найден`);
  console.log(`\n  PRIMARY:   "${primary.companyName}" id=${primary.id}  manager=${primary.managerId}`);

  const secondaries: ClientLite[] = [];
  for (const name of SECONDARY_NAMES) {
    const c = await findClientByName(name);
    if (!c) {
      console.warn(`  [warn] Secondary "${name}" не найден — пропускаю`);
      continue;
    }
    if (c.id === primary.id) throw new Error(`Secondary "${name}" совпадает с primary — отказ`);
    secondaries.push(c);
    console.log(`  SECONDARY: "${c.companyName}" id=${c.id}  archived=${c.isArchived}`);
  }
  if (secondaries.length === 0) throw new Error('Нет ни одного secondary-клиента — нечего объединять');

  // Менеджер для новых сделок и stock-events
  const managerExists = await prisma.user.findUnique({
    where: { id: primary.managerId },
    select: { id: true, fullName: true, isActive: true },
  });
  if (!managerExists) {
    throw new Error(`Manager primary-клиента (id=${primary.managerId}) не существует — отказ`);
  }
  console.log(`  manager OK: ${managerExists.fullName} (active=${managerExists.isActive})`);

  // ── Собрать счётчики merge ──
  console.log(`\n--- COUNTS TO MIGRATE ---`);
  let totDeals = 0,
    totPayments = 0,
    totContracts = 0,
    totNotes = 0,
    totBoardRows = 0,
    totStockEvents = 0,
    totStockPositions = 0;
  const perSecondary: {
    sec: ClientLite;
    deals: number;
    payments: number;
    contracts: number;
    notes: number;
    boardRows: number;
    stockEvents: number;
    stockPositions: { productId: string; qtyTotal: number }[];
  }[] = [];

  for (const sec of secondaries) {
    const [deals, payments, contracts, notes, boardRows, stockEvents, stockPositions] = await Promise.all([
      prisma.deal.count({ where: { clientId: sec.id } }),
      prisma.payment.count({ where: { clientId: sec.id } }),
      prisma.contract.count({ where: { clientId: sec.id } }),
      prisma.clientNote.count({ where: { clientId: sec.id } }),
      prisma.notesBoardRow.count({ where: { clientId: sec.id } }),
      prisma.clientStockEvent.count({ where: { clientId: sec.id } }),
      prisma.clientStockPosition.findMany({
        where: { clientId: sec.id },
        select: { productId: true, qtyTotal: true },
      }),
    ]);
    perSecondary.push({
      sec,
      deals,
      payments,
      contracts,
      notes,
      boardRows,
      stockEvents,
      stockPositions: stockPositions.map((p) => ({ productId: p.productId, qtyTotal: Number(p.qtyTotal) })),
    });
    totDeals += deals;
    totPayments += payments;
    totContracts += contracts;
    totNotes += notes;
    totBoardRows += boardRows;
    totStockEvents += stockEvents;
    totStockPositions += stockPositions.length;
    console.log(
      `  "${sec.companyName}": deals=${deals} pmts=${payments} contracts=${contracts} notes=${notes} board=${boardRows} stockEvents=${stockEvents} stockPos=${stockPositions.length}`,
    );
  }
  console.log(
    `  TOTAL: deals=${totDeals} pmts=${totPayments} contracts=${totContracts} notes=${totNotes} board=${totBoardRows} stockEvents=${totStockEvents} stockPos=${totStockPositions}`,
  );

  // ── ADD-события по ппс для конвертации в закрытые сделки ──
  console.log(`\n--- STOCK→CLOSED-DEALS (ппс) ---`);
  const addEvents = await prisma.clientStockEvent.findMany({
    where: { clientId: primary.id, type: 'ADD' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productId: true,
      qtyDelta: true,
      unitPrice: true,
      createdAt: true,
      product: { select: { name: true, salePrice: true, isActive: true } },
    },
  });
  let plannedDealsFromStock = 0;
  let plannedAmountFromStock = 0;
  let plannedQtyFromStock = 0;
  for (const ev of addEvents) {
    const qty = Number(ev.qtyDelta);
    if (qty <= 0) continue;
    const unitPrice = ev.unitPrice != null ? Number(ev.unitPrice) : ev.product.salePrice != null ? Number(ev.product.salePrice) : 0;
    plannedDealsFromStock++;
    plannedAmountFromStock += qty * unitPrice;
    plannedQtyFromStock += qty;
  }
  console.log(
    `  ADD events to convert: ${plannedDealsFromStock}, total qty=${plannedQtyFromStock}, total amount=${plannedAmountFromStock.toLocaleString('ru-RU')}`,
  );

  if (!isExecute) {
    console.log('\n' + '='.repeat(80));
    console.log('  PREVIEW done. Run with --execute to apply.');
    console.log('='.repeat(80));
    return;
  }

  // ── Применяем ВСЁ в одной транзакции ──
  console.log('\n  EXECUTING…');
  const startedAt = Date.now();
  const result = await prisma.$transaction(
    async (tx) => {
      const stat = {
        movedDeals: 0,
        movedPayments: 0,
        movedContracts: 0,
        movedNotes: 0,
        movedBoardRows: 0,
        movedStockEvents: 0,
        mergedStockPositions: 0,
        archivedSecondaries: 0,
        createdDealsFromStock: 0,
        createdDealItems: 0,
        createdReserveEvents: 0,
        zeroedPositions: 0,
      };

      // === MERGE ===
      for (const item of perSecondary) {
        const sec = item.sec;

        if (item.deals > 0) {
          const r = await tx.deal.updateMany({
            where: { clientId: sec.id },
            data: { clientId: primary.id },
          });
          stat.movedDeals += r.count;
        }
        if (item.payments > 0) {
          const r = await tx.payment.updateMany({
            where: { clientId: sec.id },
            data: { clientId: primary.id },
          });
          stat.movedPayments += r.count;
        }
        if (item.contracts > 0) {
          const r = await tx.contract.updateMany({
            where: { clientId: sec.id },
            data: { clientId: primary.id },
          });
          stat.movedContracts += r.count;
        }
        if (item.notes > 0) {
          const r = await tx.clientNote.updateMany({
            where: { clientId: sec.id },
            data: { clientId: primary.id },
          });
          stat.movedNotes += r.count;
        }
        if (item.boardRows > 0) {
          const r = await tx.notesBoardRow.updateMany({
            where: { clientId: sec.id },
            data: { clientId: primary.id },
          });
          stat.movedBoardRows += r.count;
        }
        if (item.stockEvents > 0) {
          const r = await tx.clientStockEvent.updateMany({
            where: { clientId: sec.id },
            data: { clientId: primary.id },
          });
          stat.movedStockEvents += r.count;
        }

        // Stock positions: суммируем qtyTotal в primary, удаляем старые
        for (const pos of item.stockPositions) {
          const existing = await tx.clientStockPosition.findUnique({
            where: { clientId_productId: { clientId: primary.id, productId: pos.productId } },
            select: { id: true, qtyTotal: true },
          });
          if (existing) {
            await tx.clientStockPosition.update({
              where: { clientId_productId: { clientId: primary.id, productId: pos.productId } },
              data: { qtyTotal: Number(existing.qtyTotal) + pos.qtyTotal },
            });
          } else {
            await tx.clientStockPosition.create({
              data: { clientId: primary.id, productId: pos.productId, qtyTotal: pos.qtyTotal },
            });
          }
          stat.mergedStockPositions++;
        }
        if (item.stockPositions.length > 0) {
          await tx.clientStockPosition.deleteMany({ where: { clientId: sec.id } });
        }

        // Архивация (но не удаление)
        await tx.client.update({
          where: { id: sec.id },
          data: { isArchived: true },
        });
        stat.archivedSecondaries++;
      }

      // === STOCK → CLOSED DEALS ===
      // Идём в хронологическом порядке, поддерживаем актуальный qtyTotal в локальной мапе.
      const positionsRows = await tx.clientStockPosition.findMany({
        where: { clientId: primary.id },
        select: { productId: true, qtyTotal: true },
      });
      const liveQty = new Map<string, number>();
      for (const p of positionsRows) liveQty.set(p.productId, Number(p.qtyTotal));

      for (const ev of addEvents) {
        const fullQty = Number(ev.qtyDelta);
        if (fullQty <= 0) continue;
        const unitPrice =
          ev.unitPrice != null
            ? Number(ev.unitPrice)
            : ev.product.salePrice != null
              ? Number(ev.product.salePrice)
              : 0;
        const qtyBefore = liveQty.get(ev.productId) ?? 0;
        const reserveQty = Math.min(qtyBefore, fullQty);
        const qtyAfter = qtyBefore - reserveQty;
        const amount = reserveQty * unitPrice;

        const dateStr = ev.createdAt.toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' });
        const deal = await tx.deal.create({
          data: {
            title: `Списание остатков склада клиента (ппс) от ${dateStr}`,
            status: 'CLOSED',
            amount,
            clientId: primary.id,
            managerId: primary.managerId,
            paymentType: 'FULL',
            paymentStatus: 'UNPAID',
            paidAmount: 0,
            discount: 0,
            includeVat: true,
            isSessionDeal: false,
            isArchived: false,
            createdAt: ev.createdAt,
            closedAt: ev.createdAt,
          },
          select: { id: true },
        });
        stat.createdDealsFromStock++;

        await tx.dealItem.create({
          data: {
            dealId: deal.id,
            productId: ev.productId,
            requestedQty: reserveQty,
            price: unitPrice,
            lineTotal: amount,
            sourceOpType: 'CLIENT_STOCK',
            dealDate: ev.createdAt,
            createdAt: ev.createdAt,
          },
        });
        stat.createdDealItems++;

        if (reserveQty > 0) {
          await tx.clientStockEvent.create({
            data: {
              clientId: primary.id,
              productId: ev.productId,
              type: 'RESERVE_TO_DEAL',
              qtyDelta: -reserveQty,
              qtyBefore,
              qtyAfter,
              sourceDealId: deal.id,
              authorId: primary.managerId,
              unitPrice,
              lineTotal: amount,
              comment: `Авто-закрытие остатков (ADD от ${ev.createdAt.toISOString().slice(0, 10)})`,
              createdAt: ev.createdAt,
            },
          });
          stat.createdReserveEvents++;

          await tx.clientStockPosition.update({
            where: { clientId_productId: { clientId: primary.id, productId: ev.productId } },
            data: { qtyTotal: qtyAfter },
          });
          liveQty.set(ev.productId, qtyAfter);
          if (qtyAfter === 0) stat.zeroedPositions++;
        }
      }

      return stat;
    },
    { timeout: 10 * 60 * 1000, maxWait: 30 * 1000, isolationLevel: 'ReadCommitted' as Prisma.TransactionIsolationLevel },
  );

  const ms = Date.now() - startedAt;
  console.log('\n' + '='.repeat(80));
  console.log(`  DONE in ${(ms / 1000).toFixed(1)}s`);
  console.log('='.repeat(80));
  console.log(`  moved deals:              ${result.movedDeals}`);
  console.log(`  moved payments:           ${result.movedPayments}`);
  console.log(`  moved contracts:          ${result.movedContracts}`);
  console.log(`  moved client_notes:       ${result.movedNotes}`);
  console.log(`  moved notes_board_rows:   ${result.movedBoardRows}`);
  console.log(`  moved stock_events:       ${result.movedStockEvents}`);
  console.log(`  merged stock positions:   ${result.mergedStockPositions}`);
  console.log(`  archived secondaries:     ${result.archivedSecondaries}`);
  console.log(`  closed deals from stock:  ${result.createdDealsFromStock}  (items=${result.createdDealItems})`);
  console.log(`  reserve events created:   ${result.createdReserveEvents}`);
  console.log(`  positions reduced to 0:   ${result.zeroedPositions}`);

  // Финальная сверка
  console.log(`\n--- POST-CHECK ---`);
  const ppsAfter = await prisma.client.findUnique({
    where: { id: primary.id },
    select: {
      isArchived: true,
      _count: {
        select: { deals: true, payments: true, contracts: true, clientNotes: true, notesBoardRows: true, stockEvents: true, stockPositions: true },
      },
    },
  });
  console.log(`  ппс: archived=${ppsAfter?.isArchived}`, ppsAfter?._count);
  for (const sec of secondaries) {
    const after = await prisma.client.findUnique({
      where: { id: sec.id },
      select: {
        isArchived: true,
        _count: { select: { deals: true, payments: true, contracts: true, clientNotes: true, notesBoardRows: true, stockEvents: true, stockPositions: true } },
      },
    });
    console.log(`  "${sec.companyName}": archived=${after?.isArchived}`, after?._count);
  }
  const ppsRemainingStock = await prisma.clientStockPosition.aggregate({
    where: { clientId: primary.id },
    _sum: { qtyTotal: true },
  });
  console.log(`  ппс stock remaining qtyTotal: ${Number(ppsRemainingStock._sum.qtyTotal || 0)}`);
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
