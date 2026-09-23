import type { ReactNode } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Button, Result } from 'antd';
import { useAuthStore } from '../store/authStore';
import { MONEY_ACCESS_TEXT, MONEY_ACCESS_TITLE } from '../lib/moneyAccess';

/**
 * Страницы, которые целиком состоят из денег (выручка, касса, аналитика, расходы).
 * Сотруднику с ограниченным доступом к деньгам показываем понятный экран вместо
 * пустой страницы: сервер всё равно ответит 403, и без этого человек видел бы
 * «Нет данных» и не понимал бы, что дело в правах.
 *
 * Список маршрутов должен совпадать со STRATEGIC_PATHS в backend/src/lib/moneyAccess.ts.
 */
export default function MoneyAccessGuard({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const level = useAuthStore((s) => s.user?.moneyAccess ?? 'FULL');

  if (level === 'FULL') return <>{children ?? <Outlet />}</>;

  return (
    <Result
      status="403"
      title={MONEY_ACCESS_TITLE}
      subTitle={MONEY_ACCESS_TEXT}
      extra={<Button type="primary" onClick={() => navigate('/dashboard')}>На главную</Button>}
    />
  );
}
