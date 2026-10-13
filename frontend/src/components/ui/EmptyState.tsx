import type { ReactNode } from 'react';
import './EmptyState.css';

interface Props {
  /** Одна строка: что случилось и когда — «Нет продаж за 13.10». */
  children: ReactNode;
  /** Действие рядом, если есть куда идти — «Показать вчера». */
  action?: ReactNode;
  className?: string;
}

/**
 * Пустое состояние — одна строка Caption без картинки и минимальной высоты
 * (DASHBOARD.md §4): ноль сообщается один раз и тихо.
 */
export default function EmptyState({ children, action, className }: Props) {
  return (
    <div className={className ? `ui-empty ${className}` : 'ui-empty'}>
      <span className="ui-empty__text">{children}</span>
      {action != null && <span className="ui-empty__action">{action}</span>}
    </div>
  );
}
