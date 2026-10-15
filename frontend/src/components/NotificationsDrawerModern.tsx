import { useState, type ReactNode } from 'react';
import { Button, Drawer, Segmented } from 'antd';
import { BellSlash, CaretRight, Check, Checks, Info, Warning, WarningOctagon } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import type { AppNotification, NotificationSeverity } from '../types';
import { getFirstName } from '../lib/name-utils';
import { useIsMobile } from '../hooks/useIsMobile';
import './NotificationsDrawerModern.css';

type Filter = 'all' | 'unread' | 'important';

const SEVERITY: Record<NotificationSeverity, { icon: ReactNode; label: string }> = {
  INFO: { icon: <Info size={18} weight="bold" />, label: 'Инфо' },
  WARNING: { icon: <Warning size={18} weight="bold" />, label: 'Важно' },
  URGENT: { icon: <WarningOctagon size={18} weight="bold" />, label: 'Срочно' },
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
  open: boolean;
  onClose: () => void;
  items: AppNotification[];
  unreadCount: number;
  onOpenItem: (n: AppNotification) => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
  markAllPending: boolean;
  onOpenAll: () => void;
}

/**
 * Шторка уведомлений нового дизайна: фильтр «Все / Новые / Важные», группы по дням,
 * у каждого уведомления — значок важности, время и кнопка «прочитано» без перехода.
 */
export default function NotificationsDrawerModern({
  open, onClose, items, unreadCount, onOpenItem, onMarkRead, onMarkAll, markAllPending, onOpenAll,
}: Props) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>('all');
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

  return (
    <Drawer
      rootClassName="ntf-drawer"
      placement="right"
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 420}
      closable={false}
      title={null}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
    >
      <div className="ntf-head">
        <div className="ntf-head__row">
          <div className="ntf-head__title">
            Уведомления
            {unreadCount > 0 && <span className="ntf-head__count">{unreadCount} новых</span>}
          </div>
          <div className="ntf-head__actions">
            {unreadCount > 0 && (
              <Button
                type="text"
                size="small"
                className="ntf-head__all"
                icon={<Checks size={16} weight="bold" />}
                loading={markAllPending}
                onClick={onMarkAll}
                aria-label="Прочитать все"
                title="Прочитать все"
              >
                <span className="ntf-head__all-text">Прочитать все</span>
              </Button>
            )}
            <button type="button" className="ntf-head__close" aria-label="Закрыть" onClick={onClose}>×</button>
          </div>
        </div>
        <Segmented<Filter>
          block
          size="small"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'unread', label: unreadInList ? `Новые · ${unreadInList}` : 'Новые' },
            { value: 'important', label: importantCount ? `Важные · ${importantCount}` : 'Важные' },
          ]}
        />
      </div>

      <div className="ntf-list">
        {groups.length === 0 && (
          <div className="ntf-empty">
            <BellSlash size={32} />
            <span>{filter === 'all' ? 'Уведомлений пока нет' : filter === 'unread' ? 'Всё прочитано' : 'Важных уведомлений нет'}</span>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="ntf-group">
            <div className="ntf-group__label">{g.label}</div>
            {g.items.map((n) => {
              const sev = SEVERITY[n.severity];
              const author = n.createdBy ? getFirstName(n.createdBy.fullName) || n.createdBy.fullName : null;
              return (
                <div
                  key={n.id}
                  className={`ntf-item${n.isRead ? '' : ' ntf-item--unread'}${n.link ? ' ntf-item--link' : ''}`}
                  data-severity={n.severity}
                  role={n.link ? 'link' : undefined}
                  tabIndex={0}
                  onClick={() => onOpenItem(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpenItem(n);
                  }}
                >
                  <span className="ntf-item__icon" title={sev.label}>{sev.icon}</span>
                  <div className="ntf-item__main">
                    <div className="ntf-item__top">
                      <span className="ntf-item__title">{n.title}</span>
                      <span className="ntf-item__time">{timeLabel(n.createdAt)}</span>
                    </div>
                    {n.body && <div className="ntf-item__body">{n.body}</div>}
                    {(author || n.severity !== 'INFO') && (
                      <div className="ntf-item__meta">
                        {n.severity !== 'INFO' && <span className="ntf-item__sev">{sev.label}</span>}
                        {author && <span>{author}</span>}
                      </div>
                    )}
                  </div>
                  <div className="ntf-item__side">
                    {!n.isRead && (
                      <button
                        type="button"
                        className="ntf-item__read"
                        title="Отметить прочитанным"
                        aria-label="Отметить прочитанным"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMarkRead(n.id);
                        }}
                      >
                        <span className="ntf-item__dot" />
                        <Check size={14} weight="bold" className="ntf-item__check" />
                      </button>
                    )}
                    {n.link && <CaretRight size={14} className="ntf-item__caret" />}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <div className="ntf-foot">
        <Button block onClick={onOpenAll}>Все уведомления</Button>
      </div>
    </Drawer>
  );
}
