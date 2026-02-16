import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Popover, List, Typography, Tag, Space, theme } from 'antd';
import { BellOutlined, InfoCircleOutlined, WarningOutlined, ExclamationCircleOutlined, CheckOutlined } from '@ant-design/icons';
import { notificationsApi } from '../api/notifications.api';
import type { AppNotification, NotificationSeverity } from '../types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';

dayjs.extend(relativeTime);
dayjs.locale('ru');

const severityConfig: Record<NotificationSeverity, { icon: React.ReactNode; color: string }> = {
  INFO: { icon: <InfoCircleOutlined />, color: '#1677ff' },
  WARNING: { icon: <WarningOutlined />, color: '#fa8c16' },
  URGENT: { icon: <ExclamationCircleOutlined />, color: '#ff4d4f' },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token: themeToken } = theme.useToken();

  const { data: countData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: notificationsApi.getUnreadCount,
    refetchInterval: 15_000,
  });

  const { data: recentData } = useQuery({
    queryKey: ['notifications-recent'],
    queryFn: () => notificationsApi.list({ limit: 10 }),
    enabled: open,
  });

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

  const content = (
    <div style={{ width: 360 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${themeToken.colorBorderSecondary}` }}>
        <Typography.Text strong>Уведомления</Typography.Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => markAllReadMut.mutate()} loading={markAllReadMut.isPending}>
            Прочитать все
          </Button>
        )}
      </div>
      <List
        dataSource={recentData?.items ?? []}
        locale={{ emptyText: 'Нет уведомлений' }}
        style={{ maxHeight: 400, overflow: 'auto' }}
        renderItem={(item: AppNotification) => {
          const cfg = severityConfig[item.severity];
          return (
            <List.Item
              onClick={() => handleClick(item)}
              style={{
                cursor: item.link ? 'pointer' : 'default',
                padding: '10px 12px',
                background: item.isRead ? 'transparent' : (themeToken.colorPrimaryBg || 'rgba(22, 119, 255, 0.04)'),
              }}
            >
              <List.Item.Meta
                avatar={<span style={{ color: cfg.color, fontSize: 18 }}>{cfg.icon}</span>}
                title={
                  <Space size={4}>
                    <Typography.Text strong={!item.isRead} style={{ fontSize: 13 }}>{item.title}</Typography.Text>
                    {!item.isRead && <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>new</Tag>}
                  </Space>
                }
                description={
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>{item.body}</Typography.Text>
                    <div style={{ marginTop: 2 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{dayjs(item.createdAt).fromNow()}</Typography.Text>
                      {item.createdBy && (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}> — {item.createdBy.fullName}</Typography.Text>
                      )}
                    </div>
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${themeToken.colorBorderSecondary}`, textAlign: 'center' }}>
        <Button type="link" size="small" onClick={() => { setOpen(false); navigate('/notifications'); }}>
          Посмотреть все
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      arrow={false}
      overlayInnerStyle={{ padding: 0 }}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 4]}>
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
      </Badge>
    </Popover>
  );
}
