import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, theme } from 'antd';
import { CloseOutlined, ProjectOutlined } from '@ant-design/icons';
import { notificationsApi } from '../api/notifications.api';
import { APP_BUTTON } from './ui/AppClassNames';
import type { AppNotification } from '../types';

/** Первая строка задачи из тела уведомления: «От: …\n• Название — до 12.10». */
function firstTaskLine(n: AppNotification): string {
  const line = n.body.split('\n').find((l) => l.startsWith('• '));
  return line ? line.slice(2) : n.body;
}

/**
 * Полоса под шапкой на любой странице, пока есть непрочитанные уведомления
 * по задачам (новая задача, изменён срок). Уходит, когда человек открыл
 * «Задачи» или закрыл её крестиком.
 */
export default function TaskAlertBar({ top }: { top: number | string }) {
  const { token: tk } = theme.useToken();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();

  // Тот же запрос, что у колокольчика, — общий кэш, лишних запросов нет.
  const { data } = useQuery({
    queryKey: ['notifications-recent'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    refetchInterval: 30_000,
  });
  const unread = (data?.items ?? []).filter((n) => !n.isRead && n.link === '/tasks');

  const markRead = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => notificationsApi.markRead(id))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const ids = unread.map((n) => n.id).join(',');
  const onTasksPage = pathname === '/tasks';
  useEffect(() => {
    if (onTasksPage && ids && !markRead.isPending) markRead.mutate(ids.split(','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTasksPage, ids]);

  if (!unread.length || onTasksPage) return null;

  const latest = unread[0];
  const text = unread.length === 1
    ? `${latest.title}: ${firstTaskLine(latest)}`
    : `Новое по задачам: ${unread.length} — ${latest.title.toLowerCase()}: ${firstTaskLine(latest)}`;

  return (
    <div
      role="alert"
      className="task-alert-bar"
      style={{
        position: 'sticky',
        top,
        zIndex: 98,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px 6px 16px',
        background: tk.colorWarningBg,
        borderBottom: `1px solid ${tk.colorWarningBorder}`,
        color: tk.colorText,
        fontSize: 13,
        lineHeight: '20px',
        overflow: 'hidden',
      }}
    >
      <ProjectOutlined style={{ color: tk.colorWarning, fontSize: 16, flexShrink: 0 }} />
      <span
        onClick={() => navigate('/tasks')}
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
        title={latest.body}
      >
        {text}
      </span>
      <Button size="small" type="primary" className={APP_BUTTON} onClick={() => navigate('/tasks')} style={{ flexShrink: 0 }}>
        Открыть задачи
      </Button>
      <Button
        size="small"
        type="text"
        className={APP_BUTTON}
        icon={<CloseOutlined />}
        aria-label="Скрыть"
        onClick={() => markRead.mutate(unread.map((n) => n.id))}
        style={{ flexShrink: 0 }}
      />
      <style>{`
        .task-alert-bar::before {
          content: '';
          position: absolute;
          left: 0; right: 0; top: 0;
          height: 3px;
          background: linear-gradient(90deg, transparent, ${tk.colorWarning}, transparent);
          background-size: 50% 100%;
          background-repeat: no-repeat;
          animation: taskAlertSweep 2.4s linear infinite;
        }
        @keyframes taskAlertSweep {
          from { background-position: -100% 0; }
          to { background-position: 200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .task-alert-bar::before { animation: none; background: ${tk.colorWarning}; }
        }
      `}</style>
    </div>
  );
}
