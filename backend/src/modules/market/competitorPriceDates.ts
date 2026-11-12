import type { Competitor } from './uniqueProductsComparisonData';

/**
 * Дата прайса, по которому внесены цены конкурента. Обновлять вместе с ценами
 * (price_comparison_polygraph.html, uniqueProductsComparisonData.ts), иначе страница покажет старую дату.
 * У Paper World цены из разных прайсов — по одной строке на каждый.
 */
export type CompetitorPriceDate = {
  competitor: Competitor;
  /** ГГГГ-ММ-ДД; null — дата прайса неизвестна. */
  date: string | null;
  /** Какие товары из этого прайса, если у конкурента их несколько. */
  scope?: string;
  note?: string;
};

export const COMPETITOR_PRICE_DATES: CompetitorPriceDate[] = [
  { competitor: 'Yann', date: '2026-09-07' },
  { competitor: 'Bit Trade', date: null, note: 'старый прайс, внесён до 22.04.2026' },
  { competitor: 'Avanta Trade', date: '2026-10-13' },
  { competitor: 'Foil Trading', date: '2026-09-21' },
  { competitor: 'Paper World', date: '2026-10-02', scope: 'мелованная бумага' },
  { competitor: 'Paper World', date: '2026-09-18', scope: 'картон' },
  { competitor: 'Paper World', date: '2026-06-15', scope: 'плёнка и гребёнки' },
  { competitor: 'AVA-TEN', date: '2026-10-20' },
  { competitor: 'Alfa Karton Savdo', date: '2026-10-12' },
  { competitor: 'Poytaxt Group', date: '2026-10-19' },
  { competitor: 'Mars Paper', date: '2026-10-30', note: 'скриншоты прайса' },
];
