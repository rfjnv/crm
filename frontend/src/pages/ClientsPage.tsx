import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Table, Button, Modal, Form, Input, Typography, message, Space, Popconfirm, Select, Card, Collapse } from 'antd';
import { PlusOutlined, InboxOutlined, EditOutlined, CrownFilled } from '@ant-design/icons';
import { clientsApi, type CreateClientData } from '../api/clients.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/MobileCardList';
import { ClientCompanyDisplay } from '../components/ClientCompanyDisplay';
import { APP_BUTTON, APP_INPUT } from '../components/ui/AppClassNames';
import type { Client } from '../types';
import dayjs from 'dayjs';

type ClientSortMode = 'name_asc' | 'name_desc' | 'created_desc' | 'contact_desc';

const CLIENT_SORT_OPTIONS: { value: ClientSortMode; label: string }[] = [
  { value: 'name_asc', label: 'А → Я' },
  { value: 'name_desc', label: 'Я → А' },
  { value: 'created_desc', label: 'По дате создания' },
  { value: 'contact_desc', label: 'По последнему контакту' },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function parseSortParam(v: string | null): ClientSortMode {
  const x = v ?? '';
  if (x === 'name_desc' || x === 'created_desc' || x === 'contact_desc' || x === 'name_asc') return x;
  return 'name_asc';
}

function parseClientsListParams(sp: URLSearchParams) {
  const rawPage = parseInt(sp.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPs = parseInt(sp.get('pageSize') || '20', 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawPs) ? rawPs : 20;
  return {
    page,
    pageSize,
    q: sp.get('q') ?? '',
    manager: sp.get('manager') || undefined,
    sort: parseSortParam(sp.get('sort')),
  };
}

function mergeClientsListSearchParams(
  prev: URLSearchParams,
  patch: Partial<{ page: number; pageSize: number; q: string; manager: string | undefined; sort: ClientSortMode }>,
): URLSearchParams {
  const cur = parseClientsListParams(prev);
  const next = {
    page: patch.page ?? cur.page,
    pageSize: patch.pageSize ?? cur.pageSize,
    q: patch.q !== undefined ? patch.q : cur.q,
    manager: Object.prototype.hasOwnProperty.call(patch, 'manager')
      ? (patch.manager || undefined)
      : cur.manager,
    sort: patch.sort ?? cur.sort,
  };
  const n = new URLSearchParams();
  if (next.page !== 1) n.set('page', String(next.page));
  if (next.pageSize !== 20) n.set('pageSize', String(next.pageSize));
  if (next.q.trim()) n.set('q', next.q.trim());
  if (next.manager) n.set('manager', next.manager);
  if (next.sort !== 'name_asc') n.set('sort', next.sort);
  return n;
}

function compareCompanyName(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { sensitivity: 'base' });
}

function ts(iso: string | null | undefined): number {
  if (!iso) return 0;
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function lastContactTs(c: Client): number {
  return ts(c.lastContactAt ?? c.updatedAt);
}

function sortClients(list: Client[], mode: ClientSortMode): Client[] {
  const out = [...list];
  switch (mode) {
    case 'name_asc':
      return out.sort((a, b) => compareCompanyName(a.companyName, b.companyName));
    case 'name_desc':
      return out.sort((a, b) => compareCompanyName(b.companyName, a.companyName));
    case 'created_desc':
      return out.sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
    case 'contact_desc':
      return out.sort((a, b) => lastContactTs(b) - lastContactTs(a));
    default:
      return out;
  }
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  // Remove leading 998 if user typed it (prefix is fixed)
  const local = digits.startsWith('998') ? digits.slice(3) : digits;
  const d = local.slice(0, 9);
  let result = '+998';
  if (d.length > 0) result += ' ' + d.slice(0, 2);
  if (d.length > 2) result += ' ' + d.slice(2, 5);
  if (d.length > 5) result += ' ' + d.slice(5, 7);
  if (d.length > 7) result += ' ' + d.slice(7, 9);
  return result;
}

function PhoneInput({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const display = value || '+998';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Don't let user delete the prefix
    if (raw.replace(/\D/g, '').length < 3 && !raw.startsWith('+998')) {
      onChange?.('+998');
      return;
    }
    onChange?.(formatPhone(raw));
  };

  return <Input value={display} onChange={handleChange} placeholder="+998 99 999 99 99" />;
}

export default function ClientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(() => parseClientsListParams(searchParams), [searchParams]);
  const { page, pageSize, q: qUrl, manager: managerFilter, sort: sortMode } = listState;

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchDraft, setSearchDraft] = useState(listState.q);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();

  useEffect(() => {
    setSearchDraft(qUrl);
  }, [qUrl]);

  const patchListParams = useCallback(
    (patch: Parameters<typeof mergeClientsListSearchParams>[1], nav?: { replace?: boolean }) => {
      setSearchParams((prev) => mergeClientsListSearchParams(prev, patch), nav);
    },
    [setSearchParams],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = searchDraft.trim();
      if (trimmed === qUrl.trim()) return;
      patchListParams({ q: trimmed, page: 1 }, { replace: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft, qUrl, patchListParams]);

  const { data: clients, isLoading } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list, refetchInterval: 10_000 });

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canAssignManager = isAdmin || user?.role === 'OPERATOR';

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: canAssignManager,
  });

  const filteredClients = useMemo(() => {
    let list = clients ?? [];
    const q = searchDraft.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        c.companyName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
      );
    }
    if (managerFilter) {
      list = list.filter(c => c.managerId === managerFilter);
    }
    return sortClients(list, sortMode);
  }, [clients, searchDraft, managerFilter, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (filteredClients.length === 0) return;
    if (page !== safePage) {
      patchListParams({ page: safePage }, { replace: true });
    }
  }, [filteredClients.length, page, safePage, patchListParams]);

  const createMut = useMutation({
    mutationFn: (data: CreateClientData) => clientsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Клиент создан');
      setOpen(false);
      form.resetFields();
    },
    onError: () => message.error('Ошибка создания клиента'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateClientData> }) => clientsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Клиент обновлён');
      setEditOpen(false);
      setEditingClient(null);
    },
    onError: () => message.error('Ошибка обновления клиента'),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => clientsApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Клиент архивирован');
    },
    onError: () => message.error('Ошибка архивирования'),
  });

  const svipMut = useMutation({
    mutationFn: (id: string) => clientsApi.toggleSvip(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success(data.isSvip ? 'Клиент отмечен как SVIP' : 'Статус SVIP снят');
    },
    onError: () => message.error('Ошибка изменения статуса'),
  });

  const creditStatusMut = useMutation({
    mutationFn: ({ id, creditStatus }: { id: string; creditStatus: 'NORMAL' | 'SATISFACTORY' | 'NEGATIVE' }) =>
      clientsApi.setCreditStatus(id, creditStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      message.success('Кредитный статус клиента обновлён');
    },
    onError: () => message.error('Ошибка изменения кредитного статуса'),
  });

  const openEdit = (client: Client) => {
    setEditingClient(client);
    editForm.setFieldsValue({
      companyName: client.companyName,
      contactName: client.contactName,
      phone: client.phone || '+998',
      email: client.email || '',
      address: client.address || '',
      notes: client.notes || '',
      managerId: client.managerId,
      inn: client.inn || '',
      bankName: client.bankName || '',
      bankAccount: client.bankAccount || '',
      mfo: client.mfo || '',
      vatRegCode: client.vatRegCode || '',
      oked: client.oked || '',
    });
    setEditOpen(true);
  };

  const columns = [
    {
      title: 'Компания',
      dataIndex: 'companyName',
      render: (_v: string, r: Client) => (
        <ClientCompanyDisplay
          client={{ id: r.id, companyName: r.companyName, isSvip: r.isSvip, creditStatus: r.creditStatus }}
          link
          variant="full"
        />
      ),
    },
    { title: 'Контакт', dataIndex: 'contactName' },
    { title: 'Телефон', dataIndex: 'phone' },
    { title: 'Email', dataIndex: 'email' },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    {
      title: 'Последний контакт',
      key: 'lastContact',
      width: 200,
      render: (_: unknown, r: Client) => {
        const ln = r.lastNote;
        if (!ln?.createdAt) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        return (
          <div>
            <Typography.Text>{dayjs(ln.createdAt).format('DD.MM.YYYY HH:mm')}</Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {ln.authorName}
              </Typography.Text>
            </div>
          </div>
        );
      },
    },
    ...(isAdmin || user?.permissions?.includes('edit_client')
      ? [{
        title: '',
        width: 140,
        render: (_: unknown, r: Client) => {
          const canEdit = isAdmin || user?.permissions?.includes('edit_client');
          return (
            <Space>
              {isAdmin && (
                <Button
                  type="text"
                  size="small"
                  icon={<CrownFilled style={{ color: r.isSvip ? '#faad14' : '#d9d9d9' }} />}
                  onClick={() => svipMut.mutate(r.id)}
                  title={r.isSvip ? 'Убрать SVIP' : 'Сделать SVIP'}
                />
              )}
              {isAdmin && (
                <Select<'NORMAL' | 'SATISFACTORY' | 'NEGATIVE'>
                  size="small"
                  value={r.creditStatus || 'NORMAL'}
                  style={{ width: 94 }}
                  onChange={(value) => creditStatusMut.mutate({ id: r.id, creditStatus: value })}
                  options={[
                    { value: 'NORMAL', label: 'Статус: —' },
                    { value: 'SATISFACTORY', label: 'Статус: У' },
                    { value: 'NEGATIVE', label: 'Статус: Н' },
                  ]}
                />
              )}
              {canEdit && <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEdit(r)} />}
              {isAdmin && (
                <Popconfirm title="Архивировать клиента?" onConfirm={() => archiveMut.mutate(r.id)}>
                  <Button type="text" danger icon={<InboxOutlined />} size="small" />
                </Popconfirm>
              )}
            </Space>
          );
        },
      }]
      : []),
  ];

  const clientFormFields = (isEditMode: boolean) => (
    <>
      <Form.Item name="companyName" label="Компания" rules={[{ required: true, message: 'Обязательное поле' }]}>
        <Input />
      </Form.Item>
      <Form.Item name="contactName" label="Контактное лицо" rules={[{ required: true, message: 'Обязательное поле' }]}>
        <Input />
      </Form.Item>
      <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
        <Form.Item name="phone" label="Телефон" style={{ flex: 1 }}>
          <PhoneInput />
        </Form.Item>
        <Form.Item name="email" label="Email" style={{ flex: 1 }}>
          <Input />
        </Form.Item>
      </Space>
      <Form.Item name="address" label="Адрес">
        <Input />
      </Form.Item>
      <Form.Item name="notes" label="Заметки">
        <Input.TextArea rows={2} />
      </Form.Item>
      {(isEditMode ? isAdmin : canAssignManager) && (
        <Form.Item name="managerId" label="Менеджер">
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={isEditMode ? undefined : 'По умолчанию — вы'}
            allowClear={!isEditMode}
            options={(users ?? []).filter((u) => u.isActive && u.role === 'MANAGER').map((u) => ({ label: u.fullName, value: u.id }))}
          />
        </Form.Item>
      )}
      <Collapse size="small" ghost items={[{
        key: 'requisites',
        label: 'Реквизиты (ИНН, банк, МФО)',
        children: (
          <>
            <Form.Item name="inn" label="ИНН">
              <Input placeholder="123456789" />
            </Form.Item>
            <Form.Item name="bankName" label="Банк">
              <Input placeholder="АКБ ..." />
            </Form.Item>
            <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
              <Form.Item name="bankAccount" label="Расчётный счёт" style={{ flex: 1 }}>
                <Input placeholder="20208000..." />
              </Form.Item>
              <Form.Item name="mfo" label="МФО" style={{ flex: 1 }}>
                <Input placeholder="00000" />
              </Form.Item>
            </Space>
            <Space style={{ width: '100%' }} size="middle" direction={isMobile ? 'vertical' : 'horizontal'}>
              <Form.Item name="vatRegCode" label="Рег. код НДС" style={{ flex: 1 }}>
                <Input />
              </Form.Item>
              <Form.Item name="oked" label="ОКЭД" style={{ flex: 1 }}>
                <Input />
              </Form.Item>
            </Space>
          </>
        ),
      }]} />
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Клиенты</Typography.Title>
        <Space wrap>
          <Input.Search
            className={APP_INPUT}
            placeholder="Поиск (компания, контакт, телефон, email)..."
            style={{ width: isMobile ? '100%' : 300 }}
            allowClear
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onSearch={(v) => {
              const t = v.trim();
              setSearchDraft(t);
              patchListParams({ q: t, page: 1 }, { replace: true });
            }}
          />
          {isAdmin && (
            <Select
              className={APP_INPUT}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Менеджер"
              style={{ width: isMobile ? '100%' : 200 }}
              value={managerFilter}
              onChange={(v) => patchListParams({ manager: v, page: 1 })}
              options={(users ?? []).filter(u => u.isActive && u.role === 'MANAGER').map(u => ({ label: u.fullName, value: u.id }))}
            />
          )}
          <Select<ClientSortMode>
            className={APP_INPUT}
            value={sortMode}
            onChange={(v) => patchListParams({ sort: v, page: 1 })}
            style={{ width: isMobile ? '100%' : 260 }}
            options={CLIENT_SORT_OPTIONS}
            popupMatchSelectWidth={false}
          />
          <Button type="primary" className={APP_BUTTON} icon={<PlusOutlined />} onClick={() => setOpen(true)}>Добавить</Button>
        </Space>
      </div>

      {isMobile ? (
        <MobileCardList
          data={filteredClients}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: safePage,
            pageSize,
            onChange: (p, ps) => patchListParams({ page: p, pageSize: ps }),
          }}
          renderCard={(client: Client) => (
            <Card size="small" style={{ marginBottom: 0, ...(client.isSvip ? { borderLeft: '3px solid #faad14' } : {}) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <ClientCompanyDisplay
                    client={{
                      id: client.id,
                      companyName: client.companyName,
                      isSvip: client.isSvip,
                      creditStatus: client.creditStatus,
                    }}
                    link
                    variant="full"
                  />
                  <div style={{ marginTop: 2 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{client.contactName}</Typography.Text>
                  </div>
                  {client.phone && (
                    <div style={{ marginTop: 2 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{client.phone}</Typography.Text>
                    </div>
                  )}
                  {client.manager?.fullName && (
                    <div style={{ marginTop: 2 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{client.manager.fullName}</Typography.Text>
                    </div>
                  )}
                  {client.lastNote?.createdAt && (
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 10 }}>Последний контакт: </Typography.Text>
                      <Typography.Text style={{ fontSize: 11, display: 'block' }}>
                        {dayjs(client.lastNote.createdAt).format('DD.MM.YY HH:mm')}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {client.lastNote.authorName}
                      </Typography.Text>
                    </div>
                  )}
                </div>
                {(isAdmin || user?.permissions?.includes('edit_client')) && (
                  <Space size={4}>
                    {isAdmin && (
                      <Button
                        type="text"
                        size="small"
                        icon={<CrownFilled style={{ color: client.isSvip ? '#faad14' : '#d9d9d9' }} />}
                        onClick={() => svipMut.mutate(client.id)}
                      />
                    )}
                    {isAdmin && (
                      <Select<'NORMAL' | 'SATISFACTORY' | 'NEGATIVE'>
                        size="small"
                        value={client.creditStatus || 'NORMAL'}
                        style={{ width: 94 }}
                        onChange={(value) => creditStatusMut.mutate({ id: client.id, creditStatus: value })}
                        options={[
                          { value: 'NORMAL', label: '—' },
                          { value: 'SATISFACTORY', label: 'У' },
                          { value: 'NEGATIVE', label: 'Н' },
                        ]}
                      />
                    )}
                    <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEdit(client)} />
                    {isAdmin && (
                      <Popconfirm title="Архивировать клиента?" onConfirm={() => archiveMut.mutate(client.id)}>
                        <Button type="text" danger icon={<InboxOutlined />} size="small" />
                      </Popconfirm>
                    )}
                  </Space>
                )}
              </div>
            </Card>
          )}
        />
      ) : (
        <Table
          dataSource={filteredClients}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          rowClassName={(r: Client) => r.isSvip ? 'svip-row' : ''}
          pagination={{
            current: safePage,
            pageSize,
            total: filteredClients.length,
            showSizeChanger: true,
            pageSizeOptions: [...PAGE_SIZE_OPTIONS],
            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
            onChange: (p, ps) => patchListParams({ page: p, pageSize: ps }),
          }}
          size="middle"
          bordered={false}
        />
      )}

      {/* Create Modal */}
      <Modal
        title="Новый клиент"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form form={form} layout="vertical" onFinish={(v) => createMut.mutate(v)}>
          {clientFormFields(false)}
        </Form>
      </Modal>

      {/* Edit Modal (admin only) */}
      <Modal
        title="Редактировать клиента"
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditingClient(null); }}
        onOk={() => editForm.submit()}
        confirmLoading={updateMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
      >
        <Form form={editForm} layout="vertical" onFinish={(v) => {
          if (editingClient) updateMut.mutate({ id: editingClient.id, data: v });
        }}>
          {clientFormFields(true)}
        </Form>
      </Modal>
    </div>
  );
}
