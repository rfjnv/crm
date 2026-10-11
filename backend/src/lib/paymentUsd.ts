import { AppError } from './errors';

/**
 * Долларовая часть оплаты. На сделку всегда засчитывается amount в сумах; если клиент
 * отдал часть денег долларами, храним сколько $ и по какому курсу, чтобы касса видела
 * сумы и доллары раздельно — как в кассовой книге.
 */
export interface UsdPart {
  usdAmount: number;
  usdRate: number;
  usdUzs: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * null — долларовой части нет. Ошибка, если задано только одно поле или доллары намного
 * больше суммы оплаты.
 *
 * Доллары могут быть и больше суммы: клиент дал $300 (3 600 000), ему вернули сдачу
 * 475 000 сумами, на сделку засчитано 3 125 000. Тогда сумовая часть отрицательная — это
 * и есть сдача, ушедшая из кассы. Сдача больше половины долларовой суммы — почти наверняка
 * опечатка (лишний ноль в $ или курсе), её не пропускаем.
 */
export function resolveUsdPart(
  amount: number,
  usdAmount: number | null | undefined,
  usdRate: number | null | undefined,
): UsdPart | null {
  const hasAmount = usdAmount != null;
  const hasRate = usdRate != null;
  if (!hasAmount && !hasRate) return null;
  if (!hasAmount || !hasRate) {
    throw new AppError(400, 'Для оплаты в долларах укажите и сумму в $, и курс');
  }
  const usdUzs = round2(usdAmount * usdRate);
  if (usdUzs - amount > usdUzs / 2) {
    throw new AppError(400, 'Доллары по этому курсу намного больше суммы оплаты — проверьте сумму в $ и курс');
  }
  return { usdAmount: round2(usdAmount), usdRate: round2(usdRate), usdUzs };
}

/** Поля Prisma: снять долларовую часть или записать новую. */
export function usdPartData(part: UsdPart | null) {
  return part
    ? { usdAmount: part.usdAmount, usdRate: part.usdRate, usdUzs: part.usdUzs }
    : { usdAmount: null, usdRate: null, usdUzs: null };
}
