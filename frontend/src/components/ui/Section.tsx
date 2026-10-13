import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import Eyebrow from './Eyebrow';
import './Section.css';

interface SectionAction {
  label: ReactNode;
  /** Переход внутри приложения. */
  to?: string;
  onClick?: () => void;
}

interface Props {
  /** Заголовок секции — eyebrow. */
  title?: ReactNode;
  /** Счётчик рядом с заголовком: «Остатки · 72». */
  count?: ReactNode;
  /** Действие секции справа: «Все 72 ›». */
  action?: SectionAction;
  /** Свой контент справа в заголовке (бар цели, сегмент) — вместо или вместе с действием. */
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Без собственной подложки — секция внутри другой поверхности (через hairline). */
  flat?: boolean;
}

/**
 * Группа внутри окна (уровень B, DASHBOARD.md §3): eyebrow + счётчик + действие и содержимое.
 * В новом дизайне — подложка --fill-1, радиус 16, без рамки и тени.
 */
export default function Section({ title, count, action, extra, children, className, flat }: Props) {
  const classes = ['ui-section', flat ? 'ui-section--flat' : '', className ?? ''].filter(Boolean).join(' ');
  const hasHead = title != null || count != null || action != null || extra != null;
  return (
    <section className={classes}>
      {hasHead && (
        <header className="ui-section__head">
          {title != null && <Eyebrow className="ui-section__title">{title}</Eyebrow>}
          {count != null && <span className="ui-section__count">{count}</span>}
          <span className="ui-section__spacer" />
          {extra}
          {action && <SectionActionLink action={action} />}
        </header>
      )}
      {children != null && <div className="ui-section__body">{children}</div>}
    </section>
  );
}

function SectionActionLink({ action }: { action: SectionAction }) {
  const content = (
    <>
      <span>{action.label}</span>
      <CaretRight size={14} aria-hidden />
    </>
  );
  if (action.to) {
    return (
      <Link className="ui-section__action" to={action.to} onClick={action.onClick}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className="ui-section__action" onClick={action.onClick}>
      {content}
    </button>
  );
}
