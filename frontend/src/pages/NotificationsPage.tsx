import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Typography, Button, Segmented, List, Tag, Space, message } from 'antd';
import { InfoCircleOutlined, WarningOutlined, ExclamationCircleOutlined, CheckOutlined } from '@ant-design/icons';
import { notificationsApi } from '../api/notifications.api';
import type { AppNotification, NotificationSeverity } from '../types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';

dayjs.extend(relativeTime);
dayjs.locale('ru');

const severityConfig: Record<NotificationSeverity, { icon: React.ReactNode; color: string; label: string }> = {
  INFO: { icon: <InfoCircleOutlined />, color: '#1677ff', label: 'Инфо' },
  WARNING: { icon: <WarningOutlined />, color: '#fa8c16', label: 'Важно' },
  URGENT: { icon: <ExclamationCircleOutlined />, color: '#ff4d4f', label: 'Срочно' },
};

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => notificationsApi.list({ unreadOnly: filter === 'unread', limit: 50 }),
    refetchInterval: 10_000,
  });

  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
    },
  });

  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] });
      message.success(`Прочитано: ${result.updated}`);
    },
  });

  const handleClick = (notification: AppNotification) => {
    if (!notification.isRead) {
      markReadMut.mutate(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Уведомления</Typography.Title>
        <Space>
          <Button icon={<CheckOutlined />} onClick={() => markAllReadMut.mutate()} loading={markAllReadMut.isPending}>
            Прочитать все
          </Button>
          <Segmented
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Непрочитанные', value: 'unread' },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as 'all' | 'unread')}
          />
        </Space>
      </div>

      <List
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: filter === 'unread' ? 'Нет непрочитанных уведомлений' : 'Нет уведомлений' }}
        renderItem={(item: AppNotification) => {
          const cfg = severityConfig[item.severity];
          return (
            <List.Item
              onClick={() => handleClick(item)}
              style={{
                cursor: item.link ? 'pointer' : 'default',
                background: item.isRead ? 'transparent' : 'rgba(22, 119, 255, 0.04)',
                borderRadius: 8,
                marginBottom: 4,
                padding: '12px 16px',
              }}
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {dayjs(item.createdAt).format('DD.MM.YYYY HH:mm')}
                </Typography.Text>
              }
            >
              <List.Item.Meta
                avatar={<span style={{ color: cfg.color, fontSize: 20 }}>{cfg.icon}</span>}
                title={
                  <Space>
                    <Typography.Text strong={!item.isRead}>{item.title}</Typography.Text>
                    <Tag color={cfg.color} style={{ fontSize: 10 }}>{cfg.label}</Tag>
                    {!item.isRead && <Tag color="blue">new</Tag>}
                  </Space>
                }
                description={
                  <div>
                    <Typography.Paragraph type="secondary" style={{ margin: '4px 0', fontSize: 13 }} ellipsis={{ rows: 2 }}>
                      {item.body}
                    </Typography.Paragraph>
                    {item.createdBy && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        От: {item.createdBy.fullName}
                      </Typography.Text>
                    )}
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
    </div>
  );
}
