import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { mobileApi } from '../../api/calls.api';
import { apiErrorMessage } from './callsUi';

/**
 * Архив записей на Google Drive. Подключение — входом в Google: CRM получает доступ только
 * к своей папке, остальные файлы на этом Drive ей не видны. Аккаунт можно сменить в любой момент.
 */
export default function DriveArchiveCard() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data } = useQuery({ queryKey: ['mobile-drive'], queryFn: mobileApi.drive, refetchInterval: 60_000 });

  // Возврат из Google: ?drive=connected | error&reason=… (сообщение — один раз)
  const shown = useRef(false);
  useEffect(() => {
    const status = params.get('drive');
    if (!status || shown.current) return;
    shown.current = true;
    if (status === 'connected') message.success('Google Drive подключён — записи начнут копироваться');
    else message.error(`Google Drive не подключён: ${params.get('reason') ?? 'ошибка'}`);
    setParams((p) => { const n = new URLSearchParams(p); n.delete('drive'); n.delete('reason'); return n; }, { replace: true });
  }, [params, setParams]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mobile-drive'] });
  const connect = useMutation({
    mutationFn: mobileApi.driveAuthUrl,
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (err) => message.error(apiErrorMessage(err)),
  });
  const disconnect = useMutation({
    mutationFn: mobileApi.driveDisconnect,
    onSuccess: () => { message.success('Google Drive отключён'); refresh(); },
    onError: (err) => message.error(apiErrorMessage(err)),
  });
  const sync = useMutation({
    mutationFn: mobileApi.driveSync,
    onSuccess: () => { message.success('Копирование запущено'); setTimeout(refresh, 5000); },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  if (!data) return null;

  return (
    <Card size="small" title={<Space><CloudUploadOutlined />Архив записей: Google Drive</Space>} style={{ marginTop: 16 }}>
      {!data.configured && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="На сервере не заданы GOOGLE_DRIVE_CLIENT_ID и GOOGLE_DRIVE_CLIENT_SECRET"
          description={(
            <>
              В Google Cloud создайте OAuth-клиент «Web application» и укажите redirect URI:{' '}
              <Typography.Text code copyable>{data.redirectUri}</Typography.Text>
            </>
          )}
        />
      )}
      {data.configured && !data.connected && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Drive не подключён — записи копятся только в Supabase (бесплатно около 1 ГБ)"
        />
      )}
      {data.lastError && data.connected && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={data.lastError}
          description={data.lastErrorAt ? dayjs(data.lastErrorAt).format('DD.MM.YYYY HH:mm') : undefined}
        />
      )}

      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="Аккаунт">
          {data.connected ? <Tag color="green">{data.accountEmail ?? 'подключён'}</Tag> : <Tag>не подключён</Tag>}
          {data.connectedAt && <Typography.Text type="secondary"> с {dayjs(data.connectedAt).format('DD.MM.YYYY')}</Typography.Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Папка">{data.folderName}</Descriptions.Item>
        <Descriptions.Item label="Записей на Drive">{data.archivedCount}</Descriptions.Item>
        <Descriptions.Item label="Ждут копирования">
          {data.pendingCount}
          {data.failedCount > 0 && <Typography.Text type="danger"> · не скопировались: {data.failedCount}</Typography.Text>}
        </Descriptions.Item>
      </Descriptions>

      <Typography.Paragraph type="secondary">
        CRM видит на этом Drive только свою папку. Чтобы записи появлялись и на офисном компьютере,
        установите на нём «Google Drive для компьютера» под этим же аккаунтом.
      </Typography.Paragraph>

      <Space wrap>
        <Button type={data.connected ? 'default' : 'primary'} disabled={!data.configured} loading={connect.isPending} onClick={() => connect.mutate()}>
          {data.connected ? 'Подключить другой аккаунт' : 'Подключить Google Drive'}
        </Button>
        {data.connected && (
          <Button loading={sync.isPending} onClick={() => sync.mutate()}>Скопировать сейчас</Button>
        )}
        {data.connected && (
          <Popconfirm
            title="Отключить Google Drive? Уже скопированные записи останутся на Drive, но слушать их из CRM будет нельзя, пока не подключите снова."
            onConfirm={() => disconnect.mutate()}
          >
            <Button danger loading={disconnect.isPending}>Отключить</Button>
          </Popconfirm>
        )}
      </Space>
    </Card>
  );
}
