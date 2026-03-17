import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Space, Typography, theme, message } from 'antd';
import { SendOutlined, DisconnectOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { telegramApi } from '../api/telegram.api';

export default function TelegramLinkButton() {
  const [linkLoading, setLinkLoading] = useState(false);
  const { token: tk } = theme.useToken();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['telegram-status'],
    queryFn: telegramApi.getStatus,
    refetchInterval: 10_000,
  });

  const unlinkMut = useMutation({
    mutationFn: telegramApi.unlink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-status'] });
      message.success('Telegram отвязан');
    },
    onError: () => {
      message.error('Ошибка при отвязке');
    },
  });

  const handleLink = async () => {
    setLinkLoading(true);
    try {
      const { deepLink } = await telegramApi.link();
      window.open(deepLink, '_blank');
    } catch {
      message.error('Ошибка генерации ссылки');
    } finally {
      setLinkLoading(false);
    }
  };

  if (isLoading) return null;

  return (
    <div style={{
      padding: '12px 16px',
      background: tk.colorFillQuaternary,
      borderRadius: 8,
      marginBottom: 16,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <Space>
        <SendOutlined style={{ fontSize: 18 }} />
        <div>
          <Typography.Text strong>Telegram-уведомления</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {status?.linked
              ? 'Привязан — вы получаете уведомления в Telegram'
              : 'Привяжите Telegram для мгновенных уведомлений'}
          </Typography.Text>
        </div>
      </Space>
      <Space>
        {status?.linked ? (
          <>
            <CheckCircleOutlined style={{ color: tk.colorSuccess, fontSize: 18 }} />
            <Button
              size="small"
              icon={<DisconnectOutlined />}
              onClick={() => unlinkMut.mutate()}
              loading={unlinkMut.isPending}
              danger
            >
              Отвязать
            </Button>
          </>
        ) : (
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            onClick={handleLink}
            loading={linkLoading}
          >
            Привязать Telegram
          </Button>
        )}
      </Space>
    </div>
  );
}
