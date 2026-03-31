import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const EXECUTE = process.argv.includes('--execute');

const PERIOD_START = new Date(Date.UTC(2024, 0, 1));
const PERIOD_END = new Date(Date.UTC(2026, 2, 1));

const FILES = [
  { filePath: path.resolve(process.cwd(), '../analytics_2024-12-26.xlsx'), months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { filePath: path.resolve(process.cwd(), '../analytics_2025-12-29.xlsx'), months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { filePath: path.resolve(process.cwd(), '../analytics_2026-03-18.xlsx'), months: [0, 1] },
] as const;

const TARGETS = [
  {
    canonicalName: 'тимур дилшод',
    aliases: ['тимур дилшод'],
  },
  {
    canonicalName: 'ламинация цех',
    aliases: ['ламинация цех', 'ламинационный цех', 'ппс'],
  },
] as const;

const resolvedDatabaseUrl = process.env.DATABASE_URL
  ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=1&pool_timeout=0&sslmode=require`
  : undefined;

const prisma = new PrismaClient(
  resolvedDatabaseUrl
    ? {
        datasources: {
          db: {
            url: resolvedDatabaseUrl,
          },
        },
      }
    : undefined,
);

const COL_DATE = 0;
const COL_CLIENT = 1;

function norm(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function toDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d && d.y >= 1900 && d.y <= 2100) {
      return new Date(Date.UTC(d.y, d.m - 1, d.d));
    }
    return null;
  }

  const s = String(value).trim();
  if (!s) return null;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return null;
  return parsed;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function makeFingerprint(deal: any): string {
  const items = [...deal.items]
    .map((item: any) => ({
      productId: item.productId,
      requestedQty: String(item.requestedQty ?? ''),
      price: String(item.price ?? ''),
      lineTotal: String(item.lineTotal ?? ''),
      sourceOpType: item.sourceOpType ?? null,
      closingBalance: String(item.closingBalance ?? ''),
      dealDate: item.dealDate ? new Date(item.dealDate).toISOString() : null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const payments = [...deal.payments]
    .map((payment: any) => ({
      amount: String(payment.amount ?? ''),
      method: payment.method ?? null,
      paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
      note: payment.note ?? null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return JSON.stringify({
    title: deal.title,
    amount: String(deal.amount ?? ''),
    paidAmount: String(deal.paidAmount ?? ''),
    paymentStatus: deal.paymentStatus,
    paymentMethod: deal.paymentMethod,
    items,
    payments,
  });
}

function collectExpectedCounts() {
  const aliasToCanonical = new Map<string, string>();
  const expected = new Map<string, Set<string>>();

  for (const target of TARGETS) {
    expected.set(target.canonicalName, new Set<string>());
    for (const alias of target.aliases) {
      aliasToCanonical.set(norm(alias), target.canonicalName);
    }
  }

  for (const file of FILES) {
    if (!fs.existsSync(file.filePath)) {
      throw new Error(`Missing Excel file: ${file.filePath}`);
    }

    const workbook = XLSX.readFile(file.filePath);
    for (const monthIndex of file.months) {
      const sheetName = workbook.SheetNames[monthIndex];
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 3, defval: null });
      for (const row of rows) {
        const canonicalName = aliasToCanonical.get(norm(row[COL_CLIENT]));
        if (!canonicalName) continue;

        const dealDate = toDate(row[COL_DATE]);
        if (!dealDate || dealDate < PERIOD_START || dealDate >= PERIOD_END) continue;

        expected.get(canonicalName)!.add(dateKey(dealDate));
      }
    }
  }

  return expected;
}

async function fetchDbCounts(clientIdsByName: Map<string, string>) {
  const counts = new Map<string, number>();

  for (const target of TARGETS) {
    const clientId = clientIdsByName.get(target.canonicalName);
    if (!clientId) {
      counts.set(target.canonicalName, 0);
      continue;
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ dt: Date }>>(
      `
        SELECT DISTINCT DATE(created_at) AS dt
        FROM deals
        WHERE client_id = $1
          AND is_archived = false
          AND created_at >= $2
          AND created_at < $3
      `,
      clientId,
      PERIOD_START,
      PERIOD_END,
    );

    counts.set(target.canonicalName, rows.length);
  }

  return counts;
}

async function main() {
  const expectedCounts = collectExpectedCounts();
  const report = {
    mode: EXECUTE ? 'execute' : 'dry-run',
    periodStart: PERIOD_START.toISOString(),
    periodEndExclusive: PERIOD_END.toISOString(),
    duplicatesFound: 0,
    duplicateGroups: [] as Array<{
      clientName: string;
      date: string;
      keepDealId: string;
      deleteDealIds: string[];
      reason: 'exact-duplicate' | 'conflict-skipped';
    }>,
    deletedDeals: 0,
    deletedItems: 0,
    deletedPayments: 0,
    deletedMovements: 0,
    deletedComments: 0,
    deletedShipments: 0,
    deletedMessages: 0,
    deletedMessageAttachments: 0,
    expectedUniqueDealsByClient: Object.fromEntries(
      [...expectedCounts.entries()].map(([name, dates]) => [name, dates.size]),
    ),
    actualUniqueDealsBeforeByClient: {} as Record<string, number>,
    actualUniqueDealsAfterByClient: {} as Record<string, number>,
  };

  const clients = await prisma.client.findMany({
    where: {
      OR: TARGETS.map((target) => ({
        companyName: { equals: target.canonicalName, mode: 'insensitive' },
      })),
    },
    select: { id: true, companyName: true },
  });

  const clientIdsByName = new Map(clients.map((client) => [client.companyName.toLowerCase(), client.id]));
  report.actualUniqueDealsBeforeByClient = Object.fromEntries(
    [...(await fetchDbCounts(clientIdsByName)).entries()],
  );

  for (const target of TARGETS) {
    const clientId = clientIdsByName.get(target.canonicalName);
    if (!clientId) continue;

    const rows = await prisma.$queryRawUnsafe<Array<{ dt: Date; deal_count: number }>>(
      `
        SELECT DATE(created_at) AS dt, COUNT(*)::int AS deal_count
        FROM deals
        WHERE client_id = $1
          AND is_archived = false
          AND created_at >= $2
          AND created_at < $3
        GROUP BY DATE(created_at)
        HAVING COUNT(*) > 1
        ORDER BY dt ASC
      `,
      clientId,
      PERIOD_START,
      PERIOD_END,
    );

    for (const row of rows) {
      const groupDate = new Date(row.dt);
      const dayStart = new Date(Date.UTC(groupDate.getUTCFullYear(), groupDate.getUTCMonth(), groupDate.getUTCDate()));
      const dayEnd = new Date(Date.UTC(groupDate.getUTCFullYear(), groupDate.getUTCMonth(), groupDate.getUTCDate() + 1));

      const deals = await prisma.deal.findMany({
        where: {
          clientId,
          isArchived: false,
          createdAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
        include: {
          items: true,
          payments: true,
          comments: true,
          movements: true,
          shipment: true,
          messages: {
            include: {
              attachments: true,
            },
          },
        },
        orderBy: [{ id: 'asc' }],
      });

      report.duplicatesFound += deals.length - 1;

      const fingerprints = new Set(deals.map((deal) => makeFingerprint(deal)));
      if (fingerprints.size !== 1) {
        report.duplicateGroups.push({
          clientName: target.canonicalName,
          date: dateKey(dayStart),
          keepDealId: deals[0].id,
          deleteDealIds: deals.slice(1).map((deal) => deal.id),
          reason: 'conflict-skipped',
        });
        continue;
      }

      const [keepDeal, ...deleteDeals] = deals;
      report.duplicateGroups.push({
        clientName: target.canonicalName,
        date: dateKey(dayStart),
        keepDealId: keepDeal.id,
        deleteDealIds: deleteDeals.map((deal) => deal.id),
        reason: 'exact-duplicate',
      });

      if (!EXECUTE || deleteDeals.length === 0) continue;

      await prisma.$transaction(async (tx) => {
        for (const deal of deleteDeals) {
          const messageIds = deal.messages.map((message) => message.id);
          const attachmentCount = deal.messages.reduce((sum, message) => sum + message.attachments.length, 0);

          if (messageIds.length > 0) {
            const deletedAttachments = await tx.messageAttachment.deleteMany({
              where: { messageId: { in: messageIds } },
            });
            report.deletedMessageAttachments += deletedAttachments.count || attachmentCount;

            const deletedMessages = await tx.message.deleteMany({
              where: { id: { in: messageIds } },
            });
            report.deletedMessages += deletedMessages.count;
          }

          const deletedPayments = await tx.payment.deleteMany({ where: { dealId: deal.id } });
          const deletedMovements = await tx.inventoryMovement.deleteMany({ where: { dealId: deal.id } });
          const deletedItems = await tx.dealItem.deleteMany({ where: { dealId: deal.id } });
          const deletedComments = await tx.dealComment.deleteMany({ where: { dealId: deal.id } });

          let deletedShipmentsCount = 0;
          if (deal.shipment) {
            await tx.shipment.delete({ where: { dealId: deal.id } });
            deletedShipmentsCount = 1;
          }

          await tx.deal.delete({ where: { id: deal.id } });

          report.deletedDeals += 1;
          report.deletedPayments += deletedPayments.count;
          report.deletedMovements += deletedMovements.count;
          report.deletedItems += deletedItems.count;
          report.deletedComments += deletedComments.count;
          report.deletedShipments += deletedShipmentsCount;
        }
      });
    }
  }

  report.actualUniqueDealsAfterByClient = Object.fromEntries(
    [...(await fetchDbCounts(clientIdsByName)).entries()],
  );

  const outPath = path.resolve(
    process.cwd(),
    `tmp/dedupe-target-client-history-${EXECUTE ? 'execute' : 'dry-run'}-report.json`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`Report written to ${outPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
