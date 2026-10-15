import { useState, type ReactNode } from 'react';
import { BellSlash, CaretRight, Check, Checks, Info, Warning, WarningOctagon } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import type { AppNotification, NotificationSeverity } from '../types';
import { getFirstName } from '../lib/name-utils';
import { useHoverGlider } from '../hooks/useHoverGlider';
import './NotificationsPanel.css';

type Filter = 'all' | 'unread' | 'important';

const SEVERITY: Record<NotificationSeverity, { icon: ReactNode; label: string }> = {
  INFO: { icon: <Info size={16} weight="bold" />, label: 'Инфо' },
  WARNING: { icon: <Warning size={16} weight="bold" />, label: 'Важно' },
  URGENT: { icon: <WarningOctagon size={16} weight="bold" />, label: 'Срочно' },
};

/** Сегодня → «14:20», вчера → «вчера, 14:20», раньше → «12 окт». */
function timeLabel(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return d.format('HH:mm');
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return `вчера, ${d.format('HH:mm')}`;
  return d.locale('ru').format(d.isSame(dayjs(), 'year') ? 'D MMM' : 'D MMM YYYY');
}

function groupLabel(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return 'Сегодня';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Вчера';
  return 'Ранее';
}

interface Props {
  items: AppNotification[];
  unreadCount: number;
  onOpenItem: (n: AppNotification) => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
  onOpenAll: () => void;
}

/**
 * Уведомления нового дизайна — стеклянная панель под колокольчиком, как панель профиля
 * (`hdr-panel` в glass.css): фильтры-«таблетки», группы по дням, подсветка-«глайдер».
 */
export default function NotificationsPanel({ items, unreadCount, onOpenItem, onMarkRead, onMarkAll, onOpenAll }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const { ref: listRef, style: listGlider } = useHoverGlider<HTMLDivElement>('.ntf-row');
  const { ref: footRef, style: footGlider } = useHoverGlider<HTMLDivElement>('.hdr-panel__row--action');
  const unreadInList = items.filter((n) => !n.isRead).length;
  const importantCount = items.filter((n) => n.severity !== 'INFO').length;

  const visible = items.filter((n) =>
    filter === 'unread' ? !n.isRead : filter === 'important' ? n.severity !== 'INFO' : true);
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const n of visible) {
    const label = groupLabel(n.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }

  const chips: { value: Filter; label: string; count?: number }[] = [
    { value: 'all', label: 'Все' },
    { value: 'unread', label: 'Новые', count: unreadInList },
    { value: 'important', label: 'Важные', count: importantCount },
  ];

  return (
    <div className="hdr-panel ntf-panel">
      <div className="ntf-panel__head">
        <span className="hdr-panel__name">Уведомления</span>
        {unreadCount > 0 && <span className="ntf-panel__count">{unreadCount}</span>}
        {unreadCount > 0 && (
          <button type="button" className="ntf-panel__all" onClick={onMarkAll} title="Отметить все прочитанными">
            <Checks size={16} weight="bold" />
            <span>Прочитать все</span>
          </button>
        )}
      </div>

      <div className="ntf-chips" role="tablist" aria-label="Фильтр уведомлений">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={filter === c.value}
            className={`ntf-chip${filter === c.value ? ' ntf-chip--active' : ''}`}
            onClick={() => setFilter(c.value)}
          >
            {c.label}
            {!!c.count && <span className="ntf-chip__count">{c.count}</span>}
          </button>
        ))}
      </div>

      <div className="ntf-scroll" ref={listRef}>
        <span className="hover-glider" style={listGlider} aria-hidden />
        {groups.length === 0 && (
          <div className="ntf-empty">
            <BellSlash size={28} />
            <span>{filter === 'all' ? 'Уведомлений пока нет' : filter === 'unread' ? 'Всё прочитано' : 'Важных уведомлений нет'}</span>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label}>
            <div className="ntf-group">{g.label}</div>
            {g.items.map((n) => {
              const sev = SEVERITY[n.severity];
              const author = n.createdBy ? getFirstName(n.createdBy.fullName) || n.createdBy.fullName : null;
              return (
                <div
                  key={n.id}
                  className={`ntf-row${n.isRead ? '' : ' ntf-row--unread'}${n.link ? ' ntf-row--link' : ''}`}
                  data-severity={n.severity}
                  role={n.link ? 'link' : undefined}
                  tabIndex={0}
                  onClick={() => onOpenItem(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpenItem(n);
                  }}
                >
                  <span className="ntf-row__icon" title={sev.label}>{sev.icon}</span>
                  <div className="ntf-row__main">
                    <div className="ntf-row__top">
                      <span className="ntf-row__title">{n.title}</span>
                      <span className="ntf-row__time">{timeLabel(n.createdAt)}</span>
                    </div>
                    {n.body && <div className="ntf-row__body">{n.body}</div>}
                    {(author || n.severity !== 'INFO') && (
                      <div className="ntf-row__meta">
                        {n.severity !== 'INFO' && <span className="ntf-row__sev">{sev.label}</span>}
                        {author && <span>{author}</span>}
                      </div>
                    )}
                  </div>
                  {!n.isRead && (
                    <button
                      type="button"
                      className="ntf-row__read"
                      title="Отметить прочитанным"
                      aria-label="Отметить прочитанным"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkRead(n.id);
                      }}
                    >
                      <span className="ntf-row__dot" />
                      <Check size={14} weight="bold" className="ntf-row__check" />
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <div className="hdr-panel__group ntf-panel__foot" ref={footRef}>
        <span className="hover-glider" style={footGlider} aria-hidden />
        <button type="button" className="hdr-panel__row hdr-panel__row--action" onClick={onOpenAll}>
          <span className="hdr-panel__label">Все уведомления</span>
          <CaretRight size={14} className="ntf-panel__caret" />
        </button>
      </div>
    </div>
  );
}
