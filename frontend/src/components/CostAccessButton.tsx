import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Form, Input, Modal, Space, Tooltip, Typography, message } from 'antd';
import { LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { costAccessApi } from '../api/costAccess.api';
import { useCostAccess } from '../hooks/useCostAccess';
import { APP_BUTTON } from './ui/AppClassNames';

const { Text } = Typography;

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

function formatLeft(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const PIN_RULES = [
  { required: true, message: 'Введите ПИН' },
  { pattern: /^\d{4,8}$/, message: 'ПИН — от 4 до 8 цифр' },
];

/**
 * Замок себестоимости в шапке (только ADMIN / SUPER_ADMIN).
 * Закрыто — замок; клик → ввод личного ПИН на 10 минут или на час.
 * Открыто — обратный отсчёт; клик закрывает досрочно.
 */
export default function CostAccessButton() {
  const cost = useCostAccess();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'unlock' | 'setPin' | null>(null);
  const [unlockForm] = Form.useForm<{ pin: string; long: boolean }>();
  const [pinForm] = Form.useForm<{ password: string; pin: string; pin2: string }>();

  // После смены доступа перезапрашиваем всё: цены должны появиться или исчезнуть везде.
  const refreshAll = () => queryClient.invalidateQueries();

  const unlock = useMutation({
    mutationFn: (v: { pin: string; long: boolean }) => costAccessApi.unlock(v.pin, v.long ? 'long' : 'short'),
    onSuccess: () => {
      setModal(null);
      unlockForm.resetFields();
      void refreshAll();
    },
    onError: (err) => {
      unlockForm.setFields([{ name: 'pin', value: '', errors: [errorText(err, 'Не удалось открыть')] }]);
      void queryClient.invalidateQueries({ queryKey: ['cost-access-status'] });
    },
  });

  const lock = useMutation({
    mutationFn: costAccessApi.lock,
    onSuccess: () => {
      message.success('Себестоимость закрыта');
      void refreshAll();
    },
  });

  const setPin = useMutation({
    mutationFn: (v: { password: string; pin: string }) => costAccessApi.setPin(v.password, v.pin),
    onSuccess: () => {
      message.success('ПИН-код сохранён');
      pinForm.resetFields();
      setModal('unlock');
      void refreshAll();
    },
    onError: (err) => message.error(errorText(err, 'Не удалось сохранить ПИН')),
  });

  if (!cost.eligible) return null;

  if (cost.open) {
    return (
      <Tooltip title="Себестоимость открыта. Нажмите, чтобы закрыть сейчас">
        <Button
          type="text"
          className={APP_BUTTON}
          icon={<UnlockOutlined />}
          loading={lock.isPending}
          onClick={() => lock.mutate()}
          style={{ color: 'var(--ant-color-warning, #fa8c16)', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatLeft(cost.secondsLeft)}
        </Button>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip title="Себестоимость закрыта">
        <Button
          type="text"
          className={APP_BUTTON}
          icon={<LockOutlined />}
          aria-label="Открыть себестоимость"
          onClick={() => setModal(cost.hasPin ? 'unlock' : 'setPin')}
        />
      </Tooltip>

      <Modal
        open={modal === 'unlock'}
        title="Открыть себестоимость"
        okText="Открыть"
        cancelText="Отмена"
        confirmLoading={unlock.isPending}
        onOk={() => unlockForm.submit()}
        onCancel={() => { setModal(null); unlockForm.resetFields(); }}
        destroyOnHidden
        width={380}
      >
        <Form
          form={unlockForm}
          layout="vertical"
          initialValues={{ long: false }}
          onFinish={(v) => unlock.mutate(v)}
        >
          <Form.Item name="pin" label="Ваш ПИН-код" rules={[{ required: true, message: 'Введите ПИН' }]}>
            <Input.Password
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              placeholder="••••"
            />
          </Form.Item>
          <Form.Item name="long" valuePropName="checked" style={{ marginBottom: 8 }}>
            <Checkbox>Открыть на {cost.durations.long / 60 === 1 ? '1 час' : `${cost.durations.long} мин`}</Checkbox>
          </Form.Item>
          <Space direction="vertical" size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Без галочки — на {cost.durations.short} минут. Потом цены закроются сами.
            </Text>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setModal('setPin')}>
              Сменить ПИН
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={modal === 'setPin'}
        title={cost.hasPin ? 'Сменить ПИН-код' : 'Установите ПИН-код'}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={setPin.isPending}
        onOk={() => pinForm.submit()}
        onCancel={() => { setModal(null); pinForm.resetFields(); }}
        destroyOnHidden
        width={400}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          Личный ПИН открывает цены закупки и маржу. Никому его не сообщайте.
          Для подтверждения нужен пароль от вашей учётной записи.
        </Text>
        <Form
          form={pinForm}
          layout="vertical"
          onFinish={(v) => setPin.mutate({ password: v.password, pin: v.pin })}
        >
          <Form.Item name="password" label="Пароль от учётной записи" rules={[{ required: true, message: 'Введите пароль' }]}>
            <Input.Password autoComplete="current-password" autoFocus />
          </Form.Item>
          <Form.Item name="pin" label="Новый ПИН (4–8 цифр)" rules={PIN_RULES}>
            <Input.Password inputMode="numeric" autoComplete="off" maxLength={8} />
          </Form.Item>
          <Form.Item
            name="pin2"
            label="Повторите ПИН"
            dependencies={['pin']}
            rules={[
              { required: true, message: 'Повторите ПИН' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || value === getFieldValue('pin') ? Promise.resolve() : Promise.reject(new Error('ПИН не совпадает')),
              }),
            ]}
          >
            <Input.Password inputMode="numeric" autoComplete="off" maxLength={8} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
