import { exchangeRatesService } from './exchange-rates.service';

/**
 * Общая утилита конвертации суммы в UZS по курсу ЦБ на заданную дату.
 * Источник истины — таблица exchange_rates (MVP-3).
 *
 * Поведение:
 *  - UZS (или пустое значение валюты) → {amountUzs: amount, rate: 1}
 *  - Для остальных валют — берём ближайший курс ≤ date. Если курса нет — возвращаем null.
 */
export interface ConversionResult {
  amountUzs: number;
  rate: number;
  sourceDate: string;
}

export const moneyService = {
  isBase(currency: string | null | undefined): boolean {
    return !currency || currency === 'UZS';
  },

  /**
   * Конвертирует (amount, currency) в UZS по курсу ЦБ на указанную дату.
   * Возвращает null, если курса не найдено (и валюта ≠ UZS).
   */
  async toUzs(
    amount: number | string,
    currency: string | null | undefined,
    date: Date | string,
  ): Promise<ConversionResult | null> {
    const num = Number(amount);
    if (!Number.isFinite(num)) return null;

    if (this.isBase(currency)) {
      return {
        amountUzs: Number(num.toFixed(2)),
        rate: 1,
        sourceDate:
          typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10),
      };
    }

    const found = await exchangeRatesService.findRate(date, currency as string);
    if (!found) return null;

    return {
      amountUzs: Number((num * found.rate).toFixed(2)),
      rate: Number(found.rate.toFixed(6)),
      sourceDate: found.sourceDate,
    };
  },

  /**
   * Применяет готовый курс (без обращения к БД). Используется, когда invoiceRate у
   * ImportOrder уже зафиксирован и мы не хотим снова лезть в exchange_rates.
   */
  applyRate(amount: number | string, rate: number | string | null | undefined): number | null {
    const num = Number(amount);
    const r = rate == null ? null : Number(rate);
    if (!Number.isFinite(num)) return null;
    if (r == null || !Number.isFinite(r)) return null;
    return Number((num * r).toFixed(2));
  },
};
