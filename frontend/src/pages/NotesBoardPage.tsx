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
  Alert,
  Drawer,
  Divider,
} from 'antd';
import dayjs from 'dayjs';
import { PlusOutlined } from '@ant-design/icons';
import { notesBoardApi } from '../api/notes-board.api';
import { clientsApi } from '../api/clients.api';
import { useAuthStore } from '../store/authStore';

type CallResult = 'ANSWERED' | 'NO_ANSWER';

const CALL_RESULT_LABEL: Record<CallResult, string> = {
  ANSWERED: 'Взял трубку',
  NO_ANSWER: 'Не взял',
};

const BASE_STATUSES = ['Успешный', 'Н/А', 'Пока думает', 'Дал запрос'] as const;
const STATUS_COLORS: Record<string, string> = {
  Успешный: 'green',
  'Н/А': 'default',
  'Пока думает': 'gold',
  'Дал запрос': 'blue',
};

function statusColor(name?: string | null): string {
  const v = (name || '').trim();
  if (!v) return 'default';
  if (STATUS_COLORS[v]) return STATUS_COLORS[v];
  const palette = ['magenta', 'purple', 'cyan', 'orange', 'lime', 'geekblue'];
  let hash = 0;
  for (let i = 0; i < v.length; i += 1) hash = (hash * 31 + v.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export default function NotesBoardPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState('');
  const [callResultFilter, setCallResultFilter] = useState<CallResult | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRequestOpen, setEditRequestOpen] = useState(false);
  const [requestRowId, setRequestRowId] = useState<string | null>(null);
  const [requestComment, setRequestComment] = useState('');
  const [myRequestsOpen, setMyRequestsOpen] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [clientForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['notes-board', page, pageSize, q, callResultFilter, statusFilter],
    queryFn: () =>
      notesBoardApi.list({
        page,
        pageSize,
        q: q.trim() || undefined,
        callResult: callResultFilter,
        status: statusFilter || undefined,
      }),
  });

  const { data: myRequestsData, isLoading: myRequestsLoading } = useQuery({
    queryKey: ['notes-board-my-edit-requests', myRequestsOpen],
    queryFn: () => notesBoardApi.listMyEditRequests({ page: 1, pageSize: 100 }),
    enabled: myRequestsOpen,
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
      form.resetFields();
      invalidate();
    },
    onError: () => message.error('Не удалось сохранить запись'),
  });

  const removeMut = useMutation({
    mutationFn: notesBoardApi.remove,
    onSuccess: () => {
      message.success('Запись удалена');
      invalidate();
    },
    onError: () => message.error('Не удалось удалить запись'),
  });

  const requestEditMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => notesBoardApi.requestEdit(id, comment),
    onSuccess: () => {
      message.success('Запрос на правку отправлен');
      setEditRequestOpen(false);
      setRequestRowId(null);
      setRequestComment('');
      invalidate();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Не удалось отправить запрос';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data: payload }: { id: string; data: Parameters<typeof notesBoardApi.update>[1] }) =>
      notesBoardApi.update(id, payload),
    onSuccess: () => {
      message.success('Заметка обновлена');
      setEditOpen(false);
      setEditingId(null);
      form.resetFields();
      invalidate();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Не удалось обновить заметку';
      message.error(msg);
    },
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
        <Space>
          <Button onClick={() => setMyRequestsOpen(true)}>Мои запросы правки</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ lastCallAt: dayjs(), callResult: 'ANSWERED' });
              setCreateOpen(true);
            }}
          >
            Новая запись
          </Button>
        </Space>
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
          <Select
            allowClear
            showSearch
            placeholder="Статус"
            value={statusFilter}
            style={{ width: 220 }}
            onChange={(v) => {
              setPage(1);
              setStatusFilter(v);
            }}
            options={[...BASE_STATUSES, ...Array.from(new Set(rows.map((r) => (r.status || '').trim()).filter(Boolean)))].map((s) => ({
              label: s,
              value: s,
            }))}
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
            width: 160,
            render: (v: string | null) => (v ? <Tag color={statusColor(v)}>{v}</Tag> : '—'),
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
            title: 'Правка',
            key: 'editReq',
            width: 200,
            render: (_v, r) => (
              <Space direction="vertical" size={2}>
                <Tag color={r.editRequestCount >= 3 ? 'red' : 'processing'}>{r.editRequestCount}/3 запросов</Tag>
                {r.lastEditRequestComment ? (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    Последний: {r.lastEditRequestByName || '—'}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 210,
            render: (_v, r) => (
              <Space>
                {(isSuperAdmin || user?.id === r.author.id) ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingId(r.id);
                      editForm.setFieldsValue({
                        clientId: r.clientId,
                        callResult: r.callResult,
                        status: r.status || undefined,
                        comment: r.comment,
                        lastCallAt: dayjs(r.lastCallAt),
                        nextCallAt: r.nextCallAt ? dayjs(r.nextCallAt) : null,
                      });
                      setEditOpen(true);
                    }}
                  >
                    Редактировать
                  </Button>
                ) : (
                  <Button
                    size="small"
                    onClick={() => {
                      setRequestRowId(r.id);
                      setRequestComment('');
                      setEditRequestOpen(true);
                    }}
                    disabled={r.editRequestCount >= 3}
                  >
                    Запрос правки
                  </Button>
                )}
                {(isSuperAdmin || user?.id === r.author.id) && (
                  <Popconfirm title="Удалить запись?" onConfirm={() => removeMut.mutate(r.id)}>
                    <Button danger size="small">
                      Удалить
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="Новая запись"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
        }}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
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
            <Select
              mode="tags"
              maxCount={1}
              tokenSeparators={[',']}
              placeholder="Выберите базовый или введите свой"
              options={BASE_STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Form.Item>
          <Form.Item name="comment" label="Коммент" rules={[{ required: true, message: 'Введите комментарий' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Редактировать заметку"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => {
            if (!editingId) return;
            updateMut.mutate({
              id: editingId,
              data: {
                callResult: v.callResult as CallResult,
                status: (v.status || '').trim() || null,
                comment: (v.comment || '').trim(),
                lastCallAt: v.lastCallAt?.toISOString(),
                nextCallAt: v.nextCallAt ? v.nextCallAt.toISOString() : null,
              },
            });
          }}
        >
          <Form.Item name="callResult" label="Дозвон" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'ANSWERED', label: CALL_RESULT_LABEL.ANSWERED },
                { value: 'NO_ANSWER', label: CALL_RESULT_LABEL.NO_ANSWER },
              ]}
            />
          </Form.Item>
          <Form.Item name="lastCallAt" label="Дата последнего обзвона" rules={[{ required: true }]}>
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="nextCallAt" label="Напомнить на дату">
            <DatePicker showTime style={{ width: '100%' }} format="DD.MM.YYYY HH:mm" />
          </Form.Item>
          <Form.Item name="status" label="Статус">
            <Select
              mode="tags"
              maxCount={1}
              tokenSeparators={[',']}
              options={BASE_STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Form.Item>
          <Form.Item name="comment" label="Комментарий" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Запрос на правку"
        open={editRequestOpen}
        onCancel={() => setEditRequestOpen(false)}
        onOk={() => {
          const t = requestComment.trim();
          if (!requestRowId) return;
          if (!t) {
            message.warning('Введите комментарий для запроса');
            return;
          }
          requestEditMut.mutate({ id: requestRowId, comment: t });
        }}
        confirmLoading={requestEditMut.isPending}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message="Редактирование записей отключено"
          description="Можно отправить до 3 запросов на правку с комментарием."
        />
        <Input.TextArea
          rows={4}
          value={requestComment}
          onChange={(e) => setRequestComment(e.target.value)}
          placeholder="Что нужно исправить?"
          maxLength={1000}
          showCount
        />
      </Modal>

      <Drawer
        title="Мои отправленные запросы"
        open={myRequestsOpen}
        onClose={() => setMyRequestsOpen(false)}
        width={460}
      >
        {myRequestsLoading ? (
          <Typography.Text type="secondary">Загрузка...</Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {(myRequestsData?.items || []).map((item) => (
              <Card key={item.id} size="small" style={{ borderRadius: 12 }}>
                <Typography.Text strong>{item.client.companyName}</Typography.Text>
                <Typography.Paragraph style={{ margin: '8px 0' }}>{item.comment}</Typography.Paragraph>
                <Divider style={{ margin: '8px 0' }} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(item.createdAt).format('DD.MM.YYYY HH:mm')} · Автор заметки: {item.noteAuthor.fullName}
                </Typography.Text>
              </Card>
            ))}
            {(myRequestsData?.items || []).length === 0 && (
              <Typography.Text type="secondary">Вы еще не отправляли запросы на правку.</Typography.Text>
            )}
          </Space>
        )}
      </Drawer>

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
