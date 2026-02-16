import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Modal, Form, Input, Select, Typography, message, Tag, Popconfirm, Checkbox, Tooltip, Card, Row, Col, Statistic, Segmented, Spin } from 'antd';
import { PlusOutlined, StopOutlined, EditOutlined, CheckCircleOutlined, DeleteOutlined, ExclamationCircleOutlined, BarChartOutlined } from '@ant-design/icons';
import { Area } from '@ant-design/charts';
import { usersApi } from '../api/users.api';
import { adminApi } from '../api/admin.api';
import { useAuthStore } from '../store/authStore';
import type { User, Permission } from '../types';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '../types';

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Суперадмин',
  ADMIN: 'Администратор',
  OPERATOR: 'Оператор',
  MANAGER: 'Менеджер',
  ACCOUNTANT: 'Бухгалтер',
  WAREHOUSE: 'Склад',
  WAREHOUSE_MANAGER: 'Зав. складом',
};
const roleColors: Record<string, string> = {
  SUPER_ADMIN: 'red',
  ADMIN: 'gold',
  OPERATOR: 'cyan',
  MANAGER: 'blue',
  ACCOUNTANT: 'purple',
  WAREHOUSE: 'green',
  WAREHOUSE_MANAGER: 'lime',
};

export default function UsersPage() {
  const [open, setOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [kpiUser, setKpiUser] = useState<User | null>(null);
  const [kpiPeriod, setKpiPeriod] = useState<string>('month');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const { data: kpiData, isLoading: kpiLoading } = useQuery({
    queryKey: ['user-kpi', kpiUser?.id, kpiPeriod],
    queryFn: () => usersApi.kpi(kpiUser!.id, kpiPeriod),
    enabled: !!kpiUser,
  });

  const createMut = useMutation({
    mutationFn: (data: { login: string; password: string; fullName: string; role: string; permissions?: Permission[] }) =>
      usersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Пользователь создан');
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ login: string; fullName: string; role: string; password: string; permissions: Permission[] }> }) =>
      usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Пользователь обновлён');
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Пользователь деактивирован');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => usersApi.activate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Пользователь активирован');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const purgeMut = useMutation({
    mutationFn: () => adminApi.purgeData(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      message.success('Все данные очищены');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка очистки';
      message.error(msg);
    },
  });

  function handlePurge() {
    Modal.confirm({
      title: 'Очистить все данные?',
      icon: <ExclamationCircleOutlined />,
      content: 'Будут удалены все клиенты, сделки, товары, движения склада и история. Это действие необратимо!',
      okText: 'Да, удалить всё',
      okType: 'danger',
      cancelText: 'Отмена',
      onOk: () => purgeMut.mutateAsync(),
    });
  }

  function closeModal() {
    setOpen(false);
    setEditingUser(null);
    form.resetFields();
  }

  function openCreate() {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'MANAGER', permissions: DEFAULT_PERMISSIONS['MANAGER'] || [] });
    setOpen(true);
  }

  function openEdit(user: User) {
    setEditingUser(user);
    form.setFieldsValue({
      login: user.login,
      fullName: user.fullName,
      role: user.role,
      permissions: user.permissions || [],
    });
    setOpen(true);
  }

  function handleFinish(values: Record<string, unknown>) {
    if (editingUser) {
      const data: Record<string, unknown> = {};
      if (values.login !== editingUser.login) data.login = values.login;
      if (values.fullName !== editingUser.fullName) data.fullName = values.fullName;
      if (values.role !== editingUser.role) data.role = values.role;
      if (values.password) data.password = values.password;
      data.permissions = values.permissions;
      updateMut.mutate({ id: editingUser.id, data: data as Partial<{ login: string; fullName: string; role: string; password: string; permissions: Permission[] }> });
    } else {
      createMut.mutate(values as { login: string; password: string; fullName: string; role: string; permissions?: Permission[] });
    }
  }

  function handleRoleChange(role: string) {
    const presets = DEFAULT_PERMISSIONS[role] || [];
    form.setFieldsValue({ permissions: presets });
  }

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

  const columns = [
    { title: 'Логин', dataIndex: 'login' },
    { title: 'ФИО', dataIndex: 'fullName' },
    {
      title: 'Роль',
      dataIndex: 'role',
      render: (v: string) => <Tag color={roleColors[v] || 'default'}>{roleLabels[v] || v}</Tag>,
    },
    {
      title: 'Разрешения',
      dataIndex: 'permissions',
      render: (perms: string[] | undefined) => {
        const count = perms?.length || 0;
        if (count === 0) return <Tag>0</Tag>;
        const labels = (perms || []).map((p) => ALL_PERMISSIONS.find((a) => a.key === p)?.label || p).join(', ');
        return <Tooltip title={labels}><Tag color="geekblue">{count}</Tag></Tooltip>;
      },
    },
    {
      title: 'Статус',
      dataIndex: 'isActive',
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Активен' : 'Деактивирован'}</Tag>,
    },
    {
      title: 'Действия',
      width: 160,
      render: (_: unknown, r: User) => {
        const isSelf = r.id === currentUser?.id;
        const isTargetSuperAdmin = r.role === 'SUPER_ADMIN';
        const canEdit = !isTargetSuperAdmin || isSuperAdmin;
        const canToggle = !isSelf && (!isTargetSuperAdmin || isSuperAdmin);

        return (
          <div style={{ display: 'flex', gap: 4 }}>
            <Button type="text" icon={<BarChartOutlined />} size="small" onClick={() => { setKpiUser(r); setKpiPeriod('month'); }} />
            {canEdit && (
              <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEdit(r)} />
            )}
            {r.isActive && canToggle && (
              <Popconfirm title="Деактивировать пользователя?" onConfirm={() => deactivateMut.mutate(r.id)}>
                <Button type="text" danger icon={<StopOutlined />} size="small" />
              </Popconfirm>
            )}
            {!r.isActive && canToggle && (
              <Popconfirm title="Активировать пользователя?" onConfirm={() => activateMut.mutate(r.id)}>
                <Button type="text" style={{ color: '#52c41a' }} icon={<CheckCircleOutlined />} size="small" />
              </Popconfirm>
            )}
          </div>
        );
      },
    },
  ];

  const isEditing = !!editingUser;
  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Пользователи</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Создать</Button>
      </div>

      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="middle"
        bordered={false}
      />

      <Modal
        title={isEditing ? 'Редактировать пользователя' : 'Новый пользователь'}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={isPending}
        okText={isEditing ? 'Сохранить' : 'Создать'}
        cancelText="Отмена"
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.Item name="login" label="Логин" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fullName" label="ФИО" rules={[{ required: true, message: 'Обязательно' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={isEditing ? 'Новый пароль (оставьте пустым)' : 'Пароль'}
            rules={isEditing ? [{ min: 6, message: 'Минимум 6 символов' }] : [{ required: true, message: 'Обязательно' }, { min: 6, message: 'Минимум 6 символов' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'Оператор', value: 'OPERATOR' },
                { label: 'Менеджер', value: 'MANAGER' },
                { label: 'Бухгалтер', value: 'ACCOUNTANT' },
                { label: 'Склад', value: 'WAREHOUSE' },
                { label: 'Зав. складом', value: 'WAREHOUSE_MANAGER' },
                { label: 'Администратор', value: 'ADMIN' },
              ]}
              onChange={handleRoleChange}
            />
          </Form.Item>
          <Form.Item name="permissions" label="Разрешения">
            <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ALL_PERMISSIONS.map((p) => (
                <Checkbox key={p.key} value={p.key}>{p.label}</Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* KPI Modal */}
      <Modal
        title={kpiUser ? `KPI — ${kpiUser.fullName}` : 'KPI'}
        open={!!kpiUser}
        onCancel={() => setKpiUser(null)}
        footer={null}
        width={640}
      >
        <div style={{ marginBottom: 16 }}>
          <Segmented
            value={kpiPeriod}
            onChange={(v) => setKpiPeriod(v as string)}
            options={[
              { label: 'Месяц', value: 'month' },
              { label: 'Квартал', value: 'quarter' },
              { label: 'Год', value: 'year' },
            ]}
          />
        </div>
        {kpiLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : kpiData ? (
          <div>
            <Row gutter={[12, 12]}>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Сделки создано" value={kpiData.dealsCreated} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Сделки завершено" value={kpiData.dealsCompleted} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="Выручка"
                    value={kpiData.revenue}
                    precision={0}
                    suffix="so'm"
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Отгрузки" value={kpiData.shipmentsCount} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="Ср. время сделки"
                    value={kpiData.avgDealDays}
                    suffix="дн."
                  />
                </Card>
              </Col>
            </Row>
            {kpiData.activityByDay.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <Typography.Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
                  Активность (сделки по дням)
                </Typography.Text>
                <Area
                  data={kpiData.activityByDay}
                  xField="day"
                  yField="count"
                  height={200}
                />
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {isSuperAdmin && (
        <div style={{ marginTop: 48, padding: 24, border: '1px solid #ff4d4f', borderRadius: 8 }}>
          <Typography.Title level={5} type="danger" style={{ margin: 0 }}>Опасная зона</Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block', margin: '8px 0 16px' }}>
            Удалить все клиенты, сделки, товары, движения склада и историю. Пользователи не удаляются.
          </Typography.Text>
          <Button danger type="primary" icon={<DeleteOutlined />} loading={purgeMut.isPending} onClick={handlePurge}>
            Очистить все данные
          </Button>
        </div>
      )}
    </div>
  );
}
