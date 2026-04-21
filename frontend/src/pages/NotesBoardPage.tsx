import { useEffect, useMemo, useState } from 'react';
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
  Row,
  Col,
  Statistic,
  Progress,
  theme as antdTheme,
} from 'antd';
import dayjs from 'dayjs';
import {
  PlusOutlined,
  PhoneOutlined,
  CloseCircleOutlined,
  TeamOutlined,
  PieChartOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { notesBoardApi } from '../api/notes-board.api';
import { clientsApi } from '../api/clients.api';
import { useAuthStore } from '../store/authStore';
import { smartFilterOption } from '../utils/translit';

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

/** Select mode="tags" может вернуть строку или массив из одного тега — иначе .trim() ломает сохранение. */
function normalizeStatusField(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const s = v[0];
    return typeof s === 'string' ? s.trim() || undefined : undefined;
  }
  if (typeof v === 'string') return v.trim() || undefined;
  return undefined;
}

export default function NotesBoardPage() {
  const { token: tk } = antdTheme.useToken();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchDraft, setSearchDraft] = useState('');
  const [q, setQ] = useState('');
  const [callResultFilter, setCallResultFilter] = useState<CallResult | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [authorFilter, setAuthorFilter] = useState<string | undefined>(undefined);
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
  const isAdmin = user?.role === 'ADMIN';
  const canEditNote = (authorId: string) =>
    !!user?.id && (isSuperAdmin || isAdmin || user.id === authorId);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
  });

  // Debounce search input so typed spaces / multi-word queries work naturally.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchDraft === q) return;
      setPage(1);
      setQ(searchDraft);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft, q]);

  const { data, isLoading } = useQuery({
    queryKey: ['notes-board', page, pageSize, q, callResultFilter, statusFilter, authorFilter],
    queryFn: () =>
      notesBoardApi.list({
        page,
        pageSize,
        q: q.trim() || undefined,
        callResult: callResultFilter,
        status: statusFilter || undefined,
        authorId: authorFilter,
      }),
  });

  const canSeeAnalytics = isSuperAdmin || isAdmin;
  const { data: stats } = useQuery({
    queryKey: ['notes-board-stats'],
    queryFn: () => notesBoardApi.stats(),
    enabled: canSeeAnalytics,
    refetchInterval: 30_000,
  });

  const { data: myRequestsData, isLoading: myRequestsLoading } = useQuery({
    queryKey: ['notes-board-my-edit-requests', myRequestsOpen],
    queryFn: () => notesBoardApi.listMyEditRequests({ page: 1, pageSize: 100 }),
    enabled: myRequestsOpen,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes-board'] });
    void queryClient.invalidateQueries({ queryKey: ['notes-board-stats'] });
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
      editForm.resetFields();
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

  const answeredCount = useMemo(
    () => stats?.byCallResult.find((r) => r.callResult === 'ANSWERED')?.count || 0,
    [stats],
  );
  const noAnswerCount = useMemo(
    () => stats?.byCallResult.find((r) => r.callResult === 'NO_ANSWER')?.count || 0,
    [stats],
  );
  const answerRate = stats && stats.total > 0 ? Math.round((answeredCount / stats.total) * 100) : 0;
  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    (stats?.byStatus || []).forEach((s) => {
      const name = (s.status || '').trim();
      if (name) map.set(name, (map.get(name) || 0) + s.count);
    });
    return map;
  }, [stats]);
  const customStatuses = useMemo(
    () =>
      Array.from(statusCounts.keys())
        .filter((s) => !(BASE_STATUSES as readonly string[]).includes(s))
        .sort((a, b) => (statusCounts.get(b) || 0) - (statusCounts.get(a) || 0))
        .slice(0, 6),
    [statusCounts],
  );
  const noStatusCount =
    (stats?.total || 0) -
    Array.from(statusCounts.values()).reduce((acc, v) => acc + v, 0);
  const activeFilterChips = [
    q && { key: 'q', label: `Поиск: "${q}"`, onClose: () => { setSearchDraft(''); setQ(''); setPage(1); } },
    callResultFilter && {
      key: 'cr',
      label: `Дозвон: ${CALL_RESULT_LABEL[callResultFilter]}`,
      onClose: () => { setCallResultFilter(undefined); setPage(1); },
    },
    statusFilter && {
      key: 'st',
      label: `Статус: ${statusFilter}`,
      onClose: () => { setStatusFilter(undefined); setPage(1); },
    },
    authorFilter && {
      key: 'au',
      label: `Автор: ${stats?.byAuthor.find((a) => a.authorId === authorFilter)?.authorName || '—'}`,
      onClose: () => { setAuthorFilter(undefined); setPage(1); },
    },
  ].filter(Boolean) as Array<{ key: string; label: string; onClose: () => void }>;

  const statPill = (opts: {
    label: string;
    value: number;
    color: string;
    active: boolean;
    onClick: () => void;
  }) => (
    <Card
      size="small"
      hoverable
      onClick={opts.onClick}
      styles={{ body: { padding: '12px 14px' } }}
      style={{
        borderRadius: 14,
        cursor: 'pointer',
        borderColor: opts.active ? opts.color : tk.colorBorderSecondary,
        borderWidth: opts.active ? 2 : 1,
        background: opts.active ? `${opts.color}14` : tk.colorBgContainer,
        transition: 'all 0.18s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Typography.Text style={{ color: opts.color, fontSize: 12, fontWeight: 600, letterSpacing: 0.3 }}>
          {opts.label.toUpperCase()}
        </Typography.Text>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: opts.active ? opts.color : tk.colorBorder,
          }}
        />
      </div>
      <Typography.Title level={3} style={{ margin: '4px 0 0', color: opts.color }}>
        {opts.value.toLocaleString('ru-RU')}
      </Typography.Title>
    </Card>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Заметки обзвонов
        </Typography.Title>
        <Space wrap>
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

      {canSeeAnalytics && stats ? (
        <Card
          size="small"
          style={{ marginBottom: 12, borderRadius: 16 }}
          styles={{ body: { padding: 16 } }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <Space>
              <PieChartOutlined style={{ color: tk.colorPrimary }} />
              <Typography.Text strong>Аналитика звонков</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                нажмите на карточку, чтобы отфильтровать
              </Typography.Text>
            </Space>
            {activeFilterChips.length > 0 ? (
              <Space wrap size={[4, 4]}>
                {activeFilterChips.map((c) => (
                  <Tag key={c.key} closable onClose={c.onClose} color="blue">
                    {c.label}
                  </Tag>
                ))}
              </Space>
            ) : null}
          </div>

          <Row gutter={[12, 12]}>
            <Col xs={24} md={6}>
              <Card
                size="small"
                hoverable
                onClick={() => {
                  setCallResultFilter(undefined);
                  setStatusFilter(undefined);
                  setAuthorFilter(undefined);
                  setPage(1);
                }}
                style={{
                  borderRadius: 14,
                  borderColor: tk.colorBorderSecondary,
                  background: `linear-gradient(135deg, ${tk.colorPrimary}18 0%, ${tk.colorBgContainer} 100%)`,
                  cursor: 'pointer',
                }}
                styles={{ body: { padding: 14 } }}
              >
                <Statistic
                  title={<span style={{ fontSize: 12, color: tk.colorTextSecondary }}>ВСЕГО ЗВОНКОВ</span>}
                  value={stats.total}
                  valueStyle={{ fontSize: 28, fontWeight: 700 }}
                />
                <Progress
                  percent={answerRate}
                  size="small"
                  strokeColor={tk.colorSuccess}
                  format={(p) => `${p}% дозвон`}
                  style={{ marginTop: 6 }}
                />
              </Card>
            </Col>
            <Col xs={12} md={3}>
              {statPill({
                label: 'Дозвонились',
                value: answeredCount,
                color: tk.colorSuccess,
                active: callResultFilter === 'ANSWERED',
                onClick: () => {
                  setCallResultFilter(callResultFilter === 'ANSWERED' ? undefined : 'ANSWERED');
                  setPage(1);
                },
              })}
            </Col>
            <Col xs={12} md={3}>
              {statPill({
                label: 'Не взяли',
                value: noAnswerCount,
                color: tk.colorError,
                active: callResultFilter === 'NO_ANSWER',
                onClick: () => {
                  setCallResultFilter(callResultFilter === 'NO_ANSWER' ? undefined : 'NO_ANSWER');
                  setPage(1);
                },
              })}
            </Col>
            {BASE_STATUSES.map((s) => {
              const count = statusCounts.get(s) || 0;
              const colorName = STATUS_COLORS[s];
              const colorHex: Record<string, string> = {
                green: tk.colorSuccess,
                gold: tk.colorWarning,
                blue: tk.colorPrimary,
                default: tk.colorTextTertiary,
              };
              return (
                <Col xs={12} md={3} key={s}>
                  {statPill({
                    label: s,
                    value: count,
                    color: colorHex[colorName] || tk.colorPrimary,
                    active: statusFilter === s,
                    onClick: () => {
                      setStatusFilter(statusFilter === s ? undefined : s);
                      setPage(1);
                    },
                  })}
                </Col>
              );
            })}
          </Row>

          {(customStatuses.length > 0 || (stats.byAuthor || []).length > 0 || noStatusCount > 0) ? (
            <>
              <Divider style={{ margin: '14px 0 10px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {customStatuses.length > 0 ? (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>Доп. статусы:</Typography.Text>
                    <Space wrap size={[4, 6]}>
                      {noStatusCount > 0 ? (
                        <Tag
                          style={{ cursor: 'default' }}
                        >
                          без статуса · {noStatusCount}
                        </Tag>
                      ) : null}
                      {customStatuses.map((s) => (
                        <Tag
                          key={s}
                          color={statusColor(s)}
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => {
                            setStatusFilter(statusFilter === s ? undefined : s);
                            setPage(1);
                          }}
                        >
                          {s} · {statusCounts.get(s) || 0}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                ) : null}
                {(stats.byAuthor || []).length > 0 ? (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
                      <TeamOutlined /> Авторы:
                    </Typography.Text>
                    <Space wrap size={[4, 6]}>
                      {(stats.byAuthor || []).slice(0, 10).map((a) => (
                        <Tag
                          key={a.authorId}
                          color={authorFilter === a.authorId ? 'processing' : undefined}
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => {
                            setAuthorFilter(authorFilter === a.authorId ? undefined : a.authorId);
                            setPage(1);
                          }}
                        >
                          {a.authorName} · {a.count}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card size="small" style={{ marginBottom: 12, borderRadius: 14 }}>
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: tk.colorTextTertiary }} />}
            placeholder="Поиск (RU/EN): клиент, коммент, статус..."
            style={{ width: 340 }}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <Select
            allowClear
            placeholder={<span><PhoneOutlined /> Дозвон</span>}
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
            suffixIcon={<CloseCircleOutlined style={{ display: 'none' }} />}
          />
          <Select
            allowClear
            showSearch
            placeholder="Статус"
            value={statusFilter}
            style={{ width: 220 }}
            filterOption={smartFilterOption}
            onChange={(v) => {
              setPage(1);
              setStatusFilter(v);
            }}
            options={[...BASE_STATUSES, ...Array.from(new Set(rows.map((r) => (r.status || '').trim()).filter(Boolean)))].map((s) => ({
              label: s,
              value: s,
            }))}
          />
          {canSeeAnalytics && (stats?.byAuthor || []).length > 0 ? (
            <Select
              allowClear
              showSearch
              placeholder="Автор"
              value={authorFilter}
              style={{ width: 220 }}
              filterOption={smartFilterOption}
              onChange={(v) => {
                setPage(1);
                setAuthorFilter(v);
              }}
              options={(stats?.byAuthor || []).map((a) => ({
                label: `${a.authorName} (${a.count})`,
                value: a.authorId,
              }))}
            />
          ) : null}
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
                {canEditNote(r.author.id) ? (
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
              status: normalizeStatusField(v.status),
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
              placeholder="Введите название (RU/EN работает одинаково)"
              filterOption={smartFilterOption}
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
        onCancel={() => {
          setEditOpen(false);
          setEditingId(null);
        }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(v) => {
            if (!editingId) return;
            const st = normalizeStatusField(v.status);
            updateMut.mutate({
              id: editingId,
              data: {
                callResult: v.callResult as CallResult,
                status: st ?? null,
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
          message="Запрос автору на правку"
          description="Автор и администраторы могут править запись сами. Остальные — до 3 запросов с комментарием."
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
