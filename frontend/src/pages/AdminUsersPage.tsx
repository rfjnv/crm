import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Typography,
  message,
  Tag,
  Popconfirm,
  Space,
  Card,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { supabaseAuthApi, type SupabaseAuthRole, type SupabaseAuthUser } from '../api/supabaseAuth.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';

const roleLabels: Record<SupabaseAuthRole, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
};

const roleColors: Record<SupabaseAuthRole, string> = {
  superadmin: 'red',
  admin: 'gold',
};

export default function AdminUsersPage() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [roleModal, setRoleModal] = useState<SupabaseAuthUser | null>(null);
  const [form] = Form.useForm();
  const [roleForm] = Form.useForm();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['supabase-auth-users'],
    queryFn: supabaseAuthApi.listUsers,
  });

  const createMutation = useMutation({
    mutationFn: supabaseAuthApi.createUser,
    onSuccess: () => {
      message.success('Пользователь создан');
      queryClient.invalidateQueries({ queryKey: ['supabase-auth-users'] });
      setOpen(false);
      form.resetFields();
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      message.error(err.response?.data?.error || 'Ошибка создания');
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: SupabaseAuthRole }) => supabaseAuthApi.updateRole(id, role),
    onSuccess: () => {
      message.success('Роль обновлена');
      queryClient.invalidateQueries({ queryKey: ['supabase-auth-users'] });
      setRoleModal(null);
      roleForm.resetFields();
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      message.error(err.response?.data?.error || 'Ошибка обновления');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: supabaseAuthApi.deleteUser,
    onSuccess: () => {
      message.success('Пользователь удалён');
      queryClient.invalidateQueries({ queryKey: ['supabase-auth-users'] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      message.error(err.response?.data?.error || 'Ошибка удаления');
    },
  });

  const columns = [
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Роль',
      dataIndex: 'role',
      key: 'role',
      render: (role: SupabaseAuthRole | null) =>
        role ? <Tag color={roleColors[role]}>{roleLabels[role]}</Tag> : <Tag>—</Tag>,
    },
    {
      title: 'Создан',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => dayjs(v).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Статус',
      key: 'status',
      render: (_: unknown, row: SupabaseAuthUser) =>
        row.banned ? <Tag color="error">Заблокирован</Tag> : <Tag color="success">Активен</Tag>,
    },
    {
      title: 'Действия',
      key: 'actions',
      render: (_: unknown, row: SupabaseAuthUser) => {
        const isSelf = row.id === currentUser?.supabaseUserId;
        return (
          <Space>
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                setRoleModal(row);
                roleForm.setFieldsValue({ role: row.role ?? 'admin' });
              }}
            >
              Роль
            </Button>
            <Popconfirm
              title="Удалить пользователя?"
              description={row.email}
              onConfirm={() => deleteMutation.mutate(row.id)}
              disabled={isSelf}
            >
              <Button type="link" danger icon={<DeleteOutlined />} disabled={isSelf}>
                Удалить
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Пользователи (Supabase Auth)
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Учётные записи входа в CRM и админ-панель сайта. Роли задаются в user_metadata Supabase.
      </Typography.Paragraph>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Создать пользователя
          </Button>
        </div>

        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={users}
          columns={columns}
          scroll={isMobile ? { x: 600 } : undefined}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title="Новый пользователь"
        open={open}
        onCancel={() => {
          setOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
          initialValues={{ role: 'admin' }}
        >
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'admin', label: 'Admin' },
                { value: 'superadmin', label: 'Superadmin' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Роль: ${roleModal?.email ?? ''}`}
        open={!!roleModal}
        onCancel={() => {
          setRoleModal(null);
          roleForm.resetFields();
        }}
        onOk={() => roleForm.submit()}
        confirmLoading={updateRoleMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={roleForm}
          layout="vertical"
          onFinish={(values) => {
            if (!roleModal) return;
            updateRoleMutation.mutate({ id: roleModal.id, role: values.role });
          }}
        >
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'admin', label: 'Admin' },
                { value: 'superadmin', label: 'Superadmin' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
