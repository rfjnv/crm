import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Typography, Button, Modal, Form, Input, Select, ColorPicker, message, DatePicker, InputNumber, Space, Progress } from 'antd';
import { Link } from 'react-router-dom';
import { UserOutlined, EditOutlined, AimOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { usersApi } from '../api/users.api';
import { useAuthStore } from '../store/authStore';
import { TeamMedalDisplay } from '../components/TeamMedalDisplay';
import { USER_BADGE_ICON_KEYS, USER_BADGE_ICON_LABELS } from '../constants/userBadges';
import type { User } from '../types';

/**
 * Команда — ФИО и медали (активные). Админы могут задать медаль здесь же.
 */
export default function TeamPage() {
  const isAdmin = useAuthStore((s) => {
    const r = s.user?.role;
    return r === 'ADMIN' || r === 'SUPER_ADMIN';
  });

  const [medalUser, setMedalUser] = useState<User | null>(null);
  const [goalUser, setGoalUser] = useState<User | null>(null);
  const [goalMonth, setGoalMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [form] = Form.useForm();
  const [goalForm] = Form.useForm();
  const queryClient = useQueryClient();

  const badgeOptions = USER_BADGE_ICON_KEYS.map((k) => ({
    value: k,
    label: USER_BADGE_ICON_LABELS[k],
  }));

  const { data: users, isLoading } = useQuery({
    queryKey: ['users', 'team'],
    queryFn: () => usersApi.list(),
  });

  const goalPeriod = useMemo(
    () => ({ year: goalMonth.year(), month: goalMonth.month() + 1 }),
    [goalMonth],
  );

  const { data: goals = [] } = useQuery({
    queryKey: ['team-monthly-goals', goalPeriod.year, goalPeriod.month],
    queryFn: () => usersApi.monthlyGoals(goalPeriod),
    enabled: isAdmin,
  });

  const goalsByUser = useMemo(
    () => new Map(goals.map((g) => [g.userId, g])),
    [goals],
  );

  const updateMedalMut = useMutation({
    mutationFn: (payload: {
      id: string;
      data: { badgeLabel: string | null; badgeIcon: string | null; badgeColor: string | null };
    }) => usersApi.update(payload.id, payload.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('Медаль сохранена');
      closeMedalModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const updateGoalMut = useMutation({
    mutationFn: (payload: {
      id: string;
      data: { year: number; month: number; dealsTarget: number | null; revenueTarget: number | null; callNotesTarget: number | null };
    }) => usersApi.upsertMonthlyGoal(payload.id, payload.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team-monthly-goals'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-monthly-goal'] });
      message.success('Цели сохранены');
      closeGoalModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  function openMedalModal(user: User) {
    setMedalUser(user);
    form.setFieldsValue({
      badgeLabel: user.badgeLabel ?? '',
      badgeIcon: user.badgeIcon ?? undefined,
      badgeColor: user.badgeColor || '#22609A',
    });
  }

  function closeMedalModal() {
    setMedalUser(null);
    form.resetFields();
  }

  function submitMedal(values: Record<string, unknown>) {
    if (!medalUser) return;
    const rawColor = values.badgeColor;
    const color =
      typeof rawColor === 'string'
        ? rawColor
        : (rawColor as { toHexString?: () => string } | undefined)?.toHexString?.() ?? null;
    const rawLabel = (values.badgeLabel as string | undefined)?.trim();
    updateMedalMut.mutate({
      id: medalUser.id,
      data: {
        badgeLabel: rawLabel || null,
        badgeIcon: (values.badgeIcon as string | undefined) ?? null,
        badgeColor: color,
      },
    });
  }

  function openGoalModal(user: User) {
    setGoalUser(user);
    const goal = goalsByUser.get(user.id);
    goalForm.setFieldsValue({
      dealsTarget: goal?.targets.deals ?? null,
      revenueTarget: goal?.targets.revenue ?? null,
      callNotesTarget: goal?.targets.callNotes ?? null,
    });
  }

  function closeGoalModal() {
    setGoalUser(null);
    goalForm.resetFields();
  }

  function submitGoal(values: Record<string, unknown>) {
    if (!goalUser) return;
    updateGoalMut.mutate({
      id: goalUser.id,
      data: {
        year: goalPeriod.year,
        month: goalPeriod.month,
        dealsTarget: typeof values.dealsTarget === 'number' ? values.dealsTarget : null,
        revenueTarget: typeof values.revenueTarget === 'number' ? values.revenueTarget : null,
        callNotesTarget: typeof values.callNotesTarget === 'number' ? values.callNotesTarget : null,
      },
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Команда
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Имена, медали и цели на месяц (сделки, выручка, обзвоны).
            {isAdmin
              ? ' Администраторы могут задавать и менять медали и цели прямо здесь.'
              : ' Учётные записи и роли — в разделе «Пользователи» (для администраторов).'}
          </Typography.Text>
        </div>
        <Space>
          {isAdmin && (
            <DatePicker
              picker="month"
              value={goalMonth}
              onChange={(v) => setGoalMonth((v ?? dayjs()).startOf('month'))}
              allowClear={false}
            />
          )}
          {isAdmin && (
            <Link to="/users">
              <Button type="primary" icon={<UserOutlined />}>
                Пользователи
              </Button>
            </Link>
          )}
        </Space>
      </div>

      <Table<User>
        dataSource={users}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="middle"
        bordered={false}
        scroll={{ x: isAdmin ? 980 : 620 }}
        columns={[
          {
            title: 'ФИО',
            dataIndex: 'fullName',
            key: 'fullName',
            ellipsis: true,
          },
          {
            title: 'Медаль',
            key: 'medal',
            width: 250,
            render: (_: unknown, r: User) => (
              <TeamMedalDisplay badgeLabel={r.badgeLabel} badgeIcon={r.badgeIcon} badgeColor={r.badgeColor} variant="full" />
            ),
          },
          ...(isAdmin
            ? [
                {
                  title: 'Цель / прогресс',
                  key: 'goal',
                  width: 360,
                  render: (_: unknown, r: User) => {
                    const g = goalsByUser.get(r.id);
                    if (!g) return <Typography.Text type="secondary">Не задано</Typography.Text>;
                    const items = [
                      { label: 'Сделки', target: g.targets.deals, actual: g.actual.dealsClosed, pct: g.progress.deals },
                      { label: 'Выручка', target: g.targets.revenue, actual: g.actual.revenue, pct: g.progress.revenue },
                      { label: 'Обзвоны', target: g.targets.callNotes, actual: g.actual.callNotes, pct: g.progress.callNotes },
                    ].filter((i) => i.target != null);
                    if (items.length === 0) return <Typography.Text type="secondary">Не задано</Typography.Text>;
                    return (
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {items.map((i) => (
                          <div key={i.label}>
                            <Typography.Text style={{ fontSize: 12 }}>
                              {i.label}: <strong>{i.actual}</strong> / {i.target}
                            </Typography.Text>
                            <Progress percent={Math.min(100, i.pct ?? 0)} size="small" showInfo={false} />
                          </div>
                        ))}
                      </Space>
                    );
                  },
                },
              ]
            : []),
          ...(isAdmin
            ? [
                {
                  title: '',
                  key: 'medalEdit',
                  width: 56,
                  align: 'center' as const,
                  render: (_: unknown, r: User) => (
                    <Space size={0}>
                      <Button type="text" size="small" icon={<EditOutlined />} aria-label="Медаль" onClick={() => openMedalModal(r)} />
                      <Button type="text" size="small" icon={<AimOutlined />} aria-label="Цель" onClick={() => openGoalModal(r)} />
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={medalUser ? `Медаль — ${medalUser.fullName}` : 'Медаль'}
        open={!!medalUser}
        onCancel={closeMedalModal}
        onOk={() => form.submit()}
        confirmLoading={updateMedalMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
        width={440}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 13 }}>
          Произвольная подпись (как «SVIP»), цвет и иконка — отдельно от системной роли.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submitMedal}>
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
        </Form>
      </Modal>

      <Modal
        title={goalUser ? `Цели — ${goalUser.fullName}` : 'Цели'}
        open={!!goalUser}
        onCancel={closeGoalModal}
        onOk={() => goalForm.submit()}
        confirmLoading={updateGoalMut.isPending}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
        width={460}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 13 }}>
          Цели на {goalMonth.format('MMMM YYYY')}: сделки (закрытые), выручка и обзвоны. Поле «Обзвоны» можно оставить пустым.
        </Typography.Paragraph>
        <Form form={goalForm} layout="vertical" onFinish={submitGoal}>
          <Form.Item name="dealsTarget" label="Цель по сделкам">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="Например: 20" />
          </Form.Item>
          <Form.Item name="revenueTarget" label="Цель по выручке">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="Например: 250000000" />
          </Form.Item>
          <Form.Item name="callNotesTarget" label="Цель по обзвонам (необязательно)">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="Пусто = не отслеживать" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
