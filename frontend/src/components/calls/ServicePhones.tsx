import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import { callsApi, type ServicePhone, type ServicePhoneInput } from '../../api/calls.api';
import { usersApi } from '../../api/users.api';
import { formatUzPhone } from '../../utils/phone';
import { useIsMobile } from '../../hooks/useIsMobile';
import { apiErrorMessage } from './callsUi';

type FormValues = { phone: string; userId?: string; name?: string; note?: string };

function useInvalidateServicePhones() {
  const queryClient = useQueryClient();
  // Метки «Служебный» в журнале и фильтры пересчитываются на сервере
  return () => {
    queryClient.invalidateQueries({ queryKey: ['service-phones'] });
    queryClient.invalidateQueries({ queryKey: ['calls'] });
    queryClient.invalidateQueries({ queryKey: ['call'] });
    queryClient.invalidateQueries({ queryKey: ['call-history'] });
    queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
  };
}

function toInput(v: FormValues): ServicePhoneInput {
  return { phone: v.phone, userId: v.userId ?? null, name: v.name?.trim() || undefined, note: v.note ?? '' };
}

/**
 * Поля: номер, сотрудник CRM (если это его номер) и подпись. Выбрали сотрудника — подпись
 * подставляется его ФИО, её можно дополнить («Склад — Бахтиёр»). Не сотрудник CRM —
 * сотрудника не выбирать, подпись написать вручную.
 */
function ServicePhoneFields({ form, autoNameInit }: { form: FormInstance<FormValues>; autoNameInit?: string }) {
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });
  const options = useMemo(
    () => users
      .filter((u) => u.isActive && u.role !== 'SITE_ADMIN')
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
      .map((u) => ({ value: u.id, label: u.fullName })),
    [users],
  );
  const userId = Form.useWatch('userId', form);
  // Какую подпись подставили сами: её можно заменить ФИО другого сотрудника, написанную руками — нет
  const autoName = useRef<string | undefined>(autoNameInit);

  const onEmployee = (id: string) => {
    const name = form.getFieldValue('name') as string | undefined;
    const picked = options.find((o) => o.value === id)?.label;
    if (picked && (!name?.trim() || name === autoName.current)) {
      form.setFieldsValue({ name: picked });
      autoName.current = picked;
    }
  };

  return (
    <>
      <Form.Item name="phone" label="Номер" rules={[{ required: true, message: 'Укажите номер' }]}>
        <Input placeholder="+998 90 123 45 67" />
      </Form.Item>
      <Form.Item name="userId" label="Сотрудник CRM" extra="Если это номер сотрудника из CRM. Нет в списке — оставьте пустым и напишите подпись.">
        <Select
          allowClear
          showSearch
          placeholder="Не сотрудник CRM"
          optionFilterProp="label"
          options={options}
          onSelect={(v: string) => onEmployee(v)}
        />
      </Form.Item>
      <Form.Item
        name="name"
        label="Подпись в журнале"
        rules={[{ required: !userId, message: 'Напишите, чей это номер' }]}
      >
        <Input placeholder={userId ? 'ФИО сотрудника' : 'Склад — Бахтиёр'} maxLength={120} />
      </Form.Item>
      <Form.Item name="note" label="Заметка">
        <Input maxLength={500} />
      </Form.Item>
    </>
  );
}

/** Окно добавления или правки служебного номера. */
function ServicePhoneModal({ open, onClose, editing, phone }: {
  open: boolean;
  onClose: () => void;
  /** Правим существующий; иначе — новый */
  editing?: ServicePhone | null;
  /** Номер для нового (из карточки звонка) */
  phone?: string | null;
}) {
  const [form] = Form.useForm<FormValues>();
  const invalidate = useInvalidateServicePhones();
  const save = useMutation({
    mutationFn: (v: FormValues) => (editing ? callsApi.updateServicePhone(editing.id, toInput(v)) : callsApi.addServicePhone(toInput(v))),
    onSuccess: (row) => {
      message.success(editing ? `Сохранено: ${row.phone} — «${row.name}»` : `${row.phone} — служебный номер «${row.name}»`);
      invalidate();
      onClose();
    },
    onError: (err) => message.error(apiErrorMessage(err, 'Не удалось сохранить номер')),
  });
  const initialValues: FormValues = editing
    ? { phone: editing.phone, userId: editing.user?.id, name: editing.name, note: editing.note ?? '' }
    : { phone: formatUzPhone(phone) };

  return (
    <Modal
      title={editing ? 'Изменить служебный номер' : 'Служебный номер'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Сохранить"
      okButtonProps={{ loading: save.isPending }}
      destroyOnHidden
    >
      {!editing && (
        <Typography.Paragraph type="secondary">
          Склад, сотрудник компании, курьер. Такие звонки помечаются «Служебный», по ним не ставятся задачи
          «перезвонить» и не идёт автоматический анализ, а в журнале их можно скрыть.
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues} onFinish={(v) => save.mutate(v)}>
        <ServicePhoneFields
          form={form}
          // Подпись = ФИО привязанного сотрудника — значит, её подставили, при смене сотрудника заменим
          autoNameInit={editing?.user && editing.user.fullName === editing.name ? editing.name : undefined}
        />
      </Form>
    </Modal>
  );
}

/** «Это служебный номер» из карточки звонка — номер уже подставлен. */
export function AddServicePhoneModal({ phone, open, onClose }: { phone: string | null; open: boolean; onClose: () => void }) {
  // Монтируем только открытым: форма каждый раз с чистыми значениями
  return open ? <ServicePhoneModal open onClose={onClose} phone={phone} /> : null;
}

/** Справочник служебных номеров (руководитель). */
export function ServicePhonesDrawer({ open, onClose, onShowCalls }: {
  open: boolean;
  onClose: () => void;
  onShowCalls: (row: ServicePhone) => void;
}) {
  const isMobile = useIsMobile();
  const invalidate = useInvalidateServicePhones();
  const [modal, setModal] = useState<{ editing: ServicePhone | null } | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['service-phones'], queryFn: callsApi.servicePhones, enabled: open });
  const remove = useMutation({
    mutationFn: callsApi.removeServicePhone,
    onSuccess: () => { message.success('Номер больше не служебный'); invalidate(); },
    onError: (err) => message.error(apiErrorMessage(err)),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 680}
      title="Служебные номера"
      extra={<Button type="primary" onClick={() => setModal({ editing: null })}>Добавить номер</Button>}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Склад, сотрудники, курьеры — не клиенты. Их звонки помечаются «Служебный», по ним не ставятся задачи
        «перезвонить» и не идёт автоматический анализ. В журнале: фильтр «Номера».
      </Typography.Paragraph>
      <Table<ServicePhone>
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
                {r.user && <Tag color="blue" style={{ marginInlineEnd: 0, width: 'fit-content' }}>Сотрудник CRM: {r.user.fullName}</Tag>}
                {r.note && <Typography.Text type="secondary">{r.note}</Typography.Text>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Добавил {r.createdBy.fullName}, {dayjs(r.createdAt).format('DD.MM.YYYY')}
                </Typography.Text>
              </Space>
            ),
          },
          {
            key: 'actions',
            width: 160,
            render: (_, r) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => setModal({ editing: r })}>Изменить</Button>
                <Button size="small" onClick={() => onShowCalls(r)}>Звонки</Button>
                <Popconfirm title="Убрать из служебных?" onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" danger>Убрать</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {/* Монтируем только открытым: иначе форма «Добавить» подхватывает значения прошлой правки */}
      {modal && <ServicePhoneModal open editing={modal.editing} onClose={() => setModal(null)} />}
    </Drawer>
  );
}
