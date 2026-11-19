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
  { competitor: 'Yann', date: '2026-11-01' },
  { competitor: 'Bit Trade', date: null, note: 'старый прайс, внесён до 22.04.2026' },
  { competitor: 'Avanta Trade', date: '2026-10-13' },
  { competitor: 'Foil Trading', date: '2026-09-21', note: 'прайс от 21.09 прислан повторно 18.11 — цены те же' },
  { competitor: 'Paper World', date: '2026-10-02', scope: 'мелованная бумага' },
  { competitor: 'Paper World', date: '2026-09-18', scope: 'картон' },
  { competitor: 'Paper World', date: '2026-10-24', scope: 'плёнка и гребёнки' },
  { competitor: 'AVA-TEN', date: '2026-10-20' },
  { competitor: 'Alfa Karton Savdo', date: '2026-10-12' },
  { competitor: 'Poytaxt Group', date: '2026-11-01', scope: 'бумага и самоклейка', note: 'прайс «Ноябрь 2026»' },
  { competitor: 'Poytaxt Group', date: '2026-10-19', scope: 'картон и лайнеры' },
  { competitor: 'Mars Paper', date: '2026-11-01', note: 'прайс «Ноябрь 2026»' },
  { competitor: 'Poli Text', date: '2026-11-18', scope: 'пустые пластины', note: 'дата в прайсе не указана — день получения' },
  { competitor: 'Al-Zuben', date: '2026-10-26', scope: 'дизайнерская и цифровая бумага', note: 'оптовые цены с НДС (опт от 3 млн сум)' },
];
