import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Button, Card, Col, DatePicker, Empty, Input, InputNumber, Modal, Popconfirm, Row, Segmented, Select, Space,
  Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import {
  clientRequestsApi,
  type ClientRequest,
  type ClientRequestInput,
  type ClientRequestKind,
  type ClientRequestStatus,
} from '../api/clientRequests.api';
import { useAuthStore } from '../store/authStore';
import { matchesSearch, smartFilterOption } from '../utils/translit';

const STATUS: Record<ClientRequestStatus, { label: string; color: string }> = {
  NEW: { label: 'Новый', color: 'blue' },
  IN_PROGRESS: { label: 'В работе', color: 'gold' },
  DONE: { label: 'Выполнен', color: 'green' },
  REJECTED: { label: 'Отказ', color: 'default' },
};
const STATUS_ORDER: ClientRequestStatus[] = ['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED'];
const isClosed = (s: ClientRequestStatus) => s === 'DONE' || s === 'REJECTED';

type StatusFilter = ClientRequestStatus | 'OPEN' | 'ALL';

const fmtDate = (iso: string) => dayjs(iso).format('DD.MM.YYYY');
const fmtQty = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });

function apiError(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: { details?: string[]; error?: string } } }).response?.data;
  return data?.details?.join(', ') || data?.error || fallback;
}

type FormState = {
  clientId: string | null;
  clientLabel: string | null;
  kind: ClientRequestKind;
  productMode: 'catalog' | 'custom';
  productId: string | null;
  productName: string;
  quantity: number | null;
  unit: string;
  description: string;
  dueDate: Dayjs | null;
  status: ClientRequestStatus;
  resolution: string;
};

const emptyForm: FormState = {
  clientId: null,
  clientLabel: null,
  kind: 'PRODUCT',
  productMode: 'catalog',
  productId: null,
  productName: '',
  quantity: null,
  unit: '',
  description: '',
  dueDate: null,
  status: 'NEW',
  resolution: '',
};

/**
 * Запросы клиентов: какой товар (или что-то другое) хочет клиент. Менеджер записывает,
 * ВЭД и админы видят, что чаще всего просят, и ведут запрос до результата.
 */
export default function ClientRequestsPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [kindFilter, setKindFilter] = useState<ClientRequestKind | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ClientRequest | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [clientSearch, setClientSearch] = useState('');

  const listParams = {
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    kind: kindFilter === 'ALL' ? undefined : kindFilter,
  };
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['client-requests', listParams],
    queryFn: () => clientRequestsApi.list(listParams),
  });
  const { data: summary } = useQuery({
    queryKey: ['client-requests-summary'],
    queryFn: clientRequestsApi.summary,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['client-requests-products'],
    queryFn: clientRequestsApi.products,
    staleTime: 5 * 60_000,
    enabled: editing !== null,
  });
  const { data: clientOptions = [], isFetching: clientsLoading } = useQuery({
    queryKey: ['client-requests-clients', clientSearch],
    queryFn: () => clientRequestsApi.clients(clientSearch),
    enabled: editing !== null,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-requests'] });
    queryClient.invalidateQueries({ queryKey: ['client-requests-summary'] });
  };

  const saveMut = useMutation({
    mutationFn: ({ id, data }: { id: string | null; data: ClientRequestInput }) =>
      (id ? clientRequestsApi.update(id, data) : clientRequestsApi.create(data)),
    onSuccess: () => {
      message.success('Сохранено');
      setEditing(null);
      invalidate();
    },
    onError: (err) => message.error(apiError(err, 'Не удалось сохранить')),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ClientRequestStatus }) => clientRequestsApi.update(id, { status }),
    onSuccess: invalidate,
    onError: (err) => message.error(apiError(err, 'Не удалось сменить статус')),
  });

  const deleteMut = useMutation({
    mutationFn: clientRequestsApi.remove,
    onSuccess: () => {
      message.success('Удалено');
      invalidate();
    },
    onError: (err) => message.error(apiError(err, 'Не удалось удалить')),
  });

  const openNew = () => {
    setForm(emptyForm);
    setClientSearch('');
    setEditing('new');
  };

  const openEdit = (r: ClientRequest, status?: ClientRequestStatus) => {
    setForm({
      clientId: r.clientId,
      clientLabel: r.client.companyName,
      kind: r.kind,
      productMode: r.productId || !r.productName ? 'catalog' : 'custom',
      productId: r.productId,
      productName: r.productName ?? '',
      quantity: r.quantity,
      unit: r.unit ?? '',
      description: r.description ?? '',
      dueDate: r.dueDate ? dayjs(r.dueDate) : null,
      status: status ?? r.status,
      resolution: r.resolution ?? '',
    });
    setClientSearch('');
    setEditing(r);
  };

  const submit = () => {
    if (!form.clientId) {
      message.warning('Выберите клиента');
      return;
    }
    const isProduct = form.kind === 'PRODUCT';
    const fromCatalog = form.productMode === 'catalog';
    const data: ClientRequestInput = {
      clientId: form.clientId,
      kind: form.kind,
      productId: isProduct && fromCatalog ? form.productId : null,
      productName: isProduct && !fromCatalog ? form.productName.trim() || null : null,
      quantity: isProduct ? form.quantity : null,
      unit: isProduct && !fromCatalog ? form.unit.trim() || null : null,
      description: form.description.trim() || null,
      dueDate: form.dueDate ? form.dueDate.endOf('day').toISOString() : null,
    };
    if (editing && editing !== 'new') {
      data.status = form.status;
      data.resolution = form.resolution.trim() || null;
    }
    saveMut.mutate({ id: editing && editing !== 'new' ? editing.id : null, data });
  };

  const visibleRows = useMemo(() => {
    if (!search) return rows;
    return rows.filter((r) => matchesSearch(
      [
        r.client.companyName, r.client.contactName, r.client.manager.fullName, r.author.fullName,
        r.product?.name ?? '', r.productName ?? '', r.description ?? '', r.resolution ?? '',
      ].join(' '),
      search,
    ));
  }, [rows, search]);

  const counts = summary?.counts ?? {};
  const openCount = (counts.NEW ?? 0) + (counts.IN_PROGRESS ?? 0);

  const whatCell = (r: ClientRequest) => {
    if (r.kind === 'OTHER') {
      return (
        <div>
          <Tag color="purple">Другое</Tag>
          <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{r.description}</Typography.Text>
        </div>
      );
    }
    const name = r.product?.name ?? r.productName ?? '—';
    const unit = r.product?.unit ?? r.unit ?? '';
    return (
      <div>
        <Typography.Text strong>{name}</Typography.Text>
        {r.quantity != null && <Typography.Text> · {fmtQty(r.quantity)} {unit}</Typography.Text>}
        <div style={{ marginTop: 2 }}>
          {r.product
            ? (r.product.stock > 0
              ? <Tag color="green">На складе {fmtQty(r.product.stock)} {r.product.unit}</Tag>
              : <Tag color="red">Нет на складе</Tag>)
            : <Tag color="orange">Нет в каталоге</Tag>}
        </div>
        {r.description && (
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {r.description}
          </Typography.Text>
        )}
      </div>
    );
  };

  const columns: ColumnsType<ClientRequest> = [
    {
      title: 'Дата',
      key: 'createdAt',
      width: 100,
      render: (_, r) => (
        <div>
          {fmtDate(r.createdAt)}
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{r.author.fullName}</Typography.Text>
        </div>
      ),
    },
    {
      title: 'Клиент',
      key: 'client',
      width: 210,
      render: (_, r) => (
        <div>
          <Link to={`/clients/${r.clientId}`}>{r.client.companyName}</Link>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            Менеджер: {r.client.manager.fullName}
          </Typography.Text>
        </div>
      ),
    },
    { title: 'Что хочет', key: 'what', render: (_, r) => whatCell(r) },
    {
      title: 'Срок',
      key: 'dueDate',
      width: 100,
      render: (_, r) => {
        if (!r.dueDate) return <Typography.Text type="secondary">—</Typography.Text>;
        const overdue = !isClosed(r.status) && dayjs(r.dueDate).isBefore(dayjs(), 'day');
        return <Typography.Text type={overdue ? 'danger' : undefined}>{fmtDate(r.dueDate)}</Typography.Text>;
      },
    },
    {
      title: 'Статус',
      key: 'status',
      width: 170,
      render: (_, r) => (
        <div>
          <Select<ClientRequestStatus>
            size="small"
            value={r.status}
            style={{ width: 130 }}
            onChange={(status) => {
              // Закрывая запрос, сразу просим написать, чем закончилось
              if (isClosed(status)) openEdit(r, status);
              else statusMut.mutate({ id: r.id, status });
            }}
            options={STATUS_ORDER.map((s) => ({ value: s, label: <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag> }))}
          />
          {r.resolution && (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {r.resolution}
            </Typography.Text>
          )}
          {r.closedAt && r.closedBy && (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              {r.closedBy.fullName}, {fmtDate(r.closedAt)}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Изменить">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          {(isAdmin || r.author.id === me?.id) && (
            <Popconfirm title="Удалить запрос?" okText="Удалить" cancelText="Нет" onConfirm={() => deleteMut.mutate(r.id)}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const editingRow = editing && editing !== 'new' ? editing : null;
  const selectedClientMissing = form.clientId && !clientOptions.some((c) => c.id === form.clientId);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Запросы клиентов</Typography.Title>
          <Typography.Text type="secondary">Что хочет клиент: товар, которого нет, или что-то другое</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Новый запрос</Button>
      </Space>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={9}>
          <Card size="small" title="Статусы" style={{ height: '100%' }}>
            <Row gutter={[8, 8]}>
              {STATUS_ORDER.map((s) => (
                <Col span={12} key={s}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => setStatusFilter(s)}
                    style={{ borderColor: statusFilter === s ? '#1677ff' : undefined }}
                  >
                    <Tag color={STATUS[s].color}>{STATUS[s].label}</Tag>
                    <div style={{ fontSize: 22, fontWeight: 600 }}>{counts[s] ?? 0}</div>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card size="small" title={`Что чаще всего просят (открытые: ${openCount})`} style={{ height: '100%' }}>
            {summary && summary.topProducts.length > 0 ? (
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ y: 200, x: 480 }}
                dataSource={summary.topProducts}
                columns={[
                  { title: 'Товар', dataIndex: 'name', key: 'name' },
                  { title: 'Клиентов', dataIndex: 'clients', key: 'clients', width: 90, align: 'right' },
                  {
                    title: 'Сколько хотят',
                    key: 'qty',
                    width: 130,
                    align: 'right',
                    render: (_, g) => (g.quantity > 0 ? `${fmtQty(g.quantity)} ${g.unit ?? ''}` : '—'),
                  },
                  {
                    title: 'Склад',
                    key: 'stock',
                    width: 120,
                    render: (_, g) => (g.stock == null
                      ? <Tag color="orange">Нет в каталоге</Tag>
                      : g.stock > 0 ? <Tag color="green">{fmtQty(g.stock)}</Tag> : <Tag color="red">0</Tag>),
                  },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Открытых запросов на товары нет" />
            )}
          </Card>
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'OPEN', label: 'Открытые' },
            ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS[s].label })),
            { value: 'ALL', label: 'Все' },
          ]}
        />
        <Segmented<ClientRequestKind | 'ALL'>
          value={kindFilter}
          onChange={setKindFilter}
          options={[
            { value: 'ALL', label: 'Всё' },
            { value: 'PRODUCT', label: 'Товары' },
            { value: 'OTHER', label: 'Другое' },
          ]}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Клиент, товар, менеджер…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={visibleRows}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty description="Запросов нет" /> }}
      />

      <Modal
        open={editing !== null}
        title={editingRow ? 'Запрос клиента' : 'Новый запрос клиента'}
        okText="Сохранить"
        cancelText="Отмена"
        onOk={submit}
        confirmLoading={saveMut.isPending}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Typography.Text strong>Клиент</Typography.Text>
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder="Начните вводить название или телефон"
              value={form.clientId ?? undefined}
              filterOption={false}
              onSearch={setClientSearch}
              loading={clientsLoading}
              onChange={(id: string) => setForm((f) => ({ ...f, clientId: id, clientLabel: null }))}
              notFoundContent={clientsLoading ? 'Ищем…' : 'Не найдено'}
              options={[
                ...(selectedClientMissing && form.clientLabel ? [{ value: form.clientId!, label: form.clientLabel }] : []),
                ...clientOptions.map((c) => ({
                  value: c.id,
                  label: `${c.companyName}${c.contactName ? ` — ${c.contactName}` : ''} (${c.manager.fullName})`,
                })),
              ]}
            />
          </div>

          <Segmented<ClientRequestKind>
            block
            value={form.kind}
            onChange={(kind) => setForm((f) => ({ ...f, kind }))}
            options={[
              { value: 'PRODUCT', label: 'Хочет товар' },
              { value: 'OTHER', label: 'Другое' },
            ]}
          />

          {form.kind === 'PRODUCT' && (
            <>
              <Segmented<'catalog' | 'custom'>
                size="small"
                value={form.productMode}
                onChange={(productMode) => setForm((f) => ({ ...f, productMode }))}
                options={[
                  { value: 'catalog', label: 'Из каталога' },
                  { value: 'custom', label: 'Нет в каталоге' },
                ]}
              />
              {form.productMode === 'catalog' ? (
                <Select
                  showSearch
                  style={{ width: '100%' }}
                  placeholder="Выберите товар"
                  value={form.productId ?? undefined}
                  filterOption={smartFilterOption}
                  onChange={(productId: string) => setForm((f) => ({ ...f, productId }))}
                  options={products.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${p.sku}) — склад ${fmtQty(p.stock)} ${p.unit}`,
                  }))}
                />
              ) : (
                <Input
                  placeholder="Название товара, как говорит клиент"
                  value={form.productName}
                  onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                />
              )}
              <Space.Compact style={{ width: '100%' }}>
                <InputNumber
                  style={{ width: '60%' }}
                  min={0}
                  placeholder="Сколько нужно"
                  value={form.quantity}
                  onChange={(quantity) => setForm((f) => ({ ...f, quantity: quantity ?? null }))}
                />
                {form.productMode === 'custom' ? (
                  <Input
                    style={{ width: '40%' }}
                    placeholder="ед. (кг, шт, лист)"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  />
                ) : (
                  <Input
                    style={{ width: '40%' }}
                    disabled
                    value={products.find((p) => p.id === form.productId)?.unit ?? ''}
                  />
                )}
              </Space.Compact>
            </>
          )}

          <Input.TextArea
            rows={3}
            placeholder={form.kind === 'OTHER'
              ? 'Что хочет клиент: отсрочку, доставку, другой формат…'
              : 'Комментарий: плотность, цвет, цена, к какому сроку…'}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />

          <div>
            <Typography.Text strong>Срок</Typography.Text>
            <DatePicker
              style={{ width: '100%' }}
              format="DD.MM.YYYY"
              placeholder="Когда нужно клиенту (необязательно)"
              value={form.dueDate}
              onChange={(dueDate) => setForm((f) => ({ ...f, dueDate }))}
            />
          </div>

          {editingRow && (
            <>
              <div>
                <Typography.Text strong>Статус</Typography.Text>
                <Select<ClientRequestStatus>
                  style={{ width: '100%' }}
                  value={form.status}
                  onChange={(status) => setForm((f) => ({ ...f, status }))}
                  options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS[s].label }))}
                />
              </div>
              <Input.TextArea
                rows={2}
                placeholder="Чем закончилось: привезли, предложили аналог, отказались…"
                value={form.resolution}
                onChange={(e) => setForm((f) => ({ ...f, resolution: e.target.value }))}
              />
            </>
          )}
        </Space>
      </Modal>
    </div>
  );
}
