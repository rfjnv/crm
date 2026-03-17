import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Space, Typography, theme, message, Input } from 'antd';
import { SendOutlined, DisconnectOutlined, CheckCircleOutlined, CopyOutlined } from '@ant-design/icons';
import { telegramApi } from '../api/telegram.api';

export default function TelegramLinkButton() {
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkCommand, setLinkCommand] = useState<string | null>(null);
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
      setLinkCommand(null);
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
      // Extract token from deep link for manual copy-paste
      const token = deepLink.split('start=')[1] || '';
      setLinkCommand(`/start ${token}`);
      window.open(deepLink, '_blank');
    } catch {
      message.error('Ошибка генерации ссылки');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCopy = () => {
    if (linkCommand) {
      navigator.clipboard.writeText(linkCommand);
      message.success('Команда скопирована');
    }
  };

  if (isLoading) return null;

  // If linked successfully, reset command
  if (status?.linked && linkCommand) {
    setLinkCommand(null);
  }

  return (
    <div style={{
      padding: '12px 16px',
      background: tk.colorFillQuaternary,
      borderRadius: 8,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

      {linkCommand && !status?.linked && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: tk.colorBgContainer, borderRadius: 6 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            Если кнопка START не появилась — скопируйте и отправьте эту команду боту:
          </Typography.Text>
          <Input.Search
            value={linkCommand}
            readOnly
            enterButton={<CopyOutlined />}
            onSearch={handleCopy}
            size="small"
            style={{ maxWidth: 400 }}
          />
        </div>
      )}
    </div>
  );
}
