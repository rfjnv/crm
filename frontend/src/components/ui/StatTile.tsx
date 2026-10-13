import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatPercent } from '../../utils/currency';
import Eyebrow from './Eyebrow';
import StatusPill from './StatusPill';
import './StatTile.css';

interface Props {
  label: ReactNode;
  /** Число: строка, `<Money variant="compact" />`, счётчик. */
  value: ReactNode;
  /**
   * `hero` — одно главное число страницы (40/600), подпись eyebrow;
   * `stat` — число 20/600 под подписью;
   * `row` — строка списка 44px: подпись слева, число справа (как строка панели профиля).
   */
  size?: 'hero' | 'stat' | 'row';
  /** База сравнения или контекст строкой Caption: «вчера 12,4 млн · месяц 681 млн». */
  base?: ReactNode;
  /** Изменение в процентах; `null`/`undefined` — ничего не рисуется и место не резервируется. */
  delta?: number | null;
  /** Переход по клику. Без него плитка не ссылка. */
  to?: string;
  /** Что-то под числом во всю ширину (бар цели). */
  footer?: ReactNode;
  className?: string;
}

function deltaTone(delta: number) {
  if (Math.abs(delta) < 0.05) return 'neutral' as const;
  return delta > 0 ? ('positive' as const) : ('negative' as const);
}

/** Число с подписью, базой и дельтой (DASHBOARD.md §4, §6). */
export default function StatTile({ label, value, size = 'stat', base, delta, to, footer, className }: Props) {
  const classes = ['ui-stat', `ui-stat--${size}`, to ? 'ui-stat--link' : '', className ?? ''].filter(Boolean).join(' ');
  const deltaPill =
    delta != null && Number.isFinite(delta) ? (
      <StatusPill tone={deltaTone(delta)} className="ui-stat__delta">
        {formatPercent(delta, 1, { signed: true })}
      </StatusPill>
    ) : null;

  const content =
    size === 'row' ? (
      <>
        <span className="ui-stat__text">
          <span className="ui-stat__label">{label}</span>
          {base != null && <span className="ui-stat__base">{base}</span>}
        </span>
        <span className="ui-stat__value">{value}</span>
        {deltaPill}
      </>
    ) : (
      <>
        {size === 'hero' ? <Eyebrow className="ui-stat__label">{label}</Eyebrow> : <span className="ui-stat__label">{label}</span>}
        <span className="ui-stat__line">
          <span className="ui-stat__value">{value}</span>
          {deltaPill}
        </span>
        {base != null && <span className="ui-stat__base">{base}</span>}
        {footer != null && <span className="ui-stat__footer">{footer}</span>}
      </>
    );

  return to ? (
    <Link className={classes} to={to}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  );
}

interface GridProps {
  children: ReactNode;
  /** Сколько колонок на широком экране; на телефоне — одна. */
  columns?: 1 | 2 | 3 | 4;
  /** Строки `size="row"` друг под другом через тонкие разделители. */
  list?: boolean;
  className?: string;
}

/** Сетка плиток или список строк-показателей. */
export function StatGrid({ children, columns = 3, list, className }: GridProps) {
  const classes = ['ui-stat-grid', list ? 'ui-stat-grid--list' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={classes} data-columns={list ? undefined : columns}>
      {children}
    </div>
  );
}
