import { notification } from 'antd';

/**
 * Ошибка «нет доступа к деньгам» от сервера (User.moneyAccess).
 *
 * Сервер закрывает денежные разделы ответом 403 с кодом MONEY_ACCESS_DENIED.
 * Без отдельной обработки страница просто показывала бы «Нет данных» или пустую
 * таблицу — и человек не понимал бы, что дело в правах, а не в данных.
 */
export const MONEY_ACCESS_DENIED = 'MONEY_ACCESS_DENIED';

export const MONEY_ACCESS_TITLE = 'Нет доступа';
export const MONEY_ACCESS_TEXT = 'У вас нет доступа к финансовым данным в этом разделе. Обратитесь к администратору.';

export function isMoneyAccessDenied(error: unknown): boolean {
  const res = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  return res?.status === 403 && res.data?.code === MONEY_ACCESS_DENIED;
}

/**
 * Показать уведомление о нехватке прав. Один ключ — одно уведомление на экране,
 * даже если на странице упало сразу несколько запросов.
 */
export function notifyMoneyAccessDenied(): void {
  notification.warning({
    key: 'money-access-denied',
    message: MONEY_ACCESS_TITLE,
    description: MONEY_ACCESS_TEXT,
    placement: 'topRight',
  });
}
