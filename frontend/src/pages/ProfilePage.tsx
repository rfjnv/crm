import { useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Tabs,
  Form,
  Input,
  Button,
  Table,
  message,
  DatePicker,
  Typography,
  Space,
  Popconfirm,
  theme,
} from 'antd';
import { Column, Line } from '@ant-design/charts';
import { profileApi } from '../api/profile.api';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { moneyFormatter } from '../utils/currency';

const { RangePicker } = DatePicker;

function splitFullName(full: string) {
  const t = full.trim();
  const i = t.indexOf(' ');
  if (i === -1) return { firstName: t, lastName: '' };
  return { firstName: t.slice(0, i), lastName: t.slice(i + 1).trim() };
}

function shortUa(ua: string | null) {
  if (!ua) return '—';
  if (ua.length <= 72) return ua;
  return `${ua.slice(0, 70)}…`;
}

export default function ProfilePage() {
  const { token: tk } = theme.useToken();
  const isDark = useThemeStore((s) => s.mode) === 'dark';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();
  const [profileForm] = Form.useForm();
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(13, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);

  const fromStr = range[0].format('YYYY-MM-DD');
  const toStr = range[1].format('YYYY-MM-DD');

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['profile-sessions'],
    queryFn: profileApi.sessions,
  });

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['profile-daily-report', fromStr, toStr],
    queryFn: () => profileApi.dailyReport(fromStr, toStr),
  });

  const profileMut = useMutation({
    mutationFn: profileApi.updateProfile,
    onSuccess: (fresh) => {
      setUser(fresh);
      message.success('Профиль сохранён');
      profileForm.setFieldsValue({
        ...splitFullName(fresh.fullName),
        login: fresh.login,
        currentPassword: '',
        newPassword: '',
      });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const revokeMut = useMutation({
    mutationFn: profileApi.revokeSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-sessions'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Ошибка';
      message.error(msg);
    },
  });

  const dealsChartData = useMemo(() => {
    if (!report?.days.length) return [];
    return report.days.flatMap((d) => [
      { date: d.date, type: 'Создано', value: d.dealsCreated },
      { date: d.date, type: 'Закрыто', value: d.dealsClosed },
    ]);
  }, [report]);

  const revenueChartData = useMemo(
    () => (report?.days ?? []).map((d) => ({ date: d.date, revenue: d.revenue })),
    [report],
  );

  if (!user) return null;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Профиль
      </Typography.Title>
      <Tabs
        items={[
          {
            key: 'me',
            label: 'Мои данные',
            children: (
              <Form
                form={profileForm}
                layout="vertical"
                style={{ maxWidth: 440 }}
                initialValues={{
                  ...splitFullName(user.fullName),
                  login: user.login,
                }}
                onFinish={(v) => {
                  profileMut.mutate({
                    firstName: v.firstName,
                    lastName: v.lastName,
                    login: v.login !== user.login ? v.login : undefined,
                    currentPassword: v.currentPassword || undefined,
                    newPassword: v.newPassword || undefined,
                  });
                }}
              >
                <Form.Item name="firstName" label="Имя" rules={[{ required: true, message: 'Укажите имя' }]}>
                  <Input autoComplete="given-name" />
                </Form.Item>
                <Form.Item name="lastName" label="Фамилия">
                  <Input autoComplete="family-name" />
                </Form.Item>
                <Form.Item name="login" label="Логин" rules={[{ required: true }]}>
                  <Input autoComplete="username" />
                </Form.Item>
                <Form.Item name="currentPassword" label="Текущий пароль (если меняете пароль)">
                  <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Form.Item name="newPassword" label="Новый пароль">
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={profileMut.isPending}>
                  Сохранить
                </Button>
              </Form>
            ),
          },
          {
            key: 'sessions',
            label: 'Активные сеансы',
            children: (
              <Table
                loading={sessionsLoading}
                dataSource={sessions}
                rowKey="id"
                pagination={false}
                columns={[
                  {
                    title: 'Устройство / браузер',
                    dataIndex: 'userAgent',
                    render: (ua: string | null) => <Typography.Text code>{shortUa(ua)}</Typography.Text>,
                  },
                  { title: 'IP', dataIndex: 'ip', width: 120, render: (ip: string | null) => ip || '—' },
                  {
                    title: 'Создан',
                    dataIndex: 'createdAt',
                    width: 160,
                    render: (d: string) => dayjs(d).format('DD.MM.YYYY HH:mm'),
                  },
                  {
                    title: 'Активность',
                    dataIndex: 'lastUsedAt',
                    width: 160,
                    render: (d: string | null) => (d ? dayjs(d).format('DD.MM.YYYY HH:mm') : '—'),
                  },
                  {
                    title: '',
                    key: 'cur',
                    width: 100,
                    render: (_: unknown, r) => (r.isCurrent ? <Typography.Text type="success">Текущий</Typography.Text> : null),
                  },
                  {
                    title: '',
                    key: 'act',
                    width: 120,
                    render: (_: unknown, r) => (
                      <Popconfirm
                        title={r.isCurrent ? 'Завершить эту сессию?' : 'Завершить сессию на этом устройстве?'}
                        okText="Да"
                        cancelText="Нет"
                        onConfirm={() =>
                          revokeMut.mutate(r.id, {
                            onSuccess: () => {
                              message.success('Сессия завершена');
                              if (r.isCurrent) {
                                logout();
                                window.location.href = '/login';
                              }
                            },
                          })
                        }
                      >
                        <Button size="small" danger loading={revokeMut.isPending}>
                          Завершить
                        </Button>
                      </Popconfirm>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'report',
            label: 'Ежедневный отчёт',
            children: (
              <div>
                <Space style={{ marginBottom: 16 }} wrap>
                  <RangePicker
                    value={range}
                    onChange={(v) => {
                      if (v?.[0] && v[1]) setRange([v[0], v[1]]);
                    }}
                    allowClear={false}
                  />
                </Space>
                {report && !reportLoading ? (
                  <div>
                    <Space size="large" wrap style={{ marginBottom: 20 }}>
                      <Typography.Text>
                        Сделок создано: <strong>{report.totals.dealsCreated}</strong>
                      </Typography.Text>
                      <Typography.Text>
                        Закрыто: <strong>{report.totals.dealsClosed}</strong>
                      </Typography.Text>
                      <Typography.Text>
                        Выручка: <strong>{moneyFormatter(report.totals.revenue)}</strong> {'so\'m'}
                      </Typography.Text>
                    </Space>
                    {dealsChartData.length > 0 && (
                      <div style={{ marginBottom: 24 }}>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Сделки по дням (создано / закрыто)
                        </Typography.Text>
                        <Column
                          data={dealsChartData}
                          xField="date"
                          yField="value"
                          colorField="type"
                          group={true}
                          height={260}
                          theme={chartTheme}
                          axis={{
                            x: { labelFill: tk.colorText },
                            y: { labelFill: tk.colorText },
                          }}
                        />
                      </div>
                    )}
                    {revenueChartData.some((d) => d.revenue > 0) && (
                      <div>
                        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                          Выручка по дням
                        </Typography.Text>
                        <Line
                          data={revenueChartData}
                          xField="date"
                          yField="revenue"
                          height={220}
                          theme={chartTheme}
                          axis={{
                            x: { labelFill: tk.colorText },
                            y: { labelFill: tk.colorText },
                          }}
                        />
                      </div>
                    )}
                    {!report.days.length && (
                      <Typography.Text type="secondary">Нет данных за выбранный период.</Typography.Text>
                    )}
                  </div>
                ) : (
                  <Typography.Text type="secondary">Загрузка…</Typography.Text>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
