import client from './client';

export type MatchType = 'Точное' | 'Потенциальное';

export type Competitor = 'Yann' | 'Bit Trade' | 'Avanta Trade' | 'Foil Trading';

/** Строка сравнения; наша цена уже взята из каталога CRM на сервере. */
export type LivePriceRow = {
  key: string;
  category: string;
  ourProduct: string;
  competitorProduct: string;
  competitor: Competitor;
  ourPrice: number;
  competitorPrice: number | null;
  matchType: MatchType;
  /** false — цены нет в каталоге, показана цена из прайса. */
  ourPriceFromCatalog: boolean;
  /** Разброс цен, если строка покрывает несколько позиций каталога. */
  ourPriceRange: [number, number] | null;
};

export type TheirOnlyRow = {
  key: string;
  competitor: Competitor;
  category: string;
  name: string;
  price: number | null;
};

export type OurOnlyRow = {
  key: string;
  category: string;
  name: string;
  price: string;
  note?: string;
};

export interface MarketComparison {
  priceRows: LivePriceRow[];
  theirOnly: TheirOnlyRow[];
  ourOnly: OurOnlyRow[];
}

export const marketApi = {
  comparison: () => client.get<MarketComparison>('/market/comparison').then((r) => r.data),
};
