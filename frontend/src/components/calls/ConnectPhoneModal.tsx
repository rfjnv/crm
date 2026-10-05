import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, QRCode, Result, Select, Space, Typography, message } from 'antd';
import { usersApi } from '../../api/users.api';
import { mobileApi } from '../../api/calls.api';
import { apiErrorMessage } from './callsUi';

const CODE_TTL_MS = 10 * 60 * 1000;
/** Запас на расхождение часов: код создан на сервере, устройство — тоже */
const CLOCK_MARGIN_MS = 5_000;

function useSecondsLeft(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.round((new Date(until).getTime() - now) / 1000)) : 0;
}

/**
 * «Подключить телефон»: руководитель выбирает сотрудника и показывает QR, телефон сканирует.
 * Пока окно открыто, список телефонов обновляется: как только у сотрудника появился новый
 * телефон — «Телефон подключён ✓», и окно закрывается само.
 */
export default function ConnectPhoneModal({ open, onClose, initialUserId }: {
  open: boolean;
  onClose: () => void;
  initialUserId?: string;
}) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | undefined>(initialUserId);
  const [pairing, setPairing] = useState<{ qr: string; code: string; expiresAt: string; employee: { id: string; name: string } } | null>(null);
  const [connected, setConnected] = useState(false);
  const left = useSecondsLeft(pairing?.expiresAt ?? null);
  const expired = !!pairing && left === 0;

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list(), enabled: open });
  const { data: devices } = useQuery({
    queryKey: ['mobile-devices'],
    queryFn: mobileApi.devices,
    enabled: open,
    refetchInterval: open && pairing && !connected ? 3000 : false,
  });

  // Менеджеры по продажам — первыми
  const options = useMemo(() => {
    const active = users.filter((u) => u.isActive && u.role !== 'SITE_ADMIN').sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
    const toOption = (u: (typeof active)[number]) => ({ value: u.id, label: u.fullName });
    return [
      { label: 'Менеджеры по продажам', options: active.filter((u) => u.role === 'MANAGER').map(toOption) },
      { label: 'Остальные сотрудники', options: active.filter((u) => u.role !== 'MANAGER').map(toOption) },
    ].filter((g) => g.options.length > 0);
  }, [users]);

  const currentPhone = devices?.devices.find((d) => d.active && d.user.id === userId);

  // Телефон подключился: у сотрудника есть устройство, созданное после выдачи кода
  useEffect(() => {
    if (!pairing || connected || !devices) return;
    const issuedAt = new Date(pairing.expiresAt).getTime() - CODE_TTL_MS - CLOCK_MARGIN_MS;
    const fresh = devices.devices.find((d) => d.active && d.user.id === pairing.employee.id && new Date(d.createdAt).getTime() >= issuedAt);
    if (fresh) setConnected(true);
  }, [devices, pairing, connected]);

  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => handleClose(), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const mut = useMutation({
    mutationFn: () => mobileApi.pairingCode(userId!),
    onSuccess: (r) => { setPairing(r); setConnected(false); },
    onError: (err) => message.error(apiErrorMessage(err, 'Не удалось получить код')),
  });

  function handleClose() {
    setPairing(null);
    setConnected(false);
    setUserId(initialUserId);
    queryClient.invalidateQueries({ queryKey: ['mobile-devices'] });
    onClose();
  }

  return (
    <Modal title="Подключить телефон" open={open} onCancel={handleClose} footer={null} destroyOnHidden width={440}>
      {connected ? (
        <Result status="success" title="Телефон подключён ✓" subTitle={pairing?.employee.name} />
      ) : !pairing ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder="Выберите сотрудника"
            value={userId}
            onChange={setUserId}
            optionFilterProp="label"
            options={options}
          />
          {currentPhone && (
            <Alert
              type="warning"
              showIcon
              message={`У сотрудника уже подключён телефон${currentPhone.model ? ` ${currentPhone.model}` : ''}. После подключения нового старый будет отвязан`}
            />
          )}
          <Button type="primary" block disabled={!userId} loading={mut.isPending} onClick={() => mut.mutate()}>
            Показать QR-код
          </Button>
        </Space>
      ) : (
        <Space direction="vertical" align="center" size="middle" style={{ width: '100%' }}>
          {expired ? (
            <Alert type="warning" showIcon message="Код истёк — нажмите «Новый код»" />
          ) : (
            <QRCode value={pairing.qr} size={280} />
          )}
          <Typography.Title level={5} style={{ margin: 0 }}>{pairing.employee.name}</Typography.Title>
          {!expired && (
            <Typography.Text type="secondary">
              Действует ещё {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · код {pairing.code}
            </Typography.Text>
          )}
          <Button loading={mut.isPending} onClick={() => mut.mutate()}>Новый код</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
            На телефоне откройте CallSync → «Сканировать QR-код». После подключения пройдите шаги подготовки и задайте PIN руководителя
          </Typography.Text>
        </Space>
      )}
    </Modal>
  );
}
