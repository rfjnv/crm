import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { fetchCbuRates, VED_CURRENCIES, type VedCurrency } from './cbu-client';

export interface SyncResult {
  fetched: number;
  upserted: number;
  skipped: number;
  sourceDate: string | null;
  errors: string[];
}

/**
 * Приводит произвольный Date / строку к полуночи UTC, как удобно для колонки DATE.
 */
function atUtcMidnight(input: Date | string): Date {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const exchangeRatesService = {
  /**
   * Синхронизирует курсы ЦБ РУз в таблицу exchange_rates.
   * Идемпотентно: по (date, currency) делает upsert — существующие перезаписывает (ЦБ иногда корректирует архив).
   */
  async syncFromCbu(): Promise<SyncResult> {
    const rates = await fetchCbuRates();
    const result: SyncResult = {
      fetched: rates.length,
      upserted: 0,
      skipped: 0,
      sourceDate: rates[0]?.rawDate ?? null,
      errors: [],
    };

    for (const r of rates) {
      try {
        const date = atUtcMidnight(r.date);
        await prisma.exchangeRate.upsert({
          where: { date_currency: { date, currency: r.code } },
          create: {
            date,
            currency: r.code,
            rate: new Prisma.Decimal(r.rate),
            nominal: r.nominal || 1,
            source: 'CBU',
          },
          update: {
            rate: new Prisma.Decimal(r.rate),
            nominal: r.nominal || 1,
            source: 'CBU',
          },
        });
        result.upserted += 1;
      } catch (err) {
        result.skipped += 1;
        result.errors.push(
          `${r.code} ${r.date}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  },

  /**
   * Возвращает курс на указанную дату. Если точного совпадения нет —
   * возьмёт ближайший более ранний (курс ЦБ действует до следующей котировки).
   * Нормализует значение к "курсу за 1 единицу валюты" (делит на nominal).
   */
  async findRate(
    date: Date | string,
    currency: VedCurrency | string,
  ): Promise<{ rate: number; sourceDate: string } | null> {
    const target = atUtcMidnight(date);

    const row = await prisma.exchangeRate.findFirst({
      where: {
        currency,
        date: { lte: target },
      },
      orderBy: { date: 'desc' },
    });
    if (!row) return null;

    const rate = Number(row.rate) / (row.nominal || 1);
    const sourceDate = row.date.toISOString().slice(0, 10);
    return { rate, sourceDate };
  },

  /**
   * Выборка истории курсов за диапазон (для UI/отчётов).
   */
  async listRange(params: {
    from?: Date | string;
    to?: Date | string;
    currencies?: string[];
    limit?: number;
  }) {
    const where: Prisma.ExchangeRateWhereInput = {};
    if (params.from || params.to) {
      where.date = {};
      if (params.from) (where.date as Prisma.DateTimeFilter).gte = atUtcMidnight(params.from);
      if (params.to) (where.date as Prisma.DateTimeFilter).lte = atUtcMidnight(params.to);
    }
    if (params.currencies && params.currencies.length > 0) {
      where.currency = { in: params.currencies };
    }

    const rows = await prisma.exchangeRate.findMany({
      where,
      orderBy: [{ date: 'desc' }, { currency: 'asc' }],
      take: params.limit ?? 200,
    });

    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      currency: r.currency,
      rate: Number(r.rate),
      nominal: r.nominal,
      source: r.source,
    }));
  },

  /** Есть ли запись за конкретную дату (используется планировщиком при старте). */
  async hasRatesForDate(date: Date | string): Promise<boolean> {
    const count = await prisma.exchangeRate.count({
      where: { date: atUtcMidnight(date) },
    });
    return count > 0;
  },

  VED_CURRENCIES,
};
