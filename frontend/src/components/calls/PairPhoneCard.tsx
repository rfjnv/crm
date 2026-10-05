import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, QRCode, Space, Typography, message } from 'antd';
import { MobileOutlined } from '@ant-design/icons';
import { mobileApi } from '../../api/calls.api';
import { useAuthStore } from '../../store/authStore';
import { apiErrorMessage, canSeeAllCalls } from './callsUi';

function useSecondsLeft(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.round((new Date(until).getTime() - now) / 1000)) : 0;
}

/**
 * Профиль: «Привязать телефон» — QR для своего телефона. Телефоны подключает руководство,
 * поэтому карточка видна только ему; телефоны сотрудников — «Телефоны (CallSync)» → «Подключить телефон».
 */
export default function PairPhoneCard() {
  const user = useAuthStore((s) => s.user);
  const allowed = canSeeAllCalls(user);
  const [pairing, setPairing] = useState<{ code: string; qr: string; expiresAt: string } | null>(null);
  const left = useSecondsLeft(pairing?.expiresAt ?? null);
  const expired = !!pairing && left === 0;

  const mut = useMutation({
    mutationFn: () => mobileApi.pairingCode(user!.id),
    onSuccess: setPairing,
    onError: (err) => message.error(apiErrorMessage(err, 'Не удалось получить код')),
  });

  if (!allowed || !user) return null;

  return (
    <Card title={<Space><MobileOutlined />Рабочий телефон (CallSync)</Space>} style={{ borderRadius: 12 }}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        QR для вашего собственного рабочего телефона. Телефоны сотрудников подключаются
        в «Телефоны (CallSync)» → «Подключить телефон». После привязки старый телефон отвяжется.
      </Typography.Paragraph>
      {pairing && !expired ? (
        <Space direction="vertical" align="center" style={{ width: '100%' }}>
          <QRCode value={pairing.qr} size={220} />
          <Typography.Text>
            Код: <Typography.Text strong copyable>{pairing.code}</Typography.Text>
          </Typography.Text>
          <Typography.Text type="secondary">
            Действует ещё {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </Typography.Text>
        </Space>
      ) : (
        <Space direction="vertical">
          {expired && <Typography.Text type="warning">Код истёк — получите новый.</Typography.Text>}
          <Button type="primary" icon={<MobileOutlined />} loading={mut.isPending} onClick={() => mut.mutate()}>
            Привязать телефон
          </Button>
        </Space>
      )}
    </Card>
  );
}
