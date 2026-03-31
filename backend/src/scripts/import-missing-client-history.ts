import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, DealStatus, PaymentMethod } from '@prisma/client';

type BackupDeal = {
  id: string;
  amount: string;
  paidAmount: string;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  clientId: string;
  isArchived: boolean;
  status: DealStatus;
  createdAt: string;
};

type BackupPayment = {
  id: string;
  dealId: string;
  clientId: string;
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  note: string | null;
  createdBy: string | null;
  receivedById: string | null;
  createdAt: string;
};

type SourceClientConfig = {
  canonicalName: string;
  aliases: string[];
  backupClientId: string;
};

type PreparedDeal = {
  sourceDealId: string;
  clientName: string;
  backupClientId: string;
  title: string;
  createdAt: string;
  amount: number;
  paidAmount: number;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  status: DealStatus;
  paymentImportMode: 'source-payments' | 'synthetic-paid-amount' | 'no-payments';
  paymentMismatch: {
    sourcePaymentCount: number;
    sourcePaymentSum: number;
    deltaVsPaidAmount: number;
  };
  payments: Array<{
    sourcePaymentId: string;
    amount: number;
    paidAt: string;
    createdAt: string;
    method: PaymentMethod;
    note: string | null;
  }>;
};

function buildDatabaseUrl(): string | undefined {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return undefined;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}connection_limit=1&pool_timeout=0&sslmode=require`;
}

const prisma = new PrismaClient(
  buildDatabaseUrl()
    ? {
        datasources: {
          db: {
            url: buildDatabaseUrl(),
          },
        },
      }
    : undefined,
);

const ROOT_DIR = path.resolve(__dirname, '../..');
const BACKUPS_DIR = path.join(ROOT_DIR, 'backups');
const OUTPUT_DIR = path.join(ROOT_DIR, 'tmp');

const DEALS_BACKUP_FILE = 'deals-2026-03-16-09-45-28.json';
const PAYMENTS_BACKUP_FILE = 'payments-2026-03-16-09-45-28.json';

const SOURCE_CLIENTS: SourceClientConfig[] = [
  {
    canonicalName: 'тимур дилшод',
    aliases: ['тимур дилшод'],
    backupClientId: '490c40a0-b099-4bac-aaca-b2dd3c06f050',
  },
  {
    canonicalName: 'ламинация цех',
    aliases: ['ламинация цех', 'ламинационный цех'],
    backupClientId: 'f1ec76ab-8271-42ea-b1e9-a685cd22caaf',
  },
];

const PERIOD_START = new Date('2024-01-01T00:00:00.000Z');
const PERIOD_END_EXCLUSIVE = new Date('2026-03-01T00:00:00.000Z');

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

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function inTargetPeriod(isoDate: string): boolean {
  const date = new Date(isoDate);
  return date >= PERIOD_START && date < PERIOD_END_EXCLUSIVE;
}

function buildMonthTitle(clientName: string, isoDate: string): string {
  const date = new Date(isoDate);
  return `${clientName} — ${MONTHS_RU[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function loadJsonFile<T>(filename: string): T {
  const filePath = path.join(BACKUPS_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function prepareDeals(): PreparedDeal[] {
  const sourceDeals = loadJsonFile<BackupDeal[]>(DEALS_BACKUP_FILE);
  const sourcePayments = loadJsonFile<BackupPayment[]>(PAYMENTS_BACKUP_FILE);
  const paymentsByDealId = new Map<string, BackupPayment[]>();

  for (const payment of sourcePayments) {
    const existing = paymentsByDealId.get(payment.dealId) ?? [];
    existing.push(payment);
    paymentsByDealId.set(payment.dealId, existing);
  }

  const prepared: PreparedDeal[] = [];

  for (const client of SOURCE_CLIENTS) {
    const clientDeals = sourceDeals
      .filter((deal) => deal.clientId === client.backupClientId)
      .filter((deal) => inTargetPeriod(deal.createdAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const deal of clientDeals) {
      const rawPayments = (paymentsByDealId.get(deal.id) ?? [])
        .map((payment) => ({
          sourcePaymentId: payment.id,
          amount: toNumber(payment.amount),
          paidAt: payment.paidAt,
          createdAt: payment.createdAt,
          method: payment.method,
          note: payment.note,
        }))
        .sort((a, b) => a.paidAt.localeCompare(b.paidAt));

      const paidAmount = toNumber(deal.paidAmount);
      const sourcePaymentSum = rawPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const deltaVsPaidAmount = sourcePaymentSum - paidAmount;
      const sourcePaymentMatchesDeal = Math.abs(deltaVsPaidAmount) < 0.01;

      let payments = rawPayments;
      let paymentImportMode: PreparedDeal['paymentImportMode'] = 'source-payments';

      if (paidAmount <= 0) {
        payments = [];
        paymentImportMode = 'no-payments';
      } else if (!sourcePaymentMatchesDeal) {
        payments = [
          {
            sourcePaymentId: `synthetic:${deal.id}`,
            amount: paidAmount,
            paidAt: deal.createdAt,
            createdAt: deal.createdAt,
            method: 'TRANSFER',
            note: `Synthetic payment from ${DEALS_BACKUP_FILE}; source payment links were inconsistent`,
          },
        ];
        paymentImportMode = 'synthetic-paid-amount';
      }

      prepared.push({
        sourceDealId: deal.id,
        clientName: client.canonicalName,
        backupClientId: client.backupClientId,
        title: buildMonthTitle(client.canonicalName, deal.createdAt),
        createdAt: deal.createdAt,
        amount: toNumber(deal.amount),
        paidAmount,
        paymentStatus: deal.paymentStatus,
        status: deal.status,
        paymentImportMode,
        paymentMismatch: {
          sourcePaymentCount: rawPayments.length,
          sourcePaymentSum,
          deltaVsPaidAmount,
        },
        payments,
      });
    }
  }

  return prepared;
}

function buildDryRunReport(preparedDeals: PreparedDeal[]) {
  const byClient = SOURCE_CLIENTS.map((client) => {
    const deals = preparedDeals.filter((deal) => deal.clientName === client.canonicalName);
    const byYear = new Map<number, { deals: number; amount: number; paidAmount: number; payments: number }>();

    for (const deal of deals) {
      const year = new Date(deal.createdAt).getUTCFullYear();
      const existing = byYear.get(year) ?? { deals: 0, amount: 0, paidAmount: 0, payments: 0 };
      existing.deals += 1;
      existing.amount += deal.amount;
      existing.paidAmount += deal.paidAmount;
      existing.payments += deal.payments.length;
      byYear.set(year, existing);
    }

    return {
      clientName: client.canonicalName,
      backupClientId: client.backupClientId,
      totals: {
        deals: deals.length,
        amount: deals.reduce((sum, deal) => sum + deal.amount, 0),
        paidAmount: deals.reduce((sum, deal) => sum + deal.paidAmount, 0),
        payments: deals.reduce((sum, deal) => sum + deal.payments.length, 0),
        sourcePaymentMismatches: deals.filter((deal) => deal.paymentImportMode === 'synthetic-paid-amount').length,
      },
      years: Array.from(byYear.entries()).map(([year, stats]) => ({ year, ...stats })),
      months: deals.map((deal) => ({
        month: monthKey(deal.createdAt),
        title: deal.title,
        amount: deal.amount,
        paidAmount: deal.paidAmount,
        paymentStatus: deal.paymentStatus,
        status: deal.status,
        paymentImportMode: deal.paymentImportMode,
        sourcePaymentCount: deal.paymentMismatch.sourcePaymentCount,
        sourcePaymentSum: deal.paymentMismatch.sourcePaymentSum,
        sourcePaymentDelta: deal.paymentMismatch.deltaVsPaidAmount,
        payments: deal.payments.length,
      })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      deals: DEALS_BACKUP_FILE,
      payments: PAYMENTS_BACKUP_FILE,
    },
    period: {
      start: PERIOD_START.toISOString(),
      endExclusive: PERIOD_END_EXCLUSIVE.toISOString(),
    },
    totals: {
      deals: preparedDeals.length,
      amount: preparedDeals.reduce((sum, deal) => sum + deal.amount, 0),
      paidAmount: preparedDeals.reduce((sum, deal) => sum + deal.paidAmount, 0),
      payments: preparedDeals.reduce((sum, deal) => sum + deal.payments.length, 0),
      sourcePaymentMismatches: preparedDeals.filter((deal) => deal.paymentImportMode === 'synthetic-paid-amount').length,
    },
    clients: byClient,
  };
}

async function importIntoDatabase(preparedDeals: PreparedDeal[]) {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'execute',
    createdDeals: [] as Array<{ clientName: string; month: string; dealId: string; amount: number }>,
    createdPayments: 0,
    conflicts: [] as Array<{ clientName: string; month: string; reason: string; existingDealId?: string; sourceDealId: string }>,
    missingClients: [] as string[],
  };

  const clientMap = new Map<string, { id: string; companyName: string; managerId: string }>();

  for (const client of SOURCE_CLIENTS) {
    const dbClient = await prisma.client.findFirst({
      where: {
        OR: client.aliases.map((alias) => ({
          companyName: { equals: alias, mode: 'insensitive' },
        })),
      },
      select: { id: true, companyName: true, managerId: true },
    });

    if (!dbClient) {
      report.missingClients.push(client.canonicalName);
      continue;
    }

    clientMap.set(client.canonicalName, dbClient);
  }

  if (report.missingClients.length > 0) {
    return report;
  }

  const periodStart = PERIOD_START;
  const periodEnd = PERIOD_END_EXCLUSIVE;

  for (const prepared of preparedDeals) {
    const dbClient = clientMap.get(prepared.clientName);
    if (!dbClient) continue;

    const existingDeal = await prisma.deal.findFirst({
      where: {
        clientId: dbClient.id,
        createdAt: {
          gte: new Date(prepared.createdAt),
          lt: new Date(new Date(prepared.createdAt).getTime() + 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, title: true, amount: true, createdAt: true },
    });

    if (existingDeal) {
      report.conflicts.push({
        clientName: prepared.clientName,
        month: monthKey(prepared.createdAt),
        reason: `Existing deal on ${existingDeal.createdAt.toISOString().slice(0, 10)} (${existingDeal.title})`,
        existingDealId: existingDeal.id,
        sourceDealId: prepared.sourceDealId,
      });
      continue;
    }

    const createdDeal = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          title: prepared.title,
          status: prepared.status,
          amount: prepared.amount,
          clientId: dbClient.id,
          managerId: dbClient.managerId,
          paidAmount: prepared.paidAmount,
          paymentStatus: prepared.paymentStatus,
          createdAt: new Date(prepared.createdAt),
          paymentType: 'FULL',
        },
        select: { id: true },
      });

      for (const payment of prepared.payments) {
        await tx.payment.create({
          data: {
            dealId: deal.id,
            clientId: dbClient.id,
            amount: payment.amount,
            paidAt: new Date(payment.paidAt),
            method: payment.method,
            note: payment.note ?? `Imported from ${DEALS_BACKUP_FILE}`,
            createdBy: dbClient.managerId,
            createdAt: new Date(payment.createdAt),
          },
        });
      }

      return deal;
    });

    report.createdDeals.push({
      clientName: prepared.clientName,
      month: monthKey(prepared.createdAt),
      dealId: createdDeal.id,
      amount: prepared.amount,
    });
    report.createdPayments += prepared.payments.length;
  }

  const verification = await Promise.all(
    SOURCE_CLIENTS.map(async (client) => {
      const dbClient = clientMap.get(client.canonicalName);
      if (!dbClient) return null;

      const stats = await prisma.deal.aggregate({
        where: {
          clientId: dbClient.id,
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        _count: { id: true },
        _sum: { amount: true, paidAmount: true },
      });

      return {
        clientName: client.canonicalName,
        dealCount: stats._count.id,
        amount: Number(stats._sum.amount ?? 0),
        paidAmount: Number(stats._sum.paidAmount ?? 0),
      };
    }),
  );

  return {
    ...report,
    verification: verification.filter(Boolean),
  };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const preparedDeals = prepareDeals();
  const dryRunReport = buildDryRunReport(preparedDeals);

  ensureOutputDir();

  const payloadPath = path.join(OUTPUT_DIR, 'missing-client-history.payload.json');
  const dryRunPath = path.join(OUTPUT_DIR, 'missing-client-history.dry-run-report.json');

  fs.writeFileSync(payloadPath, JSON.stringify(preparedDeals, null, 2));
  fs.writeFileSync(dryRunPath, JSON.stringify(dryRunReport, null, 2));

  console.log(`Prepared payload: ${payloadPath}`);
  console.log(`Prepared dry-run report: ${dryRunPath}`);
  console.log(`Deals prepared: ${dryRunReport.totals.deals}`);
  console.log(`Payments prepared: ${dryRunReport.totals.payments}`);

  if (!execute) {
    console.log('Dry-run only. Re-run with --execute when the target database is reachable.');
    return;
  }

  const executePath = path.join(OUTPUT_DIR, 'missing-client-history.execute-report.json');
  try {
    const executeReport = await importIntoDatabase(preparedDeals);
    fs.writeFileSync(executePath, JSON.stringify(executeReport, null, 2));

    console.log(`Execute report: ${executePath}`);
    console.log(`Created deals: ${executeReport.createdDeals.length}`);
    console.log(`Created payments: ${executeReport.createdPayments}`);
    console.log(`Conflicts logged: ${executeReport.conflicts.length}`);
    console.log(`Missing clients: ${executeReport.missingClients.length}`);
  } catch (error) {
    fs.writeFileSync(
      executePath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: 'execute',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    console.log(`Execute report: ${executePath}`);
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
