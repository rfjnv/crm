import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Checkbox, Form, Input, Modal, Select, Typography, message } from 'antd';
import { clientsApi } from '../../api/clients.api';
import { callsApi } from '../../api/calls.api';
import { formatUzPhone } from '../../utils/phone';
import { apiErrorMessage } from './callsUi';

interface CallRef {
  id: string;
  counterpart: string | null;
}

function invalidateCalls(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['calls'] });
  queryClient.invalidateQueries({ queryKey: ['call'] });
  queryClient.invalidateQueries({ queryKey: ['client-calls'] });
  queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
}

/** «Привязать к клиенту»: номер звонка уходит клиенту вместе со всеми звонками с этого номера. */
export function LinkClientModal({ call, open, onClose }: { call: CallRef | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState<string | undefined>();
  const [savePhone, setSavePhone] = useState(true);
  const { data: clients = [], isLoading } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list, enabled: open });

  const selected = clients.find((c) => c.id === clientId);
  const clientHasNoPhone = !!selected && !selected.phone?.trim();
  const options = useMemo(
    () => clients
      .filter((c) => !c.isArchived)
      .map((c) => ({ value: c.id, label: `${c.companyName}${c.contactName ? ` — ${c.contactName}` : ''}`, search: `${c.companyName} ${c.contactName} ${c.phone ?? ''}`.toLowerCase() })),
    [clients],
  );

  const mut = useMutation({
    mutationFn: () => callsApi.linkClient(call!.id, clientId!, clientHasNoPhone && savePhone),
    onSuccess: (res) => {
      message.success(
        `Номер привязан к клиенту${res.linkedCount > 1 ? `, звонков: ${res.linkedCount}` : ''}${res.phoneSaved ? '. Номер записан в карточку' : ''}`,
      );
      invalidateCalls(queryClient);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setClientId(undefined);
      onClose();
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Не удалось привязать')),
  });

  return (
    <Modal
      title="Привязать номер к клиенту"
      open={open}
      onCancel={onClose}
      onOk={() => mut.mutate()}
      okText="Привязать"
      okButtonProps={{ disabled: !clientId, loading: mut.isPending }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {formatUzPhone(call?.counterpart) || 'Номер скрыт'} — все звонки с этого номера без клиента тоже перейдут к выбранному клиенту.
      </Typography.Paragraph>
      <Select
        showSearch
        allowClear
        style={{ width: '100%' }}
        placeholder="Начните вводить название или телефон"
        loading={isLoading}
        value={clientId}
        onChange={setClientId}
        options={options}
        filterOption={(input, option) => !!option?.search.includes(input.toLowerCase())}
      />
      {clientHasNoPhone && call?.counterpart && (
        <Checkbox style={{ marginTop: 12 }} checked={savePhone} onChange={(e) => setSavePhone(e.target.checked)}>
          У клиента нет телефона — записать {formatUzPhone(call.counterpart)} в карточку
        </Checkbox>
      )}
    </Modal>
  );
}

/** «Создать клиента» с подставленным номером — и сразу привязать к нему звонок. */
export function CreateClientModal({ call, open, onClose }: { call: CallRef | null; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ companyName: string; contactName: string; phone: string }>();

  const mut = useMutation({
    mutationFn: async (values: { companyName: string; contactName: string; phone: string }) => {
      const created = await clientsApi.create({ ...values, phone: values.phone || undefined });
      await callsApi.linkClient(call!.id, created.id);
      return created;
    },
    onSuccess: (created) => {
      message.success(`Клиент «${created.companyName}» создан, звонки привязаны`);
      invalidateCalls(queryClient);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      form.resetFields();
      onClose();
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Не удалось создать клиента')),
  });

  return (
    <Modal
      title="Новый клиент из звонка"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Создать"
      okButtonProps={{ loading: mut.isPending }}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ phone: formatUzPhone(call?.counterpart) }}
        onFinish={(v) => mut.mutate(v)}
      >
        <Form.Item name="companyName" label="Компания" rules={[{ required: true, message: 'Укажите компанию' }]}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="contactName" label="Контактное лицо" rules={[{ required: true, message: 'Укажите контакт' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="phone" label="Телефон">
          <Input placeholder="+998 99 999 99 99" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
