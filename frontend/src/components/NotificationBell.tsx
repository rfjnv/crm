import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Drawer, List, Typography, Tag, Space, theme, Modal } from 'antd';
import {
  BellOutlined, InfoCircleOutlined, WarningOutlined, ExclamationCircleOutlined,
  CheckOutlined, RightOutlined,
} from '@ant-design/icons';
import { notificationsApi } from '../api/notifications.api';
import type { AppNotification, NotificationSeverity } from '../types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';

dayjs.extend(relativeTime);
dayjs.locale('ru');

const severityConfig: Record<NotificationSeverity, { icon: React.ReactNode; color: string; label: string; bg: string }> = {
  INFO: { icon: <InfoCircleOutlined />, color: '#1677ff', label: 'Инфо', bg: 'rgba(22,119,255,0.06)' },
  WARNING: { icon: <WarningOutlined />, color: '#fa8c16', label: 'Важно', bg: 'rgba(250,140,22,0.08)' },
  URGENT: { icon: <ExclamationCircleOutlined />, color: '#ff4d4f', label: 'Срочно', bg: 'rgba(255,77,79,0.10)' },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token: themeToken } = theme.useToken();
  const prevUrgentIdsRef = useRef<Set<string>>(new Set());

  const { data: countData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: notificationsApi.getUnreadCount,
    refetchInterval: 10_000,
  });

  const { data: recentData } = useQuery({
    queryKey: ['notifications-recent'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    refetchInterval: 10_000,
  });

  // Show modal for new URGENT notifications
  useEffect(() => {
    if (!recentData?.items) return;
    const urgentUnread = recentData.items.filter(
      (n: AppNotification) => n.severity === 'URGENT' && !n.isRead,
    );
    const newUrgent = urgentUnread.filter(
      (n: AppNotification) => !prevUrgentIdsRef.current.has(n.id),
    );
    if (newUrgent.length > 0) {
      const latest = newUrgent[0];
      Modal.warning({
        title: latest.title,
        content: latest.body,
        okText: latest.link ? 'Перейти' : 'OK',
        onOk: () => {
          if (latest.link) navigate(latest.link);
          markReadMut.mutate(latest.id);
        },
        centered: true,
      });
    }
    prevUrgentIdsRef.current = new Set(urgentUnread.map((n: AppNotification) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentData]);

  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleClick = (notification: AppNotification) => {
    if (!notification.isRead) {
      markReadMut.mutate(notification.id);
    }
    if (notification.link) {
      setOpen(false);
      navigate(notification.link);
    }
  };

  const unreadCount = countData?.count ?? 0;

  return (
    <>
      <Badge count={unreadCount} size="small" offset={[-2, 4]} overflowCount={99}>
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          onClick={() => setOpen(true)}
          style={unreadCount > 0 ? { animation: 'bellPulse 2s infinite' } : undefined}
        />
      </Badge>

      <Drawer
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Typography.Text strong style={{ fontSize: 16 }}>Уведомления</Typography.Text>
              {unreadCount > 0 && (
                <Tag color="blue" style={{ borderRadius: 10, fontWeight: 600 }}>{unreadCount} новых</Tag>
              )}
            </Space>
            {unreadCount > 0 && (
              <Button
                type="link"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => markAllReadMut.mutate()}
                loading={markAllReadMut.isPending}
              >
                Прочитать все
              </Button>
            )}
          </div>
        }
        placement="right"
        open={open}
        onClose={() => setOpen(false)}
        width={420}
        styles={{ body: { padding: 0 } }}
      >
        <List
          dataSource={recentData?.items ?? []}
          locale={{ emptyText: 'Нет уведомлений' }}
          renderItem={(item: AppNotification) => {
            const cfg = severityConfig[item.severity];
            return (
              <List.Item
                onClick={() => handleClick(item)}
                style={{
                  cursor: item.link ? 'pointer' : 'default',
                  padding: '14px 20px',
                  borderLeft: `4px solid ${item.isRead ? 'transparent' : cfg.color}`,
                  background: item.isRead ? 'transparent' : cfg.bg,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <Space size={6}>
                      <span style={{ color: cfg.color, fontSize: 16 }}>{cfg.icon}</span>
                      <Typography.Text strong={!item.isRead} style={{ fontSize: 14 }}>
                        {item.title}
                      </Typography.Text>
                    </Space>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <Tag
                        color={cfg.color}
                        style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px', margin: 0 }}
                      >
                        {cfg.label}
                      </Tag>
                      {!item.isRead && (
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: cfg.color, display: 'inline-block',
                        }} />
                      )}
                    </div>
                  </div>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: 13, margin: '4px 0 6px 22px' }}
                    ellipsis={{ rows: 2 }}
                  >
                    {item.body}
                  </Typography.Paragraph>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginLeft: 22 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(item.createdAt).fromNow()}
                      {item.createdBy && ` — ${item.createdBy.fullName}`}
                    </Typography.Text>
                    {item.link && (
                      <RightOutlined style={{ fontSize: 10, color: themeToken.colorTextTertiary }} />
                    )}
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${themeToken.colorBorderSecondary}`, textAlign: 'center' }}>
          <Button type="link" onClick={() => { setOpen(false); navigate('/notifications'); }}>
            Все уведомления
          </Button>
        </div>
      </Drawer>

      <style>{`
        @keyframes bellPulse {
          0%, 100% { transform: scale(1); }
          10% { transform: scale(1.15) rotate(5deg); }
          20% { transform: scale(1.15) rotate(-5deg); }
          30% { transform: scale(1.15) rotate(3deg); }
          40% { transform: scale(1); }
        }
      `}</style>
    </>
  );
}
