import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { PlusOutlined } from '@ant-design/icons';
import { notesBoardApi } from '../api/notes-board.api';
import { clientsApi } from '../api/clients.api';

type CallResult = 'ANSWERED' | 'NO_ANSWER';

const CALL_RESULT_LABEL: Record<CallResult, string> = {
  ANSWERED: 'Взял трубку',
  NO_ANSWER: 'Не взял',
};

export default function NotesBoardPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [callResultFilter, setCallResultFilter] = useState<CallResult | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [clientForm] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['notes-board', page, pageSize, q, callResultFilter],
    queryFn: () =>
      notesBoardApi.list({
        page,
        pageSize,
        q: q.trim() || undefined,
        callResult: callResultFilter,
      }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes-board'] });
    void queryClient.invalidateQueries({ queryKey: ['client-notes'] });
    void queryClient.invalidateQueries({ queryKey: ['manager-client-activity'] });
  };

  const createMut = useMutation({
    mutationFn: notesBoardApi.create,
    onSuccess: () => {
      message.success('Запись добавлена');
      setCreateOpen(false);
      setEditingId(null);
      form.resetFields();
      invalidate();
    },
    onError: () => message.error('Не удалось сохранить запись'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data: payload }: { id: string; data: Parameters<typeof notesBoardApi.update>[1] }) =>
      notesBoardApi.update(id, payload),
    onSuccess: () => {
      message.success('Запись обновлена');
      setCreateOpen(false);
      setEditingId(null);
      form.resetFields();
      invalidate();
    },
    onError: () => message.error('Не удалось обновить запись'),
  });

  const removeMut = useMutation({
    mutationFn: notesBoardApi.remove,
    onSuccess: () => {
      message.success('Запись удалена');
      invalidate();
    },
    onError: () => message.error('Не удалось удалить запись'),
  });

  const quickClientMut = useMutation({
    mutationFn: clientsApi.create,
    onSuccess: (client) => {
      message.success('Клиент создан');
      setQuickClientOpen(false);
      clientForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      form.setFieldValue('clientId', client.id);
    },
    onError: () => message.error('Не удалось создать клиента'),
  });

  const rows = data?.items ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Заметки обзвонов
        </Typography.Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingId(null);
            form.resetFields();
            form.setFieldsValue({ lastCallAt: dayjs(), callResult: 'ANSWERED' });
            setCreateOpen(true);
          }}
        >
          Новая запись
        </Button>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Поиск по клиенту / комменту"
            style={{ width: 320 }}
            onSearch={(v) => {
              setPage(1);
              setQ(v);
            }}
          />
          <Select
            allowClear
            placeholder="Дозвон"
            value={callResultFilter}
            style={{ width: 180 }}
            onChange={(v) => {
              setPage(1);
              setCallResultFilter(v);
            }}
            options={[
              { label: CALL_RESULT_LABEL.ANSWERED, value: 'ANSWERED' },
              { label: CALL_RESULT_LABEL.NO_ANSWER, value: 'NO_ANSWER' },
            ]}
          />
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total: data?.meta.total || 0,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        columns={[
          {
            title: '№',
            width: 60,
            render: (_v, _r, idx) => (page - 1) * pageSize + idx + 1,
          },
          {
            title: 'Клиенты',
            dataIndex: ['client', 'companyName'],
            key: 'companyName',
          },
          {
            title: 'Дозвон',
            key: 'callResult',
            width: 140,
            render: (_v, r) => (
              <Tag color={r.callResult === 'ANSWERED' ? 'green' : 'orange'}>
                {CALL_RESULT_LABEL[r.callResult]}
              </Tag>
            ),
          },
          {
            title: 'Дата последнего обзвона',
            key: 'lastCallAt',
            width: 180,
            render: (_v, r) => dayjs(r.lastCallAt).format('DD.MM.YYYY HH:mm'),
          },
          {
            title: 'Статус',
            dataIndex: 'status',
            key: 'status',
            width: 140,
            render: (v: string | null) => v || '—',
          },
          {
            title: 'Коммент',
            dataIndex: 'comment',
            key: 'comment',
          },
          {
            title: 'Автор',
            key: 'author',
            width: 170,
            render: (_v, r) => r.author.fullName,
          },
          {
            title: '',
            key: 'actions',
            width: 140,
            render: (_v, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditingId(r.id);
                    form.setFieldsValue({
                      clientId: r.clientId,
                      callResult: r.callResult,
                      status: r.status || undefined,
                      comment: r.comment,
                      lastCallAt: dayjs(r.lastCallAt),
                      nextCallAt: r.nextCallAt ? dayjs(r.nextCallAt) : null,
                    });
                    setCreateOpen(true);
                  }}
                >
                  Изм.
                </Button>
                <Popconfirm title="Удалить запись?" onConfirm={() => removeMut.mutate(r.id)}>
                  <Button danger size="small">
                    Удалить
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editingId ? 'Редактировать запись' : 'Новая запись'}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setEditingId(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending || updateMut.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => {
            const payload = {
              clientId: v.clientId,
              callResult: v.callResult as CallResult,
              status: (v.status || '').trim() || undefined,
              comment: (v.comment || '').trim(),
              lastCallAt: v.lastCallAt.toISOString(),
              nextCallAt: v.nextCallAt ? v.nextCallAt.toISOString() : null,
            };
            if (editingId) {
              updateMut.mutate({ id: editingId, data: payload });
              return;
            }
            createMut.mutate(payload);
          }}
        >
          <Form.Item
            name="clientId"
            label="Клиент"
            rules={[{ required: true, message: 'Выберите клиента' }]}
            extra={
              <Button type="link" size="small" onClick={() => setQuickClientOpen(true)} style={{ padding: 0 }}>
                Быстро создать клиента
              </Button>
            }
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={clients.map((c) => ({ value: c.id, label: c.companyName }))}
            />
          </Form.Item>
          <Form.Item name="callResult" label="Дозвон" rules={[{ required: true, message: 'Выберите статус дозвона' }]}>
            <Select
              options={[
                { value: 'ANSWERED', label: CALL_RESULT_LABEL.ANSWERED },
                { value: 'NO_ANSWER', label: CALL_RESULT_LABEL.NO_ANSWER },
              ]}
            />
          </Form.Item>
          <Form.Item name="lastCallAt" label="Дата последнего обзвона" rules={[{ required: true, message: 'Укажите дату' }]}>
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="nextCallAt" label="Напомнить на дату">
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="status" label="Статус">
            <Input placeholder="Например: Повторный звонок" />
          </Form.Item>
          <Form.Item name="comment" label="Коммент" rules={[{ required: true, message: 'Введите комментарий' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Быстро создать клиента"
        open={quickClientOpen}
        onCancel={() => setQuickClientOpen(false)}
        onOk={() => clientForm.submit()}
        confirmLoading={quickClientMut.isPending}
      >
        <Form
          form={clientForm}
          layout="vertical"
          onFinish={(v) =>
            quickClientMut.mutate({
              companyName: (v.companyName || '').trim(),
              contactName: (v.contactName || '').trim(),
              phone: (v.phone || '').trim() || undefined,
            })
          }
        >
          <Form.Item name="companyName" label="Компания" rules={[{ required: true, message: 'Введите название компании' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="Контактное лицо" rules={[{ required: true, message: 'Введите контактное лицо' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Телефон">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
