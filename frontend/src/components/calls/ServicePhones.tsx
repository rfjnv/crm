import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, Modal, Popconfirm, Space, Table, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { callsApi, type ServicePhone } from '../../api/calls.api';
import { formatUzPhone } from '../../utils/phone';
import { useIsMobile } from '../../hooks/useIsMobile';
import { apiErrorMessage } from './callsUi';

type FormValues = { phone: string; name: string; note?: string };

function useAddServicePhone(onDone: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: FormValues) => callsApi.addServicePhone(v),
    onSuccess: (row) => {
      message.success(`${row.phone} — служебный номер «${row.name}»`);
      // Метки «Служебный» в журнале и фильтры пересчитываются на сервере
      queryClient.invalidateQueries({ queryKey: ['service-phones'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
      queryClient.invalidateQueries({ queryKey: ['call'] });
      queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
      onDone();
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Не удалось сохранить номер')),
  });
}

function ServicePhoneFields() {
  return (
    <>
      <Form.Item name="phone" label="Номер" rules={[{ required: true, message: 'Укажите номер' }]}>
        <Input placeholder="+998 90 123 45 67" />
      </Form.Item>
      <Form.Item name="name" label="Чей номер" rules={[{ required: true, message: 'Например: «Склад — Бахтиёр»' }]}>
        <Input placeholder="Склад — Бахтиёр" maxLength={120} />
      </Form.Item>
      <Form.Item name="note" label="Заметка">
        <Input maxLength={500} />
      </Form.Item>
    </>
  );
}

/** «Это служебный номер» из карточки звонка — номер уже подставлен. */
export function AddServicePhoneModal({ phone, open, onClose }: { phone: string | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const add = useAddServicePhone(onClose);
  return (
    <Modal
      title="Служебный номер"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Сохранить"
      okButtonProps={{ loading: add.isPending }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Склад, сотрудник компании, курьер. Такие звонки помечаются «Служебный», по ним не ставятся задачи
        «перезвонить» и не идёт автоматический анализ, а в журнале их можно скрыть.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ phone: formatUzPhone(phone) }} onFinish={(v) => add.mutate(v)}>
        <ServicePhoneFields />
      </Form>
    </Modal>
  );
}

/** Справочник служебных номеров (руководитель). */
export function ServicePhonesDrawer({ open, onClose, onShowCalls }: {
  open: boolean;
  onClose: () => void;
  onShowCalls: (row: ServicePhone) => void;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const { data = [], isLoading } = useQuery({ queryKey: ['service-phones'], queryFn: callsApi.servicePhones, enabled: open });
  const add = useAddServicePhone(() => form.resetFields());
  const remove = useMutation({
    mutationFn: callsApi.removeServicePhone,
    onSuccess: () => {
      message.success('Номер больше не служебный');
      queryClient.invalidateQueries({ queryKey: ['service-phones'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  return (
    <Drawer open={open} onClose={onClose} width={isMobile ? '100%' : 640} title="Служебные номера" destroyOnHidden>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Склад, сотрудники, курьеры — не клиенты. Их звонки помечаются «Служебный», по ним не ставятся задачи
        «перезвонить» и не идёт автоматический анализ. В журнале: фильтр «Номера».
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => add.mutate(v)}>
        <ServicePhoneFields />
        <Button type="primary" htmlType="submit" loading={add.isPending}>Добавить</Button>
      </Form>
      <Table<ServicePhone>
        style={{ marginTop: 16 }}
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: 'Пока нет служебных номеров' }}
        columns={[
          { title: 'Номер', dataIndex: 'phone', width: 160 },
          {
            title: 'Чей',
            key: 'name',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <span>{r.name}</span>
                {r.note && <Typography.Text type="secondary">{r.note}</Typography.Text>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.createdBy.fullName}, {dayjs(r.createdAt).format('DD.MM.YYYY')}
                </Typography.Text>
              </Space>
            ),
          },
          {
            key: 'actions',
            width: 150,
            render: (_, r) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => onShowCalls(r)}>Звонки</Button>
                <Popconfirm title="Убрать из служебных?" onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" danger>Убрать</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
