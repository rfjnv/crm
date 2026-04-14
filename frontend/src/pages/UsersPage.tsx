import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  Checkbox,
  Tooltip,
  Card,
  Row,
  Col,
  Statistic,
  Segmented,
  Spin,
  theme,
  ColorPicker,
  Space,
  Divider,
} from 'antd';
import { PlusOutlined, StopOutlined, EditOutlined, CheckCircleOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
import { Area } from '@ant-design/charts';
import { Link } from 'react-router-dom';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { moneyFormatter } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import type { User, Permission } from '../types';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '../types';
import { USER_BADGE_ICON_KEYS, USER_BADGE_ICON_LABELS } from '../constants/userBadges';
import { TeamMedalDisplay } from '../components/TeamMedalDisplay';

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Суперадмин',
  ADMIN: 'Администратор',
  OPERATOR: 'Оператор',
  MANAGER: 'Менеджер',
  ACCOUNTANT: 'Бухгалтер',
  WAREHOUSE: 'Склад',
  WAREHOUSE_MANAGER: 'Зав. складом',
  DRIVER: 'Водитель',
  LOADER: 'Грузчик',
};
const roleColors: Record<string, string> = {
  SUPER_ADMIN: 'red',
  ADMIN: 'gold',
  OPERATOR: 'cyan',
  MANAGER: 'blue',
  ACCOUNTANT: 'purple',
  WAREHOUSE: 'green',
  WAREHOUSE_MANAGER: 'lime',
  DRIVER: 'orange',
  LOADER: 'volcano',
};

/** Управление учётными записями: ADMIN и SUPER_ADMIN. Полный список, в т.ч. неактивные. */
export default function UsersPage() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [kpiUser, setKpiUser] = useState<User | null>(null);
  const { token: tk } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const [kpiPeriod, setKpiPeriod] = useState<string>('month');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const canManageTeam = currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPER_ADMIN';
  const badgeOptions = USER_BADGE_ICON_KEYS.map((k) => ({
    value: k,
    label: USER_BADGE_ICON_LABELS[k],
  }));

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', 'manage'],
    queryFn: () => usersApi.list({ includeInactive: true }),
  });

  const { data: kpiData, isLoading: kpiLoading } = useQuery({
    queryKey: ['user-kpi', kpiUser?.id, kpiPeriod],
    queryFn: () => usersApi.kpi(kpiUser!.id, kpiPeriod),
    enabled: !!kpiUser,
  });

  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const createMut = useMutation({
    mutationFn: (data: { login: string; password: string; fullName: string; role: string; permissions?: Permission[] }) =>
      usersApi.create(data),
    onSuccess: () => {
      invalidateUsers();
      message.success('Пользователь создан');
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{
        login: string;
        fullName: string;
        role: string;
        password: string;
        permissions: Permission[];
        badgeIcon: string | null;
        badgeColor: string | null;
        badgeLabel: string | null;
      }>;
    }) => usersApi.update(id, data),
    onSuccess: () => {
      invalidateUsers();
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
      invalidateUsers();
      message.success('Пользователь деактивирован');
      closeModal();
      setEditingUser(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => usersApi.activate(id),
    onSuccess: () => {
      invalidateUsers();
      message.success('Пользователь активирован');
      closeModal();
      setEditingUser(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi.deleteUser(id),
    onSuccess: () => {
      invalidateUsers();
      message.success('Пользователь удалён');
      closeModal();
      setEditingUser(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка удаления';
      message.error(msg);
    },
  });

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
      badgeIcon: user.badgeIcon ?? undefined,
      badgeColor: user.badgeColor || '#22609A',
      badgeLabel: user.badgeLabel ?? '',
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
      if (canManageTeam) {
        data.badgeIcon = (values.badgeIcon as string | undefined) ?? null;
        const rawColor = values.badgeColor;
        data.badgeColor =
          typeof rawColor === 'string'
            ? rawColor
            : (rawColor as { toHexString?: () => string } | undefined)?.toHexString?.() ?? null;
        const rawLabel = (values.badgeLabel as string | undefined)?.trim();
        data.badgeLabel = rawLabel || null;
      }
      updateMut.mutate({
        id: editingUser.id,
        data: data as Partial<{
          login: string;
          fullName: string;
          role: string;
          password: string;
          permissions: Permission[];
          badgeIcon: string | null;
          badgeColor: string | null;
          badgeLabel: string | null;
        }>,
      });
    } else {
      createMut.mutate(values as { login: string; password: string; fullName: string; role: string; permissions?: Permission[] });
    }
  }

  function handleRoleChange(role: string) {
    const presets = DEFAULT_PERMISSIONS[role] || [];
    form.setFieldsValue({ permissions: presets });
  }

  const columns = useMemo(
    () => [
      {
        title: 'Медаль',
        key: 'medal',
        width: 200,
        render: (_: unknown, r: User) => (
          <TeamMedalDisplay badgeLabel={r.badgeLabel} badgeIcon={r.badgeIcon} badgeColor={r.badgeColor} variant="full" />
        ),
      },
      { title: 'Логин', dataIndex: 'login', width: 120 },
      { title: 'ФИО', dataIndex: 'fullName', ellipsis: true },
      {
        title: 'Роль',
        dataIndex: 'role',
        width: 140,
        render: (v: string) => <Tag color={roleColors[v] || 'default'}>{roleLabels[v] || v}</Tag>,
      },
      {
        title: 'Разрешения',
        dataIndex: 'permissions',
        width: 100,
        render: (perms: string[] | undefined) => {
          const count = perms?.length || 0;
          if (count === 0) return <Tag>0</Tag>;
          const labels = (perms || []).map((p) => ALL_PERMISSIONS.find((a) => a.key === p)?.label || p).join(', ');
          return (
            <Tooltip title={labels}>
              <Tag color="geekblue">{count}</Tag>
            </Tooltip>
          );
        },
      },
      {
        title: 'Статус',
        dataIndex: 'isActive',
        width: 120,
        render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Активен' : 'Деактивирован'}</Tag>,
      },
      {
        title: 'Действия',
        key: 'actions',
        width: 200,
        fixed: 'right' as const,
        render: (_: unknown, r: User) => {
          const isSelf = r.id === currentUser?.id;
          const isTargetSuperAdmin = r.role === 'SUPER_ADMIN';
          const canEdit = !isTargetSuperAdmin || isSuperAdmin;
          const canToggle = !isSelf && (!isTargetSuperAdmin || isSuperAdmin);

          return (
            <Space size={4} wrap>
              <Button
                type="text"
                icon={<BarChartOutlined />}
                size="small"
                onClick={() => {
                  setKpiUser(r);
                  setKpiPeriod('month');
                }}
              />
              {canEdit && <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEdit(r)} />}
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
              {canToggle && (
                <Popconfirm
                  title="Удалить пользователя навсегда?"
                  description="Если у пользователя есть сделки или клиенты — используйте деактивацию"
                  onConfirm={() => deleteMut.mutate(r.id)}
                  okText="Удалить"
                  cancelText="Отмена"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                </Popconfirm>
              )}
            </Space>
          );
        },
      },
    ],
    [currentUser?.id, isSuperAdmin],
  );

  const isEditing = !!editingUser;
  const isPending = createMut.isPending || updateMut.isPending;

  const dangerTarget = editingUser;
  const isSelf = dangerTarget && currentUser && dangerTarget.id === currentUser.id;
  const isTargetSuperAdmin = dangerTarget?.role === 'SUPER_ADMIN';
  const canEditDanger = dangerTarget && canManageTeam && (!isTargetSuperAdmin || isSuperAdmin) && !isSelf;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Пользователи
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Учётные записи, роли и медали. В списке — все пользователи, включая неактивных. Публичный список команды —{' '}
            <Link to="/team">Команда</Link>.
          </Typography.Text>
        </div>
        {canManageTeam && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Создать пользователя
          </Button>
        )}
      </div>

      <Table<User>
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="middle"
        bordered={false}
        scroll={{ x: 1100 }}
      />

      <Modal
        title={isEditing ? 'Редактировать пользователя' : 'Новый пользователь'}
        open={open}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={isPending}
        okText={isEditing ? 'Сохранить' : 'Создать'}
        cancelText="Отмена"
        width={isMobile ? '100%' : 520}
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
                { label: 'Водитель', value: 'DRIVER' },
                { label: 'Грузчик', value: 'LOADER' },
                { label: 'Администратор', value: 'ADMIN' },
              ]}
              onChange={handleRoleChange}
            />
          </Form.Item>
          <Form.Item name="permissions" label="Разрешения">
            <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ALL_PERMISSIONS.map((p) => (
                <Checkbox key={p.key} value={p.key}>
                  {p.label}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
          {isEditing && canManageTeam && (
            <>
              <Divider plain>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Медаль в списке команды
                </Typography.Text>
              </Divider>
              <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 13 }}>
                Произвольная подпись (как «SVIP»), цвет и иконка — отдельно от системной роли.
              </Typography.Paragraph>
              <Form.Item name="badgeLabel" label="Подпись">
                <Input placeholder="Например: упорный, лентяй, SVIP" maxLength={48} showCount />
              </Form.Item>
              <Form.Item name="badgeIcon" label="Иконка">
                <Select allowClear placeholder="Без иконки" options={badgeOptions} />
              </Form.Item>
              <Form.Item
                name="badgeColor"
                label="Цвет"
                getValueFromEvent={(v: string | { toHexString?: () => string }) =>
                  typeof v === 'string' ? v : v?.toHexString?.() ?? '#22609A'
                }
              >
                <ColorPicker showText format="hex" disabledAlpha />
              </Form.Item>
            </>
          )}
        </Form>

        {isEditing && canManageTeam && dangerTarget && canEditDanger && (
          <>
            <Divider />
            <Typography.Text type="danger" strong>
              Опасная зона
            </Typography.Text>
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {dangerTarget.isActive ? (
                <Popconfirm title="Деактивировать пользователя?" onConfirm={() => deactivateMut.mutate(dangerTarget.id)}>
                  <Button danger icon={<StopOutlined />} loading={deactivateMut.isPending}>
                    Деактивировать
                  </Button>
                </Popconfirm>
              ) : (
                <Popconfirm title="Активировать пользователя?" onConfirm={() => activateMut.mutate(dangerTarget.id)}>
                  <Button type="primary" icon={<CheckCircleOutlined />} loading={activateMut.isPending}>
                    Активировать
                  </Button>
                </Popconfirm>
              )}
              <Popconfirm
                title="Удалить пользователя навсегда?"
                description="Если у пользователя есть сделки или клиенты — используйте деактивацию"
                onConfirm={() => deleteMut.mutate(dangerTarget.id)}
                okText="Удалить"
                cancelText="Отмена"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />} loading={deleteMut.isPending}>
                  Удалить навсегда
                </Button>
              </Popconfirm>
            </div>
          </>
        )}
      </Modal>

      <Modal
        title={kpiUser ? `KPI — ${kpiUser.fullName}` : 'KPI'}
        open={!!kpiUser}
        onCancel={() => setKpiUser(null)}
        footer={null}
        width={isMobile ? '100%' : 640}
      >
        {kpiUser && canManageTeam && (
          <div style={{ marginBottom: 12 }}>
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                setKpiUser(null);
                openEdit(kpiUser);
              }}
              style={{ padding: 0 }}
            >
              Редактировать пользователя
            </Button>
          </div>
        )}
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
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
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
                  <Statistic title="Выручка" value={kpiData.revenue} formatter={(v) => moneyFormatter(Number(v))} suffix="so'm" />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Отгрузки" value={kpiData.shipmentsCount} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Ср. время сделки" value={kpiData.avgDealDays} suffix="дн." />
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
                  theme={chartTheme}
                  axis={{
                    x: { labelFill: tk.colorText },
                    y: { labelFill: tk.colorText },
                  }}
                />
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
