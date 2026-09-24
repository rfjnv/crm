import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { INTERNAL_COMPANY_NAME } from '../../lib/analytics';
import { CATALOG_LINKS, normalizeSku, resolveOurPrice } from './marketCatalogLinks';
import { PRICE_ROWS, type PriceRow } from './priceComparisonData';
import { OUR_ONLY_ROWS, THEIR_ONLY_ROWS } from './uniqueProductsComparisonData';

/** Строка сравнения с нашей ценой, взятой из каталога CRM (см. marketCatalogLinks.ts). */
export type LivePriceRow = PriceRow & {
  /** false — цены нет в каталоге, показана цена из прайса. */
  ourPriceFromCatalog: boolean;
  /** Разброс цен, если строка покрывает несколько позиций каталога. */
  ourPriceRange: [number, number] | null;
};

/**
 * Какие товары каталога участвуют в сравнении.
 *
 * Страница «Анализ рынка» видит тот же каталог, что и склад у этого пользователя
 * (SUPER_ADMIN — все компании). Агенту нужна только наша торговля, без внутренней
 * компании: у неё свои артикулы, и они сбили бы «самую частую» цену.
 */
export type CatalogScope =
  | { kind: 'viewer'; role: string; companyId?: string | null }
  | { kind: 'trading' };

function catalogWhere(scope: CatalogScope): Prisma.ProductWhereInput {
  if (scope.kind === 'trading') {
    return { OR: [{ companyId: null }, { company: { name: { not: INTERNAL_COMPANY_NAME } } }] };
  }
  return scope.role !== 'SUPER_ADMIN' && scope.companyId ? { companyId: scope.companyId } : {};
}

/** Цены продажи активных товаров по нормализованному артикулу. */
export async function loadPriceBySku(scope: CatalogScope): Promise<Map<string, number>> {
  const products = await prisma.product.findMany({
    where: { ...catalogWhere(scope), isActive: true },
    select: { sku: true, salePrice: true },
  });
  const priceBySku = new Map<string, number>();
  for (const p of products) {
    const price = p.salePrice != null ? Number(p.salePrice) : NaN;
    if (price > 0) priceBySku.set(normalizeSku(p.sku), price);
  }
  return priceBySku;
}

export function livePriceRows(priceBySku: Map<string, number>): LivePriceRow[] {
  return PRICE_ROWS.map((r) => {
    const live = resolveOurPrice(r.ourProduct, r.ourPrice, priceBySku);
    return { ...r, ourPrice: live.price, ourPriceFromCatalog: live.fromCatalog, ourPriceRange: live.range };
  });
}

/** Всё для страницы «Анализ рынка»: сравнение цен с живыми ценами каталога и уникальные товары. */
export async function getMarketComparison(scope: CatalogScope) {
  const priceBySku = await loadPriceBySku(scope);
  return {
    priceRows: livePriceRows(priceBySku),
    theirOnly: THEIR_ONLY_ROWS,
    ourOnly: OUR_ONLY_ROWS,
  };
}

/** Артикулы каталога, привязанные к строке «наш товар» (пусто, если связи нет). */
export function linkedSkus(ourProduct: string): string[] {
  return CATALOG_LINKS[ourProduct]?.skus ?? [];
}
