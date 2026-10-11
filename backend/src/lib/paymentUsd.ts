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

/** null — долларовой части нет. Ошибка, если задано только одно поле или $ больше всей суммы. */
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
  // Допуск в 1 сум — округление курса.
  if (usdUzs > amount + 1) {
    throw new AppError(400, 'Долларовая часть больше всей суммы оплаты — проверьте сумму в $ и курс');
  }
  return { usdAmount: round2(usdAmount), usdRate: round2(usdRate), usdUzs };
}

/** Поля Prisma: снять долларовую часть или записать новую. */
export function usdPartData(part: UsdPart | null) {
  return part
    ? { usdAmount: part.usdAmount, usdRate: part.usdRate, usdUzs: part.usdUzs }
    : { usdAmount: null, usdRate: null, usdUzs: null };
}
