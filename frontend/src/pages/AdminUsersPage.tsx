import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Typography,
  message,
  Tag,
  Popconfirm,
  Card,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { supabaseAuthApi, type SupabaseAuthUser } from '../api/supabaseAuth.api';
import { useAuthStore } from '../store/authStore';
import { useIsMobile } from '../hooks/useIsMobile';

export default function AdminUsersPage() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
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
    { title: 'Email', dataIndex: 'email', key: 'email' },
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
        );
      },
    },
  ];

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Пользователи
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Учётные записи для входа по email (те же, что на сайте Polygraph Business). Создание и удаление — здесь, в CRM.
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
          scroll={isMobile ? { x: 480 } : undefined}
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
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
