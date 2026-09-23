import { useState } from 'react';
import { Alert } from 'antd';
import { useAuthStore } from '../store/authStore';
import { HIDDEN_MONEY } from '../utils/currency';

const DISMISS_KEY = 'money-access-banner-dismissed';

/**
 * Пояснение для сотрудника с ограниченным доступом к деньгам: откуда на страницах
 * «•••» вместо сумм. Без него маска выглядит как баг или «нет данных».
 * Закрывается до конца сессии браузера.
 */
export default function MoneyAccessBanner() {
  const level = useAuthStore((s) => s.user?.moneyAccess ?? 'FULL');
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (level === 'FULL' || dismissed) return null;

  const what = level === 'NONE'
    ? 'Суммы сделок, оплаты, долги и выручка'
    : 'Закупочные цены, выручка, касса и KPI';

  return (
    <Alert
      type="info"
      showIcon
      closable
      style={{ marginBottom: 16 }}
      message="Ограниченный доступ к финансовым данным"
      description={`${what} скрыты (${HIDDEN_MONEY}), некоторые разделы недоступны. Если эти данные нужны для работы — обратитесь к администратору.`}
      onClose={() => {
        try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* приватный режим */ }
        setDismissed(true);
      }}
    />
  );
}
