import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Table, Button, Modal, Form, Input, Typography, message, Space, Popconfirm, Select } from 'antd';
import { PlusOutlined, InboxOutlined, EditOutlined } from '@ant-design/icons';
import { clientsApi, type CreateClientData } from '../api/clients.api';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import type { Client } from '../types';

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
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data: clients, isLoading } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list, refetchInterval: 10_000 });

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canAssignManager = isAdmin || user?.role === 'OPERATOR';

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: canAssignManager,
  });

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
    });
    setEditOpen(true);
  };

  const columns = [
    { title: 'Компания', dataIndex: 'companyName', render: (v: string, r: Client) => <Link to={`/clients/${r.id}`}>{v}</Link> },
    { title: 'Контакт', dataIndex: 'contactName' },
    { title: 'Телефон', dataIndex: 'phone' },
    { title: 'Email', dataIndex: 'email' },
    { title: 'Менеджер', dataIndex: ['manager', 'fullName'] },
    ...(isAdmin
      ? [{
        title: '',
        width: 100,
        render: (_: unknown, r: Client) => (
          <Space>
            <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEdit(r)} />
            <Popconfirm title="Архивировать клиента?" onConfirm={() => archiveMut.mutate(r.id)}>
              <Button type="text" danger icon={<InboxOutlined />} size="small" />
            </Popconfirm>
          </Space>
        ),
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
      <Space style={{ width: '100%' }} size="middle">
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
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Клиенты</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Добавить</Button>
      </div>

      <Table
        dataSource={clients}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        size="middle"
        bordered={false}
      />

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
